// Package domain contains API-facing models and pure business rules
// (eligibility, working-day gap, contract reminders, dashboard figures).
// Nothing here performs I/O.
package domain

import "time"

// Employee is the current-condition view of one personnel record.
type Employee struct {
	ID                    string         `json:"id"`
	PersonnelID           string         `json:"personnelId"`
	Name                  string         `json:"name"`
	AreaID                *string        `json:"areaId"`
	SubArea               *string        `json:"subArea"`
	ProjectID             *string        `json:"projectId"`
	Position              *string        `json:"position"`
	EmploymentStatus      string         `json:"employmentStatus"`
	ConditionStatus       string         `json:"conditionStatus"`
	JoinDate              *string        `json:"joinDate"`
	ContractStartDate     *string        `json:"contractStartDate"`
	ContractEndDate       *string        `json:"contractEndDate"`
	ContractStatus        string         `json:"contractStatus"`
	BPJSStatus            *string        `json:"bpjsStatus"`
	Profile               map[string]any `json:"profile,omitempty"`
	CreatedBy             string         `json:"createdBy"`
	ValidationStatus      string         `json:"validationStatus"`
	ValidationTransaction *string        `json:"validationTransaction,omitempty"`
	ValidatedBy           *string        `json:"validatedBy"`
	ValidatedAt           *time.Time     `json:"validatedAt"`
	SubmittedAt           *time.Time     `json:"submittedAt"`
	RevisionNote          *string        `json:"revisionNote"`
	Source                string         `json:"source"`
	Version               int            `json:"version"`
	PendingChange         *PendingChange `json:"pendingChange,omitempty"`
	CreatedAt             time.Time      `json:"createdAt"`
	UpdatedAt             time.Time      `json:"updatedAt"`
}

// PendingChange describes a basic-edit request that is not yet effective.
type PendingChange struct {
	RequestID   string         `json:"requestId"`
	Status      string         `json:"status"`
	Proposed    map[string]any `json:"proposed"`
	BaseVersion int            `json:"baseVersion"`
}

type EmployeeExit struct {
	ID                  string     `json:"id"`
	EmployeeID          string     `json:"employeeId"`
	ExitDate            string     `json:"exitDate"`
	ExitReason          string     `json:"exitReason"`
	ReplacementRequired bool       `json:"replacementRequired"`
	CreatedBy           string     `json:"createdBy"`
	ValidationStatus    string     `json:"validationStatus"`
	ValidatedBy         *string    `json:"validatedBy"`
	ValidatedAt         *time.Time `json:"validatedAt"`
	SubmittedAt         *time.Time `json:"submittedAt"`
	RevisionNote        *string    `json:"revisionNote"`
	CreatedAt           time.Time  `json:"createdAt"`
	UpdatedAt           time.Time  `json:"updatedAt"`
	Derived             bool       `json:"derived,omitempty"`
}

type PlacementChangeRequest struct {
	ID                string     `json:"id"`
	EmployeeID        string     `json:"employeeId"`
	MovementType      string     `json:"movementType"`
	EffectiveDate     string     `json:"effectiveDate"`
	PreviousAreaID    *string    `json:"previousAreaId"`
	NewAreaID         *string    `json:"newAreaId"`
	PreviousProjectID *string    `json:"previousProjectId"`
	NewProjectID      *string    `json:"newProjectId"`
	PreviousPosition  *string    `json:"previousPosition"`
	NewPosition       *string    `json:"newPosition"`
	Notes             string     `json:"notes"`
	CreatedBy         string     `json:"createdBy"`
	ValidationStatus  string     `json:"validationStatus"`
	ValidatedBy       *string    `json:"validatedBy"`
	ValidatedAt       *time.Time `json:"validatedAt"`
	SubmittedAt       *time.Time `json:"submittedAt"`
	RevisionNote      *string    `json:"revisionNote"`
	BaseVersion       int        `json:"baseVersion"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

// ReplacementNeed keeps lifecycle and SLA apart. Status is the combined legacy
// label (OPEN, MATCHED, FULFILLED, OVER_TARGET) the UI already understands.
type ReplacementNeed struct {
	ID                        string     `json:"id"`
	EmployeeExitID            string     `json:"employeeExitId"`
	OriginalEmployeeID        string     `json:"originalEmployeeId"`
	AreaID                    *string    `json:"areaId"`
	ProjectID                 *string    `json:"projectId"`
	Position                  *string    `json:"position"`
	ExitDate                  string     `json:"exitDate"`
	ReplacementEmployeeID     *string    `json:"replacementEmployeeId"`
	ReplacementJoinDate       *string    `json:"replacementJoinDate"`
	PreviousReplacementNeedID *string    `json:"previousReplacementNeedId"`
	Status                    string     `json:"status"`
	LifecycleStatus           string     `json:"lifecycleStatus"`
	SLAStatus                 *string    `json:"slaStatus"`
	FulfilledAt               *time.Time `json:"fulfilledAt"`
	GapWorkingDays            *int       `json:"gapWorkingDays"`
	Version                   int        `json:"version"`
	CreatedAt                 time.Time  `json:"createdAt"`
	UpdatedAt                 time.Time  `json:"updatedAt"`
	Derived                   bool       `json:"derived,omitempty"`
}

// CombinedStatus maps lifecycle + SLA to the legacy single status.
func CombinedStatus(lifecycle string, sla *string) string {
	if lifecycle == "FULFILLED" && sla != nil && *sla == "OVER_TARGET" {
		return "OVER_TARGET"
	}
	return lifecycle
}

type CareerEvent struct {
	ID                string    `json:"id"`
	EmployeeID        string    `json:"employeeId"`
	MovementType      string    `json:"movementType"`
	EffectiveDate     string    `json:"effectiveDate"`
	PreviousAreaID    *string   `json:"previousAreaId"`
	NewAreaID         *string   `json:"newAreaId"`
	PreviousProjectID *string   `json:"previousProjectId"`
	NewProjectID      *string   `json:"newProjectId"`
	PreviousPosition  *string   `json:"previousPosition"`
	NewPosition       *string   `json:"newPosition"`
	Notes             string    `json:"notes"`
	CreatedBy         string    `json:"createdBy"`
	CreatedAt         time.Time `json:"createdAt"`
	Derived           bool      `json:"derived,omitempty"`
}

type ActivityEvent struct {
	ID          string    `json:"id"`
	EmployeeID  string    `json:"employeeId"`
	Type        string    `json:"type"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Date        time.Time `json:"date"`
}

type EmployeeNote struct {
	ID         string    `json:"id"`
	EmployeeID string    `json:"employeeId"`
	Notes      string    `json:"notes"`
	CreatedBy  string    `json:"createdBy"`
	CreatedAt  time.Time `json:"createdAt"`
}

type EmployeeFlag struct {
	ID         string    `json:"id"`
	EmployeeID string    `json:"employeeId"`
	Status     string    `json:"status"`
	Reason     string    `json:"reason"`
	Notes      string    `json:"notes"`
	CreatedBy  string    `json:"createdBy"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Area struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Project struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	ClientName string  `json:"clientName"`
	AreaID     string  `json:"areaId"`
	SubArea    *string `json:"subArea"`
	Status     string  `json:"status"`
	StartDate  *string `json:"startDate"`
	EndDate    *string `json:"endDate"`
}

type ProjectQuota struct {
	ID        string `json:"id"`
	ProjectID string `json:"projectId"`
	Period    string `json:"period"`
	Quota     int    `json:"quota"`
}

type UserSummary struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Role   string  `json:"role"`
	AreaID *string `json:"areaId"`
}
