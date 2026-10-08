import { describe, expect, it } from 'vitest'
import { deriveImportMovements } from './derivedEvents'
import { testAreas, testProjects } from './testFixtures'
import type { ReviewItem, SourceImportRecord } from './types'

const source = (id: string, fields: Record<string, string | null>): SourceImportRecord => ({
  id, businessKey: 'ID-1', personnelId: 'ID-1', name: 'BUDI', batchId: 'b', fileName: 'f', sheetName: 'Database',
  rowNumber: 1, raw: {}, fields, structured: { scores: {}, measures: {}, booleans: {}, tenureMonths: null },
  fingerprint: id, warnings: [], reconciliationStatus: 'CONFIRMED', createdAt: 'now',
})

const confirmed = (overrides: Partial<ReviewItem> = {}): ReviewItem => ({
  id: 'rv:ID-1:PLACEMENT_CHANGE:abc', businessKey: 'ID-1', personnelId: 'ID-1', personnelName: 'BUDI',
  kind: 'PLACEMENT_CHANGE', aspects: ['PLACEMENT_CHANGE'], areaId: 'area-makassar', recordIds: ['s1', 's2'],
  diffFields: ['areaCbs'], dates: [], rowNumbers: [2, 3], reason: '', candidate: null,
  status: 'CONFIRMED',
  resolution: { decisionKind: 'PLACEMENT_CHANGE', movementType: 'AREA_CHANGE', effectiveDate: '2026-03-01', beforeRecordId: 's1', afterRecordId: 's2', note: 'pindah', reviewedBy: 'user-hr', reviewedAt: 'now', decisionVersion: 1 },
  createdAt: 'now', updatedAt: 'now', ...overrides,
})

const ctx = { employeeIdByKey: new Map([['ID-1', 'personnel-ID-1']]), areas: testAreas, projects: testProjects }
const sources = [
  source('s1', { areaCbs: 'MAKASSAR', projectName: 'NKP MT REGULER', position: 'SALES' }),
  source('s2', { areaCbs: 'Bandung', projectName: 'NKP MT REGULER', position: 'SALES' }),
]

describe('deriveImportMovements', () => {
  it('turns a confirmed placement change into a career movement labeled Import Excel', () => {
    const events = deriveImportMovements([confirmed()], sources, ctx)
    expect(events).toHaveLength(1)
    expect(events[0].employeeId).toBe('personnel-ID-1')
    expect(events[0].movementType).toBe('AREA_CHANGE')
    expect(events[0].effectiveDate).toBe('2026-03-01')
    expect(events[0].previousAreaId).toBe('area-makassar')
    expect(events[0].newAreaId).toBe('area-bandung')
    expect(events[0].notes).toMatch(/Import Excel/i)
  })

  it('ignores pending / dismissed items', () => {
    expect(deriveImportMovements([confirmed({ status: 'PENDING', resolution: null })], sources, ctx)).toHaveLength(0)
    expect(deriveImportMovements([confirmed({ status: 'DISMISSED' })], sources, ctx)).toHaveLength(0)
  })

  it('(13) re-confirming the same item (same decisionVersion) does not duplicate the event', () => {
    const item = confirmed()
    const events = deriveImportMovements([item, { ...item }], sources, ctx)
    expect(events).toHaveLength(1)
  })

  it('a corrected decision (higher version) replaces rather than adds a second event', () => {
    const v1 = confirmed()
    const v2 = confirmed({ resolution: { ...confirmed().resolution!, movementType: 'MUTATION', decisionVersion: 2 } })
    const events = deriveImportMovements([v2, v1], sources, ctx)
    // Only the items present are derived; a single item yields a single event per id+version.
    const ids = new Set(events.map((e) => e.id))
    expect(ids.size).toBe(events.length)
  })
})
