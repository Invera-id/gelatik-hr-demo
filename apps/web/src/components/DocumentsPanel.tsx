import { Download, FileCheck2, FileText, History, Upload } from 'lucide-react'
import { useState, type ChangeEvent } from 'react'
import { download, errorMessage, request, type Schemas } from '../api/client'
import { documentTransactionLabels, hasPermission } from '../config/access'
import { useDemo } from '../context/DemoContext'
import { useApiResource } from '../hooks/useApiResource'
import { formatDate, validationLabels } from '../lib/businessRules'
import { ActionError } from './ActionError'
import { StatusBadge } from './StatusBadge'
import type { BadgeTone } from './statusTones'

type Subject = Schemas['SubjectDocuments']
type Slot = Schemas['DocumentSlot']

const documentStatusLabels: Record<Slot['status'], string> = {
  MISSING: 'Belum diunggah',
  PENDING_REVIEW: 'Menunggu pemeriksaan',
  ACCEPTED: 'Diterima',
  REJECTED: 'Ditolak — perlu diperbaiki',
}
const documentTone = (status: string): BadgeTone => status === 'ACCEPTED' ? 'success' : status === 'REJECTED' ? 'danger' : status === 'PENDING_REVIEW' ? 'info' : 'warning'

const kb = (bytes: number) => bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/**
 * Documents for every validation subject of one employee (entry + change requests).
 * Upload never approves: each new file is a new version waiting for review, and the
 * server rejects final validation until every required document is accepted.
 */
export function DocumentsPanel({ employeeId }: { employeeId: string }) {
  const { currentUser, permissionConfig } = useDemo()
  const res = useApiResource<{ subjects: Subject[] }>(`/employees/${encodeURIComponent(employeeId)}/documents`)
  const catalog = useApiResource<Schemas['DocumentCatalog']>('/documents/catalog')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const can = (p: Parameters<typeof hasPermission>[2]) => Boolean(currentUser && hasPermission(currentUser, permissionConfig, p))
  const canUpload = can('upload_documents'), canReview = can('review_documents')

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError('')
    try { await fn(); res.reload() } catch (e) { setError(errorMessage(e)) } finally { setBusy(null) }
  }
  const upload = (subject: Subject, slot: Slot) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const max = catalog.data?.maxBytes
    if (max && file.size > max) { setError(`Ukuran file melebihi batas ${kb(max)}.`); return }
    const form = new FormData()
    form.append('file', file)
    void act(`up:${subject.subjectId}:${slot.documentTypeCode}`, () => request(`/documents/subjects/${subject.subjectType}/${encodeURIComponent(subject.subjectId)}/${encodeURIComponent(slot.documentTypeCode)}`, { method: 'POST', form }))
  }
  const review = (id: string, status: 'ACCEPTED' | 'REJECTED') => {
    const note = (notes[id] ?? '').trim()
    if (status === 'REJECTED' && !note) { setError('Isi alasan penolakan agar pengaju dapat memperbaiki dokumen.'); return }
    void act(`rv:${id}`, () => request(`/documents/versions/${encodeURIComponent(id)}/review`, { method: 'POST', body: { status, note } }))
  }
  const open = (v: Schemas['DocumentVersion']) => void act(`dl:${v.id}`, () => download(`/documents/versions/${encodeURIComponent(v.id)}/content`))
  const canOpen = canUpload || canReview

  // The PKWT (employee document) is always shown; submission subjects only when they
  // require a document or already hold files.
  const subjects = (res.data?.subjects ?? []).filter((s) => s.subjectType === 'PERSONNEL' || s.slots.some((slot) => slot.required || slot.current || slot.history.length > 0))
    .map((s) => s.subjectType === 'PERSONNEL' ? s : { ...s, slots: s.slots.filter((slot) => slot.required || slot.current || slot.history.length > 0) })
  const accept = catalog.data ? catalog.data.allowedTypes.map((t) => t === 'application/pdf' ? '.pdf' : t === 'image/png' ? '.png' : '.jpg,.jpeg').join(',') : undefined

  return <section className="card timeline-card" id="documents"><div className="section-heading"><FileCheck2 /><h2>Dokumen Pengajuan</h2></div>
    <p className="rule-note compact-note">PKWT (kontrak kerja) dapat diunggah kapan saja; selama belum diterima HR, karyawan diberi peringatan, tetapi validasi tidak terhalang. Validasi akhir ditolak server sampai setiap dokumen wajib berstatus Diterima. Mengunggah file tidak berarti dokumen disetujui.{catalog.data && ` Format: ${accept?.replaceAll(',', ', ')}; maks. ${kb(catalog.data.maxBytes)}.`}</p>
    <ActionError message={error} />
    {res.loading && !res.data ? <p className="empty-inline">Memuat dokumen…</p>
      : res.error ? <div className="alert error"><div><strong>Dokumen tidak dapat dimuat</strong><p>{res.error}</p></div><button className="button ghost" onClick={res.reload}>Coba lagi</button></div>
      : subjects.length === 0 ? <p className="empty-inline">Belum ada dokumen.</p>
      : subjects.map((subject) => <div key={subject.subjectId} className="review-item">
        <div className="review-item-head"><div><strong>{documentTransactionLabels[subject.transactionType]}</strong><small> · {subject.subjectType === 'PERSONNEL' ? 'dapat diunggah kapan saja' : validationLabels[subject.subjectStatus]}{subject.locked ? ' · terkunci (sudah divalidasi)' : ''}</small></div>
          <StatusBadge tone={subject.complete ? 'success' : 'warning'}>{subject.slots.some((s) => s.required) ? (subject.complete ? 'Dokumen wajib lengkap' : `${Object.keys(subject.blockers).length} dokumen wajib belum diterima${subject.subjectType === 'PERSONNEL' ? ' (peringatan)' : ''}`) : 'Tidak ada dokumen wajib'}</StatusBadge></div>
        <div className="table-scroll"><table><thead><tr><th>Jenis dokumen</th><th>Status</th><th>File terbaru</th><th>Tindakan</th></tr></thead><tbody>
          {subject.slots.map((slot) => { const cur = slot.current; return <tr key={slot.documentTypeCode}>
            <td><strong>{slot.name}</strong><small>{slot.required ? 'Wajib' : 'Opsional'} · {slot.documentTypeCode}</small></td>
            <td><StatusBadge tone={documentTone(slot.status)}>{documentStatusLabels[slot.status]}</StatusBadge>{cur?.reviewStatus === 'REJECTED' && <small className="missing-text">Alasan: {cur.reviewNote}</small>}</td>
            <td>{cur ? <><strong>{cur.originalName}</strong><small>Versi {cur.version} · {kb(cur.sizeBytes)} · {formatDate(cur.uploadedAt, true)}</small></> : <small className="missing-text">Belum ada file</small>}
              {slot.history.length > 0 && <details><summary><History size={13} /> {slot.history.length} versi sebelumnya</summary>{slot.history.map((h) => <small key={h.id}>v{h.version} · {h.originalName} · {documentStatusLabels[h.reviewStatus]}{h.reviewNote ? ` (${h.reviewNote})` : ''} · diganti {formatDate(h.supersededAt, true)}</small>)}</details>}</td>
            <td><div className="validation-actions">
              {cur && canOpen && <button className="button ghost" disabled={busy !== null} onClick={() => open(cur)}><Download size={15} /> Unduh</button>}
              {canUpload && !subject.locked && <label className="button secondary"><Upload size={15} /> {cur ? 'Ganti file' : 'Unggah'}<input type="file" hidden accept={accept} disabled={busy !== null} onChange={upload(subject, slot)} /></label>}
              {canReview && !subject.locked && cur?.reviewStatus === 'PENDING_REVIEW' && <>
                <input aria-label="Alasan penolakan" placeholder="Alasan jika ditolak" value={notes[cur.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [cur.id]: e.target.value }))} />
                <button className="button primary" disabled={busy !== null} onClick={() => review(cur.id, 'ACCEPTED')}><FileText size={15} /> Terima</button>
                <button className="button ghost" disabled={busy !== null} onClick={() => review(cur.id, 'REJECTED')}>Tolak</button></>}
            </div></td></tr> })}
        </tbody></table></div></div>)}
  </section>
}
