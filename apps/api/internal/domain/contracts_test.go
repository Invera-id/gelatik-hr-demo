package domain

import (
	"testing"
	"time"
)

func TestNormalizeReminderDays(t *testing.T) {
	got, err := NormalizeReminderDays([]int{7, 60, 30})
	if err != nil || got[0] != 60 || got[1] != 30 || got[2] != 7 {
		t.Fatalf("sorted descending: %v %v", got, err)
	}
	for _, bad := range [][]int{{}, {0}, {367}, {7, 7}, {1, 2, 3, 4, 5, 6}} {
		if _, err := NormalizeReminderDays(bad); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
}

func TestEvaluateContractThresholdsAreConfigurable(t *testing.T) {
	e := active()
	e.ContractEndDate = sp("2026-11-13") // 60 days after 2026-09-14
	if st := EvaluateContract(e, "2026-09-14", DefaultReminderDays); st.Status != ContractOK {
		t.Fatalf("60 days out with max threshold 30: %s", st.Status)
	}
	st := EvaluateContract(e, "2026-09-14", []int{90, 60})
	if st.Status != ContractExpiring || *st.ReminderThreshold != 60 || *st.DaysRemaining != 60 {
		t.Fatalf("custom thresholds: %+v", st)
	}
	if ContractReminderCategory(e, "2026-09-14", []int{90, 60}) != "D-60" {
		t.Fatal("reminder category follows configured threshold")
	}
}

func TestEvaluateContractBoundaries(t *testing.T) {
	e := active()
	cases := map[string]string{"2026-09-14": ContractExpiring, "2026-09-13": ContractExpired, "2026-10-14": ContractExpiring, "2026-10-15": ContractOK}
	for end, want := range cases {
		e.ContractEndDate = sp(end)
		if got := EvaluateContract(e, "2026-09-14", DefaultReminderDays).Status; got != want {
			t.Errorf("end %s: got %s want %s", end, got, want)
		}
	}
}

func TestEvaluateContractUsesJakartaBusinessDate(t *testing.T) {
	// 2026-09-13 18:00 UTC is already 2026-09-14 01:00 in Jakarta.
	today := BusinessToday(time.Date(2026, 9, 13, 18, 0, 0, 0, time.UTC), "")
	if today != "2026-09-14" {
		t.Fatalf("business date %s", today)
	}
	e := active()
	e.ContractEndDate = sp("2026-09-13")
	if EvaluateContract(e, today, DefaultReminderDays).Status != ContractExpired {
		t.Fatal("contract that ended yesterday (Jakarta) is expired even though UTC is still the 13th")
	}
}

func TestEvaluateContractIncompleteDataIsNotGuessed(t *testing.T) {
	e := active()
	e.ContractStartDate = sp("2022-09-14")
	e.ContractEndDate = nil
	st := EvaluateContract(e, "2026-09-14", DefaultReminderDays)
	if st.Status != ContractIncomplete || st.DaysRemaining != nil || st.ReminderThreshold != nil {
		t.Fatalf("missing end date must not produce a status from start+N years: %+v", st)
	}
	e.ContractEndDate = sp("2022-01-01")
	if st := EvaluateContract(e, "2026-09-14", DefaultReminderDays); st.Status != ContractIncomplete {
		t.Fatalf("end before start is inconsistent, not expired: %s", st.Status)
	}
	e.ContractEndDate = sp("2026-02-30")
	if st := EvaluateContract(e, "2026-09-14", DefaultReminderDays); st.Status != ContractIncomplete {
		t.Fatalf("invalid calendar date: %s", st.Status)
	}
}

func TestEvaluateContractKeepsDurationAndTenureApart(t *testing.T) {
	e := active()
	e.JoinDate = sp("2020-09-14")
	e.ContractStartDate = sp("2026-01-01")
	e.ContractEndDate = sp("2026-12-31")
	st := EvaluateContract(e, "2026-09-14", DefaultReminderDays)
	if *st.ContractDurationDays != 364 || *st.TenureDays != 2191 {
		t.Fatalf("duration %d tenure %d", *st.ContractDurationDays, *st.TenureDays)
	}
}

func TestDocumentBlockersOnlyAcceptedSatisfies(t *testing.T) {
	b := DocumentBlockers([]string{"KTP", "KONTRAK", "SURAT"}, map[string]string{"KTP": DocAccepted, "KONTRAK": DocPending})
	if len(b) != 2 || b["KTP"] != "" || b["KONTRAK"] == "" || b["SURAT"] == "" {
		t.Fatalf("blockers %v", b)
	}
	if len(DocumentBlockers(nil, nil)) != 0 {
		t.Fatal("no requirement → no blocker")
	}
	if len(DocumentBlockers([]string{"KTP"}, map[string]string{"KTP": DocRejected})) != 1 {
		t.Fatal("rejected document blocks")
	}
}
