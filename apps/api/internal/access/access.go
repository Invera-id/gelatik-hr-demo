// Package access defines roles, permissions, area scope and validation policy.
// It mirrors the RBAC model the frontend prototype established; the server is the
// only authority that enforces it.
package access

import "slices"

type Role string

const (
	RoleAreaSupport Role = "AREA_SUPPORT"
	RoleHRHO        Role = "HR_HO"
	RoleOperations  Role = "OPERATIONS_MANAGER"
	RoleManagement  Role = "MANAGEMENT"
	RoleSuperAdmin  Role = "SUPER_ADMIN"
)

var Roles = []Role{RoleAreaSupport, RoleHRHO, RoleOperations, RoleManagement, RoleSuperAdmin}

func ValidRole(r string) bool { return slices.Contains(Roles, Role(r)) }

type Scope string

const (
	ScopeOwnArea       Scope = "OWN_AREA"
	ScopeSelectedAreas Scope = "SELECTED_AREAS"
	ScopeAllAreas      Scope = "ALL_AREAS"
)

func ValidScope(s string) bool {
	return s == string(ScopeOwnArea) || s == string(ScopeSelectedAreas) || s == string(ScopeAllAreas)
}

type Permission string

const (
	ViewDashboard           Permission = "view_dashboard"
	ViewAnalytics           Permission = "view_analytics"
	ViewNotifications       Permission = "view_notifications"
	ViewEmployee            Permission = "view_employee"
	CreateEmployee          Permission = "create_employee"
	EditEmployeeBasic       Permission = "edit_employee_basic"
	RequestPlacementChange  Permission = "request_placement_change"
	RequestEmployeeExit     Permission = "request_employee_exit"
	ReentryEmployee         Permission = "reentry_employee"
	ManageNotesFlags        Permission = "manage_employee_notes_flags"
	ViewMovementHistory     Permission = "view_movement_history"
	ImportPersonnel         Permission = "import_personnel"
	ViewImportReview        Permission = "view_import_review"
	ResolveImportReview     Permission = "resolve_import_review"
	ExportData              Permission = "export_data"
	ValidateEntryEdit       Permission = "validate_employee_entry_edit"
	ValidatePlacementChange Permission = "validate_placement_change"
	ValidateEmployeeExit    Permission = "validate_employee_exit"
	BulkValidate            Permission = "bulk_validate"
	ViewReplacement         Permission = "view_replacement"
	MatchReplacement        Permission = "match_replacement"
	FulfillReplacement      Permission = "fulfill_replacement"
	ViewProject             Permission = "view_project"
	ManageProject           Permission = "manage_project"
	ToggleProjectStatus     Permission = "toggle_project_status"
	ManageProjectQuota      Permission = "manage_project_quota"
	ManageRoles             Permission = "manage_roles"
	ManageValidationPolicy  Permission = "manage_validation_policy"
	ResetDemoData           Permission = "reset_demo_data"
	UploadDocuments         Permission = "upload_documents"
	ReviewDocuments         Permission = "review_documents"
	ManageDocumentRules     Permission = "manage_document_requirements"
	ManageContractMonitor   Permission = "manage_contract_monitoring"
)

// AllPermissions is the full catalog in display order.
var AllPermissions = []Permission{
	ViewDashboard, ViewAnalytics, ViewNotifications, ViewEmployee, CreateEmployee, EditEmployeeBasic,
	RequestPlacementChange, RequestEmployeeExit, ReentryEmployee, ManageNotesFlags, ViewMovementHistory,
	ImportPersonnel, ViewImportReview, ResolveImportReview, ExportData, ValidateEntryEdit,
	ValidatePlacementChange, ValidateEmployeeExit, BulkValidate, ViewReplacement, MatchReplacement,
	FulfillReplacement, ViewProject, ManageProject, ToggleProjectStatus, ManageProjectQuota, ManageRoles,
	ManageValidationPolicy, ResetDemoData, UploadDocuments, ReviewDocuments, ManageDocumentRules, ManageContractMonitor,
}

func ValidPermission(p string) bool { return slices.Contains(AllPermissions, Permission(p)) }

// LockedSuperAdmin keeps configuration access from being removed from Super Admin.
var LockedSuperAdmin = []Permission{ManageRoles, ManageValidationPolicy, ResetDemoData}

type RoleConfig struct {
	Role            Role         `json:"role"`
	Scope           Scope        `json:"scope"`
	SelectedAreaIDs []string     `json:"selectedAreaIds"`
	Permissions     []Permission `json:"permissions"`
}

func DefaultRoleConfigs() []RoleConfig {
	return []RoleConfig{
		{Role: RoleAreaSupport, Scope: ScopeOwnArea, SelectedAreaIDs: []string{}, Permissions: []Permission{ViewDashboard, ViewNotifications, ViewEmployee, CreateEmployee, EditEmployeeBasic, RequestPlacementChange, RequestEmployeeExit, ReentryEmployee, ManageNotesFlags, ViewMovementHistory, ImportPersonnel, ViewReplacement, ViewProject, UploadDocuments}},
		{Role: RoleHRHO, Scope: ScopeAllAreas, SelectedAreaIDs: []string{}, Permissions: []Permission{ViewDashboard, ViewAnalytics, ViewNotifications, ViewEmployee, CreateEmployee, EditEmployeeBasic, RequestPlacementChange, RequestEmployeeExit, ReentryEmployee, ManageNotesFlags, ViewMovementHistory, ImportPersonnel, ViewImportReview, ResolveImportReview, ExportData, ValidateEntryEdit, ValidatePlacementChange, ValidateEmployeeExit, BulkValidate, ViewReplacement, MatchReplacement, FulfillReplacement, ViewProject, ManageProject, ToggleProjectStatus, ManageProjectQuota, UploadDocuments, ReviewDocuments}},
		{Role: RoleOperations, Scope: ScopeAllAreas, SelectedAreaIDs: []string{}, Permissions: []Permission{ViewDashboard, ViewAnalytics, ViewEmployee, ViewMovementHistory, ExportData, ViewReplacement, ViewProject}},
		{Role: RoleManagement, Scope: ScopeAllAreas, SelectedAreaIDs: []string{}, Permissions: []Permission{ViewDashboard, ViewAnalytics, ViewEmployee, ViewMovementHistory, ExportData, ViewReplacement, ViewProject}},
		{Role: RoleSuperAdmin, Scope: ScopeAllAreas, SelectedAreaIDs: []string{}, Permissions: slices.Clone(AllPermissions)},
	}
}

type TransactionType string

const (
	TxEntry           TransactionType = "EMPLOYEE_ENTRY"
	TxBasicEdit       TransactionType = "EMPLOYEE_BASIC_EDIT"
	TxPlacementChange TransactionType = "EMPLOYEE_PLACEMENT_CHANGE"
	TxExit            TransactionType = "EMPLOYEE_EXIT"
)

var TransactionTypes = []TransactionType{TxEntry, TxBasicEdit, TxPlacementChange, TxExit}

type Authority string

const (
	AuthorityAreaAdmin Authority = "AREA_ADMIN"
	AuthorityHRHO      Authority = "HR_HO"
	AuthorityBoth      Authority = "BOTH"
)

type ValidationPolicy map[TransactionType]Authority

func DefaultValidationPolicy() ValidationPolicy {
	return ValidationPolicy{TxEntry: AuthorityHRHO, TxBasicEdit: AuthorityAreaAdmin, TxPlacementChange: AuthorityHRHO, TxExit: AuthorityHRHO}
}

// ValidatePermissionFor maps a transaction to the permission needed to validate it.
func ValidatePermissionFor(t TransactionType) Permission {
	switch t {
	case TxExit:
		return ValidateEmployeeExit
	case TxPlacementChange:
		return ValidatePlacementChange
	default:
		return ValidateEntryEdit
	}
}

// Principal is the authenticated identity resolved server-side for each request.
type Principal struct {
	UserID string
	Name   string
	Email  string
	Role   Role
	AreaID *string
	Config RoleConfig
	Policy ValidationPolicy
}

func (p Principal) Has(perm Permission) bool { return slices.Contains(p.Config.Permissions, perm) }

// AllowedAreaIDs returns nil for all-area scope, otherwise the explicit list (possibly empty).
func (p Principal) AllowedAreaIDs() []string {
	switch p.Config.Scope {
	case ScopeAllAreas:
		return nil
	case ScopeOwnArea:
		if p.AreaID == nil || *p.AreaID == "" {
			return []string{}
		}
		return []string{*p.AreaID}
	default:
		return slices.Clone(p.Config.SelectedAreaIDs)
	}
}

func (p Principal) AllAreas() bool { return p.Config.Scope == ScopeAllAreas }

// CoversArea reports whether an area is within scope. Unknown areas need all-area scope.
func (p Principal) CoversArea(areaID *string) bool {
	if p.AllAreas() {
		return true
	}
	if areaID == nil || *areaID == "" {
		return false
	}
	return slices.Contains(p.AllowedAreaIDs(), *areaID)
}

// CanValidate applies the configured validation policy (role-based authority).
func (p Principal) CanValidate(t TransactionType) bool {
	if p.Role == RoleSuperAdmin {
		return true
	}
	switch p.Policy[t] {
	case AuthorityBoth:
		return p.Role == RoleAreaSupport || p.Role == RoleHRHO
	case AuthorityAreaAdmin:
		return p.Role == RoleAreaSupport
	default:
		return p.Role == RoleHRHO
	}
}

// MayValidate combines permission, policy and scope for one transaction.
func (p Principal) MayValidate(t TransactionType, areas ...*string) bool {
	if !p.Has(ValidatePermissionFor(t)) || !p.CanValidate(t) {
		return false
	}
	for _, a := range areas {
		if !p.CoversArea(a) {
			return false
		}
	}
	return true
}
