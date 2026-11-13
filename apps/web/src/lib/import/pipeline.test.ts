import { describe, expect, it } from 'vitest'
import { parseWorkbook } from './parse'
import { commitPreparedImport, prepareImport, runImport } from './service'
import { selectDatabaseSheet } from './workbook'
import { ImportAbortError } from './types'
import {
  InMemoryPersonnelRepository,
  buildSheet,
  testAreas,
  testProjects,
} from './testFixtures'
import type { SheetTable } from './workbook'

const personRow = (overrides: Record<string, unknown> = {}) => ({
  personnelId: 'ID-001',
  name: 'TIARA DWI AMALIA',
  nationalId: '7371115310010944',
  joinDate: new Date('2022-06-04T00:00:00.000Z'),
  position: 'PROMOTOR',
  ...overrides,
})

describe('sheet selection (Database only)', () => {
  it('reads Database and ignores Database aktif even when it is first', () => {
    const sheets: SheetTable[] = [
      buildSheet('Database aktif', [personRow({ personnelId: 'ACTIVE-1', name: 'SHOULD NOT IMPORT' })]),
      buildSheet('Database', [personRow({ personnelId: 'ID-001', name: 'FROM DATABASE' })]),
      buildSheet('Sheet3', [personRow({ personnelId: 'OTHER-1', name: 'OTHER' })]),
    ]
    const parsed = parseWorkbook(sheets)
    expect(parsed.sheetName).toBe('Database')
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0].name).toBe('FROM DATABASE')
  })

  it('matches sheet name after trim + case normalization', () => {
    const sheets = [buildSheet('  dataBASE  ', [personRow()])]
    expect(selectDatabaseSheet(sheets).rows.length).toBeGreaterThan(0)
  })

  it('does NOT match similar names like "Database aktif" or "Data base"', () => {
    const sheets = [
      buildSheet('Database aktif', [personRow()]),
      buildSheet('Data base', [personRow()]),
    ]
    expect(() => selectDatabaseSheet(sheets)).toThrow(ImportAbortError)
  })

  it('throws (no DB change) when there is no Database sheet', () => {
    expect(() => parseWorkbook([buildSheet('Data Demo', [personRow()])])).toThrow(/Sheet Database tidak ditemukan/)
  })

  it('stops on ambiguous duplicate Database sheets', () => {
    const sheets = [buildSheet('Database', [personRow()]), buildSheet('database', [personRow()])]
    expect(() => selectDatabaseSheet(sheets)).toThrow(/ambigu/)
  })
})

describe('column mapping', () => {
  it('maps reordered headers by name instead of applying positional drift', () => {
    const sheet = buildSheet('Database', [personRow()])
    const header = [...sheet.rows[0]]
    const data = [...sheet.rows[1]]
    ;[header[1], header[2]] = [header[2], header[1]]
    ;[data[1], data[2]] = [data[2], data[1]]
    const parsed = parseWorkbook([{ ...sheet, rows: [header, data] }])
    expect(parsed.records[0].personnelId).toBe('ID-001')
    expect(parsed.records[0].fields.areaCbs).toBe('MAKASSAR')
    expect(parsed.records[0].warnings.some((warning) => warning.column === 'Struktur header')).toBe(false)
  })

  it('ignores inserted unknown columns and still maps known headers', () => {
    const sheet = buildSheet('Database', [personRow()])
    const header = [...sheet.rows[0]]
    const data = [...sheet.rows[1]]
    header.splice(3, 0, 'Kolom Tambahan')
    data.splice(3, 0, 'DIABAIKAN')
    const parsed = parseWorkbook([{ ...sheet, rows: [header, data] }])
    expect(parsed.records[0].personnelId).toBe('ID-001')
    expect(parsed.records[0].name).toBe('TIARA DWI AMALIA')
  })
  it('keeps KTP and domicile addresses separate', () => {
    const sheets = [buildSheet('Database', [personRow({
      ktpAddress: 'JL KTP 1', ktpRt: '001', ktpCity: 'MAKASSAR',
      domicileAddress: 'JL DOMISILI 2', domicileRt: '009', domicileCity: 'BANDUNG',
    })])]
    const [record] = parseWorkbook(sheets).records
    expect(record.fields.ktpAddress).toBe('JL KTP 1')
    expect(record.fields.domicileAddress).toBe('JL DOMISILI 2')
    expect(record.fields.ktpRt).toBe('001')
    expect(record.fields.domicileRt).toBe('009')
    expect(record.fields.ktpCity).toBe('MAKASSAR')
    expect(record.fields.domicileCity).toBe('BANDUNG')
  })

  it('does not fail a row because group-marker columns are empty', () => {
    const parsed = parseWorkbook([buildSheet('Database', [personRow()])])
    expect(parsed.records).toHaveLength(1)
    expect(parsed.exceptions).toHaveLength(0)
  })

  it('keeps identifiers as strings with leading zeros', () => {
    const [record] = parseWorkbook([buildSheet('Database', [personRow({
      nationalId: '0012345678901234', bankAccountNumber: '002', mobilePhone: '082210000944',
    })])]).records
    expect(record.fields.nationalId).toBe('0012345678901234')
    expect(record.fields.bankAccountNumber).toBe('002')
    expect(record.fields.mobilePhone).toBe('082210000944')
  })

  it('reads both Excel date objects and text dates', () => {
    const [record] = parseWorkbook([buildSheet('Database', [personRow({
      joinDate: new Date('2022-06-04T00:00:00.000Z'),
      contractEndDate: '21-Oct-26',
      birthDate: '13/10/2001',
    })])]).records
    expect(record.fields.joinDate).toBe('2022-06-04')
    expect(record.fields.contractEndDate).toBe('2026-10-21')
    expect(record.fields.birthDate).toBe('2001-10-13')
  })

  it('emits a warning (not a crash) for an invalid date', () => {
    const [record] = parseWorkbook([buildSheet('Database', [personRow({ birthDate: '31-Feb-26' })])]).records
    expect(record.fields.birthDate).toBeNull()
    expect(record.warnings.some((w) => /tidak valid/i.test(w.reason))).toBe(true)
  })

  it('actually reads and stores Tanggal Setoran Awal', () => {
    const [record] = parseWorkbook([buildSheet('Database', [personRow({ initialDepositDate: '2026-01-15' })])]).records
    expect(record.fields.initialDepositDate).toBe('2026-01-15')
    const dash = parseWorkbook([buildSheet('Database', [personRow({ initialDepositDate: '-' })])]).records[0]
    expect(dash.fields.initialDepositDate).toBeNull()
  })

  it('preserves academic score scale (65 vs 65/100)', () => {
    const [a] = parseWorkbook([buildSheet('Database', [personRow({ academicScore: 65 })])]).records
    expect(a.structured.scores.academicScore).toEqual({ raw: '65', score: 65, maxScore: null, percentage: null })
    const [b] = parseWorkbook([buildSheet('Database', [personRow({ academicScore: '65/100' })])]).records
    expect(b.structured.scores.academicScore).toEqual({ raw: '65/100', score: 65, maxScore: 100, percentage: 65 })
  })

  it('keeps basic-ability small numbers unscaled (7, 2, 0)', () => {
    for (const value of [7, 2, 0]) {
      const [record] = parseWorkbook([buildSheet('Database', [personRow({ basicAbilityScore: value })])]).records
      expect(record.structured.scores.basicAbilityScore.score).toBe(value)
      expect(record.structured.scores.basicAbilityScore.maxScore).toBeNull()
    }
  })

  it('normalizes height/weight with and without units', () => {
    const [record] = parseWorkbook([buildSheet('Database', [personRow({ height: '1,60 m', weight: 50 })])]).records
    expect(record.structured.measures.height.value).toBe(160)
    expect(record.structured.measures.weight.value).toBe(50)
  })

  it('keeps outlet Status N/A as a business code (not null)', () => {
    const [record] = parseWorkbook([buildSheet('Database', [personRow({ employeeStatus: 'n/a' })])]).records
    expect(record.fields.employeeStatus).toBe('N/A')
  })
})

describe('validation & exceptions', () => {
  it('routes rows missing identity to exceptions, keeps the rest', () => {
    const parsed = parseWorkbook([buildSheet('Database', [
      personRow({ personnelId: 'ID-OK', name: 'VALID' }),
      personRow({ personnelId: '', name: 'NO ID' }),
      personRow({ personnelId: 'ID-NONAME', name: '' }),
    ])])
    expect(parsed.records).toHaveLength(1)
    expect(parsed.exceptions).toHaveLength(2)
    expect(parsed.exceptions[0].rowNumber).toBeGreaterThan(1)
  })

  it('skips truly blank rows without stopping, keeps data after them', () => {
    const sheet = buildSheet('Database', [
      personRow({ personnelId: 'ID-1' }),
      {}, // all-empty row
      personRow({ personnelId: 'ID-2' }),
    ])
    const parsed = parseWorkbook([sheet])
    expect(parsed.records.map((r) => r.personnelId)).toEqual(['ID-1', 'ID-2'])
    expect(parsed.blankRowsSkipped).toBe(1)
  })

  it('keeps distinct same-ID rows as separate source records (no last-wins merge)', () => {
    const parsed = parseWorkbook([buildSheet('Database', [
      personRow({ personnelId: 'ID-DUP', position: 'SALES', outlet: 'A' }),
      personRow({ personnelId: 'ID-DUP', position: 'TEAM LEADER', outlet: '' }),
    ])])
    // Both rows are preserved as history; nothing is merged or dropped.
    expect(parsed.records).toHaveLength(2)
    expect(parsed.groups.get('ID-DUP')).toHaveLength(2)
    expect(parsed.records.map((r) => r.fields.position).sort()).toEqual(['SALES', 'TEAM LEADER'])
    expect(parsed.exceptions).toHaveLength(0)
  })

  it('collapses byte-identical same-ID rows (idempotent), counting the duplicate', () => {
    const parsed = parseWorkbook([buildSheet('Database', [
      personRow({ personnelId: 'ID-DUP', position: 'SALES' }),
      personRow({ personnelId: 'ID-DUP', position: 'SALES' }),
    ])])
    expect(parsed.records).toHaveLength(1)
    expect(parsed.identicalDuplicatesInFile).toBe(1)
  })

  it('keeps same-ID rows with different complete NoKTP as distinct records (conflict handled later)', () => {
    const parsed = parseWorkbook([buildSheet('Database', [
      personRow({ personnelId: 'ID-DUP', nationalId: '1111111111111111' }),
      personRow({ personnelId: 'ID-DUP', nationalId: '2222222222222222' }),
    ])])
    expect(parsed.records).toHaveLength(2)
    expect(parsed.exceptions).toHaveLength(0) // no longer a parse-time exception
  })
})

// Reconciliation / re-import semantics are covered in reconcile.test.ts.

describe('runImport service', () => {
  const fakeFile = (name = 'test.xlsx') => ({ name, size: 1000 }) as File

  it('commits successfully and reports a summary', async () => {
    const repo = new InMemoryPersonnelRepository()
    const sheets = [buildSheet('Database', [personRow({ personnelId: 'ID-1' }), personRow({ personnelId: 'ID-2' })])]
    const result = await runImport({
      file: fakeFile(), repository: repo, areas: testAreas, projects: testProjects,
      createdBy: 'user-hr', readWorkbook: async () => sheets,
    })
    expect(result.ok).toBe(true)
    expect(result.summary?.newMasters).toBe(2)
    expect((await repo.getAllPersonnel())).toHaveLength(2)
  })

  it('makes no changes and reports failure when the Database sheet is missing', async () => {
    const repo = new InMemoryPersonnelRepository()
    const result = await runImport({
      file: fakeFile(), repository: repo, areas: testAreas, projects: testProjects,
      createdBy: 'user-hr', readWorkbook: async () => [buildSheet('Data Demo', [personRow()])],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Sheet Database tidak ditemukan/)
    expect(await repo.getAllPersonnel()).toHaveLength(0)
  })

  it('does not persist partial results when the transaction fails', async () => {
    const repo = new InMemoryPersonnelRepository()
    repo.failCommit = true
    const sheets = [buildSheet('Database', [personRow({ personnelId: 'ID-1' })])]
    const result = await runImport({
      file: fakeFile(), repository: repo, areas: testAreas, projects: testProjects,
      createdBy: 'user-hr', readWorkbook: async () => sheets,
    })
    expect(result.ok).toBe(false)
    expect(await repo.getAllPersonnel()).toHaveLength(0)
    expect(await repo.getBatches()).toHaveLength(0)
  })

  it('rejects files over the size limit', async () => {
    const repo = new InMemoryPersonnelRepository()
    const big = { name: 'big.xlsx', size: 999 * 1024 * 1024 } as File
    const result = await runImport({
      file: big, repository: repo, areas: testAreas, projects: testProjects,
      createdBy: 'user-hr', readWorkbook: async () => [buildSheet('Database', [personRow()])],
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/melebihi batas/)
  })

  it('previews without persistence, then commits only after confirmation', async () => {
    const repo = new InMemoryPersonnelRepository()
    const options = {
      file: fakeFile(), repository: repo, areas: testAreas, projects: testProjects, createdBy: 'user-hr',
      readWorkbook: async () => [buildSheet('Database', [personRow({ personnelId: 'PREVIEW-1' })])],
    }
    const preview = await prepareImport(options)
    expect(preview.ok).toBe(true)
    expect(await repo.getAllPersonnel()).toHaveLength(0)
    const committed = await commitPreparedImport(preview.prepared!, repo)
    expect(committed.ok).toBe(true)
    expect(await repo.getAllPersonnel()).toHaveLength(1)
  })

  it('discovers Area and Project references from workbook rows in import-only mode', async () => {
    const repo = new InMemoryPersonnelRepository()
    const preview = await prepareImport({
      file: fakeFile(), repository: repo, areas: [], projects: [], createdBy: 'user-hr',
      readWorkbook: async () => [buildSheet('Database', [personRow({
        personnelId: 'REF-001', areaCbs: 'AREA CONTOH', projectName: 'PROJECT CONTOH',
        clientName: 'CLIENT CONTOH', position: 'PROMOTOR', joinDate: '2026-01-01',
      })])],
    })
    expect(preview.ok).toBe(true)
    expect(preview.prepared?.discoveredAreas).toHaveLength(1)
    expect(preview.prepared?.discoveredProjects).toHaveLength(1)
    expect(preview.prepared?.plan.summary.pendingReviewItems).toBe(0)
    expect(preview.prepared?.plan.mastersToPut[0].employee.areaId).toMatch(/^import-area-/)
    expect(preview.prepared?.plan.mastersToPut[0].employee.projectId).toMatch(/^import-project-/)
  })

  it('keeps equal Project names in different Areas as separate references', async () => {
    const repo = new InMemoryPersonnelRepository()
    const preview = await prepareImport({
      file: fakeFile(), repository: repo, areas: [], projects: [], createdBy: 'user-hr',
      readWorkbook: async () => [buildSheet('Database', [
        personRow({ personnelId: 'REF-A', areaCbs: 'AREA A', projectName: 'PROJECT BERSAMA' }),
        personRow({ personnelId: 'REF-B', areaCbs: 'AREA B', projectName: 'PROJECT BERSAMA' }),
      ])],
    })
    expect(preview.prepared?.discoveredAreas).toHaveLength(2)
    expect(preview.prepared?.discoveredProjects).toHaveLength(2)
    const projectIds = preview.prepared?.plan.mastersToPut.map((master) => master.employee.projectId)
    expect(new Set(projectIds).size).toBe(2)
  })

  it('rejects a stale prepared plan', async () => {
    const repo = new InMemoryPersonnelRepository()
    const options = { file: fakeFile(), repository: repo, areas: testAreas, projects: testProjects, createdBy: 'user-hr', readWorkbook: async () => [buildSheet('Database', [personRow()])] }
    const preview = await prepareImport(options)
    await runImport({ ...options, file: fakeFile('other.xlsx'), readWorkbook: async () => [buildSheet('Database', [personRow({ personnelId: 'OTHER' })])] })
    const result = await commitPreparedImport(preview.prepared!, repo)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/kedaluwarsa/)
  })

  it('rejects legacy .xls before reading it', async () => {
    const repo = new InMemoryPersonnelRepository()
    const result = await prepareImport({ file: fakeFile('legacy.xls'), repository: repo, areas: testAreas, projects: testProjects, createdBy: 'user-hr', readWorkbook: async () => { throw new Error('must not read') } })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/tidak didukung/)
  })
})
