/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useDemo } from './DemoContext'
import { demoUsers } from '../data/demoData'
import { archive as svcArchive, emit, getSnapshot, markManyRead, markRead as svcMarkRead, reconcileReminders, subscribe } from '../lib/notifications/service'
import { visibleFor, type AccessContext } from '../lib/notifications/rules'
import { computeContractReminders, computeOverSla } from '../lib/notifications/reminders'
import type { NotificationRecord, NotificationSeverity } from '../lib/notifications/types'

export interface ToastItem {
  id: string
  title: string
  message: string
  severity: NotificationSeverity
}

interface NotificationContextValue {
  items: NotificationRecord[]
  unreadCount: number
  markRead: (id: string) => void
  markAllRead: () => void
  archive: (id: string) => void
  toasts: ToastItem[]
  dismissToast: (id: string) => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { currentUser, permissionConfig, validationPolicy, employees, replacementNeeds } = useDemo()
  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const items = useMemo(
    () => (currentUser ? visibleFor(all, currentUser, permissionConfig) : []),
    [all, currentUser, permissionConfig],
  )
  const unreadCount = useMemo(() => items.filter((item) => !item.readAt).length, [items])

  const markRead = useCallback((id: string) => { if (currentUser) svcMarkRead(id, currentUser.id) }, [currentUser])
  const archive = useCallback((id: string) => { if (currentUser) svcArchive(id, currentUser.id) }, [currentUser])
  const markAllRead = useCallback(() => {
    if (currentUser) markManyRead(items.filter((item) => !item.readAt).map((item) => item.id), currentUser.id)
  }, [currentUser, items])

  // Toasts: only for live events caused by OTHER users (never history, reminders, or own actions).
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const dismissToast = useCallback((id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])
  const pushToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
    setToasts((current) => [...current, { ...toast, id }])
    window.setTimeout(() => dismissToast(id), 6000)
  }, [dismissToast])

  const seenRef = useRef<{ userId: string | null; ids: Set<string> }>({ userId: null, ids: new Set() })
  useEffect(() => {
    const userId = currentUser?.id ?? null
    if (seenRef.current.userId !== userId) {
      seenRef.current = { userId, ids: new Set(items.map((item) => item.id)) } // seed history silently
      return
    }
    const fresh = items.filter((item) => !seenRef.current.ids.has(item.id))
    for (const item of fresh) seenRef.current.ids.add(item.id)
    const toastable = fresh.filter((item) => !item.readAt && item.actorUserId && item.actorUserId !== userId)
    toastable.slice(0, 3).forEach((item) => pushToast({ title: item.title, message: item.message, severity: item.severity }))
  }, [items, currentUser, pushToast])

  // Reminder reconciliation: idempotent, on login/data-change and when the tab regains focus.
  const runReminders = useCallback(() => {
    if (!currentUser) return
    const ctx: AccessContext = { users: demoUsers, permissionConfig, validationPolicy }
    const now = new Date().toISOString()
    const contract = computeContractReminders(employees, ctx, now)
    emit(contract.records)
    reconcileReminders('CONTRACT', contract.validBases)
    const sla = computeOverSla(replacementNeeds, ctx, now)
    emit(sla.records)
    reconcileReminders('SLA', sla.validBases)
  }, [currentUser, permissionConfig, validationPolicy, employees, replacementNeeds])

  useEffect(() => { runReminders() }, [runReminders])
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') runReminders() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [runReminders])

  const value: NotificationContextValue = { items, unreadCount, markRead, markAllRead, archive, toasts, dismissToast }
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export const useNotifications = () => {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotifications must be used inside NotificationProvider')
  return context
}
