import type { SheetData } from 'write-excel-file/browser'

const headerCell = (value: string) => ({
  value,
  fontWeight: 'bold' as const,
  backgroundColor: '#183348',
  textColor: '#FFFFFF',
  align: 'center' as const,
})

export type ExportValue = string | number | boolean | null | undefined

export interface ExportTable {
  headers: string[]
  rows: ExportValue[][]
}

const toSheetData = ({ headers, rows }: ExportTable): SheetData => [
  headers.map(headerCell),
  ...rows.map((row) => row.map((value) => value ?? '')),
]

export interface ExportWorkbookSheet extends ExportTable {
  name: string
}

/** Shared multi-sheet writer. Throws on failure: never silently loses audit sheets. */
export const createBusinessWorkbook = async (sheets: ExportWorkbookSheet[]) => {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  return writeXlsxFile(sheets.map((sheet) => ({
    sheet: sheet.name,
    data: toSheetData(sheet),
    columns: sheet.headers.map((header) => ({ width: Math.max(18, Math.min(42, header.length + 5)) })),
    stickyRowsCount: 1,
  })))
}

export const exportBusinessWorkbook = async (sheets: ExportWorkbookSheet[], fileName: string) => {
  const workbook = await createBusinessWorkbook(sheets)
  await workbook.toFile(fileName)
}

const downloadCsv = ({ headers, rows }: ExportTable, fileName: string) => {
  const escape = (value: ExportValue) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName.replace(/\.xlsx$/i, '.csv')
  anchor.click()
  URL.revokeObjectURL(url)
}

export const exportBusinessTable = async (table: ExportTable, fileName: string) => {
  try {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    await writeXlsxFile(toSheetData(table), {
      columns: table.headers.map((header) => ({ width: Math.max(14, Math.min(34, header.length + 5)) })),
      stickyRowsCount: 1,
    }).toFile(fileName)
    return 'XLSX' as const
  } catch {
    downloadCsv(table, fileName)
    return 'CSV' as const
  }
}
