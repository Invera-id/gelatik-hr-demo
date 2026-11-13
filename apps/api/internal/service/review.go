package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/imports"
)

type SourceRecordView struct {
	ID                   string               `json:"id"`
	BusinessKey          string               `json:"businessKey"`
	PersonnelID          string               `json:"personnelId"`
	Name                 string               `json:"name"`
	BatchID              string               `json:"batchId"`
	FileName             string               `json:"fileName"`
	SheetName            string               `json:"sheetName"`
	RowNumber            int                  `json:"rowNumber"`
	Fields               imports.Fields       `json:"fields"`
	Fingerprint          string               `json:"fingerprint"`
	Warnings             []imports.FieldIssue `json:"warnings"`
	ReconciliationStatus string               `json:"reconciliationStatus"`
	CreatedAt            time.Time            `json:"createdAt"`
}

type ReviewItemView struct {
	ID                  string             `json:"id"`
	BusinessKey         string             `json:"businessKey"`
	PersonnelID         string             `json:"personnelId"`
	PersonnelName       string             `json:"personnelName"`
	Kind                string             `json:"kind"`
	Aspects             []string           `json:"aspects"`
	AreaID              *string            `json:"areaId"`
	RecordIDs           []string           `json:"recordIds"`
	CurrentMasterFields imports.Fields     `json:"currentMasterFields"`
	DiffFields          []string           `json:"diffFields"`
	Dates               []imports.DateFact `json:"dates"`
	RowNumbers          []int              `json:"rowNumbers"`
	Reason              string             `json:"reason"`
	Candidate           *imports.Candidate `json:"candidate"`
	Status              string             `json:"status"`
	Resolution          map[string]any     `json:"resolution"`
	DecisionVersion     int                `json:"decisionVersion"`
	CreatedAt           time.Time          `json:"createdAt"`
	UpdatedAt           time.Time          `json:"updatedAt"`
}

const reviewSelect = `SELECT id, business_key, personnel_id, personnel_name, kind, aspects, area_id, record_ids, current_master_fields, diff_fields, dates, row_numbers,
	reason, candidate, status, resolution, decision_version, created_at, updated_at FROM import_review_items WHERE `

func scanReviews(rows pgx.Rows) ([]ReviewItemView, error) {
	defer rows.Close()
	out := []ReviewItemView{}
	for rows.Next() {
		var r ReviewItemView
		var current, dates, cand, resolution []byte
		if err := rows.Scan(&r.ID, &r.BusinessKey, &r.PersonnelID, &r.PersonnelName, &r.Kind, &r.Aspects, &r.AreaID, &r.RecordIDs, &current, &r.DiffFields, &dates, &r.RowNumbers,
			&r.Reason, &cand, &r.Status, &resolution, &r.DecisionVersion, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		if len(current) > 0 {
			r.CurrentMasterFields = fieldsFromJSON(current)
		}
		_ = json.Unmarshal(dates, &r.Dates)
		if len(cand) > 0 {
			_ = json.Unmarshal(cand, &r.Candidate)
		}
		if len(resolution) > 0 {
			_ = json.Unmarshal(resolution, &r.Resolution)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Review items are scoped by area; items without an area need all-area scope.
const reviewScope = `($1::text[] IS NULL OR area_id = ANY($1))`

func (s *Service) reviewItemsFor(ctx context.Context, p *access.Principal, e domain.Employee) ([]ReviewItemView, error) {
	rows, err := s.Pool.Query(ctx, reviewSelect+reviewScope+` AND business_key = $2 AND status IN ('PENDING','KEPT_PENDING') ORDER BY created_at`, scopeArgs(p), imports.BusinessKey(e.PersonnelID))
	if err != nil {
		return nil, err
	}
	return scanReviews(rows)
}

type ImportOverview struct {
	Batches       []ImportBatchView  `json:"batches"`
	ReviewItems   []ReviewItemView   `json:"reviewItems"`
	SourceRecords []SourceRecordView `json:"sourceRecords"`
}

type ImportBatchView struct {
	ID        string          `json:"id"`
	FileName  string          `json:"fileName"`
	SheetName string          `json:"sheetName"`
	Status    string          `json:"status"`
	Summary   imports.Summary `json:"summary"`
	CreatedBy string          `json:"createdBy"`
	CreatedAt time.Time       `json:"createdAt"`
}

// ImportOverview lists recent batches (own batches unless all-area) and the scoped review queue
// with the source records it references.
func (s *Service) ImportOverview(ctx context.Context, p *access.Principal, status string) (*ImportOverview, error) {
	if err := requireAny(p, access.ImportPersonnel, access.ViewImportReview); err != nil {
		return nil, err
	}
	ov := &ImportOverview{Batches: []ImportBatchView{}, ReviewItems: []ReviewItemView{}, SourceRecords: []SourceRecordView{}}
	rows, err := s.Pool.Query(ctx, `SELECT id, file_name, sheet_name, status, summary, created_by, created_at FROM import_batches WHERE ($1 OR created_by = $2) ORDER BY created_at DESC LIMIT 50`, p.AllAreas(), p.UserID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var b ImportBatchView
		var summary []byte
		if err := rows.Scan(&b.ID, &b.FileName, &b.SheetName, &b.Status, &summary, &b.CreatedBy, &b.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		_ = json.Unmarshal(summary, &b.Summary)
		ov.Batches = append(ov.Batches, b)
	}
	rows.Close()
	if !p.Has(access.ViewImportReview) {
		return ov, nil
	}
	where := reviewScope
	args := []any{scopeArgs(p)}
	if status != "" {
		where += ` AND status = ANY($2)`
		args = append(args, strings.Split(status, ","))
	}
	rrows, err := s.Pool.Query(ctx, reviewSelect+where+` ORDER BY created_at DESC LIMIT 1000`, args...)
	if err != nil {
		return nil, err
	}
	if ov.ReviewItems, err = scanReviews(rrows); err != nil {
		return nil, err
	}
	var ids []string
	for _, r := range ov.ReviewItems {
		ids = append(ids, r.RecordIDs...)
	}
	ov.SourceRecords, err = s.sourceRecords(ctx, s.Pool, ids)
	return ov, err
}

func (s *Service) sourceRecords(ctx context.Context, q db.Querier, ids []string) ([]SourceRecordView, error) {
	out := []SourceRecordView{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT id, business_key, personnel_id, name, batch_id, file_name, sheet_name, row_number, fields, fingerprint, warnings, reconciliation_status, created_at
		FROM import_source_records WHERE id = ANY($1) ORDER BY business_key, row_number`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var r SourceRecordView
		var fields, warnings []byte
		if err := rows.Scan(&r.ID, &r.BusinessKey, &r.PersonnelID, &r.Name, &r.BatchID, &r.FileName, &r.SheetName, &r.RowNumber, &fields, &r.Fingerprint, &warnings, &r.ReconciliationStatus, &r.CreatedAt); err != nil {
			return nil, err
		}
		r.Fields = fieldsFromJSON(fields)
		_ = json.Unmarshal(warnings, &r.Warnings)
		out = append(out, r)
	}
	return out, rows.Err()
}

// BatchExceptions returns rows rejected in a batch to its creator or an all-area user.
func (s *Service) BatchExceptions(ctx context.Context, p *access.Principal, batchID string) ([]imports.ExceptionPlan, error) {
	if err := requireAny(p, access.ImportPersonnel, access.ViewImportReview); err != nil {
		return nil, err
	}
	var owner string
	if err := s.Pool.QueryRow(ctx, `SELECT created_by FROM import_batches WHERE id = $1`, batchID).Scan(&owner); err != nil || (owner != p.UserID && !p.AllAreas()) {
		return nil, httpx.NotFound("Batch")
	}
	rows, err := s.Pool.Query(ctx, `SELECT id, row_number, reason, raw_values FROM import_exceptions WHERE batch_id = $1 ORDER BY row_number`, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []imports.ExceptionPlan{}
	for rows.Next() {
		var e imports.ExceptionPlan
		var raw []byte
		if err := rows.Scan(&e.ID, &e.RowNumber, &e.Reason, &raw); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(raw, &e.RawValues)
		out = append(out, e)
	}
	return out, rows.Err()
}

type ReviewDecision struct {
	DecisionKind            string  `json:"decisionKind"`
	MovementType            string  `json:"movementType"`
	EffectiveDate           *string `json:"effectiveDate"`
	ExitScope               string  `json:"exitScope"`
	BeforeRecordID          *string `json:"beforeRecordId"`
	AfterRecordID           *string `json:"afterRecordId"`
	Note                    string  `json:"note"`
	KeepPending             bool    `json:"keepPending"`
	ExpectedDecisionVersion *int    `json:"expectedDecisionVersion"`
}

var decisionKinds = map[string]bool{"IDENTICAL_DUPLICATE": true, "PROFILE_VARIATION": true, "PLACEMENT_CHANGE": true, "EXIT": true, "REENTRY": true, "IDENTITY_CONFLICT": true, "UNDETERMINED": true}

func validateReviewDecision(d ReviewDecision, records map[string]SourceRecordView) []string {
	var errs []string
	if d.KeepPending {
		return nil
	}
	if !decisionKinds[d.DecisionKind] {
		return []string{"Jenis keputusan tidak dikenal."}
	}
	if d.DecisionKind == "IDENTITY_CONFLICT" {
		errs = append(errs, "Konflik identitas tidak dapat diselesaikan sebagai merge tanpa kebijakan bisnis. Simpan sebagai pending.")
	}
	needsDate := d.DecisionKind == "PLACEMENT_CHANGE" || d.DecisionKind == "EXIT" || d.DecisionKind == "REENTRY"
	if needsDate && (d.EffectiveDate == nil || !domain.ValidDate(*d.EffectiveDate)) {
		errs = append(errs, "Tanggal efektif wajib diisi untuk keputusan ini.")
	}
	if d.DecisionKind == "EXIT" && d.ExitScope != "PLACEMENT_END" && d.ExitScope != "EMPLOYMENT_END" {
		errs = append(errs, "Pilih akhir penempatan atau akhir hubungan kerja.")
	}
	before, after := deref(d.BeforeRecordID), deref(d.AfterRecordID)
	if d.DecisionKind == "PLACEMENT_CHANGE" || d.DecisionKind == "REENTRY" {
		if before == "" || after == "" {
			errs = append(errs, "Kondisi sebelum dan sesudah wajib dipilih.")
		}
		if before != "" && before == after {
			errs = append(errs, "Kondisi sebelum dan sesudah harus berbeda.")
		}
		if _, ok := records[after]; after != "" && !ok {
			errs = append(errs, "Catatan kondisi sesudah tidak ditemukan.")
		}
	}
	if d.DecisionKind == "PLACEMENT_CHANGE" {
		b, okB := records[before]
		aft, okA := records[after]
		if okB && okA && b.Fields.Get("areaCbs") == aft.Fields.Get("areaCbs") && b.Fields.Get("projectName") == aft.Fields.Get("projectName") && b.Fields.Get("position") == aft.Fields.Get("position") {
			errs = append(errs, "Keputusan mutation harus memiliki perubahan Area, Project, atau Position.")
		}
	}
	if d.DecisionKind == "REENTRY" && d.EffectiveDate != nil {
		latest := ""
		for _, r := range records {
			if v := r.Fields.Get("exitDate"); v > latest {
				latest = v
			}
		}
		if latest != "" && *d.EffectiveDate <= latest {
			errs = append(errs, "Tanggal re-entry harus setelah tanggal exit terakhir.")
		}
	}
	if d.DecisionKind == "PROFILE_VARIATION" && after != "" {
		if _, ok := records[after]; !ok {
			errs = append(errs, "Catatan profil terpilih tidak ditemukan.")
		}
	}
	return errs
}

// DecideReview resolves one review item. Decisions are final once confirmed or
// dismissed; repeated submissions return 409 and never duplicate timeline events.
func (s *Service) DecideReview(ctx context.Context, a Actor, id string, d ReviewDecision) error {
	p := a.P
	if err := require(p, access.ResolveImportReview, access.ViewImportReview); err != nil {
		return err
	}
	return s.tx(ctx, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, reviewSelect+`id = $1 FOR UPDATE`, id)
		if err != nil {
			return err
		}
		items, err := scanReviews(rows)
		if err != nil {
			return err
		}
		if len(items) == 0 || !p.CoversArea(items[0].AreaID) {
			return httpx.NotFound("Review item")
		}
		item := items[0]
		if item.Status != "PENDING" && item.Status != "KEPT_PENDING" {
			return httpx.Conflict("ALREADY_DECIDED", "Review item ini sudah diputuskan.")
		}
		if d.ExpectedDecisionVersion != nil && *d.ExpectedDecisionVersion != item.DecisionVersion {
			return errStale
		}
		now := s.now()
		version := item.DecisionVersion + 1
		raw, _ := json.Marshal(d)
		if _, err := tx.Exec(ctx, `INSERT INTO import_review_decisions (review_item_id, decision_version, decision, decided_by, decided_at) VALUES ($1,$2,$3,$4,$5)`, id, version, raw, p.UserID, now); err != nil {
			if db.IsUniqueViolation(err, "") {
				return httpx.Conflict("ALREADY_DECIDED", "Keputusan untuk versi ini sudah tercatat.")
			}
			return err
		}
		if d.KeepPending || d.DecisionKind == "IDENTITY_CONFLICT" {
			_, err := tx.Exec(ctx, `UPDATE import_review_items SET status = 'KEPT_PENDING', decision_version = $2, updated_at = $3 WHERE id = $1`, id, version, now)
			return err
		}
		recs, err := s.sourceRecords(ctx, tx, item.RecordIDs)
		if err != nil {
			return err
		}
		byID := map[string]SourceRecordView{}
		for _, r := range recs {
			byID[r.ID] = r
		}
		if errs := validateReviewDecision(d, byID); len(errs) > 0 {
			return &httpx.Error{Status: 422, Code: "INVALID_DECISION", Message: strings.Join(errs, " ")}
		}
		var masterID string
		if err := tx.QueryRow(ctx, `SELECT id FROM personnel WHERE business_key = $1`, item.BusinessKey).Scan(&masterID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.Conflict("MASTER_MISSING", "Current master tidak ditemukan; keputusan tidak disimpan.")
			}
			return err
		}
		master, err := loadEmployee(ctx, tx, masterID, true)
		if err != nil {
			return err
		}
		if !p.CoversArea(master.AreaID) {
			return httpx.NotFound("Review item")
		}
		confirms := d.DecisionKind == "PLACEMENT_CHANGE" || d.DecisionKind == "EXIT" || d.DecisionKind == "REENTRY"
		status := "DISMISSED"
		if confirms {
			status = "CONFIRMED"
		}
		if err := s.applyReview(ctx, tx, a, item, d, master, byID, version, now); err != nil {
			return err
		}
		resolution, _ := json.Marshal(map[string]any{"decisionKind": d.DecisionKind, "movementType": d.MovementType, "effectiveDate": d.EffectiveDate, "exitScope": d.ExitScope,
			"beforeRecordId": d.BeforeRecordID, "afterRecordId": d.AfterRecordID, "note": d.Note, "reviewedBy": p.UserID, "reviewedAt": now, "decisionVersion": version})
		if _, err := tx.Exec(ctx, `UPDATE import_review_items SET status = $2, resolution = $3, decision_version = $4, updated_at = $5 WHERE id = $1`, id, status, resolution, version, now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE import_source_records SET reconciliation_status = 'CONFIRMED' WHERE id = ANY($1) AND $2`, item.RecordIDs, confirms); err != nil {
			return err
		}
		return s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "import.review.decide", EntityType: "import_review_item", EntityID: id, PersonnelID: &master.ID, AreaID: master.AreaID,
			Details: map[string]any{"decisionKind": d.DecisionKind, "status": status, "version": version}})
	})
}

func (s *Service) lookupArea(ctx context.Context, q db.Querier, name string) *string {
	if strings.TrimSpace(name) == "" {
		return nil
	}
	var id string
	if err := q.QueryRow(ctx, `SELECT id FROM areas WHERE name_key = $1`, imports.NameKey(name)).Scan(&id); err != nil {
		return nil
	}
	return &id
}

func (s *Service) lookupProject(ctx context.Context, q db.Querier, name string, areaID *string) *string {
	if strings.TrimSpace(name) == "" || areaID == nil {
		return nil
	}
	var id string
	if err := q.QueryRow(ctx, `SELECT id FROM projects WHERE name_key = $1 AND area_id = $2`, imports.NameKey(name), *areaID).Scan(&id); err != nil {
		return nil
	}
	return &id
}

func (s *Service) applyReview(ctx context.Context, tx pgx.Tx, a Actor, item ReviewItemView, d ReviewDecision, master domain.Employee, recs map[string]SourceRecordView, version int, now time.Time) error {
	var otherPending bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM import_review_items WHERE business_key = $1 AND id <> $2 AND status IN ('PENDING','KEPT_PENDING'))`, item.BusinessKey, item.ID).Scan(&otherPending); err != nil {
		return err
	}
	condition := "CONFIRMED"
	if otherPending {
		condition = "NEEDS_REVIEW"
	}
	areaID, projectID, position := master.AreaID, master.ProjectID, master.Position
	name, subArea, join, cStart, cEnd := master.Name, master.SubArea, master.JoinDate, master.ContractStartDate, master.ContractEndDate
	profile := master.Profile
	after, hasAfter := recs[deref(d.AfterRecordID)]
	if hasAfter && (d.DecisionKind == "PLACEMENT_CHANGE" || d.DecisionKind == "REENTRY" || d.DecisionKind == "PROFILE_VARIATION") {
		f := after.Fields
		if id := s.lookupArea(ctx, tx, f.Get("areaCbs")); id != nil {
			areaID = id
		}
		if id := s.lookupProject(ctx, tx, f.Get("projectName"), areaID); id != nil {
			projectID = id
		}
		set := func(dst **string, key string) {
			if v := f[key]; v != nil {
				*dst = v
			}
		}
		if v := f.Get("name"); v != "" {
			name = v
		}
		set(&subArea, "subArea")
		set(&position, "position")
		set(&join, "joinDate")
		set(&cStart, "contractStartDate")
		set(&cEnd, "contractEndDate")
		for k, v := range f {
			if v != nil && !imports.EmployeeFieldKeys[k] {
				profile[k] = *v
			}
		}
	}
	if !a.P.CoversArea(areaID) {
		return httpx.Forbidden()
	}
	employment := master.EmploymentStatus
	ref := "import-review:" + item.ID + ":" + itoa(version)
	movement := ""
	switch d.DecisionKind {
	case "PLACEMENT_CHANGE":
		movement = d.MovementType
		if movement == "" {
			movement = "MUTATION"
		}
	case "EXIT":
		movement = "EXIT"
		if d.ExitScope == "PLACEMENT_END" {
			movement = "OTHER"
		} else {
			employment = "INACTIVE"
		}
	case "REENTRY":
		movement, employment = "REENTRY", "ACTIVE"
	}
	profileJSON, _ := json.Marshal(profile)
	if _, err := tx.Exec(ctx, `UPDATE personnel SET name=$2, area_id=$3, project_id=$4, position=$5, sub_area=$6, join_date=$7, contract_start_date=$8, contract_end_date=$9,
		profile=$10, employment_status=$11, condition_status=$12, updated_at=$13, version = version + 1 WHERE id = $1`,
		master.ID, name, areaID, projectID, position, subArea, join, cStart, cEnd, profileJSON, employment, condition, now); err != nil {
		return err
	}
	if movement == "" {
		return nil
	}
	eff := *d.EffectiveDate
	switch {
	case employment == "INACTIVE" && master.EmploymentStatus == "ACTIVE":
		if _, err := tx.Exec(ctx, `UPDATE employment_periods SET closed = true, end_date = CASE WHEN start_date IS NULL OR start_date <= $2 THEN $2::date END, end_ref = $3 WHERE personnel_id = $1 AND NOT closed`, master.ID, eff, ref); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE placements SET closed = true, effective_to = $2 WHERE personnel_id = $1 AND NOT closed`, master.ID, eff); err != nil {
			return err
		}
	case d.DecisionKind == "REENTRY" || d.DecisionKind == "PLACEMENT_CHANGE":
		if d.DecisionKind == "REENTRY" {
			if _, err := tx.Exec(ctx, `UPDATE employment_periods SET closed = true WHERE personnel_id = $1 AND NOT closed`, master.ID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO employment_periods (id, personnel_id, start_date, start_kind, created_by, created_at) VALUES ($1,$2,$3,'REENTRY',$4,$5)`, newID("period"), master.ID, eff, a.P.UserID, now); err != nil {
				return err
			}
		}
		var periodID string
		if err := tx.QueryRow(ctx, `SELECT id FROM employment_periods WHERE personnel_id = $1 AND NOT closed`, master.ID).Scan(&periodID); err == nil {
			if _, err := tx.Exec(ctx, `UPDATE placements SET closed = true, effective_to = GREATEST(COALESCE(effective_from, $2::date - 1), $2::date - 1) WHERE personnel_id = $1 AND NOT closed`, master.ID, eff); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO placements (id, personnel_id, period_id, area_id, project_id, position, sub_area, effective_from, source, source_ref, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'IMPORT_REVIEW',$9,$10)`,
				newID("plc"), master.ID, periodID, areaID, projectID, position, subArea, eff, ref, now); err != nil {
				return err
			}
		}
	}
	var prevFields imports.Fields
	if deref(d.BeforeRecordID) == "CURRENT_MASTER" {
		prevFields = item.CurrentMasterFields
	} else if b, ok := recs[deref(d.BeforeRecordID)]; ok {
		prevFields = b.Fields
	}
	prevArea := s.lookupArea(ctx, tx, prevFields.Get("areaCbs"))
	note := strings.TrimSpace(d.Note)
	if note == "" {
		note = item.Reason
	}
	_, err := tx.Exec(ctx, `INSERT INTO career_events (id, personnel_id, movement_type, effective_date, previous_area_id, new_area_id, previous_project_id, new_project_id, previous_position, new_position, notes, source, source_ref, created_by, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'IMPORT_REVIEW',$12,$13,$14) ON CONFLICT (source_ref) DO NOTHING`,
		newID("ce"), master.ID, movement, eff, prevArea, areaID, s.lookupProject(ctx, tx, prevFields.Get("projectName"), prevArea), projectID,
		prevFields["position"], position, "Import Excel — "+note, ref, a.P.UserID, now)
	return err
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}
