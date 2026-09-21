import { beforeEach, describe, expect, it } from 'vitest'
import { demoReducer, type DemoState } from '../context/DemoContext'
import { createInitialData } from '../data/demoData'
import { calculateWorkingDayGap, getCandidateEligibility, getFulfillmentBlockers } from './businessRules'
import type { EmployeeExit, ReplacementNeed } from '../types'

describe('employee movement history', () => {
  beforeEach(() => localStorage.clear())

  it('appends movement history instead of overwriting existing history', () => {
    const data = createInitialData()
    const before = data.employeeMovements.filter((item) => item.employeeId === 'employee-017')
    const next = demoReducer({ ...data, currentUserId: 'user-hr' }, { type: 'SET_MOVEMENT_VALIDATION', requestId: 'movement-request-001', status: 'VALIDATED', validatorId: 'user-hr' })
    expect(next.employeeMovements.filter((item) => item.employeeId === 'employee-017')).toHaveLength(before.length + 1)
  })

  it('updates current employee placement after movement validation', () => {
    const data = createInitialData()
    const next = demoReducer({ ...data, currentUserId: 'user-hr' }, { type: 'SET_MOVEMENT_VALIDATION', requestId: 'movement-request-001', status: 'VALIDATED', validatorId: 'user-hr' })
    expect(next.employees.find((item) => item.id === 'employee-017')).toMatchObject({ position: 'Team Leader', projectId: 'project-alpha-bandung' })
  })

  it('preserves previous project and position in the appended history', () => {
    const data = createInitialData()
    const next = demoReducer({ ...data, currentUserId: 'user-hr' }, { type: 'SET_MOVEMENT_VALIDATION', requestId: 'movement-request-001', status: 'VALIDATED', validatorId: 'user-hr' })
    const latest = next.employeeMovements.find((item) => item.employeeId === 'employee-017' && item.movementType === 'PROMOTION')
    expect(latest).toMatchObject({ previousProjectId: 'project-alpha-bandung', previousPosition: 'Promotor', newPosition: 'Team Leader' })
  })
})

describe('replacement lifecycle', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the old fulfillment immutable when the replacement chain continues', () => {
    const data = createInitialData()
    const old = data.replacementNeeds.find((item) => item.id === 'need-chain-001')!
    const next = data.replacementNeeds.find((item) => item.id === 'need-chain-002')!
    expect(old).toMatchObject({ replacementEmployeeId: 'employee-028', status: 'FULFILLED' })
    expect(next.previousReplacementNeedId).toBe(old.id)
  })

  it('creates a new linked need when a replacement employee exits', () => {
    const data = createInitialData()
    const oldNeed = data.replacementNeeds.find((item) => item.id === 'need-001')!
    const now = '2026-09-15T02:00:00.000Z'
    const exit: EmployeeExit = { id: 'exit-replacement-test', employeeId: oldNeed.replacementEmployeeId!, exitDate: '2026-09-15', exitReason: 'Test exit', replacementRequired: true, createdBy: 'user-hr', validationStatus: 'SUBMITTED', validatedBy: null, validatedAt: null, submittedAt: now, revisionNote: null, createdAt: now, updatedAt: now }
    const initial: DemoState = { ...data, employeeExits: [exit, ...data.employeeExits], currentUserId: 'user-hr' }
    const result = demoReducer(initial, { type: 'SET_EXIT_VALIDATION', exitId: exit.id, status: 'VALIDATED', validatorId: 'user-hr' })
    expect(result.replacementNeeds.find((item) => item.employeeExitId === exit.id)?.previousReplacementNeedId).toBe(oldNeed.id)
    expect(result.replacementNeeds.find((item) => item.id === oldNeed.id)).toEqual(oldNeed)
  })

  it('rejects a replacement join date before the previous exit date', () => {
    const data = createInitialData()
    const need = data.replacementNeeds.find((item) => item.id === 'need-001')!
    const candidate = { ...data.employees.find((item) => item.id === 'employee-002')!, joinDate: '2026-08-02' }
    expect(getFulfillmentBlockers(candidate, need, data.replacementNeeds)).toContain('Tanggal bergabung tidak boleh lebih awal dari tanggal exit employee sebelumnya')
  })

  it('calculates fulfillment from join date and ignores contract start date', () => {
    const data = createInitialData()
    const need = data.replacementNeeds.find((item) => item.id === 'need-001')!
    const candidate = { ...data.employees.find((item) => item.id === need.replacementEmployeeId)!, joinDate: '2026-08-05', contractStartDate: '2026-09-30' }
    const replacementNeeds = data.replacementNeeds.map((item): ReplacementNeed => item.id === need.id ? { ...item, status: 'MATCHED', gapWorkingDays: null, fulfilledAt: null } : item)
    const employees = data.employees.map((item) => item.id === candidate.id ? candidate : item)
    const result = demoReducer({ ...data, employees, replacementNeeds, currentUserId: 'user-hr' }, { type: 'FULFILL_NEED', needId: need.id })
    expect(result.replacementNeeds.find((item) => item.id === need.id)?.gapWorkingDays).toBe(calculateWorkingDayGap(need.exitDate, candidate.joinDate))
    expect(result.replacementNeeds.find((item) => item.id === need.id)?.gapWorkingDays).toBe(2)
  })

  it('blocks one candidate from simultaneous active replacement allocations', () => {
    const data = createInitialData()
    const need = data.replacementNeeds.find((item) => item.id === 'need-001')!
    const candidate = data.employees.find((item) => item.id === 'employee-002')!
    const competing: ReplacementNeed = { ...need, id: 'competing-need', replacementEmployeeId: candidate.id, status: 'MATCHED' }
    expect(getCandidateEligibility(need, candidate, [need, competing]).reasons).toContain('Karyawan sudah dialokasikan pada kebutuhan aktif lain')
  })

  it('resubmits a revised exit without creating a duplicate transaction', () => {
    const data = createInitialData()
    const revised = { ...data.employeeExits[0], validationStatus: 'SUBMITTED' as const, revisionNote: null, updatedAt: '2026-09-15T00:00:00.000Z' }
    const result = demoReducer({ ...data, currentUserId: 'user-bandung' }, { type: 'SAVE_EXIT', exit: revised })
    expect(result.employeeExits).toHaveLength(data.employeeExits.length)
    expect(result.employeeExits.filter((item) => item.id === revised.id)).toHaveLength(1)
  })
})
