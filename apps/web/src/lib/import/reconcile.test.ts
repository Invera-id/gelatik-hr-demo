import { describe, expect, it } from 'vitest'
import { parseWorkbook } from './parse'
import { reconcile, emptyExisting, type ReconcileInput } from './reconcile'
import { buildSheet, testAreas, testProjects } from './testFixtures'
import type { StoredPersonnel } from './types'

const options = (batchId = 'b1', now = '2026-10-08T00:00:00.000Z') => ({
  batchId, fileName: 'f.xlsx', sheetName: 'Database', createdBy: 'user-hr', now,
  areas: testAreas, projects: testProjects,
})

const run = (rows: Array<Record<string, unknown>>, existing: ReconcileInput = emptyExisting(), batchId = 'b1', now?: string) => {
  const parsed = parseWorkbook([buildSheet('Database', rows)])
  return reconcile(existing, parsed, options(batchId, now))
}

const asExisting = (plan: ReturnType<typeof reconcile>): ReconcileInput => ({
  masters: plan.mastersToPut,
  sourceRecords: plan.sourceRecordsToPut,
  reviewItems: plan.reviewItemsToPut,
})

const person = (o: Record<string, unknown> = {}) => ({ personnelId: 'ID-001', name: 'PERSONIL CONTOH', ...o })

describe('reconcile — new personnel', () => {
  it('a single clean row creates one CONFIRMED master and one source record', () => {
    const plan = run([person({ areaCbs: 'MAKASSAR', position: 'SALES' })])
    expect(plan.mastersToPut).toHaveLength(1)
    expect(plan.mastersToPut[0].employee.conditionStatus).toBe('CONFIRMED')
    expect(plan.sourceRecordsToPut).toHaveLength(1)
    expect(plan.reviewItemsToPut).toHaveLength(0)
    expect(plan.summary.newMasters).toBe(1)
  })

  it('driver case → NEEDS_REVIEW master + one pending review item, no exit/movement confirmed', () => {
    const plan = run([
      person({ areaCbs: 'MAKASSAR', subArea: 'SOLO', mutationDate: '2026-09-07' }),
      person({ areaCbs: 'BANDUNG', subArea: 'SOLO', mutationDate: '2026-09-07', exitDate: '2026-09-07', exitReason: 'PINDAH KOTA/NEGARA' }),
    ])
    expect(plan.mastersToPut).toHaveLength(1)
    expect(plan.mastersToPut[0].employee.conditionStatus).toBe('NEEDS_REVIEW')
    const pending = plan.reviewItemsToPut.filter((r) => r.status === 'PENDING')
    expect(pending).toHaveLength(1)
    expect(pending[0].aspects.sort()).toEqual(['EXIT', 'PLACEMENT_CHANGE'])
    expect(plan.sourceRecordsToPut).toHaveLength(2)
    expect(plan.summary.confirmedEvents).toBe(0)
  })

  it('routes even a clear placement change to manual review by default', () => {
    const plan = run([
      person({ areaCbs: 'MAKASSAR', position: 'SALES' }),
      person({ areaCbs: 'BANDUNG', position: 'SALES', mutationDate: '2026-03-01' }),
    ])
    const pending = plan.reviewItemsToPut.filter((r) => r.status === 'PENDING')
    expect(pending).toHaveLength(1)
    expect(pending[0].aspects).toContain('PLACEMENT_CHANGE')
    expect(plan.mastersToPut[0].employee.conditionStatus).toBe('NEEDS_REVIEW')
    expect(plan.summary.confirmedEvents).toBe(0)
  })

  it('two different complete NoKTP for one ID becomes an identity-conflict review item, not an exception', () => {
    const plan = run([
      person({ nationalId: '3374010101900001' }),
      person({ nationalId: '3374010101900002' }),
    ])
    expect(plan.exceptions).toHaveLength(0)
    expect(plan.reviewItemsToPut.some((r) => r.kind === 'IDENTITY_CONFLICT')).toBe(true)
    expect(plan.summary.identityConflicts).toBe(1)
  })
})

describe('reconcile — re-import idempotency & conservatism', () => {
  it('(12) re-importing the identical file adds no new source records and no new review items', () => {
    const first = run([person({ areaCbs: 'MAKASSAR', position: 'SALES' })], emptyExisting(), 'b1')
    const second = run([person({ areaCbs: 'MAKASSAR', position: 'SALES' })], asExisting(first), 'b2')
    expect(second.summary.newMasters).toBe(0)
    expect(second.summary.newSourceRecords).toBe(0)
    expect(second.reviewItemsToPut.filter((r) => r.status === 'PENDING')).toHaveLength(0)
  })

  it('(12) re-importing an ambiguous group does not duplicate its review item', () => {
    const rows = [
      person({ areaCbs: 'MAKASSAR', mutationDate: '2026-09-07' }),
      person({ areaCbs: 'BANDUNG', mutationDate: '2026-09-07', exitDate: '2026-09-07' }),
    ]
    const first = run(rows, emptyExisting(), 'b1')
    const second = run(rows, asExisting(first), 'b2')
    expect(second.reviewItemsToPut).toHaveLength(0)
    expect(second.summary.pendingReviewItems).toBe(1)
    expect(first.reviewItemsToPut.filter((r) => r.status === 'PENDING')).toHaveLength(1)
  })

  it('(14) an older historical record does not overwrite a newer confirmed condition', () => {
    // Existing confirmed master currently in SOLO.
    const confirmedMaster: StoredPersonnel = run([person({ areaCbs: 'MAKASSAR', position: 'SALES' })]).mastersToPut[0]
    const existing: ReconcileInput = { masters: [confirmedMaster], sourceRecords: [], reviewItems: [] }
    // A later file brings an older-looking record with a different area.
    const plan = run([person({ areaCbs: 'BANDUNG', position: 'SALES' })], existing, 'b2')
    const master = plan.mastersToPut.find((m) => m.businessKey === confirmedMaster.businessKey) ?? confirmedMaster
    expect(master.employee.areaId).toBe(confirmedMaster.employee.areaId) // unchanged
    expect(plan.reviewItemsToPut.some((r) => r.status === 'PENDING')).toBe(true)
  })

  it('(15) a person absent from a later file is left untouched (not deleted, not exited)', () => {
    const first = run([person({ personnelId: 'ID-1' }), person({ personnelId: 'ID-2' })], emptyExisting(), 'b1')
    const second = run([person({ personnelId: 'ID-1', position: 'CHANGED' })], asExisting(first), 'b2')
    // ID-2 is not in this run's plan, and nothing instructs its removal.
    expect(second.mastersToPut.some((m) => m.businessKey === 'ID-2')).toBe(false)
    expect(first.mastersToPut.some((m) => m.businessKey === 'ID-2')).toBe(true)
  })
})
