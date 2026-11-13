import { Bell, CheckCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useNotifications } from '../context/NotificationContext'
import { NotificationList } from './NotificationList'

export function NotificationBell() {
  const { items, unreadCount, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus() }
    }
    const onClick = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick) }
  }, [open])

  const recent = items.slice(0, 8)

  return (
    <div className="ntf-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        className="icon-button ntf-bell"
        aria-label={`Notifikasi${unreadCount ? `, ${unreadCount} belum dibaca` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={20} />
        {unreadCount > 0 && <span className="ntf-badge" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="ntf-popover" role="dialog" aria-label="Notifikasi">
          <div className="ntf-pop-head">
            <strong>Notifikasi</strong>
            <button className="ntf-link" onClick={() => { void markAllRead() }} disabled={unreadCount === 0}><CheckCheck size={14} /> Tandai semua dibaca</button>
          </div>
          <div className="ntf-pop-body">
            <NotificationList items={recent} onNavigate={() => setOpen(false)} />
          </div>
          <Link className="ntf-pop-foot" to="/notifications" onClick={() => setOpen(false)}>Lihat semua notifikasi</Link>
        </div>
      )}
    </div>
  )
}
