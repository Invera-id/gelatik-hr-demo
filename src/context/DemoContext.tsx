/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react'
import { createInitialData, demoUsers } from '../data/demoData'
import { calculateWorkingDayGap, getCandidateEligibility, getFulfillmentBlockers, getGapStatus, hasCompleteSourceData } from '../lib/businessRules'
import type { DemoData, DemoUser, Employee, EmployeeExit, MovementEvent, ReplacementNeed, ValidationStatus } from '../types'

const DATA_KEY = 'gelatik-demo-data-v1'
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
  | { type: 'SET_EMPLOYEE_VALIDATION'; employeeId: string; status: Extract<ValidationStatus, 'VALIDATED' | 'REVISION_REQUIRED'>; validatorId: string }
  | { type: 'SET_EXIT_VALIDATION'; exitId: string; status: Extract<ValidationStatus, 'VALIDATED' | 'REVISION_REQUIRED'>; validatorId: string }
  | { type: 'MATCH_CANDIDATE'; needId: string; employeeId: string }
  | { type: 'FULFILL_NEED'; needId: string }

const loadData = (): DemoData => {
  try {
    const stored = localStorage.getItem(DATA_KEY)
    return stored ? JSON.parse(stored) as DemoData : createInitialData()
  } catch {
    return createInitialData()
  }
}

const createMovement = (employeeId: string, type: MovementEvent['type'], title: string, description: string): MovementEvent => ({
  id: `move-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  employeeId, type, title, description, date: new Date().toISOString(),
})

const persist = (state: DemoState): DemoState => {
  const data: DemoData = { employees: state.employees, employeeExits: state.employeeExits, replacementNeeds: state.replacementNeeds, movements: state.movements }
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
      const employees = state.employees.map((item) => item.id === action.employeeId ? { ...item, validationStatus: action.status, validatedBy: action.validatorId, validatedAt: now, updatedAt: now } : item)
      const movement = createMovement(employee.id, 'VALIDATION', action.status === 'VALIDATED' ? 'Employee entry divalidasi' : 'Revisi employee entry diminta', `Status validasi: ${action.status}`)
      return persist({ ...state, employees, movements: [movement, ...state.movements] })
    }
    case 'SET_EXIT_VALIDATION': {
      const target = state.employeeExits.find((item) => item.id === action.exitId)
      if (!target) return state
      const employee = state.employees.find((item) => item.id === target.employeeId)
      if (!employee) return state
      const now = new Date().toISOString()
      const employeeExits = state.employeeExits.map((item) => item.id === action.exitId ? { ...item, validationStatus: action.status, validatedBy: action.validatorId, validatedAt: now, updatedAt: now } : item)
      const employees = action.status === 'VALIDATED' ? state.employees.map((item) => item.id === employee.id ? { ...item, employmentStatus: 'INACTIVE' as const, updatedAt: now } : item) : state.employees
      let replacementNeeds = state.replacementNeeds
      if (action.status === 'VALIDATED' && target.replacementRequired && !state.replacementNeeds.some((need) => need.employeeExitId === target.id)) {
        const need: ReplacementNeed = {
          id: `need-${Date.now()}`, employeeExitId: target.id, originalEmployeeId: employee.id,
          areaId: employee.areaId, projectId: employee.projectId, position: employee.position, exitDate: target.exitDate,
          replacementEmployeeId: null, status: 'OPEN', fulfilledAt: null, gapWorkingDays: null, createdAt: now, updatedAt: now,
        }
        replacementNeeds = [need, ...replacementNeeds]
      }
      const description = action.status === 'VALIDATED' && target.replacementRequired
        ? hasCompleteSourceData(employee) ? 'Exit tervalidasi dan replacement need dibuat' : 'Exit tervalidasi; replacement need dibuat dengan peringatan data sumber'
        : `Status validasi: ${action.status}`
      const movement = createMovement(employee.id, 'VALIDATION', action.status === 'VALIDATED' ? 'Employee exit divalidasi' : 'Revisi employee exit diminta', description)
      return persist({ ...state, employees, employeeExits, replacementNeeds, movements: [movement, ...state.movements] })
    }
    case 'MATCH_CANDIDATE': {
      const need = state.replacementNeeds.find((item) => item.id === action.needId)
      const employee = state.employees.find((item) => item.id === action.employeeId)
      if (!need || !employee || !getCandidateEligibility(need, employee).eligible) return state
      const now = new Date().toISOString()
      const replacementNeeds = state.replacementNeeds.map((item) => item.id === need.id ? { ...item, replacementEmployeeId: employee.id, status: 'MATCHED' as const, updatedAt: now } : item)
      const movement = createMovement(employee.id, 'MATCHING', 'Kandidat dipasangkan', `Dipasangkan ke kebutuhan ${need.id.toUpperCase()}`)
      return persist({ ...state, replacementNeeds, movements: [movement, ...state.movements] })
    }
    case 'FULFILL_NEED': {
      const need = state.replacementNeeds.find((item) => item.id === action.needId)
      const employee = state.employees.find((item) => item.id === need?.replacementEmployeeId)
      if (!need || !employee || getFulfillmentBlockers(employee).length || !employee.joinDate) return state
      const gap = calculateWorkingDayGap(need.exitDate, employee.joinDate)
      const now = new Date().toISOString()
      const status = getGapStatus(gap)
      const replacementNeeds = state.replacementNeeds.map((item) => item.id === need.id ? { ...item, gapWorkingDays: gap, fulfilledAt: now, status, updatedAt: now } : item)
      const movement = createMovement(employee.id, 'FULFILLMENT', status === 'FULFILLED' ? 'Replacement terpenuhi' : 'Replacement melewati SLA', `Gap fulfillment ${gap} hari kerja`)
      return persist({ ...state, replacementNeeds, movements: [movement, ...state.movements] })
    }
  }
}

interface DemoContextValue extends DemoData {
  currentUser: DemoUser | null
  login: (email: string, password: string) => boolean
  logout: () => void
  resetDemo: () => void
  saveEmployee: (employee: Employee) => void
  saveExit: (exit: EmployeeExit) => void
  setEmployeeValidation: (id: string, status: 'VALIDATED' | 'REVISION_REQUIRED') => void
  setExitValidation: (id: string, status: 'VALIDATED' | 'REVISION_REQUIRED') => void
  matchCandidate: (needId: string, employeeId: string) => void
  fulfillNeed: (needId: string) => void
}

const DemoContext = createContext<DemoContextValue | null>(null)

export function DemoProvider({ children }: { children: ReactNode }) {
  const initialData = useMemo(() => loadData(), [])
  const [state, dispatch] = useReducer(demoReducer, {
    ...initialData,
    currentUserId: sessionStorage.getItem(USER_KEY),
  })
  const currentUser = demoUsers.find((user) => user.id === state.currentUserId) ?? null

  const value: DemoContextValue = {
    employees: state.employees, employeeExits: state.employeeExits, replacementNeeds: state.replacementNeeds, movements: state.movements, currentUser,
    login: (email, password) => {
      const user = demoUsers.find((item) => item.email.toLowerCase() === email.toLowerCase().trim() && item.password === password)
      if (!user) return false
      dispatch({ type: 'LOGIN', userId: user.id })
      return true
    },
    logout: () => dispatch({ type: 'LOGOUT' }),
    resetDemo: () => dispatch({ type: 'RESET' }),
    saveEmployee: (employee) => dispatch({ type: 'SAVE_EMPLOYEE', employee }),
    saveExit: (exit) => dispatch({ type: 'SAVE_EXIT', exit }),
    setEmployeeValidation: (employeeId, status) => currentUser && dispatch({ type: 'SET_EMPLOYEE_VALIDATION', employeeId, status, validatorId: currentUser.id }),
    setExitValidation: (exitId, status) => currentUser && dispatch({ type: 'SET_EXIT_VALIDATION', exitId, status, validatorId: currentUser.id }),
    matchCandidate: (needId, employeeId) => dispatch({ type: 'MATCH_CANDIDATE', needId, employeeId }),
    fulfillNeed: (needId) => dispatch({ type: 'FULFILL_NEED', needId }),
  }
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}

export const useDemo = () => {
  const context = useContext(DemoContext)
  if (!context) throw new Error('useDemo must be used inside DemoProvider')
  return context
}
