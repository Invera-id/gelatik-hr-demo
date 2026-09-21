export type Role = 'AREA_SUPPORT' | 'HR_HO' | 'OPERATIONS_MANAGER' | 'MANAGEMENT' | 'SUPER_ADMIN'
export type ValidationStatus = 'DRAFT' | 'SUBMITTED' | 'VALIDATED' | 'REVISION_REQUIRED'
export type ContractStatus = 'NOT_AVAILABLE' | 'DRAFT' | 'SIGNED'
export type EmploymentStatus = 'ACTIVE' | 'INACTIVE'
export type ReplacementStatus = 'OPEN' | 'MATCHED' | 'FULFILLED' | 'OVER_TARGET'
export type Permission = 'view_dashboard' | 'view_employee' | 'create_employee' | 'edit_employee' | 'create_exit' | 'validate_employee' | 'validate_exit' | 'view_replacement' | 'match_replacement' | 'fulfill_replacement' | 'export_data' | 'manage_users' | 'manage_roles'
export type ScopeType = 'OWN_AREA' | 'SELECTED_AREAS' | 'ALL_AREAS'
export type TransactionType = 'EMPLOYEE_ENTRY' | 'EMPLOYEE_BASIC_EDIT' | 'EMPLOYEE_PLACEMENT_CHANGE' | 'EMPLOYEE_EXIT'
export type ValidatorAuthority = 'AREA_ADMIN' | 'HR_HO' | 'BOTH'
export type EmployeeMovementType = 'JOIN' | 'PROMOTION' | 'MUTATION' | 'AREA_CHANGE' | 'PROJECT_CHANGE' | 'POSITION_CHANGE' | 'REPLACEMENT' | 'EXIT' | 'REENTRY' | 'OTHER'
export type EmployeeFlagStatus = 'NORMAL' | 'REVIEW_REQUIRED' | 'FLAGGED'

export interface RolePermissionConfig {
  role: Role
  permissions: Permission[]
  scope: ScopeType
  selectedAreaIds: string[]
}

export type ValidationPolicy = Record<TransactionType, ValidatorAuthority>

export interface Area {
  id: string
  name: string
}

export interface Project {
  id: string
  name: string
  clientName: string
  areaId: string
}

export interface DemoUser {
  id: string
  name: string
  email: string
  password: string
  role: Role
  areaId: string | null
}

export interface Employee {
  id: string
  personnelId: string
  name: string
  areaId: string | null
  subArea: string | null
  projectId: string | null
  position: string | null
  employmentStatus: EmploymentStatus
  joinDate: string | null
  contractStartDate: string | null
  contractEndDate: string | null
  contractStatus: ContractStatus
  bpjsStatus: string | null
  createdBy: string
  validationStatus: ValidationStatus
  validationTransaction?: Extract<TransactionType, 'EMPLOYEE_ENTRY' | 'EMPLOYEE_BASIC_EDIT'>
  validatedBy: string | null
  validatedAt: string | null
  submittedAt: string | null
  revisionNote: string | null
  createdAt: string
  updatedAt: string
}

export interface EmployeeExit {
  id: string
  employeeId: string
  exitDate: string
  exitReason: string
  replacementRequired: boolean
  createdBy: string
  validationStatus: ValidationStatus
  validatedBy: string | null
  validatedAt: string | null
  submittedAt: string | null
  revisionNote: string | null
  createdAt: string
  updatedAt: string
}

export interface ReplacementNeed {
  id: string
  employeeExitId: string
  originalEmployeeId: string
  areaId: string | null
  projectId: string | null
  position: string | null
  exitDate: string
  replacementEmployeeId: string | null
  replacementJoinDate: string | null
  previousReplacementNeedId: string | null
  status: ReplacementStatus
  fulfilledAt: string | null
  gapWorkingDays: number | null
  createdAt: string
  updatedAt: string
}

export interface PlacementChangeRequest {
  id: string
  employeeId: string
  movementType: Extract<EmployeeMovementType, 'PROMOTION' | 'MUTATION' | 'AREA_CHANGE' | 'PROJECT_CHANGE' | 'POSITION_CHANGE'>
  effectiveDate: string
  previousAreaId: string | null
  newAreaId: string | null
  previousProjectId: string | null
  newProjectId: string | null
  previousPosition: string | null
  newPosition: string | null
  notes: string
  createdBy: string
  validationStatus: ValidationStatus
  validatedBy: string | null
  validatedAt: string | null
  submittedAt: string | null
  revisionNote: string | null
  createdAt: string
  updatedAt: string
}

export interface EmployeeNote {
  id: string
  employeeId: string
  notes: string
  createdBy: string
  createdAt: string
}

export interface EmployeeFlag {
  id: string
  employeeId: string
  status: EmployeeFlagStatus
  reason: string
  notes: string
  createdBy: string
  createdAt: string
}

export interface MovementEvent {
  id: string
  employeeId: string
  type: 'ENTRY' | 'EXIT' | 'VALIDATION' | 'MATCHING' | 'FULFILLMENT'
  title: string
  description: string
  date: string
}

export interface EmployeeMovement {
  id: string
  employeeId: string
  movementType: EmployeeMovementType
  effectiveDate: string
  previousAreaId: string | null
  newAreaId: string | null
  previousProjectId: string | null
  newProjectId: string | null
  previousPosition: string | null
  newPosition: string | null
  notes: string
  createdBy: string
  createdAt: string
}

export interface DemoData {
  employees: Employee[]
  employeeExits: EmployeeExit[]
  replacementNeeds: ReplacementNeed[]
  movements: MovementEvent[]
  employeeMovements: EmployeeMovement[]
  movementRequests: PlacementChangeRequest[]
  employeeNotes: EmployeeNote[]
  employeeFlags: EmployeeFlag[]
  permissionConfig: RolePermissionConfig[]
  validationPolicy: ValidationPolicy
}
