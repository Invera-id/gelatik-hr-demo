import { isSampleMode } from '../../config/dataMode'

/** Categories group notifications for filtering and iconography. */
export type NotificationCategory =
  | 'VALIDATION_REQUEST'
  | 'VALIDATION_RESULT'
  | 'EXIT'
  | 'MOVEMENT'
  | 'REPLACEMENT'
  | 'IMPORT'
  | 'CONTRACT'
  | 'SLA'
  | 'PERSONNEL'
  | 'ADMIN'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'

/** Where clicking a notification should take the user. */
export interface NotificationTarget {
  /** 'validation' focuses a submission; 'employee'/'replacement' open a detail; 'route' is a plain path. */
  kind: 'validation' | 'employee' | 'replacement' | 'import' | 'route'
  /** Entity id for access re-check and focus (employeeId, needId, ...). */
  id?: string
  /** Explicit route override. */
  route?: string
}

/**
 * A persisted, per-recipient notification. One business event fans out to one
 * record per recipient, each with its own read/archived/resolved state.
 */
export interface NotificationRecord {
  id: string
  /** Idempotency key — a record with the same dedupeKey is never inserted twice. */
  dedupeKey: string
  recipientUserId: string
  category: NotificationCategory
  severity: NotificationSeverity
  title: string
  message: string
  actorUserId: string | null
  entityType: string
  entityId: string | null
  /** Area the event belongs to, for access re-checks at render/click time. */
  areaId: string | null
  target: NotificationTarget | null
  /** True while this is an actionable item (e.g. a submission awaiting validation). */
  requiresAction: boolean
  createdAt: string
  readAt: string | null
  archivedAt: string | null
  /** Set when the underlying need/condition is handled (validated, fulfilled, contract renewed...). */
  resolvedAt: string | null
}

/** The persisted store shape (single source in localStorage). */
export interface NotificationStore {
  version: number
  notifications: NotificationRecord[]
}

/** A pure specification of an event before it is expanded per recipient. */
export interface NotificationSpec {
  /** Stable base key for the event; final dedupeKey appends the recipient id. */
  dedupeBase: string
  recipientIds: string[]
  category: NotificationCategory
  severity: NotificationSeverity
  title: string
  message: string
  actorUserId?: string | null
  entityType: string
  entityId?: string | null
  areaId?: string | null
  target?: NotificationTarget | null
  requiresAction?: boolean
}

export const STORE_VERSION = 1
export const STORAGE_KEY = isSampleMode ? 'gelatik-notifications-v1' : 'gelatik-import-only-notifications-v1'
export const BROADCAST_CHANNEL = isSampleMode ? 'gelatik-notifications' : 'gelatik-import-only-notifications'
