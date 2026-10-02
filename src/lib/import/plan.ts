import type { Area, Employee, Project } from '../../types'
import { mergeFields, mergeStructured, type ParseResult } from './parse'
import { buildEmployee, storedToFields, toStoredPersonnel } from './toEmployee'
import type {
  ImportBatch,
  ImportBatchStatus,
  ImportException,
  ImportSummary,
  PersonnelStructured,
  StoredPersonnel,
} from './types'

export interface PlanOptions {
  batchId: string
  fileName: string
  sheetName: string
  createdBy: string
  now: string
  areas: Area[]
  projects: Project[]
}

export interface ImportPlan {
  /** Records to insert or update (unchanged records are intentionally excluded). */
  toPut: StoredPersonnel[]
  exceptions: ImportException[]
  summary: ImportSummary
  status: ImportBatchStatus
  batch: ImportBatch
}

/** Canonical signature of the meaningful data (excludes mutable metadata like updatedAt). */
const dataSignature = (employee: Employee, structured: PersonnelStructured): string =>
  JSON.stringify({
    personnelId: employee.personnelId,
    name: employee.name,
    areaId: employee.areaId,
    subArea: employee.subArea,
    projectId: employee.projectId,
    position: employee.position,
    employmentStatus: employee.employmentStatus,
    joinDate: employee.joinDate,
    contractStartDate: employee.contractStartDate,
    contractEndDate: employee.contractEndDate,
    contractStatus: employee.contractStatus,
    bpjsStatus: employee.bpjsStatus,
    profile: employee.profile ?? {},
    structured,
  })

/**
 * Compute the full set of changes for an import run against the current store.
 * Pure function — does no I/O — so the transactional write can be a single atomic step.
 *
 * Rules enforced here:
 * - New ID → insert. Existing ID with changed data → update. Same data → unchanged.
 * - Field-level merge: empty/invalid incoming values never erase existing valid values.
 * - Re-import conflict (different complete NoKTP for an existing ID) → keep the stored
 *   record and record the incoming row as an exception.
 * - Personnel absent from the new file are left untouched (no replace-all).
 */
export const planImport = (
  existing: StoredPersonnel[],
  parsed: ParseResult,
  options: PlanOptions,
): ImportPlan => {
  const existingByKey = new Map(existing.map((item) => [item.businessKey, item]))
  const toPut: StoredPersonnel[] = []
  const exceptions: ImportException[] = []
  let added = 0
  let updated = 0
  let unchanged = 0

  const pushException = (rowNumber: number, reason: string, rawValues: Record<string, string>) =>
    exceptions.push({
      id: `exc-${options.batchId}-${rowNumber}-${exceptions.length}`,
      batchId: options.batchId,
      rowNumber,
      reason,
      rawValues,
      createdAt: options.now,
    })

  // Carry forward parse-time exceptions (identity failures, in-file conflicts).
  for (const parseException of parsed.exceptions) {
    pushException(parseException.rowNumber, parseException.reason, parseException.rawValues)
  }

  for (const record of parsed.records) {
    const prior = existingByKey.get(record.businessKey)
    if (!prior) {
      toPut.push(toStoredPersonnel(record, {
        batchId: options.batchId,
        fileName: options.fileName,
        sheetName: options.sheetName,
        createdBy: options.createdBy,
        now: options.now,
        context: { areas: options.areas, projects: options.projects },
      }))
      added++
      continue
    }

    // Conflict: an existing complete NoKTP differs from a new complete NoKTP.
    const priorKtp = prior.employee.profile?.nationalId ?? null
    const incomingKtp = record.fields.nationalId
    if (priorKtp && incomingKtp && priorKtp !== incomingKtp) {
      pushException(
        record.rowNumber,
        `Konflik identitas saat impor ulang: ID ${record.personnelId} sudah tersimpan dengan NoKTP ${priorKtp}, file memuat ${incomingKtp}. Record lama dipertahankan.`,
        record.rawValues,
      )
      continue
    }

    const mergedFields = mergeFields(storedToFields(prior), record.fields)
    const mergedStructured = mergeStructured(prior.structured, record.structured)
    const mergedEmployee = buildEmployee(mergedFields, {
      id: prior.employee.id,
      createdBy: prior.employee.createdBy,
      createdAt: prior.createdAt,
      updatedAt: prior.updatedAt,
      validatedBy: prior.employee.validatedBy,
      validatedAt: prior.employee.validatedAt,
    }, { areas: options.areas, projects: options.projects })

    if (dataSignature(mergedEmployee, mergedStructured) === dataSignature(prior.employee, prior.structured)) {
      unchanged++
      continue
    }

    toPut.push({
      ...prior,
      employee: { ...mergedEmployee, updatedAt: options.now },
      raw: { ...prior.raw, ...record.raw },
      structured: mergedStructured,
      warnings: record.warnings,
      sourceRowNumber: record.rowNumber,
      duplicateInFileCount: record.duplicateInFileCount,
      fileName: options.fileName,
      sheetName: options.sheetName,
      batchId: options.batchId,
      updatedAt: options.now,
    })
    updated++
  }

  const warningRows = parsed.records.filter((record) => record.warnings.length > 0).length
  const summary: ImportSummary = {
    fileName: options.fileName,
    sheetName: options.sheetName,
    nonEmptyRows: parsed.nonEmptyRows,
    uniqueIds: parsed.records.length,
    added,
    updated,
    unchanged,
    duplicatesInFile: parsed.duplicatesInFile,
    exceptionRows: exceptions.length,
    warningRows,
    blankRowsSkipped: parsed.blankRowsSkipped,
  }
  const status: ImportBatchStatus =
    exceptions.length > 0 ? 'COMPLETED_WITH_EXCEPTIONS' : warningRows > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED'
  const batch: ImportBatch = {
    id: options.batchId,
    fileName: options.fileName,
    sheetName: options.sheetName,
    status,
    summary,
    createdAt: options.now,
  }
  return { toPut, exceptions, summary, status, batch }
}
