import type { MeasureValue, ScoreValue } from './types'

/**
 * Low-level value normalizers. Each function is pure and side-effect free so it
 * can be unit-tested in isolation and reused by the column mapping layer.
 *
 * Design rules (from the import spec):
 * - Empty-ness is decided PER FIELD, never globally.
 * - Numeric 0 is a real value and must never collapse to null.
 * - Business codes such as Status "N/A" are NOT empty markers.
 * - Identifiers keep their leading zeros and never become floats.
 */


/** Collapse whitespace (incl. non-breaking space / line breaks) and trim. */
export const cleanText = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value).replace(/\s+/g, ' ').trim()
}

/** Normalize a header for matching: cleaned + lowercased. */
export const normalizeHeader = (value: unknown): string => cleanText(value).toLowerCase()

/** Tokens that represent "no value" for text fields. Case-insensitive. */
const EMPTY_TOKENS = new Set(['', '-', 'tidak berlaku', 'n/a', 'na', 'null', '#n/a'])

/**
 * Normalize a general text field to a trimmed string or null.
 * `keepTokens` lets a field (e.g. outlet Status) treat an otherwise-empty token
 * such as "N/A" as a real value.
 */
export const normalizeText = (
  value: unknown,
  keepTokens: ReadonlySet<string> = new Set(),
): string | null => {
  // Numbers (including 0) are meaningful — stringify without losing them.
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  const text = cleanText(value)
  if (keepTokens.has(text.toLowerCase())) return text
  if (EMPTY_TOKENS.has(text.toLowerCase())) return null
  return text || null
}

/**
 * Normalize an identifier/contact that must stay a string with leading zeros.
 * Never emits scientific notation and never fabricates digits.
 * Returns { value, masked } where masked flags "xxx"-style redactions.
 */
export const normalizeIdentifier = (
  value: unknown,
): { value: string | null; masked: boolean; precisionLoss: boolean } => {
  if (value === null || value === undefined) return { value: null, masked: false, precisionLoss: false }
  let precisionLoss = false
  let text: string
  if (typeof value === 'number') {
    // A long identifier that arrived as a float may already have lost precision.
    if (!Number.isSafeInteger(value) && Math.abs(value) >= 1e15) precisionLoss = true
    text = bigIntSafeString(value)
  } else {
    text = cleanText(value)
  }
  if (EMPTY_TOKENS.has(text.toLowerCase())) return { value: null, masked: false, precisionLoss: false }
  const masked = /x{2,}/i.test(text)
  return { value: text || null, masked, precisionLoss }
}

/** Render a number as a plain integer string when possible, never exponential. */
const bigIntSafeString = (value: number): string => {
  if (Number.isInteger(value)) {
    try {
      return BigInt(value).toString()
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** Normalize RT/RW: pad a clearly-numeric value to 3 digits, else keep as string. */
export const normalizeRtRw = (value: unknown): string | null => {
  const base = normalizeIdentifier(value).value
  if (base === null) return null
  if (/^\d{1,3}$/.test(base)) return base.padStart(3, '0')
  return base
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7,
  aug: 8, agu: 8, agt: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
}

/** Expand a 2-digit year: 00–49 → 2000–2049, 50–99 → 1950–1999. */
const expandYear = (yy: number): number => (yy <= 49 ? 2000 + yy : 1900 + yy)

/** Excel serial date → {y,m,d} honoring the 1900 or 1904 date system. */
const serialToYmd = (serial: number, date1904: boolean): { y: number; m: number; d: number } | null => {
  if (!Number.isFinite(serial) || serial <= 0) return null
  // Excel's 1900 system has a leap-year bug: serial 60 = fictitious 1900-02-29.
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31)
  let days = Math.floor(serial)
  if (!date1904 && days >= 60) days -= 1 // skip the phantom 1900-02-29
  const ms = epoch + days * 86400000
  const d = new Date(ms)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}

/** Validate a calendar date and format as YYYY-MM-DD, or null if impossible. */
const buildIsoDate = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const probe = new Date(Date.UTC(y, m - 1, d))
  // Reject overflow (e.g. 31-Feb rolling into March).
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export interface DateResult {
  value: string | null
  /** True when the source had content but could not be parsed into a real date. */
  invalid: boolean
}

/**
 * Normalize any supported date representation to a date-only `YYYY-MM-DD` string
 * with no timezone shift. Supports: Date objects, Excel serials, `21-Oct-00`,
 * `9-Sep-26`, `09/09/2026` (d/m/y), and `2026-09-09`.
 */
export const normalizeDate = (value: unknown, date1904 = false): DateResult => {
  if (value === null || value === undefined) return { value: null, invalid: false }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { value: null, invalid: true }
    const iso = buildIsoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
    return { value: iso, invalid: iso === null }
  }

  if (typeof value === 'number') {
    const ymd = serialToYmd(value, date1904)
    if (!ymd) return { value: null, invalid: true }
    const iso = buildIsoDate(ymd.y, ymd.m, ymd.d)
    return { value: iso, invalid: iso === null }
  }

  const text = cleanText(value)
  if (EMPTY_TOKENS.has(text.toLowerCase())) return { value: null, invalid: false }

  // ISO: 2026-09-09
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (match) {
    const iso = buildIsoDate(Number(match[1]), Number(match[2]), Number(match[3]))
    return { value: iso, invalid: iso === null }
  }

  // Month-name: 21-Oct-00, 9 Sep 26, 9/Sep/2026
  match = /^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{2,4})$/.exec(text)
  if (match) {
    const mon = MONTHS[match[2].slice(0, 3).toLowerCase()]
    if (!mon) return { value: null, invalid: true }
    const yearNum = Number(match[3])
    const year = match[3].length <= 2 ? expandYear(yearNum) : yearNum
    const iso = buildIsoDate(year, mon, Number(match[1]))
    return { value: iso, invalid: iso === null }
  }

  // Numeric slash/dash: day/month/year (Indonesian convention).
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text)
  if (match) {
    const yearNum = Number(match[3])
    const year = match[3].length <= 2 ? expandYear(yearNum) : yearNum
    const iso = buildIsoDate(year, Number(match[2]), Number(match[1]))
    return { value: iso, invalid: iso === null }
  }

  return { value: null, invalid: true }
}

/**
 * Parse a test score that may be `65`, `65/100`, ` 65 / 100 `, `0`, or `-`.
 * Keeps raw, numeric score, optional max, and percentage (only when max is explicit).
 */
export const normalizeScore = (value: unknown): { result: ScoreValue; warning: string | null } => {
  const raw = typeof value === 'number' ? String(value) : cleanText(value)
  if (value === null || value === undefined || EMPTY_TOKENS.has(raw.toLowerCase())) {
    return { result: { raw, score: null, maxScore: null, percentage: null }, warning: null }
  }
  const fraction = /^(-?\d+(?:[.,]\d+)?)\s*\/\s*(-?\d+(?:[.,]\d+)?)$/.exec(raw)
  if (fraction) {
    const score = Number(fraction[1].replace(',', '.'))
    const max = Number(fraction[2].replace(',', '.'))
    if (max === 0) {
      return { result: { raw, score, maxScore: null, percentage: null }, warning: 'Penyebut nilai 0 tidak valid; nilai mentah dipertahankan.' }
    }
    const percentage = Math.round((score / max) * 10000) / 100
    const warning = score > max ? 'Nilai melebihi penyebut; tidak dikoreksi otomatis.' : null
    return { result: { raw, score, maxScore: max, percentage }, warning }
  }
  const single = /^-?\d+(?:[.,]\d+)?$/.exec(raw)
  if (single) {
    return { result: { raw, score: Number(raw.replace(',', '.')), maxScore: null, percentage: null }, warning: null }
  }
  return { result: { raw, score: null, maxScore: null, percentage: null }, warning: `Format nilai tidak dikenal: ${raw}.` }
}

const UNIT_TO_CM: Record<string, number> = { cm: 1, m: 100, mm: 0.1 }
const UNIT_TO_KG: Record<string, number> = { kg: 1, g: 0.001, gr: 0.001, gram: 0.001 }

/**
 * Normalize a physical measurement to a canonical unit (cm for height, kg for weight).
 * Handles bare numbers (default unit), explicit units, and decimal comma/dot.
 */
export const normalizeMeasure = (
  value: unknown,
  kind: 'height' | 'weight',
): { result: MeasureValue; warning: string | null } => {
  const raw = typeof value === 'number' ? String(value) : cleanText(value)
  if (value === null || value === undefined || EMPTY_TOKENS.has(raw.toLowerCase())) {
    return { result: { raw, value: null }, warning: null }
  }
  const match = /^(-?\d+(?:[.,]\d+)?)\s*([A-Za-z]+)?$/.exec(raw)
  if (!match) return { result: { raw, value: null }, warning: `Nilai ${kind === 'height' ? 'tinggi' : 'berat'} tidak terbaca: ${raw}.` }
  const num = Number(match[1].replace(',', '.'))
  const unit = (match[2] ?? '').toLowerCase()
  const table = kind === 'height' ? UNIT_TO_CM : UNIT_TO_KG
  if (!unit) return { result: { raw, value: num }, warning: null } // bare number → canonical unit
  const factor = table[unit]
  if (factor === undefined) return { result: { raw, value: null }, warning: `Satuan tidak dikenal (${match[2]}) pada ${raw}.` }
  return { result: { raw, value: Math.round(num * factor * 100) / 100 }, warning: null }
}

/** Normalize a physical-selection statement: YA→true, TIDAK→false, empty/-→null. */
export const normalizeBoolean = (value: unknown): { result: boolean | null; warning: string | null } => {
  const text = cleanText(value).toLowerCase()
  if (text === '' || text === '-') return { result: null, warning: null }
  if (text === 'ya' || text === 'y' || text === 'true') return { result: true, warning: null }
  if (text === 'tidak' || text === 't' || text === 'no' || text === 'false') return { result: false, warning: null }
  return { result: null, warning: `Nilai seleksi fisik tidak dikenal: ${cleanText(value)}.` }
}

const VALID_STATUS_CODES = new Set(['R/P', 'N/A'])

/**
 * Normalize the DATA OUTLET "Status" code. Collapses case/spacing around the slash.
 * Known codes (R/P, N/A) are canonicalized; other non-empty codes are kept raw with a warning.
 * Business meaning is intentionally NOT translated.
 */
export const normalizeStatusCode = (value: unknown): { result: string | null; warning: string | null } => {
  const text = cleanText(value)
  if (text === '' || text === '-') return { result: null, warning: null }
  const canonical = text.replace(/\s*\/\s*/g, '/').toUpperCase()
  if (VALID_STATUS_CODES.has(canonical)) return { result: canonical, warning: null }
  return { result: text, warning: `Kode Status tidak dikenal dipertahankan apa adanya: ${text}.` }
}

/** Normalize gender from clear variants; unknown values are kept raw. */
export const normalizeGender = (value: unknown): string | null => {
  const text = cleanText(value).toLowerCase()
  if (text === '') return null
  if (['l', 'laki-laki', 'laki laki', 'pria', 'male', 'm'].includes(text)) return 'Laki-laki'
  if (['p', 'perempuan', 'wanita', 'female', 'f'].includes(text)) return 'Perempuan'
  return cleanText(value)
}

/** Parse "x tahun y bulan" into total months. Raw label is preserved by the caller. */
export const parseTenureMonths = (value: unknown): number | null => {
  const text = cleanText(value).toLowerCase()
  if (text === '' || text === '-') return null
  const years = /(\d+)\s*tahun/.exec(text)
  const months = /(\d+)\s*bulan/.exec(text)
  if (!years && !months) return null
  return (years ? Number(years[1]) * 12 : 0) + (months ? Number(months[1]) : 0)
}
