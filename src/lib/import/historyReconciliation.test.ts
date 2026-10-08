import { describe, expect, it } from 'vitest'
import { parseWorkbook } from './parse'
import { reconcile, emptyExisting } from './reconcile'
import { deriveImportMovements } from './derivedEvents'
import { buildSheet, testAreas, testProjects } from './testFixtures'
import { canReviewImportItem, getCandidateEligibility, isCountableActive } from '../businessRules'
import { cloneDefaultPermissions } from '../../config/access'
import type { DemoUser, Employee, ReplacementNeed } from '../../types'

const opts = (batchId = 'b1') => ({
  batchId, fileName: 'f.xlsx', sheetName: 'Database', createdBy: 'user-hr',
  now: '2026-10-08T00:00:00.000Z', areas: testAreas, projects: testProjects,
})
const person = (o: Record<string, unknown>) => ({ name: 'PERSONIL', ...o })
const runReconcile = (rows: Array<Record<string, unknown>>) =>
  reconcile(emptyExisting(), parseWorkbook([buildSheet('Database', rows)]), opts())

const employee = (o: Partial<Employee>): Employee => ({
  id: 'e1', personnelId: 'ID-1', name: 'X', areaId: 'area-makassar', subArea: null, projectId: 'project-nkp',
  position: 'SALES', employmentStatus: 'ACTIVE', joinDate: '2025-01-01', contractStartDate: '2025-01-01',
  contractEndDate: '2026-12-31', contractStatus: 'SIGNED', bpjsStatus: null, createdBy: 'user-hr',
  validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: 'now', submittedAt: 'now',
  revisionNote: null, createdAt: 'now', updatedAt: 'now', ...o,
})

describe('(16) ambiguous history never creates confirmed exits or replacement needs', () => {
  it('the driver case produces only pending review items, zero confirmed events', () => {
    const plan = runReconcile([
      person({ personnelId: 'ID-1', areaCbs: 'MAKASSAR', mutationDate: '2026-09-07' }),
      person({ personnelId: 'ID-1', areaCbs: 'BANDUNG', mutationDate: '2026-09-07', exitDate: '2026-09-07', exitReason: 'PINDAH KOTA/NEGARA' }),
    ])
    expect(plan.summary.confirmedEvents).toBe(0)
    expect(plan.reviewItemsToPut.every((r) => r.status === 'PENDING')).toBe(true)
    // Reconcile has no concept of replacement needs — nothing is auto-created.
    expect(Object.keys(plan)).not.toContain('replacementNeeds')
  })
})

describe('(17) pending-review personnel are not counted as active or eligible', () => {
  it('isCountableActive is false while condition needs review', () => {
    expect(isCountableActive(employee({ conditionStatus: 'NEEDS_REVIEW' }))).toBe(false)
    expect(isCountableActive(employee({ conditionStatus: 'CONFIRMED' }))).toBe(true)
    expect(isCountableActive(employee({ conditionStatus: undefined }))).toBe(true) // legacy defaults confirmed
  })

  it('a NEEDS_REVIEW candidate is ineligible for replacement matching', () => {
    const need: ReplacementNeed = {
      id: 'n1', employeeExitId: 'x', originalEmployeeId: 'orig', areaId: 'area-makassar', projectId: 'project-nkp',
      position: 'SALES', exitDate: '2026-01-01', replacementEmployeeId: null, replacementJoinDate: null,
      previousReplacementNeedId: null, status: 'OPEN', fulfilledAt: null, gapWorkingDays: null, createdAt: 'now', updatedAt: 'now',
    }
    const result = getCandidateEligibility(need, employee({ id: 'cand', conditionStatus: 'NEEDS_REVIEW' }), [])
    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('Kondisi terkini belum ditinjau')
  })
})

describe('(19) review actions respect role + area scope', () => {
  const config = cloneDefaultPermissions()
  const hrHo: DemoUser = { id: 'u1', name: 'HR', email: 'hr@x', password: 'x', role: 'HR_HO', areaId: null }
  const areaSupport: DemoUser = { id: 'u2', name: 'AS', email: 'as@x', password: 'x', role: 'AREA_SUPPORT', areaId: 'area-makassar' }

  it('HR HO (all areas) may review any item; Area Support may not review at all', () => {
    expect(canReviewImportItem(hrHo, config, { areaId: 'area-bandung' })).toBe(true)
    expect(canReviewImportItem(areaSupport, config, { areaId: 'area-makassar' })).toBe(false)
  })

  it('a scoped HR HO can only review items within its allowed areas', () => {
    const scoped = config.map((c) => c.role === 'HR_HO' ? { ...c, scope: 'SELECTED_AREAS' as const, selectedAreaIds: ['area-makassar'] } : c)
    expect(canReviewImportItem(hrHo, scoped, { areaId: 'area-makassar' })).toBe(true)
    expect(canReviewImportItem(hrHo, scoped, { areaId: 'area-bandung' })).toBe(false)
  })
})

describe('(20) a 3,000-row file is processed within budget', () => {
  it('parses + reconciles 3000 identities (plus a few multi-record groups) quickly', () => {
    const rows: Array<Record<string, unknown>> = []
    for (let i = 0; i < 3000; i++) rows.push(person({ personnelId: `ID-${i}`, areaCbs: 'MAKASSAR', position: 'SALES' }))
    // 50 of them also get a divergent second row to exercise classification.
    for (let i = 0; i < 50; i++) rows.push(person({ personnelId: `ID-${i}`, areaCbs: 'BANDUNG', mutationDate: '2026-03-01' }))
    const start = performance.now()
    const plan = reconcile(emptyExisting(), parseWorkbook([buildSheet('Database', rows)]), opts())
    const elapsed = performance.now() - start
    expect(plan.summary.uniqueIdentities).toBe(3000)
    expect(plan.summary.newMasters).toBe(3000)
    expect(elapsed).toBeLessThan(5000)
  })
})

describe('engine integration: confirm a reviewed movement → it appears on the timeline', () => {
  it('resolving a placement change yields exactly one derived career movement', () => {
    const plan = runReconcile([
      person({ personnelId: 'ID-9', areaCbs: 'MAKASSAR', position: 'SALES' }),
      person({ personnelId: 'ID-9', areaCbs: 'BANDUNG', position: 'SALES', mutationDate: '2026-05-01' }),
    ])
    // This clear case auto-confirms; emulate the stored CONFIRMED item + its master id.
    const confirmed = plan.reviewItemsToPut.filter((r) => r.status === 'CONFIRMED')
    expect(confirmed).toHaveLength(1)
    const master = plan.mastersToPut.find((m) => m.businessKey === 'ID-9')!
    const events = deriveImportMovements(confirmed, plan.sourceRecordsToPut, {
      employeeIdByKey: new Map([['ID-9', master.employee.id]]), areas: testAreas, projects: testProjects,
    })
    expect(events).toHaveLength(1)
    expect(events[0].movementType).toBe('AREA_CHANGE')
    expect(events[0].newAreaId).toBe('area-bandung')
  })
})
