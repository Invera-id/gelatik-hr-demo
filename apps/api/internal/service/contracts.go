package service

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/db"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
)

// ContractSettings is the company-wide contract monitoring configuration.
type ContractSettings struct {
	Scope        string     `json:"scope"` // always GLOBAL (no per-area/project overrides)
	ReminderDays []int      `json:"reminderDays"`
	UpdatedBy    *string    `json:"updatedBy"`
	UpdatedAt    *time.Time `json:"updatedAt"`
}

func loadContractSettings(ctx context.Context, q db.Querier) (ContractSettings, error) {
	st := ContractSettings{Scope: "GLOBAL"}
	var days []int32
	var at time.Time
	err := q.QueryRow(ctx, `SELECT reminder_days, updated_by, updated_at FROM contract_monitoring_settings WHERE id = 1`).Scan(&days, &st.UpdatedBy, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		st.ReminderDays = slices.Clone(domain.DefaultReminderDays)
		return st, nil
	}
	if err != nil {
		return st, err
	}
	st.UpdatedAt = &at
	for _, d := range days {
		st.ReminderDays = append(st.ReminderDays, int(d))
	}
	norm, err := domain.NormalizeReminderDays(st.ReminderDays)
	if err != nil {
		norm = slices.Clone(domain.DefaultReminderDays)
	}
	st.ReminderDays = norm
	return st, nil
}

func (s *Service) ContractSettings(ctx context.Context, p *access.Principal) (*ContractSettings, error) {
	if err := requireAny(p, access.ViewEmployee, access.ViewDashboard, access.ManageContractMonitor); err != nil {
		return nil, err
	}
	st, err := loadContractSettings(ctx, s.Pool)
	return &st, err
}

func (s *Service) SaveContractSettings(ctx context.Context, a Actor, days []int) (*ContractSettings, error) {
	p := a.P
	if err := require(p, access.ManageContractMonitor); err != nil {
		return nil, err
	}
	norm, err := domain.NormalizeReminderDays(days)
	if err != nil {
		return nil, httpx.Validation(map[string]string{"reminderDays": "Ambang pengingat tidak valid: " + err.Error() + "."})
	}
	err = s.tx(ctx, func(tx pgx.Tx) error {
		prev, err := loadContractSettings(ctx, tx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO contract_monitoring_settings (id, reminder_days, updated_by, updated_at) VALUES (1,$1,$2,$3)
			ON CONFLICT (id) DO UPDATE SET reminder_days = EXCLUDED.reminder_days, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
			norm, p.UserID, s.now()); err != nil {
			return err
		}
		return s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "settings.contract_monitoring.update", EntityType: "contract_monitoring_settings", EntityID: "1",
			Details: map[string]any{"before": prev.ReminderDays, "after": norm}})
	})
	if err != nil {
		return nil, err
	}
	return s.ContractSettings(ctx, p)
}

// ContractItem is one monitored personnel with its derived contract state.
type ContractItem struct {
	EmployeeID        string               `json:"employeeId"`
	PersonnelID       string               `json:"personnelId"`
	Name              string               `json:"name"`
	AreaID            *string              `json:"areaId"`
	ProjectID         *string              `json:"projectId"`
	Position          *string              `json:"position"`
	JoinDate          *string              `json:"joinDate"`
	ContractStartDate *string              `json:"contractStartDate"`
	ContractEndDate   *string              `json:"contractEndDate"`
	ContractStatus    string               `json:"contractStatus"`
	State             domain.ContractState `json:"state"`
}

// ContractSummary counts personnel (one current contract projection per personnel,
// so historical contracts can never be double counted).
type ContractSummary struct {
	Monitored  int `json:"monitored"`
	Expiring   int `json:"expiring"`
	Expired    int `json:"expired"`
	Incomplete int `json:"incomplete"`
}

type ContractMonitoring struct {
	BusinessDate string           `json:"businessDate"`
	Settings     ContractSettings `json:"settings"`
	Summary      ContractSummary  `json:"summary"`
	Filters      ContractFilters  `json:"filters"`
	Items        []ContractItem   `json:"items"`
	Total        int              `json:"total"`
	Page         int              `json:"page"`
	PageSize     int              `json:"pageSize"`
}

type ContractFilters struct {
	Status    string `json:"status"` // ACTION (expiring+expired) | EXPIRING | EXPIRED | INCOMPLETE | ALL
	AreaID    string `json:"areaId"`
	ProjectID string `json:"projectId"`
	Page      int    `json:"page"`
	PageSize  int    `json:"pageSize"`
}

func (f ContractFilters) matches(status string) bool {
	switch f.Status {
	case "ALL":
		return true
	case "ACTION":
		return status == domain.ContractExpiring || status == domain.ContractExpired
	default:
		return status == f.Status
	}
}

// contractStates evaluates every monitored personnel in scope. The dashboard summary
// and the detail list both come from this one function so they always agree.
func (s *Service) contractStates(ctx context.Context, p *access.Principal, areaID, projectID string) ([]ContractItem, ContractSettings, error) {
	st, err := loadContractSettings(ctx, s.Pool)
	if err != nil {
		return nil, st, err
	}
	rows, err := s.Pool.Query(ctx, employeeSelect+` WHERE p.employment_status = 'ACTIVE' AND p.record_status = 'VALIDATED' AND p.condition_status <> 'NEEDS_REVIEW'
		AND ($1::text[] IS NULL OR p.area_id = ANY($1)) AND ($2 = '' OR p.area_id = $2) AND ($3 = '' OR p.project_id = $3)
		ORDER BY p.contract_end_date NULLS LAST, p.id`, scopeArgs(p), areaID, projectID)
	if err != nil {
		return nil, st, err
	}
	emps, err := collectEmployees(rows, false)
	if err != nil {
		return nil, st, err
	}
	today := s.Today()
	items := make([]ContractItem, 0, len(emps))
	for _, e := range emps {
		if !domain.InContractMonitoring(e) {
			continue
		}
		items = append(items, ContractItem{EmployeeID: e.ID, PersonnelID: e.PersonnelID, Name: e.Name, AreaID: e.AreaID, ProjectID: e.ProjectID, Position: e.Position,
			JoinDate: e.JoinDate, ContractStartDate: e.ContractStartDate, ContractEndDate: e.ContractEndDate, ContractStatus: e.ContractStatus,
			State: domain.EvaluateContract(e, today, st.ReminderDays)})
	}
	return items, st, nil
}

func summarizeContracts(items []ContractItem) ContractSummary {
	sum := ContractSummary{Monitored: len(items)}
	for _, it := range items {
		switch it.State.Status {
		case domain.ContractExpiring:
			sum.Expiring++
		case domain.ContractExpired:
			sum.Expired++
		case domain.ContractIncomplete:
			sum.Incomplete++
		}
	}
	return sum
}

func (s *Service) ContractMonitoring(ctx context.Context, p *access.Principal, f ContractFilters) (*ContractMonitoring, error) {
	if err := require(p, access.ViewEmployee); err != nil {
		return nil, err
	}
	fe := httpx.FieldErrors{}
	if f.Status == "" {
		f.Status = "ACTION"
	}
	switch f.Status {
	case "ACTION", "ALL", domain.ContractExpiring, domain.ContractExpired, domain.ContractIncomplete:
	default:
		fe.Add("status", "Status tidak dikenal. Gunakan ACTION, EXPIRING, EXPIRED, INCOMPLETE atau ALL.")
	}
	if f.Page < 1 {
		f.Page = 1
	}
	if f.PageSize < 1 || f.PageSize > 200 {
		f.PageSize = 50
	}
	if err := fe.Err(); err != nil {
		return nil, err
	}
	if f.AreaID != "" && !p.CoversArea(&f.AreaID) {
		return nil, httpx.Forbidden()
	}
	items, st, err := s.contractStates(ctx, p, f.AreaID, f.ProjectID)
	if err != nil {
		return nil, err
	}
	out := &ContractMonitoring{BusinessDate: s.Today(), Settings: st, Summary: summarizeContracts(items), Filters: f, Page: f.Page, PageSize: f.PageSize, Items: []ContractItem{}}
	var matched []ContractItem
	for _, it := range items {
		if f.matches(it.State.Status) {
			matched = append(matched, it)
		}
	}
	// Most urgent first: expired (longest overdue first), then fewest days left, then incomplete.
	slices.SortStableFunc(matched, func(a, b ContractItem) int {
		x, y := a.State.DaysRemaining, b.State.DaysRemaining
		switch {
		case x == nil && y == nil:
			return 0
		case x == nil:
			return 1
		case y == nil:
			return -1
		}
		return *x - *y
	})
	out.Total = len(matched)
	start := (f.Page - 1) * f.PageSize
	if start < len(matched) {
		out.Items = matched[start:min(start+f.PageSize, len(matched))]
	}
	return out, nil
}
