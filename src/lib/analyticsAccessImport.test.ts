import { beforeEach, describe, expect, it } from 'vitest'
import { canValidateTransaction, hasPermission } from '../config/access'
import { demoReducer, type DemoState } from '../context/DemoContext'
import { areas, createInitialData, demoUsers, projects } from '../data/demoData'
import { getContractReminderCategory } from './contractRules'
import { selectDashboardData } from './dashboardRules'
import { getEmployeeFlagWarning } from './employeeRules'
import { importColumns, parseEmployeeImport } from './importRules'

describe('dashboard, contract, and employee warning rules', () => {
  const data = createInitialData()

  it('uses the same filtered record collection for the Over SLA KPI and drill-down', () => {
    const selection = selectDashboardData(data.employees, data.employeeExits, data.replacementNeeds, data.employeeMovements, { dateFrom: '2026-08-01', dateTo: '2026-09-30', areaId: '', projectId: '', position: '', status: '' })
    expect(selection.overSla.length).toBeGreaterThanOrEqual(2)
    expect(selection.overSla.length).toBe(selection.needs.filter((need) => need.status === 'OVER_TARGET').length)
  })

  it.each([['EMP-005', 'D-30'], ['EMP-004', 'D-14'], ['EMP-009', 'D-7'], ['EMP-019', 'EXPIRED']] as const)('categorizes contract reminder %s as %s', (personnelId, category) => {
    expect(getContractReminderCategory(data.employees.find((employee) => employee.personnelId === personnelId)!)).toBe(category)
  })

  it('warns on a flagged re-entry candidate without blocking the reducer action', () => {
    const warning = getEmployeeFlagWarning('employee-034', data.employeeFlags)
    const result = demoReducer({ ...data, currentUserId: 'user-hr' }, { type: 'REENTRY_EMPLOYEE', employeeId: 'employee-034', areaId: 'area-semarang', projectId: 'project-alpha-semarang', position: 'Sales', joinDate: '2026-09-14', notes: 'Test', userId: 'user-hr' })
    expect(warning.requiresReview).toBe(true)
    expect(result.employees.find((item) => item.id === 'employee-034')?.employmentStatus).toBe('ACTIVE')
  })
})

describe('configurable demo access and validation', () => {
  beforeEach(() => localStorage.clear())
  const data = createInitialData()

  it('keeps Operations Manager read-only', () => {
    const user = demoUsers.find((item) => item.role === 'OPERATIONS_MANAGER')!
    expect(hasPermission(user, data.permissionConfig, 'view_dashboard')).toBe(true)
    expect(hasPermission(user, data.permissionConfig, 'edit_employee')).toBe(false)
    expect(hasPermission(user, data.permissionConfig, 'fulfill_replacement')).toBe(false)
  })

  it('keeps Management read-only', () => {
    const user = demoUsers.find((item) => item.role === 'MANAGEMENT')!
    expect(hasPermission(user, data.permissionConfig, 'view_replacement')).toBe(true)
    expect(hasPermission(user, data.permissionConfig, 'create_exit')).toBe(false)
  })

  it('allows Super Admin to change the demo permission configuration', () => {
    const initial: DemoState = { ...data, currentUserId: 'user-superadmin' }
    const result = demoReducer(initial, { type: 'TOGGLE_PERMISSION', role: 'OPERATIONS_MANAGER', permission: 'edit_employee' })
    expect(result.permissionConfig.find((item) => item.role === 'OPERATIONS_MANAGER')?.permissions).toContain('edit_employee')
  })

  it('respects validation authority configuration', () => {
    const areaUser = demoUsers.find((item) => item.role === 'AREA_SUPPORT')!
    const hrUser = demoUsers.find((item) => item.role === 'HR_HO')!
    expect(canValidateTransaction(areaUser, 'EMPLOYEE_BASIC_EDIT', data.validationPolicy)).toBe(true)
    expect(canValidateTransaction(areaUser, 'EMPLOYEE_EXIT', data.validationPolicy)).toBe(false)
    expect(canValidateTransaction(hrUser, 'EMPLOYEE_EXIT', data.validationPolicy)).toBe(true)
  })
})

describe('controlled Excel import validation', () => {
  const data = createInitialData()
  const headers = [...importColumns]

  it('detects a duplicate Personnel ID and defaults the decision to Skip', () => {
    const preview = parseEmployeeImport([headers, ['EMP-026', 'Salsa Maharani', 'Bandung', 'Project Beta Bandung', 'Team Leader', '2024-02-01', 'ACTIVE', '2027-01-31', 'ACTIVE']], data.employees, areas, projects)
    expect(preview.rows[0]).toMatchObject({ status: 'WARNING', decision: 'SKIP', duplicateEmployeeId: 'employee-026' })
  })

  it('marks missing Project and unknown Area as errors', () => {
    const preview = parseEmployeeImport([headers, ['IMP-X', 'Demo Invalid', 'Surabaya', '', 'Sales', '2026-09-20', 'ACTIVE', '', 'IN_PROCESS']], data.employees, areas, projects)
    expect(preview.rows[0].status).toBe('ERROR')
    expect(preview.rows[0].messages).toEqual(expect.arrayContaining(['Area tidak dikenal: Surabaya.', 'Project wajib diisi.']))
  })
})
