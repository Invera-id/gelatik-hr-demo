import { FileCheck2 } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Schemas } from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { allowedAreaIds } from '../config/access'
import { dataSource } from '../config/dataSource'
import { useDemo } from '../context/DemoContext'
import { useApiResource } from '../hooks/useApiResource'

type Gap = Schemas['EmployeeDocumentStatus']['items'][number]
type Status = 'ALL' | 'MISSING' | 'PENDING' | 'REJECTED'
const tabs: Array<[Status, string]> = [['ALL', 'Semua belum lengkap'], ['MISSING', 'Belum diunggah'], ['PENDING', 'Menunggu pemeriksaan'], ['REJECTED', 'Ditolak']]
const PAGE_SIZE = 100

const gapStatus = (gap: Gap): [Exclude<Status, 'ALL'>, string, 'warning' | 'info' | 'danger'] =>
  gap.rejected.length ? ['REJECTED', 'Ditolak — unggah ulang', 'danger'] : gap.missing.length ? ['MISSING', 'Belum diunggah', 'warning'] : ['PENDING', 'Menunggu pemeriksaan HR', 'info']

/** Active employees without an accepted PKWT. Warning only: validation is not blocked. */
export function DocumentQueuePage() {
  const { currentUser, areas, projects, employees, permissionConfig } = useDemo()
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') ?? 'ALL') as Status
  const areaId = params.get('areaId') ?? ''
  const page = Number(params.get('page') ?? '1') || 1
  const enabled = dataSource === 'api'
  const res = useApiResource<Schemas['EmployeeDocumentStatus']>('/documents/employee-status', { areaId }, enabled)
  const set = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.delete('page'); setParams(next) }
  if (!enabled) return <><PageHeader eyebrow="DOKUMEN" title="Kelengkapan PKWT" description="" /><EmptyState title="Membutuhkan backend" description="Dokumen disimpan di storage privat server dan tidak tersedia pada mode lokal." /></>
  const allowed = currentUser ? allowedAreaIds(currentUser, permissionConfig) : []
  const data = res.data
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]))
  const rows = (data?.items ?? []).filter((gap) => status === 'ALL' || gapStatus(gap)[0] === status)
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const count = (s: Status) => !data ? '' : s === 'ALL' ? data.incomplete : s === 'MISSING' ? data.missing : s === 'PENDING' ? data.pending : data.rejected
  return <>
    <PageHeader eyebrow="DOKUMEN" title="Kelengkapan PKWT" description="Karyawan aktif yang belum memiliki PKWT (kontrak kerja) yang diterima HR. Ini hanya peringatan: karyawan tetap dapat divalidasi. Unggah dan periksa PKWT dari halaman detail karyawan." />
    <section className="card table-card"><div className="table-title"><div><span className="section-icon"><FileCheck2 /></span><div><h2>PKWT belum lengkap</h2>
      <p>{data ? `${data.incomplete} dari ${data.monitored} karyawan aktif` : 'Hitungan: karyawan.'}</p></div></div><span className="record-count">{rows.length} KARYAWAN</span></div>
      <div className="project-filters"><div className="tabs">{tabs.map(([key, label]) => <button key={key} type="button" className={status === key ? 'active' : ''} onClick={() => set('status', key === 'ALL' ? '' : key)}>{label} {data && `(${count(key)})`}</button>)}</div>
        <label>Area<select value={areaId} onChange={(e) => set('areaId', e.target.value)}><option value="">Semua area dalam cakupan</option>{areas.filter((a) => allowed === null || allowed.includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
      {res.loading && !data ? <p className="empty-inline">Memuat…</p>
        : res.error ? <div className="alert error"><div><strong>Data PKWT tidak dapat dimuat</strong><p>{res.error}</p></div><button className="button ghost" onClick={res.reload}>Coba lagi</button></div>
        : rows.length === 0 ? <p className="empty-inline">{data?.monitored ? 'Semua karyawan pada filter ini sudah memiliki PKWT yang diterima.' : 'Belum ada data.'}</p>
        : <div className="table-scroll"><table><thead><tr><th>Karyawan</th><th>Penempatan</th><th>Status PKWT</th><th /></tr></thead><tbody>
          {shown.map((gap) => {
            const employee = employeeById.get(gap.employeeId)
            const [, label, tone] = gapStatus(gap)
            return <tr key={gap.employeeId}>
              <td><Link to={`/employees/${encodeURIComponent(gap.employeeId)}#documents`}><strong>{employee?.name ?? gap.employeeId}</strong></Link><small>{employee?.personnelId}</small></td>
              <td><strong>{areas.find((a) => a.id === employee?.areaId)?.name ?? '—'}</strong><small>{projects.find((p) => p.id === employee?.projectId)?.name ?? '—'} · {employee?.position ?? '—'}</small></td>
              <td><StatusBadge tone={tone}>{label}</StatusBadge></td>
              <td><Link className="button ghost" to={`/employees/${encodeURIComponent(gap.employeeId)}#documents`}>{gap.pending.length ? 'Periksa' : 'Unggah'}</Link></td></tr>
          })}
        </tbody></table></div>}
      {rows.length > PAGE_SIZE && <div className="form-actions"><button className="button ghost" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>Sebelumnya</button><span>Halaman {page} dari {Math.ceil(rows.length / PAGE_SIZE)}</span><button className="button ghost" disabled={page * PAGE_SIZE >= rows.length} onClick={() => set('page', String(page + 1))}>Berikutnya</button></div>}
    </section>
  </>
}
