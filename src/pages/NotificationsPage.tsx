import { Bell, CheckCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { NotificationList } from '../components/NotificationList'
import { useNotifications } from '../context/NotificationContext'
import type { NotificationCategory } from '../lib/notifications/types'

const CATEGORY_LABELS: Record<NotificationCategory | 'ALL', string> = {
  ALL: 'Semua kategori',
  VALIDATION_REQUEST: 'Permintaan validasi',
  VALIDATION_RESULT: 'Hasil validasi',
  EXIT: 'Exit',
  MOVEMENT: 'Movement',
  REPLACEMENT: 'Replacement',
  IMPORT: 'Impor',
  CONTRACT: 'Kontrak',
  SLA: 'SLA',
  PERSONNEL: 'Personil',
  ADMIN: 'Administrasi',
}

const PAGE_SIZE = 20

export function NotificationsPage() {
  const { items, unreadCount, markAllRead } = useNotifications()
  const [tab, setTab] = useState<'ALL' | 'UNREAD'>('ALL')
  const [category, setCategory] = useState<NotificationCategory | 'ALL'>('ALL')
  const [page, setPage] = useState(1)

  const filtered = useMemo(
    () => items.filter((item) => (tab === 'ALL' || !item.readAt) && (category === 'ALL' || item.category === category)),
    [items, tab, category],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <>
      <PageHeader
        eyebrow="INBOX"
        title="Notifikasi"
        description="Pemberitahuan untuk perubahan bisnis yang relevan dengan akses Anda."
        actions={<button className="button secondary" onClick={markAllRead} disabled={unreadCount === 0}><CheckCheck size={16} /> Tandai semua dibaca</button>}
      />
      <section className="card filter-card">
        <div className="employee-view-tabs" role="tablist" aria-label="Filter status">
          <button role="tab" aria-selected={tab === 'ALL'} className={tab === 'ALL' ? 'selected' : ''} onClick={() => { setTab('ALL'); setPage(1) }}>Semua <strong>{items.length}</strong></button>
          <button role="tab" aria-selected={tab === 'UNREAD'} className={tab === 'UNREAD' ? 'selected' : ''} onClick={() => { setTab('UNREAD'); setPage(1) }}>Belum dibaca <strong>{unreadCount}</strong></button>
        </div>
        <div className="filter-selects">
          <select aria-label="Filter kategori" value={category} onChange={(event) => { setCategory(event.target.value as NotificationCategory | 'ALL'); setPage(1) }}>
            {(Object.keys(CATEGORY_LABELS) as Array<NotificationCategory | 'ALL'>).map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}
          </select>
        </div>
      </section>
      <section className="card table-card">
        <div className="table-title"><div><span className="section-icon"><Bell size={18} /></span><div><h2>Daftar Notifikasi</h2><p>Klik item untuk membuka target terkait.</p></div></div><span className="record-count">{filtered.length} ITEM</span></div>
        <div className="ntf-page-list">
          <NotificationList items={paged} emptyLabel={tab === 'UNREAD' ? 'Tidak ada notifikasi belum dibaca.' : 'Belum ada notifikasi.'} />
        </div>
        {pageCount > 1 && (
          <div className="import-confirm">
            <p>Menampilkan {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} dari {filtered.length}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="button secondary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Sebelumnya</button>
              <button className="button secondary" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Berikutnya</button>
            </div>
          </div>
        )}
      </section>
    </>
  )
}
