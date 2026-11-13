package service

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/auth"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/imports"
)

const importLockID = 727211003

type PreviewResult struct {
	PreviewID          string                  `json:"previewId"`
	ExpiresAt          time.Time               `json:"expiresAt"`
	Summary            imports.Summary         `json:"summary"`
	Status             string                  `json:"status"`
	ScopePreview       imports.ScopePreview    `json:"scopePreview"`
	DiscoveredAreas    []imports.RefArea       `json:"discoveredAreas"`
	DiscoveredProjects []imports.RefProject    `json:"discoveredProjects"`
	Warnings           []imports.FieldIssue    `json:"warnings"`
	WarningsTotal      int                     `json:"warningsTotal"`
	Exceptions         []imports.ExceptionPlan `json:"exceptions"`
	ReviewItems        []ReviewPreview         `json:"reviewItems"`
}

const previewWarningLimit = 5000

type ReviewPreview struct {
	ID            string   `json:"id"`
	Kind          string   `json:"kind"`
	PersonnelID   string   `json:"personnelId"`
	PersonnelName string   `json:"personnelName"`
	Reason        string   `json:"reason"`
	RowNumbers    []int    `json:"rowNumbers"`
	Aspects       []string `json:"aspects"`
}

func scopeSignature(p *access.Principal) string {
	ids := p.AllowedAreaIDs()
	sort.Strings(ids)
	return fmt.Sprintf("%s|%s|%v|%s|%t", p.UserID, p.Config.Scope, p.AllAreas(), strings.Join(ids, ","), p.Has(access.ImportPersonnel))
}

func gz(v any) ([]byte, error) {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func ungz(data []byte, v any) error {
	r, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return err
	}
	defer r.Close()
	return json.NewDecoder(io.LimitReader(r, 512<<20)).Decode(v)
}

func fieldsFromJSON(raw []byte) imports.Fields {
	f := imports.Fields{}
	_ = json.Unmarshal(raw, &f)
	return f
}

// masterFields mirrors storedToFields: profile keys plus the core personnel fields.
func masterFields(e domain.Employee, profile map[string]any) imports.Fields {
	f := imports.Fields{}
	for k, v := range profile {
		if s, ok := v.(string); ok {
			f[k] = &s
		} else if v == nil {
			f[k] = nil
		}
	}
	pid, name := e.PersonnelID, e.Name
	f["personnelId"], f["name"] = &pid, &name
	f["subArea"], f["position"], f["joinDate"] = e.SubArea, e.Position, e.JoinDate
	f["contractStartDate"], f["contractEndDate"] = e.ContractStartDate, e.ContractEndDate
	return f
}

// loadExisting reads the state reconciliation depends on, plus a signature of it.
func (s *Service) loadExisting(ctx context.Context, q db.Querier, keys []string) (imports.Existing, string, error) {
	ex := imports.Existing{Masters: map[string]imports.ExistingMaster{}, Sources: map[string][]imports.ExistingSource{}, Reviews: map[string]imports.ExistingReview{}}
	h := sha256.New()
	rows, err := q.Query(ctx, employeeSelect+` WHERE p.business_key = ANY($1) ORDER BY p.business_key`, keys)
	if err != nil {
		return ex, "", err
	}
	emps, err := collectEmployees(rows, true)
	if err != nil {
		return ex, "", err
	}
	for _, e := range emps {
		key := imports.BusinessKey(e.PersonnelID)
		ex.Masters[key] = imports.ExistingMaster{ID: e.ID, BusinessKey: key, AreaID: e.AreaID, Fields: masterFields(e, e.Profile), Version: e.Version}
		fmt.Fprintf(h, "m:%s:%d:%s;", key, e.Version, deref(e.AreaID))
	}
	srows, err := q.Query(ctx, `SELECT id, business_key, fingerprint, row_number, fields FROM import_source_records WHERE business_key = ANY($1) ORDER BY id`, keys)
	if err != nil {
		return ex, "", err
	}
	for srows.Next() {
		var src imports.ExistingSource
		var fields []byte
		if err := srows.Scan(&src.ID, &src.BusinessKey, &src.Fingerprint, &src.RowNumber, &fields); err != nil {
			srows.Close()
			return ex, "", err
		}
		src.Fields = fieldsFromJSON(fields)
		ex.Sources[src.BusinessKey] = append(ex.Sources[src.BusinessKey], src)
		fmt.Fprintf(h, "s:%s;", src.ID)
	}
	srows.Close()
	rrows, err := q.Query(ctx, `SELECT id, status, updated_at FROM import_review_items WHERE business_key = ANY($1) ORDER BY id`, keys)
	if err != nil {
		return ex, "", err
	}
	for rrows.Next() {
		var r imports.ExistingReview
		var updated time.Time
		if err := rrows.Scan(&r.ID, &r.Status, &updated); err != nil {
			rrows.Close()
			return ex, "", err
		}
		ex.Reviews[r.ID] = r
		fmt.Fprintf(h, "r:%s:%s:%d;", r.ID, r.Status, updated.UnixNano())
	}
	rrows.Close()
	if err := q.QueryRow(ctx, `SELECT count(*) FROM import_review_items WHERE status IN ('PENDING','KEPT_PENDING') AND NOT (business_key = ANY($1))`, keys).Scan(&ex.OtherPendingReviews); err != nil {
		return ex, "", err
	}
	arows, err := q.Query(ctx, `SELECT id, name FROM areas ORDER BY id`)
	if err != nil {
		return ex, "", err
	}
	for arows.Next() {
		var a imports.RefArea
		if err := arows.Scan(&a.ID, &a.Name); err != nil {
			arows.Close()
			return ex, "", err
		}
		ex.Areas = append(ex.Areas, a)
		fmt.Fprintf(h, "a:%s:%s;", a.ID, a.Name)
	}
	arows.Close()
	prows, err := q.Query(ctx, `SELECT id, name, client_name, area_id, sub_area FROM projects ORDER BY id`)
	if err != nil {
		return ex, "", err
	}
	for prows.Next() {
		var pr imports.RefProject
		if err := prows.Scan(&pr.ID, &pr.Name, &pr.ClientName, &pr.AreaID, &pr.SubArea); err != nil {
			prows.Close()
			return ex, "", err
		}
		ex.Projects = append(ex.Projects, pr)
		fmt.Fprintf(h, "p:%s:%s:%s;", pr.ID, pr.Name, pr.AreaID)
	}
	prows.Close()
	fmt.Fprintf(h, "o:%d", ex.OtherPendingReviews)
	return ex, hex.EncodeToString(h.Sum(nil)), nil
}

func parsedKeys(parsed *imports.ParseResult) []string {
	seen := map[string]bool{}
	keys := []string{}
	for _, r := range parsed.Records {
		if !seen[r.BusinessKey] {
			seen[r.BusinessKey] = true
			keys = append(keys, r.BusinessKey)
		}
	}
	sort.Strings(keys)
	return keys
}

type stagedPlan struct {
	Plan *imports.Plan `json:"plan"`
	Keys []string      `json:"keys"`
}

// PreviewImport parses and reconciles on the server and stages the plan. Nothing
// in master data, references or effective conditions changes.
func (s *Service) PreviewImport(ctx context.Context, a Actor, fileName string, data []byte) (*PreviewResult, error) {
	p := a.P
	if err := require(p, access.ImportPersonnel); err != nil {
		return nil, err
	}
	if !strings.HasSuffix(strings.ToLower(fileName), ".xlsx") {
		return nil, httpx.Validation(map[string]string{"file": "Format .xls tidak didukung. Simpan ulang workbook sebagai .xlsx lalu coba lagi."})
	}
	select {
	case s.importSlots <- struct{}{}:
		defer func() { <-s.importSlots }()
	default:
		return nil, httpx.NewError(429, "IMPORT_BUSY", "Server sedang memproses impor lain. Coba beberapa saat lagi.")
	}
	wb, err := imports.ReadWorkbook(data, s.ImportMaxRows)
	if err != nil {
		return nil, importError(err)
	}
	parsed, err := imports.Parse(wb)
	if err != nil {
		return nil, importError(err)
	}
	if len(parsed.Records)+len(parsed.Exceptions) > s.ImportMaxRows {
		return nil, httpx.Validation(map[string]string{"file": fmt.Sprintf("Jumlah baris melebihi batas %d.", s.ImportMaxRows)})
	}
	keys := parsedKeys(parsed)
	ex, sig, err := s.loadExisting(ctx, s.Pool, keys)
	if err != nil {
		return nil, err
	}
	batchID := newID("batch")
	plan := imports.Reconcile(ex, parsed, imports.Options{BatchID: batchID, FileName: fileName, CreatedBy: p.UserID, AllowedAreaIDs: scopeArgs(p)})
	token, err := auth.NewToken()
	if err != nil {
		return nil, err
	}
	blob, err := gz(stagedPlan{Plan: plan, Keys: keys})
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(data)
	now := s.now()
	expires := now.Add(s.ImportPreviewTTL)
	if _, err := s.Pool.Exec(ctx, `DELETE FROM import_previews WHERE expires_at < $1 AND committed_batch_id IS NULL`, now); err != nil {
		return nil, err
	}
	if _, err := s.Pool.Exec(ctx, `INSERT INTO import_previews (id, user_id, file_name, file_sha256, scope_signature, data_signature, plan_gz, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		hex.EncodeToString(auth.HashToken(token)), p.UserID, fileName, hex.EncodeToString(sum[:]), scopeSignature(p), sig, blob, expires, now); err != nil {
		return nil, err
	}
	res := &PreviewResult{PreviewID: token, ExpiresAt: expires, Summary: plan.Summary, Status: plan.Status, ScopePreview: plan.ScopePreview,
		DiscoveredAreas: nonNilSlice(plan.NewAreas), DiscoveredProjects: nonNilSlice(plan.NewProjects), Warnings: []imports.FieldIssue{}, Exceptions: nonNilSlice(plan.Exceptions), ReviewItems: []ReviewPreview{}}
	// Warnings are shown (row + column) before the user confirms; the list is capped to
	// bound the response, and WarningsTotal tells the UI when it is truncated.
	for _, src := range plan.Sources {
		res.WarningsTotal += len(src.Warnings)
		for _, w := range src.Warnings {
			if len(res.Warnings) < previewWarningLimit {
				res.Warnings = append(res.Warnings, w)
			}
		}
	}
	for _, r := range plan.Reviews {
		if len(res.ReviewItems) < 500 {
			res.ReviewItems = append(res.ReviewItems, ReviewPreview{ID: r.ID, Kind: r.Kind, PersonnelID: r.PersonnelID, PersonnelName: r.PersonnelName, Reason: r.Reason, RowNumbers: r.RowNumbers, Aspects: r.Aspects})
		}
	}
	return res, nil
}

func nonNilSlice[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func importError(err error) error {
	var ab *imports.AbortError
	if errors.As(err, &ab) {
		return &httpx.Error{Status: 422, Code: "IMPORT_REJECTED", Message: ab.Message}
	}
	return err
}

type CommitResult struct {
	BatchID string          `json:"batchId"`
	Status  string          `json:"status"`
	Summary imports.Summary `json:"summary"`
	Replay  bool            `json:"replay"`
}

// CancelImport discards a staged preview. Business data is untouched.
func (s *Service) CancelImport(ctx context.Context, p *access.Principal, token string) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM import_previews WHERE id = $1 AND user_id = $2 AND committed_batch_id IS NULL`, hex.EncodeToString(auth.HashToken(token)), p.UserID)
	return err
}

// CommitImport applies a staged plan atomically (one transaction). It is idempotent:
// committing the same preview twice returns the original batch.
func (s *Service) CommitImport(ctx context.Context, a Actor, token string) (*CommitResult, error) {
	p := a.P
	if err := require(p, access.ImportPersonnel); err != nil {
		return nil, err
	}
	var result *CommitResult
	err := s.tx(ctx, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", importLockID); err != nil {
			return err
		}
		var blob []byte
		var scopeSig, dataSig string
		var committed *string
		var expires time.Time
		err := tx.QueryRow(ctx, `SELECT plan_gz, scope_signature, data_signature, committed_batch_id, expires_at FROM import_previews WHERE id = $1 AND user_id = $2 FOR UPDATE`,
			hex.EncodeToString(auth.HashToken(token)), p.UserID).Scan(&blob, &scopeSig, &dataSig, &committed, &expires)
		if errors.Is(err, pgx.ErrNoRows) {
			return httpx.NotFound("Preview impor")
		}
		if err != nil {
			return err
		}
		if committed != nil {
			var status string
			var summary []byte
			if err := tx.QueryRow(ctx, `SELECT status, summary FROM import_batches WHERE id = $1`, *committed).Scan(&status, &summary); err != nil {
				return err
			}
			result = &CommitResult{BatchID: *committed, Status: status, Replay: true}
			return json.Unmarshal(summary, &result.Summary)
		}
		if s.now().After(expires) {
			return httpx.NewError(410, "PREVIEW_EXPIRED", "Preview sudah kedaluwarsa. Pilih ulang file untuk membuat preview baru.")
		}
		if scopeSig != scopeSignature(p) {
			return httpx.Conflict("SCOPE_CHANGED", "Cakupan Area berubah sejak preview dibuat. Pilih ulang file agar data divalidasi dengan scope terbaru.")
		}
		var staged stagedPlan
		if err := ungz(blob, &staged); err != nil {
			return err
		}
		_, sig, err := s.loadExisting(ctx, tx, staged.Keys)
		if err != nil {
			return err
		}
		if sig != dataSig {
			return httpx.Conflict("PREVIEW_STALE", "Preview sudah kedaluwarsa karena data berubah. Parse ulang file sebelum konfirmasi.")
		}
		if err := s.applyPlan(ctx, tx, a, staged.Plan); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE import_previews SET committed_batch_id = $2, plan_gz = ''::bytea WHERE id = $1`, hex.EncodeToString(auth.HashToken(token)), staged.Plan.BatchID); err != nil {
			return err
		}
		result = &CommitResult{BatchID: staged.Plan.BatchID, Status: staged.Plan.Status, Summary: staged.Plan.Summary}
		return nil
	})
	return result, err
}

func (s *Service) applyPlan(ctx context.Context, tx pgx.Tx, a Actor, plan *imports.Plan) error {
	p := a.P
	now := s.now()
	for _, ar := range plan.NewAreas {
		if _, err := tx.Exec(ctx, `INSERT INTO areas (id, name, name_key, created_at) VALUES ($1,$2,$3,$4)`, ar.ID, ar.Name, imports.NameKey(ar.Name), now); err != nil {
			return err
		}
	}
	for _, pr := range plan.NewProjects {
		if _, err := tx.Exec(ctx, `INSERT INTO projects (id, name, name_key, client_name, area_id, sub_area, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$7)`,
			pr.ID, pr.Name, imports.NameKey(pr.Name), pr.ClientName, pr.AreaID, pr.SubArea, now); err != nil {
			return err
		}
	}
	summary, _ := json.Marshal(plan.Summary)
	var scope []string
	if !p.AllAreas() {
		scope = p.AllowedAreaIDs()
	}
	if _, err := tx.Exec(ctx, `INSERT INTO import_batches (id, file_name, sheet_name, status, summary, scope_area_ids, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		plan.BatchID, plan.FileName, plan.SheetName, plan.Status, summary, scope, p.UserID, now); err != nil {
		return err
	}
	for _, m := range plan.Masters {
		profile, _ := json.Marshal(m.Profile)
		if _, err := tx.Exec(ctx, `INSERT INTO personnel (id, personnel_id, business_key, name, national_id, profile, area_id, sub_area, project_id, position, employment_status, condition_status,
			join_date, contract_start_date, contract_end_date, contract_status, record_status, submitted_at, source, import_batch_id, import_fingerprint, created_by, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'NOT_AVAILABLE','SUBMITTED',$16,'IMPORT',$17,$18,$19,$16,$16)`,
			m.ID, m.PersonnelID, m.BusinessKey, m.Name, m.NationalID, profile, m.AreaID, m.SubArea, m.ProjectID, m.Position, m.Employment, m.ConditionStatus,
			m.JoinDate, m.ContractStart, m.ContractEnd, now, plan.BatchID, m.Fingerprint, p.UserID); err != nil {
			return err
		}
		closed := m.Employment == "INACTIVE"
		var end *string
		if closed && m.ExitDate != nil && (m.JoinDate == nil || *m.ExitDate >= *m.JoinDate) {
			end = m.ExitDate
		}
		periodID := newID("period")
		if _, err := tx.Exec(ctx, `INSERT INTO employment_periods (id, personnel_id, start_date, end_date, end_reason, start_kind, closed, created_by, created_at) VALUES ($1,$2,$3,$4,$5,'IMPORT',$6,$7,$8)`,
			periodID, m.ID, m.JoinDate, end, m.ExitReason, closed, p.UserID, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO placements (id, personnel_id, period_id, area_id, project_id, position, sub_area, effective_from, effective_to, closed, source, source_ref, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'IMPORT',$11,$12)`,
			newID("plc"), m.ID, periodID, m.AreaID, m.ProjectID, m.Position, m.SubArea, m.JoinDate, end, closed, plan.BatchID, now); err != nil {
			return err
		}
	}
	for _, src := range plan.Sources {
		raw, _ := json.Marshal(src.Raw)
		fields, _ := json.Marshal(src.Fields)
		structured, _ := json.Marshal(src.Structured)
		warnings, _ := json.Marshal(nonNilSlice(src.Warnings))
		if _, err := tx.Exec(ctx, `INSERT INTO import_source_records (id, business_key, personnel_id, name, batch_id, file_name, sheet_name, row_number, raw, fields, structured, fingerprint, fingerprint_version, warnings, reconciliation_status, area_id, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO NOTHING`,
			src.ID, src.BusinessKey, src.PersonnelID, src.Name, plan.BatchID, plan.FileName, plan.SheetName, src.RowNumber, raw, fields, structured, src.Fingerprint, imports.FingerprintVersion, warnings, src.ReconciliationStatus, src.AreaID, now); err != nil {
			return err
		}
	}
	for _, r := range plan.Reviews {
		if r.Preserve {
			if _, err := tx.Exec(ctx, `UPDATE import_review_items SET record_ids = $2, row_numbers = $3, diff_fields = $4, updated_at = $5 WHERE id = $1`, r.ID, r.RecordIDs, r.RowNumbers, nonNilSlice(r.DiffFields), now); err != nil {
				return err
			}
			continue
		}
		current, _ := json.Marshal(r.CurrentMasterFields)
		if r.CurrentMasterFields == nil {
			current = nil
		}
		dates, _ := json.Marshal(nonNilSlice(r.Dates))
		cand, _ := json.Marshal(r.Candidate)
		if _, err := tx.Exec(ctx, `INSERT INTO import_review_items (id, business_key, personnel_id, personnel_name, kind, aspects, area_id, record_ids, current_master_fields, diff_fields, dates, row_numbers, reason, candidate, status, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDING',$15,$15)
			ON CONFLICT (id) DO UPDATE SET record_ids = EXCLUDED.record_ids, row_numbers = EXCLUDED.row_numbers, diff_fields = EXCLUDED.diff_fields, dates = EXCLUDED.dates,
			  reason = EXCLUDED.reason, candidate = EXCLUDED.candidate, current_master_fields = EXCLUDED.current_master_fields, updated_at = EXCLUDED.updated_at`,
			r.ID, r.BusinessKey, r.PersonnelID, r.PersonnelName, r.Kind, nonNilSlice(r.Aspects), r.AreaID, r.RecordIDs, current, nonNilSlice(r.DiffFields), dates, nonNilSlice(r.RowNumbers), r.Reason, cand, now); err != nil {
			return err
		}
	}
	for _, e := range plan.Exceptions {
		raw, _ := json.Marshal(e.RawValues)
		if _, err := tx.Exec(ctx, `INSERT INTO import_exceptions (id, batch_id, row_number, reason, raw_values, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, e.ID, plan.BatchID, e.RowNumber, e.Reason, raw, now); err != nil {
			return err
		}
	}
	sm := plan.Summary
	if err := s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "import.commit", EntityType: "import_batch", EntityID: plan.BatchID,
		Details: map[string]any{"status": plan.Status, "newMasters": sm.NewMasters, "newSourceRecords": sm.NewSourceRecords, "pendingReviewItems": sm.PendingReviewItems, "exceptionRows": sm.ExceptionRows}}); err != nil {
		return err
	}
	sev, title := "success", "Impor Excel berhasil"
	if plan.Status == "COMPLETED_WITH_EXCEPTIONS" || plan.Status == "COMPLETED_WITH_WARNINGS" {
		sev, title = "warning", "Impor Excel selesai dengan catatan"
	}
	msg := fmt.Sprintf("%s: %d personil baru, %d catatan riwayat, %d perlu ditinjau, %d kejadian terkonfirmasi", plan.FileName, sm.NewMasters, sm.NewSourceRecords, sm.PendingReviewItems, sm.ConfirmedEvents)
	if sm.ExceptionRows > 0 {
		msg += fmt.Sprintf(", %d perlu diperbaiki", sm.ExceptionRows)
	}
	msg += ". (Jumlah baris ≠ jumlah personil.)"
	if err := emit(ctx, tx, now, spec{DedupeBase: "import:" + plan.BatchID, Recipients: []string{p.UserID}, Category: "IMPORT", Severity: sev, Title: title, Message: msg,
		Actor: p.UserID, EntityType: "import", EntityID: plan.BatchID, Target: &NotificationTarget{Kind: "route", Route: "/import"}}); err != nil {
		return err
	}
	if sm.PendingReviewItems > 0 {
		return emit(ctx, tx, now, spec{DedupeBase: "import-review:" + plan.BatchID, Recipients: []string{p.UserID}, Category: "IMPORT", Severity: "warning", Title: "Data riwayat perlu ditinjau",
			Message: fmt.Sprintf("%s: %d catatan riwayat personil perlu ditinjau (kandidat mutasi/exit/konflik). Belum ada perubahan status yang dikonfirmasi.", plan.FileName, sm.PendingReviewItems),
			Actor:   p.UserID, EntityType: "import", EntityID: plan.BatchID, Target: &NotificationTarget{Kind: "route", Route: "/import"}})
	}
	return nil
}
