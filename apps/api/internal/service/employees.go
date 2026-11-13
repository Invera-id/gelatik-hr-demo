package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
)

// summaryProfileKeys are the only profile fields returned in list/snapshot views;
// the full (sensitive) profile is returned by the detail endpoint only.
var summaryProfileKeys = []string{"areaCbs", "clientName", "projectName", "agreementTermination", "exitDate", "exitReason"}

const employeeSelect = `
SELECT p.id, p.personnel_id, p.name, p.area_id, p.sub_area, p.project_id, p.position, p.employment_status, p.condition_status,
       p.join_date::text, p.contract_start_date::text, p.contract_end_date::text, p.contract_status, p.bpjs_status, p.profile,
       p.created_by, p.record_status, p.validated_by, p.validated_at, p.submitted_at, p.revision_note, p.source, p.version,
       p.created_at, p.updated_at, cr.id, cr.status, cr.payload, cr.base_version
FROM personnel p
LEFT JOIN change_requests cr ON cr.personnel_id = p.id AND cr.transaction_type = 'EMPLOYEE_BASIC_EDIT' AND cr.status <> 'VALIDATED'`

func scanEmployee(row pgx.Row, fullProfile bool) (domain.Employee, error) {
	var e domain.Employee
	var profile []byte
	var crID, crStatus *string
	var crPayload []byte
	var crBase *int
	err := row.Scan(&e.ID, &e.PersonnelID, &e.Name, &e.AreaID, &e.SubArea, &e.ProjectID, &e.Position, &e.EmploymentStatus, &e.ConditionStatus,
		&e.JoinDate, &e.ContractStartDate, &e.ContractEndDate, &e.ContractStatus, &e.BPJSStatus, &profile,
		&e.CreatedBy, &e.ValidationStatus, &e.ValidatedBy, &e.ValidatedAt, &e.SubmittedAt, &e.RevisionNote, &e.Source, &e.Version,
		&e.CreatedAt, &e.UpdatedAt, &crID, &crStatus, &crPayload, &crBase)
	if err != nil {
		return e, err
	}
	all := map[string]any{}
	if len(profile) > 0 {
		if err := json.Unmarshal(profile, &all); err != nil {
			return e, err
		}
	}
	if fullProfile {
		e.Profile = all
	} else {
		e.Profile = map[string]any{}
		for _, k := range summaryProfileKeys {
			if v, ok := all[k]; ok && v != nil {
				e.Profile[k] = v
			}
		}
	}
	tx := string(access.TxEntry)
	if crID != nil {
		tx = string(access.TxBasicEdit)
		pc := &domain.PendingChange{RequestID: *crID, Status: *crStatus, Proposed: map[string]any{}}
		if crBase != nil {
			pc.BaseVersion = *crBase
		}
		if len(crPayload) > 0 {
			_ = json.Unmarshal(crPayload, &pc.Proposed)
		}
		if !fullProfile {
			delete(pc.Proposed, "profile")
		}
		e.PendingChange = pc
	}
	e.ValidationTransaction = &tx
	return e, nil
}

func collectEmployees(rows pgx.Rows, fullProfile bool) ([]domain.Employee, error) {
	defer rows.Close()
	out := []domain.Employee{}
	for rows.Next() {
		e, err := scanEmployee(rows, fullProfile)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// loadEmployee reads one record (optionally FOR UPDATE) without scope checks.
func loadEmployee(ctx context.Context, q db.Querier, id string, forUpdate bool) (domain.Employee, error) {
	sql := employeeSelect + ` WHERE p.id = $1`
	if forUpdate {
		sql += ` FOR UPDATE OF p`
	}
	return scanEmployee(q.QueryRow(ctx, sql, id), true)
}

// visibleEmployee loads a record and hides it (404) when outside the caller's scope.
func (s *Service) visibleEmployee(ctx context.Context, q db.Querier, p *access.Principal, id string, forUpdate bool) (domain.Employee, error) {
	e, err := loadEmployee(ctx, q, id, forUpdate)
	if err != nil {
		return e, notFoundOr(err, "Employee")
	}
	if !p.CoversArea(e.AreaID) {
		return e, httpx.NotFound("Employee")
	}
	return e, nil
}

type EmployeeQuery struct {
	Page             int
	PageSize         int
	Search           string
	AreaID           string
	ProjectID        string
	ClientName       string
	EmploymentStatus string
	ValidationStatus string
	ActiveOnly       bool
	Sort             string
}

type EmployeePage struct {
	Items    []domain.Employee `json:"items"`
	Total    int               `json:"total"`
	Page     int               `json:"page"`
	PageSize int               `json:"pageSize"`
}

var employeeSorts = map[string]string{
	"personnelId": "p.personnel_id", "-personnelId": "p.personnel_id DESC", "name": "lower(p.name)", "-name": "lower(p.name) DESC",
	"joinDate": "p.join_date NULLS LAST", "-joinDate": "p.join_date DESC NULLS LAST", "updatedAt": "p.updated_at", "-updatedAt": "p.updated_at DESC",
}

const MaxPageSize = 200

// ListEmployees is the server-side paginated, filtered, scoped employee list.
func (s *Service) ListEmployees(ctx context.Context, p *access.Principal, q EmployeeQuery) (*EmployeePage, error) {
	if err := require(p, access.ViewEmployee); err != nil {
		return nil, err
	}
	fe := httpx.FieldErrors{}
	if q.Page < 1 {
		q.Page = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 25
	}
	if q.PageSize > MaxPageSize {
		fe.Add("pageSize", fmt.Sprintf("Maksimal %d per halaman.", MaxPageSize))
	}
	order, ok := employeeSorts[q.Sort]
	if q.Sort == "" {
		order, ok = "p.personnel_id", true
	}
	if !ok {
		fe.Add("sort", "Urutan tidak dikenal.")
	}
	if q.EmploymentStatus != "" && q.EmploymentStatus != "ACTIVE" && q.EmploymentStatus != "INACTIVE" {
		fe.Add("employmentStatus", "Status tidak dikenal.")
	}
	if q.ValidationStatus != "" && !validStatus(q.ValidationStatus) {
		fe.Add("validationStatus", "Status validasi tidak dikenal.")
	}
	if err := fe.Err(); err != nil {
		return nil, err
	}
	where := []string{"($1::text[] IS NULL OR p.area_id = ANY($1))"}
	args := []any{scopeArgs(p)}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, strings.ReplaceAll(cond, "?", fmt.Sprintf("$%d", len(args))))
	}
	if q.Search != "" {
		add("(p.personnel_id ILIKE ? OR p.name ILIKE ?)", "%"+escapeLike(q.Search)+"%")
	}
	if q.AreaID != "" {
		add("p.area_id = ?", q.AreaID)
	}
	if q.ProjectID != "" {
		add("p.project_id = ?", q.ProjectID)
	}
	if q.ClientName != "" {
		add("COALESCE((SELECT client_name FROM projects pr WHERE pr.id = p.project_id), p.profile->>'clientName') = ?", q.ClientName)
	}
	if q.EmploymentStatus != "" {
		add("p.employment_status = ?", q.EmploymentStatus)
	}
	if q.ValidationStatus != "" {
		add("p.record_status = ?", q.ValidationStatus)
	}
	if q.ActiveOnly {
		where = append(where, "p.employment_status = 'ACTIVE' AND p.record_status = 'VALIDATED' AND p.condition_status <> 'NEEDS_REVIEW'")
	}
	cond := strings.Join(where, " AND ")
	var total int
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM personnel p WHERE "+cond, args...).Scan(&total); err != nil {
		return nil, err
	}
	args = append(args, q.PageSize, (q.Page-1)*q.PageSize)
	rows, err := s.Pool.Query(ctx, employeeSelect+" WHERE "+cond+" ORDER BY "+order+", p.id LIMIT $"+fmt.Sprint(len(args)-1)+" OFFSET $"+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, err
	}
	items, err := collectEmployees(rows, false)
	if err != nil {
		return nil, err
	}
	return &EmployeePage{Items: items, Total: total, Page: q.Page, PageSize: q.PageSize}, nil
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func validStatus(s string) bool {
	return s == "DRAFT" || s == "SUBMITTED" || s == "VALIDATED" || s == "REVISION_REQUIRED"
}

// EmployeeDetail bundles everything the detail page needs, all scope-checked.
type EmployeeDetail struct {
	Employee      domain.Employee        `json:"employee"`
	Timeline      []domain.CareerEvent   `json:"timeline"`
	Activity      []domain.ActivityEvent `json:"activity"`
	Exits         []domain.EmployeeExit  `json:"exits"`
	Notes         []domain.EmployeeNote  `json:"notes"`
	Flags         []domain.EmployeeFlag  `json:"flags"`
	PendingReview []ReviewItemView       `json:"pendingReview"`
}

func (s *Service) GetEmployee(ctx context.Context, p *access.Principal, id string) (*EmployeeDetail, error) {
	if err := require(p, access.ViewEmployee); err != nil {
		return nil, err
	}
	e, err := s.visibleEmployee(ctx, s.Pool, p, id, false)
	if err != nil {
		return nil, err
	}
	d := &EmployeeDetail{Employee: e}
	if d.Timeline, err = s.careerEvents(ctx, s.Pool, "ce.personnel_id = $1", id); err != nil {
		return nil, err
	}
	if d.Activity, err = s.activity(ctx, s.Pool, "a.personnel_id = $1", id); err != nil {
		return nil, err
	}
	if d.Exits, err = s.exitRequests(ctx, s.Pool, "cr.personnel_id = $1", id); err != nil {
		return nil, err
	}
	if d.Notes, err = s.notes(ctx, s.Pool, "personnel_id = $1", id); err != nil {
		return nil, err
	}
	if d.Flags, err = s.flags(ctx, s.Pool, "personnel_id = $1", id); err != nil {
		return nil, err
	}
	if p.Has(access.ViewImportReview) {
		if d.PendingReview, err = s.reviewItemsFor(ctx, p, e); err != nil {
			return nil, err
		}
	} else {
		d.PendingReview = []ReviewItemView{}
	}
	if e.Source == "IMPORT" {
		hist := domain.DeriveHistoricalWorkforce([]domain.Employee{e})
		for _, m := range hist.Movements {
			if m.EmployeeID == id {
				d.Timeline = append(d.Timeline, m)
			}
		}
		d.Exits = append(d.Exits, hist.Exits...)
	}
	return d, nil
}

func (s *Service) careerEvents(ctx context.Context, q db.Querier, where string, args ...any) ([]domain.CareerEvent, error) {
	rows, err := q.Query(ctx, `SELECT ce.id, ce.personnel_id, ce.movement_type, ce.effective_date::text, ce.previous_area_id, ce.new_area_id,
		ce.previous_project_id, ce.new_project_id, ce.previous_position, ce.new_position, ce.notes, ce.created_by, ce.created_at
		FROM career_events ce WHERE `+where+` ORDER BY ce.effective_date DESC, ce.created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.CareerEvent{}
	for rows.Next() {
		var m domain.CareerEvent
		if err := rows.Scan(&m.ID, &m.EmployeeID, &m.MovementType, &m.EffectiveDate, &m.PreviousAreaID, &m.NewAreaID, &m.PreviousProjectID, &m.NewProjectID, &m.PreviousPosition, &m.NewPosition, &m.Notes, &m.CreatedBy, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Service) activity(ctx context.Context, q db.Querier, where string, args ...any) ([]domain.ActivityEvent, error) {
	rows, err := q.Query(ctx, `SELECT a.id, a.personnel_id, a.activity_type, a.title, COALESCE(a.description, ''), a.occurred_at
		FROM audit_log a WHERE a.activity_type IS NOT NULL AND `+where+` ORDER BY a.occurred_at DESC LIMIT 500`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ActivityEvent{}
	for rows.Next() {
		var a domain.ActivityEvent
		var id int64
		if err := rows.Scan(&id, &a.EmployeeID, &a.Type, &a.Title, &a.Description, &a.Date); err != nil {
			return nil, err
		}
		a.ID = fmt.Sprintf("act-%d", id)
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Service) notes(ctx context.Context, q db.Querier, where string, args ...any) ([]domain.EmployeeNote, error) {
	rows, err := q.Query(ctx, `SELECT id, personnel_id, notes, created_by, created_at FROM employee_notes WHERE `+where+` ORDER BY created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.EmployeeNote{}
	for rows.Next() {
		var n domain.EmployeeNote
		if err := rows.Scan(&n.ID, &n.EmployeeID, &n.Notes, &n.CreatedBy, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Service) flags(ctx context.Context, q db.Querier, where string, args ...any) ([]domain.EmployeeFlag, error) {
	rows, err := q.Query(ctx, `SELECT id, personnel_id, status, reason, notes, created_by, created_at FROM employee_flags WHERE `+where+` ORDER BY created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.EmployeeFlag{}
	for rows.Next() {
		var f domain.EmployeeFlag
		if err := rows.Scan(&f.ID, &f.EmployeeID, &f.Status, &f.Reason, &f.Notes, &f.CreatedBy, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

const exitSelect = `SELECT cr.id, cr.personnel_id, cr.exit_date::text, COALESCE(cr.exit_reason, ''), cr.replacement_required, cr.created_by, cr.status,
	cr.validated_by, cr.validated_at, cr.submitted_at, cr.revision_note, cr.created_at, cr.updated_at
	FROM change_requests cr WHERE cr.transaction_type = 'EMPLOYEE_EXIT' AND `

func (s *Service) exitRequests(ctx context.Context, q db.Querier, where string, args ...any) ([]domain.EmployeeExit, error) {
	rows, err := q.Query(ctx, exitSelect+where+` ORDER BY cr.created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.EmployeeExit{}
	for rows.Next() {
		var x domain.EmployeeExit
		if err := rows.Scan(&x.ID, &x.EmployeeID, &x.ExitDate, &x.ExitReason, &x.ReplacementRequired, &x.CreatedBy, &x.ValidationStatus, &x.ValidatedBy, &x.ValidatedAt, &x.SubmittedAt, &x.RevisionNote, &x.CreatedAt, &x.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

const movementSelect = `SELECT cr.id, cr.personnel_id, cr.movement_type, cr.effective_date::text,
	cr.payload->>'previousAreaId', cr.payload->>'newAreaId', cr.payload->>'previousProjectId', cr.payload->>'newProjectId',
	cr.payload->>'previousPosition', cr.payload->>'newPosition', COALESCE(cr.payload->>'notes', ''), cr.created_by, cr.status,
	cr.validated_by, cr.validated_at, cr.submitted_at, cr.revision_note, cr.base_version, cr.created_at, cr.updated_at
	FROM change_requests cr WHERE cr.transaction_type = 'EMPLOYEE_PLACEMENT_CHANGE' AND `

func (s *Service) movementRequests(ctx context.Context, q db.Querier, where string, args ...any) ([]domain.PlacementChangeRequest, error) {
	rows, err := q.Query(ctx, movementSelect+where+` ORDER BY cr.created_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.PlacementChangeRequest{}
	for rows.Next() {
		var m domain.PlacementChangeRequest
		if err := rows.Scan(&m.ID, &m.EmployeeID, &m.MovementType, &m.EffectiveDate, &m.PreviousAreaID, &m.NewAreaID, &m.PreviousProjectID, &m.NewProjectID,
			&m.PreviousPosition, &m.NewPosition, &m.Notes, &m.CreatedBy, &m.ValidationStatus, &m.ValidatedBy, &m.ValidatedAt, &m.SubmittedAt, &m.RevisionNote, &m.BaseVersion, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
