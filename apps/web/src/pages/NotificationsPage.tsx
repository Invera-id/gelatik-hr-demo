import { Bell, CheckCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { NotificationList } from '../components/NotificationList'
import { useNotifications } from '../context/NotificationContext'
import { dataSource } from '../config/dataSource'
import { useApiResource } from '../hooks/useApiResource'
import type { NotificationRecord } from '../lib/notifications/types'

const PAGE_SIZE = 20

export function NotificationsPage() {
  const { items, unreadCount, total, markAllRead } = useNotifications()
  const [tab, setTab] = useState<'ALL' | 'UNREAD'>('ALL')
  const [page, setPage] = useState(1)

  const filtered = useMemo(
    () => items.filter((item) => tab === 'ALL' || !item.readAt),
    [items, tab],
  )
  // API mode pages on the server: the context only holds the newest 100.
  const server = dataSource === 'api'
  const res = useApiResource<{ items: NotificationRecord[]; total: number }>('/notifications', {
    limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, unread: tab === 'UNREAD' ? 'true' : undefined,
  }, server, `${unreadCount}|${total}|${items[0]?.id ?? ''}`)
  const filteredCount = server ? res.data?.total ?? 0 : filtered.length
  const pageCount = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const paged = server ? res.data?.items ?? [] : filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <>
      <PageHeader
        eyebrow="INBOX"
        title="Notifikasi"
        description="Pemberitahuan untuk perubahan bisnis yang relevan dengan akses Anda."
        actions={<button className="button secondary" onClick={() => { void markAllRead() }} disabled={unreadCount === 0}><CheckCheck size={16} /> Tandai semua dibaca</button>}
      />
      <section className="card filter-card">
        <div className="employee-view-tabs" role="tablist" aria-label="Filter status">
          <button role="tab" aria-selected={tab === 'ALL'} className={tab === 'ALL' ? 'selected' : ''} onClick={() => { setTab('ALL'); setPage(1) }}>Semua <strong>{total}</strong></button>
          <button role="tab" aria-selected={tab === 'UNREAD'} className={tab === 'UNREAD' ? 'selected' : ''} onClick={() => { setTab('UNREAD'); setPage(1) }}>Belum dibaca <strong>{unreadCount}</strong></button>
        </div>
      </section>
      <section className="card table-card">
        <div className="table-title"><div><span className="section-icon"><Bell size={18} /></span><div><h2>Daftar Notifikasi</h2><p>Klik item untuk membuka target terkait.</p></div></div><span className="record-count">{filteredCount} ITEM</span></div>
        <div className="ntf-page-list">
          {server && res.error ? <div className="alert error"><div><strong>Notifikasi tidak dapat dimuat</strong><p>{res.error}</p></div><button className="button ghost" onClick={res.reload}>Coba lagi</button></div>
            : server && res.loading && !res.data ? <p className="empty-inline">Memuat notifikasi…</p>
            : <NotificationList items={paged} emptyLabel={tab === 'UNREAD' ? 'Tidak ada notifikasi belum dibaca.' : 'Belum ada notifikasi.'} />}
        </div>
        {pageCount > 1 && (
          <div className="import-confirm">
            <p>Menampilkan {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredCount)} dari {filteredCount}</p>
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
