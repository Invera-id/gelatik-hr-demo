import { STORAGE_KEY, STORE_VERSION, type NotificationRecord, type NotificationStore } from './types'

/** localStorage-backed persistence for notifications. One source of truth. */

const empty = (): NotificationStore => ({ version: STORE_VERSION, notifications: [] })

export const readStore = (): NotificationStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Partial<NotificationStore>
    if (!parsed || !Array.isArray(parsed.notifications)) return empty()
    return { version: STORE_VERSION, notifications: parsed.notifications as NotificationRecord[] }
  } catch {
    // Corrupt data: start empty but do NOT delete other app keys.
    return empty()
  }
}

/** Cap retention without dropping unread or still-actionable/unresolved alerts. */
const MAX_RECORDS = 500
const prune = (records: NotificationRecord[]): NotificationRecord[] => {
  if (records.length <= MAX_RECORDS) return records
  const keep = records.filter((r) => !r.readAt || (r.requiresAction && !r.resolvedAt))
  const rest = records
    .filter((r) => r.readAt && !(r.requiresAction && !r.resolvedAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return [...keep, ...rest].slice(0, Math.max(MAX_RECORDS, keep.length))
}

export const writeStore = (store: NotificationStore): boolean => {
  try {
    const pruned: NotificationStore = { version: STORE_VERSION, notifications: prune(store.notifications) }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned))
    return true
  } catch {
    // Quota exceeded or storage unavailable: report failure, keep old data intact.
    return false
  }
}

export const clearStore = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
