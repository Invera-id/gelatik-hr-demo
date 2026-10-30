import { describe, expect, it } from 'vitest'
import { createInitialData } from '../data/demoData'
import type { Employee, EmployeeExit, EmployeeMovement } from '../types'
import { evaluateEmploymentSnapshot, snapshotDateAt } from './employmentSnapshot'

const data = createInitialData()
const employee: Employee = { ...data.employees[0], id: 'synthetic', joinDate: '2026-01-01', employmentStatus: 'ACTIVE', validationStatus: 'VALIDATED', conditionStatus: 'CONFIRMED' }
const exit = (date: string, validated = true): EmployeeExit => ({ ...data.employeeExits[0], id: `exit-${date}`, employeeId: employee.id, exitDate: date, validationStatus: validated ? 'VALIDATED' : 'SUBMITTED' })
const movement = (type: 'JOIN' | 'REENTRY', date: string): EmployeeMovement => ({
  id: `synthetic-${type}-${date}`, employeeId: employee.id, movementType: type, effectiveDate: date,
  previousAreaId: null, newAreaId: null, previousProjectId: null, newProjectId: null,
  previousPosition: null, newPosition: null, notes: '', createdBy: 'synthetic', createdAt: '2026-01-01T00:00:00Z',
})
const snapshot = '2026-10-30'

describe('employment episodes at snapshot', () => {
  it('uses Jakarta date at a UTC day boundary', () => {
    expect(snapshotDateAt(new Date('2026-10-29T17:30:00Z'))).toBe(snapshot)
  })

  it('counts join on snapshot but excludes a future join', () => {
    expect(evaluateEmploymentSnapshot([{ ...employee, joinDate: snapshot }], [], [], snapshot).status).toBe('ACTIVE')
    expect(evaluateEmploymentSnapshot([{ ...employee, joinDate: '2026-10-31' }], [], [], snapshot).status).toBe('INACTIVE')
  })

  it.each(['ACTIVE', 'INACTIVE'] as const)('ignores a future validated exit even when current status is %s', (employmentStatus) => {
    expect(evaluateEmploymentSnapshot([{ ...employee, employmentStatus }], [exit('2026-11-01')], [], snapshot).status).toBe('ACTIVE')
  })

  it('closes an episode on exit day and ignores unvalidated exits', () => {
    expect(evaluateEmploymentSnapshot([employee], [exit(snapshot)], [], snapshot).status).toBe('INACTIVE')
    expect(evaluateEmploymentSnapshot([employee], [exit('2026-09-01', false)], [], snapshot).status).toBe('ACTIVE')
  })

  it('evaluates multiple complete episodes and deduplicates repeated history', () => {
    const history = [movement('JOIN', '2024-01-01'), movement('REENTRY', '2025-01-01'), movement('REENTRY', '2026-01-01')]
    const exits = [exit('2024-06-01'), exit('2025-06-01'), exit('2026-11-01')]
    expect(evaluateEmploymentSnapshot([{ ...employee, employmentStatus: 'INACTIVE' }], exits, [...history, history[2]], snapshot).status).toBe('ACTIVE')
    expect(evaluateEmploymentSnapshot([employee], [...exits, exit('2026-09-01')], history, snapshot).status).toBe('INACTIVE')
  })

  it('evaluates an earlier episode before a future reentry, without treating future join as already effective', () => {
    const record = { ...employee, joinDate: '2026-11-01' }
    const history = [movement('JOIN', '2026-01-01'), movement('REENTRY', '2026-11-01')]
    expect(evaluateEmploymentSnapshot([record], [exit('2026-10-31')], history, snapshot).status).toBe('ACTIVE')
    expect(evaluateEmploymentSnapshot([record], [exit('2026-10-20')], history, snapshot).status).toBe('INACTIVE')
  })

  it('does not infer missing dates or contradictory episodes', () => {
    expect(evaluateEmploymentSnapshot([{ ...employee, joinDate: null }], [], [], snapshot).status).toBe('NEEDS_REVIEW')
    expect(evaluateEmploymentSnapshot([employee], [], [movement('JOIN', '2025-01-01')], snapshot).status).toBe('NEEDS_REVIEW')
    expect(evaluateEmploymentSnapshot([{ ...employee, employmentStatus: 'INACTIVE' }], [], [], snapshot).status).toBe('NEEDS_REVIEW')
  })

  it('requires review for invalid dates, even when strings look ISO-shaped', () => {
    expect(evaluateEmploymentSnapshot([{ ...employee, joinDate: '2026-02-30' }], [], [], snapshot).status).toBe('NEEDS_REVIEW')
    expect(evaluateEmploymentSnapshot([employee], [exit('2026-13-01')], [], snapshot).status).toBe('NEEDS_REVIEW')
    expect(() => evaluateEmploymentSnapshot([employee], [], [], 'invalid')).toThrow()
  })

  it('does not use a legacy createdAt fallback as proof of a join', () => {
    const legacy = { ...movement('JOIN', '2026-01-01'), id: 'career-import-synthetic' }
    expect(evaluateEmploymentSnapshot([{ ...employee, joinDate: null }], [], [legacy], snapshot).status).toBe('NEEDS_REVIEW')
  })

  it('requires review for same-day exit and reentry when ordering is unknown', () => {
    expect(evaluateEmploymentSnapshot([employee], [exit(employee.joinDate!)], [movement('REENTRY', employee.joinDate!)], snapshot).status).toBe('NEEDS_REVIEW')
  })
})
