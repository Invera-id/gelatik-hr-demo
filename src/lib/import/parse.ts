import { createTemplateColumnMap, locateHeaderRow, selectDatabaseSheet, type SheetTable } from './workbook'
import { mapRow, type MappedRow } from './mapping'
import { cleanText } from './normalizers'
import { SIGNATURE_HEADERS } from './columns'
import { businessFingerprint } from './fingerprint'
import type { FieldIssue, PersonnelStructured } from './types'

/** Normalize ID Personil into the unique business key (trim + upper-case). */
export const toBusinessKey = (personnelId: string): string => cleanText(personnelId).toUpperCase()

/** One distinct source row (identity-valid, non-blank), with its content fingerprint. */
export interface ParsedSourceRecord extends MappedRow {
  businessKey: string
  personnelId: string
  name: string
  fingerprint: string
}

export interface ParseException {
  rowNumber: number
  reason: string
  rawValues: Record<string, string>
}

export interface ParseResult {
  sheetName: string
  headerRowIndex: number
  nonEmptyRows: number
  blankRowsSkipped: number
  /** Rows dropped because an identical (same fingerprint) row for that ID was already seen in this file. */
  identicalDuplicatesInFile: number
  /** All DISTINCT source records (one per distinct fingerprint per ID). Never merged. */
  records: ParsedSourceRecord[]
  /** Distinct records grouped by normalized ID Personil. */
  groups: Map<string, ParsedSourceRecord[]>
  exceptions: ParseException[]
  warnings: FieldIssue[]
}

/** Field-level merge: a non-null incoming value overrides; null never erases an existing value. */
export const mergeFields = (
  base: Record<string, string | null>,
  incoming: Record<string, string | null>,
): Record<string, string | null> => {
  const result = { ...base }
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== null && value !== undefined) result[key] = value
  }
  return result
}

/** Merge structured payloads, keeping an incoming entry only when it carries a value. */
export const mergeStructured = (
  base: PersonnelStructured,
  incoming: PersonnelStructured,
): PersonnelStructured => {
  const result: PersonnelStructured = {
    scores: { ...base.scores },
    measures: { ...base.measures },
    booleans: { ...base.booleans },
    tenureMonths: base.tenureMonths,
  }
  for (const [key, value] of Object.entries(incoming.scores)) {
    if (value.score !== null || value.raw) result.scores[key] = value
  }
  for (const [key, value] of Object.entries(incoming.measures)) {
    if (value.value !== null || value.raw) result.measures[key] = value
  }
  for (const [key, value] of Object.entries(incoming.booleans)) {
    if (value !== null) result.booleans[key] = value
  }
  if (incoming.tenureMonths !== null) result.tenureMonths = incoming.tenureMonths
  return result
}

const looksLikeHeaderRepeat = (row: unknown[]): boolean => {
  const normalized = row.map((cell) => cleanText(cell).toLowerCase())
  return SIGNATURE_HEADERS.every((signature) => normalized.includes(signature))
}

/**
 * Parse the chosen Database sheet into DISTINCT, identity-valid source records,
 * grouped by normalized ID Personil. Rows are NOT merged: several distinct rows
 * for the same ID are all kept (they may represent history). Only rows whose
 * normalized business content is identical (same fingerprint) are collapsed, so
 * re-importing the same row stays idempotent. Classification of each group
 * (duplicate vs movement/exit/conflict) happens later, in classify.ts.
 *
 * Pure: performs no I/O and touches no database. Throws ImportAbortError (via
 * selectDatabaseSheet / locateHeaderRow) on fatal structure problems.
 */
export const parseWorkbook = (sheets: SheetTable[], date1904 = false): ParseResult => {
  const sheet = selectDatabaseSheet(sheets)
  const header = locateHeaderRow(sheet.rows)
  const columnMap = header.matchesTemplate ? null : createTemplateColumnMap(header.headers)

  const records: ParsedSourceRecord[] = []
  const groups = new Map<string, ParsedSourceRecord[]>()
  /** `${businessKey}:${fingerprint}` already seen in THIS file. */
  const seenInFile = new Set<string>()
  const exceptions: ParseException[] = []
  let nonEmptyRows = 0
  let blankRowsSkipped = 0
  let identicalDuplicatesInFile = 0

  for (let i = header.rowIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] ?? []
    const rowNumber = i + 1 // Excel 1-based row number

    const canonicalRow = columnMap
      ? columnMap.map((sourceIndex) => sourceIndex >= 0 ? row[sourceIndex] ?? null : null)
      : row
    const mapped = mapRow(canonicalRow, rowNumber, date1904)
    if (mapped.isBlank) {
      blankRowsSkipped++
      continue
    }
    if (looksLikeHeaderRepeat(row)) continue

    nonEmptyRows++

    const personnelId = mapped.fields.personnelId
    const name = mapped.fields.name
    const critical = [!personnelId ? 'ID Personil' : null, !name ? 'Nama' : null].filter(Boolean)
    if (critical.length) {
      exceptions.push({ rowNumber, reason: `Field kritikal belum lengkap: ${critical.join(', ')}.`, rawValues: mapped.rawValues })
      continue
    }

    const validPersonnelId = personnelId as string
    const validName = name as string
    const businessKey = toBusinessKey(validPersonnelId)
    const fingerprint = businessFingerprint(mapped.fields)
    const dedupeKey = `${businessKey}:${fingerprint}`
    if (seenInFile.has(dedupeKey)) {
      // Byte-for-byte identical business content already captured → not history.
      identicalDuplicatesInFile++
      continue
    }
    seenInFile.add(dedupeKey)

    const record: ParsedSourceRecord = { ...mapped, businessKey, personnelId: validPersonnelId, name: validName, fingerprint }
    records.push(record)
    const group = groups.get(businessKey)
    if (group) group.push(record)
    else groups.set(businessKey, [record])
  }

  const warnings = records.flatMap((record) => record.warnings)
  return {
    sheetName: sheet.name,
    headerRowIndex: header.rowIndex,
    nonEmptyRows,
    blankRowsSkipped,
    identicalDuplicatesInFile,
    records,
    groups,
    exceptions,
    warnings,
  }
}
