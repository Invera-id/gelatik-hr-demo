import { BROADCAST_CHANNEL, type NotificationRecord } from './types'
import { clearStore, readStore, writeStore } from './repository'

/**
 * Notification service singleton: owns the persisted store, deduplicates inserts,
 * notifies in-tab subscribers synchronously, and syncs other tabs via BroadcastChannel.
 * Pure event construction lives in rules.ts; this module only persists + distributes.
 */

type Subscriber = () => void

const subscribers = new Set<Subscriber>()

/** Cached snapshot so useSyncExternalStore gets a stable reference between changes. */
let snapshot: NotificationRecord[] | null = null

let storageListenerAttached = false
const attachStorageListener = () => {
  if (storageListenerAttached || typeof window === 'undefined') return
  storageListenerAttached = true
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === 'gelatik-notifications-v1') notifyLocal()
  })
}

let channel: BroadcastChannel | null = null
const getChannel = (): BroadcastChannel | null => {
  attachStorageListener()
  if (channel) return channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    channel = new BroadcastChannel(BROADCAST_CHANNEL)
    channel.onmessage = () => notifyLocal() // another tab changed the store
  } catch {
    channel = null
  }
  return channel
}

const notifyLocal = () => {
  snapshot = null // invalidate cache so the next read reflects the change
  for (const cb of subscribers) cb()
}

/** Stable snapshot of all records; same reference until the store changes. */
export const getSnapshot = (): NotificationRecord[] => {
  if (snapshot === null) snapshot = readStore().notifications
  return snapshot
}

const broadcast = () => {
  const ch = getChannel()
  try {
    ch?.postMessage({ t: Date.now() })
  } catch {
    /* ignore */
  }
}

export const subscribe = (cb: Subscriber): (() => void) => {
  subscribers.add(cb)
  getChannel()
  return () => subscribers.delete(cb)
}

export const getAll = (): NotificationRecord[] => readStore().notifications

export interface EmitResult {
  ok: boolean
  inserted: NotificationRecord[]
}

/**
 * Insert records, skipping any whose dedupeKey already exists. Returns the rows
 * actually inserted (empty when all were duplicates). Idempotent across refresh,
 * StrictMode, double-click, remount, and re-login.
 */
export const emit = (records: NotificationRecord[]): EmitResult => {
  if (records.length === 0) return { ok: true, inserted: [] }
  const store = readStore()
  const existing = new Set(store.notifications.map((r) => r.dedupeKey))
  const inserted = records.filter((r) => !existing.has(r.dedupeKey))
  if (inserted.length === 0) return { ok: true, inserted: [] }
  const ok = writeStore({ ...store, notifications: [...store.notifications, ...inserted] })
  if (ok) {
    notifyLocal()
    broadcast()
  }
  return { ok, inserted }
}

const mutate = (fn: (records: NotificationRecord[]) => NotificationRecord[]): boolean => {
  const store = readStore()
  const next = fn(store.notifications)
  const ok = writeStore({ ...store, notifications: next })
  if (ok) {
    notifyLocal()
    broadcast()
  }
  return ok
}

const now = () => new Date().toISOString()

export const markRead = (id: string, userId: string): boolean =>
  mutate((records) => records.map((r) => (r.id === id && r.recipientUserId === userId && !r.readAt ? { ...r, readAt: now() } : r)))

export const markManyRead = (ids: string[], userId: string): boolean => {
  const set = new Set(ids)
  return mutate((records) => records.map((r) => (set.has(r.id) && r.recipientUserId === userId && !r.readAt ? { ...r, readAt: now() } : r)))
}

export const archive = (id: string, userId: string): boolean =>
  mutate((records) => records.map((r) => (r.id === id && r.recipientUserId === userId ? { ...r, archivedAt: now(), readAt: r.readAt ?? now() } : r)))

/** Mark actionable items resolved once their underlying request is decided. */
export const resolveByDedupePrefix = (prefix: string): boolean =>
  mutate((records) => records.map((r) => (r.requiresAction && !r.resolvedAt && r.dedupeKey.startsWith(prefix) ? { ...r, resolvedAt: now() } : r)))

export const clearAll = (): void => {
  clearStore()
  notifyLocal()
  broadcast()
}

/** True when a record with this dedupeKey prefix already exists (any recipient). */
export const hasDedupe = (prefix: string): boolean => readStore().notifications.some((r) => r.dedupeKey.startsWith(prefix))

const baseOf = (dedupeKey: string): string => dedupeKey.slice(0, dedupeKey.lastIndexOf('#'))

/**
 * Resolve reminder alerts of a category whose dedupe base is no longer valid
 * (e.g. a contract was renewed or a need got fulfilled). Keeps still-valid ones.
 */
export const reconcileReminders = (category: string, validBases: Set<string>): boolean =>
  mutate((records) =>
    records.map((r) =>
      r.category === category && r.requiresAction && !r.resolvedAt && !validBases.has(baseOf(r.dedupeKey))
        ? { ...r, resolvedAt: now() }
        : r,
    ),
  )
