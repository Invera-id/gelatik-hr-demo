import { useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { useDemo } from '../context/DemoContext'
import { areas } from '../data/demoData'
import { allowedAreaIds } from '../config/access'
import { formatPercent, getProjectMetrics, getTerminationRows } from '../lib/projectAnalytics'
import type { ProjectQuota } from '../types'

type Tab = 'OVERVIEW' | 'WORKFORCE' | 'MONTHLY' | 'TERMINATION'
const tabs: Array<[Tab, string]> = [['OVERVIEW', 'Overview'], ['WORKFORCE', 'Workforce'], ['MONTHLY', 'Monthly Analytics'], ['TERMINATION', 'Termination Analytics']]

export function ProjectDetailPage() {
  const { projectId } = useParams()
  const source = useDemo()
  const { currentUser, permissionConfig, projects, employees, saveProjectQuota } = source
  const project = projects.find((item) => item.id === projectId)
  const allowed = currentUser ? allowedAreaIds(currentUser, permissionConfig) : []
  const [tab, setTab] = useState<Tab>('OVERVIEW')
  const [period, setPeriod] = useState('2026-09')
  const [quotaValue, setQuotaValue] = useState('')
  const [expanded, setExpanded] = useState(false)
  if (!project || (allowed !== null && !allowed.includes(project.areaId))) return <Navigate to="/projects" replace />
  const metrics = getProjectMetrics(source, project, period)
  const members = employees.filter((employee) => employee.projectId === project.id)
  const term = getTerminationRows(source, [project])[0]
  const canManage = currentUser?.role === 'HR_HO' || currentUser?.role === 'SUPER_ADMIN'
  const saveQuota = (event: FormEvent) => {
    event.preventDefault()
    const quota = Number(quotaValue)
    if (!Number.isInteger(quota) || quota < 0) return
    const record: ProjectQuota = { id: `quota-${project.id}-${period}`, projectId: project.id, period, quota }
    saveProjectQuota(record)
    setQuotaValue('')
  }
  const card = (label: string, value: string | number, note?: string) => <article className="card project-metric" key={label}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>
  return <>
    <Link className="back-link" to="/projects">← Kembali ke Projects</Link>
    <PageHeader eyebrow="PROJECT DETAIL" title={project.name} description={`${project.clientName} · ${areas.find((area) => area.id === project.areaId)?.name ?? 'Area belum tersedia'} · ${project.status === 'ACTIVE' ? 'Aktif' : 'Tidak Aktif'}`} />
    <div className="employee-view-tabs" role="tablist" aria-label="Project detail tabs">{tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>
    {tab === 'OVERVIEW' && <><section className="card project-overview"><div><span>CLIENT</span><strong>{project.clientName}</strong></div><div><span>AREA / SUB AREA</span><strong>{areas.find((area) => area.id === project.areaId)?.name} / {project.subArea ?? 'Belum Diisi'}</strong></div><div><span>PERIODE PROJECT</span><strong>{project.startDate ?? 'N/A'} — {project.endDate ?? 'Berjalan'}</strong></div></section><p className="analytics-note">Active Employee adalah kondisi saat ini; New Hire dan Turnover mengikuti bulan terpilih.</p><div className="project-metric-grid">{card('Active Employee', metrics.active)}{card('Monthly Quota', metrics.quota ?? 'N/A')}{card('Vacant', metrics.vacant, 'Kebutuhan belum terpenuhi')}{card('Fulfilled', metrics.fulfilled)}</div></>}
    {tab === 'WORKFORCE' && <section className="card table-card"><div className="table-title"><div><h2>Workforce Project</h2><p>{members.length} employee pada current placement</p></div></div><div className="table-scroll"><table><thead><tr><th>ID Personil</th><th>Nama</th><th>Position</th><th>Status</th><th>Join Date</th></tr></thead><tbody>{members.map((employee) => <tr key={employee.id}><td><Link to={`/employees/${employee.id}`}>{employee.personnelId}</Link></td><td>{employee.name}</td><td>{employee.position ?? 'Belum Diisi'}</td><td>{employee.employmentStatus === 'ACTIVE' ? 'Aktif' : 'Tidak Aktif'}</td><td>{employee.joinDate ?? 'N/A'}</td></tr>)}</tbody></table></div></section>}
    {tab === 'MONTHLY' && <><section className="card project-period"><label>Periode<input aria-label="Periode analitik" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>{canManage && <form onSubmit={saveQuota}><label>Kuota bulanan<input type="number" min="0" required placeholder={String(metrics.quota ?? 0)} value={quotaValue} onChange={(event) => setQuotaValue(event.target.value)} /></label><button className="button secondary" type="submit">Simpan Kuota</button></form>}</section><div className="project-metric-grid">{card('Monthly Quota', metrics.quota ?? 'N/A')}{card('Active Employee', metrics.active, 'Current snapshot')}{card('New Hire', metrics.newHire)}{card('Turnover', metrics.turnover)}{card('Turnover %', formatPercent(metrics.turnoverRate), 'Turnover ÷ quota')}{card('Vacant', metrics.vacant)}{card('Fulfilled', metrics.fulfilled)}{card('Average Gap', metrics.averageGap === null ? 'N/A' : `${metrics.averageGap.toFixed(1)} hari`)}{card('Over SLA', metrics.overSla)}</div><p className="analytics-note">Kuota disimpan per project dan bulan.</p></>}
    {tab === 'TERMINATION' && <section className="card table-card"><div className="table-title"><div><h2>Pengakhiran Perjanjian</h2><p>Berdasarkan field pada Master Employee.</p></div></div><div className="table-scroll"><table><thead><tr><th>Area</th><th>Client</th><th>Project</th><th>TIDAK</th><th>YA</th><th>Belum Diisi</th><th>Total</th></tr></thead><tbody><tr onClick={() => setExpanded(!expanded)} className="clickable-row"><td>{areas.find((area) => area.id === project.areaId)?.name}</td><td>{project.clientName}</td><td>{project.name}</td><td>{term.no.length}</td><td>{term.yes.length}</td><td>{term.notSet.length}</td><td>{term.total} ▾</td></tr></tbody></table></div>{expanded && <div className="project-member-list">{members.map((employee) => <Link key={employee.id} to={`/employees/${employee.id}`}>{employee.personnelId} · {employee.name} <strong>{employee.profile?.agreementTermination ?? 'Belum Diisi'}</strong></Link>)}</div>}</section>}
  </>
}
