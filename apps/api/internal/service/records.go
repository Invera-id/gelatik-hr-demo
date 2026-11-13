package service

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/imports"
)

// Workspace is reference data every page needs. Area names are reference data and
// are returned in full; projects and quotas are limited to the caller's scope.
type Workspace struct {
	BusinessDate     string                  `json:"businessDate"`
	Areas            []domain.Area           `json:"areas"`
	Projects         []domain.Project        `json:"projects"`
	ProjectQuotas    []domain.ProjectQuota   `json:"projectQuotas"`
	PermissionConfig []access.RoleConfig     `json:"permissionConfig"`
	ValidationPolicy access.ValidationPolicy `json:"validationPolicy"`
	Users            []domain.UserSummary    `json:"users"`
}

func (s *Service) Workspace(ctx context.Context, p *access.Principal) (*Workspace, error) {
	w := &Workspace{BusinessDate: s.Today(), ValidationPolicy: p.Policy}
	var err error
	if w.Areas, err = s.areas(ctx, s.Pool); err != nil {
		return nil, err
	}
	if w.Projects, err = s.projects(ctx, s.Pool, scopeArgs(p)); err != nil {
		return nil, err
	}
	if w.ProjectQuotas, err = s.quotas(ctx, s.Pool, scopeArgs(p)); err != nil {
		return nil, err
	}
	if w.PermissionConfig, err = loadRoleConfigs(ctx, s.Pool); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT id, name, role, area_id FROM users WHERE active ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	w.Users = []domain.UserSummary{}
	for rows.Next() {
		var u domain.UserSummary
		if err := rows.Scan(&u.ID, &u.Name, &u.Role, &u.AreaID); err != nil {
			return nil, err
		}
		w.Users = append(w.Users, u)
	}
	return w, rows.Err()
}

func (s *Service) areas(ctx context.Context, q db.Querier) ([]domain.Area, error) {
	rows, err := q.Query(ctx, `SELECT id, name FROM areas ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Area{}
	for rows.Next() {
		var a domain.Area
		if err := rows.Scan(&a.ID, &a.Name); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Service) projects(ctx context.Context, q db.Querier, scope []string) ([]domain.Project, error) {
	rows, err := q.Query(ctx, `SELECT id, name, client_name, area_id, sub_area, status, start_date::text, end_date::text FROM projects WHERE ($1::text[] IS NULL OR area_id = ANY($1)) ORDER BY name`, scope)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.Project{}
	for rows.Next() {
		var pr domain.Project
		if err := rows.Scan(&pr.ID, &pr.Name, &pr.ClientName, &pr.AreaID, &pr.SubArea, &pr.Status, &pr.StartDate, &pr.EndDate); err != nil {
			return nil, err
		}
		out = append(out, pr)
	}
	return out, rows.Err()
}

func (s *Service) quotas(ctx context.Context, q db.Querier, scope []string) ([]domain.ProjectQuota, error) {
	rows, err := q.Query(ctx, `SELECT pq.project_id, pq.period, pq.quota FROM project_quotas pq JOIN projects pr ON pr.id = pq.project_id WHERE ($1::text[] IS NULL OR pr.area_id = ANY($1)) ORDER BY pq.project_id, pq.period`, scope)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.ProjectQuota{}
	for rows.Next() {
		var x domain.ProjectQuota
		if err := rows.Scan(&x.ProjectID, &x.Period, &x.Quota); err != nil {
			return nil, err
		}
		x.ID = x.ProjectID + ":" + x.Period
		out = append(out, x)
	}
	return out, rows.Err()
}

// Snapshot is the scoped operational dataset used by analytics-style pages.
// Profiles are reduced to non-sensitive keys; full profiles require the detail endpoint.
type Snapshot struct {
	Employees         []domain.Employee               `json:"employees"`
	EmployeeExits     []domain.EmployeeExit           `json:"employeeExits"`
	ReplacementNeeds  []domain.ReplacementNeed        `json:"replacementNeeds"`
	EmployeeMovements []domain.CareerEvent            `json:"employeeMovements"`
	MovementRequests  []domain.PlacementChangeRequest `json:"movementRequests"`
	Movements         []domain.ActivityEvent          `json:"movements"`
	EmployeeNotes     []domain.EmployeeNote           `json:"employeeNotes"`
	EmployeeFlags     []domain.EmployeeFlag           `json:"employeeFlags"`
}

// loadScoped reads every scoped collection in one repeatable-read snapshot so all
// views (dashboard, list, export) are computed from the same consistent state.
func (s *Service) loadScoped(ctx context.Context, p *access.Principal) (*Snapshot, error) {
	scope := scopeArgs(p)
	snap := &Snapshot{}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	rows, err := tx.Query(ctx, employeeSelect+` WHERE ($1::text[] IS NULL OR p.area_id = ANY($1)) ORDER BY p.personnel_id`, scope)
	if err != nil {
		return nil, err
	}
	if snap.Employees, err = collectEmployees(rows, false); err != nil {
		return nil, err
	}
	inScope := `cr.personnel_id IN (SELECT id FROM personnel WHERE ($1::text[] IS NULL OR area_id = ANY($1)))`
	if snap.EmployeeExits, err = s.exitRequests(ctx, tx, inScope, scope); err != nil {
		return nil, err
	}
	if snap.MovementRequests, err = s.movementRequests(ctx, tx, `($1::text[] IS NULL OR cr.origin_area_id = ANY($1) OR cr.target_area_id = ANY($1))`, scope); err != nil {
		return nil, err
	}
	if snap.ReplacementNeeds, err = s.needs(ctx, tx, `($1::text[] IS NULL OR rn.area_id = ANY($1))`, scope); err != nil {
		return nil, err
	}
	if snap.EmployeeMovements, err = s.careerEvents(ctx, tx, `ce.personnel_id IN (SELECT id FROM personnel WHERE ($1::text[] IS NULL OR area_id = ANY($1)))`, scope); err != nil {
		return nil, err
	}
	if snap.Movements, err = s.activity(ctx, tx, `a.personnel_id IN (SELECT id FROM personnel WHERE ($1::text[] IS NULL OR area_id = ANY($1)))`, scope); err != nil {
		return nil, err
	}
	personScope := `personnel_id IN (SELECT id FROM personnel WHERE ($1::text[] IS NULL OR area_id = ANY($1)))`
	if snap.EmployeeNotes, err = s.notes(ctx, tx, personScope, scope); err != nil {
		return nil, err
	}
	if snap.EmployeeFlags, err = s.flags(ctx, tx, personScope, scope); err != nil {
		return nil, err
	}
	// Read-only historical view inferred from validated imported masters (never persisted).
	var imported []domain.Employee
	for _, e := range snap.Employees {
		if e.Source == "IMPORT" {
			imported = append(imported, e)
		}
	}
	hist := domain.DeriveHistoricalWorkforce(imported)
	snap.EmployeeExits = append(snap.EmployeeExits, hist.Exits...)
	snap.ReplacementNeeds = append(snap.ReplacementNeeds, hist.Needs...)
	snap.EmployeeMovements = append(snap.EmployeeMovements, hist.Movements...)
	return snap, tx.Commit(ctx)
}

func (s *Service) Snapshot(ctx context.Context, p *access.Principal) (*Snapshot, error) {
	if err := require(p, access.ViewDashboard); err != nil {
		if err := require(p, access.ViewEmployee); err != nil {
			return nil, err
		}
	}
	snap, err := s.loadScoped(ctx, p)
	if err != nil {
		return nil, err
	}
	if !p.Has(access.ViewReplacement) {
		snap.ReplacementNeeds = []domain.ReplacementNeed{}
	}
	if !p.Has(access.ViewMovementHistory) && !p.Has(access.ViewEmployee) {
		snap.EmployeeMovements = []domain.CareerEvent{}
	}
	return snap, nil
}

type NoteInput struct {
	Notes     string     `json:"notes"`
	ClientRef *uuid.UUID `json:"clientRef"`
}

type FlagInput struct {
	Status    string     `json:"status"`
	Reason    string     `json:"reason"`
	Notes     string     `json:"notes"`
	ClientRef *uuid.UUID `json:"clientRef"`
}

// AddNote appends a note. clientRef makes retries/double clicks idempotent.
func (s *Service) AddNote(ctx context.Context, a Actor, employeeID string, in NoteInput) error {
	if err := require(a.P, access.ManageNotesFlags); err != nil {
		return err
	}
	in.Notes = strings.TrimSpace(in.Notes)
	if in.Notes == "" {
		return httpx.Validation(map[string]string{"notes": "Catatan wajib diisi."})
	}
	return s.tx(ctx, func(tx pgx.Tx) error {
		e, err := s.visibleEmployee(ctx, tx, a.P, employeeID, false)
		if err != nil {
			return err
		}
		id := newID("note")
		tag, err := tx.Exec(ctx, `INSERT INTO employee_notes (id, personnel_id, notes, client_ref, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (client_ref) DO NOTHING`,
			id, e.ID, in.Notes, in.ClientRef, a.P.UserID, s.now())
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		return s.audit(ctx, tx, a.P.UserID, a.RequestID, auditEntry{Action: "employee.note.add", EntityType: "employee_note", EntityID: id, PersonnelID: &e.ID, AreaID: e.AreaID})
	})
}

func (s *Service) SetFlag(ctx context.Context, a Actor, employeeID string, in FlagInput) error {
	if err := require(a.P, access.ManageNotesFlags); err != nil {
		return err
	}
	if in.Status != "NORMAL" && in.Status != "REVIEW_REQUIRED" && in.Status != "FLAGGED" {
		return httpx.Validation(map[string]string{"status": "Status flag tidak dikenal."})
	}
	return s.tx(ctx, func(tx pgx.Tx) error {
		e, err := s.visibleEmployee(ctx, tx, a.P, employeeID, false)
		if err != nil {
			return err
		}
		id := newID("flag")
		tag, err := tx.Exec(ctx, `INSERT INTO employee_flags (id, personnel_id, status, reason, notes, client_ref, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (client_ref) DO NOTHING`,
			id, e.ID, in.Status, strings.TrimSpace(in.Reason), strings.TrimSpace(in.Notes), in.ClientRef, a.P.UserID, s.now())
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		return s.audit(ctx, tx, a.P.UserID, a.RequestID, auditEntry{Action: "employee.flag.set", EntityType: "employee_flag", EntityID: id, PersonnelID: &e.ID, AreaID: e.AreaID, Details: map[string]any{"status": in.Status}})
	})
}

type ProjectInput struct {
	Name       string  `json:"name"`
	ClientName string  `json:"clientName"`
	AreaID     string  `json:"areaId"`
	SubArea    *string `json:"subArea"`
	Status     string  `json:"status"`
	StartDate  *string `json:"startDate"`
	EndDate    *string `json:"endDate"`
}

func (s *Service) SaveProject(ctx context.Context, a Actor, id string, in ProjectInput) (*domain.Project, error) {
	p := a.P
	if err := require(p, access.ManageProject); err != nil {
		return nil, err
	}
	in.Name, in.ClientName = strings.TrimSpace(in.Name), strings.TrimSpace(in.ClientName)
	in.SubArea, in.StartDate, in.EndDate = trimPtr(in.SubArea), trimPtr(in.StartDate), trimPtr(in.EndDate)
	fe := httpx.FieldErrors{}
	if in.Name == "" {
		fe.Add("name", "Wajib diisi.")
	}
	if in.ClientName == "" {
		fe.Add("clientName", "Wajib diisi.")
	}
	if in.AreaID == "" {
		fe.Add("areaId", "Wajib diisi.")
	}
	if in.Status == "" {
		in.Status = "ACTIVE"
	}
	if in.Status != "ACTIVE" && in.Status != "INACTIVE" {
		fe.Add("status", "Status tidak dikenal.")
	}
	checkDate(fe, "startDate", in.StartDate, false)
	checkDate(fe, "endDate", in.EndDate, false)
	if in.StartDate != nil && in.EndDate != nil && *in.EndDate < *in.StartDate {
		fe.Add("endDate", "Tanggal selesai tidak boleh sebelum tanggal mulai.")
	}
	if err := fe.Err(); err != nil {
		return nil, err
	}
	if !p.CoversArea(&in.AreaID) {
		return nil, httpx.Forbidden()
	}
	err := s.tx(ctx, func(tx pgx.Tx) error {
		now := s.now()
		if id == "" {
			id = newID("project")
			_, err := tx.Exec(ctx, `INSERT INTO projects (id, name, name_key, client_name, area_id, sub_area, status, start_date, end_date, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
				id, in.Name, imports.NameKey(in.Name), in.ClientName, in.AreaID, in.SubArea, in.Status, in.StartDate, in.EndDate, now)
			if db.IsUniqueViolation(err, "") {
				return httpx.Conflict("DUPLICATE_PROJECT", "Project dengan nama yang sama sudah ada di Area ini.")
			}
			if err != nil {
				return err
			}
		} else {
			var currentArea string
			if err := tx.QueryRow(ctx, `SELECT area_id FROM projects WHERE id = $1 FOR UPDATE`, id).Scan(&currentArea); err != nil || !p.CoversArea(&currentArea) {
				return httpx.NotFound("Project")
			}
			if currentArea != in.AreaID {
				var used bool
				if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM personnel WHERE project_id = $1)`, id).Scan(&used); err != nil {
					return err
				}
				if used {
					return httpx.Validation(map[string]string{"areaId": "Area project tidak dapat diubah karena sudah dipakai employee."})
				}
			}
			_, err := tx.Exec(ctx, `UPDATE projects SET name=$2, name_key=$3, client_name=$4, area_id=$5, sub_area=$6, status=$7, start_date=$8, end_date=$9, updated_at=$10 WHERE id = $1`,
				id, in.Name, imports.NameKey(in.Name), in.ClientName, in.AreaID, in.SubArea, in.Status, in.StartDate, in.EndDate, now)
			if db.IsUniqueViolation(err, "") {
				return httpx.Conflict("DUPLICATE_PROJECT", "Project dengan nama yang sama sudah ada di Area ini.")
			}
			if err != nil {
				return err
			}
		}
		return s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "project.save", EntityType: "project", EntityID: id, AreaID: &in.AreaID, Details: map[string]any{"status": in.Status}})
	})
	if err != nil {
		return nil, err
	}
	list, err := s.projects(ctx, s.Pool, nil)
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].ID == id {
			return &list[i], nil
		}
	}
	return nil, httpx.NotFound("Project")
}

func (s *Service) SetProjectStatus(ctx context.Context, a Actor, id, status string) error {
	if err := require(a.P, access.ToggleProjectStatus); err != nil {
		return err
	}
	if status != "ACTIVE" && status != "INACTIVE" {
		return httpx.Validation(map[string]string{"status": "Status tidak dikenal."})
	}
	return s.tx(ctx, func(tx pgx.Tx) error {
		var area string
		if err := tx.QueryRow(ctx, `SELECT area_id FROM projects WHERE id = $1 FOR UPDATE`, id).Scan(&area); err != nil || !a.P.CoversArea(&area) {
			return httpx.NotFound("Project")
		}
		if _, err := tx.Exec(ctx, `UPDATE projects SET status = $2, updated_at = $3 WHERE id = $1`, id, status, s.now()); err != nil {
			return err
		}
		return s.audit(ctx, tx, a.P.UserID, a.RequestID, auditEntry{Action: "project.status", EntityType: "project", EntityID: id, AreaID: &area, Details: map[string]any{"status": status}})
	})
}

func (s *Service) SaveQuota(ctx context.Context, a Actor, projectID, period string, quota int) error {
	if err := require(a.P, access.ManageProjectQuota); err != nil {
		return err
	}
	fe := httpx.FieldErrors{}
	if len(period) != 7 || period[4] != '-' || !domain.ValidDate(period+"-01") {
		fe.Add("period", "Periode harus berformat YYYY-MM.")
	}
	if quota < 0 || quota > 100000 {
		fe.Add("quota", "Quota harus 0–100000.")
	}
	if err := fe.Err(); err != nil {
		return err
	}
	return s.tx(ctx, func(tx pgx.Tx) error {
		var area string
		if err := tx.QueryRow(ctx, `SELECT area_id FROM projects WHERE id = $1`, projectID).Scan(&area); err != nil || !a.P.CoversArea(&area) {
			return httpx.NotFound("Project")
		}
		if _, err := tx.Exec(ctx, `INSERT INTO project_quotas (project_id, period, quota, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5)
			ON CONFLICT (project_id, period) DO UPDATE SET quota = EXCLUDED.quota, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`, projectID, period, quota, a.P.UserID, s.now()); err != nil {
			return err
		}
		return s.audit(ctx, tx, a.P.UserID, a.RequestID, auditEntry{Action: "project.quota", EntityType: "project", EntityID: projectID, AreaID: &area, Details: map[string]any{"period": period, "quota": quota}})
	})
}
