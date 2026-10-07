/* eslint-disable react-refresh/only-export-components */
import { Archive, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDemo } from '../context/DemoContext'
import { useNotifications } from '../context/NotificationContext'
import { formatDate } from '../lib/businessRules'
import type { NotificationRecord } from '../lib/notifications/types'

/** Resolve a notification target to a route, re-checking the entity still exists. */
export function useOpenNotification() {
  const navigate = useNavigate()
  const { employees, replacementNeeds } = useDemo()
  const { markRead } = useNotifications()
  return (record: NotificationRecord): string | null => {
    markRead(record.id)
    const target = record.target
    if (!target) return null
    if (target.kind === 'validation' && target.id) { navigate(`/validation?focus=${target.id}`); return null }
    if (target.kind === 'employee' && target.id) {
      if (!employees.some((employee) => employee.id === target.id)) { navigate('/employees'); return 'Data personil tidak lagi tersedia.' }
      navigate(`/employees/${target.id}`); return null
    }
    if (target.kind === 'replacement' && target.id) {
      if (!replacementNeeds.some((need) => need.id === target.id)) { navigate('/replacements'); return 'Kebutuhan replacement tidak lagi tersedia.' }
      navigate(`/replacements/${target.id}`); return null
    }
    if (target.route) { navigate(target.route); return null }
    return null
  }
}

interface NotificationListProps {
  items: NotificationRecord[]
  onNavigate?: () => void
  emptyLabel?: string
}

export function NotificationList({ items, onNavigate, emptyLabel = 'Belum ada notifikasi.' }: NotificationListProps) {
  const open = useOpenNotification()
  const { archive } = useNotifications()
  if (items.length === 0) return <div className="empty-inline">{emptyLabel}</div>
  return (
    <ul className="ntf-list">
      {items.map((item) => {
        const actionable = item.requiresAction && !item.resolvedAt
        return (
          <li key={item.id} className={`ntf-item ${item.readAt ? '' : 'unread'}`}>
            <button className="ntf-main" onClick={() => { open(item); onNavigate?.() }}>
              <span className={`ntf-dot ${item.severity}`} aria-hidden="true" />
              <span className="ntf-body">
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <small>{formatDate(item.createdAt, true)}{actionable ? ' · Perlu tindakan' : ''}</small>
              </span>
              {item.target?.kind === 'validation' && actionable && <span className="ntf-cta">Lihat Pengajuan <ChevronRight size={13} /></span>}
            </button>
            <button className="ntf-archive" aria-label="Arsipkan notifikasi" onClick={() => archive(item.id)}><Archive size={15} /></button>
          </li>
        )
      })}
    </ul>
  )
}
