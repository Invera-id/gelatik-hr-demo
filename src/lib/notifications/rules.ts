import type { DemoUser, Role, RolePermissionConfig, TransactionType, ValidationPolicy, Permission } from '../../types'
import { allowedAreaIds, canValidateTransaction, hasPermission } from '../../config/access'
import type { NotificationRecord, NotificationSpec } from './types'

export interface AccessContext {
  users: DemoUser[]
  permissionConfig: RolePermissionConfig[]
  validationPolicy: ValidationPolicy
}

/** Does a user's area scope include this area? (null scope = all areas). */
export const userCoversArea = (user: DemoUser, areaId: string | null, config: RolePermissionConfig[]): boolean => {
  const ids = allowedAreaIds(user, config)
  if (ids === null) return true
  if (!areaId) return false
  return ids.includes(areaId)
}

/**
 * Recipients that should act on a submission awaiting validation: users who may
 * validate this transaction type (per policy + permission) and whose scope covers
 * the area. The actor is never notified of their own submission.
 */
export const validationRecipients = (
  transaction: TransactionType,
  areaId: string | null,
  actorId: string,
  ctx: AccessContext,
): string[] => {
  const permission: Permission = transaction === 'EMPLOYEE_EXIT' ? 'validate_exit' : 'validate_employee'
  return ctx.users
    .filter((user) => user.id !== actorId)
    .filter((user) => hasPermission(user, ctx.permissionConfig, permission))
    .filter((user) => canValidateTransaction(user, transaction, ctx.validationPolicy))
    .filter((user) => userCoversArea(user, areaId, ctx.permissionConfig))
    .map((user) => user.id)
}

/** The submission author, if they still exist. */
export const resultRecipients = (createdById: string | null, ctx: AccessContext): string[] =>
  createdById && ctx.users.some((user) => user.id === createdById) ? [createdById] : []

/** Monitoring roles that care about finalized changes/alerts (not drafts). */
export const monitoringRecipients = (
  areaId: string | null,
  actorId: string,
  ctx: AccessContext,
  roles: Role[] = ['OPERATIONS_MANAGER', 'MANAGEMENT'],
): string[] =>
  ctx.users
    .filter((user) => user.id !== actorId)
    .filter((user) => roles.includes(user.role))
    .filter((user) => userCoversArea(user, areaId, ctx.permissionConfig))
    .map((user) => user.id)

/** Users holding an admin/config permission (e.g. manage_roles), excluding the actor. */
export const adminRecipients = (permission: Permission, actorId: string, ctx: AccessContext): string[] =>
  ctx.users
    .filter((user) => user.id !== actorId)
    .filter((user) => hasPermission(user, ctx.permissionConfig, permission))
    .map((user) => user.id)

let counter = 0
const nextId = (): string => {
  counter += 1
  return `ntf-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** Expand a spec into one record per (unique) recipient. Pure. */
export const expandSpec = (spec: NotificationSpec, now: string): NotificationRecord[] => {
  const unique = [...new Set(spec.recipientIds)].filter(Boolean)
  return unique.map((recipientUserId) => ({
    id: nextId(),
    dedupeKey: `${spec.dedupeBase}#${recipientUserId}`,
    recipientUserId,
    category: spec.category,
    severity: spec.severity,
    title: spec.title,
    message: spec.message,
    actorUserId: spec.actorUserId ?? null,
    entityType: spec.entityType,
    entityId: spec.entityId ?? null,
    areaId: spec.areaId ?? null,
    target: spec.target ?? null,
    requiresAction: spec.requiresAction ?? false,
    createdAt: now,
    readAt: null,
    archivedAt: null,
    resolvedAt: null,
  }))
}

/** Visible, access-checked notifications for a user, newest first. */
export const visibleFor = (
  records: NotificationRecord[],
  user: DemoUser,
  config: RolePermissionConfig[],
): NotificationRecord[] =>
  records
    .filter((record) => record.recipientUserId === user.id)
    .filter((record) => !record.archivedAt)
    // If permission/scope changed, a stale notification must not grant access it now lacks.
    .filter((record) => record.areaId === null || userCoversArea(user, record.areaId, config))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
