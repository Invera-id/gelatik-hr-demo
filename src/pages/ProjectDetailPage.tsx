import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { useDemo } from '../context/DemoContext'
import { allowedAreaIds, hasPermission } from '../config/access'
import { currentPeriod, formatPercent, formatQuota, getProjectMetrics, getTerminationRows } from '../lib/projectAnalytics'

type Tab = 'OVERVIEW' | 'WORKFORCE' | 'MONTHLY' | 'TERMINATION'
const tabs: Array<[Tab, string]> = [['OVERVIEW', 'Overview'], ['WORKFORCE', 'Workforce'], ['MONTHLY', 'Monthly Analytics'], ['TERMINATION', 'Termination Analytics']]

export function ProjectDetailPage() {
  const { projectId } = useParams()
  const source = useDemo()
  const { currentUser, areas, permissionConfig, projects, employees, saveProjectQuota } = source
  const project = projects.find((item) => item.id === projectId)
  const allowed = currentUser ? allowedAreaIds(currentUser, permissionConfig) : []
  const [tab, setTab] = useState<Tab>('OVERVIEW')
  const [period, setPeriod] = useState(currentPeriod)
  const [expanded, setExpanded] = useState(false)
  const [quotaInput, setQuotaInput] = useState(() => project ? String(getProjectMetrics(source, project, period).quota) : '0')
  if (!project || (allowed !== null && !allowed.includes(project.areaId))) return <Navigate to="/projects" replace />
  const metrics = getProjectMetrics(source, project, period)
  const members = employees.filter((employee) => employee.projectId === project.id)
  const term = getTerminationRows(source, [project])[0]
  const canManageQuota = Boolean(currentUser && hasPermission(currentUser, permissionConfig, 'manage_project_quota'))
  const saveQuota = () => {
    const quota = Number(quotaInput)
    if (!Number.isFinite(quota) || quota < 0) return
    saveProjectQuota({ id: `quota-${project.id}-${period}`, projectId: project.id, period, quota })
  }
  const card = (label: string, value: string | number, note?: string) => <article className="card project-metric" key={label}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>
  return <>
    <Link className="back-link" to="/projects">← Kembali ke Projects</Link>
    <PageHeader eyebrow="PROJECT DETAIL" title={project.name} description={`${project.clientName} · ${areas.find((area) => area.id === project.areaId)?.name ?? 'Area belum tersedia'} · ${project.status === 'ACTIVE' ? 'Aktif' : 'Tidak Aktif'}`} />
    <div className="employee-view-tabs" role="tablist" aria-label="Project detail tabs">{tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>
    {tab === 'OVERVIEW' && <><section className="card project-overview"><div><span>CLIENT</span><strong>{project.clientName}</strong></div><div><span>AREA / SUB AREA</span><strong>{areas.find((area) => area.id === project.areaId)?.name} / {project.subArea ?? 'Belum Diisi'}</strong></div><div><span>PERIODE PROJECT</span><strong>{project.startDate ?? 'N/A'} — {project.endDate ?? 'Berjalan'}</strong></div></section><p className="analytics-note">Quota adalah jumlah Personnel ID unik pada awal {period}. Active Employee adalah snapshot akhir bulan.</p><div className="project-metric-grid">{card('Active Employee', metrics.active)}{card('Quota', formatQuota(metrics), 'Count Personnel ID unik')}{card('Vacant', metrics.vacant, 'Exit bulan ini yang belum terpenuhi')}{card('Fulfilled', metrics.fulfilled)}</div></>}
    {tab === 'WORKFORCE' && <section className="card table-card"><div className="table-title"><div><h2>Workforce Project</h2><p>{members.length} employee pada current placement</p></div></div><div className="table-scroll"><table><thead><tr><th>ID Personil</th><th>Nama</th><th>Position</th><th>Status</th><th>Join Date</th></tr></thead><tbody>{members.map((employee) => <tr key={employee.id}><td><Link to={`/employees/${employee.id}`}>{employee.personnelId}</Link></td><td>{employee.name}</td><td>{employee.position ?? 'Belum Diisi'}</td><td>{employee.employmentStatus === 'ACTIVE' ? 'Aktif' : 'Tidak Aktif'}</td><td>{employee.joinDate ?? 'N/A'}</td></tr>)}</tbody></table></div></section>}
    {tab === 'MONTHLY' && <><section className="card project-period"><label>Periode<input aria-label="Periode analitik" type="month" value={period} onChange={(event) => { setPeriod(event.target.value); setQuotaInput(String(getProjectMetrics(source, project, event.target.value).quota)) }} /></label>{canManageQuota && <label>Quota bulanan<input aria-label="Quota bulanan" type="number" min="0" value={quotaInput} onChange={(event) => setQuotaInput(event.target.value)} /></label>}{canManageQuota && <button className="button secondary" onClick={saveQuota}>Simpan Quota</button>}</section><div className="project-metric-grid">{card('Quota', formatQuota(metrics), metrics.quotaSource === 'MANUAL' ? 'Quota dikonfigurasi' : 'Count Personnel ID unik pada awal bulan')}{card('Active Employee', metrics.active, 'Snapshot akhir bulan')}{card('New Hire', metrics.newHire)}{card('Turnover', metrics.turnover)}{card('Turnover %', formatPercent(metrics.turnoverRate), 'Turnover ÷ quota')}{card('Vacant', metrics.vacant)}{card('Fulfilled', metrics.fulfilled)}{card('Average Gap', metrics.averageGap === null ? 'N/A' : `${metrics.averageGap.toFixed(1)} hari`)}{card('Over SLA', metrics.overSla)}</div><p className="analytics-note">Index tetap N/A bila Turnover % periode sebelumnya 0%.</p></>}
    {tab === 'TERMINATION' && <section className="card table-card"><div className="table-title"><div><h2>Pengakhiran Perjanjian</h2><p>Berdasarkan field pada Master Employee.</p></div></div><div className="table-scroll"><table><thead><tr><th>Area</th><th>Client</th><th>Project</th><th>TIDAK</th><th>YA</th><th>Belum Diisi</th><th>Total</th></tr></thead><tbody><tr onClick={() => setExpanded(!expanded)} className="clickable-row"><td>{areas.find((area) => area.id === project.areaId)?.name}</td><td>{project.clientName}</td><td>{project.name}</td><td>{term.no.length}</td><td>{term.yes.length}</td><td>{term.notSet.length}</td><td>{term.total} ▾</td></tr></tbody></table></div>{expanded && <div className="project-member-list">{members.map((employee) => <Link key={employee.id} to={`/employees/${employee.id}`}>{employee.personnelId} · {employee.name} <strong>{employee.profile?.agreementTermination ?? 'Belum Diisi'}</strong></Link>)}</div>}</section>}
  </>
}
