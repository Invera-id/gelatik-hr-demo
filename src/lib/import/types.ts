import type { Employee } from '../../types'

/** Severity of an issue attached to a single source cell or row. */
export type IssueSeverity = 'WARNING' | 'ERROR'

/** A single normalization/validation problem tied to a source cell. */
export interface FieldIssue {
  /** Excel row number (1-based, matches the spreadsheet). */
  rowNumber: number
  /** Human-facing source column name, e.g. "Tanggal Lahir". */
  column: string
  /** Canonical internal field key, when applicable. */
  field?: string
  /** Why this is a problem. */
  reason: string
  /** Raw source value, stringified for the report (may be omitted for privacy-neutral issues). */
  rawValue?: string
  severity: IssueSeverity
}

/** Structured academic/test score, preserving the source scale. */
export interface ScoreValue {
  raw: string
  score: number | null
  maxScore: number | null
  /** Only set when a denominator (max) is explicitly present. */
  percentage: number | null
}

/** Structured physical measurement normalized to a canonical unit. */
export interface MeasureValue {
  raw: string
  /** Normalized numeric value in the field's canonical unit (cm or kg). */
  value: number | null
}

/** The structured, non-display payload kept alongside an employee for audit + correct semantics. */
export interface PersonnelStructured {
  scores: Record<string, ScoreValue>
  measures: Record<string, MeasureValue>
  /** Physical-selection statements: true = statement holds, false = does not, null = unknown. */
  booleans: Record<string, boolean | null>
  /** Parsed total tenure in months, when derivable from "x tahun y bulan". */
  tenureMonths: number | null
}

/** A personnel record as stored in the repository (source of truth). */
export interface StoredPersonnel {
  /** Normalized ID Personil — the unique business key. */
  businessKey: string
  /** Display/domain model consumed by every personnel view. */
  employee: Employee
  /** Raw source values keyed by canonical field, for audit and lossless preservation. */
  raw: Record<string, string | number | boolean | null>
  structured: PersonnelStructured
  /** Per-field warnings produced while importing this record. */
  warnings: FieldIssue[]
  sourceRowNumber: number
  /** How many additional in-file rows carried this same ID (0 = unique). */
  duplicateInFileCount: number
  fileName: string
  sheetName: string
  batchId: string
  createdAt: string
  updatedAt: string
}

/** A row that failed minimum identity requirements and could not become a personnel record. */
export interface ImportException {
  id: string
  batchId: string
  rowNumber: number
  reason: string
  /** Raw source values by column name for the problem row. */
  rawValues: Record<string, string>
  createdAt: string
}

/** Final per-run status. */
export type ImportBatchStatus =
  | 'COMPLETED'
  | 'COMPLETED_WITH_WARNINGS'
  | 'COMPLETED_WITH_EXCEPTIONS'
  | 'FAILED'

/** Summary counters for a single import run. */
export interface ImportSummary {
  fileName: string
  sheetName: string
  nonEmptyRows: number
  uniqueIds: number
  added: number
  updated: number
  unchanged: number
  duplicatesInFile: number
  exceptionRows: number
  warningRows: number
  blankRowsSkipped: number
}

/** Persisted record of an import run. */
export interface ImportBatch {
  id: string
  fileName: string
  sheetName: string
  status: ImportBatchStatus
  summary: ImportSummary
  createdAt: string
}

/** A fatal error that aborts the whole import with no DB changes. */
export class ImportAbortError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportAbortError'
  }
}
