import { locateHeaderRow, selectDatabaseSheet, type SheetTable } from './workbook'
import { mapRow, type MappedRow } from './mapping'
import { cleanText } from './normalizers'
import { SIGNATURE_HEADERS } from './columns'
import type { FieldIssue, PersonnelStructured } from './types'

/** Normalize ID Personil into the unique business key (trim + upper-case). */
export const toBusinessKey = (personnelId: string): string => cleanText(personnelId).toUpperCase()

export interface ParsedRecord extends MappedRow {
  businessKey: string
  personnelId: string
  name: string
  duplicateInFileCount: number
  /** Excel row numbers of the additional in-file occurrences that were merged in. */
  duplicateRowNumbers: number[]
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
  duplicatesInFile: number
  records: ParsedRecord[]
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
 * Parse the chosen Database sheet into deduplicated, identity-valid personnel records,
 * plus exceptions and warnings. Pure: performs no I/O and touches no database.
 * Throws ImportAbortError (via selectDatabaseSheet / locateHeaderRow) on fatal structure problems.
 */
export const parseWorkbook = (sheets: SheetTable[], date1904 = false): ParseResult => {
  const sheet = selectDatabaseSheet(sheets)
  const header = locateHeaderRow(sheet.rows)

  const records: ParsedRecord[] = []
  const byKey = new Map<string, ParsedRecord>()
  const exceptions: ParseException[] = []
  let nonEmptyRows = 0
  let blankRowsSkipped = 0
  let duplicatesInFile = 0

  for (let i = header.rowIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] ?? []
    const rowNumber = i + 1 // Excel 1-based row number

    const mapped = mapRow(row, rowNumber, date1904)
    if (mapped.isBlank) {
      blankRowsSkipped++
      continue
    }
    if (looksLikeHeaderRepeat(row)) continue

    nonEmptyRows++

    const personnelId = mapped.fields.personnelId
    const name = mapped.fields.name
    if (!personnelId || !name) {
      const missing = [!personnelId ? 'ID Personil' : null, !name ? 'Nama' : null].filter(Boolean).join(' & ')
      exceptions.push({ rowNumber, reason: `Identitas minimum tidak lengkap: ${missing} kosong.`, rawValues: mapped.rawValues })
      continue
    }

    const businessKey = toBusinessKey(personnelId)
    const existing = byKey.get(businessKey)
    if (!existing) {
      const record: ParsedRecord = { ...mapped, businessKey, personnelId, name, duplicateInFileCount: 0, duplicateRowNumbers: [] }
      byKey.set(businessKey, record)
      records.push(record)
      continue
    }

    // Duplicate ID within the same file.
    const existingKtp = existing.fields.nationalId
    const incomingKtp = mapped.fields.nationalId
    if (existingKtp && incomingKtp && existingKtp !== incomingKtp) {
      // Two different complete NoKTP for one ID → do not merge silently.
      exceptions.push({
        rowNumber,
        reason: `Konflik identitas: ID ${personnelId} memiliki NoKTP berbeda (${existingKtp} vs ${incomingKtp}). Baris ini disimpan sebagai exception.`,
        rawValues: mapped.rawValues,
      })
      continue
    }

    existing.fields = mergeFields(existing.fields, mapped.fields)
    existing.structured = mergeStructured(existing.structured, mapped.structured)
    existing.warnings = [...existing.warnings, ...mapped.warnings]
    existing.duplicateInFileCount++
    existing.duplicateRowNumbers.push(rowNumber)
    existing.name = existing.fields.name ?? existing.name
    duplicatesInFile++
  }

  const warnings = records.flatMap((record) => record.warnings)
  return {
    sheetName: sheet.name,
    headerRowIndex: header.rowIndex,
    nonEmptyRows,
    blankRowsSkipped,
    duplicatesInFile,
    records,
    exceptions,
    warnings,
  }
}
