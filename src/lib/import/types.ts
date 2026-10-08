import type { Employee, EmployeeMovementType } from '../../types'

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
  /** Fingerprint of the source record the master's current condition was built from. */
  sourceFingerprint?: string
  fileName: string
  sheetName: string
  batchId: string
  createdAt: string
  updatedAt: string
}

/**
 * One distinct source row, kept losslessly. Several of these can share a
 * businessKey (the same person appearing on multiple rows / imports). The id is
 * deterministic (`${businessKey}:${fingerprint}`) so re-importing identical
 * content overwrites the same record instead of duplicating it.
 */
export interface SourceImportRecord {
  id: string
  businessKey: string
  personnelId: string
  name: string
  batchId: string
  fileName: string
  sheetName: string
  /** Excel 1-based row number — provenance only, NEVER chronology evidence. */
  rowNumber: number
  raw: Record<string, string | number | boolean | null>
  fields: Record<string, string | null>
  structured: PersonnelStructured
  fingerprint: string
  warnings: FieldIssue[]
  reconciliationStatus: 'IDENTICAL' | 'LINKED' | 'PENDING_REVIEW' | 'CONFIRMED'
  createdAt: string
}

/** The kind of decision a reviewer makes about a group of records. */
export type ReviewKind =
  | 'IDENTICAL_DUPLICATE'
  | 'PROFILE_VARIATION'
  | 'PLACEMENT_CHANGE'
  | 'EXIT'
  | 'REENTRY'
  | 'IDENTITY_CONFLICT'
  | 'UNDETERMINED'

export type ReviewStatus = 'PENDING' | 'CONFIRMED' | 'DISMISSED' | 'KEPT_PENDING'

/** A labeled date available from the source (never inferred). */
export interface ReviewDateFact {
  label: string
  value: string | null
}

/** How a reviewer resolved a review item. Feeds a deterministic timeline event. */
export interface ReviewResolution {
  decisionKind: ReviewKind
  movementType?: EmployeeMovementType
  effectiveDate?: string | null
  exitScope?: 'PLACEMENT_END' | 'EMPLOYMENT_END'
  beforeRecordId?: string | null
  afterRecordId?: string | null
  note: string
  reviewedBy: string
  reviewedAt: string
  /** Bumped on every re-decision; part of the derived event id → idempotent. */
  decisionVersion: number
}

/**
 * One thing a reviewer must decide: whether a group of same-ID records is an
 * identical duplicate or a real movement/exit/re-entry/conflict (§8). The id is
 * deterministic so re-import never creates a second review item for the same
 * situation, and a resolved decision is preserved across re-imports.
 */
export interface ReviewItem {
  id: string
  businessKey: string
  personnelId: string
  personnelName: string
  /** Primary classification. */
  kind: ReviewKind
  /** All detected change aspects (a group can be both a placement change and an exit). */
  aspects: ReviewKind[]
  /** Area the person currently sits in, for review scope checks. */
  areaId: string | null
  recordIds: string[]
  diffFields: string[]
  dates: ReviewDateFact[]
  rowNumbers: number[]
  reason: string
  /** Proposed interpretation — explicitly NOT yet confirmed. */
  candidate: { label: string; movementType?: EmployeeMovementType; note: string } | null
  status: ReviewStatus
  resolution: ReviewResolution | null
  createdAt: string
  updatedAt: string
}

/** A reviewer's decision about a review item (consumed by DemoContext.resolveReviewItem). */
export interface ReviewDecision {
  decisionKind: ReviewKind
  movementType?: EmployeeMovementType
  effectiveDate?: string | null
  exitScope?: 'PLACEMENT_END' | 'EMPLOYMENT_END'
  beforeRecordId?: string | null
  afterRecordId?: string | null
  note: string
  /** Keep the item pending (do not decide yet). */
  keepPending?: boolean
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

/** Summary counters for a single import run (§14). Rows ≠ personnel. */
export interface ImportSummary {
  fileName: string
  sheetName: string
  nonEmptyRows: number
  /** Distinct normalized ID Personil seen. */
  uniqueIdentities: number
  /** Brand-new master personnel created. */
  newMasters: number
  /** New distinct source history records persisted. */
  newSourceRecords: number
  /** Rows collapsed as identical duplicates (no new business record). */
  identicalDuplicates: number
  /** Candidate placement changes awaiting review. */
  movementCandidates: number
  /** Candidate exit/re-entry events awaiting review. */
  exitReentryCandidates: number
  /** Groups whose interpretation could not be determined. */
  ambiguousCases: number
  /** Same ID, different complete NoKTP — queued, never auto-merged. */
  identityConflicts: number
  /** Events auto-confirmed at import (clear chronology, no conflict). */
  confirmedEvents: number
  /** Rows carrying at least one normalization warning. */
  warningRows: number
  exceptionRows: number
  blankRowsSkipped: number
  /** Total review items pending after this run. */
  pendingReviewItems: number
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
