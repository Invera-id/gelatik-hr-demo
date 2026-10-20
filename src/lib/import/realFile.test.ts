import { describe, expect, it } from 'vitest'
import { readWorkbookBrowser } from './service'
import { parseWorkbook } from './parse'
import { buildRow, TEMPLATE_HEADER_ROW } from './testFixtures'

describe('portable synthetic .xlsx fixture', () => {
  it('writes, reads, and parses a real anonymous xlsx without a developer path', async () => {
    type BrowserWriter = (data: unknown, options?: Record<string, unknown>) => { toBlob: () => Promise<Blob> }
    const write = (await import('write-excel-file/browser')).default as unknown as BrowserWriter
    const sourceRow = buildRow({
      personnelId: 'SYNTH-001', name: 'PERSONIL SINTETIS', nationalId: '0000000000000001',
      areaCbs: 'MAKASSAR', projectName: 'NKP MT REGULER', position: 'SALES', joinDate: '2025-01-02',
    })
    const data = [TEMPLATE_HEADER_ROW, sourceRow].map((row) => row.map((value) => ({ value: value ?? null })))
    const blob = await write(data, { sheet: 'Database' }).toBlob()
    const file = new File([blob], 'synthetic-personnel.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const sheets = await readWorkbookBrowser(file)
    const parsed = parseWorkbook(sheets)
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0].personnelId).toBe('SYNTH-001')
    expect(parsed.records[0].name).toBe('PERSONIL SINTETIS')
  }, 20000)
})
