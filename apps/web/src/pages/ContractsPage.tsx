import { CalendarClock, Save } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { errorMessage, request, type Schemas } from '../api/client'
import { ActionError } from '../components/ActionError'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import type { BadgeTone } from '../components/statusTones'
import { allowedAreaIds, hasPermission } from '../config/access'
import { dataSource } from '../config/dataSource'
import { useDemo } from '../context/DemoContext'
import { useApiResource } from '../hooks/useApiResource'
import { contractLabels, formatDate } from '../lib/businessRules'

type State = Schemas['ContractState']
const tabs = [['ACTION', 'Perlu tindakan'], ['EXPIRING', 'Akan berakhir'], ['EXPIRED', 'Sudah berakhir'], ['INCOMPLETE', 'Data kontrak belum lengkap'], ['ALL', 'Semua']] as const
const stateTone = (s: State['status']): BadgeTone => s === 'EXPIRED' ? 'danger' : s === 'EXPIRING' ? 'warning' : s === 'INCOMPLETE' ? 'neutral' : 'success'

const contractStateText = (st: State): string => {
  switch (st.status) {
    case 'EXPIRED': return `Sudah berakhir ${Math.abs(st.daysRemaining ?? 0)} hari lalu`
    case 'EXPIRING': return st.daysRemaining === 0 ? 'Berakhir hari ini' : `Berakhir dalam ${st.daysRemaining} hari (ambang ${st.reminderThreshold} hari)`
    case 'INCOMPLETE': return `Data kontrak belum lengkap: ${st.incompleteReason ?? ''}`
    default: return 'Aktif, di luar ambang pengingat'
  }
}

const span = (days: number | null) => days === null ? 'Belum tersedia' : days >= 365 ? `${Math.floor(days / 365)} th ${Math.floor((days % 365) / 30)} bln` : days >= 30 ? `${Math.floor(days / 30)} bln ${days % 30} hr` : `${days} hari`

function ThresholdForm({ settings, onSaved }: { settings: Schemas['ContractSettings']; onSaved: () => void }) {
  const [value, setValue] = useState(settings.reminderDays.join(', '))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
    if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) { setError('Isi angka hari dipisahkan koma, contoh: 30, 14, 7.'); return }
    setSaving(true); setError('')
    try { await request('/settings/contract-monitoring', { method: 'PUT', body: { reminderDays: parts.map(Number) } }); onSaved() } catch (e) { setError(errorMessage(e)) } finally { setSaving(false) }
  }
  return <form className="card form-card" onSubmit={submit}><div className="form-section-title"><span className="section-icon"><CalendarClock /></span><div><h2>Ambang pengingat kontrak</h2><p>Berlaku untuk seluruh perusahaan (tidak ada pengaturan per area/project). 1–5 nilai, masing-masing 1–366 hari sebelum tanggal berakhir kontrak.</p></div></div>
    <ActionError message={error} />
    <div className="form-grid"><label>Hari sebelum berakhir<input value={value} inputMode="numeric" onChange={(e) => setValue(e.target.value)} placeholder="30, 14, 7" aria-invalid={Boolean(error)} /></label></div>
    <div className="form-actions"><button className="button primary" disabled={saving}><Save size={16} /> Simpan ambang</button></div></form>
}

export function ContractsPage() {
  const { currentUser, areas, projects, permissionConfig } = useDemo()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'ACTION'
  const areaId = params.get('areaId') ?? ''
  const page = Number(params.get('page') ?? '1') || 1
  const enabled = dataSource === 'api'
  const res = useApiResource<Schemas['ContractMonitoring']>('/contracts/monitoring', { status, areaId, page, pageSize: 50 }, enabled)
  const set = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.delete('page'); setParams(next) }
  if (!enabled) return <><PageHeader eyebrow="MONITORING" title="Monitoring Kontrak" description="" /><EmptyState title="Membutuhkan backend" description="Monitoring kontrak dihitung di server dan tidak tersedia pada mode lokal." /></>
  const allowed = currentUser ? allowedAreaIds(currentUser, permissionConfig) : []
  const canManage = Boolean(currentUser && hasPermission(currentUser, permissionConfig, 'manage_contract_monitoring'))
  const data = res.data
  const areaName = (id: string | null) => areas.find((a) => a.id === id)?.name ?? '—'
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? '—'
  return <>
    <PageHeader eyebrow="MONITORING" title="Monitoring Kontrak" description="Status dihitung server hanya dari tanggal berakhir kontrak yang tercatat dan ambang pengingat. Tanggal akhir tidak pernah dihitung otomatis dari tanggal mulai." />
    {data && <div className="rule-note compact-note">Tanggal bisnis {formatDate(data.businessDate)} (Asia/Jakarta) · Ambang pengingat: {data.settings.reminderDays.join(' / ')} hari · {data.summary.monitored} personel aktif & tervalidasi dipantau (satu kontrak berjalan per personel). Masa kerja dihitung dari Join Date dan berbeda dari durasi kontrak.</div>}
    {canManage && data && <ThresholdForm key={data.settings.reminderDays.join()} settings={data.settings} onSaved={res.reload} />}
    <section className="card table-card"><div className="table-title"><div><span className="section-icon"><CalendarClock /></span><div><h2>Daftar kontrak</h2><p>Hitungan: personel.</p></div></div><span className="record-count">{data?.total ?? 0} PERSONEL</span></div>
      <div className="project-filters"><div className="tabs">{tabs.map(([key, label]) => <button key={key} type="button" className={status === key ? 'active' : ''} onClick={() => set('status', key)}>{label}{data && key !== 'ACTION' && key !== 'ALL' && ` (${key === 'EXPIRING' ? data.summary.expiring : key === 'EXPIRED' ? data.summary.expired : data.summary.incomplete})`}</button>)}</div>
        <label>Area<select value={areaId} onChange={(e) => set('areaId', e.target.value)}><option value="">Semua area dalam cakupan</option>{areas.filter((a) => allowed === null || allowed.includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
      {res.loading && !data ? <p className="empty-inline">Memuat…</p>
        : res.error ? <div className="alert error"><div><strong>Data kontrak tidak dapat dimuat</strong><p>{res.error}</p></div><button className="button ghost" onClick={res.reload}>Coba lagi</button></div>
        : !data || data.items.length === 0 ? <p className="empty-inline">Belum ada data untuk filter ini.</p>
        : <div className="table-scroll"><table><thead><tr><th>Personel</th><th>Penempatan</th><th>Mulai – Berakhir kontrak</th><th>Durasi kontrak</th><th>Masa kerja</th><th>Status</th></tr></thead><tbody>
          {data.items.map((it) => <tr key={it.employeeId}>
            <td><Link to={`/employees/${it.employeeId}`}><strong>{it.name}</strong></Link><small>{it.personnelId} · {contractLabels[it.contractStatus]}</small></td>
            <td><strong>{areaName(it.areaId)}</strong><small>{projectName(it.projectId)} · {it.position ?? '—'}</small></td>
            <td>{formatDate(it.contractStartDate)} – <strong className={!it.contractEndDate ? 'missing-text' : ''}>{formatDate(it.contractEndDate)}</strong></td>
            <td>{span(it.state.contractDurationDays)}</td>
            <td>{span(it.state.tenureDays)}<small>sejak {formatDate(it.joinDate)}</small></td>
            <td><StatusBadge tone={stateTone(it.state.status)}>{contractStateText(it.state)}</StatusBadge></td></tr>)}
        </tbody></table></div>}
      {data && data.total > data.pageSize && <div className="form-actions"><button className="button ghost" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>Sebelumnya</button><span>Halaman {page} dari {Math.ceil(data.total / data.pageSize)}</span><button className="button ghost" disabled={page * data.pageSize >= data.total} onClick={() => set('page', String(page + 1))}>Berikutnya</button></div>}
    </section>
  </>
}
