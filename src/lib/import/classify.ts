import type { EmployeeMovementType } from '../../types'
import { classifyFieldChange } from './fingerprint'
import type { ReviewDateFact, ReviewKind } from './types'

/** Minimal record shape the classifier needs. Both parsed and stored records satisfy it. */
export interface ClassifyRecord {
  id: string
  fingerprint: string
  rowNumber: number
  fields: Record<string, string | null>
}

export interface AutoEvent {
  movementType: EmployeeMovementType
  effectiveDate: string
  beforeRecordId: string | null
  afterRecordId: string
  note: string
}

export interface GroupAspect {
  kind: Extract<ReviewKind, 'PLACEMENT_CHANGE' | 'EXIT' | 'REENTRY' | 'PROFILE_VARIATION'>
  diffFields: string[]
  dates: ReviewDateFact[]
  reason: string
  candidateNote: string
}

export interface GroupAnalysis {
  /** Records deduped by fingerprint (the distinct history entries). */
  distinctRecords: ClassifyRecord[]
  distinctCount: number
  /** How many records collapsed because they were byte-identical in business content. */
  collapsedIdentical: number
  identityConflict: boolean
  conflictingKtps: string[]
  aspects: GroupAspect[]
  autoConfirmable: AutoEvent | null
  needsReview: boolean
  primaryKind: ReviewKind
  /** All business fields that differ across the distinct records. */
  diffFields: string[]
}

/** A complete Indonesian NIK: exactly 15–16 digits, no masking, no precision loss. */
const isCompleteKtp = (value: string | null | undefined): boolean =>
  typeof value === 'string' && /^\d{15,16}$/.test(value.trim())

const DATE_LABELS: Array<[string, string]> = [
  ['joinDate', 'Tanggal Bergabung'],
  ['contractStartDate', 'Tanggal Kontrak'],
  ['contractEndDate', 'Tanggal Berakhir Kontrak'],
  ['mutationDate', 'Tanggal Mutasi'],
  ['exitDate', 'Tanggal Keluar'],
]

const collectDates = (records: ClassifyRecord[], keys: string[]): ReviewDateFact[] => {
  const facts: ReviewDateFact[] = []
  for (const [key, label] of DATE_LABELS) {
    if (!keys.includes(key)) continue
    const values = new Set<string>()
    for (const r of records) {
      const v = r.fields[key]
      if (v) values.add(v)
    }
    for (const v of values) facts.push({ label, value: v })
  }
  return facts
}

/** Pick a movement type from which placement fields actually changed. */
const movementTypeFor = (diffFields: string[]): EmployeeMovementType => {
  const placement = diffFields.filter((f) => classifyFieldChange(f) === 'PLACEMENT')
  const onlyArea = placement.every((f) => f === 'areaCbs' || f === 'subArea' || f === 'coverageArea')
  const onlyPosition = placement.every((f) => f === 'position')
  const onlyProject = placement.every((f) => f === 'projectName' || f === 'clientName' || f === 'outlet' || f === 'teamLeader')
  if (placement.length === 1 && placement[0] === 'position') return 'POSITION_CHANGE'
  if (onlyPosition) return 'POSITION_CHANGE'
  if (onlyArea) return 'AREA_CHANGE'
  if (onlyProject) return 'PROJECT_CHANGE'
  return 'MUTATION'
}

/** The set of business fields that differ across the given records. */
const fieldsThatVary = (records: ClassifyRecord[]): string[] => {
  const all = new Set<string>()
  for (const r of records) for (const k of Object.keys(r.fields)) all.add(k)
  const varying: string[] = []
  for (const key of all) {
    const values = new Set(records.map((r) => (r.fields[key] ?? '').trim()))
    if (values.size > 1) varying.push(key)
  }
  return varying.sort()
}

/**
 * Classify a group of same-ID source records: is it an identical duplicate, or a
 * real movement / exit / re-entry / identity conflict? When the evidence is not
 * enough to decide, the group is marked needsReview — never guessed (§5, §6).
 *
 * Chronology rules honored: row order, "No", sheet order and file name are never
 * used as evidence (records are deduped by fingerprint and examined order-free).
 * Same effective date with no other ordering signal stays ambiguous.
 */
export const classifyGroup = (records: ClassifyRecord[]): GroupAnalysis => {
  // Dedupe by fingerprint — identical business content is one history entry.
  const byFingerprint = new Map<string, ClassifyRecord>()
  for (const r of records) if (!byFingerprint.has(r.fingerprint)) byFingerprint.set(r.fingerprint, r)
  const distinct = [...byFingerprint.values()]
  const collapsedIdentical = records.length - distinct.length

  const base: Omit<GroupAnalysis, 'aspects' | 'autoConfirmable' | 'needsReview' | 'primaryKind' | 'identityConflict' | 'conflictingKtps' | 'diffFields'> = {
    distinctRecords: distinct,
    distinctCount: distinct.length,
    collapsedIdentical,
  }

  if (distinct.length <= 1) {
    return {
      ...base,
      identityConflict: false,
      conflictingKtps: [],
      aspects: [],
      autoConfirmable: null,
      needsReview: false,
      primaryKind: 'IDENTICAL_DUPLICATE',
      diffFields: [],
    }
  }

  // Identity conflict: ≥2 distinct COMPLETE NoKTP. Masked/incomplete never counts (§5F).
  const completeKtps = [...new Set(distinct.map((r) => r.fields.nationalId).filter(isCompleteKtp) as string[])]
  if (completeKtps.length >= 2) {
    return {
      ...base,
      identityConflict: true,
      conflictingKtps: completeKtps,
      aspects: [],
      autoConfirmable: null,
      needsReview: true,
      primaryKind: 'IDENTITY_CONFLICT',
      diffFields: fieldsThatVary(distinct),
    }
  }

  const diffFields = fieldsThatVary(distinct)
  const groups = new Set(diffFields.map(classifyFieldChange))

  const aspects: GroupAspect[] = []

  const placementDiffs = diffFields.filter((f) => classifyFieldChange(f) === 'PLACEMENT')
  if (placementDiffs.length > 0) {
    aspects.push({
      kind: 'PLACEMENT_CHANGE',
      diffFields: placementDiffs,
      dates: collectDates(distinct, ['mutationDate', 'joinDate', 'contractStartDate']),
      reason: 'Penempatan (area/project/posisi) berbeda antar catatan.',
      candidateNote: 'Kemungkinan mutasi/perubahan penempatan — arah dan tanggal perlu dikonfirmasi.',
    })
  }

  const hasAnyExit = distinct.some((r) => r.fields.exitDate || r.fields.exitReason)
  const exitDiffers = diffFields.some((f) => classifyFieldChange(f) === 'EXIT')
  if (hasAnyExit && exitDiffers) {
    aspects.push({
      kind: 'EXIT',
      diffFields: diffFields.filter((f) => classifyFieldChange(f) === 'EXIT'),
      dates: collectDates(distinct, ['exitDate']),
      reason: 'Sebagian catatan memuat Tanggal/Alasan Keluar.',
      candidateNote: 'Perlu dikonfirmasi: akhir penempatan, akhir hubungan kerja, atau koreksi.',
    })
  }

  // Re-entry: an exit date in one record and a join strictly AFTER it in another.
  const exitDates = distinct.map((r) => r.fields.exitDate).filter(Boolean) as string[]
  const joinDates = distinct.map((r) => r.fields.joinDate).filter(Boolean) as string[]
  const maxExit = exitDates.sort().at(-1)
  const reentry = Boolean(maxExit && joinDates.some((j) => j > maxExit))
  if (reentry) {
    aspects.push({
      kind: 'REENTRY',
      diffFields: ['joinDate', 'exitDate'],
      dates: collectDates(distinct, ['exitDate', 'joinDate']),
      reason: 'Ada tanggal keluar lalu tanggal bergabung yang lebih kemudian.',
      candidateNote: 'Kemungkinan re-entry — perlu dikonfirmasi.',
    })
  }

  // If the only differences are profile/employment data (no placement, no exit, no re-entry).
  const onlyDataVariation = !placementDiffs.length && !(hasAnyExit && exitDiffers) && !reentry
  if (onlyDataVariation && diffFields.length > 0) {
    aspects.push({
      kind: 'PROFILE_VARIATION',
      diffFields,
      dates: collectDates(distinct, ['joinDate', 'contractStartDate', 'contractEndDate']),
      reason: 'Variasi data profil/informasi tanpa indikasi perpindahan penempatan.',
      candidateNote: 'Tandai field yang perlu ditinjau; jangan tentukan nilai terkini dari urutan baris.',
    })
  }

  // Auto-confirm a placement change ONLY with a clear source-supported before/after:
  // exactly two distinct records, placement is the only business change (plus the
  // mutation date marking it), and exactly one record carries a mutation date.
  let autoConfirmable: AutoEvent | null = null
  const changeGroupsIgnoringMutation = new Set([...groups].filter((g) => g !== 'MUTATION'))
  const placementIsOnlyChange =
    changeGroupsIgnoringMutation.size === 1 && changeGroupsIgnoringMutation.has('PLACEMENT')
  if (distinct.length === 2 && placementIsOnlyChange && !hasAnyExit && !reentry) {
    const withMutation = distinct.filter((r) => r.fields.mutationDate)
    const withoutMutation = distinct.filter((r) => !r.fields.mutationDate)
    if (withMutation.length === 1 && withoutMutation.length === 1 && withMutation[0].fields.mutationDate) {
      autoConfirmable = {
        movementType: movementTypeFor(placementDiffs),
        effectiveDate: withMutation[0].fields.mutationDate as string,
        beforeRecordId: withoutMutation[0].id,
        afterRecordId: withMutation[0].id,
        note: 'Perubahan penempatan dengan tanggal mutasi yang jelas (Import Excel).',
      }
    }
  }

  const needsReview = aspects.length > 0 && !autoConfirmable
  const primaryKind: ReviewKind =
    aspects.find((a) => a.kind === 'PLACEMENT_CHANGE')?.kind ??
    aspects.find((a) => a.kind === 'EXIT')?.kind ??
    aspects.find((a) => a.kind === 'REENTRY')?.kind ??
    aspects[0]?.kind ??
    (autoConfirmable ? 'PLACEMENT_CHANGE' : 'UNDETERMINED')

  return {
    ...base,
    identityConflict: false,
    conflictingKtps: [],
    aspects,
    autoConfirmable,
    needsReview,
    primaryKind,
    diffFields,
  }
}
