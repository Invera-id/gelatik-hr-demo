import { ImportAbortError } from './types'
import { normalizeHeader } from './normalizers'
import { SIGNATURE_HEADERS, TEMPLATE_COLUMN_COUNT, TEMPLATE_HEADERS_NORMALIZED } from './columns'

/** A single sheet as a raw matrix of cells. */
export interface SheetTable {
  name: string
  rows: unknown[][]
}

/** The name the importer will accept, after normalization. Nothing else matches. */
export const TARGET_SHEET_NAME = 'Database'
const TARGET_NORMALIZED = normalizeHeader(TARGET_SHEET_NAME)

export const SHEET_NOT_FOUND_MESSAGE =
  'Sheet Database tidak ditemukan. Ubah nama sheet data menjadi Database lalu impor ulang.'

/**
 * Select the one sheet named exactly "Database" (after trimming + case-folding).
 * - "Database aktif" and every other name are ignored — no partial matching,
 *   no first-sheet fallback, no cross-sheet merge.
 * - Two sheets that both normalize to "Database" is ambiguous → abort.
 * Throws ImportAbortError (which must leave the database untouched) on any failure.
 */
export const selectDatabaseSheet = (sheets: SheetTable[]): SheetTable => {
  const matches = sheets.filter((sheet) => normalizeHeader(sheet.name) === TARGET_NORMALIZED)
  if (matches.length === 0) throw new ImportAbortError(SHEET_NOT_FOUND_MESSAGE)
  if (matches.length > 1) {
    throw new ImportAbortError(
      `Ditemukan ${matches.length} sheet bernama Database setelah normalisasi; impor dihentikan karena ambigu.`,
    )
  }
  return matches[0]
}

export interface HeaderLocation {
  /** 0-based index of the header row within the matrix. */
  rowIndex: number
  /** Normalized header cells of that row. */
  headers: string[]
  /** True when the row matches the known 83-column template positionally. */
  matchesTemplate: boolean
}

/**
 * Find the header row within the first `scanLimit` rows by looking for the
 * combination of signature headers (not a single word). Returns its location
 * and whether it matches the canonical template so the caller can map positionally.
 */
export const locateHeaderRow = (rows: unknown[][], scanLimit = 30): HeaderLocation => {
  const limit = Math.min(scanLimit, rows.length)
  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const headers = (rows[rowIndex] ?? []).map(normalizeHeader)
    const present = SIGNATURE_HEADERS.filter((signature) => headers.includes(signature)).length
    if (present >= SIGNATURE_HEADERS.length) {
      return { rowIndex, headers, matchesTemplate: matchesTemplate(headers) }
    }
  }
  throw new ImportAbortError(
    'Baris header tidak ditemukan. Pastikan sheet Database memuat kolom ID Personil, Nama, Tanggal Bergabung, dan Posisi.',
  )
}

/** True when the header row equals the 83-column template in order (ignoring trailing blanks). */
export const matchesTemplate = (normalizedHeaders: string[]): boolean => {
  const trimmed = [...normalizedHeaders]
  while (trimmed.length > TEMPLATE_COLUMN_COUNT && trimmed[trimmed.length - 1] === '') trimmed.pop()
  if (trimmed.length !== TEMPLATE_COLUMN_COUNT) return false
  return TEMPLATE_HEADERS_NORMALIZED.every((expected, index) => trimmed[index] === expected)
}
