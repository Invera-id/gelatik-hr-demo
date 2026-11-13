package domain

import (
	"slices"
	"testing"
	"time"
)

func sp(s string) *string { return &s }

func TestWorkingDayGapMondayToFriday(t *testing.T) {
	cases := []struct {
		exit, join string
		want       int
	}{
		{"2026-09-02", "2026-09-07", 3}, // Wed → Mon skips the weekend
		{"2026-09-04", "2026-09-07", 1}, // Fri → Mon
		{"2026-09-04", "2026-09-06", 0}, // Fri → Sun
		{"2026-09-01", "2026-09-01", 0},
		{"2026-09-01", "2026-09-15", 10},
	}
	for _, c := range cases {
		got, err := WorkingDayGap(c.exit, c.join)
		if err != nil || got != c.want {
			t.Errorf("WorkingDayGap(%s,%s) = %d, %v; want %d", c.exit, c.join, got, err, c.want)
		}
	}
	if SLAStatusFor(3) != "WITHIN_TARGET" || SLAStatusFor(4) != "OVER_TARGET" {
		t.Fatal("SLA target is ≤ 3 working days")
	}
	if _, err := WorkingDayGap("2026-02-30", "2026-03-01"); err == nil {
		t.Fatal("invalid dates are rejected")
	}
}

func TestBusinessTodayUsesJakarta(t *testing.T) {
	// 18:00 UTC is already the next day in Asia/Jakarta (UTC+7).
	if got := BusinessToday(time.Date(2026, 9, 13, 18, 0, 0, 0, time.UTC), ""); got != "2026-09-14" {
		t.Fatalf("got %s", got)
	}
	if got := BusinessToday(time.Now(), "2026-01-02"); got != "2026-01-02" {
		t.Fatal("override")
	}
}

func active() Employee {
	return Employee{ID: "c1", AreaID: sp("a"), ProjectID: sp("p"), Position: sp("Sales"), EmploymentStatus: "ACTIVE", ConditionStatus: "CONFIRMED",
		ValidationStatus: "VALIDATED", ContractStatus: "SIGNED", JoinDate: sp("2026-09-07")}
}

func TestEligibilityAndBlockers(t *testing.T) {
	need := ReplacementNeed{ID: "n1", OriginalEmployeeID: "x", AreaID: sp("a"), ProjectID: sp("p"), Position: sp("Sales"), ExitDate: "2026-09-02"}
	if r := FulfillmentBlockers(need, active(), false); len(r) != 0 {
		t.Fatalf("eligible candidate blocked: %v", r)
	}
	c := active()
	c.ConditionStatus = "NEEDS_REVIEW"
	if !slices.Contains(CandidateEligibility(need, c, false), "Kondisi terkini belum ditinjau") {
		t.Fatal("NEEDS_REVIEW is never eligible")
	}
	c = active()
	c.ContractStatus = "DRAFT"
	if !slices.Contains(FulfillmentBlockers(need, c, false), "Kontrak belum ditandatangani") {
		t.Fatal("contract gate")
	}
	c = active()
	c.JoinDate = sp("2026-09-01")
	if len(FulfillmentBlockers(need, c, false)) == 0 {
		t.Fatal("join before exit is blocked")
	}
	if !slices.Contains(CandidateEligibility(need, active(), true), "Karyawan sudah dialokasikan pada kebutuhan aktif lain") {
		t.Fatal("one allocation per candidate")
	}
}

func TestContractReminderCategories(t *testing.T) {
	e := active()
	for end, want := range map[string]string{"2026-09-13": "EXPIRED", "2026-09-21": "D-7", "2026-09-28": "D-14", "2026-10-14": "D-30", "2026-12-31": ""} {
		e.ContractEndDate = sp(end)
		if got := ContractReminderCategory(e, "2026-09-14", DefaultReminderDays); got != want {
			t.Errorf("%s: got %q want %q", end, got, want)
		}
	}
	e.ValidationStatus = "SUBMITTED"
	if ContractReminderCategory(e, "2026-09-14", DefaultReminderDays) != "" {
		t.Fatal("unvalidated records produce no reminder")
	}
}

func TestCombinedStatusKeepsLifecycleSeparate(t *testing.T) {
	if CombinedStatus("FULFILLED", sp("OVER_TARGET")) != "OVER_TARGET" || CombinedStatus("FULFILLED", sp("WITHIN_TARGET")) != "FULFILLED" || CombinedStatus("OPEN", nil) != "OPEN" {
		t.Fatal("combined status mapping")
	}
}

func TestHistoricalWorkforceIsDerivedOnly(t *testing.T) {
	exiting := active()
	exiting.ID, exiting.PersonnelID, exiting.JoinDate = "e1", "P1", sp("2025-01-01")
	exiting.Profile = map[string]any{"exitDate": "2026-09-02"}
	repl := active()
	repl.ID = "e2"
	pending := active()
	pending.ID, pending.ValidationStatus = "e3", "SUBMITTED"
	h := DeriveHistoricalWorkforce([]Employee{exiting, repl, pending})
	if len(h.Needs) != 1 || !h.Needs[0].Derived || *h.Needs[0].ReplacementEmployeeID != "e2" || *h.Needs[0].GapWorkingDays != 3 {
		t.Fatalf("derived need: %+v", h.Needs)
	}
}
