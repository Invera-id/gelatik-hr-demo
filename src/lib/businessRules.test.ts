import { beforeEach, describe, expect, it } from 'vitest'
import { demoReducer, type DemoState } from '../context/DemoContext'
import { createInitialData, demoUsers } from '../data/demoData'
import { hasPermission } from '../config/access'
import {
  calculateWorkingDayGap,
  canAccessEmployee,
  filterEmployeesForUser,
  getCandidateEligibility,
  getFulfillmentBlockers,
  getGapStatus,
} from './businessRules'

describe('role and area access', () => {
  const data = createInitialData()
  const areaUser = demoUsers.find((user) => user.role === 'AREA_SUPPORT')!
  const hrUser = demoUsers.find((user) => user.role === 'HR_HO')!
  const management = demoUsers.find((user) => user.role === 'MANAGEMENT')!

  it('prevents an Area user from accessing an employee in another area', () => {
    const semarangEmployee = data.employees.find((employee) => employee.areaId === 'area-semarang')!
    expect(canAccessEmployee(areaUser, semarangEmployee)).toBe(false)
  })

  it('allows HR to view employees from all areas', () => {
    expect(filterEmployeesForUser(hrUser, data.employees)).toHaveLength(data.employees.length)
  })

  it('prevents Management from editing employees', () => {
    expect(hasPermission(management, data.permissionConfig, 'edit_employee_basic')).toBe(false)
  })
})

describe('exit validation', () => {
  beforeEach(() => localStorage.clear())

  it('creates a Replacement Need only when a replacement-required exit is validated', () => {
    const data = createInitialData()
    const pendingExit = data.employeeExits.find((exit) => exit.id === 'exit-003')!
    const initial: DemoState = { ...data, currentUserId: 'user-hr' }
    expect(initial.replacementNeeds.some((need) => need.employeeExitId === pendingExit.id)).toBe(false)
    const next = demoReducer(initial, { type: 'SET_EXIT_VALIDATION', exitId: pendingExit.id, status: 'VALIDATED', validatorId: 'user-hr' })
    expect(next.replacementNeeds.some((need) => need.employeeExitId === pendingExit.id)).toBe(true)
  })
})

describe('candidate matching rules', () => {
  const data = createInitialData()
  const need = data.replacementNeeds.find((item) => item.id === 'need-001')!
  const correct = data.employees.find((employee) => employee.id === 'employee-002')!

  it('rejects a candidate from the wrong area', () => {
    const candidate = data.employees.find((employee) => employee.id === 'employee-003')!
    expect(getCandidateEligibility(need, candidate)).toMatchObject({ eligible: false, reasons: expect.arrayContaining(['Area tidak sesuai']) })
  })

  it('rejects a candidate from the wrong project', () => {
    const candidate = { ...correct, id: 'candidate-project', projectId: 'project-beta-bandung' }
    expect(getCandidateEligibility(need, candidate).reasons).toContain('Project tidak sesuai')
  })

  it('rejects a candidate in the wrong position', () => {
    const candidate = { ...correct, id: 'candidate-position', position: 'Team Leader' }
    expect(getCandidateEligibility(need, candidate).reasons).toContain('Posisi tidak sesuai')
  })

  it('accepts a candidate with the exact area, project, and position', () => {
    expect(getCandidateEligibility(need, correct)).toEqual({ eligible: true, reasons: [] })
  })

  it('rejects fulfillment when the candidate contract is unsigned', () => {
    expect(getFulfillmentBlockers({ ...correct, contractStatus: 'DRAFT' })).toContain('Kontrak belum ditandatangani')
  })

  it('prevents matching when critical source data is missing', () => {
    const incompleteNeed = { ...need, projectId: null }
    expect(getCandidateEligibility(incompleteNeed, correct).eligible).toBe(false)
  })
})

describe('working-day SLA', () => {
  it('excludes Saturday and Sunday from the gap', () => {
    expect(calculateWorkingDayGap('2026-08-07', '2026-08-17')).toBe(6)
  })

  it('marks a gap of 3 working days or less as FULFILLED', () => {
    expect(getGapStatus(3)).toBe('FULFILLED')
  })

  it('marks a gap over 3 working days as OVER_TARGET', () => {
    expect(getGapStatus(4)).toBe('OVER_TARGET')
  })
})

