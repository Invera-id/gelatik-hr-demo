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
  subArea: string | null
  status: 'ACTIVE' | 'INACTIVE'
  startDate: string | null
  endDate: string | null
}

export interface ProjectQuota {
  id: string
  projectId: string
  period: string
  quota: number
}

/** Optional dummy-only fields grouped in the UI; no real CSV rows are imported. */
export interface EmployeeProfile {
  areaCbs?: string | null
  nationalId?: string | null
  birthPlace?: string | null
  birthDate?: string | null
  gender?: string | null
  ktpAddress?: string | null
  ktpRt?: string | null
  ktpRw?: string | null
  ktpKelurahan?: string | null
  ktpKecamatan?: string | null
  ktpCity?: string | null
  ktpProvince?: string | null
  ktpPostalCode?: string | null
  religion?: string | null
  domicileAddress?: string | null
  domicileRt?: string | null
  domicileRw?: string | null
  domicileKelurahan?: string | null
  domicileKecamatan?: string | null
  domicileCity?: string | null
  domicileProvince?: string | null
  domicilePostalCode?: string | null
  maritalStatus?: string | null
  education?: string | null
  homePhone?: string | null
  mobilePhone?: string | null
  email?: string | null
  initialDepositDate?: string | null
  bankAccountNumber?: string | null
  bankAccountName?: string | null
  taxId?: string | null
  program?: string | null
  clientName?: string | null
  projectName?: string | null
  teamLeader?: string | null
  employeeStatus?: string | null
  outlet?: string | null
  coverageArea?: string | null
  jamsostekNumber?: string | null
  bpjsHealthNumber?: string | null
  motherName?: string | null
  motherNationalId?: string | null
  mutationDate?: string | null
  exitDate?: string | null
  exitReason?: string | null
  penalty?: string | null
  academicScore?: string | null
  personalityScore?: string | null
  basicAbilityScore?: string | null
  logicScore?: string | null
  height?: string | null
  weight?: string | null
  noGlasses?: string | null
  notCrossEyed?: string | null
  notColorBlind?: string | null
  noBraces?: string | null
  healthyTeeth?: string | null
  healthySkin?: string | null
  normalPosture?: string | null
  normalWalking?: string | null
  pregnancyCondition?: string | null
  clearSpeech?: string | null
  agreementTermination?: 'YA' | 'TIDAK' | null
  warningLetter?: string | null
  companyName?: string | null
  tenureLabel?: string | null
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
  profile?: EmployeeProfile
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
  projects: Project[]
  projectQuotas: ProjectQuota[]
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
