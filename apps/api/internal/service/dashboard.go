package service

import (
	"bytes"
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/xuri/excelize/v2"

	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/access"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/domain"
	"github.com/Invera-id/gelatik-hr-demo/apps/api/internal/httpx"
)

type DashboardKPI struct {
	Filters            domain.DashboardFilters `json:"filters"`
	ActiveEmployees    int                     `json:"activeEmployees"`
	Employees          int                     `json:"employees"`
	ValidatedExits     int                     `json:"validatedExits"`
	ReplacementNeeds   int                     `json:"replacementNeeds"`
	Fulfilled          int                     `json:"fulfilled"`
	Open               int                     `json:"open"`
	OverSLA            int                     `json:"overSla"`
	FulfillmentRate    int                     `json:"fulfillmentRate"`
	AverageGap         float64                 `json:"averageGap"`
	Movements          int                     `json:"movements"`
	ContractReminders  map[string]int          `json:"contractReminders"`
	PendingValidations int                     `json:"pendingValidations"`
	BusinessDate       string                  `json:"businessDate"`
}

func (s *Service) normalizeFilters(p *access.Principal, f domain.DashboardFilters) (domain.DashboardFilters, error) {
	fe := httpx.FieldErrors{}
	if f.DateTo == "" {
		f.DateTo = s.Today()
	}
	if f.DateFrom == "" {
		f.DateFrom = f.DateTo[:4] + "-01-01"
	}
	checkDate(fe, "dateFrom", &f.DateFrom, true)
	checkDate(fe, "dateTo", &f.DateTo, true)
	if f.DateFrom > f.DateTo {
		fe.Add("dateFrom", "Tanggal awal tidak boleh setelah tanggal akhir.")
	}
	switch f.Status {
	case "", "OPEN", "MATCHED", "FULFILLED", "OVER_TARGET":
	default:
		fe.Add("status", "Status tidak dikenal.")
	}
	if err := fe.Err(); err != nil {
		return f, err
	}
	if f.AreaID != "" && !p.CoversArea(&f.AreaID) {
		return f, httpx.Forbidden()
	}
	return f, nil
}

// Dashboard computes KPIs on the server from the same scoped snapshot used by exports.
func (s *Service) Dashboard(ctx context.Context, p *access.Principal, f domain.DashboardFilters) (*DashboardKPI, error) {
	if err := require(p, access.ViewDashboard); err != nil {
		return nil, err
	}
	f, err := s.normalizeFilters(p, f)
	if err != nil {
		return nil, err
	}
	snap, err := s.loadScoped(ctx, p)
	if err != nil {
		return nil, err
	}
	cs, err := loadContractSettings(ctx, s.Pool)
	if err != nil {
		return nil, err
	}
	sel := domain.SelectDashboard(snap.Employees, snap.EmployeeExits, snap.ReplacementNeeds, snap.EmployeeMovements, f)
	k := &DashboardKPI{Filters: f, ActiveEmployees: len(sel.ActiveEmployees), Employees: len(sel.Employees), ValidatedExits: len(sel.Exits), ReplacementNeeds: len(sel.Needs),
		Fulfilled: len(sel.Fulfilled), Open: len(sel.Open), OverSLA: len(sel.OverSLA), FulfillmentRate: sel.FulfillmentRate, AverageGap: sel.AverageGap,
		Movements: len(sel.Movements), ContractReminders: map[string]int{"EXPIRED": 0}, BusinessDate: s.Today()}
	for _, d := range cs.ReminderDays {
		k.ContractReminders[fmt.Sprintf("D-%d", d)] = 0
	}
	for _, e := range sel.Employees {
		if c := domain.ContractReminderCategory(e, s.Today(), cs.ReminderDays); c != "" {
			k.ContractReminders[c]++
		}
		if e.ValidationStatus == "SUBMITTED" {
			k.PendingValidations++
		}
	}
	return k, nil
}

var ExportKinds = []string{"EMPLOYEE", "MOVEMENT", "TURNOVER", "REPLACEMENT", "DASHBOARD"}

// safeText neutralizes spreadsheet formula injection for text cells that start with
// =, +, -, @, tab or CR. Real numbers are written as numeric cells and are not touched.
func safeText(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		if _, err := strconv.ParseFloat(s, 64); err == nil {
			return s
		}
		return "'" + s
	}
	return s
}

func cell(v any) any {
	switch x := v.(type) {
	case nil:
		return ""
	case *string:
		if x == nil {
			return ""
		}
		return safeText(*x)
	case string:
		return safeText(x)
	case *int:
		if x == nil {
			return ""
		}
		return *x
	}
	return v
}

// Export builds an .xlsx for one report kind, honoring permission, scope and filters.
func (s *Service) Export(ctx context.Context, a Actor, kind string, f domain.DashboardFilters) ([]byte, string, error) {
	p := a.P
	if err := require(p, access.ExportData); err != nil {
		return nil, "", err
	}
	kind = strings.ToUpper(kind)
	valid := false
	for _, k := range ExportKinds {
		valid = valid || k == kind
	}
	if !valid {
		return nil, "", httpx.NotFound("Jenis export")
	}
	f, err := s.normalizeFilters(p, f)
	if err != nil {
		return nil, "", err
	}
	snap, err := s.loadScoped(ctx, p)
	if err != nil {
		return nil, "", err
	}
	ws, err := s.Workspace(ctx, p)
	if err != nil {
		return nil, "", err
	}
	areas, projects, names := map[string]string{}, map[string]string{}, map[string]string{}
	for _, x := range ws.Areas {
		areas[x.ID] = x.Name
	}
	for _, x := range ws.Projects {
		projects[x.ID] = x.Name
	}
	emp := map[string]domain.Employee{}
	for _, e := range snap.Employees {
		emp[e.ID] = e
		names[e.ID] = e.Name
	}
	an := func(id *string) string {
		if id == nil {
			return "-"
		}
		if n, ok := areas[*id]; ok {
			return n
		}
		return "-"
	}
	pn := func(id *string) string {
		if id == nil {
			return "-"
		}
		if n, ok := projects[*id]; ok {
			return n
		}
		return "-"
	}
	sel := domain.SelectDashboard(snap.Employees, snap.EmployeeExits, snap.ReplacementNeeds, snap.EmployeeMovements, f)
	var headers []string
	var rows [][]any
	stamp := strings.ReplaceAll(s.Today(), "-", "")
	var file string
	switch kind {
	case "EMPLOYEE":
		file = "employee-master-" + stamp + ".xlsx"
		headers = []string{"Personnel ID", "Nama Employee", "Area", "Project", "Position", "Employment Status", "Join Date", "Contract End Date", "Contract Status", "BPJS Status", "Validation"}
		for _, e := range sel.Employees {
			rows = append(rows, []any{e.PersonnelID, e.Name, an(e.AreaID), pn(e.ProjectID), e.Position, e.EmploymentStatus, e.JoinDate, e.ContractEndDate, e.ContractStatus, e.BPJSStatus, e.ValidationStatus})
		}
	case "MOVEMENT":
		file = "employee-movement-" + stamp + ".xlsx"
		headers = []string{"Effective Date", "Personnel ID", "Nama Employee", "Movement Type", "Previous Area", "New Area", "Previous Project", "New Project", "Previous Position", "New Position", "Notes", "Created By"}
		for _, m := range sel.Movements {
			e := emp[m.EmployeeID]
			rows = append(rows, []any{m.EffectiveDate, e.PersonnelID, e.Name, m.MovementType, an(m.PreviousAreaID), an(m.NewAreaID), pn(m.PreviousProjectID), pn(m.NewProjectID), m.PreviousPosition, m.NewPosition, m.Notes, m.CreatedBy})
		}
	case "TURNOVER":
		file = "turnover-" + stamp + ".xlsx"
		headers = []string{"Exit ID", "Personnel ID", "Nama Employee", "Area", "Project", "Position", "Exit Date", "Exit Reason", "Replacement Required", "Validation"}
		for _, x := range sel.Exits {
			e := emp[x.EmployeeID]
			rows = append(rows, []any{x.ID, e.PersonnelID, e.Name, an(e.AreaID), pn(e.ProjectID), e.Position, x.ExitDate, x.ExitReason, map[bool]string{true: "Yes", false: "No"}[x.ReplacementRequired], x.ValidationStatus})
		}
	case "REPLACEMENT":
		file = "replacement-fulfillment-" + stamp + ".xlsx"
		headers = []string{"Need ID", "Employee Exit", "Replacement Employee", "Area", "Project", "Position", "Exit Date", "Replacement Join Date", "Working-Day Gap", "Status"}
		labels := map[string]string{"OPEN": "Open", "MATCHED": "Matched", "FULFILLED": "Fulfilled", "OVER_TARGET": "Over SLA"}
		for _, n := range sel.Needs {
			repl := "-"
			if n.ReplacementEmployeeID != nil {
				repl = names[*n.ReplacementEmployeeID]
			}
			rows = append(rows, []any{n.ID, names[n.OriginalEmployeeID], repl, an(n.AreaID), pn(n.ProjectID), n.Position, n.ExitDate, n.ReplacementJoinDate, n.GapWorkingDays, labels[n.Status]})
		}
	case "DASHBOARD":
		file = "dashboard-filtered-" + stamp + ".xlsx"
		headers = []string{"Metric", "Value", "Area Filter", "Project Filter", "Date From", "Date To", "Role Scope"}
		areaF, projF := "Semua area dalam scope", "Semua project"
		if f.AreaID != "" {
			areaF = an(&f.AreaID)
		}
		if f.ProjectID != "" {
			projF = pn(&f.ProjectID)
		}
		for _, m := range [][2]any{{"Active Employee", len(sel.ActiveEmployees)}, {"Validated Employee Exit", len(sel.Exits)}, {"Replacement Needs", len(sel.Needs)}, {"Fulfilled", len(sel.Fulfilled)},
			{"Open", len(sel.Open)}, {"Over SLA", len(sel.OverSLA)}, {"Fulfillment Rate", fmt.Sprintf("%d%%", sel.FulfillmentRate)}, {"Average Working-Day Gap", sel.AverageGap}} {
			rows = append(rows, []any{m[0], m[1], areaF, projF, f.DateFrom, f.DateTo, string(p.Role)})
		}
	}
	data, err := writeXLSX(headers, rows)
	if err != nil {
		return nil, "", err
	}
	if err := s.tx(ctx, func(tx pgx.Tx) error {
		return s.audit(ctx, tx, p.UserID, a.RequestID, auditEntry{Action: "export." + strings.ToLower(kind), EntityType: "export", Details: map[string]any{"rows": len(rows), "filters": f}})
	}); err != nil {
		return nil, "", err
	}
	return data, file, nil
}

func writeXLSX(headers []string, rows [][]any) ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	sheet := "Data"
	_ = f.SetSheetName("Sheet1", sheet)
	sw, err := f.NewStreamWriter(sheet)
	if err != nil {
		return nil, err
	}
	style, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Color: "FFFFFF"}, Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"183348"}}})
	if err := sw.SetPanes(&excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"}); err != nil {
		return nil, err
	}
	head := make([]any, len(headers))
	for i, h := range headers {
		head[i] = excelize.Cell{StyleID: style, Value: h}
		_ = sw.SetColWidth(i+1, i+1, float64(max(14, min(34, len(h)+5))))
	}
	if err := sw.SetRow("A1", head, excelize.RowOpts{}); err != nil {
		return nil, err
	}
	for r, row := range rows {
		vals := make([]any, len(row))
		for i, v := range row {
			vals[i] = cell(v)
		}
		ref, _ := excelize.CoordinatesToCellName(1, r+2)
		if err := sw.SetRow(ref, vals); err != nil {
			return nil, err
		}
	}
	if err := sw.Flush(); err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if _, err := f.WriteTo(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
