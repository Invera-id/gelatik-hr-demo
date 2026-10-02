import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { parseWorkbook } from './parse'
import { planImport } from './plan'
import type { SheetTable } from './workbook'
import { testAreas, testProjects } from './testFixtures'

/**
 * Verification against the real demo workbook (3000 rows x 83 cols). It lives in the
 * user's Downloads folder, so each case no-ops when the file is absent (e.g. CI).
 */
const REAL_FILE = '/Users/dzaky/Downloads/Demo_Personil_3000_Baris-2.xlsx'

type LooseReader = (file: string, opts?: Record<string, unknown>) => Promise<unknown>

/** Read the real file via the node build, or return null if it cannot be opened. */
const readReal = async (): Promise<SheetTable[] | null> => {
  try {
    const read = (await import('read-excel-file/node')).default as unknown as LooseReader
    const sheets = (await read(REAL_FILE, { getSheets: true })) as Array<{ sheet: string; data: unknown[][] }>
    return sheets.map((s) => ({ name: s.sheet, rows: s.data }))
  } catch {
    return null
  }
}

describe('real 3000-row workbook', () => {
  it('rejects the real file as-is because its sheet is not named Database', async () => {
    const sheets = await readReal()
    if (!sheets) return
    expect(() => parseWorkbook(sheets)).toThrow(/Sheet Database tidak ditemukan/)
  })

  it('parses and plans ~3000 records quickly once the sheet is named Database', async () => {
    const sheets = await readReal()
    if (!sheets) return
    const renamed = sheets.map((s) => ({ ...s, name: 'Database' }))
    const start = performance.now()
    const parsed = parseWorkbook(renamed)
    const plan = planImport([], parsed, {
      batchId: 'real', fileName: 'real.xlsx', sheetName: 'Database', createdBy: 'user-hr',
      now: new Date().toISOString(), areas: testAreas, projects: testProjects,
    })
    const elapsed = performance.now() - start
    expect(parsed.records.length).toBeGreaterThan(2900)
    expect(plan.summary.added).toBe(parsed.records.length)
    expect(elapsed).toBeLessThan(5000)

    // Every non-empty source row is accounted for.
    const tracked = plan.summary.added + plan.summary.updated + plan.summary.unchanged + plan.summary.duplicatesInFile + plan.summary.exceptionRows
    expect(tracked).toBe(parsed.nonEmptyRows)
  })

  it('preserves real-world formats across the dataset', async () => {
    const sheets = await readReal()
    if (!sheets) return
    const parsed = parseWorkbook(sheets.map((s) => ({ ...s, name: 'Database' })))
    const first = parsed.records[0]
    expect(first.fields.nationalId).toMatch(/^\d{16}$/)
    expect(first.fields.ktpRt).toMatch(/^\d{3}$/)
    expect(first.fields.birthDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Tanggal Setoran Awal is "-" in the source → stored as null (but read, not ignored).
    expect(first.fields.initialDepositDate).toBeNull()
    const statuses = new Set(parsed.records.map((r) => r.fields.employeeStatus))
    expect(statuses.has('R/P')).toBe(true)
  })
})
