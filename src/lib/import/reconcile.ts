import type { Area, Project } from '../../types'
import { classifyGroup, type ClassifyRecord } from './classify'
import { businessFingerprint } from './fingerprint'
import type { ParsedSourceRecord, ParseResult } from './parse'
import { storedToFields, toStoredPersonnel } from './toEmployee'
import type {
  ImportBatch,
  ImportBatchStatus,
  ImportException,
  ImportSummary,
  ReviewDateFact,
  ReviewItem,
  ReviewKind,
  SourceImportRecord,
  StoredPersonnel,
} from './types'
import { findAreaId, findProjectId } from './referenceCatalog'

export interface ReconcileInput {
  masters: StoredPersonnel[]
  sourceRecords: SourceImportRecord[]
  reviewItems: ReviewItem[]
}

export const emptyExisting = (): ReconcileInput => ({ masters: [], sourceRecords: [], reviewItems: [] })

export interface ReconcileOptions {
  batchId: string
  fileName: string
  sheetName: string
  createdBy: string
  now: string
  areas: Area[]
  projects: Project[]
}

export interface ImportPlan {
  mastersToPut: StoredPersonnel[]
  sourceRecordsToPut: SourceImportRecord[]
  reviewItemsToPut: ReviewItem[]
  exceptions: ImportException[]
  summary: ImportSummary
  status: ImportBatchStatus
  batch: ImportBatch
}

const toClassify = (r: SourceImportRecord): ClassifyRecord => ({
  id: r.id,
  fingerprint: r.fingerprint,
  rowNumber: r.rowNumber,
  fields: r.fields,
})

/** Deterministic content hash of a set of fingerprints (order-free). */
const contentHash = (fingerprints: string[]): string =>
  businessFingerprint({ set: [...fingerprints].sort().join('|') })

/** Merge/dedupe labeled dates from several aspects. */
const mergeDates = (lists: ReviewDateFact[][]): ReviewDateFact[] => {
  const seen = new Set<string>()
  const out: ReviewDateFact[] = []
  for (const list of lists) for (const d of list) {
    const key = `${d.label}:${d.value ?? ''}`
    if (!seen.has(key)) { seen.add(key); out.push(d) }
  }
  return out
}

/**
 * Compute the full set of changes for an import run against the current store.
 * Pure: no I/O. Replaces the old "ID same → last row wins" planner with grouping
 * and reconciliation. Every distinct source row is kept; ambiguous groups become
 * pending review items; only clearly-supported events are auto-confirmed; an
 * existing confirmed condition is never overwritten by an older/ambiguous record.
 */
export const reconcile = (
  existing: ReconcileInput,
  parsed: ParseResult,
  options: ReconcileOptions,
): ImportPlan => {
  const mastersByKey = new Map(existing.masters.map((m) => [m.businessKey, m]))
  const existingSourceById = new Map(existing.sourceRecords.map((s) => [s.id, s]))
  const existingSourceByKey = new Map<string, SourceImportRecord[]>()
  for (const s of existing.sourceRecords) {
    const list = existingSourceByKey.get(s.businessKey) ?? []
    list.push(s)
    existingSourceByKey.set(s.businessKey, list)
  }
  const existingReviewById = new Map(existing.reviewItems.map((r) => [r.id, r]))

  const mastersToPut: StoredPersonnel[] = []
  const sourceRecordsToPut: SourceImportRecord[] = []
  const reviewItemsToPut: ReviewItem[] = []
  const exceptions: ImportException[] = []

  let newMasters = 0
  let newSourceRecords = 0
  let identicalDuplicates = parsed.identicalDuplicatesInFile
  let movementCandidates = 0
  let exitReentryCandidates = 0
  let ambiguousCases = 0
  let identityConflicts = 0
  let confirmedEvents = 0

  const pushException = (rowNumber: number, reason: string, rawValues: Record<string, string>) =>
    exceptions.push({ id: `exc-${options.batchId}-${rowNumber}-${exceptions.length}`, batchId: options.batchId, rowNumber, reason, rawValues, createdAt: options.now })
  for (const e of parsed.exceptions) pushException(e.rowNumber, e.reason, e.rawValues)

  const makeSource = (r: ParsedSourceRecord, reconciliationStatus: SourceImportRecord['reconciliationStatus']): SourceImportRecord => ({
    id: `${r.businessKey}:${r.fingerprint}`,
    businessKey: r.businessKey,
    personnelId: r.personnelId,
    name: r.name,
    batchId: options.batchId,
    fileName: options.fileName,
    sheetName: options.sheetName,
    rowNumber: r.rowNumber,
    raw: r.raw,
    fields: r.fields,
    structured: r.structured,
    fingerprint: r.fingerprint,
    warnings: r.warnings,
    reconciliationStatus,
    createdAt: options.now,
  })

  for (const [businessKey, group] of parsed.groups) {
    const prior = mastersByKey.get(businessKey)
    const priorSources = existingSourceByKey.get(businessKey) ?? []
    if (group.every((record) => existingSourceById.has(`${record.businessKey}:${record.fingerprint}`))) {
      identicalDuplicates += group.length
      continue
    }

    // Classify over the full history: the existing master's confirmed condition
    // (as a pseudo-record), any stored source records, and the new rows — so an
    // older/divergent row is detected against the current state (§7, §11, §14).
    const masterPseudo: ClassifyRecord[] = prior
      ? [(() => { const fields = storedToFields(prior); return { id: `master:${businessKey}`, fingerprint: businessFingerprint(fields), rowNumber: 0, fields } })()]
      : []
    const combinedClassify: ClassifyRecord[] = [
      ...masterPseudo,
      ...priorSources.map(toClassify),
      ...group.map((r) => ({ id: `${r.businessKey}:${r.fingerprint}`, fingerprint: r.fingerprint, rowNumber: r.rowNumber, fields: r.fields })),
    ]
    const analysis = classifyGroup(combinedClassify)
    const mappingRecord = group.find((record) => !record.fields.exitDate) ?? group[0]
    const mappedAreaId = findAreaId(mappingRecord.fields.areaCbs, options.areas)
    const mappedProjectId = findProjectId(mappingRecord.fields.projectName, mappedAreaId, options.projects)
    const unknownPlacement = !mappedAreaId || !mappedProjectId || !mappingRecord.fields.position || !mappingRecord.fields.joinDate

    // Route: identity conflict > auto-confirm (new master only) > review > identical.
    // An existing confirmed master is never auto-updated — changes go to review (§7).
    const route: 'CONFLICT' | 'REVIEW' | 'IDENTICAL' =
      analysis.identityConflict ? 'CONFLICT'
        : analysis.aspects.length > 0 || analysis.autoConfirmable || unknownPlacement ? 'REVIEW'
          : 'IDENTICAL'
    const srcStatus: SourceImportRecord['reconciliationStatus'] =
      route === 'IDENTICAL' ? 'IDENTICAL' : 'PENDING_REVIEW'

    // Emit source records (deduped by id); count only genuinely new ones.
    for (const r of group) {
      const id = `${r.businessKey}:${r.fingerprint}`
      if (existingSourceById.has(id)) { identicalDuplicates++; continue }
      sourceRecordsToPut.push(makeSource(r, srcStatus))
      newSourceRecords++
    }

    const name = group[group.length - 1]?.name ?? prior?.employee.name ?? businessKey
    // Representative record for a NEW master: prefer one without an exit date so we
    // don't default an ambiguous person to INACTIVE.
    const representative = group.find((r) => !r.fields.exitDate) ?? group[0]

    // ---- Master handling ----
    if (!prior) {
      const conditionStatus = route === 'REVIEW' || analysis.needsReview || analysis.identityConflict || unknownPlacement ? 'NEEDS_REVIEW' as const : 'CONFIRMED' as const
      // Auto-confirm uses the AFTER record as the confirmed current condition.
      const chosen = representative
      mastersToPut.push(toStoredPersonnel(chosen, {
        batchId: options.batchId, fileName: options.fileName, sheetName: options.sheetName,
        createdBy: options.createdBy, now: options.now,
        context: { areas: options.areas, projects: options.projects },
        conditionStatus,
      }))
      newMasters++
    }
    // Existing master: keep its confirmed condition untouched (§7, §14). Do not
    // overwrite from older/ambiguous rows. New records + review items are enough.

    // ---- Review item handling ----
    const areaId = (prior ?? mastersToPut.find((m) => m.businessKey === businessKey))?.employee.areaId ?? null
    const distinctFingerprints = analysis.distinctRecords.map((r) => r.fingerprint)
    const recordIds = analysis.distinctRecords.map((r) => r.id)
    const rowNumbers = [...new Set(group.map((r) => r.rowNumber))].sort((a, b) => a - b)

    const emitReview = (kind: ReviewKind, aspects: ReviewKind[], reason: string, dates: ReviewDateFact[], candidate: ReviewItem['candidate'], status: ReviewItem['status'], resolution: ReviewItem['resolution']) => {
      const id = `rv:${businessKey}:${kind}:${contentHash(distinctFingerprints)}`
      const previous = existingReviewById.get(id)
      // Preserve a human decision already made for this exact situation (idempotent).
      if (previous && previous.status !== 'PENDING') {
        reviewItemsToPut.push({ ...previous, recordIds, rowNumbers, diffFields: analysis.diffFields, updatedAt: options.now })
        if (previous.status === 'CONFIRMED') confirmedEvents += 0 // already counted previously
        return
      }
      const item: ReviewItem = {
        id, businessKey, personnelId: group[0]?.personnelId ?? businessKey, personnelName: name,
        kind, aspects, areaId, recordIds, diffFields: analysis.diffFields, dates, rowNumbers, reason,
        currentMasterFields: prior ? storedToFields(prior) : null,
        candidate, status, resolution,
        createdAt: previous?.createdAt ?? options.now, updatedAt: options.now,
      }
      reviewItemsToPut.push(item)
    }

    if (route === 'CONFLICT') {
      identityConflicts++
      emitReview('IDENTITY_CONFLICT', ['IDENTITY_CONFLICT'],
        `ID ${group[0]?.personnelId} memiliki NoKTP lengkap berbeda (${analysis.conflictingKtps.join(' vs ')}). Tidak digabung otomatis.`,
        [], { label: 'Konflik identitas — perlu peninjauan', note: 'Jangan gabungkan tanpa kebijakan bisnis.' },
        'PENDING', null)
    } else if (route === 'REVIEW') {
      const aspectKinds = analysis.aspects.map((a) => a.kind)
      if (aspectKinds.includes('PLACEMENT_CHANGE')) movementCandidates++
      if (aspectKinds.includes('EXIT') || aspectKinds.includes('REENTRY')) exitReentryCandidates++
      if (!aspectKinds.includes('PLACEMENT_CHANGE') && !aspectKinds.includes('EXIT') && !aspectKinds.includes('REENTRY')) ambiguousCases++
      emitReview(unknownPlacement && aspectKinds.length === 0 ? 'UNDETERMINED' : analysis.primaryKind, unknownPlacement && aspectKinds.length === 0 ? ['UNDETERMINED'] : aspectKinds,
        unknownPlacement && aspectKinds.length === 0 ? 'Area atau Project belum dikenal pada master referensi. Perlu pemetaan manual.' : analysis.aspects.map((a) => a.reason).join(' '),
        mergeDates(analysis.aspects.map((a) => a.dates)),
        { label: analysis.aspects[0]?.candidateNote ?? 'Perlu ditinjau', note: analysis.aspects.map((a) => a.candidateNote).join(' ') },
        'PENDING', null)
    }
  }

  const warningRows = parsed.records.filter((r) => r.warnings.length > 0).length
  // Pending review items after this run = those emitted as PENDING + previously-stored
  // pending ones not re-touched this run.
  const touchedIds = new Set(reviewItemsToPut.map((r) => r.id))
  const isPending = (item: ReviewItem) => item.status === 'PENDING' || item.status === 'KEPT_PENDING'
  const pendingReviewItems =
    reviewItemsToPut.filter(isPending).length +
    existing.reviewItems.filter((r) => isPending(r) && !touchedIds.has(r.id)).length

  const summary: ImportSummary = {
    fileName: options.fileName,
    sheetName: options.sheetName,
    nonEmptyRows: parsed.nonEmptyRows,
    uniqueIdentities: parsed.groups.size,
    newMasters,
    newSourceRecords,
    identicalDuplicates,
    movementCandidates,
    exitReentryCandidates,
    ambiguousCases,
    identityConflicts,
    confirmedEvents,
    warningRows,
    exceptionRows: exceptions.length,
    blankRowsSkipped: parsed.blankRowsSkipped,
    pendingReviewItems,
  }
  const status: ImportBatchStatus =
    exceptions.length > 0 ? 'COMPLETED_WITH_EXCEPTIONS'
      : pendingReviewItems > 0 ? 'COMPLETED_WITH_REVIEW'
        : warningRows > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED'
  const batch: ImportBatch = {
    id: options.batchId, fileName: options.fileName, sheetName: options.sheetName, status, summary, createdAt: options.now,
  }
  return { mastersToPut, sourceRecordsToPut, reviewItemsToPut, exceptions, summary, status, batch }
}
