package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/storage"
)

// Documents attach to a validation subject: the entry itself (PERSONNEL_ENTRY, id =
// personnel id) or a change request (CHANGE_REQUEST, id = request id). Files live in
// private storage; the database holds metadata and the server-generated key only.

const (
	SubjectEntry         = "PERSONNEL_ENTRY"
	SubjectChangeRequest = "CHANGE_REQUEST"
	// SubjectPersonnel holds the employee's own documents (id = personnel id): the PKWT,
	// required under TxEmployeeFile by migration 0004. It is never locked and a missing
	// PKWT only warns; validation is not gated by it.
	SubjectPersonnel = "PERSONNEL"
	TxEmployeeFile   = "EMPLOYEE_FILE"
)

type DocumentType struct {
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	Active      bool    `json:"active"`
}

type DocumentCatalog struct {
	Types []DocumentType `json:"types"`
	// Requirements maps transaction type → required document type codes.
	Requirements map[string][]string `json:"requirements"`
	MaxBytes     int                 `json:"maxBytes"`
	AllowedTypes []string            `json:"allowedTypes"`
}

type DocumentVersion struct {
	ID               string     `json:"id"`
	DocumentTypeCode string     `json:"documentTypeCode"`
	Version          int        `json:"version"`
	OriginalName     string     `json:"originalName"`
	ContentType      string     `json:"contentType"`
	SizeBytes        int64      `json:"sizeBytes"`
	UploadedBy       string     `json:"uploadedBy"`
	UploadedAt       time.Time  `json:"uploadedAt"`
	ReviewStatus     string     `json:"reviewStatus"`
	ReviewNote       *string    `json:"reviewNote"`
	ReviewedBy       *string    `json:"reviewedBy"`
	ReviewedAt       *time.Time `json:"reviewedAt"`
	SupersededAt     *time.Time `json:"supersededAt"`
}

type DocumentSlot struct {
	DocumentTypeCode string            `json:"documentTypeCode"`
	Name             string            `json:"name"`
	Required         bool              `json:"required"`
	Status           string            `json:"status"` // MISSING | PENDING_REVIEW | ACCEPTED | REJECTED
	Current          *DocumentVersion  `json:"current"`
	History          []DocumentVersion `json:"history"`
}

type SubjectDocuments struct {
	SubjectType     string            `json:"subjectType"`
	SubjectID       string            `json:"subjectId"`
	TransactionType string            `json:"transactionType"`
	SubjectStatus   string            `json:"subjectStatus"`
	Locked          bool              `json:"locked"` // validated subjects keep their documents read-only
	Complete        bool              `json:"complete"`
	Blockers        map[string]string `json:"blockers"`
	Slots           []DocumentSlot    `json:"slots"`
}

type docSubject struct {
	Type, ID, TxType, PersonnelID, Status, CreatedBy string
	Areas                                            []*string
	AreaID                                           *string
}

// locked: a validated submission keeps its documents read-only; employee documents never lock.
func (s docSubject) locked() bool { return s.Type != SubjectPersonnel && s.Status == "VALIDATED" }

func (s docSubject) visibleTo(p *access.Principal) bool {
	for _, a := range s.Areas {
		if p.CoversArea(a) {
			return true
		}
	}
	return false
}

func loadSubject(ctx context.Context, q db.Querier, subjectType, id string, forUpdate bool) (docSubject, error) {
	lock := ""
	if forUpdate {
		lock = " FOR UPDATE"
	}
	sub := docSubject{Type: subjectType, ID: id}
	var err error
	switch subjectType {
	case SubjectEntry:
		sub.TxType = string(access.TxEntry)
		err = q.QueryRow(ctx, `SELECT id, record_status, area_id, created_by FROM personnel WHERE id = $1`+lock, id).Scan(&sub.PersonnelID, &sub.Status, &sub.AreaID, &sub.CreatedBy)
		sub.Areas = []*string{sub.AreaID}
	case SubjectPersonnel:
		sub.TxType = TxEmployeeFile
		err = q.QueryRow(ctx, `SELECT id, record_status, area_id, created_by FROM personnel WHERE id = $1`+lock, id).Scan(&sub.PersonnelID, &sub.Status, &sub.AreaID, &sub.CreatedBy)
		sub.Areas = []*string{sub.AreaID}
	case SubjectChangeRequest:
		var origin, target *string
		err = q.QueryRow(ctx, `SELECT transaction_type, status, personnel_id, origin_area_id, target_area_id, created_by FROM change_requests WHERE id = $1`+lock, id).
			Scan(&sub.TxType, &sub.Status, &sub.PersonnelID, &origin, &target, &sub.CreatedBy)
		sub.Areas, sub.AreaID = []*string{origin, target}, origin
	default:
		return sub, httpx.NotFound("Pengajuan")
	}
	return sub, notFoundOr(err, "Pengajuan")
}

// visibleSubject applies scope; out-of-scope subjects are reported as not found.
func (s *Service) visibleSubject(ctx context.Context, q db.Querier, p *access.Principal, subjectType, id string, forUpdate bool) (docSubject, error) {
	sub, err := loadSubject(ctx, q, subjectType, id, forUpdate)
	if err != nil {
		return sub, err
	}
	if !sub.visibleTo(p) {
		return sub, httpx.NotFound("Pengajuan")
	}
	return sub, nil
}

func loadCatalog(ctx context.Context, q db.Querier) ([]DocumentType, map[string][]string, error) {
	rows, err := q.Query(ctx, `SELECT code, name, description, active FROM document_types ORDER BY name, code`)
	if err != nil {
		return nil, nil, err
	}
	types, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (DocumentType, error) {
		var t DocumentType
		return t, r.Scan(&t.Code, &t.Name, &t.Description, &t.Active)
	})
	if err != nil {
		return nil, nil, err
	}
	req := map[string][]string{}
	for _, t := range access.TransactionTypes {
		req[string(t)] = []string{}
	}
	rows, err = q.Query(ctx, `SELECT r.transaction_type, r.document_type_code FROM document_requirements r JOIN document_types t ON t.code = r.document_type_code
		WHERE t.active ORDER BY r.transaction_type, r.document_type_code`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var tt, code string
		if err := rows.Scan(&tt, &code); err != nil {
			return nil, nil, err
		}
		req[tt] = append(req[tt], code)
	}
	return types, req, rows.Err()
}

func (s *Service) DocumentCatalog(ctx context.Context, p *access.Principal) (*DocumentCatalog, error) {
	if err := requireAny(p, access.ViewEmployee, access.ManageDocumentRules); err != nil {
		return nil, err
	}
	types, req, err := loadCatalog(ctx, s.Pool)
	if err != nil {
		return nil, err
	}
	return &DocumentCatalog{Types: types, Requirements: req, MaxBytes: s.DocMaxBytes, AllowedTypes: slices.Clone(s.DocAllowedTypes)}, nil
}

type DocumentTypeInput struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
	Active      bool    `json:"active"`
}

var docTypeCode = func(c string) bool {
	if len(c) < 2 || len(c) > 40 || c[0] < 'A' || c[0] > 'Z' {
		return false
	}
	for _, r := range c {
		if !(r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_') {
			return false
		}
	}
	return true
}

func (s *Service) SaveDocumentType(ctx context.Context, a Actor, code string, in DocumentTypeInput) (*DocumentCatalog, error) {
	p := a.P
	if err := require(p, access.ManageDocumentRules); err != nil {
		return nil, err
	}
	fe := httpx.FieldErrors{}
	code = strings.ToUpper(strings.TrimSpace(code))
	if !docTypeCode(code) {
		fe.Add("code", "Kode 2–40 karakter: huruf besar, angka, atau garis bawah, diawali huruf (contoh: KTP, SURAT_RESIGN).")
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		fe.Add("name", "Wajib diisi.")
	}
	if err := fe.Err(); err != nil {
		return nil, err
	}
	err := s.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO document_types (code, name, description, active, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
			ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, active = EXCLUDED.active, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
			code, in.Name, trimPtr(in.Description), in.Active, p.UserID, s.now()); err != nil {
			return err
		}
		return s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "settings.document_type.save", EntityType: "document_type", EntityID: code, Details: map[string]any{"active": in.Active}})
	})
	if err != nil {
		return nil, err
	}
	return s.DocumentCatalog(ctx, p)
}

// SaveDocumentRequirements replaces the set of mandatory document types for one transaction type.
func (s *Service) SaveDocumentRequirements(ctx context.Context, a Actor, txType string, codes []string) (*DocumentCatalog, error) {
	p := a.P
	if err := require(p, access.ManageDocumentRules); err != nil {
		return nil, err
	}
	if !slices.Contains(access.TransactionTypes, access.TransactionType(txType)) { // EMPLOYEE_FILE is fixed (PKWT, migration 0004)
		return nil, httpx.NotFound("Jenis transaksi")
	}
	err := s.tx(ctx, func(tx pgx.Tx) error {
		types, prev, err := loadCatalog(ctx, tx)
		if err != nil {
			return err
		}
		fe := httpx.FieldErrors{}
		seen := map[string]bool{}
		for _, c := range codes {
			ok := slices.ContainsFunc(types, func(t DocumentType) bool { return t.Code == c && t.Active })
			if !ok {
				fe.Add("documentTypeCodes", "Jenis dokumen tidak dikenal atau tidak aktif: "+c+".")
			}
			seen[c] = true
		}
		if err := fe.Err(); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM document_requirements WHERE transaction_type = $1`, txType); err != nil {
			return err
		}
		for c := range seen {
			if _, err := tx.Exec(ctx, `INSERT INTO document_requirements (transaction_type, document_type_code, updated_by, updated_at) VALUES ($1,$2,$3,$4)`, txType, c, p.UserID, s.now()); err != nil {
				return err
			}
		}
		return s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "settings.document_requirements.update", EntityType: "document_requirements", EntityID: txType,
			Details: map[string]any{"before": prev[txType], "after": slices.Sorted(maps.Keys(seen))}})
	})
	if err != nil {
		return nil, err
	}
	return s.DocumentCatalog(ctx, p)
}

const versionCols = `id, document_type_code, version, original_name, content_type, size_bytes, uploaded_by, uploaded_at, review_status, review_note, reviewed_by, reviewed_at, superseded_at`

func scanVersion(r pgx.CollectableRow) (DocumentVersion, error) {
	var v DocumentVersion
	return v, r.Scan(&v.ID, &v.DocumentTypeCode, &v.Version, &v.OriginalName, &v.ContentType, &v.SizeBytes, &v.UploadedBy, &v.UploadedAt, &v.ReviewStatus, &v.ReviewNote, &v.ReviewedBy, &v.ReviewedAt, &v.SupersededAt)
}

// currentStatuses maps document type → review status of the current version for a subject.
func currentStatuses(ctx context.Context, q db.Querier, subjectType, subjectID string) (map[string]string, error) {
	rows, err := q.Query(ctx, `SELECT document_type_code, review_status FROM document_versions WHERE subject_type = $1 AND subject_id = $2 AND superseded_at IS NULL`, subjectType, subjectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var code, st string
		if err := rows.Scan(&code, &st); err != nil {
			return nil, err
		}
		out[code] = st
	}
	return out, rows.Err()
}

// documentGate rejects final validation while a required document is not accepted.
func documentGate(ctx context.Context, q db.Querier, subjectType, subjectID, txType string) error {
	_, req, err := loadCatalog(ctx, q)
	if err != nil {
		return err
	}
	if len(req[txType]) == 0 {
		return nil
	}
	cur, err := currentStatuses(ctx, q, subjectType, subjectID)
	if err != nil {
		return err
	}
	if b := domain.DocumentBlockers(req[txType], cur); len(b) > 0 {
		e := httpx.Conflict("DOCUMENTS_INCOMPLETE", "Dokumen wajib belum lengkap atau belum diterima. Validasi akhir belum dapat dilakukan.")
		e.Fields = b
		return e
	}
	return nil
}

func (s *Service) subjectDocuments(ctx context.Context, q db.Querier, sub docSubject, types []DocumentType, req map[string][]string) (SubjectDocuments, error) {
	out := SubjectDocuments{SubjectType: sub.Type, SubjectID: sub.ID, TransactionType: sub.TxType, SubjectStatus: sub.Status, Locked: sub.locked(), Slots: []DocumentSlot{}}
	rows, err := q.Query(ctx, `SELECT `+versionCols+` FROM document_versions WHERE subject_type = $1 AND subject_id = $2 ORDER BY document_type_code, version DESC`, sub.Type, sub.ID)
	if err != nil {
		return out, err
	}
	versions, err := pgx.CollectRows(rows, scanVersion)
	if err != nil {
		return out, err
	}
	byType := map[string][]DocumentVersion{}
	cur := map[string]string{}
	for _, v := range versions {
		byType[v.DocumentTypeCode] = append(byType[v.DocumentTypeCode], v)
		if v.SupersededAt == nil {
			cur[v.DocumentTypeCode] = v.ReviewStatus
		}
	}
	required := req[sub.TxType]
	for _, t := range types {
		hist := byType[t.Code]
		isReq := slices.Contains(required, t.Code)
		if !t.Active && len(hist) == 0 && !isReq {
			continue
		}
		slot := DocumentSlot{DocumentTypeCode: t.Code, Name: t.Name, Required: isReq, Status: domain.DocMissing, History: []DocumentVersion{}}
		for i := range hist {
			if hist[i].SupersededAt == nil {
				slot.Current, slot.Status = &hist[i], hist[i].ReviewStatus
			} else {
				slot.History = append(slot.History, hist[i])
			}
		}
		out.Slots = append(out.Slots, slot)
	}
	slices.SortStableFunc(out.Slots, func(a, b DocumentSlot) int {
		if a.Required != b.Required {
			if a.Required {
				return -1
			}
			return 1
		}
		return 0
	})
	out.Blockers = domain.DocumentBlockers(required, cur)
	out.Complete = len(out.Blockers) == 0
	return out, nil
}

// EmployeeDocuments lists every validation subject of one personnel with its documents.
func (s *Service) EmployeeDocuments(ctx context.Context, p *access.Principal, employeeID string) ([]SubjectDocuments, error) {
	if err := require(p, access.ViewEmployee); err != nil {
		return nil, err
	}
	if _, err := s.visibleEmployee(ctx, s.Pool, p, employeeID, false); err != nil {
		return nil, err
	}
	types, req, err := loadCatalog(ctx, s.Pool)
	if err != nil {
		return nil, err
	}
	subjects := []docSubject{}
	for _, st := range []string{SubjectPersonnel, SubjectEntry} {
		sub, err := loadSubject(ctx, s.Pool, st, employeeID, false)
		if err != nil {
			return nil, err
		}
		subjects = append(subjects, sub)
	}
	rows, err := s.Pool.Query(ctx, `SELECT id FROM change_requests WHERE personnel_id = $1 ORDER BY (status = 'VALIDATED'), created_at DESC`, employeeID)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		sub, err := loadSubject(ctx, s.Pool, SubjectChangeRequest, id, false)
		if err != nil {
			return nil, err
		}
		if sub.visibleTo(p) {
			subjects = append(subjects, sub)
		}
	}
	out := []SubjectDocuments{}
	for _, sub := range subjects {
		d, err := s.subjectDocuments(ctx, s.Pool, sub, types, req)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, nil
}

// Content sniffing (never the client's extension or Content-Type alone).
var docExtensions = map[string][]string{"application/pdf": {".pdf"}, "image/jpeg": {".jpg", ".jpeg"}, "image/png": {".png"}}

func SniffDocument(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte("%PDF-")):
		return "application/pdf"
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		return "image/jpeg"
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	}
	return ""
}

// safeFileName keeps a display-only name: base name, no control characters, ≤ 120 runes.
func safeFileName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '"' {
			return -1
		}
		return r
	}, name)
	if r := []rune(name); len(r) > 120 {
		name = string(r[len(r)-120:])
	}
	if name == "" || name == "." || name == "/" {
		name = "dokumen"
	}
	return name
}

type UploadInput struct {
	SubjectType, SubjectID, DocumentType, FileName string
	Data                                           []byte
}

// UploadDocument stores a new version. It never approves anything: the new version is
// PENDING_REVIEW and the previous current version (whatever its decision) is superseded.
func (s *Service) UploadDocument(ctx context.Context, a Actor, in UploadInput) (*DocumentVersion, error) {
	p := a.P
	if err := require(p, access.UploadDocuments); err != nil {
		return nil, err
	}
	if s.Store == nil {
		return nil, httpx.NewError(503, "STORAGE_UNAVAILABLE", "Penyimpanan dokumen belum dikonfigurasi.")
	}
	fe := httpx.FieldErrors{}
	if len(in.Data) == 0 {
		fe.Add("file", "File kosong.")
	}
	if len(in.Data) > s.DocMaxBytes {
		return nil, httpx.NewError(413, "PAYLOAD_TOO_LARGE", fmt.Sprintf("Ukuran file melebihi batas %d MB.", s.DocMaxBytes>>20))
	}
	mime := SniffDocument(in.Data)
	name := safeFileName(in.FileName)
	ext := strings.ToLower(filepath.Ext(name))
	switch {
	case len(in.Data) == 0:
	case mime == "" || !slices.Contains(s.DocAllowedTypes, mime):
		fe.Add("file", "Tipe file tidak diizinkan. Gunakan "+strings.Join(s.allowedExtensions(), ", ")+".")
	case !slices.Contains(docExtensions[mime], ext):
		fe.Add("file", "Ekstensi file tidak sesuai dengan isi file ("+mime+").")
	}
	if err := fe.Err(); err != nil {
		return nil, err
	}
	// Cheap pre-check before writing to storage (re-checked under lock below).
	if _, err := s.uploadTarget(ctx, s.Pool, p, in, false); err != nil {
		return nil, err
	}
	key, err := storage.NewKey()
	if err != nil {
		return nil, err
	}
	if err := s.Store.Put(ctx, key, bytes.NewReader(in.Data)); err != nil {
		s.Log.Error("document storage put failed", "err", err) // never log content or file name
		return nil, httpx.NewError(503, "STORAGE_FAILED", "File gagal disimpan. Coba lagi.")
	}
	sum := sha256.Sum256(in.Data)
	var out DocumentVersion
	err = s.tx(ctx, func(tx pgx.Tx) error {
		sub, err := s.uploadTarget(ctx, tx, p, in, true)
		if err != nil {
			return err
		}
		now := s.now()
		var prevID *string
		next := 1
		if err := tx.QueryRow(ctx, `SELECT id, version + 1 FROM document_versions WHERE subject_type=$1 AND subject_id=$2 AND document_type_code=$3 AND superseded_at IS NULL FOR UPDATE`,
			sub.Type, sub.ID, in.DocumentType).Scan(&prevID, &next); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		id := newID("doc")
		if prevID != nil {
			if _, err := tx.Exec(ctx, `UPDATE document_versions SET superseded_at = $2 WHERE id = $1`, *prevID, now); err != nil {
				return err
			}
		}
		rows, err := tx.Query(ctx, `INSERT INTO document_versions (id, subject_type, subject_id, transaction_type, personnel_id, document_type_code, version, storage_key, original_name, content_type, size_bytes, sha256, uploaded_by, uploaded_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING `+versionCols,
			id, sub.Type, sub.ID, sub.TxType, sub.PersonnelID, in.DocumentType, next, key, name, mime, len(in.Data), hex.EncodeToString(sum[:]), p.UserID, now)
		if err != nil {
			return err
		}
		if out, err = pgx.CollectExactlyOneRow(rows, scanVersion); err != nil {
			return err
		}
		if prevID != nil {
			if _, err := tx.Exec(ctx, `UPDATE document_versions SET superseded_by = $2 WHERE id = $1`, *prevID, id); err != nil {
				return err
			}
		}
		return s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "document.upload", EntityType: "document_version", EntityID: id, PersonnelID: &sub.PersonnelID, AreaID: sub.AreaID,
			Details: map[string]any{"subjectType": sub.Type, "subjectId": sub.ID, "documentType": in.DocumentType, "version": next, "replaces": prevID, "sizeBytes": len(in.Data), "contentType": mime}})
	})
	if err != nil {
		// The version row was not written: remove the stored file so it is not orphaned.
		if derr := s.Store.Delete(context.WithoutCancel(ctx), key); derr != nil {
			s.Log.Error("document storage cleanup failed", "err", derr)
		}
		return nil, err
	}
	return &out, nil
}

func (s *Service) allowedExtensions() []string {
	var out []string
	for _, t := range s.DocAllowedTypes {
		out = append(out, docExtensions[t]...)
	}
	return out
}

func (s *Service) uploadTarget(ctx context.Context, q db.Querier, p *access.Principal, in UploadInput, forUpdate bool) (docSubject, error) {
	sub, err := s.visibleSubject(ctx, q, p, in.SubjectType, in.SubjectID, forUpdate)
	if err != nil {
		return sub, err
	}
	if sub.locked() {
		return sub, httpx.Conflict("INVALID_STATE", "Pengajuan sudah divalidasi; dokumennya tidak dapat diubah.")
	}
	var active bool
	if err := q.QueryRow(ctx, `SELECT active FROM document_types WHERE code = $1`, in.DocumentType).Scan(&active); err != nil || !active {
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return sub, err
		}
		return sub, httpx.Validation(map[string]string{"documentType": "Jenis dokumen tidak dikenal atau tidak aktif."})
	}
	return sub, nil
}

type DocumentReview struct {
	Status string `json:"status"`
	Note   string `json:"note"`
}

// ReviewDocument records the decision for the current pending version (final per version;
// a wrong decision is corrected by uploading a new version).
func (s *Service) ReviewDocument(ctx context.Context, a Actor, versionID string, in DocumentReview) (*DocumentVersion, error) {
	p := a.P
	if err := require(p, access.ReviewDocuments); err != nil {
		return nil, err
	}
	in.Note = strings.TrimSpace(in.Note)
	fe := httpx.FieldErrors{}
	switch in.Status {
	case domain.DocAccepted, domain.DocRejected:
	default:
		fe.Add("status", "Keputusan harus ACCEPTED atau REJECTED.")
	}
	if in.Status == domain.DocRejected && in.Note == "" {
		fe.Add("note", "Alasan penolakan wajib diisi agar pengaju dapat memperbaiki dokumen.")
	}
	if err := fe.Err(); err != nil {
		return nil, err
	}
	var out DocumentVersion
	err := s.tx(ctx, func(tx pgx.Tx) error {
		var subType, subID, docType, uploader string
		var superseded *time.Time
		var status string
		err := tx.QueryRow(ctx, `SELECT subject_type, subject_id, document_type_code, uploaded_by, superseded_at, review_status FROM document_versions WHERE id = $1 FOR UPDATE`, versionID).
			Scan(&subType, &subID, &docType, &uploader, &superseded, &status)
		if err != nil {
			return notFoundOr(err, "Dokumen")
		}
		sub, err := s.visibleSubject(ctx, tx, p, subType, subID, true)
		if err != nil {
			return httpx.NotFound("Dokumen")
		}
		if sub.locked() {
			return httpx.Conflict("INVALID_STATE", "Pengajuan sudah divalidasi; dokumennya tidak dapat diperiksa ulang.")
		}
		if superseded != nil {
			return httpx.Conflict("STALE_DOCUMENT", "Versi dokumen ini sudah diganti. Periksa versi terbaru.")
		}
		if status != domain.DocPending {
			return httpx.Conflict("ALREADY_DECIDED", "Dokumen ini sudah diperiksa.")
		}
		now := s.now()
		rows, err := tx.Query(ctx, `UPDATE document_versions SET review_status=$2, review_note=$3, reviewed_by=$4, reviewed_at=$5 WHERE id = $1 RETURNING `+versionCols,
			versionID, in.Status, nullable(in.Note), p.UserID, now)
		if err != nil {
			return err
		}
		if out, err = pgx.CollectExactlyOneRow(rows, scanVersion); err != nil {
			return err
		}
		if err := s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "document.review", EntityType: "document_version", EntityID: versionID, PersonnelID: &sub.PersonnelID, AreaID: sub.AreaID,
			Details: map[string]any{"decision": in.Status, "documentType": docType}}); err != nil {
			return err
		}
		if in.Status != domain.DocRejected {
			return nil
		}
		dir, err := loadDirectory(ctx, tx)
		if err != nil {
			return err
		}
		recips := append(dir.exists(uploader), dir.exists(sub.CreatedBy)...)
		return emit(ctx, tx, now, spec{DedupeBase: "document-rejected:" + versionID, Recipients: recips, Category: "DOCUMENT", Severity: "warning",
			Title: "Dokumen perlu diperbaiki", Message: fmt.Sprintf("Dokumen %s ditolak: %s", docType, in.Note), Actor: p.UserID,
			EntityType: "employee", EntityID: sub.PersonnelID, AreaID: sub.AreaID, Target: &NotificationTarget{Kind: "employee", ID: sub.PersonnelID}, RequiresAction: true})
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

type DocumentFile struct {
	Name, ContentType string
	Size              int64
	Body              io.ReadCloser
}

// OpenDocument streams a stored file after permission and scope checks.
func (s *Service) OpenDocument(ctx context.Context, a Actor, versionID string) (*DocumentFile, error) {
	p := a.P
	if err := require(p, access.ViewEmployee); err != nil {
		return nil, err
	}
	if err := requireAny(p, access.UploadDocuments, access.ReviewDocuments); err != nil {
		return nil, err
	}
	if s.Store == nil {
		return nil, httpx.NewError(503, "STORAGE_UNAVAILABLE", "Penyimpanan dokumen belum dikonfigurasi.")
	}
	var subType, subID, key string
	f := &DocumentFile{}
	err := s.Pool.QueryRow(ctx, `SELECT subject_type, subject_id, storage_key, original_name, content_type, size_bytes FROM document_versions WHERE id = $1`, versionID).
		Scan(&subType, &subID, &key, &f.Name, &f.ContentType, &f.Size)
	if err != nil {
		return nil, notFoundOr(err, "Dokumen")
	}
	sub, err := s.visibleSubject(ctx, s.Pool, p, subType, subID, false)
	if err != nil {
		return nil, httpx.NotFound("Dokumen")
	}
	body, err := s.Store.Open(ctx, key)
	if errors.Is(err, storage.ErrNotFound) {
		s.Log.Error("document file missing", "version_id", versionID)
		return nil, httpx.NotFound("File dokumen")
	}
	if err != nil {
		return nil, err
	}
	f.Body = body
	if err := s.tx(ctx, func(tx pgx.Tx) error {
		return s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "document.download", EntityType: "document_version", EntityID: versionID, PersonnelID: &sub.PersonnelID, AreaID: sub.AreaID})
	}); err != nil {
		body.Close()
		return nil, err
	}
	return f, nil
}

// SweepOrphanDocuments deletes stored files that no version row references and that are
// older than the grace period (e.g. a crash between storage write and DB commit).
// Referenced files — including superseded versions kept as history — are never deleted.
func (s *Service) SweepOrphanDocuments(ctx context.Context, grace time.Duration) (int, error) {
	if s.Store == nil {
		return 0, nil
	}
	keys, err := s.Store.List(ctx, s.Clock().Add(-grace))
	if err != nil || len(keys) == 0 {
		return 0, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT storage_key FROM document_versions WHERE storage_key = ANY($1)`, keys)
	if err != nil {
		return 0, err
	}
	used, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return 0, err
	}
	n := 0
	for _, k := range keys {
		if slices.Contains(used, k) {
			continue
		}
		if err := s.Store.Delete(ctx, k); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

// --- Queue and dashboard summary ---------------------------------------------------

type DocumentQueueItem struct {
	SubjectType     string     `json:"subjectType"`
	SubjectID       string     `json:"subjectId"`
	TransactionType string     `json:"transactionType"`
	SubjectStatus   string     `json:"subjectStatus"`
	EmployeeID      string     `json:"employeeId"`
	PersonnelID     string     `json:"personnelId"`
	Name            string     `json:"name"`
	AreaID          *string    `json:"areaId"`
	SubmittedAt     *time.Time `json:"submittedAt"`
	RequiredTotal   int        `json:"requiredTotal"`
	RequiredOK      int        `json:"requiredAccepted"`
	Missing         int        `json:"missing"`
	PendingReview   int        `json:"pendingReview"` // documents (current versions), required or optional
	Rejected        int        `json:"rejected"`
	Complete        bool       `json:"complete"`
}

type DocumentSummary struct {
	// Submissions (SUBMITTED or REVISION_REQUIRED) whose required documents are not all accepted.
	IncompleteSubmissions int `json:"incompleteSubmissions"`
	// Documents (current versions) on open submissions.
	PendingReviewDocuments int `json:"pendingReviewDocuments"`
	RejectedDocuments      int `json:"rejectedDocuments"`
}

type DocumentQueue struct {
	Status  string              `json:"status"`
	Summary DocumentSummary     `json:"summary"`
	Items   []DocumentQueueItem `json:"items"`
}

func (it DocumentQueueItem) submitted() bool {
	return it.SubjectStatus == "SUBMITTED" || it.SubjectStatus == "REVISION_REQUIRED"
}

// documentQueue evaluates every open (not yet validated) subject in scope. Dashboard
// counts and the detail list are both derived from this one result.
func (s *Service) documentQueue(ctx context.Context, p *access.Principal, areaID string) ([]DocumentQueueItem, error) {
	_, req, err := loadCatalog(ctx, s.Pool)
	if err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `
		WITH subjects AS (
		  SELECT 'PERSONNEL_ENTRY' AS st, p.id AS sid, 'EMPLOYEE_ENTRY' AS tt, p.record_status AS status, p.id AS eid, p.personnel_id, p.name, p.area_id AS a1, p.area_id AS a2, p.submitted_at
		    FROM personnel p WHERE p.record_status <> 'VALIDATED'
		  UNION ALL
		  SELECT 'CHANGE_REQUEST', r.id, r.transaction_type, r.status, p.id, p.personnel_id, p.name, r.origin_area_id, r.target_area_id, r.submitted_at
		    FROM change_requests r JOIN personnel p ON p.id = r.personnel_id WHERE r.status <> 'VALIDATED'
		)
		SELECT st, sid, tt, status, eid, personnel_id, name, a1, submitted_at,
		  COALESCE((SELECT jsonb_object_agg(d.document_type_code, d.review_status) FROM document_versions d
		            WHERE d.subject_type = st AND d.subject_id = sid AND d.superseded_at IS NULL), '{}'::jsonb)
		FROM subjects
		WHERE ($1::text[] IS NULL OR a1 = ANY($1) OR a2 = ANY($1)) AND ($2 = '' OR a1 = $2 OR a2 = $2)
		ORDER BY submitted_at NULLS LAST, sid`, scopeArgs(p), areaID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DocumentQueueItem
	for rows.Next() {
		var it DocumentQueueItem
		var cur map[string]string
		if err := rows.Scan(&it.SubjectType, &it.SubjectID, &it.TransactionType, &it.SubjectStatus, &it.EmployeeID, &it.PersonnelID, &it.Name, &it.AreaID, &it.SubmittedAt, &cur); err != nil {
			return nil, err
		}
		required := req[it.TransactionType]
		blockers := domain.DocumentBlockers(required, cur)
		it.RequiredTotal, it.RequiredOK, it.Complete = len(required), len(required)-len(blockers), len(blockers) == 0
		for _, code := range required {
			if _, ok := cur[code]; !ok {
				it.Missing++
			}
		}
		for _, st := range cur {
			switch st {
			case domain.DocPending:
				it.PendingReview++
			case domain.DocRejected:
				it.Rejected++
			}
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func summarizeDocuments(items []DocumentQueueItem) DocumentSummary {
	var sum DocumentSummary
	for _, it := range items {
		if it.submitted() && !it.Complete {
			sum.IncompleteSubmissions++
		}
		sum.PendingReviewDocuments += it.PendingReview
		sum.RejectedDocuments += it.Rejected
	}
	return sum
}

// DocumentQueue lists open submissions by document state:
// INCOMPLETE (submitted, required documents not all accepted), PENDING_REVIEW, REJECTED, ALL.
func (s *Service) DocumentQueue(ctx context.Context, p *access.Principal, status, areaID string) (*DocumentQueue, error) {
	if err := require(p, access.ViewEmployee); err != nil {
		return nil, err
	}
	if status == "" {
		status = "ALL"
	}
	if !slices.Contains([]string{"ALL", "INCOMPLETE", domain.DocPending, domain.DocRejected}, status) {
		return nil, httpx.Validation(map[string]string{"status": "Status tidak dikenal. Gunakan ALL, INCOMPLETE, PENDING_REVIEW atau REJECTED."})
	}
	if areaID != "" && !p.CoversArea(&areaID) {
		return nil, httpx.Forbidden()
	}
	items, err := s.documentQueue(ctx, p, areaID)
	if err != nil {
		return nil, err
	}
	out := &DocumentQueue{Status: status, Summary: summarizeDocuments(items), Items: []DocumentQueueItem{}}
	for _, it := range items {
		keep := status == "ALL" ||
			status == "INCOMPLETE" && it.submitted() && !it.Complete ||
			status == domain.DocPending && it.PendingReview > 0 ||
			status == domain.DocRejected && it.Rejected > 0
		if keep {
			out.Items = append(out.Items, it)
		}
	}
	return out, nil
}

// --- Dashboard compliance summary --------------------------------------------------

type ContractOverview struct {
	ReminderDays []int           `json:"reminderDays"`
	Summary      ContractSummary `json:"summary"`
}

// ComplianceSummary: Contracts/Documents are null when the viewer may not see personnel data.
type ComplianceSummary struct {
	BusinessDate string            `json:"businessDate"`
	AreaID       string            `json:"areaId"`
	Contracts    *ContractOverview `json:"contracts"`
	Documents    *DocumentSummary  `json:"documents"`
	// EmployeeDocuments counts employees without an accepted PKWT (warning only).
	EmployeeDocuments *EmployeeDocumentSummary `json:"employeeDocuments"`
}

// Compliance aggregates contract and document KPIs after scope is applied. It uses the
// same functions as the detail lists, so card counts and lists always agree.
func (s *Service) Compliance(ctx context.Context, p *access.Principal, areaID string) (*ComplianceSummary, error) {
	if err := require(p, access.ViewDashboard); err != nil {
		return nil, err
	}
	if areaID != "" && !p.CoversArea(&areaID) {
		return nil, httpx.Forbidden()
	}
	out := &ComplianceSummary{BusinessDate: s.Today(), AreaID: areaID}
	if !p.Has(access.ViewEmployee) {
		return out, nil
	}
	items, st, err := s.contractStates(ctx, p, areaID, "")
	if err != nil {
		return nil, err
	}
	out.Contracts = &ContractOverview{ReminderDays: st.ReminderDays, Summary: summarizeContracts(items)}
	docs, err := s.documentQueue(ctx, p, areaID)
	if err != nil {
		return nil, err
	}
	sum := summarizeDocuments(docs)
	out.Documents = &sum
	ed, err := s.EmployeeDocumentStatus(ctx, p, areaID)
	if err != nil {
		return nil, err
	}
	out.EmployeeDocuments = &ed.EmployeeDocumentSummary
	return out, nil
}
