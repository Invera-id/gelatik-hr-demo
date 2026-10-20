import type { Area, Employee, EmployeeProfile, Project } from '../../types'
import { EMPLOYEE_FIELD_KEYS } from './mapping'
import type { PersonnelStructured, StoredPersonnel } from './types'
import type { ParsedSourceRecord } from './parse'
import { findAreaId, findProjectId } from './referenceCatalog'

export interface BuildContext {
  areas: Area[]
  projects: Project[]
}

/** Build the display EmployeeProfile from the merged canonical fields. */
const buildProfile = (fields: Record<string, string | null>, areaId: string | null, areas: Area[]): EmployeeProfile => {
  const profile: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!EMPLOYEE_FIELD_KEYS.has(key)) profile[key] = value
  }
  // areaCbs mirrors the matched area name when available, else the raw source text.
  profile.areaCbs = areas.find((area) => area.id === areaId)?.name ?? fields.areaCbs ?? null
  return profile as EmployeeProfile
}

export interface EmployeeIdentity {
  id: string
  createdBy: string
  createdAt: string
  updatedAt: string
  validatedBy: string | null
  validatedAt: string | null
  /** Whether the current condition is confirmed; NEEDS_REVIEW keeps the person out of active counts. */
  conditionStatus?: 'CONFIRMED' | 'NEEDS_REVIEW'
}

/**
 * Build an Employee domain object from merged personnel fields.
 * Assumptions (documented): employmentStatus is INACTIVE only when a Tanggal Keluar
 * exists; contractStatus is SIGNED when a contract end date exists. Business status
 * codes (R/P, N/A, ...) are never used to derive employment status.
 */
export const buildEmployee = (
  fields: Record<string, string | null>,
  identity: EmployeeIdentity,
  context: BuildContext,
): Employee => {
  const areaId = findAreaId(fields.areaCbs ?? null, context.areas)
  const projectId = findProjectId(fields.projectName ?? null, areaId, context.projects)
  const exitDate = fields.exitDate ?? null
  return {
    id: identity.id,
    personnelId: fields.personnelId ?? '',
    name: fields.name ?? '',
    areaId,
    subArea: fields.subArea ?? null,
    projectId,
    position: fields.position ?? null,
    employmentStatus: exitDate ? 'INACTIVE' : 'ACTIVE',
    conditionStatus: identity.conditionStatus ?? 'CONFIRMED',
    joinDate: fields.joinDate ?? null,
    contractStartDate: fields.contractStartDate ?? fields.joinDate ?? null,
    contractEndDate: fields.contractEndDate ?? null,
    contractStatus: 'NOT_AVAILABLE',
    bpjsStatus: null,
    profile: buildProfile(fields, areaId, context.areas),
    createdBy: identity.createdBy,
    validationStatus: 'SUBMITTED',
    validatedBy: null,
    validatedAt: null,
    submittedAt: identity.createdAt,
    revisionNote: null,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
  }
}

export interface ToStoredOptions {
  batchId: string
  fileName: string
  sheetName: string
  createdBy: string
  now: string
  context: BuildContext
  /** CONFIRMED (single clean/auto-confirmed) or NEEDS_REVIEW (only ambiguous records). */
  conditionStatus?: 'CONFIRMED' | 'NEEDS_REVIEW'
}

/** Build a brand-new StoredPersonnel master from the chosen representative source record. */
export const toStoredPersonnel = (record: ParsedSourceRecord, options: ToStoredOptions): StoredPersonnel => {
  const employee = buildEmployee(record.fields, {
    id: `personnel-${record.businessKey}`,
    createdBy: options.createdBy,
    createdAt: options.now,
    updatedAt: options.now,
    validatedBy: options.createdBy,
    validatedAt: options.now,
    conditionStatus: options.conditionStatus ?? 'CONFIRMED',
  }, options.context)
  return {
    businessKey: record.businessKey,
    employee,
    raw: record.raw,
    structured: record.structured,
    warnings: record.warnings,
    sourceRowNumber: record.rowNumber,
    sourceFingerprint: record.fingerprint,
    fileName: options.fileName,
    sheetName: options.sheetName,
    batchId: options.batchId,
    createdAt: options.now,
    updatedAt: options.now,
  }
}

/** Extract the flat canonical fields back out of a stored record (for re-merge on re-import). */
export const storedToFields = (stored: StoredPersonnel): Record<string, string | null> => {
  const profile = stored.employee.profile ?? {}
  const fields: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(profile)) fields[key] = (value as string | null) ?? null
  fields.personnelId = stored.employee.personnelId
  fields.name = stored.employee.name
  fields.subArea = stored.employee.subArea
  fields.position = stored.employee.position
  fields.joinDate = stored.employee.joinDate
  fields.contractStartDate = stored.employee.contractStartDate
  fields.contractEndDate = stored.employee.contractEndDate
  return fields
}

/** Pull the structured-relevant projectName/clientName are inside profile already. */
export const sameStructured = (a: PersonnelStructured, b: PersonnelStructured): boolean =>
  JSON.stringify(a) === JSON.stringify(b)
