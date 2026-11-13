import { COLUMN_TEMPLATE, type ColumnDef } from './columns'
import {
  cleanText,
  normalizeBoolean,
  normalizeDate,
  normalizeGender,
  normalizeIdentifier,
  normalizeMeasure,
  normalizeRtRw,
  normalizeScore,
  normalizeStatusCode,
  normalizeText,
  parseTenureMonths,
} from './normalizers'
import type { FieldIssue, PersonnelStructured } from './types'

/** Canonical employee-level field keys; everything else maps into EmployeeProfile. */
export const EMPLOYEE_FIELD_KEYS = new Set([
  'personnelId',
  'name',
  'subArea',
  'position',
  'joinDate',
  'contractStartDate',
  'contractEndDate',
])

/** Outlet Status is a business code where "N/A" is valid — never treat it as empty. */

export interface MappedRow {
  rowNumber: number
  /** Canonical field key → normalized display string (or null). Used for identity + field-level merge. */
  fields: Record<string, string | null>
  structured: PersonnelStructured
  /** Lossless source values keyed by canonical field. */
  raw: Record<string, string | number | boolean | null>
  /** Field key → cleaned raw string, for exception / issue reporting. */
  rawValues: Record<string, string>
  warnings: FieldIssue[]
  /** True when every mapped cell in the row is empty. */
  isBlank: boolean
}

const emptyStructured = (): PersonnelStructured => ({ scores: {}, measures: {}, booleans: {}, tenureMonths: null })

/**
 * Map one spreadsheet data row (indexed by column) to normalized fields.
 * `rowNumber` is the 1-based Excel row number for traceability.
 */
export const mapRow = (row: unknown[], rowNumber: number, date1904 = false): MappedRow => {
  const fields: Record<string, string | null> = {}
  const raw: Record<string, string | number | boolean | null> = {}
  const rawValues: Record<string, string> = {}
  const structured = emptyStructured()
  const warnings: FieldIssue[] = []
  let hasAnyValue = false

  const warn = (column: ColumnDef, reason: string, rawValue?: string) =>
    warnings.push({ rowNumber, column: column.header, field: column.field ?? undefined, reason, rawValue, severity: 'WARNING' })

  for (const column of COLUMN_TEMPLATE) {
    if (column.kind === 'marker' || column.kind === 'ignore' || column.field === null) continue
    const cell = row[column.index] ?? null
    const key = column.field
    const cleaned = cleanText(cell)
    if (cleaned !== '') hasAnyValue = true
    raw[key] = cell instanceof Date ? cell.toISOString() : (cell as string | number | boolean | null)
    rawValues[key] = cleaned

    switch (column.kind) {
      case 'text': {
        fields[key] = normalizeText(cell)
        break
      }
      case 'gender': {
        fields[key] = normalizeGender(cell)
        break
      }
      case 'identifier': {
        const out = normalizeIdentifier(cell)
        fields[key] = out.value
        if (out.masked) warn(column, 'Nomor tersamarkan (xxx); teks dipertahankan tanpa menebak digit.', cleaned)
        if (out.precisionLoss) warn(column, 'Identifier panjang tersimpan sebagai angka; presisi digit mungkin hilang.', cleaned)
        break
      }
      case 'rtrw': {
        fields[key] = normalizeRtRw(cell)
        break
      }
      case 'date': {
        const out = normalizeDate(cell, date1904)
        fields[key] = out.value
        if (out.invalid) warn(column, `Tanggal tidak valid dan diabaikan: ${cleaned}.`, cleaned)
        break
      }
      case 'score': {
        const { result, warning } = normalizeScore(cell)
        structured.scores[key] = result
        fields[key] = result.raw || null
        if (warning) warn(column, warning, cleaned)
        break
      }
      case 'height':
      case 'weight': {
        const { result, warning } = normalizeMeasure(cell, column.kind)
        structured.measures[key] = result
        const unit = column.kind === 'height' ? 'cm' : 'kg'
        fields[key] = result.value !== null ? `${result.value} ${unit}` : (cleaned || null)
        if (warning) warn(column, warning, cleaned)
        break
      }
      case 'boolean': {
        const { result, warning } = normalizeBoolean(cell)
        structured.booleans[key] = result
        fields[key] = result === null ? null : key === 'agreementTermination' ? (result ? 'YA' : 'TIDAK') : result ? 'Ya' : 'Tidak'
        if (warning) warn(column, warning, cleaned)
        break
      }
      case 'statusCode': {
        const { result, warning } = normalizeStatusCode(cell)
        fields[key] = result
        if (warning) warn(column, warning, cleaned)
        break
      }
      case 'tenure': {
        fields[key] = cleaned || null
        structured.tenureMonths = parseTenureMonths(cell)
        break
      }
    }
  }

  return { rowNumber, fields, structured, raw, rawValues, warnings, isBlank: !hasAnyValue }
}
