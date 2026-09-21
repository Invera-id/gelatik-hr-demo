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
