package domain

import (
	"fmt"
	"slices"
	"time"
)

// Contract monitoring keeps five concepts apart: contract start date, contract end
// date, contract duration (end − start), personnel tenure (today − join date) and the
// reminder thresholds (days before the end date). Only the end date drives status;
// nothing is inferred (no end date is ever computed from a start date + N years).

const (
	ContractExpiring   = "EXPIRING"
	ContractExpired    = "EXPIRED"
	ContractIncomplete = "INCOMPLETE"
	ContractOK         = "OK"
)

// DefaultReminderDays mirrors the thresholds the prototype hard-coded.
var DefaultReminderDays = []int{30, 14, 7}

// NormalizeReminderDays validates and sorts thresholds descending (1–5 unique values, 1..366 days).
func NormalizeReminderDays(days []int) ([]int, error) {
	if len(days) < 1 || len(days) > 5 {
		return nil, fmt.Errorf("isi 1 sampai 5 ambang pengingat")
	}
	out := slices.Clone(days)
	for _, d := range out {
		if d < 1 || d > 366 {
			return nil, fmt.Errorf("ambang pengingat harus antara 1 dan 366 hari (contoh: 30, 14, 7)")
		}
	}
	slices.Sort(out)
	if len(slices.Compact(slices.Clone(out))) != len(out) {
		return nil, fmt.Errorf("ambang pengingat tidak boleh duplikat")
	}
	slices.Reverse(out)
	return out, nil
}

// ContractState is the monitoring view of one personnel's current contract.
type ContractState struct {
	Status               string  `json:"status"`
	IncompleteReason     *string `json:"incompleteReason"`
	DaysRemaining        *int    `json:"daysRemaining"`
	ReminderThreshold    *int    `json:"reminderThreshold"`
	ContractDurationDays *int    `json:"contractDurationDays"`
	TenureDays           *int    `json:"tenureDays"`
}

// InContractMonitoring: only active, HR-validated, confirmed personnel are monitored
// (pending entries are not effective; NEEDS_REVIEW records are not trusted yet).
func InContractMonitoring(e Employee) bool {
	return e.EmploymentStatus == "ACTIVE" && e.ValidationStatus == "VALIDATED" && e.ConditionStatus != "NEEDS_REVIEW"
}

func daysBetween(from, to time.Time) int { return int(to.Sub(from).Hours() / 24) }

// EvaluateContract classifies one contract on a business date (YYYY-MM-DD, Asia/Jakarta).
// reminderDays must be normalized (descending). A contract ending today is EXPIRING
// (0 days left); it is EXPIRED from the next day on.
func EvaluateContract(e Employee, today string, reminderDays []int) ContractState {
	var st ContractState
	t, err := ParseDate(today)
	if err != nil {
		return ContractState{Status: ContractIncomplete, IncompleteReason: ptr("Tanggal bisnis tidak valid")}
	}
	if e.JoinDate != nil {
		if j, err := ParseDate(*e.JoinDate); err == nil && !j.After(t) {
			st.TenureDays = ptr(daysBetween(j, t))
		}
	}
	var start *time.Time
	if e.ContractStartDate != nil {
		if s, err := ParseDate(*e.ContractStartDate); err == nil {
			start = &s
		}
	}
	if e.ContractEndDate == nil || *e.ContractEndDate == "" {
		st.Status, st.IncompleteReason = ContractIncomplete, ptr("Tanggal berakhir kontrak belum diisi")
		return st
	}
	end, err := ParseDate(*e.ContractEndDate)
	if err != nil {
		st.Status, st.IncompleteReason = ContractIncomplete, ptr("Tanggal berakhir kontrak tidak valid")
		return st
	}
	if start != nil {
		if end.Before(*start) {
			st.Status, st.IncompleteReason = ContractIncomplete, ptr("Tanggal berakhir kontrak lebih awal dari tanggal mulai")
			return st
		}
		st.ContractDurationDays = ptr(daysBetween(*start, end))
	}
	left := daysBetween(t, end)
	st.DaysRemaining = &left
	switch {
	case left < 0:
		st.Status = ContractExpired
	case len(reminderDays) > 0 && left <= reminderDays[0]:
		st.Status = ContractExpiring
		// The tightest threshold that still covers the remaining days.
		th := reminderDays[0]
		for _, d := range reminderDays {
			if left <= d {
				th = d
			}
		}
		st.ReminderThreshold = &th
	default:
		st.Status = ContractOK
	}
	return st
}

// ContractReminderCategory returns "D-<threshold>", "EXPIRED" or "" for reminders.
func ContractReminderCategory(e Employee, today string, reminderDays []int) string {
	if !InContractMonitoring(e) {
		return ""
	}
	st := EvaluateContract(e, today, reminderDays)
	switch st.Status {
	case ContractExpired:
		return "EXPIRED"
	case ContractExpiring:
		return fmt.Sprintf("D-%d", *st.ReminderThreshold)
	}
	return ""
}

func ptr[T any](v T) *T { return &v }
