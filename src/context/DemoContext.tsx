/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { areas, createInitialData, demoUsers } from '../data/demoData'
import { allowedAreaIds, canValidateTransaction, cloneDefaultPermissions, defaultValidationPolicy, hasPermission } from '../config/access'
import { calculateWorkingDayGap, getCandidateEligibility, getFulfillmentBlockers, getGapStatus, hasCompleteSourceData } from '../lib/businessRules'
import type { DemoData, DemoUser, Employee, EmployeeExit, EmployeeFlagStatus, EmployeeMovement, MovementEvent, Permission, PlacementChangeRequest, Project, ProjectQuota, ReplacementNeed, Role, ScopeType, TransactionType, ValidationStatus, ValidatorAuthority } from '../types'
import { personnelRepository } from '../lib/import/repository'
import { runImport, type ImportPhase, type ImportRunResult } from '../lib/import/service'
import type { ImportBatch, ImportException, StoredPersonnel } from '../lib/import/types'
import { clearAll as clearNotifications, emit as emitNotifications, resolveByDedupePrefix } from '../lib/notifications/service'
import * as notify from '../lib/notifications/events'
import type { AccessContext } from '../lib/notifications/rules'

const DATA_KEY = 'gelatik-demo-data-v2'
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
  | { type: 'SAVE_PROJECT'; project: Project }
  | { type: 'SET_PROJECT_STATUS'; projectId: string; status: Project['status'] }
  | { type: 'SAVE_PROJECT_QUOTA'; quota: ProjectQuota }

const loadData = (): DemoData => {
  try {
    const stored = localStorage.getItem(DATA_KEY)
    if (!stored) return createInitialData()
    const parsed = JSON.parse(stored) as Partial<DemoData>
    const fresh = createInitialData()
    const employees = (parsed.employees ?? fresh.employees).map((employee) => {
      const seeded = fresh.employees.find((item) => item.id === employee.id && item.personnelId === employee.personnelId)
      return employee.profile || !seeded ? employee : { ...employee, profile: { ...seeded.profile, areaCbs: areas.find((area) => area.id === employee.areaId)?.name ?? null } }
    })
    return { ...fresh, ...parsed, employees, permissionConfig: parsed.permissionConfig ?? cloneDefaultPermissions(), validationPolicy: parsed.validationPolicy ?? { ...defaultValidationPolicy } }
  } catch {
    return createInitialData()
  }
}

const createMovement = (employeeId: string, type: MovementEvent['type'], title: string, description: string): MovementEvent => ({
  id: `move-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  employeeId, type, title, description, date: new Date().toISOString(),
})

const persist = (state: DemoState): DemoState => {
  const data: DemoData = { projects: state.projects, projectQuotas: state.projectQuotas, employees: state.employees, employeeExits: state.employeeExits, replacementNeeds: state.replacementNeeds, movements: state.movements, employeeMovements: state.employeeMovements, movementRequests: state.movementRequests, employeeNotes: state.employeeNotes, employeeFlags: state.employeeFlags, permissionConfig: state.permissionConfig, validationPolicy: state.validationPolicy }
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
      const fresh = createInitialData()
      localStorage.removeItem(DATA_KEY)
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
      const employees = state.employees.map((employee) => employee.id === request.employeeId ? { ...employee, areaId: request.newAreaId, projectId: request.newProjectId, position: request.newPosition, profile: { ...employee.profile, areaCbs: areas.find((area) => area.id === request.newAreaId)?.name ?? null }, updatedAt: now } : employee)
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
      const employees = state.employees.map((item) => item.id === target.id ? { ...item, areaId: action.areaId, projectId: action.projectId, position: action.position, joinDate: action.joinDate, profile: { ...item.profile, areaCbs: areas.find((area) => area.id === action.areaId)?.name ?? null }, employmentStatus: 'ACTIVE' as const, validationStatus: 'VALIDATED' as const, validatedBy: action.userId, validatedAt: now, updatedAt: now } : item)
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

export interface DemoContextValue extends DemoData {
  currentUser: DemoUser | null
  login: (email: string, password: string) => boolean
  logout: () => void
  resetDemo: () => void
  saveEmployee: (employee: Employee) => void
  saveExit: (exit: EmployeeExit) => void
  setEmployeeValidation: (id: string, status: 'VALIDATED' | 'REVISION_REQUIRED', note?: string) => void
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
  importStorageReady: boolean
  importStorageError: string | null
  canImportPersonnel: boolean
  importPersonnelFile: (file: File, onProgress?: (phase: ImportPhase) => void) => Promise<ImportRunResult>
  refreshPersonnel: () => Promise<void>
  saveProject: (project: Project) => void
  setProjectStatus: (projectId: string, status: Project['status']) => void
  saveProjectQuota: (quota: ProjectQuota) => void
}

const DemoContext = createContext<DemoContextValue | null>(null)

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
  const [importStorageReady, setImportStorageReady] = useState(false)
  const [importStorageError, setImportStorageError] = useState<string | null>(null)

  const refreshPersonnel = useCallback(async () => {
    try {
      const [personnel, batches, exceptions] = await Promise.all([
        personnelRepository.getAllPersonnel(),
        personnelRepository.getBatches(),
        personnelRepository.getExceptions(),
      ])
      setImportedPersonnel(personnel)
      setImportBatches(batches)
      setImportExceptions(exceptions)
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

  const canImportPersonnel = Boolean(currentUser && ['HR_HO', 'SUPER_ADMIN'].includes(currentUser.role) && hasPermission(currentUser, state.permissionConfig, 'create_employee'))

  const importPersonnelFile = useCallback(async (file: File, onProgress?: (phase: ImportPhase) => void): Promise<ImportRunResult> => {
    if (!currentUser || !['HR_HO', 'SUPER_ADMIN'].includes(currentUser.role) || !hasPermission(currentUser, state.permissionConfig, 'create_employee')) {
      return { ok: false, batch: null, summary: null, status: null, exceptions: [], duplicates: [], error: 'Anda tidak memiliki izin untuk mengimpor personil.' }
    }
    const result = await runImport({ file, repository: personnelRepository, areas, projects: state.projects, createdBy: currentUser.id, onProgress })
    // One summary notification per operation (not per row); failures notify the actor too.
    if (result.ok && result.batch) {
      emitNotifications(notify.buildImportSummary({ batch: result.batch, actor: currentUser, now: new Date().toISOString() }))
      await refreshPersonnel()
    } else if (!result.ok) {
      emitNotifications(notify.buildImportFailure({ fileName: file.name, error: result.error ?? 'Impor gagal.', actor: currentUser, now: new Date().toISOString(), opId: `${file.name}-${Date.now()}` }))
    }
    return result
  }, [currentUser, state.permissionConfig, state.projects, refreshPersonnel])

  // Combined, de-duplicated by internal id (demo-edited seed overrides the stored copy).
  const combinedEmployees = useMemo(() => {
    const map = new Map<string, Employee>()
    for (const personnel of importedPersonnel) map.set(personnel.employee.id, personnel.employee)
    for (const employee of state.employees) map.set(employee.id, employee)
    return [...map.values()]
  }, [importedPersonnel, state.employees])

  // Access context + helpers for business actions. Employee lookups use the combined
  // source so actions (exit, movement, validation, notifications) also work for
  // IndexedDB-backed imported personnel, not only the localStorage seed.
  const accessCtx: AccessContext = { users: demoUsers, permissionConfig: state.permissionConfig, validationPolicy: state.validationPolicy }
  const nowIso = () => new Date().toISOString()
  const areaNameOf = (areaId: string | null) => areas.find((area) => area.id === areaId)?.name ?? 'tidak diketahui'
  const findEmployee = (id: string | null | undefined) => combinedEmployees.find((item) => item.id === id)
  const isImported = (id: string) => importedPersonnel.some((personnel) => personnel.employee.id === id)
  // Persist a status/placement change back to IndexedDB for imported personnel.
  const writeThroughImported = (id: string, patch: Partial<Employee>) => {
    if (isImported(id)) void personnelRepository.patchEmployee(id, patch).then(() => { void refreshPersonnel() })
  }

  const value: DemoContextValue = {
    projects: state.projects, projectQuotas: state.projectQuotas, employees: combinedEmployees, employeeExits: state.employeeExits, replacementNeeds: state.replacementNeeds, movements: state.movements, employeeMovements: state.employeeMovements, movementRequests: state.movementRequests, employeeNotes: state.employeeNotes, employeeFlags: state.employeeFlags, permissionConfig: state.permissionConfig, validationPolicy: state.validationPolicy, currentUser,
    importedPersonnel, importBatches, importExceptions, importStorageReady, importStorageError, canImportPersonnel, importPersonnelFile, refreshPersonnel,
    login: (email, password) => {
      const user = demoUsers.find((item) => item.email.toLowerCase() === email.toLowerCase().trim() && item.password === password)
      if (!user) return false
      dispatch({ type: 'LOGIN', userId: user.id })
      return true
    },
    logout: () => dispatch({ type: 'LOGOUT' }),
    resetDemo: () => { dispatch({ type: 'RESET' }); clearNotifications(); void personnelRepository.clearAll().then(refreshPersonnel) },
    saveEmployee: (employee) => {
      if (!currentUser) return
      const before = state.employees.find((item) => item.id === employee.id)
      if (!(canUseArea(employee.areaId) && hasPermission(currentUser, state.permissionConfig, before ? 'edit_employee' : 'create_employee'))) return
      dispatch({ type: 'SAVE_EMPLOYEE', employee })
      if (employee.validationStatus === 'SUBMITTED' && before?.validationStatus !== 'SUBMITTED') {
        emitNotifications(notify.buildEntrySubmission({ employee, actor: currentUser, areaName: areaNameOf(employee.areaId), ctx: accessCtx, now: nowIso() }))
      }
    },
    saveExit: (exit) => {
      const employee = findEmployee(exit.employeeId)
      if (!currentUser || !employee || !(canUseArea(employee.areaId) && hasPermission(currentUser, state.permissionConfig, 'create_exit'))) return
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
      if (!(currentUser && hasPermission(currentUser, state.permissionConfig, 'validate_employee') && canValidateTransaction(currentUser, transaction, state.validationPolicy))) return
      dispatch({ type: 'SET_EMPLOYEE_VALIDATION', employeeId, status, validatorId: currentUser.id, note })
      resolveByDedupePrefix(notify.entrySubmissionPrefix(employee))
      emitNotifications(notify.buildEntryResult({ employee, validator: currentUser, status, revisionNote: note, ctx: accessCtx, now: nowIso() }))
    },
    setExitValidation: (exitId, status, note) => {
      const exit = state.employeeExits.find((item) => item.id === exitId)
      const employee = exit && findEmployee(exit.employeeId)
      if (!exit || !employee || !(currentUser && hasPermission(currentUser, state.permissionConfig, 'validate_exit') && canValidateTransaction(currentUser, 'EMPLOYEE_EXIT', state.validationPolicy))) return
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
      if (!need || !candidate || !(currentUser && hasPermission(currentUser, state.permissionConfig, 'match_replacement')) || !getCandidateEligibility(need, candidate, state.replacementNeeds).eligible) return
      dispatch({ type: 'MATCH_CANDIDATE', needId, employeeId, candidate })
      emitNotifications(notify.buildMatch({ need, candidate, actor: currentUser, ctx: accessCtx, now: nowIso() }))
    },
    fulfillNeed: (needId) => {
      const need = state.replacementNeeds.find((item) => item.id === needId)
      const candidate = findEmployee(need?.replacementEmployeeId)
      if (!need || !candidate || !(currentUser && hasPermission(currentUser, state.permissionConfig, 'fulfill_replacement')) || getFulfillmentBlockers(candidate, need, state.replacementNeeds).length || !candidate.joinDate) return
      dispatch({ type: 'FULFILL_NEED', needId, candidate })
      resolveByDedupePrefix(`sla:${need.id}`)
      const gap = calculateWorkingDayGap(need.exitDate, candidate.joinDate)
      emitNotifications(notify.buildFulfill({ need: { ...need, gapWorkingDays: gap }, candidate, actor: currentUser, overSla: getGapStatus(gap) === 'OVER_TARGET', ctx: accessCtx, now: nowIso() }))
    },
    togglePermission: (role, permission) => dispatch({ type: 'TOGGLE_PERMISSION', role, permission }),
    setRoleScope: (role, scope, selectedAreaIds) => dispatch({ type: 'SET_ROLE_SCOPE', role, scope, selectedAreaIds }),
    resetPermissions: () => dispatch({ type: 'RESET_PERMISSIONS' }),
    setValidationPolicy: (transaction, authority) => dispatch({ type: 'SET_VALIDATION_POLICY', transaction, authority }),
    saveMovementRequest: (request) => {
      const employee = findEmployee(request.employeeId)
      if (!currentUser || !employee || !(canUseArea(request.previousAreaId) && canUseArea(request.newAreaId) && hasPermission(currentUser, state.permissionConfig, 'edit_employee'))) return
      const before = state.movementRequests.find((item) => item.id === request.id)
      dispatch({ type: 'SAVE_MOVEMENT_REQUEST', request })
      if (request.validationStatus === 'SUBMITTED' && before?.validationStatus !== 'SUBMITTED') {
        emitNotifications(notify.buildMovementSubmission({ request, employee, actor: currentUser, ctx: accessCtx, now: nowIso() }))
      }
    },
    setMovementValidation: (requestId, status, note) => {
      const request = state.movementRequests.find((item) => item.id === requestId)
      const employee = request && findEmployee(request.employeeId)
      if (!request || !employee || !(currentUser && hasPermission(currentUser, state.permissionConfig, 'validate_employee') && canValidateTransaction(currentUser, 'EMPLOYEE_PLACEMENT_CHANGE', state.validationPolicy))) return
      dispatch({ type: 'SET_MOVEMENT_VALIDATION', requestId, status, validatorId: currentUser.id, note })
      if (status === 'VALIDATED') writeThroughImported(employee.id, { areaId: request.newAreaId, projectId: request.newProjectId, position: request.newPosition })
      resolveByDedupePrefix(notify.movementSubmissionPrefix(request))
      emitNotifications(notify.buildMovementResult({ request: { ...request, revisionNote: note ?? request.revisionNote }, employee, validator: currentUser, status, ctx: accessCtx, now: nowIso() }))
    },
    addEmployeeNote: (employeeId, notes) => currentUser && hasPermission(currentUser, state.permissionConfig, 'edit_employee') && dispatch({ type: 'ADD_EMPLOYEE_NOTE', employeeId, notes, userId: currentUser.id }),
    setEmployeeFlag: (employeeId, status, reason, notes) => currentUser && hasPermission(currentUser, state.permissionConfig, 'edit_employee') && dispatch({ type: 'SET_EMPLOYEE_FLAG', employeeId, status, reason, notes, userId: currentUser.id }),
    reentryEmployee: (employeeId, areaId, projectId, position, joinDate, notes) => {
      const target = findEmployee(employeeId)
      if (!currentUser || !target || target.employmentStatus !== 'INACTIVE' || !(canUseArea(areaId) && hasPermission(currentUser, state.permissionConfig, 'create_employee'))) return
      dispatch({ type: 'REENTRY_EMPLOYEE', employeeId, areaId, projectId, position, joinDate, notes, userId: currentUser.id, employee: target })
      writeThroughImported(employeeId, { employmentStatus: 'ACTIVE', areaId, projectId, position, joinDate })
      emitNotifications(notify.buildReentry({ employee: { ...target, areaId }, actor: currentUser, ctx: accessCtx, now: nowIso() }))
    },
    importEmployees: (employees) => currentUser && ['HR_HO', 'SUPER_ADMIN'].includes(currentUser.role) && hasPermission(currentUser, state.permissionConfig, 'create_employee') && dispatch({ type: 'IMPORT_EMPLOYEES', employees }),
    saveProject: (project) => currentUser && ['HR_HO', 'SUPER_ADMIN'].includes(currentUser.role) && dispatch({ type: 'SAVE_PROJECT', project }),
    setProjectStatus: (projectId, status) => currentUser && ['HR_HO', 'SUPER_ADMIN'].includes(currentUser.role) && dispatch({ type: 'SET_PROJECT_STATUS', projectId, status }),
    saveProjectQuota: (quota) => currentUser && ['HR_HO', 'SUPER_ADMIN'].includes(currentUser.role) && dispatch({ type: 'SAVE_PROJECT_QUOTA', quota }),
  }
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}

export const useDemo = () => {
  const context = useContext(DemoContext)
  if (!context) throw new Error('useDemo must be used inside DemoProvider')
  return context
}
