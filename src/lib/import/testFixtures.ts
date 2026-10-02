import type { Area, Project } from '../../types'
import { COLUMN_TEMPLATE } from './columns'
import type { SheetTable } from './workbook'
import type { ImportBatch, ImportException, StoredPersonnel } from './types'
import type { PersonnelRepository } from './repository'
import type { ImportPlan } from './plan'

/** Test-only helpers for constructing synthetic workbooks and an in-memory repository. */

const FIELD_TO_INDEX = new Map(COLUMN_TEMPLATE.filter((c) => c.field).map((c) => [c.field as string, c.index]))

export const TEMPLATE_HEADER_ROW: string[] = COLUMN_TEMPLATE.map((c) => c.header)

/** Build one 83-wide data row, placing values at the right column for each field key. */
export const buildRow = (values: Record<string, unknown>): unknown[] => {
  const row: unknown[] = new Array(COLUMN_TEMPLATE.length).fill(null)
  for (const [field, value] of Object.entries(values)) {
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
  async commit(plan: ImportPlan): Promise<void> {
    if (this.failCommit) throw new Error('simulated transaction failure')
    // Mirror IndexedDB atomic semantics: apply all or nothing.
    for (const record of plan.toPut) this.personnel.set(record.businessKey, record)
    this.batches.push(plan.batch)
    this.exceptions.push(...plan.exceptions)
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
  async clearAll(): Promise<void> {
    this.personnel.clear()
    this.batches = []
    this.exceptions = []
    this.seeded = false
  }
}
