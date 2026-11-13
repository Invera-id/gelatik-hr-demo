package domain

import (
	"fmt"
	"time"
)

// Jakarta is the business timezone used to interpret "today" and business dates.
var Jakarta = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return time.FixedZone("WIB", 7*3600)
	}
	return loc
}()

// SLATargetWorkingDays is the fulfillment target (DEMO ASSUMPTION / TBC).
const SLATargetWorkingDays = 3

// BusinessToday returns today's date in Asia/Jakarta, or the configured override.
func BusinessToday(now time.Time, override string) string {
	if override != "" {
		return override
	}
	return now.In(Jakarta).Format(time.DateOnly)
}

func ParseDate(s string) (time.Time, error) { return time.Parse(time.DateOnly, s) }

// ValidDate accepts only real calendar dates in YYYY-MM-DD form.
func ValidDate(s string) bool {
	_, err := ParseDate(s)
	return err == nil
}

// WorkingDayGap counts Monday–Friday days after exitDate up to and including joinDate.
// No public-holiday calendar is applied (DEMO ASSUMPTION / TBC).
func WorkingDayGap(exitDate, joinDate string) (int, error) {
	start, err := ParseDate(exitDate)
	if err != nil {
		return 0, fmt.Errorf("exit date: %w", err)
	}
	end, err := ParseDate(joinDate)
	if err != nil {
		return 0, fmt.Errorf("join date: %w", err)
	}
	total := 0
	for d := start.AddDate(0, 0, 1); !d.After(end); d = d.AddDate(0, 0, 1) {
		if wd := d.Weekday(); wd != time.Saturday && wd != time.Sunday {
			total++
		}
	}
	return total, nil
}

func SLAStatusFor(gap int) string {
	if gap <= SLATargetWorkingDays {
		return "WITHIN_TARGET"
	}
	return "OVER_TARGET"
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func HasCompletePlacement(areaID, projectID, position *string) bool {
	return str(areaID) != "" && str(projectID) != "" && str(position) != ""
}

// IsCountableActive: active workforce requires ACTIVE, VALIDATED and a confirmed condition.
func IsCountableActive(e Employee) bool {
	return e.EmploymentStatus == "ACTIVE" && e.ValidationStatus == "VALIDATED" && e.ConditionStatus != "NEEDS_REVIEW"
}

// CandidateEligibility applies exact matching (Area + Project + Position, DEMO ASSUMPTION / TBC).
// allocatedElsewhere is true when the candidate is matched on another active need.
func CandidateEligibility(need ReplacementNeed, c Employee, allocatedElsewhere bool) []string {
	var reasons []string
	if !HasCompletePlacement(need.AreaID, need.ProjectID, need.Position) {
		reasons = append(reasons, "Data sumber kebutuhan belum lengkap")
	}
	if !HasCompletePlacement(c.AreaID, c.ProjectID, c.Position) {
		reasons = append(reasons, "Data kandidat belum lengkap")
	}
	if str(c.AreaID) != str(need.AreaID) {
		reasons = append(reasons, "Area tidak sesuai")
	}
	if str(c.ProjectID) != str(need.ProjectID) {
		reasons = append(reasons, "Project tidak sesuai")
	}
	if str(c.Position) != str(need.Position) {
		reasons = append(reasons, "Posisi tidak sesuai")
	}
	if c.ID == need.OriginalEmployeeID {
		reasons = append(reasons, "Karyawan asal tidak dapat menjadi pengganti")
	}
	if c.EmploymentStatus != "ACTIVE" {
		reasons = append(reasons, "Karyawan tidak aktif")
	}
	if c.ConditionStatus == "NEEDS_REVIEW" {
		reasons = append(reasons, "Kondisi terkini belum ditinjau")
	}
	if allocatedElsewhere {
		reasons = append(reasons, "Karyawan sudah dialokasikan pada kebutuhan aktif lain")
	}
	return reasons
}

// FulfillmentBlockers adds the contract gate (SIGNED, DEMO ASSUMPTION / TBC) and date checks.
func FulfillmentBlockers(need ReplacementNeed, c Employee, allocatedElsewhere bool) []string {
	reasons := CandidateEligibility(need, c, allocatedElsewhere)
	if c.ValidationStatus != "VALIDATED" {
		reasons = append(reasons, "Data karyawan belum tervalidasi HR")
	}
	if c.ContractStatus != "SIGNED" {
		reasons = append(reasons, "Kontrak belum ditandatangani")
	}
	if c.JoinDate == nil || *c.JoinDate == "" {
		reasons = append(reasons, "Tanggal bergabung belum tersedia")
	} else if *c.JoinDate < need.ExitDate {
		reasons = append(reasons, "Tanggal bergabung tidak boleh lebih awal dari tanggal exit employee sebelumnya")
	}
	return reasons
}
