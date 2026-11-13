package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/imports"
)

type EntryInput struct {
	PersonnelID       string  `json:"personnelId"`
	Name              string  `json:"name"`
	AreaID            *string `json:"areaId"`
	ProjectID         *string `json:"projectId"`
	Position          *string `json:"position"`
	SubArea           *string `json:"subArea"`
	JoinDate          *string `json:"joinDate"`
	ContractStartDate *string `json:"contractStartDate"`
	ContractEndDate   *string `json:"contractEndDate"`
	ContractStatus    string  `json:"contractStatus"`
	BPJSStatus        *string `json:"bpjsStatus"`
	// Physical measurements (text as typed; validated by domain.ParseMeasurement).
	// Absent fields keep the stored value; null or "" clears it.
	Height          OptionalText `json:"height"`
	Weight          OptionalText `json:"weight"`
	Submit          bool         `json:"submit"`
	ExpectedVersion *int         `json:"expectedVersion"`
	profilePatch    map[string]any
}

// OptionalText distinguishes an absent JSON field from an explicit null/empty value.
// Numbers are accepted as their literal text so validation can report them precisely.
type OptionalText struct {
	Set   bool
	Value *string
}

func (o *OptionalText) UnmarshalJSON(b []byte) error {
	o.Set = true
	switch {
	case string(b) == "null":
		o.Value = nil
		return nil
	case len(b) > 0 && b[0] != '"':
		var n json.Number
		if err := json.Unmarshal(b, &n); err != nil {
			return err
		}
		v := n.String()
		o.Value = &v
		return nil
	}
	var v string
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	o.Value = &v
	return nil
}

// validateMeasures fills profilePatch with canonical values ("60.5 kg"); nil clears a key.
func (in *EntryInput) validateMeasures(fe httpx.FieldErrors) {
	in.profilePatch = map[string]any{}
	for _, m := range []struct {
		key  string
		val  OptionalText
		spec domain.MeasureSpec
	}{{"height", in.Height, domain.HeightSpec}, {"weight", in.Weight, domain.WeightSpec}} {
		if !m.val.Set {
			continue
		}
		raw := ""
		if m.val.Value != nil {
			raw = *m.val.Value
		}
		v, msg := domain.ParseMeasurement(raw, m.spec)
		if msg != "" {
			fe.Add(m.key, msg)
			continue
		}
		if v == nil {
			in.profilePatch[m.key] = nil
		} else {
			in.profilePatch[m.key] = *v + " " + m.spec.Unit
		}
	}
}

// profilePatchSQL splits a patch into keys to remove and a JSON object to merge.
func profilePatchSQL(patch map[string]any) ([]string, []byte) {
	remove := []string{}
	set := map[string]any{}
	for k, v := range patch {
		if v == nil {
			remove = append(remove, k)
		} else {
			set[k] = v
		}
	}
	b, _ := json.Marshal(set)
	return remove, b
}

func trimPtr(p *string) *string {
	if p == nil {
		return nil
	}
	v := strings.TrimSpace(*p)
	if v == "" {
		return nil
	}
	return &v
}

func (in *EntryInput) normalize() {
	in.PersonnelID, in.Name = strings.TrimSpace(in.PersonnelID), strings.TrimSpace(in.Name)
	in.AreaID, in.ProjectID, in.Position, in.SubArea = trimPtr(in.AreaID), trimPtr(in.ProjectID), trimPtr(in.Position), trimPtr(in.SubArea)
	in.JoinDate, in.ContractStartDate, in.ContractEndDate, in.BPJSStatus = trimPtr(in.JoinDate), trimPtr(in.ContractStartDate), trimPtr(in.ContractEndDate), trimPtr(in.BPJSStatus)
	if in.ContractStatus == "" {
		in.ContractStatus = "NOT_AVAILABLE"
	}
}

func checkDate(fe httpx.FieldErrors, field string, v *string, required bool) {
	if v == nil {
		if required {
			fe.Add(field, "Wajib diisi.")
		}
		return
	}
	if !domain.ValidDate(*v) {
		fe.Add(field, "Tanggal harus berformat YYYY-MM-DD dan valid.")
	}
}

func (s *Service) checkPlacement(ctx context.Context, q db.Querier, fe httpx.FieldErrors, areaID, projectID, position *string) {
	if areaID == nil {
		fe.Add("areaId", "Wajib diisi.")
	} else {
		var ok bool
		if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM areas WHERE id = $1)`, *areaID).Scan(&ok); err != nil || !ok {
			fe.Add("areaId", "Area tidak dikenal.")
		}
	}
	if projectID == nil {
		fe.Add("projectId", "Wajib diisi.")
	} else if areaID != nil {
		var projectArea, status string
		err := q.QueryRow(ctx, `SELECT area_id, status FROM projects WHERE id = $1`, *projectID).Scan(&projectArea, &status)
		switch {
		case err != nil:
			fe.Add("projectId", "Project tidak dikenal.")
		case projectArea != *areaID:
			fe.Add("projectId", "Project tidak berada pada Area yang dipilih.")
		}
	}
	if position == nil {
		fe.Add("position", "Wajib diisi.")
	}
}

func (in *EntryInput) validateBasic(fe httpx.FieldErrors) {
	in.validateMeasures(fe)
	if in.PersonnelID == "" {
		fe.Add("personnelId", "Wajib diisi.")
	}
	if in.Name == "" {
		fe.Add("name", "Wajib diisi.")
	}
	checkDate(fe, "joinDate", in.JoinDate, true)
	checkDate(fe, "contractStartDate", in.ContractStartDate, false)
	checkDate(fe, "contractEndDate", in.ContractEndDate, false)
	if in.ContractStartDate != nil && in.ContractEndDate != nil && *in.ContractEndDate < *in.ContractStartDate {
		fe.Add("contractEndDate", "Tanggal berakhir kontrak tidak boleh sebelum tanggal mulai.")
	}
	switch in.ContractStatus {
	case "NOT_AVAILABLE", "DRAFT", "SIGNED":
	default:
		fe.Add("contractStatus", "Status kontrak tidak dikenal.")
	}
}

func areaName(ctx context.Context, q db.Querier, id *string) string {
	if id == nil {
		return "tidak diketahui"
	}
	var name string
	if err := q.QueryRow(ctx, `SELECT name FROM areas WHERE id = $1`, *id).Scan(&name); err != nil {
		return "tidak diketahui"
	}
	return name
}

func recordStatus(submit bool) string {
	if submit {
		return "SUBMITTED"
	}
	return "DRAFT"
}

// CreateEntry registers a new personnel record. It is not effective (not counted
// as active workforce) until an authorized validator validates the entry.
func (s *Service) CreateEntry(ctx context.Context, a Actor, in EntryInput) (*domain.Employee, error) {
	p := a.P
	if err := require(p, access.CreateEmployee); err != nil {
		return nil, err
	}
	in.normalize()
	fe := httpx.FieldErrors{}
	in.validateBasic(fe)
	s.checkPlacement(ctx, s.Pool, fe, in.AreaID, in.ProjectID, in.Position)
	if err := fe.Err(); err != nil {
		return nil, err
	}
	if !p.CoversArea(in.AreaID) {
		return nil, httpx.Forbidden()
	}
	id := newID("emp")
	now := s.now()
	status := recordStatus(in.Submit)
	var submittedAt *time.Time
	if in.Submit {
		submittedAt = &now
	}
	err := s.tx(ctx, func(tx pgx.Tx) error {
		area := areaName(ctx, tx, in.AreaID)
		prof := map[string]any{"areaCbs": area}
		for k, v := range in.profilePatch {
			if v != nil {
				prof[k] = v
			}
		}
		profile, _ := json.Marshal(prof)
		_, err := tx.Exec(ctx, `INSERT INTO personnel (id, personnel_id, business_key, name, profile, area_id, sub_area, project_id, position, employment_status,
			join_date, contract_start_date, contract_end_date, contract_status, bpjs_status, record_status, submitted_at, source, created_by, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10,$11,$12,$13,$14,$15,$16,'MANUAL',$17,$18,$18)`,
			id, in.PersonnelID, imports.BusinessKey(in.PersonnelID), in.Name, profile, in.AreaID, in.SubArea, in.ProjectID, in.Position,
			in.JoinDate, in.ContractStartDate, in.ContractEndDate, in.ContractStatus, in.BPJSStatus, status, submittedAt, p.UserID, now)
		if db.IsUniqueViolation(err, "personnel_business_key_key") {
			return httpx.Conflict("DUPLICATE_PERSONNEL_ID", "Personnel ID sudah terdaftar.")
		}
		if err != nil {
			return err
		}
		periodID := newID("period")
		if _, err := tx.Exec(ctx, `INSERT INTO employment_periods (id, personnel_id, start_date, start_kind, created_by, created_at) VALUES ($1,$2,$3,'ENTRY',$4,$5)`, periodID, id, in.JoinDate, p.UserID, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO placements (id, personnel_id, period_id, area_id, project_id, position, sub_area, effective_from, source, source_ref, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ENTRY',$2,$9)`,
			newID("plc"), id, periodID, in.AreaID, in.ProjectID, in.Position, in.SubArea, in.JoinDate, now); err != nil {
			return err
		}
		title := "Draft employee entry disimpan"
		if in.Submit {
			title = "Entry dikirim untuk validasi"
		}
		if err := s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "employee.entry.create", EntityType: "personnel", EntityID: id, PersonnelID: &id, AreaID: in.AreaID,
			ActivityType: "ENTRY", Title: title, Description: fmt.Sprintf("Data %s diperbarui oleh %s", in.Name, p.Name), Details: map[string]any{"status": status}}); err != nil {
			return err
		}
		if in.Submit {
			return s.notifyEntrySubmitted(ctx, tx, p, id, in.Name, in.PersonnelID, in.AreaID, area, submittedAt, access.TxEntry)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	e, err := loadEmployee(ctx, s.Pool, id, false)
	return &e, err
}

func (s *Service) notifyEntrySubmitted(ctx context.Context, tx pgx.Tx, p *access.Principal, id, name, pid string, areaID *string, area string, submittedAt *time.Time, t access.TransactionType) error {
	dir, err := loadDirectory(ctx, tx)
	if err != nil {
		return err
	}
	label, base := "Employee Entry", "entry"
	if t == access.TxBasicEdit {
		label, base = "Perubahan data personil", "edit"
	}
	now := s.now()
	if err := emit(ctx, tx, now, spec{DedupeBase: fmt.Sprintf("%s-submit:%s:%s", base, id, stamp(submittedAt)), Recipients: dir.validators(t, p.UserID, areaID),
		Category: "VALIDATION_REQUEST", Severity: "info", Title: label + " menunggu validasi",
		Message: fmt.Sprintf("%s mengajukan %s (%s) dari area %s. Silakan periksa dan validasi.", p.Name, name, pid, area),
		Actor:   p.UserID, EntityType: "employee", EntityID: id, AreaID: areaID, Target: &NotificationTarget{Kind: "validation", ID: id}, RequiresAction: true}); err != nil {
		return err
	}
	return emit(ctx, tx, now, spec{DedupeBase: fmt.Sprintf("%s-ack:%s:%s", base, id, stamp(submittedAt)), Recipients: []string{p.UserID},
		Category: "VALIDATION_REQUEST", Severity: "info", Title: label + " dikirim untuk validasi",
		Message: fmt.Sprintf("Pengajuan %s (%s) terkirim dan menunggu validasi.", name, pid), Actor: p.UserID,
		EntityType: "employee", EntityID: id, AreaID: areaID, Target: &NotificationTarget{Kind: "employee", ID: id}})
}

var errStale = httpx.Conflict("STALE_VERSION", "Data sudah berubah sejak Anda membukanya. Muat ulang lalu coba lagi.")

// UpdateEmployee revises an entry that is not yet validated, or — for a validated
// record — creates/updates a basic-edit request that only takes effect after validation.
func (s *Service) UpdateEmployee(ctx context.Context, a Actor, id string, in EntryInput) (*domain.Employee, error) {
	p := a.P
	if err := require(p, access.EditEmployeeBasic); err != nil {
		return nil, err
	}
	in.normalize()
	fe := httpx.FieldErrors{}
	in.validateBasic(fe)
	if err := fe.Err(); err != nil {
		return nil, err
	}
	err := s.tx(ctx, func(tx pgx.Tx) error {
		e, err := s.visibleEmployee(ctx, tx, p, id, true)
		if err != nil {
			return err
		}
		if in.ExpectedVersion != nil && *in.ExpectedVersion != e.Version {
			return errStale
		}
		if imports.BusinessKey(in.PersonnelID) != imports.BusinessKey(e.PersonnelID) {
			return httpx.Validation(map[string]string{"personnelId": "Personnel ID tidak dapat diubah."})
		}
		if deref(in.AreaID) != deref(e.AreaID) || deref(in.ProjectID) != deref(e.ProjectID) || deref(in.Position) != deref(e.Position) {
			return httpx.Validation(map[string]string{"position": "Area, Project, dan Posisi diubah melalui pengajuan perubahan penempatan."})
		}
		now := s.now()
		var submittedAt *time.Time
		if in.Submit {
			submittedAt = &now
		}
		area := areaName(ctx, tx, e.AreaID)
		if e.ValidationStatus != "VALIDATED" {
			remove, set := profilePatchSQL(in.profilePatch)
			_, err := tx.Exec(ctx, `UPDATE personnel SET name=$2, join_date=$3, contract_start_date=$4, contract_end_date=$5, contract_status=$6, bpjs_status=$7,
				record_status=$8, submitted_at=COALESCE($9, submitted_at), revision_note = CASE WHEN $8 = 'SUBMITTED' THEN NULL ELSE revision_note END,
				profile = (profile - $11::text[]) || $12::jsonb, updated_at=$10, version = version + 1 WHERE id = $1`,
				id, in.Name, in.JoinDate, in.ContractStartDate, in.ContractEndDate, in.ContractStatus, in.BPJSStatus, recordStatus(in.Submit), submittedAt, now, remove, set)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE employment_periods SET start_date = $2 WHERE personnel_id = $1 AND NOT closed AND start_kind = 'ENTRY'`, id, in.JoinDate); err != nil {
				return err
			}
			if err := s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "employee.entry.update", EntityType: "personnel", EntityID: id, PersonnelID: &id, AreaID: e.AreaID,
				ActivityType: "ENTRY", Title: map[bool]string{true: "Entry dikirim untuk validasi", false: "Draft employee entry disimpan"}[in.Submit], Description: "Data " + in.Name + " diperbarui oleh " + p.Name}); err != nil {
				return err
			}
			if in.Submit {
				return s.notifyEntrySubmitted(ctx, tx, p, id, in.Name, e.PersonnelID, e.AreaID, area, submittedAt, access.TxEntry)
			}
			return nil
		}
		payload, _ := json.Marshal(map[string]any{"name": in.Name, "joinDate": in.JoinDate, "contractStartDate": in.ContractStartDate, "contractEndDate": in.ContractEndDate,
			"contractStatus": in.ContractStatus, "bpjsStatus": in.BPJSStatus, "profile": in.profilePatch})
		status := recordStatus(in.Submit)
		var reqID string
		err = tx.QueryRow(ctx, `INSERT INTO change_requests (id, personnel_id, transaction_type, status, payload, origin_area_id, target_area_id, base_version, created_by, submitted_at, created_at, updated_at)
			VALUES ($1,$2,'EMPLOYEE_BASIC_EDIT',$3,$4,$5,$5,$6,$7,$8,$9,$9)
			ON CONFLICT (personnel_id, transaction_type) WHERE status <> 'VALIDATED'
			DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, base_version = EXCLUDED.base_version,
			  submitted_at = COALESCE(EXCLUDED.submitted_at, change_requests.submitted_at),
			  revision_note = CASE WHEN EXCLUDED.status = 'SUBMITTED' THEN NULL ELSE change_requests.revision_note END,
			  updated_at = EXCLUDED.updated_at, version = change_requests.version + 1
			RETURNING id`, newID("req"), id, status, payload, e.AreaID, e.Version, p.UserID, submittedAt, now).Scan(&reqID)
		if err != nil {
			return err
		}
		if err := s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "employee.basic_edit.request", EntityType: "change_request", EntityID: reqID, PersonnelID: &id, AreaID: e.AreaID,
			ActivityType: "ENTRY", Title: "Perubahan data dasar diajukan", Description: "Menunggu validasi; data efektif belum berubah.", Details: map[string]any{"status": status}}); err != nil {
			return err
		}
		if in.Submit {
			return s.notifyEntrySubmitted(ctx, tx, p, id, e.Name, e.PersonnelID, e.AreaID, area, submittedAt, access.TxBasicEdit)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	e, err := loadEmployee(ctx, s.Pool, id, false)
	return &e, err
}

type Decision struct {
	Status          string `json:"status"`
	Note            string `json:"note"`
	ExpectedVersion *int   `json:"expectedVersion"`
}

func (d Decision) validate() error {
	if d.Status != "VALIDATED" && d.Status != "REVISION_REQUIRED" {
		return httpx.Validation(map[string]string{"status": "Keputusan harus VALIDATED atau REVISION_REQUIRED."})
	}
	return nil
}

func revisionNote(d Decision) *string {
	if d.Status != "REVISION_REQUIRED" {
		return nil
	}
	n := strings.TrimSpace(d.Note)
	if n == "" {
		n = "Perlu koreksi sebelum validasi."
	}
	return &n
}

func recordDecision(ctx context.Context, tx pgx.Tx, subjectType, subjectID string, t access.TransactionType, d Decision, version int, actor string, now time.Time) error {
	_, err := tx.Exec(ctx, `INSERT INTO validation_decisions (subject_type, subject_id, transaction_type, decision, note, subject_version, decided_by, decided_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		subjectType, subjectID, string(t), d.Status, nullable(strings.TrimSpace(d.Note)), version, actor, now)
	if db.IsUniqueViolation(err, "") {
		return httpx.Conflict("ALREADY_DECIDED", "Pengajuan ini sudah diputuskan.")
	}
	return err
}

// ValidateEntry decides a submitted entry. Only SUBMITTED entries can be decided.
func (s *Service) ValidateEntry(ctx context.Context, a Actor, id string, d Decision) error {
	if err := d.validate(); err != nil {
		return err
	}
	return s.tx(ctx, func(tx pgx.Tx) error {
		_, err := s.validateEntryTx(ctx, tx, a, id, d, false)
		return err
	})
}

func (s *Service) validateEntryTx(ctx context.Context, tx pgx.Tx, a Actor, id string, d Decision, bulk bool) (bool, error) {
	p := a.P
	e, err := s.visibleEmployee(ctx, tx, p, id, true)
	if err != nil {
		return false, err
	}
	if !p.MayValidate(access.TxEntry, e.AreaID) {
		return false, httpx.Forbidden()
	}
	if e.ValidationStatus != "SUBMITTED" {
		return false, httpx.Conflict("INVALID_STATE", "Hanya entry berstatus Menunggu validasi yang dapat diputuskan.")
	}
	if d.ExpectedVersion != nil && *d.ExpectedVersion != e.Version {
		return false, errStale
	}
	if bulk && (e.ConditionStatus == "NEEDS_REVIEW" || !domain.HasCompletePlacement(e.AreaID, e.ProjectID, e.Position)) {
		return false, nil
	}
	if d.Status == "VALIDATED" {
		// Required documents must be accepted before final validation (imports included).
		if err := documentGate(ctx, tx, SubjectEntry, id, string(access.TxEntry)); err != nil {
			if bulk {
				return false, nil
			}
			return false, err
		}
	}
	now := s.now()
	if err := recordDecision(ctx, tx, "PERSONNEL_ENTRY", id, access.TxEntry, d, e.Version, p.UserID, now); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `UPDATE personnel SET record_status=$2, revision_note=$3, validated_by=$4, validated_at=$5, updated_at=$5, version = version + 1 WHERE id = $1`,
		id, d.Status, revisionNote(d), p.UserID, now); err != nil {
		return false, err
	}
	if d.Status == "VALIDATED" && e.JoinDate != nil {
		if _, err := tx.Exec(ctx, `INSERT INTO career_events (id, personnel_id, movement_type, effective_date, new_area_id, new_project_id, new_position, notes, source, source_ref, created_by, created_at)
			VALUES ($1,$2,'JOIN',$3,$4,$5,$6,$7,'ENTRY',$8,$9,$10) ON CONFLICT (source_ref) DO NOTHING`,
			newID("ce"), id, *e.JoinDate, e.AreaID, e.ProjectID, e.Position, "Employee entry tervalidasi.", "entry:"+id, p.UserID, now); err != nil {
			return false, err
		}
	}
	title := map[bool]string{true: "Employee entry divalidasi", false: "Revisi employee entry diminta"}[d.Status == "VALIDATED"]
	if err := s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "employee.entry.decide", EntityType: "personnel", EntityID: id, PersonnelID: &id, AreaID: e.AreaID,
		ActivityType: "VALIDATION", Title: title, Description: "Status validasi: " + d.Status, Details: map[string]any{"decision": d.Status, "bulk": bulk}}); err != nil {
		return false, err
	}
	return true, s.notifyResult(ctx, tx, p, "entry", id, e.SubmittedAt, d, e.CreatedBy, e.AreaID, "Employee Entry", e.Name, e.PersonnelID, nil)
}

func (s *Service) notifyResult(ctx context.Context, tx pgx.Tx, p *access.Principal, base, id string, submittedAt *time.Time, d Decision, createdBy string, areaID *string, label, name, pid string, extra []string) error {
	now := s.now()
	if err := resolvePrefix(ctx, tx, now, fmt.Sprintf("%s-submit:%s:%s", base, id, stamp(submittedAt))); err != nil {
		return err
	}
	dir, err := loadDirectory(ctx, tx)
	if err != nil {
		return err
	}
	approved := d.Status == "VALIDATED"
	recips := append(dir.exists(createdBy), extra...)
	title, sev := label+" disetujui", "success"
	msg := fmt.Sprintf("%s (%s) disetujui oleh %s.", name, pid, p.Name)
	if !approved {
		title, sev = label+" perlu revisi", "warning"
		msg = fmt.Sprintf("%s (%s) perlu revisi: %s", name, pid, *revisionNote(d))
	}
	return emit(ctx, tx, now, spec{DedupeBase: fmt.Sprintf("%s-result:%s:%s:%s", base, id, stamp(submittedAt), d.Status), Recipients: recips, Category: "VALIDATION_RESULT",
		Severity: sev, Title: title, Message: msg, Actor: p.UserID, EntityType: "employee", EntityID: id, AreaID: areaID, Target: &NotificationTarget{Kind: "employee", ID: id}})
}

// BulkValidateEntries validates eligible submitted entries; ineligible ones are skipped.
func (s *Service) BulkValidateEntries(ctx context.Context, a Actor, ids []string) (int, error) {
	if err := require(a.P, access.ValidateEntryEdit, access.BulkValidate); err != nil {
		return 0, err
	}
	if len(ids) == 0 || len(ids) > 1000 {
		return 0, httpx.Validation(map[string]string{"ids": "Pilih 1–1000 entry."})
	}
	count := 0
	err := s.tx(ctx, func(tx pgx.Tx) error {
		for _, id := range ids {
			ok, err := s.validateEntryTx(ctx, tx, a, id, Decision{Status: "VALIDATED"}, true)
			var apiErr *httpx.Error
			if errors.As(err, &apiErr) && (apiErr.Status == 404 || apiErr.Status == 403 || apiErr.Status == 409) {
				continue
			}
			if err != nil {
				return err
			}
			if ok {
				count++
			}
		}
		return nil
	})
	return count, err
}

type changeRequestRow struct {
	ID, PersonnelID, Type, Status, CreatedBy string
	Payload                                  map[string]any
	BaseVersion                              int
	BasePeriodID                             *string
	OriginArea, TargetArea                   *string
	MovementType                             *string
	EffectiveDate, ExitDate                  *string
	ExitReason                               *string
	ReplacementRequired                      *bool
	SubmittedAt                              *time.Time
	Version                                  int
}

func loadRequest(ctx context.Context, q db.Querier, id string, forUpdate bool) (*changeRequestRow, error) {
	sql := `SELECT id, personnel_id, transaction_type, status, created_by, payload, base_version, base_period_id, origin_area_id, target_area_id,
		movement_type, effective_date::text, exit_date::text, exit_reason, replacement_required, submitted_at, version FROM change_requests WHERE id = $1`
	if forUpdate {
		sql += " FOR UPDATE"
	}
	var r changeRequestRow
	var payload []byte
	err := q.QueryRow(ctx, sql, id).Scan(&r.ID, &r.PersonnelID, &r.Type, &r.Status, &r.CreatedBy, &payload, &r.BaseVersion, &r.BasePeriodID, &r.OriginArea, &r.TargetArea,
		&r.MovementType, &r.EffectiveDate, &r.ExitDate, &r.ExitReason, &r.ReplacementRequired, &r.SubmittedAt, &r.Version)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(payload, &r.Payload)
	return &r, nil
}

func payloadStr(m map[string]any, k string) *string {
	if v, ok := m[k].(string); ok && v != "" {
		return &v
	}
	return nil
}

// ValidateChangeRequest decides a basic-edit, placement-change or exit request.
// Stale requests (the record changed after submission) are rejected with 409.
func (s *Service) ValidateChangeRequest(ctx context.Context, a Actor, requestID string, d Decision) error {
	if err := d.validate(); err != nil {
		return err
	}
	p := a.P
	return s.tx(ctx, func(tx pgx.Tx) error {
		r, err := loadRequest(ctx, tx, requestID, true)
		if err != nil {
			return notFoundOr(err, "Pengajuan")
		}
		if !p.CoversArea(r.OriginArea) && !p.CoversArea(r.TargetArea) {
			return httpx.NotFound("Pengajuan")
		}
		e, err := loadEmployee(ctx, tx, r.PersonnelID, true)
		if err != nil {
			return err
		}
		t := access.TransactionType(r.Type)
		if !p.MayValidate(t, r.OriginArea, r.TargetArea) {
			return httpx.Forbidden()
		}
		if r.Status != "SUBMITTED" {
			return httpx.Conflict("INVALID_STATE", "Hanya pengajuan berstatus Menunggu validasi yang dapat diputuskan.")
		}
		if d.ExpectedVersion != nil && *d.ExpectedVersion != r.Version {
			return errStale
		}
		if d.Status == "VALIDATED" {
			if err := documentGate(ctx, tx, SubjectChangeRequest, r.ID, r.Type); err != nil {
				return err
			}
		}
		now := s.now()
		if err := recordDecision(ctx, tx, "CHANGE_REQUEST", r.ID, t, d, r.Version, p.UserID, now); err != nil {
			return err
		}
		if d.Status == "VALIDATED" {
			switch t {
			case access.TxBasicEdit:
				err = s.applyBasicEdit(ctx, tx, r, e, now)
			case access.TxPlacementChange:
				err = s.applyPlacementChange(ctx, tx, a, r, e, now)
			case access.TxExit:
				err = s.applyExit(ctx, tx, a, r, e, now)
			}
			if err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE change_requests SET status=$2, revision_note=$3, validated_by=$4, validated_at=$5, updated_at=$5, version = version + 1 WHERE id = $1`,
			r.ID, d.Status, revisionNote(d), p.UserID, now); err != nil {
			return err
		}
		labels := map[access.TransactionType][3]string{
			access.TxBasicEdit:       {"edit", "Perubahan data personil", "Perubahan data dasar"},
			access.TxPlacementChange: {"movement", "Movement", "Movement"},
			access.TxExit:            {"exit", "Exit", "Employee exit"},
		}[t]
		title := labels[2] + map[bool]string{true: " divalidasi", false: " perlu revisi"}[d.Status == "VALIDATED"]
		if err := s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "change_request.decide", EntityType: "change_request", EntityID: r.ID, PersonnelID: &r.PersonnelID, AreaID: e.AreaID,
			ActivityType: "VALIDATION", Title: title, Description: "Status validasi: " + d.Status, Details: map[string]any{"type": r.Type, "decision": d.Status}}); err != nil {
			return err
		}
		var extra []string
		dir, err := loadDirectory(ctx, tx)
		if err != nil {
			return err
		}
		if d.Status == "VALIDATED" && t != access.TxBasicEdit {
			area := r.TargetArea
			if t == access.TxExit {
				area = e.AreaID
			}
			extra = dir.monitoring(area, p.UserID)
		}
		subject := r.ID
		if t == access.TxBasicEdit {
			subject = e.ID
		}
		return s.notifyResult(ctx, tx, p, labels[0], subject, r.SubmittedAt, d, r.CreatedBy, e.AreaID, labels[1], e.Name, e.PersonnelID, extra)
	})
}

func (s *Service) applyBasicEdit(ctx context.Context, tx pgx.Tx, r *changeRequestRow, e domain.Employee, now time.Time) error {
	if r.BaseVersion != e.Version {
		return httpx.Conflict("STALE_REQUEST", "Data employee berubah setelah pengajuan dibuat. Minta pengaju memperbarui pengajuan.")
	}
	name := payloadStr(r.Payload, "name")
	if name == nil {
		return httpx.Conflict("INVALID_REQUEST", "Pengajuan tidak lengkap.")
	}
	contract := payloadStr(r.Payload, "contractStatus")
	patch, _ := r.Payload["profile"].(map[string]any) // absent in requests created before measurements existed
	remove, set := profilePatchSQL(patch)
	_, err := tx.Exec(ctx, `UPDATE personnel SET name=$2, join_date=$3, contract_start_date=$4, contract_end_date=$5, contract_status=COALESCE($6, contract_status), bpjs_status=$7,
		profile = (profile - $9::text[]) || $10::jsonb, updated_at=$8, version = version + 1 WHERE id = $1`,
		e.ID, *name, payloadStr(r.Payload, "joinDate"), payloadStr(r.Payload, "contractStartDate"), payloadStr(r.Payload, "contractEndDate"), contract, payloadStr(r.Payload, "bpjsStatus"), now, remove, set)
	return err
}

func (s *Service) applyPlacementChange(ctx context.Context, tx pgx.Tx, a Actor, r *changeRequestRow, e domain.Employee, now time.Time) error {
	if r.BaseVersion != e.Version {
		return httpx.Conflict("STALE_REQUEST", "Penempatan employee berubah setelah pengajuan dibuat. Ajukan ulang berdasarkan data terkini.")
	}
	if e.EmploymentStatus != "ACTIVE" {
		return httpx.Conflict("INVALID_STATE", "Employee tidak aktif; perubahan penempatan tidak dapat diterapkan.")
	}
	newArea, newProject, newPos := payloadStr(r.Payload, "newAreaId"), payloadStr(r.Payload, "newProjectId"), payloadStr(r.Payload, "newPosition")
	var periodID string
	if err := tx.QueryRow(ctx, `SELECT id FROM employment_periods WHERE personnel_id = $1 AND NOT closed`, e.ID).Scan(&periodID); err != nil {
		return httpx.Conflict("INVALID_STATE", "Periode kerja aktif tidak ditemukan.")
	}
	if _, err := tx.Exec(ctx, `UPDATE placements SET closed = true, effective_to = GREATEST(COALESCE(effective_from, $2::date - 1), $2::date - 1) WHERE personnel_id = $1 AND NOT closed`, e.ID, *r.EffectiveDate); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO placements (id, personnel_id, period_id, area_id, project_id, position, sub_area, effective_from, source, source_ref, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'MOVEMENT',$9,$10)`,
		newID("plc"), e.ID, periodID, newArea, newProject, newPos, e.SubArea, *r.EffectiveDate, r.ID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE personnel SET area_id=$2, project_id=$3, position=$4, profile = jsonb_set(profile, '{areaCbs}', to_jsonb($5::text)), updated_at=$6, version = version + 1 WHERE id = $1`,
		e.ID, newArea, newProject, newPos, areaName(ctx, tx, newArea), now); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO career_events (id, personnel_id, movement_type, effective_date, previous_area_id, new_area_id, previous_project_id, new_project_id, previous_position, new_position, notes, source, source_ref, created_by, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'REQUEST',$12,$13,$14) ON CONFLICT (source_ref) DO NOTHING`,
		newID("ce"), e.ID, *r.MovementType, *r.EffectiveDate, payloadStr(r.Payload, "previousAreaId"), newArea, payloadStr(r.Payload, "previousProjectId"), newProject,
		payloadStr(r.Payload, "previousPosition"), newPos, deref(payloadStr(r.Payload, "notes")), "request:"+r.ID, r.CreatedBy, now)
	return err
}

func (s *Service) applyExit(ctx context.Context, tx pgx.Tx, a Actor, r *changeRequestRow, e domain.Employee, now time.Time) error {
	if e.EmploymentStatus != "ACTIVE" {
		return httpx.Conflict("INVALID_STATE", "Employee sudah tidak aktif.")
	}
	var periodID string
	if err := tx.QueryRow(ctx, `SELECT id FROM employment_periods WHERE personnel_id = $1 AND NOT closed`, e.ID).Scan(&periodID); err != nil || r.BasePeriodID == nil || *r.BasePeriodID != periodID {
		return httpx.Conflict("STALE_REQUEST", "Periode kerja berubah setelah pengajuan exit dibuat. Ajukan ulang.")
	}
	if e.JoinDate != nil && *r.ExitDate < *e.JoinDate {
		return httpx.Conflict("INVALID_REQUEST", "Tanggal exit tidak boleh sebelum tanggal bergabung.")
	}
	if _, err := tx.Exec(ctx, `UPDATE employment_periods SET closed = true, end_date = $2, end_reason = $3, end_ref = $4 WHERE id = $1`, periodID, *r.ExitDate, r.ExitReason, r.ID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE placements SET closed = true, effective_to = $2 WHERE personnel_id = $1 AND NOT closed`, e.ID, *r.ExitDate); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE personnel SET employment_status = 'INACTIVE', updated_at = $2, version = version + 1 WHERE id = $1`, e.ID, now); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO career_events (id, personnel_id, movement_type, effective_date, previous_area_id, new_area_id, previous_project_id, new_project_id, previous_position, new_position, notes, source, source_ref, created_by, created_at)
		VALUES ($1,$2,'EXIT',$3,$4,$4,$5,$5,$6,$6,$7,'REQUEST',$8,$9,$10) ON CONFLICT (source_ref) DO NOTHING`,
		newID("ce"), e.ID, *r.ExitDate, e.AreaID, e.ProjectID, e.Position, deref(r.ExitReason), "exit:"+r.ID, r.CreatedBy, now); err != nil {
		return err
	}
	if r.ReplacementRequired == nil || !*r.ReplacementRequired {
		return nil
	}
	// Exactly one replacement need per validated exit (unique exit_request_id).
	needID := newID("need")
	tag, err := tx.Exec(ctx, `INSERT INTO replacement_needs (id, exit_request_id, original_personnel_id, area_id, project_id, position, exit_date, previous_need_id, lifecycle_status, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT id FROM replacement_needs WHERE replacement_personnel_id = $3 AND lifecycle_status = 'FULFILLED' ORDER BY fulfilled_at DESC LIMIT 1),'OPEN',$8,$8)
		ON CONFLICT (exit_request_id) DO NOTHING`, needID, r.ID, e.ID, e.AreaID, e.ProjectID, e.Position, *r.ExitDate, now)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	desc := "Exit tervalidasi dan replacement need dibuat"
	if !domain.HasCompletePlacement(e.AreaID, e.ProjectID, e.Position) {
		desc = "Exit tervalidasi; replacement need dibuat dengan peringatan data sumber"
	}
	if err := s.audit(ctx, tx, a.P.UserID, a.RequestID, auditEntry{Action: "replacement.need.create", EntityType: "replacement_need", EntityID: needID, PersonnelID: &e.ID, AreaID: e.AreaID,
		ActivityType: "EXIT", Title: "Replacement need dibuat", Description: desc}); err != nil {
		return err
	}
	dir, err := loadDirectory(ctx, tx)
	if err != nil {
		return err
	}
	return emit(ctx, tx, now, spec{DedupeBase: "need-created:" + needID, Recipients: append(dir.hrHO(a.P.UserID), dir.monitoring(e.AreaID, a.P.UserID)...),
		Category: "REPLACEMENT", Severity: "warning", Title: "Replacement need terbentuk",
		Message: fmt.Sprintf("Kebutuhan pengganti untuk %s (%s) telah dibuat.", e.Name, e.PersonnelID), Actor: a.P.UserID,
		EntityType: "replacement", EntityID: needID, AreaID: e.AreaID, Target: &NotificationTarget{Kind: "replacement", ID: needID}, RequiresAction: true})
}

type ExitInput struct {
	ExitDate            string `json:"exitDate"`
	ExitReason          string `json:"exitReason"`
	ReplacementRequired bool   `json:"replacementRequired"`
	Submit              bool   `json:"submit"`
}

// SaveExitRequest creates or revises the single open exit request of an employee.
func (s *Service) SaveExitRequest(ctx context.Context, a Actor, employeeID string, in ExitInput) (*domain.EmployeeExit, error) {
	p := a.P
	if err := require(p, access.RequestEmployeeExit); err != nil {
		return nil, err
	}
	fe := httpx.FieldErrors{}
	in.ExitReason = strings.TrimSpace(in.ExitReason)
	checkDate(fe, "exitDate", &in.ExitDate, true)
	if in.ExitReason == "" {
		fe.Add("exitReason", "Wajib diisi.")
	}
	if err := fe.Err(); err != nil {
		return nil, err
	}
	var reqID string
	err := s.tx(ctx, func(tx pgx.Tx) error {
		e, err := s.visibleEmployee(ctx, tx, p, employeeID, true)
		if err != nil {
			return err
		}
		if e.EmploymentStatus != "ACTIVE" {
			return httpx.Conflict("INVALID_STATE", "Employee sudah tidak aktif.")
		}
		if e.JoinDate != nil && in.ExitDate < *e.JoinDate {
			return httpx.Validation(map[string]string{"exitDate": "Tanggal exit tidak boleh sebelum tanggal bergabung."})
		}
		var periodID string
		if err := tx.QueryRow(ctx, `SELECT id FROM employment_periods WHERE personnel_id = $1 AND NOT closed`, e.ID).Scan(&periodID); err != nil {
			return httpx.Conflict("INVALID_STATE", "Periode kerja aktif tidak ditemukan.")
		}
		now := s.now()
		var submittedAt *time.Time
		if in.Submit {
			submittedAt = &now
		}
		status := recordStatus(in.Submit)
		var prevStatus string
		err = tx.QueryRow(ctx, `SELECT status FROM change_requests WHERE personnel_id = $1 AND transaction_type = 'EMPLOYEE_EXIT' AND status <> 'VALIDATED'`, e.ID).Scan(&prevStatus)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		err = tx.QueryRow(ctx, `INSERT INTO change_requests (id, personnel_id, transaction_type, status, origin_area_id, target_area_id, exit_date, exit_reason, replacement_required, base_version, base_period_id, created_by, submitted_at, created_at, updated_at)
			VALUES ($1,$2,'EMPLOYEE_EXIT',$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
			ON CONFLICT (personnel_id, transaction_type) WHERE status <> 'VALIDATED'
			DO UPDATE SET status = EXCLUDED.status, exit_date = EXCLUDED.exit_date, exit_reason = EXCLUDED.exit_reason, replacement_required = EXCLUDED.replacement_required,
			  base_version = EXCLUDED.base_version, base_period_id = EXCLUDED.base_period_id, submitted_at = COALESCE(EXCLUDED.submitted_at, change_requests.submitted_at),
			  revision_note = CASE WHEN EXCLUDED.status = 'SUBMITTED' THEN NULL ELSE change_requests.revision_note END, updated_at = EXCLUDED.updated_at, version = change_requests.version + 1
			RETURNING id`, newID("exit"), e.ID, status, e.AreaID, in.ExitDate, in.ExitReason, in.ReplacementRequired, e.Version, periodID, p.UserID, submittedAt, now).Scan(&reqID)
		if err != nil {
			return err
		}
		title := map[bool]string{true: "Exit dikirim untuk validasi", false: "Draft employee exit disimpan"}[in.Submit]
		if err := s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "employee.exit.request", EntityType: "change_request", EntityID: reqID, PersonnelID: &e.ID, AreaID: e.AreaID,
			ActivityType: "EXIT", Title: title, Description: in.ExitReason}); err != nil {
			return err
		}
		if !in.Submit || prevStatus == "SUBMITTED" {
			return nil
		}
		dir, err := loadDirectory(ctx, tx)
		if err != nil {
			return err
		}
		area := areaName(ctx, tx, e.AreaID)
		if err := emit(ctx, tx, now, spec{DedupeBase: fmt.Sprintf("exit-submit:%s:%s", reqID, stamp(submittedAt)), Recipients: dir.validators(access.TxExit, p.UserID, e.AreaID),
			Category: "EXIT", Severity: "info", Title: "Pengajuan exit menunggu validasi",
			Message: fmt.Sprintf("%s mengajukan exit untuk %s (%s) dari area %s.", p.Name, e.Name, e.PersonnelID, area),
			Actor:   p.UserID, EntityType: "exit", EntityID: reqID, AreaID: e.AreaID, Target: &NotificationTarget{Kind: "validation", ID: e.ID}, RequiresAction: true}); err != nil {
			return err
		}
		return emit(ctx, tx, now, spec{DedupeBase: fmt.Sprintf("exit-ack:%s:%s", reqID, stamp(submittedAt)), Recipients: []string{p.UserID}, Category: "EXIT", Severity: "info",
			Title: "Exit dikirim untuk validasi", Message: fmt.Sprintf("Pengajuan exit %s (%s) terkirim dan menunggu validasi HR.", e.Name, e.PersonnelID),
			Actor: p.UserID, EntityType: "exit", EntityID: reqID, AreaID: e.AreaID, Target: &NotificationTarget{Kind: "employee", ID: e.ID}})
	})
	if err != nil {
		return nil, err
	}
	exits, err := s.exitRequests(ctx, s.Pool, "cr.id = $1", reqID)
	if err != nil || len(exits) == 0 {
		return nil, err
	}
	return &exits[0], nil
}

type MovementInput struct {
	MovementType    string  `json:"movementType"`
	EffectiveDate   string  `json:"effectiveDate"`
	NewAreaID       *string `json:"newAreaId"`
	NewProjectID    *string `json:"newProjectId"`
	NewPosition     *string `json:"newPosition"`
	Notes           string  `json:"notes"`
	Submit          bool    `json:"submit"`
	ExpectedVersion *int    `json:"expectedVersion"`
}

var movementTypes = map[string]bool{"PROMOTION": true, "MUTATION": true, "AREA_CHANGE": true, "PROJECT_CHANGE": true, "POSITION_CHANGE": true}

// SaveMovementRequest creates or revises a placement-change request. Cross-area
// requests require scope over both origin and destination.
func (s *Service) SaveMovementRequest(ctx context.Context, a Actor, employeeID string, in MovementInput) (*domain.PlacementChangeRequest, error) {
	p := a.P
	if err := require(p, access.RequestPlacementChange); err != nil {
		return nil, err
	}
	in.NewAreaID, in.NewProjectID, in.NewPosition = trimPtr(in.NewAreaID), trimPtr(in.NewProjectID), trimPtr(in.NewPosition)
	fe := httpx.FieldErrors{}
	if !movementTypes[in.MovementType] {
		fe.Add("movementType", "Jenis movement tidak dikenal.")
	}
	checkDate(fe, "effectiveDate", &in.EffectiveDate, true)
	s.checkPlacement(ctx, s.Pool, fe, in.NewAreaID, in.NewProjectID, in.NewPosition)
	if err := fe.Err(); err != nil {
		return nil, err
	}
	var reqID string
	err := s.tx(ctx, func(tx pgx.Tx) error {
		e, err := s.visibleEmployee(ctx, tx, p, employeeID, true)
		if err != nil {
			return err
		}
		if !p.CoversArea(in.NewAreaID) {
			return httpx.Forbidden()
		}
		if in.ExpectedVersion != nil && *in.ExpectedVersion != e.Version {
			return errStale
		}
		if e.EmploymentStatus != "ACTIVE" || e.ValidationStatus != "VALIDATED" {
			return httpx.Conflict("INVALID_STATE", "Perubahan penempatan hanya untuk employee aktif yang sudah tervalidasi.")
		}
		if deref(in.NewAreaID) == deref(e.AreaID) && deref(in.NewProjectID) == deref(e.ProjectID) && deref(in.NewPosition) == deref(e.Position) {
			return httpx.Validation(map[string]string{"newPosition": "Minimal satu dari Area, Project, atau Posisi harus berubah."})
		}
		if e.JoinDate != nil && in.EffectiveDate < *e.JoinDate {
			return httpx.Validation(map[string]string{"effectiveDate": "Tanggal efektif tidak boleh sebelum tanggal bergabung."})
		}
		now := s.now()
		var submittedAt *time.Time
		if in.Submit {
			submittedAt = &now
		}
		payload, _ := json.Marshal(map[string]any{"previousAreaId": e.AreaID, "newAreaId": in.NewAreaID, "previousProjectId": e.ProjectID, "newProjectId": in.NewProjectID,
			"previousPosition": e.Position, "newPosition": in.NewPosition, "notes": strings.TrimSpace(in.Notes)})
		var prevStatus string
		_ = tx.QueryRow(ctx, `SELECT status FROM change_requests WHERE personnel_id = $1 AND transaction_type = 'EMPLOYEE_PLACEMENT_CHANGE' AND status <> 'VALIDATED'`, e.ID).Scan(&prevStatus)
		err = tx.QueryRow(ctx, `INSERT INTO change_requests (id, personnel_id, transaction_type, status, payload, origin_area_id, target_area_id, movement_type, effective_date, base_version, created_by, submitted_at, created_at, updated_at)
			VALUES ($1,$2,'EMPLOYEE_PLACEMENT_CHANGE',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
			ON CONFLICT (personnel_id, transaction_type) WHERE status <> 'VALIDATED'
			DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, origin_area_id = EXCLUDED.origin_area_id, target_area_id = EXCLUDED.target_area_id,
			  movement_type = EXCLUDED.movement_type, effective_date = EXCLUDED.effective_date, base_version = EXCLUDED.base_version,
			  submitted_at = COALESCE(EXCLUDED.submitted_at, change_requests.submitted_at),
			  revision_note = CASE WHEN EXCLUDED.status = 'SUBMITTED' THEN NULL ELSE change_requests.revision_note END, updated_at = EXCLUDED.updated_at, version = change_requests.version + 1
			RETURNING id`, newID("mov"), e.ID, recordStatus(in.Submit), payload, e.AreaID, in.NewAreaID, in.MovementType, in.EffectiveDate, e.Version, p.UserID, submittedAt, now).Scan(&reqID)
		if err != nil {
			return err
		}
		if err := s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "employee.movement.request", EntityType: "change_request", EntityID: reqID, PersonnelID: &e.ID, AreaID: in.NewAreaID,
			Details: map[string]any{"movementType": in.MovementType, "status": recordStatus(in.Submit)}}); err != nil {
			return err
		}
		if !in.Submit || prevStatus == "SUBMITTED" {
			return nil
		}
		dir, err := loadDirectory(ctx, tx)
		if err != nil {
			return err
		}
		label := strings.ToLower(strings.ReplaceAll(in.MovementType, "_", " "))
		target := in.NewAreaID
		if err := emit(ctx, tx, now, spec{DedupeBase: fmt.Sprintf("movement-submit:%s:%s", reqID, stamp(submittedAt)), Recipients: dir.validators(access.TxPlacementChange, p.UserID, e.AreaID, in.NewAreaID),
			Category: "MOVEMENT", Severity: "info", Title: "Pengajuan movement menunggu validasi",
			Message: fmt.Sprintf("%s mengajukan %s untuk %s (%s).", p.Name, label, e.Name, e.PersonnelID), Actor: p.UserID,
			EntityType: "movement", EntityID: reqID, AreaID: target, Target: &NotificationTarget{Kind: "validation", ID: e.ID}, RequiresAction: true}); err != nil {
			return err
		}
		return emit(ctx, tx, now, spec{DedupeBase: fmt.Sprintf("movement-ack:%s:%s", reqID, stamp(submittedAt)), Recipients: []string{p.UserID}, Category: "MOVEMENT", Severity: "info",
			Title: "Movement dikirim untuk validasi", Message: fmt.Sprintf("Pengajuan %s %s (%s) terkirim dan menunggu validasi.", label, e.Name, e.PersonnelID),
			Actor: p.UserID, EntityType: "movement", EntityID: reqID, AreaID: target, Target: &NotificationTarget{Kind: "employee", ID: e.ID}})
	})
	if err != nil {
		return nil, err
	}
	list, err := s.movementRequests(ctx, s.Pool, "cr.id = $1", reqID)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

type ReentryInput struct {
	AreaID    *string `json:"areaId"`
	ProjectID *string `json:"projectId"`
	Position  *string `json:"position"`
	JoinDate  string  `json:"joinDate"`
	Notes     string  `json:"notes"`
}

// Reentry re-activates the SAME identity with a new employment period; history is kept.
// Behavior kept from the prototype: re-entry is effective immediately (DEMO ASSUMPTION / TBC).
func (s *Service) Reentry(ctx context.Context, a Actor, employeeID string, in ReentryInput) (*domain.Employee, error) {
	p := a.P
	if err := require(p, access.ReentryEmployee); err != nil {
		return nil, err
	}
	in.AreaID, in.ProjectID, in.Position = trimPtr(in.AreaID), trimPtr(in.ProjectID), trimPtr(in.Position)
	fe := httpx.FieldErrors{}
	checkDate(fe, "joinDate", &in.JoinDate, true)
	s.checkPlacement(ctx, s.Pool, fe, in.AreaID, in.ProjectID, in.Position)
	if err := fe.Err(); err != nil {
		return nil, err
	}
	err := s.tx(ctx, func(tx pgx.Tx) error {
		e, err := s.visibleEmployee(ctx, tx, p, employeeID, true)
		if err != nil {
			return err
		}
		if !p.CoversArea(in.AreaID) {
			return httpx.Forbidden()
		}
		if e.EmploymentStatus != "INACTIVE" {
			return httpx.Conflict("INVALID_STATE", "Re-entry hanya untuk employee yang tidak aktif.")
		}
		var lastEnd *string
		if err := tx.QueryRow(ctx, `SELECT max(end_date)::text FROM employment_periods WHERE personnel_id = $1`, e.ID).Scan(&lastEnd); err != nil {
			return err
		}
		if lastEnd == nil {
			if v, ok := e.Profile["exitDate"].(string); ok {
				lastEnd = &v
			}
		}
		if lastEnd != nil && in.JoinDate <= *lastEnd {
			return httpx.Validation(map[string]string{"joinDate": "Tanggal re-entry harus setelah tanggal exit terakhir."})
		}
		now := s.now()
		// Imported inactive masters may still have an open period without an end date.
		if _, err := tx.Exec(ctx, `UPDATE employment_periods SET closed = true, end_date = COALESCE(end_date, $2::date) WHERE personnel_id = $1 AND NOT closed`, e.ID, lastEnd); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE placements SET closed = true WHERE personnel_id = $1 AND NOT closed`, e.ID); err != nil {
			return err
		}
		periodID := newID("period")
		if _, err := tx.Exec(ctx, `INSERT INTO employment_periods (id, personnel_id, start_date, start_kind, created_by, created_at) VALUES ($1,$2,$3,'REENTRY',$4,$5)`, periodID, e.ID, in.JoinDate, p.UserID, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO placements (id, personnel_id, period_id, area_id, project_id, position, effective_from, source, source_ref, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'REENTRY',$3,$8)`,
			newID("plc"), e.ID, periodID, in.AreaID, in.ProjectID, in.Position, in.JoinDate, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE personnel SET employment_status='ACTIVE', area_id=$2, project_id=$3, position=$4, join_date=$5, record_status='VALIDATED', validated_by=$6, validated_at=$7,
			profile = jsonb_set(profile, '{areaCbs}', to_jsonb($8::text)), updated_at=$7, version = version + 1 WHERE id = $1`,
			e.ID, in.AreaID, in.ProjectID, in.Position, in.JoinDate, p.UserID, now, areaName(ctx, tx, in.AreaID)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO career_events (id, personnel_id, movement_type, effective_date, previous_area_id, new_area_id, previous_project_id, new_project_id, previous_position, new_position, notes, source, source_ref, created_by, created_at)
			VALUES ($1,$2,'REENTRY',$3,$4,$5,$6,$7,$8,$9,$10,'REENTRY',$11,$12,$13)`,
			newID("ce"), e.ID, in.JoinDate, e.AreaID, in.AreaID, e.ProjectID, in.ProjectID, e.Position, in.Position, strings.TrimSpace(in.Notes), "reentry:"+periodID, p.UserID, now); err != nil {
			return err
		}
		if err := s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "employee.reentry", EntityType: "personnel", EntityID: e.ID, PersonnelID: &e.ID, AreaID: in.AreaID,
			ActivityType: "ENTRY", Title: "Re-entry personil", Description: "Diaktifkan kembali oleh " + p.Name}); err != nil {
			return err
		}
		dir, err := loadDirectory(ctx, tx)
		if err != nil {
			return err
		}
		return emit(ctx, tx, now, spec{DedupeBase: "reentry:" + periodID, Recipients: dir.monitoring(in.AreaID, p.UserID), Category: "PERSONNEL", Severity: "success",
			Title: "Re-entry personil", Message: fmt.Sprintf("%s (%s) diaktifkan kembali oleh %s.", e.Name, e.PersonnelID, p.Name), Actor: p.UserID,
			EntityType: "employee", EntityID: e.ID, AreaID: in.AreaID, Target: &NotificationTarget{Kind: "employee", ID: e.ID}})
	})
	if err != nil {
		return nil, err
	}
	e, err := loadEmployee(ctx, s.Pool, employeeID, false)
	return &e, err
}
