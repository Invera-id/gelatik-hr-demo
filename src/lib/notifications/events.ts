import type { DemoUser, Employee, EmployeeExit, PlacementChangeRequest, ReplacementNeed } from '../../types'
import type { ImportBatch } from '../import/types'
import { adminRecipients, expandSpec, monitoringRecipients, resultRecipients, validationRecipients, type AccessContext } from './rules'
import type { NotificationRecord, NotificationSpec } from './types'

/**
 * Pure event builders. Each returns per-recipient NotificationRecord[] ready to emit.
 * No persistence or side effects here — the caller (DemoContext) persists via the service.
 */

const build = (spec: NotificationSpec, now: string): NotificationRecord[] => expandSpec(spec, now)

const transactionLabel = (employee: Employee): string =>
  employee.validationTransaction === 'EMPLOYEE_BASIC_EDIT' ? 'Perubahan data personil' : 'Employee Entry'

/** Area Supporting submits an entry/basic-edit → notify authorized validators. */
export const buildEntrySubmission = (p: {
  employee: Employee
  actor: DemoUser
  areaName: string
  ctx: AccessContext
  now: string
}): NotificationRecord[] => {
  const transaction = p.employee.validationTransaction ?? 'EMPLOYEE_ENTRY'
  const recipients = validationRecipients(transaction, p.employee.areaId, p.actor.id, p.ctx)
  const label = transactionLabel(p.employee)
  const validators = build({
    dedupeBase: `entry-submit:${p.employee.id}:${p.employee.submittedAt ?? ''}`,
    recipientIds: recipients,
    category: 'VALIDATION_REQUEST',
    severity: 'info',
    title: `${label} menunggu validasi`,
    message: `${p.actor.name} mengajukan ${p.employee.name} (${p.employee.personnelId}) dari area ${p.areaName}. Silakan periksa dan validasi.`,
    actorUserId: p.actor.id,
    entityType: 'employee',
    entityId: p.employee.id,
    areaId: p.employee.areaId,
    target: { kind: 'validation', id: p.employee.id },
    requiresAction: true,
  }, p.now)
  // Confirmation to the submitter that it entered validation (no self-toast; info only).
  const ack = build({
    dedupeBase: `entry-ack:${p.employee.id}:${p.employee.submittedAt ?? ''}`,
    recipientIds: [p.actor.id],
    category: 'VALIDATION_REQUEST',
    severity: 'info',
    title: `${label} dikirim untuk validasi`,
    message: `Pengajuan ${p.employee.name} (${p.employee.personnelId}) terkirim dan menunggu validasi.`,
    actorUserId: p.actor.id,
    entityType: 'employee',
    entityId: p.employee.id,
    areaId: p.employee.areaId,
    target: { kind: 'employee', id: p.employee.id },
    requiresAction: false,
  }, p.now)
  return [...validators, ...ack]
}

/** Validator decides an entry → notify the submitter. Returns the resolve prefix too. */
export const buildEntryResult = (p: {
  employee: Employee
  validator: DemoUser
  status: 'VALIDATED' | 'REVISION_REQUIRED'
  revisionNote?: string | null
  ctx: AccessContext
  now: string
}): NotificationRecord[] => {
  const recipients = resultRecipients(p.employee.createdBy, p.ctx)
  const approved = p.status === 'VALIDATED'
  const label = transactionLabel(p.employee)
  return build({
    dedupeBase: `entry-result:${p.employee.id}:${p.employee.submittedAt ?? ''}:${p.status}`,
    recipientIds: recipients,
    category: 'VALIDATION_RESULT',
    severity: approved ? 'success' : 'warning',
    title: approved ? `${label} disetujui` : `${label} perlu revisi`,
    message: approved
      ? `${p.employee.name} (${p.employee.personnelId}) disetujui oleh ${p.validator.name}.`
      : `${p.employee.name} (${p.employee.personnelId}) perlu revisi: ${p.revisionNote?.trim() || 'Periksa kembali data sebelum dikirim ulang.'}`,
    actorUserId: p.validator.id,
    entityType: 'employee',
    entityId: p.employee.id,
    areaId: p.employee.areaId,
    target: approved ? { kind: 'employee', id: p.employee.id } : { kind: 'route', route: `/employees/${p.employee.id}/edit` },
    requiresAction: false,
  }, p.now)
}

/** Dedupe prefix for an entry submission cycle (used to resolve request items). */
export const entrySubmissionPrefix = (employee: Employee): string => `entry-submit:${employee.id}:${employee.submittedAt ?? ''}`

/** Exit submitted → notify validators. */
export const buildExitSubmission = (p: {
  exit: EmployeeExit
  employee: Employee
  actor: DemoUser
  areaName: string
  ctx: AccessContext
  now: string
}): NotificationRecord[] => {
  const validators = build({
    dedupeBase: `exit-submit:${p.exit.id}:${p.exit.submittedAt ?? ''}`,
    recipientIds: validationRecipients('EMPLOYEE_EXIT', p.employee.areaId, p.actor.id, p.ctx),
    category: 'EXIT',
    severity: 'info',
    title: 'Pengajuan exit menunggu validasi',
    message: `${p.actor.name} mengajukan exit untuk ${p.employee.name} (${p.employee.personnelId}) dari area ${p.areaName}.`,
    actorUserId: p.actor.id,
    entityType: 'exit',
    entityId: p.exit.id,
    areaId: p.employee.areaId,
    target: { kind: 'validation', id: p.employee.id },
    requiresAction: true,
  }, p.now)
  const ack = build({
    dedupeBase: `exit-ack:${p.exit.id}:${p.exit.submittedAt ?? ''}`,
    recipientIds: [p.actor.id],
    category: 'EXIT',
    severity: 'info',
    title: 'Exit dikirim untuk validasi',
    message: `Pengajuan exit ${p.employee.name} (${p.employee.personnelId}) terkirim dan menunggu validasi HR.`,
    actorUserId: p.actor.id,
    entityType: 'exit',
    entityId: p.exit.id,
    areaId: p.employee.areaId,
    target: { kind: 'employee', id: p.employee.id },
    requiresAction: false,
  }, p.now)
  return [...validators, ...ack]
}

export const exitSubmissionPrefix = (exit: EmployeeExit): string => `exit-submit:${exit.id}:${exit.submittedAt ?? ''}`

/** Exit decision → notify submitter; validated exits also notify monitoring. */
export const buildExitResult = (p: {
  exit: EmployeeExit
  employee: Employee
  validator: DemoUser
  status: 'VALIDATED' | 'REVISION_REQUIRED'
  ctx: AccessContext
  now: string
}): NotificationRecord[] => {
  const approved = p.status === 'VALIDATED'
  const recipients = [
    ...resultRecipients(p.exit.createdBy, p.ctx),
    ...(approved ? monitoringRecipients(p.employee.areaId, p.validator.id, p.ctx) : []),
  ]
  return build({
    dedupeBase: `exit-result:${p.exit.id}:${p.exit.submittedAt ?? ''}:${p.status}`,
    recipientIds: recipients,
    category: 'EXIT',
    severity: approved ? 'success' : 'warning',
    title: approved ? 'Exit disetujui' : 'Pengajuan exit perlu revisi',
    message: approved
      ? `Exit ${p.employee.name} (${p.employee.personnelId}) disetujui oleh ${p.validator.name}.`
      : `Exit ${p.employee.name} perlu revisi: ${p.exit.revisionNote?.trim() || 'Periksa kembali data exit.'}`,
    actorUserId: p.validator.id,
    entityType: 'exit',
    entityId: p.exit.id,
    areaId: p.employee.areaId,
    target: approved ? { kind: 'employee', id: p.employee.id } : { kind: 'route', route: `/employees/${p.employee.id}/exit` },
  }, p.now)
}

/** A replacement need was actually created after a validated exit. */
export const buildReplacementNeed = (p: {
  need: ReplacementNeed
  employee: Employee
  actor: DemoUser
  ctx: AccessContext
  now: string
}): NotificationRecord[] =>
  build({
    dedupeBase: `need-created:${p.need.id}`,
    recipientIds: [
      ...p.ctx.users.filter((u) => u.id !== p.actor.id && u.role === 'HR_HO').map((u) => u.id),
      ...monitoringRecipients(p.need.areaId, p.actor.id, p.ctx),
    ],
    category: 'REPLACEMENT',
    severity: 'warning',
    title: 'Replacement need terbentuk',
    message: `Kebutuhan pengganti untuk ${p.employee.name} (${p.employee.personnelId}) telah dibuat.`,
    actorUserId: p.actor.id,
    entityType: 'replacement',
    entityId: p.need.id,
    areaId: p.need.areaId,
    target: { kind: 'route', route: '/replacements' },
    requiresAction: true,
  }, p.now)

/** Movement submission → validators. */
export const buildMovementSubmission = (p: {
  request: PlacementChangeRequest
  employee: Employee
  actor: DemoUser
  ctx: AccessContext
  now: string
}): NotificationRecord[] => {
  // Cross-area: notify validators covering either origin or destination.
  const origin = validationRecipients('EMPLOYEE_PLACEMENT_CHANGE', p.request.previousAreaId, p.actor.id, p.ctx)
  const dest = validationRecipients('EMPLOYEE_PLACEMENT_CHANGE', p.request.newAreaId, p.actor.id, p.ctx)
  const validators = build({
    dedupeBase: `movement-submit:${p.request.id}:${p.request.submittedAt ?? ''}`,
    recipientIds: [...origin, ...dest],
    category: 'MOVEMENT',
    severity: 'info',
    title: 'Pengajuan movement menunggu validasi',
    message: `${p.actor.name} mengajukan ${p.request.movementType.replaceAll('_', ' ').toLowerCase()} untuk ${p.employee.name} (${p.employee.personnelId}).`,
    actorUserId: p.actor.id,
    entityType: 'movement',
    entityId: p.request.id,
    areaId: p.request.newAreaId ?? p.request.previousAreaId,
    target: { kind: 'validation', id: p.employee.id },
    requiresAction: true,
  }, p.now)
  const ack = build({
    dedupeBase: `movement-ack:${p.request.id}:${p.request.submittedAt ?? ''}`,
    recipientIds: [p.actor.id],
    category: 'MOVEMENT',
    severity: 'info',
    title: 'Movement dikirim untuk validasi',
    message: `Pengajuan ${p.request.movementType.replaceAll('_', ' ').toLowerCase()} ${p.employee.name} (${p.employee.personnelId}) terkirim dan menunggu validasi.`,
    actorUserId: p.actor.id,
    entityType: 'movement',
    entityId: p.request.id,
    areaId: p.request.newAreaId ?? p.request.previousAreaId,
    target: { kind: 'employee', id: p.employee.id },
    requiresAction: false,
  }, p.now)
  return [...validators, ...ack]
}

export const movementSubmissionPrefix = (request: PlacementChangeRequest): string =>
  `movement-submit:${request.id}:${request.submittedAt ?? ''}`

/** Movement decision → submitter (+ monitoring when the placement actually changed). */
export const buildMovementResult = (p: {
  request: PlacementChangeRequest
  employee: Employee
  validator: DemoUser
  status: 'VALIDATED' | 'REVISION_REQUIRED'
  ctx: AccessContext
  now: string
}): NotificationRecord[] => {
  const approved = p.status === 'VALIDATED'
  const recipients = [
    ...resultRecipients(p.request.createdBy, p.ctx),
    ...(approved ? monitoringRecipients(p.request.newAreaId, p.validator.id, p.ctx) : []),
  ]
  return build({
    dedupeBase: `movement-result:${p.request.id}:${p.request.submittedAt ?? ''}:${p.status}`,
    recipientIds: recipients,
    category: 'MOVEMENT',
    severity: approved ? 'success' : 'warning',
    title: approved ? 'Movement disetujui' : 'Movement perlu revisi',
    message: approved
      ? `${p.request.movementType.replaceAll('_', ' ')} ${p.employee.name} berlaku efektif ${p.request.effectiveDate}.`
      : `Movement ${p.employee.name} perlu revisi: ${p.request.revisionNote?.trim() || 'Periksa kembali data movement.'}`,
    actorUserId: p.validator.id,
    entityType: 'movement',
    entityId: p.request.id,
    areaId: p.request.newAreaId ?? p.request.previousAreaId,
    target: { kind: 'employee', id: p.employee.id },
  }, p.now)
}

/** Candidate matched to a need. */
export const buildMatch = (p: { need: ReplacementNeed; candidate: Employee; actor: DemoUser; ctx: AccessContext; now: string }): NotificationRecord[] =>
  build({
    dedupeBase: `match:${p.need.id}:${p.candidate.id}`,
    recipientIds: p.ctx.users.filter((u) => u.id !== p.actor.id && u.role === 'HR_HO').map((u) => u.id),
    category: 'REPLACEMENT',
    severity: 'info',
    title: 'Kandidat replacement dipasangkan',
    message: `${p.candidate.name} (${p.candidate.personnelId}) dipasangkan untuk kebutuhan ${p.need.id.toUpperCase()}.`,
    actorUserId: p.actor.id,
    entityType: 'replacement',
    entityId: p.need.id,
    areaId: p.need.areaId,
    target: { kind: 'replacement', id: p.need.id },
  }, p.now)

/** Need fulfilled (resolves the open-need alert). */
export const buildFulfill = (p: { need: ReplacementNeed; candidate: Employee; actor: DemoUser; overSla: boolean; ctx: AccessContext; now: string }): NotificationRecord[] =>
  build({
    dedupeBase: `fulfill:${p.need.id}`,
    recipientIds: [...p.ctx.users.filter((u) => u.id !== p.actor.id && u.role === 'HR_HO').map((u) => u.id), ...monitoringRecipients(p.need.areaId, p.actor.id, p.ctx)],
    category: 'REPLACEMENT',
    severity: p.overSla ? 'warning' : 'success',
    title: p.overSla ? 'Replacement terpenuhi (melewati SLA)' : 'Replacement terpenuhi',
    message: `${p.candidate.name} (${p.candidate.personnelId}) mengisi kebutuhan ${p.need.id.toUpperCase()}${p.need.gapWorkingDays !== null ? ` dalam ${p.need.gapWorkingDays} hari kerja` : ''}.`,
    actorUserId: p.actor.id,
    entityType: 'replacement',
    entityId: p.need.id,
    areaId: p.need.areaId,
    target: { kind: 'replacement', id: p.need.id },
  }, p.now)

/** Re-entry activated. */
export const buildReentry = (p: { employee: Employee; actor: DemoUser; ctx: AccessContext; now: string }): NotificationRecord[] =>
  build({
    dedupeBase: `reentry:${p.employee.id}:${p.now}`,
    recipientIds: monitoringRecipients(p.employee.areaId, p.actor.id, p.ctx),
    category: 'PERSONNEL',
    severity: 'success',
    title: 'Re-entry personil',
    message: `${p.employee.name} (${p.employee.personnelId}) diaktifkan kembali oleh ${p.actor.name}.`,
    actorUserId: p.actor.id,
    entityType: 'employee',
    entityId: p.employee.id,
    areaId: p.employee.areaId,
    target: { kind: 'employee', id: p.employee.id },
  }, p.now)

/** Import summary — exactly one per operation regardless of row count. */
export const buildImportSummary = (p: { batch: ImportBatch; actor: DemoUser; now: string }): NotificationRecord[] => {
  const s = p.batch.summary
  const failed = p.batch.status === 'FAILED'
  const withIssues = p.batch.status === 'COMPLETED_WITH_EXCEPTIONS' || p.batch.status === 'COMPLETED_WITH_WARNINGS'
  return build({
    dedupeBase: `import:${p.batch.id}`,
    recipientIds: [p.actor.id],
    category: 'IMPORT',
    severity: failed ? 'error' : withIssues ? 'warning' : 'success',
    title: failed ? 'Impor Excel gagal' : withIssues ? 'Impor Excel selesai dengan catatan' : 'Impor Excel berhasil',
    message: failed
      ? `Impor ${p.batch.fileName} gagal; tidak ada perubahan data.`
      : `${p.batch.fileName}: ${s.newMasters} personil baru, ${s.newSourceRecords} catatan riwayat, ${s.pendingReviewItems} perlu ditinjau, ${s.confirmedEvents} kejadian terkonfirmasi${s.exceptionRows ? `, ${s.exceptionRows} perlu diperbaiki` : ''}. (Jumlah baris ≠ jumlah personil.)`,
    actorUserId: p.actor.id,
    entityType: 'import',
    entityId: p.batch.id,
    areaId: null,
    target: { kind: 'route', route: '/import' },
  }, p.now)
}

/**
 * One "history needs review" notice per import batch (NOT one per row), sent to the
 * importer (an authorized HR_HO / Super Admin). Only emitted when the run produced
 * ambiguous history. Distinct from confirmed movement/exit notifications.
 */
export const buildReviewNeeded = (p: { batch: ImportBatch; actor: DemoUser; now: string }): NotificationRecord[] => {
  const s = p.batch.summary
  if (s.pendingReviewItems <= 0) return []
  return build({
    dedupeBase: `import-review:${p.batch.id}`,
    recipientIds: [p.actor.id],
    category: 'IMPORT',
    severity: 'warning',
    title: 'Data riwayat perlu ditinjau',
    message: `${p.batch.fileName}: ${s.pendingReviewItems} catatan riwayat personil perlu ditinjau (kandidat mutasi/exit/konflik). Belum ada perubahan status yang dikonfirmasi.`,
    actorUserId: p.actor.id,
    entityType: 'import',
    entityId: p.batch.id,
    areaId: null,
    target: { kind: 'route', route: '/import' },
  }, p.now)
}

/** Import failure (persistence still available) → actor only. */
export const buildImportFailure = (p: { fileName: string; error: string; actor: DemoUser; now: string; opId: string }): NotificationRecord[] =>
  build({
    dedupeBase: `import-fail:${p.opId}`,
    recipientIds: [p.actor.id],
    category: 'IMPORT',
    severity: 'error',
    title: 'Impor Excel gagal',
    message: `${p.fileName}: ${p.error}`,
    actorUserId: p.actor.id,
    entityType: 'import',
    entityId: null,
    areaId: null,
    target: { kind: 'route', route: '/import' },
  }, p.now)

/** Admin/config changes → relevant admins. */
export const buildAdminChange = (p: {
  dedupeBase: string
  title: string
  message: string
  actor: DemoUser
  ctx: AccessContext
  now: string
}): NotificationRecord[] =>
  build({
    dedupeBase: p.dedupeBase,
    recipientIds: adminRecipients('manage_roles', p.actor.id, p.ctx),
    category: 'ADMIN',
    severity: 'info',
    title: p.title,
    message: p.message,
    actorUserId: p.actor.id,
    entityType: 'config',
    entityId: null,
    areaId: null,
    target: null,
  }, p.now)
