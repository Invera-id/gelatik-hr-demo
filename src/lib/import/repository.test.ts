import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { IndexedDbPersonnelRepository } from './repository'
import { parseWorkbook } from './parse'
import { reconcile, emptyExisting, type ReconcileInput } from './reconcile'
import { buildSheet, testAreas, testProjects } from './testFixtures'
import type { ImportPlan } from './reconcile'

const makePlan = (rows: Array<Record<string, unknown>>, batchId: string, existing: ReconcileInput = emptyExisting()): ImportPlan => {
  const parsed = parseWorkbook([buildSheet('Database', rows)])
  return reconcile(existing, parsed, {
    batchId, fileName: 'f.xlsx', sheetName: 'Database', createdBy: 'user-hr',
    now: new Date().toISOString(), areas: testAreas, projects: testProjects,
  })
}

const person = (o: Record<string, unknown>) => ({ name: 'NAME', ...o })

describe('IndexedDbPersonnelRepository', () => {
  beforeEach(async () => {
    await new IndexedDbPersonnelRepository().clearAll()
  })

  it('commits and reads back personnel and batches', async () => {
    const repo = new IndexedDbPersonnelRepository()
    await repo.commit(makePlan([person({ personnelId: 'ID-1', position: 'SALES' })], 'b1'))
    expect(await repo.getAllPersonnel()).toHaveLength(1)
    expect(await repo.getBatches()).toHaveLength(1)
  })

  it('(18) persists source records and review decisions across a fresh instance (survives refresh)', async () => {
    const repo = new IndexedDbPersonnelRepository()
    // An ambiguous group → one pending review item + two source records.
    await repo.commit(makePlan([
      person({ personnelId: 'ID-R', areaCbs: 'MAKASSAR', mutationDate: '2026-09-07' }),
      person({ personnelId: 'ID-R', areaCbs: 'BANDUNG', mutationDate: '2026-09-07', exitDate: '2026-09-07' }),
    ], 'b1'))
    const pending = await repo.getReviewItems('PENDING')
    expect(pending).toHaveLength(1)
    // Resolve it, then reopen a new instance (simulated refresh).
    await repo.resolveReviewItem(pending[0].id, 'DISMISSED', null)

    const reopened = new IndexedDbPersonnelRepository()
    expect((await reopened.getSourceRecords('ID-R'))).toHaveLength(2)
    expect((await reopened.getReviewItems('PENDING'))).toHaveLength(0)
    expect((await reopened.getReviewItems('DISMISSED'))).toHaveLength(1)
  })

  it('aborts the whole transaction on a failed put (no partial commit)', async () => {
    const repo = new IndexedDbPersonnelRepository()
    await repo.commit(makePlan([person({ personnelId: 'ID-OK', position: 'SALES' })], 'b1'))
    const before = (await repo.getAllPersonnel()).length

    const badPlan = makePlan([person({ personnelId: 'ID-BAD', position: 'SALES' })], 'b2')
    // Inject a non-cloneable value so IndexedDB rejects the put and aborts the tx.
    ;(badPlan.mastersToPut[0] as unknown as { poison: unknown }).poison = () => 1
    await expect(repo.commit(badPlan)).rejects.toBeTruthy()

    expect((await repo.getAllPersonnel()).length).toBe(before)
    expect((await repo.getBatches()).some((b) => b.id === 'b2')).toBe(false)
  })

  it('does not duplicate a master on re-import', async () => {
    const repo = new IndexedDbPersonnelRepository()
    await repo.commit(makePlan([person({ personnelId: 'ID-1', position: 'SALES' })], 'b1'))
    const existing: ReconcileInput = {
      masters: await repo.getAllPersonnel(),
      sourceRecords: await repo.getSourceRecords(),
      reviewItems: await repo.getReviewItems(),
    }
    await repo.commit(makePlan([person({ personnelId: 'ID-1', position: 'SALES' })], 'b2', existing))
    expect(await repo.getAllPersonnel()).toHaveLength(1)
  })

  it('validates several imported employees in one bulk update', async () => {
    const repo = new IndexedDbPersonnelRepository()
    await repo.commit(makePlan([
      person({ personnelId: 'BULK-1' }),
      person({ personnelId: 'BULK-2' }),
      person({ personnelId: 'BULK-3' }),
    ], 'bulk'))
    const before = await repo.getAllPersonnel()
    const count = await repo.patchEmployees(before.slice(0, 2).map((item) => item.employee.id), {
      validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: '2026-10-20T00:00:00.000Z',
    })
    expect(count).toBe(2)
    const after = await repo.getAllPersonnel()
    expect(after.filter((item) => item.employee.validationStatus === 'VALIDATED')).toHaveLength(2)
    expect(after.filter((item) => item.employee.validationStatus !== 'VALIDATED')).toHaveLength(1)
  })
})
