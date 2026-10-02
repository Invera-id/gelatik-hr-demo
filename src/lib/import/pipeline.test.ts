import { describe, expect, it } from 'vitest'
import { parseWorkbook } from './parse'
import { planImport } from './plan'
import { runImport } from './service'
import { selectDatabaseSheet } from './workbook'
import { ImportAbortError } from './types'
import {
  InMemoryPersonnelRepository,
  buildSheet,
  testAreas,
  testProjects,
} from './testFixtures'
import type { SheetTable } from './workbook'

const planOptions = (batchId = 'batch-1') => ({
  batchId,
  fileName: 'test.xlsx',
  sheetName: 'Database',
  createdBy: 'user-hr',
  now: '2026-10-02T00:00:00.000Z',
  areas: testAreas,
  projects: testProjects,
})

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

  it('records in-file NoKTP conflict as an exception, keeps the first valid record', () => {
    const parsed = parseWorkbook([buildSheet('Database', [
      personRow({ personnelId: 'ID-DUP', nationalId: '1111111111111111' }),
      personRow({ personnelId: 'ID-DUP', nationalId: '2222222222222222' }),
    ])])
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0].fields.nationalId).toBe('1111111111111111')
    expect(parsed.exceptions.some((e) => /Konflik identitas/.test(e.reason))).toBe(true)
  })

  it('merges in-file duplicates (same ID) with last non-empty value winning', () => {
    const parsed = parseWorkbook([buildSheet('Database', [
      personRow({ personnelId: 'ID-DUP', position: 'SALES', outlet: 'A' }),
      personRow({ personnelId: 'ID-DUP', position: 'TEAM LEADER', outlet: '' }),
    ])])
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0].fields.position).toBe('TEAM LEADER')
    expect(parsed.records[0].fields.outlet).toBe('A') // empty did not erase
    expect(parsed.records[0].duplicateInFileCount).toBe(1)
    expect(parsed.duplicatesInFile).toBe(1)
  })
})

describe('import planning (re-import & dedup)', () => {
  it('inserts new personnel', () => {
    const parsed = parseWorkbook([buildSheet('Database', [personRow({ personnelId: 'ID-1' })])])
    const plan = planImport([], parsed, planOptions())
    expect(plan.summary.added).toBe(1)
    expect(plan.summary.updated).toBe(0)
    expect(plan.toPut).toHaveLength(1)
  })

  it('re-importing the identical file adds nothing and updates nothing', () => {
    const parsed = parseWorkbook([buildSheet('Database', [personRow({ personnelId: 'ID-1' })])])
    const first = planImport([], parsed, planOptions('b1'))
    const parsed2 = parseWorkbook([buildSheet('Database', [personRow({ personnelId: 'ID-1' })])])
    const second = planImport(first.toPut, parsed2, planOptions('b2'))
    expect(second.summary.added).toBe(0)
    expect(second.summary.unchanged).toBe(1)
    expect(second.toPut).toHaveLength(0)
  })

  it('updates an existing ID when data changes', () => {
    const first = planImport([], parseWorkbook([buildSheet('Database', [personRow({ personnelId: 'ID-1', position: 'SALES' })])]), planOptions('b1'))
    const second = planImport(first.toPut, parseWorkbook([buildSheet('Database', [personRow({ personnelId: 'ID-1', position: 'TEAM LEADER' })])]), planOptions('b2'))
    expect(second.summary.updated).toBe(1)
    expect(second.toPut[0].employee.position).toBe('TEAM LEADER')
  })

  it('does not erase an existing value with an empty incoming value', () => {
    const first = planImport([], parseWorkbook([buildSheet('Database', [personRow({ personnelId: 'ID-1', outlet: 'OUTLET-A' })])]), planOptions('b1'))
    const second = planImport(first.toPut, parseWorkbook([buildSheet('Database', [personRow({ personnelId: 'ID-1', outlet: '', position: 'NEW POS' })])]), planOptions('b2'))
    const stored = second.toPut[0] ?? first.toPut[0]
    expect(stored.employee.profile?.outlet).toBe('OUTLET-A')
    expect(stored.employee.position).toBe('NEW POS')
  })

  it('leaves personnel absent from the new file untouched (no replace-all)', () => {
    const first = planImport([], parseWorkbook([buildSheet('Database', [
      personRow({ personnelId: 'ID-1' }), personRow({ personnelId: 'ID-2' }),
    ])]), planOptions('b1'))
    const second = planImport(first.toPut, parseWorkbook([buildSheet('Database', [personRow({ personnelId: 'ID-1', position: 'CHANGED' })])]), planOptions('b2'))
    expect(second.summary.added).toBe(0)
    // ID-2 is not in the plan's toPut but also not removed from the store.
    expect(first.toPut.some((p) => p.businessKey === 'ID-2')).toBe(true)
  })

  it('preserves createdAt and internal id across updates', () => {
    const first = planImport([], parseWorkbook([buildSheet('Database', [personRow({ personnelId: 'ID-1', position: 'A' })])]), planOptions('b1'))
    const original = first.toPut[0]
    const second = planImport(first.toPut, parseWorkbook([buildSheet('Database', [personRow({ personnelId: 'ID-1', position: 'B' })])]), { ...planOptions('b2'), now: '2027-01-01T00:00:00.000Z' })
    expect(second.toPut[0].employee.id).toBe(original.employee.id)
    expect(second.toPut[0].createdAt).toBe(original.createdAt)
    expect(second.toPut[0].updatedAt).toBe('2027-01-01T00:00:00.000Z')
  })
})

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
    expect(result.summary?.added).toBe(2)
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
})
