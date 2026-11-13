import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { request } from '../api/client'
import { useDemo } from './DemoContext'
import { NotificationContext, type NotificationContextValue, type ToastItem } from './NotificationContext'
import type { NotificationRecord } from '../lib/notifications/types'

const POLL_MS = 30_000

/**
 * Server-backed notifications: created by the backend inside the same transaction
 * as the business change, polled here, with read/archive state per recipient.
 */
export function ApiNotificationProvider({ children }: { children: ReactNode }) {
  const { currentUser, permissionConfig } = useDemo()
  const [items, setItems] = useState<NotificationRecord[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seen = useRef<{ userId: string | null; ids: Set<string> }>({ userId: null, ids: new Set() })
  const canView = Boolean(currentUser && permissionConfig.find((c) => c.role === currentUser.role)?.permissions.includes('view_notifications'))

  const dismissToast = useCallback((id: string) => setToasts((current) => current.filter((t) => t.id !== id)), [])

  const load = useCallback(async () => {
    if (!currentUser || !canView) {
      setItems([])
      setUnreadCount(0)
      setTotal(0)
      return
    }
    try {
      const res = await request<{ items: NotificationRecord[]; unreadCount: number; total: number }>('/notifications', { query: { limit: 100 } })
      const fresh = seen.current.userId === currentUser.id ? res.items.filter((n) => !seen.current.ids.has(n.id)) : []
      if (seen.current.userId !== currentUser.id) seen.current = { userId: currentUser.id, ids: new Set() }
      res.items.forEach((n) => seen.current.ids.add(n.id))
      // Toast only live events caused by other users, never history or own actions.
      fresh.filter((n) => !n.readAt && n.actorUserId && n.actorUserId !== currentUser.id).slice(0, 3).forEach((n) => {
        const id = `toast-${n.id}`
        setToasts((current) => [...current, { id, title: n.title, message: n.message, severity: n.severity }])
        window.setTimeout(() => dismissToast(id), 6000)
      })
      setItems(res.items)
      setUnreadCount(res.unreadCount)
      setTotal(res.total)
    } catch {
      /* keep the last known list; the next poll retries */
    }
  }, [currentUser, canView, dismissToast])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const timer = window.setInterval(() => { void load() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  const mark = useCallback(async (ids: string[], action: 'read' | 'archive') => {
    if (!ids.length) return
    await request('/notifications/mark', { method: 'POST', body: { ids, action } }).catch(() => undefined)
    await load()
  }, [load])

  const value: NotificationContextValue = {
    items, unreadCount, total, toasts, dismissToast,
    markRead: (id) => { void mark([id], 'read') },
    // Server-side: every unread notification, not only the 100 loaded here.
    markAllRead: async () => {
      await request('/notifications/mark', { method: 'POST', body: { action: 'read', all: true } }).catch(() => undefined)
      await load()
    },
    archive: (id) => { void mark([id], 'archive') },
  }
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}
