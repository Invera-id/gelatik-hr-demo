import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { IndexedDbPersonnelRepository } from './repository'
import { parseWorkbook } from './parse'
import { planImport } from './plan'
import { buildSheet, testAreas, testProjects } from './testFixtures'
import type { ImportPlan } from './plan'

const makePlan = (personnelId: string, position: string, batchId: string, existing = []): ImportPlan => {
  const parsed = parseWorkbook([buildSheet('Database', [{ personnelId, name: `NAME ${personnelId}`, position }])])
  return planImport(existing, parsed, {
    batchId, fileName: 'f.xlsx', sheetName: 'Database', createdBy: 'user-hr',
    now: new Date().toISOString(), areas: testAreas, projects: testProjects,
  })
}

describe('IndexedDbPersonnelRepository', () => {
  beforeEach(async () => {
    await new IndexedDbPersonnelRepository().clearAll()
  })

  it('commits and reads back personnel, batches, and exceptions', async () => {
    const repo = new IndexedDbPersonnelRepository()
    const plan = makePlan('ID-1', 'SALES', 'b1')
    await repo.commit(plan)
    expect(await repo.getAllPersonnel()).toHaveLength(1)
    expect(await repo.getBatches()).toHaveLength(1)
  })

  it('persists data across a fresh repository instance (survives refresh)', async () => {
    await new IndexedDbPersonnelRepository().commit(makePlan('ID-REFRESH', 'ADMIN', 'b1'))
    // A brand-new instance simulates a page reload reconnecting to the same DB.
    const reopened = new IndexedDbPersonnelRepository()
    const personnel = await reopened.getAllPersonnel()
    expect(personnel.map((p) => p.businessKey)).toContain('ID-REFRESH')
  })

  it('aborts the whole transaction on a failed put (no partial commit)', async () => {
    const repo = new IndexedDbPersonnelRepository()
    await repo.commit(makePlan('ID-OK', 'SALES', 'b1'))
    const before = (await repo.getAllPersonnel()).length

    const badPlan = makePlan('ID-BAD', 'SALES', 'b2')
    // Inject a non-cloneable value so IndexedDB rejects the put and aborts the tx.
    ;(badPlan.toPut[0] as unknown as { poison: unknown }).poison = () => 1
    await expect(repo.commit(badPlan)).rejects.toBeTruthy()

    expect((await repo.getAllPersonnel()).length).toBe(before)
    expect((await repo.getBatches()).some((b) => b.id === 'b2')).toBe(false)
  })

  it('updates existing records without duplicating on re-import', async () => {
    const repo = new IndexedDbPersonnelRepository()
    await repo.commit(makePlan('ID-1', 'SALES', 'b1'))
    const existing = await repo.getAllPersonnel()
    await repo.commit(makePlan('ID-1', 'TEAM LEADER', 'b2', existing as never))
    const after = await repo.getAllPersonnel()
    expect(after).toHaveLength(1)
    expect(after[0].employee.position).toBe('TEAM LEADER')
  })
})
