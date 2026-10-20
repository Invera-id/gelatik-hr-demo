import type { Area, Project } from '../../types'
import { COLUMN_TEMPLATE } from './columns'
import type { SheetTable } from './workbook'
import type { ImportBatch, ImportException, ReviewItem, ReviewResolution, ReviewStatus, SourceImportRecord, StoredPersonnel } from './types'
import type { PersonnelRepository } from './repository'
import type { ImportPlan } from './reconcile'

/** Test-only helpers for constructing synthetic workbooks and an in-memory repository. */

const FIELD_TO_INDEX = new Map(COLUMN_TEMPLATE.filter((c) => c.field).map((c) => [c.field as string, c.index]))

export const TEMPLATE_HEADER_ROW: string[] = COLUMN_TEMPLATE.map((c) => c.header)

/** Build one 83-wide data row, placing values at the right column for each field key. */
export const buildRow = (values: Record<string, unknown>): unknown[] => {
  const row: unknown[] = new Array(COLUMN_TEMPLATE.length).fill(null)
  const withSyntheticCriticalDefaults = Object.keys(values).length ? {
    areaCbs: 'MAKASSAR', projectName: 'NKP MT REGULER', position: 'SALES', joinDate: '2025-01-02',
    ...values,
  } : values
  for (const [field, value] of Object.entries(withSyntheticCriticalDefaults)) {
    const index = FIELD_TO_INDEX.get(field)
    if (index === undefined) throw new Error(`Unknown fixture field: ${field}`)
    row[index] = value
  }
  return row
}

/** Build a sheet table with the canonical header plus the given data rows. */
export const buildSheet = (name: string, rows: Array<Record<string, unknown>>): SheetTable => ({
  name,
  rows: [TEMPLATE_HEADER_ROW, ...rows.map(buildRow)],
})

export const testAreas: Area[] = [
  { id: 'area-makassar', name: 'MAKASSAR' },
  { id: 'area-bandung', name: 'Bandung' },
]

export const testProjects: Project[] = [
  { id: 'project-nkp', name: 'NKP MT REGULER', clientName: 'PT. NUSA KARYA PANGAN', areaId: 'area-makassar', subArea: null, status: 'ACTIVE', startDate: null, endDate: null },
]

/** A minimal in-memory repository used to test planning + commit semantics without IndexedDB. */
export class InMemoryPersonnelRepository implements PersonnelRepository {
  personnel = new Map<string, StoredPersonnel>()
  sources = new Map<string, SourceImportRecord>()
  reviews = new Map<string, ReviewItem>()
  batches: ImportBatch[] = []
  exceptions: ImportException[] = []
  seeded = false
  /** When set, commit throws to simulate a failed transaction. */
  failCommit = false

  async getAllPersonnel(): Promise<StoredPersonnel[]> {
    return [...this.personnel.values()]
  }
  async getBatches(): Promise<ImportBatch[]> {
    return [...this.batches]
  }
  async getExceptions(batchId?: string): Promise<ImportException[]> {
    return this.exceptions.filter((e) => !batchId || e.batchId === batchId)
  }
  async getSourceRecords(businessKey?: string): Promise<SourceImportRecord[]> {
    return [...this.sources.values()].filter((s) => !businessKey || s.businessKey === businessKey)
  }
  async getReviewItems(status?: ReviewStatus): Promise<ReviewItem[]> {
    return [...this.reviews.values()].filter((r) => !status || r.status === status)
  }
  async commit(plan: ImportPlan): Promise<void> {
    if (this.failCommit) throw new Error('simulated transaction failure')
    // Mirror IndexedDB atomic semantics: apply all or nothing.
    for (const record of plan.mastersToPut) this.personnel.set(record.businessKey, record)
    for (const source of plan.sourceRecordsToPut) this.sources.set(source.id, source)
    for (const item of plan.reviewItemsToPut) this.reviews.set(item.id, item)
    this.batches.push(plan.batch)
    this.exceptions.push(...plan.exceptions)
  }
  async resolveReviewItem(id: string, status: ReviewStatus, resolution: ReviewResolution | null): Promise<ReviewItem | null> {
    const current = this.reviews.get(id)
    if (!current) return null
    const updated: ReviewItem = { ...current, status, resolution, updatedAt: new Date().toISOString() }
    this.reviews.set(id, updated)
    return updated
  }
  async resolveReviewAndPatch(id: string, businessKey: string, status: ReviewStatus, resolution: ReviewResolution, patch: Partial<StoredPersonnel['employee']>): Promise<ReviewItem | null> {
    const current = this.reviews.get(id)
    const master = this.personnel.get(businessKey)
    if (!current || !master) return null
    const updated = { ...current, status, resolution, updatedAt: new Date().toISOString() }
    this.reviews.set(id, updated)
    this.personnel.set(businessKey, { ...master, employee: { ...master.employee, ...patch } })
    return updated
  }
  async isSeeded(): Promise<boolean> {
    return this.seeded
  }
  async markSeeded(): Promise<void> {
    this.seeded = true
  }
  async seedPersonnel(records: StoredPersonnel[]): Promise<void> {
    for (const record of records) this.personnel.set(record.businessKey, record)
    this.seeded = true
  }
  async patchEmployee(employeeId: string, patch: Partial<StoredPersonnel['employee']>): Promise<boolean> {
    for (const [key, record] of this.personnel) {
      if (record.employee.id === employeeId) {
        this.personnel.set(key, { ...record, employee: { ...record.employee, ...patch } })
        return true
      }
    }
    return false
  }
  async patchEmployees(employeeIds: string[], patch: Partial<StoredPersonnel['employee']>): Promise<number> {
    const wanted = new Set(employeeIds)
    let updated = 0
    for (const [key, record] of this.personnel) {
      if (!wanted.has(record.employee.id)) continue
      this.personnel.set(key, { ...record, employee: { ...record.employee, ...patch } })
      updated++
    }
    return updated
  }
  async clearAll(): Promise<void> {
    this.personnel.clear()
    this.sources.clear()
    this.reviews.clear()
    this.batches = []
    this.exceptions = []
    this.seeded = false
  }
}
