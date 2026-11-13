package domain

import (
	"math"
	"sort"
	"strings"
	"time"
)

type DashboardFilters struct {
	DateFrom  string `json:"dateFrom"`
	DateTo    string `json:"dateTo"`
	AreaID    string `json:"areaId"`
	ProjectID string `json:"projectId"`
	Position  string `json:"position"`
	Status    string `json:"status"`
}

type DashboardSelection struct {
	Employees       []Employee
	ActiveEmployees []Employee
	Exits           []EmployeeExit
	Needs           []ReplacementNeed
	Fulfilled       []ReplacementNeed
	Open            []ReplacementNeed
	OverSLA         []ReplacementNeed
	Movements       []CareerEvent
	FulfillmentRate int
	AverageGap      float64
}

// SelectDashboard mirrors the prototype's dashboard selection so server
// aggregates, exports and the UI agree on the same figures.
func SelectDashboard(employees []Employee, exits []EmployeeExit, needs []ReplacementNeed, movements []CareerEvent, f DashboardFilters) DashboardSelection {
	in := func(area, project, position *string) bool {
		return (f.AreaID == "" || str(area) == f.AreaID) && (f.ProjectID == "" || str(project) == f.ProjectID) && (f.Position == "" || str(position) == f.Position)
	}
	var sel DashboardSelection
	ids := map[string]bool{}
	for _, e := range employees {
		if in(e.AreaID, e.ProjectID, e.Position) {
			sel.Employees = append(sel.Employees, e)
			ids[e.ID] = true
			if IsCountableActive(e) {
				sel.ActiveEmployees = append(sel.ActiveEmployees, e)
			}
		}
	}
	for _, x := range exits {
		if x.ValidationStatus == "VALIDATED" && ids[x.EmployeeID] && x.ExitDate >= f.DateFrom && x.ExitDate <= f.DateTo {
			sel.Exits = append(sel.Exits, x)
		}
	}
	var gaps []int
	for _, n := range needs {
		if !in(n.AreaID, n.ProjectID, n.Position) || n.ExitDate < f.DateFrom || n.ExitDate > f.DateTo || (f.Status != "" && n.Status != f.Status) {
			continue
		}
		sel.Needs = append(sel.Needs, n)
		switch n.Status {
		case "FULFILLED", "OVER_TARGET":
			sel.Fulfilled = append(sel.Fulfilled, n)
			if n.GapWorkingDays != nil {
				gaps = append(gaps, *n.GapWorkingDays)
			}
		case "OPEN", "MATCHED":
			sel.Open = append(sel.Open, n)
		}
		if n.Status == "OVER_TARGET" {
			sel.OverSLA = append(sel.OverSLA, n)
		}
	}
	for _, m := range movements {
		if ids[m.EmployeeID] && m.EffectiveDate >= f.DateFrom && m.EffectiveDate <= f.DateTo {
			sel.Movements = append(sel.Movements, m)
		}
	}
	if len(sel.Needs) > 0 {
		sel.FulfillmentRate = int(math.Round(float64(len(sel.Fulfilled)) / float64(len(sel.Needs)) * 100))
	}
	if len(gaps) > 0 {
		sum := 0
		for _, g := range gaps {
			sum += g
		}
		sel.AverageGap = math.Round(float64(sum)/float64(len(gaps))*10) / 10
	}
	return sel
}

func placementKey(e Employee) string {
	return str(e.AreaID) + "|" + str(e.ProjectID) + "|" + strings.ToUpper(strings.TrimSpace(str(e.Position)))
}

func startOfDay(date string) time.Time {
	t, _ := ParseDate(date)
	return t
}

// HistoricalWorkforce is a read-only view inferred from validated imported masters.
// DEMO ASSUMPTION (ported from the prototype, nothing is persisted):
//   - Tanggal Keluar is treated as a company exit requiring replacement;
//   - replacement is inferred by exact Area + Project + Position, nearest unused join on/after exit.
//
// Items are marked Derived and are not actionable (no matching/fulfillment).
type HistoricalWorkforce struct {
	Exits     []EmployeeExit
	Needs     []ReplacementNeed
	Movements []CareerEvent
}

func DeriveHistoricalWorkforce(imported []Employee) HistoricalWorkforce {
	var confirmed []Employee
	for _, e := range imported {
		if e.ValidationStatus == "VALIDATED" && e.ConditionStatus != "NEEDS_REVIEW" {
			confirmed = append(confirmed, e)
		}
	}
	exitDate := func(e Employee) string {
		if v, ok := e.Profile["exitDate"].(string); ok {
			return v
		}
		return ""
	}
	exitReason := func(e Employee) string {
		if v, ok := e.Profile["exitReason"].(string); ok {
			return strings.TrimSpace(v)
		}
		return ""
	}
	var exiting []Employee
	candidates := map[string][]Employee{}
	for _, e := range confirmed {
		if exitDate(e) != "" {
			exiting = append(exiting, e)
		}
		if e.JoinDate != nil && *e.JoinDate != "" && HasCompletePlacement(e.AreaID, e.ProjectID, e.Position) {
			candidates[placementKey(e)] = append(candidates[placementKey(e)], e)
		}
	}
	sort.SliceStable(exiting, func(i, j int) bool {
		if exitDate(exiting[i]) != exitDate(exiting[j]) {
			return exitDate(exiting[i]) < exitDate(exiting[j])
		}
		return exiting[i].ID < exiting[j].ID
	})
	for k := range candidates {
		list := candidates[k]
		sort.SliceStable(list, func(i, j int) bool {
			if *list[i].JoinDate != *list[j].JoinDate {
				return *list[i].JoinDate < *list[j].JoinDate
			}
			return list[i].ID < list[j].ID
		})
	}
	used := map[string]bool{}
	var out HistoricalWorkforce
	for _, e := range exiting {
		date := exitDate(e)
		reason := exitReason(e)
		if reason == "" {
			reason = "Historical exit dari import Excel"
		}
		created := startOfDay(date)
		exitID := "import-assumed-exit-" + e.ID
		out.Exits = append(out.Exits, EmployeeExit{
			ID: exitID, EmployeeID: e.ID, ExitDate: date, ExitReason: reason, ReplacementRequired: true,
			CreatedBy: e.CreatedBy, ValidationStatus: "VALIDATED", ValidatedBy: e.ValidatedBy, ValidatedAt: e.ValidatedAt,
			SubmittedAt: &created, CreatedAt: created, UpdatedAt: e.UpdatedAt, Derived: true,
		})
		var replacement *Employee
		for i := range candidates[placementKey(e)] {
			c := candidates[placementKey(e)][i]
			if c.ID != e.ID && !used[c.ID] && *c.JoinDate >= date {
				replacement = &c
				break
			}
		}
		need := ReplacementNeed{
			ID: "import-assumed-need-" + e.ID, EmployeeExitID: exitID, OriginalEmployeeID: e.ID,
			AreaID: e.AreaID, ProjectID: e.ProjectID, Position: e.Position, ExitDate: date,
			LifecycleStatus: "OPEN", Status: "OPEN", CreatedAt: created, UpdatedAt: e.UpdatedAt, Derived: true,
		}
		for i := range out.Needs {
			if str(out.Needs[i].ReplacementEmployeeID) == e.ID {
				id := out.Needs[i].ID
				need.PreviousReplacementNeedID = &id
				break
			}
		}
		if replacement != nil {
			used[replacement.ID] = true
			gap, _ := WorkingDayGap(date, *replacement.JoinDate)
			sla := SLAStatusFor(gap)
			fulfilled := startOfDay(*replacement.JoinDate)
			rid, rjoin := replacement.ID, *replacement.JoinDate
			need.ReplacementEmployeeID, need.ReplacementJoinDate = &rid, &rjoin
			need.LifecycleStatus, need.SLAStatus, need.GapWorkingDays, need.FulfilledAt = "FULFILLED", &sla, &gap, &fulfilled
			need.Status = CombinedStatus("FULFILLED", &sla)
		}
		out.Needs = append(out.Needs, need)
		note := reason
		if exitReason(e) == "" {
			note = "historical exit dari import Excel"
		}
		out.Movements = append(out.Movements, CareerEvent{
			ID: "import-assumed-movement-exit-" + e.ID, EmployeeID: e.ID, MovementType: "EXIT", EffectiveDate: date,
			PreviousAreaID: e.AreaID, NewAreaID: e.AreaID, PreviousProjectID: e.ProjectID, NewProjectID: e.ProjectID,
			PreviousPosition: e.Position, NewPosition: e.Position, Notes: "Demo assumption — " + note,
			CreatedBy: e.CreatedBy, CreatedAt: created, Derived: true,
		})
		if replacement != nil {
			out.Movements = append(out.Movements, CareerEvent{
				ID: "import-assumed-movement-replacement-" + e.ID + "-" + replacement.ID, EmployeeID: replacement.ID,
				MovementType: "REPLACEMENT", EffectiveDate: *replacement.JoinDate, NewAreaID: replacement.AreaID,
				NewProjectID: replacement.ProjectID, NewPosition: replacement.Position,
				Notes:     "Demo assumption — inferred replacement untuk Personnel ID " + e.PersonnelID,
				CreatedBy: replacement.CreatedBy, CreatedAt: startOfDay(*replacement.JoinDate), Derived: true,
			})
		}
	}
	return out
}
