/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { createImportOnlyData, createInitialData, demoUsers } from '../data/demoData'
import { dataMode, dataStorageKey, isSampleMode } from '../config/dataMode'
import { allowedAreaIds, canValidateTransaction, cloneDefaultPermissions, defaultValidationPolicy, hasPermission, lockedSuperAdminPermissions, migratePermissionConfig } from '../config/access'
import { calculateWorkingDayGap, canReviewImportItem, getCandidateEligibility, getFulfillmentBlockers, getGapStatus, hasCompleteSourceData } from '../lib/businessRules'
import type { Area, DemoData, DemoUser, Employee, EmployeeExit, EmployeeFlagStatus, EmployeeMovement, MovementEvent, Permission, PlacementChangeRequest, Project, ProjectQuota, ReplacementNeed, Role, ScopeType, TransactionType, ValidationStatus, ValidatorAuthority } from '../types'
import { personnelRepository } from '../lib/import/repository'
import { commitPreparedImport, prepareImport, type ImportPhase, type ImportRunResult, type PrepareImportResult, type PreparedImport } from '../lib/import/service'
import type { ImportBatch, ImportException, ReviewDecision, ReviewItem, SourceImportRecord, StoredPersonnel } from '../lib/import/types'
import { deriveImportMovements } from '../lib/import/derivedEvents'
import { toBusinessKey } from '../lib/import/parse'
import { validateReviewDecision } from '../lib/import/reviewDecision'
import { findAreaId, findProjectId } from '../lib/import/referenceCatalog'
import { deriveHistoricalWorkforce } from '../lib/import/historicalWorkforce'
import { DEMO_TODAY } from '../lib/contractRules'
import { clearAll as clearNotifications, emit as emitNotifications, resolveByDedupePrefix } from '../lib/notifications/service'
import * as notify from '../lib/notifications/events'
import type { AccessContext } from '../lib/notifications/rules'

const DATA_KEY = dataStorageKey
const USER_KEY = 'gelatik-demo-user-v1'

export interface DemoState extends DemoData {
  currentUserId: string | null
}

export type DemoAction =
  | { type: 'LOGIN'; userId: string }
  | { type: 'LOGOUT' }
  | { type: 'RESET' }
  | { type: 'SAVE_EMPLOYEE'; employee: Employee }
  | { type: 'SAVE_EXIT'; exit: EmployeeExit }
  | { type: 'SET_EMPLOYEE_VALIDATION'; employeeId: string; status: Extract<ValidationStatus, 'VALIDATED' | 'REVISION_REQUIRED'>; validatorId: string; note?: string }
  | { type: 'SET_EMPLOYEE_VALIDATION_BULK'; employeeIds: string[]; validatorId: string }
  | { type: 'SET_EXIT_VALIDATION'; exitId: string; status: Extract<ValidationStatus, 'VALIDATED' | 'REVISION_REQUIRED'>; validatorId: string; note?: string; employee?: Employee }
  | { type: 'MATCH_CANDIDATE'; needId: string; employeeId: string; candidate?: Employee }
  | { type: 'FULFILL_NEED'; needId: string; candidate?: Employee }
  | { type: 'TOGGLE_PERMISSION'; role: Role; permission: Permission }
  | { type: 'SET_ROLE_SCOPE'; role: Role; scope: ScopeType; selectedAreaIds?: string[] }
  | { type: 'RESET_PERMISSIONS' }
  | { type: 'SET_VALIDATION_POLICY'; transaction: TransactionType; authority: ValidatorAuthority }
  | { type: 'SAVE_MOVEMENT_REQUEST'; request: PlacementChangeRequest }
  | { type: 'SET_MOVEMENT_VALIDATION'; requestId: string; status: Extract<ValidationStatus, 'VALIDATED' | 'REVISION_REQUIRED'>; validatorId: string; note?: string }
  | { type: 'ADD_EMPLOYEE_NOTE'; employeeId: string; notes: string; userId: string }
  | { type: 'SET_EMPLOYEE_FLAG'; employeeId: string; status: EmployeeFlagStatus; reason: string; notes: string; userId: string }
  | { type: 'REENTRY_EMPLOYEE'; employeeId: string; areaId: string; projectId: string; position: string; joinDate: string; notes: string; userId: string; employee?: Employee }
  | { type: 'IMPORT_EMPLOYEES'; employees: Employee[] }
  | { type: 'IMPORT_REFERENCES'; areas: Area[]; projects: Project[] }
  | { type: 'SAVE_PROJECT'; project: Project }
  | { type: 'SET_PROJECT_STATUS'; projectId: string; status: Project['status'] }
  | { type: 'SAVE_PROJECT_QUOTA'; quota: ProjectQuota }

const loadData = (): DemoData => {
  const createData = isSampleMode ? createInitialData : createImportOnlyData
  try {
    const stored = localStorage.getItem(DATA_KEY)
    if (!stored) return createData()
    const parsed = JSON.parse(stored) as Partial<DemoData>
    const fresh = createData()
    const employees = (parsed.employees ?? fresh.employees).map((employee) => {
      const seeded = fresh.employees.find((item) => item.id === employee.id && item.personnelId === employee.personnelId)
      return employee.profile || !seeded ? employee : { ...employee, profile: { ...seeded.profile, areaCbs: fresh.areas.find((area) => area.id === employee.areaId)?.name ?? null } }
    })
    return { ...fresh, ...parsed, employees, permissionConfig: migratePermissionConfig(parsed.permissionConfig), validationPolicy: parsed.validationPolicy ?? { ...defaultValidationPolicy } }
  } catch {
    return createData()
  }
}

const createMovement = (employeeId: string, type: MovementEvent['type'], title: string, description: string): MovementEvent => ({
  id: `move-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  employeeId, type, title, description, date: new Date().toISOString(),
})

const persist = (state: DemoState): DemoState => {
  const data: DemoData = { areas: state.areas, projects: state.projects, projectQuotas: state.projectQuotas, employees: state.employees, employeeExits: state.employeeExits, replacementNeeds: state.replacementNeeds, movements: state.movements, employeeMovements: state.employeeMovements, movementRequests: state.movementRequests, employeeNotes: state.employeeNotes, employeeFlags: state.employeeFlags, permissionConfig: state.permissionConfig, validationPolicy: state.validationPolicy }
  localStorage.setItem(DATA_KEY, JSON.stringify(data))
  return state
}

export const demoReducer = (state: DemoState, action: DemoAction): DemoState => {
  switch (action.type) {
    case 'LOGIN':
      sessionStorage.setItem(USER_KEY, action.userId)
      return { ...state, currentUserId: action.userId }
    case 'LOGOUT':
      sessionStorage.removeItem(USER_KEY)
      return { ...state, currentUserId: null }
    case 'RESET': {
      const fresh = isSampleMode ? createInitialData() : createImportOnlyData()
      localStorage.removeItem(DATA_KEY)
      if (!isSampleMode) {
        // Imported masters remain in IndexedDB, so their placement catalog must
        // remain available as well; otherwise Reset would orphan Area/Project ids.
        return persist({ ...fresh, areas: state.areas, projects: state.projects, currentUserId: state.currentUserId })
      }
      return { ...fresh, currentUserId: state.currentUserId }
    }
    case 'SAVE_EMPLOYEE': {
      const exists = state.employees.some((employee) => employee.id === action.employee.id)
      const employees = exists
        ? state.employees.map((employee) => employee.id === action.employee.id ? action.employee : employee)
        : [action.employee, ...state.employees]
      const movement = createMovement(action.employee.id, 'ENTRY', action.employee.validationStatus === 'SUBMITTED' ? 'Entry dikirim untuk validasi' : 'Draft employee entry disimpan', `Data ${action.employee.name} diperbarui oleh Area Supporting`)
      return persist({ ...state, employees, movements: [movement, ...state.movements] })
    }
    case 'SAVE_EXIT': {
      const exists = state.employeeExits.some((item) => item.id === action.exit.id)
      const employeeExits = exists ? state.employeeExits.map((item) => item.id === action.exit.id ? action.exit : item) : [action.exit, ...state.employeeExits]
      const movement = createMovement(action.exit.employeeId, 'EXIT', action.exit.validationStatus === 'SUBMITTED' ? 'Exit dikirim untuk validasi' : 'Draft employee exit disimpan', action.exit.exitReason)
      return persist({ ...state, employeeExits, movements: [movement, ...state.movements] })
    }
    case 'SET_EMPLOYEE_VALIDATION': {
      const employee = state.employees.find((item) => item.id === action.employeeId)
      if (!employee) return state
      const now = new Date().toISOString()
      const employees = state.employees.map((item) => item.id === action.employeeId ? { ...item, validationStatus: action.status, revisionNote: action.status === 'REVISION_REQUIRED' ? action.note?.trim() || 'Perlu koreksi sebelum validasi.' : null, validatedBy: action.validatorId, validatedAt: now, updatedAt: now } : item)
      const movement = createMovement(employee.id, 'VALIDATION', action.status === 'VALIDATED' ? 'Employee entry divalidasi' : 'Revisi employee entry diminta', `Status validasi: ${action.status}`)
      return persist({ ...state, employees, movements: [movement, ...state.movements] })
    }
    case 'SET_EMPLOYEE_VALIDATION_BULK': {
      const ids = new Set(action.employeeIds)
      if (!ids.size) return state
      const now = new Date().toISOString()
      const employees = state.employees.map((employee) => ids.has(employee.id) ? {
        ...employee,
        validationStatus: 'VALIDATED' as const,
        revisionNote: null,
        validatedBy: action.validatorId,
        validatedAt: now,
        updatedAt: now,
      } : employee)
      return persist({ ...state, employees })
    }
    case 'SET_EXIT_VALIDATION': {
      const target = state.employeeExits.find((item) => item.id === action.exitId)
      if (!target) return state
      const employee = state.employees.find((item) => item.id === target.employeeId) ?? action.employee
      if (!employee) return state
      const now = new Date().toISOString()
      const employeeExits = state.employeeExits.map((item) => item.id === action.exitId ? { ...item, validationStatus: action.status, revisionNote: action.status === 'REVISION_REQUIRED' ? action.note?.trim() || 'Perlu koreksi sebelum validasi.' : null, validatedBy: action.validatorId, validatedAt: now, updatedAt: now } : item)
      const employees = action.status === 'VALIDATED' ? state.employees.map((item) => item.id === employee.id ? { ...item, employmentStatus: 'INACTIVE' as const, updatedAt: now } : item) : state.employees
      let replacementNeeds = state.replacementNeeds
      if (action.status === 'VALIDATED' && target.replacementRequired && !state.replacementNeeds.some((need) => need.employeeExitId === target.id)) {
        const need: ReplacementNeed = {
          id: `need-${Date.now()}`, employeeExitId: target.id, originalEmployeeId: employee.id,
          areaId: employee.areaId, projectId: employee.projectId, position: employee.position, exitDate: target.exitDate,
          replacementEmployeeId: null, replacementJoinDate: null, previousReplacementNeedId: state.replacementNeeds.find((item) => item.replacementEmployeeId === employee.id && ['FULFILLED', 'OVER_TARGET'].includes(item.status))?.id ?? null, status: 'OPEN', fulfilledAt: null, gapWorkingDays: null, createdAt: now, updatedAt: now,
        }
        replacementNeeds = [need, ...replacementNeeds]
      }
      const description = action.status === 'VALIDATED' && target.replacementRequired
        ? hasCompleteSourceData(employee) ? 'Exit tervalidasi dan replacement need dibuat' : 'Exit tervalidasi; replacement need dibuat dengan peringatan data sumber'
        : `Status validasi: ${action.status}`
      const movement = createMovement(employee.id, 'VALIDATION', action.status === 'VALIDATED' ? 'Employee exit divalidasi' : 'Revisi employee exit diminta', description)
      const exitHistory: EmployeeMovement = { id: `career-exit-${target.id}`, employeeId: employee.id, movementType: 'EXIT', effectiveDate: target.exitDate, previousAreaId: employee.areaId, newAreaId: employee.areaId, previousProjectId: employee.projectId, newProjectId: employee.projectId, previousPosition: employee.position, newPosition: employee.position, notes: target.exitReason, createdBy: target.createdBy, createdAt: now }
      const employeeMovements = action.status === 'VALIDATED' && !state.employeeMovements.some((item) => item.id === exitHistory.id) ? [exitHistory, ...state.employeeMovements] : state.employeeMovements
      return persist({ ...state, employees, employeeExits, replacementNeeds, employeeMovements, movements: [movement, ...state.movements] })
    }
    case 'MATCH_CANDIDATE': {
      const need = state.replacementNeeds.find((item) => item.id === action.needId)
      const employee = state.employees.find((item) => item.id === action.employeeId) ?? action.candidate
      if (!need || !employee || !getCandidateEligibility(need, employee, state.replacementNeeds).eligible) return state
      const now = new Date().toISOString()
      const replacementNeeds = state.replacementNeeds.map((item) => item.id === need.id ? { ...item, replacementEmployeeId: employee.id, status: 'MATCHED' as const, updatedAt: now } : item)
      const movement = createMovement(employee.id, 'MATCHING', 'Kandidat dipasangkan', `Dipasangkan ke kebutuhan ${need.id.toUpperCase()}`)
      return persist({ ...state, replacementNeeds, movements: [movement, ...state.movements] })
    }
    case 'FULFILL_NEED': {
      const need = state.replacementNeeds.find((item) => item.id === action.needId)
      const employee = state.employees.find((item) => item.id === need?.replacementEmployeeId) ?? action.candidate
      if (!need || !employee || getFulfillmentBlockers(employee, need, state.replacementNeeds).length || !employee.joinDate) return state
      const gap = calculateWorkingDayGap(need.exitDate, employee.joinDate)
      const now = new Date().toISOString()
      const status = getGapStatus(gap)
      const replacementNeeds = state.replacementNeeds.map((item) => item.id === need.id ? { ...item, replacementJoinDate: employee.joinDate, gapWorkingDays: gap, fulfilledAt: now, status, updatedAt: now } : item)
      const movement = createMovement(employee.id, 'FULFILLMENT', status === 'FULFILLED' ? 'Replacement terpenuhi' : 'Replacement melewati SLA', `Gap fulfillment ${gap} hari kerja`)
      const replacementHistory: EmployeeMovement = { id: `career-replacement-${need.id}`, employeeId: employee.id, movementType: 'REPLACEMENT', effectiveDate: employee.joinDate, previousAreaId: null, newAreaId: employee.areaId, previousProjectId: null, newProjectId: employee.projectId, previousPosition: null, newPosition: employee.position, notes: `Replacement untuk ${state.employees.find((item) => item.id === need.originalEmployeeId)?.name ?? need.originalEmployeeId}`, createdBy: state.currentUserId ?? employee.createdBy, createdAt: now }
      return persist({ ...state, replacementNeeds, employeeMovements: state.employeeMovements.some((item) => item.id === replacementHistory.id) ? state.employeeMovements : [replacementHistory, ...state.employeeMovements], movements: [movement, ...state.movements] })
    }
    case 'TOGGLE_PERMISSION': {
      if (action.role === 'SUPER_ADMIN' && lockedSuperAdminPermissions.includes(action.permission)) return state
      const permissionConfig = state.permissionConfig.map((item) => item.role === action.role ? { ...item, permissions: item.permissions.includes(action.permission) ? item.permissions.filter((permission) => permission !== action.permission) : [...item.permissions, action.permission] } : item)
      return persist({ ...state, permissionConfig })
    }
    case 'SET_ROLE_SCOPE': {
      const permissionConfig = state.permissionConfig.map((item) => item.role === action.role ? { ...item, scope: action.scope, selectedAreaIds: action.selectedAreaIds ?? item.selectedAreaIds } : item)
      return persist({ ...state, permissionConfig })
    }
    case 'RESET_PERMISSIONS':
      return persist({ ...state, permissionConfig: cloneDefaultPermissions() })
    case 'SET_VALIDATION_POLICY':
      return persist({ ...state, validationPolicy: { ...state.validationPolicy, [action.transaction]: action.authority } })
    case 'SAVE_MOVEMENT_REQUEST': {
      const exists = state.movementRequests.some((item) => item.id === action.request.id)
      const movementRequests = exists ? state.movementRequests.map((item) => item.id === action.request.id ? action.request : item) : [action.request, ...state.movementRequests]
      return persist({ ...state, movementRequests })
    }
    case 'SET_MOVEMENT_VALIDATION': {
      const request = state.movementRequests.find((item) => item.id === action.requestId)
      if (!request) return state
      const now = new Date().toISOString()
      const movementRequests = state.movementRequests.map((item) => item.id === request.id ? { ...item, validationStatus: action.status, revisionNote: action.status === 'REVISION_REQUIRED' ? action.note?.trim() || 'Perlu koreksi sebelum validasi.' : null, validatedBy: action.validatorId, validatedAt: now, updatedAt: now } : item)
      if (action.status !== 'VALIDATED') return persist({ ...state, movementRequests })
      const employees = state.employees.map((employee) => employee.id === request.employeeId ? { ...employee, areaId: request.newAreaId, projectId: request.newProjectId, position: request.newPosition, profile: { ...employee.profile, areaCbs: state.areas.find((area) => area.id === request.newAreaId)?.name ?? null }, updatedAt: now } : employee)
      const history: EmployeeMovement = { id: `career-${Date.now()}`, employeeId: request.employeeId, movementType: request.movementType, effectiveDate: request.effectiveDate, previousAreaId: request.previousAreaId, newAreaId: request.newAreaId, previousProjectId: request.previousProjectId, newProjectId: request.newProjectId, previousPosition: request.previousPosition, newPosition: request.newPosition, notes: request.notes, createdBy: request.createdBy, createdAt: now }
      return persist({ ...state, employees, employeeMovements: [history, ...state.employeeMovements], movementRequests })
    }
    case 'ADD_EMPLOYEE_NOTE': {
      if (!action.notes.trim()) return state
      const now = new Date().toISOString()
      return persist({ ...state, employeeNotes: [{ id: `note-${Date.now()}`, employeeId: action.employeeId, notes: action.notes.trim(), createdBy: action.userId, createdAt: now }, ...state.employeeNotes] })
    }
    case 'SET_EMPLOYEE_FLAG': {
      const now = new Date().toISOString()
      return persist({ ...state, employeeFlags: [{ id: `flag-${Date.now()}`, employeeId: action.employeeId, status: action.status, reason: action.reason.trim(), notes: action.notes.trim(), createdBy: action.userId, createdAt: now }, ...state.employeeFlags] })
    }
    case 'REENTRY_EMPLOYEE': {
      const target = state.employees.find((item) => item.id === action.employeeId) ?? action.employee
      if (!target || target.employmentStatus !== 'INACTIVE') return state
      const now = new Date().toISOString()
      const employees = state.employees.map((item) => item.id === target.id ? { ...item, areaId: action.areaId, projectId: action.projectId, position: action.position, joinDate: action.joinDate, profile: { ...item.profile, areaCbs: state.areas.find((area) => area.id === action.areaId)?.name ?? null }, employmentStatus: 'ACTIVE' as const, validationStatus: 'VALIDATED' as const, validatedBy: action.userId, validatedAt: now, updatedAt: now } : item)
      const history: EmployeeMovement = { id: `career-reentry-${Date.now()}`, employeeId: target.id, movementType: 'REENTRY', effectiveDate: action.joinDate, previousAreaId: target.areaId, newAreaId: action.areaId, previousProjectId: target.projectId, newProjectId: action.projectId, previousPosition: target.position, newPosition: action.position, notes: action.notes, createdBy: action.userId, createdAt: now }
      return persist({ ...state, employees, employeeMovements: [history, ...state.employeeMovements] })
    }
    case 'IMPORT_EMPLOYEES': {
      if (!action.employees.length) return state
      const existingIds = new Set(state.employees.map((employee) => employee.id))
      const importedIds = new Set(action.employees.map((employee) => employee.id))
      const employees = [...action.employees, ...state.employees.filter((employee) => !importedIds.has(employee.id))]
      const histories: EmployeeMovement[] = action.employees.filter((employee) => !existingIds.has(employee.id)).map((employee) => ({ id: `career-import-${employee.id}`, employeeId: employee.id, movementType: 'JOIN', effectiveDate: employee.joinDate ?? employee.createdAt.slice(0, 10), previousAreaId: null, newAreaId: employee.areaId, previousProjectId: null, newProjectId: employee.projectId, previousPosition: null, newPosition: employee.position, notes: 'Employee ditambahkan melalui Prototype Import Excel.', createdBy: employee.createdBy, createdAt: employee.createdAt }))
      return persist({ ...state, employees, employeeMovements: [...histories, ...state.employeeMovements] })
    }
    case 'IMPORT_REFERENCES': {
      const areaById = new Map(state.areas.map((area) => [area.id, area]))
      action.areas.forEach((area) => areaById.set(area.id, area))
      const projectById = new Map(state.projects.map((project) => [project.id, project]))
      action.projects.forEach((project) => projectById.set(project.id, project))
      return persist({ ...state, areas: [...areaById.values()], projects: [...projectById.values()] })
    }
    case 'SAVE_PROJECT': {
      if (!action.project.name.trim() || !action.project.clientName.trim() || !action.project.areaId) return state
      const projects = state.projects.some((item) => item.id === action.project.id) ? state.projects.map((item) => item.id === action.project.id ? action.project : item) : [...state.projects, action.project]
      return persist({ ...state, projects })
    }
    case 'SET_PROJECT_STATUS':
      return persist({ ...state, projects: state.projects.map((item) => item.id === action.projectId ? { ...item, status: action.status } : item) })
    case 'SAVE_PROJECT_QUOTA': {
      if (!/^\d{4}-\d{2}$/.test(action.quota.period) || action.quota.quota < 0 || !Number.isFinite(action.quota.quota) || !state.projects.some((item) => item.id === action.quota.projectId)) return state
      const projectQuotas = state.projectQuotas.filter((item) => !(item.projectId === action.quota.projectId && item.period === action.quota.period))
      return persist({ ...state, projectQuotas: [...projectQuotas, action.quota] })
    }
  }
}

interface LocalDemoValue extends DemoData {
  dataMode: typeof dataMode
  currentUser: DemoUser | null
  login: (email: string, password: string) => boolean
  logout: () => void
  resetDemo: () => void
  /** measures: typed Tinggi/Berat Badan text, validated by the server (API mode only); omit to keep stored values. */
  saveEmployee: (employee: Employee, measures?: { height: string; weight: string }) => void
  saveExit: (exit: EmployeeExit) => void
  setEmployeeValidation: (id: string, status: 'VALIDATED' | 'REVISION_REQUIRED', note?: string) => void
  validateEmployees: (ids: string[]) => Promise<number>
  setExitValidation: (id: string, status: 'VALIDATED' | 'REVISION_REQUIRED', note?: string) => void
  matchCandidate: (needId: string, employeeId: string) => void
  fulfillNeed: (needId: string) => void
  togglePermission: (role: Role, permission: Permission) => void
  setRoleScope: (role: Role, scope: ScopeType, selectedAreaIds?: string[]) => void
  resetPermissions: () => void
  setValidationPolicy: (transaction: TransactionType, authority: ValidatorAuthority) => void
  saveMovementRequest: (request: PlacementChangeRequest) => void
  setMovementValidation: (requestId: string, status: 'VALIDATED' | 'REVISION_REQUIRED', note?: string) => void
  addEmployeeNote: (employeeId: string, notes: string) => void
  setEmployeeFlag: (employeeId: string, status: EmployeeFlagStatus, reason: string, notes: string) => void
  reentryEmployee: (employeeId: string, areaId: string, projectId: string, position: string, joinDate: string, notes: string) => void
  importEmployees: (employees: Employee[]) => void
  /** Imported personnel persisted in IndexedDB (source of truth for the Excel import feature). */
  importedPersonnel: StoredPersonnel[]
  importBatches: ImportBatch[]
  importExceptions: ImportException[]
  importReviewItems: ReviewItem[]
  importSourceRecords: SourceImportRecord[]
  importStorageReady: boolean
  importStorageError: string | null
  canImportPersonnel: boolean
  importPersonnelFile: (file: File, onProgress?: (phase: ImportPhase) => void) => Promise<ImportRunResult>
  preparePersonnelImport: (file: File, onProgress?: (phase: ImportPhase) => void) => Promise<PrepareImportResult>
  confirmPersonnelImport: (prepared: PreparedImport, onProgress?: (phase: ImportPhase) => void) => Promise<ImportRunResult>
  refreshPersonnel: () => Promise<void>
  /** Pending import history (undecided) for a given master employee id. */
  pendingReviewFor: (employeeId: string) => ReviewItem[]
  /** Resolve one import review item (confirm movement/exit/re-entry, mark dup/profile/correction, or keep pending). */
  resolveReviewItem: (id: string, decision: ReviewDecision) => Promise<string | null>
  saveProject: (project: Project) => void
  setProjectStatus: (projectId: string, status: Project['status']) => void
  saveProjectQuota: (quota: ProjectQuota) => void
}

/** Outcome of a business action. API mode reports server validation errors here. */
export interface ActionResult {
  ok: boolean
  id?: string
  error?: string
  fields?: Record<string, string>
}

type AsyncAction<F> = F extends (...args: infer A) => unknown ? (...args: A) => Promise<ActionResult> : never

type ActionKey = 'saveEmployee' | 'saveExit' | 'setEmployeeValidation' | 'setExitValidation' | 'matchCandidate' | 'fulfillNeed' | 'togglePermission' | 'setRoleScope'
  | 'resetPermissions' | 'setValidationPolicy' | 'saveMovementRequest' | 'setMovementValidation' | 'addEmployeeNote' | 'setEmployeeFlag' | 'reentryEmployee'
  | 'saveProject' | 'setProjectStatus' | 'saveProjectQuota'

/**
 * The contract every page reads. Both the API provider and the explicit local
 * prototype provider implement it; actions are asynchronous in both.
 */
export interface DemoContextValue extends Omit<LocalDemoValue, ActionKey | 'login' | 'dataMode'>, DemoActions {
  dataMode: typeof dataMode | 'API'
  dataSource: 'api' | 'local'
  /** Business "today" (Asia/Jakarta on the server in API mode). */
  businessDate: string
  /** Directory for display names (no credentials). */
  users: Array<Pick<DemoUser, 'id' | 'name' | 'role'>>
  login: (email: string, password: string) => Promise<boolean>
  /** Last authentication error message (API mode), e.g. throttling. */
  authError?: string | null
  /** API mode: loads the full (sensitive) profile for the detail page. */
  fetchEmployeeDetail?: (id: string) => Promise<Employee | null>
  /** API mode: download a server-generated export. */
  downloadExport?: (kind: string, query: Record<string, string>) => Promise<string>
}
export type DemoActions = { [K in ActionKey]: AsyncAction<LocalDemoValue[K]> }

export const DemoContext = createContext<DemoContextValue | null>(null)

const done = (id?: string): Promise<ActionResult> => Promise.resolve({ ok: true, id })

export function DemoProvider({ children }: { children: ReactNode }) {
  const initialData = useMemo(() => loadData(), [])
  const [state, dispatch] = useReducer(demoReducer, {
    ...initialData,
    currentUserId: sessionStorage.getItem(USER_KEY),
  })
  const currentUser = demoUsers.find((user) => user.id === state.currentUserId) ?? null
  const canUseArea = (areaId: string | null) => {
    if (!currentUser) return false
    const areaIds = allowedAreaIds(currentUser, state.permissionConfig)
    return areaIds === null || Boolean(areaId && areaIds.includes(areaId))
  }

  // Imported personnel live in IndexedDB; they are hydrated here and merged into the
  // single `employees` source every view reads, so list/detail/dashboard stay consistent.
  const [importedPersonnel, setImportedPersonnel] = useState<StoredPersonnel[]>([])
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([])
  const [importExceptions, setImportExceptions] = useState<ImportException[]>([])
  const [importReviewItems, setImportReviewItems] = useState<ReviewItem[]>([])
  const [importSourceRecords, setImportSourceRecords] = useState<SourceImportRecord[]>([])
  const [importStorageReady, setImportStorageReady] = useState(false)
  const [importStorageError, setImportStorageError] = useState<string | null>(null)

  const refreshPersonnel = useCallback(async () => {
    try {
      const [personnel, batches, exceptions, reviews, sources] = await Promise.all([
        personnelRepository.getAllPersonnel(),
        personnelRepository.getBatches(),
        personnelRepository.getExceptions(),
        personnelRepository.getReviewItems(),
        personnelRepository.getSourceRecords(),
      ])
      setImportedPersonnel(personnel)
      setImportBatches(batches)
      setImportExceptions(exceptions)
      setImportReviewItems(reviews)
      setImportSourceRecords(sources)
      setImportStorageError(null)
    } catch (error) {
      setImportStorageError(error instanceof Error ? error.message : 'Penyimpanan lokal tidak tersedia.')
    } finally {
      setImportStorageReady(true)
    }
  }, [])

  // Hydrate from IndexedDB on mount. State is set only after the async load resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refreshPersonnel() }, [refreshPersonnel])

  const canImportPersonnel = Boolean(currentUser && hasPermission(currentUser, state.permissionConfig, 'import_personnel'))
  const importAllowedAreaNames = useCallback(() => {
    if (!currentUser) return []
    const ids = allowedAreaIds(currentUser, state.permissionConfig)
    return ids === null ? null : state.areas.filter((area) => ids.includes(area.id)).map((area) => area.name)
  }, [currentUser, state.areas, state.permissionConfig])

  const importPersonnelFile = useCallback(async (file: File, onProgress?: (phase: ImportPhase) => void): Promise<ImportRunResult> => {
    if (!currentUser || !hasPermission(currentUser, state.permissionConfig, 'import_personnel')) {
      return { ok: false, batch: null, summary: null, status: null, exceptions: [], error: 'Anda tidak memiliki izin untuk mengimpor personil.' }
    }
    const preview = await prepareImport({ file, repository: personnelRepository, areas: state.areas, projects: state.projects, createdBy: currentUser.id, onProgress, existingBusinessKeys: state.employees.map((employee) => toBusinessKey(employee.personnelId)), allowedAreaNames: importAllowedAreaNames() })
    const result = preview.ok && preview.prepared
      ? await commitPreparedImport(preview.prepared, personnelRepository)
      : { ok: false, batch: null, summary: null, status: null, exceptions: [], error: preview.error }
    // One summary notification per operation (not per row); failures notify the actor too.
    if (result.ok && result.batch) {
      if (preview.prepared) dispatch({ type: 'IMPORT_REFERENCES', areas: preview.prepared.discoveredAreas, projects: preview.prepared.discoveredProjects })
      const now = new Date().toISOString()
      emitNotifications(notify.buildImportSummary({ batch: result.batch, actor: currentUser, now }))
      // One extra "history needs review" notice per batch (never one per row).
      emitNotifications(notify.buildReviewNeeded({ batch: result.batch, actor: currentUser, now }))
      await refreshPersonnel()
    } else if (!result.ok) {
      emitNotifications(notify.buildImportFailure({ fileName: file.name, error: result.error ?? 'Impor gagal.', actor: currentUser, now: new Date().toISOString(), opId: `${file.name}-${Date.now()}` }))
    }
    return result
  }, [currentUser, state.permissionConfig, state.areas, state.projects, state.employees, refreshPersonnel, importAllowedAreaNames])

  const preparePersonnelImport = useCallback(async (file: File, onProgress?: (phase: ImportPhase) => void): Promise<PrepareImportResult> => {
    if (!currentUser || !hasPermission(currentUser, state.permissionConfig, 'import_personnel')) {
      return { ok: false, prepared: null, error: 'Anda tidak memiliki izin untuk mengimpor personil.' }
    }
    return prepareImport({ file, repository: personnelRepository, areas: state.areas, projects: state.projects, createdBy: currentUser.id, onProgress, existingBusinessKeys: state.employees.map((employee) => toBusinessKey(employee.personnelId)), allowedAreaNames: importAllowedAreaNames() })
  }, [currentUser, state.permissionConfig, state.areas, state.projects, state.employees, importAllowedAreaNames])

  const confirmPersonnelImport = useCallback(async (prepared: PreparedImport, onProgress?: (phase: ImportPhase) => void): Promise<ImportRunResult> => {
    if (!currentUser || !hasPermission(currentUser, state.permissionConfig, 'import_personnel')) {
      return { ok: false, batch: null, summary: null, status: null, exceptions: [], error: 'Anda tidak memiliki izin untuk mengimpor personil.' }
    }
    const currentScope = importAllowedAreaNames()
    if (JSON.stringify(currentScope === null ? null : [...currentScope].sort()) !== JSON.stringify(prepared.allowedAreaNames)) {
      return { ok: false, batch: null, summary: null, status: null, exceptions: [], error: 'Cakupan Area berubah sejak preview dibuat. Pilih ulang file agar data divalidasi dengan scope terbaru.' }
    }
    onProgress?.('SAVING')
    const result = await commitPreparedImport(prepared, personnelRepository)
    if (result.ok && result.batch) {
      dispatch({ type: 'IMPORT_REFERENCES', areas: prepared.discoveredAreas, projects: prepared.discoveredProjects })
      onProgress?.('DONE')
      const now = new Date().toISOString()
      emitNotifications(notify.buildImportSummary({ batch: result.batch, actor: currentUser, now }))
      emitNotifications(notify.buildReviewNeeded({ batch: result.batch, actor: currentUser, now }))
      await refreshPersonnel()
    }
    return result
  }, [currentUser, state.permissionConfig, refreshPersonnel, importAllowedAreaNames])

  // Canonical identity is normalized Personnel ID, not storage-specific internal id.
  const combinedEmployees = useMemo(() => {
    const map = new Map<string, Employee>()
    for (const employee of state.employees) map.set(toBusinessKey(employee.personnelId), employee)
    for (const personnel of importedPersonnel) map.set(personnel.businessKey, personnel.employee)
    return [...map.values()]
  }, [importedPersonnel, state.employees])

  const historicalWorkforce = useMemo(
    () => deriveHistoricalWorkforce(importedPersonnel.map((personnel) => personnel.employee)),
    [importedPersonnel],
  )
  const combinedEmployeeExits = useMemo(() => {
    const byEmployeeDate = new Map(historicalWorkforce.exits.map((exit) => [`${exit.employeeId}|${exit.exitDate}`, exit]))
    for (const exit of state.employeeExits) byEmployeeDate.set(`${exit.employeeId}|${exit.exitDate}`, exit)
    return [...byEmployeeDate.values()]
  }, [historicalWorkforce.exits, state.employeeExits])
  const combinedReplacementNeeds = useMemo(() => {
    const byEmployeeDate = new Map(historicalWorkforce.replacementNeeds.map((need) => [`${need.originalEmployeeId}|${need.exitDate}`, need]))
    for (const need of state.replacementNeeds) byEmployeeDate.set(`${need.originalEmployeeId}|${need.exitDate}`, need)
    return [...byEmployeeDate.values()]
  }, [historicalWorkforce.replacementNeeds, state.replacementNeeds])

  // Confirmed import history, derived as a VIEW over the IndexedDB review decisions
  // and merged (idempotently, by deterministic id) into the career timeline the
  // detail page reads. No cross-store write happens here (§8, §13).
  const combinedMovements = useMemo(() => {
    const employeeIdByKey = new Map(importedPersonnel.map((p) => [p.businessKey, p.employee.id]))
    const derived = deriveImportMovements(importReviewItems, importSourceRecords, { employeeIdByKey, areas: state.areas, projects: state.projects })
    const byId = new Map<string, EmployeeMovement>()
    for (const m of state.employeeMovements) byId.set(m.id, m)
    for (const m of derived) byId.set(m.id, m)
    for (const m of historicalWorkforce.movements) byId.set(m.id, m)
    return [...byId.values()]
  }, [historicalWorkforce.movements, importReviewItems, importSourceRecords, importedPersonnel, state.areas, state.employeeMovements, state.projects])

  /** Pending import history still awaiting a review decision, for the current person. */
  const pendingReviewFor = (employeeId: string): ReviewItem[] => {
    const key = importedPersonnel.find((p) => p.employee.id === employeeId)?.businessKey
    if (!key) return []
    return importReviewItems.filter((r) => r.businessKey === key && ['PENDING', 'KEPT_PENDING'].includes(r.status))
  }

  // Access context + helpers for business actions. Employee lookups use the combined
  // source so actions (exit, movement, validation, notifications) also work for
  // IndexedDB-backed imported personnel, not only the localStorage seed.
  const accessCtx: AccessContext = { users: demoUsers, permissionConfig: state.permissionConfig, validationPolicy: state.validationPolicy }
  const nowIso = () => new Date().toISOString()
  const areaNameOf = (areaId: string | null) => state.areas.find((area) => area.id === areaId)?.name ?? 'tidak diketahui'
  const findEmployee = (id: string | null | undefined) => combinedEmployees.find((item) => item.id === id)
  const isImported = (id: string) => importedPersonnel.some((personnel) => personnel.employee.id === id)
  // Persist a status/placement change back to IndexedDB for imported personnel.
  const writeThroughImported = (id: string, patch: Partial<Employee>) => {
    if (isImported(id)) void personnelRepository.patchEmployee(id, patch).then(() => { void refreshPersonnel() })
  }

  const local: LocalDemoValue = {
    dataMode, areas: state.areas, projects: state.projects, projectQuotas: state.projectQuotas, employees: combinedEmployees, employeeExits: combinedEmployeeExits, replacementNeeds: combinedReplacementNeeds, movements: state.movements, employeeMovements: combinedMovements, movementRequests: state.movementRequests, employeeNotes: state.employeeNotes, employeeFlags: state.employeeFlags, permissionConfig: state.permissionConfig, validationPolicy: state.validationPolicy, currentUser,
    importedPersonnel, importBatches, importExceptions, importReviewItems, importSourceRecords, importStorageReady, importStorageError, canImportPersonnel, importPersonnelFile, preparePersonnelImport, confirmPersonnelImport, refreshPersonnel, pendingReviewFor,
    login: (email, password) => {
      const user = demoUsers.find((item) => item.email.toLowerCase() === email.toLowerCase().trim() && item.password === password)
      if (!user) return false
      dispatch({ type: 'LOGIN', userId: user.id })
      return true
    },
    logout: () => dispatch({ type: 'LOGOUT' }),
    // Reset only local transactional demo state. Imported masters, batches,
    // source rows, exceptions, and review items in IndexedDB are preserved.
    resetDemo: () => {
      if (!currentUser || !hasPermission(currentUser, state.permissionConfig, 'reset_demo_data')) return
      dispatch({ type: 'RESET' })
      clearNotifications()
    },
    saveEmployee: (employee) => {
      if (!currentUser) return
      const before = combinedEmployees.find((item) => item.id === employee.id || toBusinessKey(item.personnelId) === toBusinessKey(employee.personnelId))
      const hasActionPermission = hasPermission(currentUser, state.permissionConfig, before ? 'edit_employee_basic' : 'create_employee')
      const placementUnchanged = !before || (before.areaId === employee.areaId && before.projectId === employee.projectId && before.position === employee.position)
      if (!(canUseArea(employee.areaId) && hasActionPermission && placementUnchanged)) return
      const imported = importedPersonnel.find((item) => item.employee.id === employee.id || item.businessKey === toBusinessKey(employee.personnelId))
      if (imported) {
        void personnelRepository.patchEmployee(imported.employee.id, employee).then(() => refreshPersonnel())
        return
      }
      dispatch({ type: 'SAVE_EMPLOYEE', employee })
      if (employee.validationStatus === 'SUBMITTED' && before?.validationStatus !== 'SUBMITTED') {
        emitNotifications(notify.buildEntrySubmission({ employee, actor: currentUser, areaName: areaNameOf(employee.areaId), ctx: accessCtx, now: nowIso() }))
      }
    },
    saveExit: (exit) => {
      const employee = findEmployee(exit.employeeId)
      if (!currentUser || !employee || !(canUseArea(employee.areaId) && hasPermission(currentUser, state.permissionConfig, 'request_employee_exit'))) return
      const before = state.employeeExits.find((item) => item.id === exit.id)
      dispatch({ type: 'SAVE_EXIT', exit })
      if (exit.validationStatus === 'SUBMITTED' && before?.validationStatus !== 'SUBMITTED') {
        emitNotifications(notify.buildExitSubmission({ exit, employee, actor: currentUser, areaName: areaNameOf(employee.areaId), ctx: accessCtx, now: nowIso() }))
      }
    },
    setEmployeeValidation: (employeeId, status, note) => {
      const employee = findEmployee(employeeId)
      if (!employee) return
      const transaction = employee.validationTransaction ?? 'EMPLOYEE_ENTRY'
      if (!(currentUser && canUseArea(employee.areaId) && hasPermission(currentUser, state.permissionConfig, 'validate_employee_entry_edit') && canValidateTransaction(currentUser, transaction, state.validationPolicy))) return
      dispatch({ type: 'SET_EMPLOYEE_VALIDATION', employeeId, status, validatorId: currentUser.id, note })
      if (isImported(employeeId)) writeThroughImported(employeeId, { validationStatus: status, revisionNote: status === 'REVISION_REQUIRED' ? note?.trim() || 'Perlu koreksi sebelum validasi.' : null, validatedBy: currentUser.id, validatedAt: nowIso() })
      resolveByDedupePrefix(notify.entrySubmissionPrefix(employee))
      emitNotifications(notify.buildEntryResult({ employee, validator: currentUser, status, revisionNote: note, ctx: accessCtx, now: nowIso() }))
    },
    validateEmployees: async (employeeIds) => {
      if (!currentUser || !hasPermission(currentUser, state.permissionConfig, 'validate_employee_entry_edit') || !hasPermission(currentUser, state.permissionConfig, 'bulk_validate')) return 0
      const requestedIds = new Set(employeeIds)
      const eligible = combinedEmployees.filter((employee) =>
        requestedIds.has(employee.id) &&
        employee.validationStatus === 'SUBMITTED' &&
        employee.conditionStatus !== 'NEEDS_REVIEW' &&
        hasCompleteSourceData(employee) &&
        canUseArea(employee.areaId) &&
        canValidateTransaction(currentUser, employee.validationTransaction ?? 'EMPLOYEE_ENTRY', state.validationPolicy))
      if (!eligible.length) return 0
      const ids = eligible.map((employee) => employee.id)
      const importedIds = ids.filter(isImported)
      const now = nowIso()
      if (importedIds.length) {
        await personnelRepository.patchEmployees(importedIds, {
          validationStatus: 'VALIDATED', revisionNote: null,
          validatedBy: currentUser.id, validatedAt: now,
        })
      }
      dispatch({ type: 'SET_EMPLOYEE_VALIDATION_BULK', employeeIds: ids, validatorId: currentUser.id })
      if (importedIds.length) await refreshPersonnel()
      return ids.length
    },
    setExitValidation: (exitId, status, note) => {
      const exit = state.employeeExits.find((item) => item.id === exitId)
      const employee = exit && findEmployee(exit.employeeId)
      if (!exit || !employee || !(currentUser && canUseArea(employee.areaId) && hasPermission(currentUser, state.permissionConfig, 'validate_employee_exit') && canValidateTransaction(currentUser, 'EMPLOYEE_EXIT', state.validationPolicy))) return
      dispatch({ type: 'SET_EXIT_VALIDATION', exitId, status, validatorId: currentUser.id, note, employee })
      if (status === 'VALIDATED') writeThroughImported(employee.id, { employmentStatus: 'INACTIVE' })
      resolveByDedupePrefix(notify.exitSubmissionPrefix(exit))
      emitNotifications(notify.buildExitResult({ exit: { ...exit, revisionNote: note ?? exit.revisionNote }, employee, validator: currentUser, status, ctx: accessCtx, now: nowIso() }))
      if (status === 'VALIDATED' && exit.replacementRequired && !state.replacementNeeds.some((need) => need.employeeExitId === exit.id)) {
        emitNotifications(notify.buildReplacementNeed({ need: { id: exit.id, areaId: employee.areaId } as never, employee, actor: currentUser, ctx: accessCtx, now: nowIso() }))
      }
    },
    matchCandidate: (needId, employeeId) => {
      const need = state.replacementNeeds.find((item) => item.id === needId)
      const candidate = findEmployee(employeeId)
      if (!need || !candidate || !(currentUser && canUseArea(need.areaId) && canUseArea(candidate.areaId) && hasPermission(currentUser, state.permissionConfig, 'match_replacement')) || !getCandidateEligibility(need, candidate, state.replacementNeeds).eligible) return
      dispatch({ type: 'MATCH_CANDIDATE', needId, employeeId, candidate })
      emitNotifications(notify.buildMatch({ need, candidate, actor: currentUser, ctx: accessCtx, now: nowIso() }))
    },
    fulfillNeed: (needId) => {
      const need = state.replacementNeeds.find((item) => item.id === needId)
      const candidate = findEmployee(need?.replacementEmployeeId)
      if (!need || !candidate || !(currentUser && canUseArea(need.areaId) && canUseArea(candidate.areaId) && hasPermission(currentUser, state.permissionConfig, 'fulfill_replacement')) || getFulfillmentBlockers(candidate, need, state.replacementNeeds).length || !candidate.joinDate) return
      dispatch({ type: 'FULFILL_NEED', needId, candidate })
      resolveByDedupePrefix(`sla:${need.id}`)
      const gap = calculateWorkingDayGap(need.exitDate, candidate.joinDate)
      emitNotifications(notify.buildFulfill({ need: { ...need, gapWorkingDays: gap }, candidate, actor: currentUser, overSla: getGapStatus(gap) === 'OVER_TARGET', ctx: accessCtx, now: nowIso() }))
    },
    togglePermission: (role, permission) => currentUser && hasPermission(currentUser, state.permissionConfig, 'manage_roles') && dispatch({ type: 'TOGGLE_PERMISSION', role, permission }),
    setRoleScope: (role, scope, selectedAreaIds) => currentUser && hasPermission(currentUser, state.permissionConfig, 'manage_roles') && dispatch({ type: 'SET_ROLE_SCOPE', role, scope, selectedAreaIds }),
    resetPermissions: () => currentUser && hasPermission(currentUser, state.permissionConfig, 'manage_roles') && dispatch({ type: 'RESET_PERMISSIONS' }),
    setValidationPolicy: (transaction, authority) => currentUser && hasPermission(currentUser, state.permissionConfig, 'manage_validation_policy') && dispatch({ type: 'SET_VALIDATION_POLICY', transaction, authority }),
    saveMovementRequest: (request) => {
      const employee = findEmployee(request.employeeId)
      if (!currentUser || !employee || !(canUseArea(request.previousAreaId) && canUseArea(request.newAreaId) && hasPermission(currentUser, state.permissionConfig, 'request_placement_change'))) return
      const before = state.movementRequests.find((item) => item.id === request.id)
      dispatch({ type: 'SAVE_MOVEMENT_REQUEST', request })
      if (request.validationStatus === 'SUBMITTED' && before?.validationStatus !== 'SUBMITTED') {
        emitNotifications(notify.buildMovementSubmission({ request, employee, actor: currentUser, ctx: accessCtx, now: nowIso() }))
      }
    },
    setMovementValidation: (requestId, status, note) => {
      const request = state.movementRequests.find((item) => item.id === requestId)
      const employee = request && findEmployee(request.employeeId)
      if (!request || !employee || !(currentUser && canUseArea(request.previousAreaId) && canUseArea(request.newAreaId) && hasPermission(currentUser, state.permissionConfig, 'validate_placement_change') && canValidateTransaction(currentUser, 'EMPLOYEE_PLACEMENT_CHANGE', state.validationPolicy))) return
      dispatch({ type: 'SET_MOVEMENT_VALIDATION', requestId, status, validatorId: currentUser.id, note })
      if (status === 'VALIDATED') writeThroughImported(employee.id, { areaId: request.newAreaId, projectId: request.newProjectId, position: request.newPosition })
      resolveByDedupePrefix(notify.movementSubmissionPrefix(request))
      emitNotifications(notify.buildMovementResult({ request: { ...request, revisionNote: note ?? request.revisionNote }, employee, validator: currentUser, status, ctx: accessCtx, now: nowIso() }))
    },
    addEmployeeNote: (employeeId, notes) => {
      const employee = findEmployee(employeeId)
      if (currentUser && employee && canUseArea(employee.areaId) && hasPermission(currentUser, state.permissionConfig, 'manage_employee_notes_flags')) dispatch({ type: 'ADD_EMPLOYEE_NOTE', employeeId, notes, userId: currentUser.id })
    },
    setEmployeeFlag: (employeeId, status, reason, notes) => {
      const employee = findEmployee(employeeId)
      if (currentUser && employee && canUseArea(employee.areaId) && hasPermission(currentUser, state.permissionConfig, 'manage_employee_notes_flags')) dispatch({ type: 'SET_EMPLOYEE_FLAG', employeeId, status, reason, notes, userId: currentUser.id })
    },
    reentryEmployee: (employeeId, areaId, projectId, position, joinDate, notes) => {
      const target = findEmployee(employeeId)
      if (!currentUser || !target || target.employmentStatus !== 'INACTIVE' || !(canUseArea(target.areaId) && canUseArea(areaId) && hasPermission(currentUser, state.permissionConfig, 'reentry_employee'))) return
      dispatch({ type: 'REENTRY_EMPLOYEE', employeeId, areaId, projectId, position, joinDate, notes, userId: currentUser.id, employee: target })
      writeThroughImported(employeeId, { employmentStatus: 'ACTIVE', areaId, projectId, position, joinDate })
      emitNotifications(notify.buildReentry({ employee: { ...target, areaId }, actor: currentUser, ctx: accessCtx, now: nowIso() }))
    },
    importEmployees: (employees) => currentUser && hasPermission(currentUser, state.permissionConfig, 'import_personnel') && dispatch({ type: 'IMPORT_EMPLOYEES', employees: employees.filter((employee) => canUseArea(employee.areaId)) }),
    resolveReviewItem: async (id, decision) => {
      const item = importReviewItems.find((r) => r.id === id)
      if (!currentUser || !item || !canReviewImportItem(currentUser, state.permissionConfig, item)) return 'Anda tidak memiliki akses untuk keputusan ini.'
      const now = new Date().toISOString()
      // Identity conflicts remain actionable but unresolved until policy exists.
      if (decision.keepPending || decision.decisionKind === 'IDENTITY_CONFLICT') {
        await personnelRepository.resolveReviewItem(id, 'KEPT_PENDING', null)
        await refreshPersonnel()
        return null
      }
      const records = item.recordIds.map((recordId) => importSourceRecords.find((record) => record.id === recordId)).filter(Boolean) as SourceImportRecord[]
      const validation = validateReviewDecision(item, decision, records)
      if (!validation.valid) return validation.errors.join(' ')
      // Dup / profile / correction resolve WITHOUT a timeline event; the rest confirm one.
      const confirmsEvent = ['PLACEMENT_CHANGE', 'EXIT', 'REENTRY'].includes(decision.decisionKind)
      const status = confirmsEvent ? 'CONFIRMED' as const : 'DISMISSED' as const
      const decisionVersion = (item.resolution?.decisionVersion ?? 0) + 1
      const resolution = {
        decisionKind: decision.decisionKind,
        movementType: decision.movementType,
        effectiveDate: decision.effectiveDate ?? null,
        exitScope: decision.exitScope,
        beforeRecordId: decision.beforeRecordId ?? null,
        afterRecordId: decision.afterRecordId ?? null,
        note: decision.note,
        reviewedBy: currentUser.id,
        reviewedAt: now,
        decisionVersion,
      } satisfies NonNullable<ReviewItem['resolution']>
      const master = importedPersonnel.find((personnel) => personnel.businessKey === item.businessKey)
      if (!master) return 'Current master tidak ditemukan; keputusan tidak disimpan.'
      const otherPending = importReviewItems.some((review) => review.id !== id && review.businessKey === item.businessKey && ['PENDING', 'KEPT_PENDING'].includes(review.status))
      const patch: Partial<Employee> = { conditionStatus: otherPending ? 'NEEDS_REVIEW' : 'CONFIRMED' }
      const after = decision.afterRecordId ? importSourceRecords.find((record) => record.id === decision.afterRecordId) : undefined
      if (after && ['PLACEMENT_CHANGE', 'REENTRY', 'PROFILE_VARIATION'].includes(decision.decisionKind)) {
        const fields = after.fields
        const areaId = findAreaId(fields.areaCbs, state.areas)
        const projectId = findProjectId(fields.projectName, areaId, state.projects)
        if (areaId) patch.areaId = areaId
        if (projectId) patch.projectId = projectId
        if (fields.name) patch.name = fields.name
        if (fields.subArea) patch.subArea = fields.subArea
        if (fields.position) patch.position = fields.position
        if (fields.joinDate) patch.joinDate = fields.joinDate
        if (fields.contractStartDate) patch.contractStartDate = fields.contractStartDate
        if (fields.contractEndDate) patch.contractEndDate = fields.contractEndDate
        const nextProfile = { ...(master.employee.profile ?? {}) } as Record<string, string | null>
        for (const [key, value] of Object.entries(fields)) if (value !== null && !['personnelId', 'name', 'subArea', 'position', 'joinDate', 'contractStartDate', 'contractEndDate'].includes(key)) nextProfile[key] = value
        patch.profile = nextProfile
      }
      if (decision.decisionKind === 'EXIT' && decision.exitScope === 'EMPLOYMENT_END') patch.employmentStatus = 'INACTIVE'
      if (decision.decisionKind === 'REENTRY') patch.employmentStatus = 'ACTIVE'
      await personnelRepository.resolveReviewAndPatch(id, item.businessKey, status, resolution, patch)
      await refreshPersonnel()
      return null
    },
    saveProject: (project) => currentUser && canUseArea(project.areaId) && hasPermission(currentUser, state.permissionConfig, 'manage_project') && dispatch({ type: 'SAVE_PROJECT', project }),
    setProjectStatus: (projectId, status) => {
      const project = state.projects.find((item) => item.id === projectId)
      if (currentUser && project && canUseArea(project.areaId) && hasPermission(currentUser, state.permissionConfig, 'toggle_project_status')) dispatch({ type: 'SET_PROJECT_STATUS', projectId, status })
    },
    saveProjectQuota: (quota) => {
      const project = state.projects.find((item) => item.id === quota.projectId)
      if (currentUser && project && canUseArea(project.areaId) && hasPermission(currentUser, state.permissionConfig, 'manage_project_quota')) dispatch({ type: 'SAVE_PROJECT_QUOTA', quota })
    },
  }
  const value: DemoContextValue = {
    ...local,
    // The local prototype applies actions synchronously; expose them with the async contract.
    saveEmployee: (...args) => { local.saveEmployee(...args); return done(args[0].id) },
    saveExit: (...args) => { local.saveExit(...args); return done(args[0].id) },
    setEmployeeValidation: (...args) => { local.setEmployeeValidation(...args); return done() },
    setExitValidation: (...args) => { local.setExitValidation(...args); return done() },
    matchCandidate: (...args) => { local.matchCandidate(...args); return done() },
    fulfillNeed: (...args) => { local.fulfillNeed(...args); return done() },
    togglePermission: (...args) => { local.togglePermission(...args); return done() },
    setRoleScope: (...args) => { local.setRoleScope(...args); return done() },
    resetPermissions: (...args) => { local.resetPermissions(...args); return done() },
    setValidationPolicy: (...args) => { local.setValidationPolicy(...args); return done() },
    saveMovementRequest: (...args) => { local.saveMovementRequest(...args); return done(args[0].id) },
    setMovementValidation: (...args) => { local.setMovementValidation(...args); return done() },
    addEmployeeNote: (...args) => { local.addEmployeeNote(...args); return done() },
    setEmployeeFlag: (...args) => { local.setEmployeeFlag(...args); return done() },
    reentryEmployee: (...args) => { local.reentryEmployee(...args); return done() },
    saveProject: (...args) => { local.saveProject(...args); return done(args[0].id) },
    setProjectStatus: (...args) => { local.setProjectStatus(...args); return done() },
    saveProjectQuota: (...args) => { local.saveProjectQuota(...args); return done() },
    dataSource: 'local',
    users: demoUsers,
    businessDate: isSampleMode ? DEMO_TODAY : new Date().toISOString().slice(0, 10),
    login: (email, password) => Promise.resolve(local.login(email, password)),
  }
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}

export const useDemo = () => {
  const context = useContext(DemoContext)
  if (!context) throw new Error('useDemo must be used inside DemoProvider')
  return context
}
