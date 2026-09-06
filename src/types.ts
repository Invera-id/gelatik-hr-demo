export type Role = 'AREA_SUPPORT' | 'HR_HO' | 'MANAGEMENT'
export type ValidationStatus = 'DRAFT' | 'SUBMITTED' | 'VALIDATED' | 'REVISION_REQUIRED'
export type ContractStatus = 'NOT_AVAILABLE' | 'DRAFT' | 'SIGNED'
export type EmploymentStatus = 'ACTIVE' | 'INACTIVE'
export type ReplacementStatus = 'OPEN' | 'MATCHED' | 'FULFILLED' | 'OVER_TARGET'

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
  validatedBy: string | null
  validatedAt: string | null
  submittedAt: string | null
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
  status: ReplacementStatus
  fulfilledAt: string | null
  gapWorkingDays: number | null
  createdAt: string
  updatedAt: string
}

export interface MovementEvent {
  id: string
  employeeId: string
  type: 'ENTRY' | 'EXIT' | 'VALIDATION' | 'MATCHING' | 'FULFILLMENT'
  title: string
  description: string
  date: string
}

export interface DemoData {
  employees: Employee[]
  employeeExits: EmployeeExit[]
  replacementNeeds: ReplacementNeed[]
  movements: MovementEvent[]
}

