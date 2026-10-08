import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, GitCompareArrows, ShieldQuestion } from 'lucide-react'
import { useDemo } from '../context/DemoContext'
import { canReviewImportItem, formatDate } from '../lib/businessRules'
import { StatusBadge } from './StatusBadge'
import type { EmployeeMovementType } from '../types'
import type { ReviewDecision, ReviewItem, SourceImportRecord } from '../lib/import/types'

const KIND_LABEL: Record<string, string> = {
  IDENTICAL_DUPLICATE: 'Duplikasi identik',
  PROFILE_VARIATION: 'Variasi profil',
  PLACEMENT_CHANGE: 'Perubahan penempatan',
  EXIT: 'Catatan exit',
  REENTRY: 'Re-entry',
  IDENTITY_CONFLICT: 'Konflik identitas',
  UNDETERMINED: 'Belum dapat ditentukan',
}

/** The interpretations a reviewer can pick, mapped to a concrete decision. */
type Interp =
  | 'IDENTICAL' | 'CORRECTION' | 'PROFILE' | 'MUTATION'
  | 'PLACEMENT_END' | 'COMPANY_EXIT' | 'REENTRY' | 'IDENTITY' | 'PENDING'

const INTERP_OPTIONS: Array<{ value: Interp; label: string }> = [
  { value: 'MUTATION', label: 'Mutasi / perubahan penempatan' },
  { value: 'PLACEMENT_END', label: 'Akhir penempatan (masih bekerja)' },
  { value: 'COMPANY_EXIT', label: 'Exit perusahaan' },
  { value: 'REENTRY', label: 'Re-entry' },
  { value: 'PROFILE', label: 'Perubahan profil' },
  { value: 'CORRECTION', label: 'Koreksi data' },
  { value: 'IDENTICAL', label: 'Duplikasi identik' },
  { value: 'IDENTITY', label: 'Konflik identitas (jangan gabung)' },
  { value: 'PENDING', label: 'Belum dapat ditentukan — tetap pending' },
]

const MOVEMENT_TYPES: EmployeeMovementType[] = ['MUTATION', 'AREA_CHANGE', 'PROJECT_CHANGE', 'POSITION_CHANGE', 'PROMOTION']

/** Business fields shown in the side-by-side comparison, labeled for humans. */
const FIELD_LABELS: Array<[string, string]> = [
  ['areaCbs', 'Area CBS'], ['subArea', 'Sub Area'], ['projectName', 'Project'], ['clientName', 'Client'],
  ['position', 'Posisi'], ['outlet', 'Outlet'], ['mutationDate', 'Tgl Mutasi'], ['joinDate', 'Tgl Bergabung'],
  ['contractEndDate', 'Tgl Berakhir Kontrak'], ['exitDate', 'Tgl Keluar'], ['exitReason', 'Alasan Keluar'],
  ['mobilePhone', 'Handphone'], ['homePhone', 'Telp Rumah'], ['ktpAddress', 'Alamat KTP'], ['nationalId', 'NoKTP'],
]

function ReviewCard({ item, records }: { item: ReviewItem; records: SourceImportRecord[] }) {
  const { resolveReviewItem } = useDemo()
  const [interp, setInterp] = useState<Interp>(
    item.kind === 'IDENTITY_CONFLICT' ? 'IDENTITY' : item.aspects.includes('PLACEMENT_CHANGE') ? 'MUTATION' : item.aspects.includes('EXIT') ? 'COMPANY_EXIT' : 'CORRECTION',
  )
  const [movementType, setMovementType] = useState<EmployeeMovementType>('MUTATION')
  const [effectiveDate, setEffectiveDate] = useState<string>(item.dates[0]?.value ?? '')
  const [beforeId, setBeforeId] = useState<string>(records[0]?.id ?? '')
  const [afterId, setAfterId] = useState<string>(records[1]?.id ?? records[0]?.id ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Fields that actually differ across the involved records, for the comparison grid.
  const rows = useMemo(
    () => FIELD_LABELS.filter(([key]) => item.diffFields.includes(key) || records.some((r) => r.fields[key])),
    [item.diffFields, records],
  )

  const submit = async () => {
    const decision: ReviewDecision = { decisionKind: 'PROFILE_VARIATION', note: note.trim() }
    switch (interp) {
      case 'PENDING': decision.keepPending = true; break
      case 'IDENTICAL': decision.decisionKind = 'IDENTICAL_DUPLICATE'; break
      case 'PROFILE': case 'CORRECTION': decision.decisionKind = 'PROFILE_VARIATION'; break
      case 'IDENTITY': decision.decisionKind = 'IDENTITY_CONFLICT'; break
      case 'MUTATION':
        decision.decisionKind = 'PLACEMENT_CHANGE'
        decision.movementType = movementType
        decision.effectiveDate = effectiveDate || null
        decision.beforeRecordId = beforeId
        decision.afterRecordId = afterId
        break
      case 'PLACEMENT_END':
        decision.decisionKind = 'EXIT'; decision.exitScope = 'PLACEMENT_END'; decision.effectiveDate = effectiveDate || null
        break
      case 'COMPANY_EXIT':
        decision.decisionKind = 'EXIT'; decision.exitScope = 'EMPLOYMENT_END'; decision.effectiveDate = effectiveDate || null
        break
      case 'REENTRY':
        decision.decisionKind = 'REENTRY'; decision.effectiveDate = effectiveDate || null; decision.afterRecordId = afterId
        break
    }
    setBusy(true)
    await resolveReviewItem(item.id, decision)
    setBusy(false)
  }

  const needsMovementDetail = interp === 'MUTATION' || interp === 'REENTRY'
  const needsDate = needsMovementDetail || interp === 'PLACEMENT_END' || interp === 'COMPANY_EXIT'

  return (
    <article className="card review-item">
      <div className="review-item-head">
        <div>
          <strong>{item.personnelName}</strong>
          <span className="review-pid">{item.personnelId}</span>
        </div>
        <div className="review-tags">
          {item.aspects.map((a) => <StatusBadge key={a} tone={a === 'EXIT' ? 'danger' : a === 'PLACEMENT_CHANGE' ? 'info' : a === 'IDENTITY_CONFLICT' ? 'warning' : 'purple'}>{KIND_LABEL[a] ?? a}</StatusBadge>)}
          <span className="review-count">{records.length} catatan berbeda</span>
        </div>
      </div>

      <p className="review-reason"><ShieldQuestion size={14} /> {item.reason}</p>
      {item.candidate && <p className="review-candidate"><em>Kandidat interpretasi (belum dikonfirmasi):</em> {item.candidate.label}</p>}

      <div className="table-scroll">
        <table className="review-compare">
          <thead>
            <tr>
              <th>Field</th>
              {records.map((r, i) => <th key={r.id}>Catatan {i + 1} · baris {r.rowNumber}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, label]) => {
              const values = records.map((r) => r.fields[key] ?? '—')
              const differs = new Set(values.filter((v) => v !== '—')).size > 1
              return (
                <tr key={key} className={differs ? 'differs' : ''}>
                  <td>{label}</td>
                  {values.map((v, i) => <td key={i}>{v}</td>)}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {item.dates.length > 0 && (
        <div className="review-dates">
          {item.dates.map((d, i) => <span key={i}>{d.label}: <strong>{d.value ? formatDate(d.value) : '—'}</strong></span>)}
        </div>
      )}

      <div className="review-form">
        <label>Interpretasi
          <select value={interp} onChange={(e) => setInterp(e.target.value as Interp)}>
            {INTERP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {interp === 'MUTATION' && (
          <label>Jenis
            <select value={movementType} onChange={(e) => setMovementType(e.target.value as EmployeeMovementType)}>
              {MOVEMENT_TYPES.map((m) => <option key={m} value={m}>{m.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
        )}
        {needsMovementDetail && (
          <>
            <label>Kondisi sebelum
              <select value={beforeId} onChange={(e) => setBeforeId(e.target.value)}>
                {records.map((r, i) => <option key={r.id} value={r.id}>Catatan {i + 1} (baris {r.rowNumber})</option>)}
              </select>
            </label>
            <label>Kondisi sesudah
              <select value={afterId} onChange={(e) => setAfterId(e.target.value)}>
                {records.map((r, i) => <option key={r.id} value={r.id}>Catatan {i + 1} (baris {r.rowNumber})</option>)}
              </select>
            </label>
          </>
        )}
        {needsDate && (
          <label>Tanggal efektif
            <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          </label>
        )}
        <label className="review-note">Catatan peninjauan
          <input type="text" value={note} placeholder="Alasan / catatan (opsional)" onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="button primary" disabled={busy} onClick={submit}>
          <GitCompareArrows size={16} /> {interp === 'PENDING' ? 'Simpan sebagai pending' : 'Konfirmasi keputusan'}
        </button>
      </div>
    </article>
  )
}

/** The import review queue (§8): one card per pending item the current user may review. */
export function ImportReviewQueue() {
  const { currentUser, permissionConfig, importReviewItems, importSourceRecords } = useDemo()
  const pending = useMemo(
    () => importReviewItems.filter((r) => r.status === 'PENDING' && currentUser && canReviewImportItem(currentUser, permissionConfig, r)),
    [importReviewItems, currentUser, permissionConfig],
  )
  const recordsFor = (item: ReviewItem) =>
    item.recordIds.map((id) => importSourceRecords.find((s) => s.id === id)).filter(Boolean) as SourceImportRecord[]

  if (!currentUser) return null
  if (pending.length === 0) {
    return (
      <section className="card">
        <div className="section-heading"><GitCompareArrows /><h2>Antrean Peninjauan Riwayat</h2></div>
        <div className="empty-inline">Tidak ada catatan riwayat yang perlu ditinjau.</div>
      </section>
    )
  }

  return (
    <section className="review-queue">
      <div className="alert warning">
        <AlertTriangle />
        <div>
          <strong>{pending.length} catatan perlu ditinjau</strong>
          <p>Beberapa personil punya lebih dari satu catatan berbeda. Tentukan apakah itu duplikasi, perubahan penempatan, exit, atau re-entry. Belum ada status yang diubah sampai Anda konfirmasi. <Link to="/employees">Lihat personil →</Link></p>
        </div>
      </div>
      {pending.map((item) => <ReviewCard key={item.id} item={item} records={recordsFor(item)} />)}
    </section>
  )
}
