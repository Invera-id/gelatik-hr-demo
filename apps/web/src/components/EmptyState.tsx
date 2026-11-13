import { Inbox } from 'lucide-react'

export function EmptyState({ title = 'Belum ada data', description = 'Data akan muncul di sini ketika tersedia.' }: { title?: string; description?: string }) {
  return <div className="empty-state"><Inbox size={28} /><strong>{title}</strong><span>{description}</span></div>
}

