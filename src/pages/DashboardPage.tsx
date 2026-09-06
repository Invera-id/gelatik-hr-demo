import { Activity, ArrowDownRight, ArrowUpRight, BriefcaseBusiness, CheckCircle2, Clock3, Gauge, RotateCw, UserMinus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { replacementTone } from '../components/statusTones'
import { useDemo } from '../context/DemoContext'
import { areas, demoUsers, projects } from '../data/demoData'
import { filterEmployeesForUser, formatDate, formatNumber, replacementLabels } from '../lib/businessRules'

const kpiIcons = [Users, UserMinus, BriefcaseBusiness, CheckCircle2, Clock3, Gauge, RotateCw, Activity]

export function DashboardPage() {
  const { currentUser, employees, employeeExits, replacementNeeds, movements } = useDemo()
  const user = currentUser ?? demoUsers[0]
  const [areaId, setAreaId] = useState(user.role === 'AREA_SUPPORT' ? user.areaId ?? '' : '')
  const [projectId, setProjectId] = useState('')
  const [dateFrom, setDateFrom] = useState('2026-08-01')
  const [dateTo, setDateTo] = useState('2026-09-30')
  const scopedEmployees = useMemo(() => filterEmployeesForUser(user, employees).filter((employee) => (!areaId || employee.areaId === areaId) && (!projectId || employee.projectId === projectId)), [areaId, employees, projectId, user])
  const scopedExits = employeeExits.filter((exit) => { const employee = employees.find((item) => item.id === exit.employeeId); return employee && scopedEmployees.some((item) => item.id === employee.id) && exit.exitDate >= dateFrom && exit.exitDate <= dateTo })
  const scopedNeeds = replacementNeeds.filter((need) => (!areaId || need.areaId === areaId) && (!projectId || need.projectId === projectId) && need.exitDate >= dateFrom && need.exitDate <= dateTo)
  const fulfilled = scopedNeeds.filter((need) => ['FULFILLED', 'OVER_TARGET'].includes(need.status))
  const gaps = fulfilled.map((need) => need.gapWorkingDays ?? 0)
  const fulfillmentRate = scopedNeeds.length ? Math.round((fulfilled.length / scopedNeeds.length) * 100) : 0
  const avgGap = gaps.length ? (gaps.reduce((sum, value) => sum + value, 0) / gaps.length).toFixed(1) : '0.0'
  const kpis = [
    ['Active Employees', scopedEmployees.filter((item) => item.employmentStatus === 'ACTIVE').length, 'Dalam cakupan filter', 'positive'],
    ['Employee Exits', scopedExits.length, 'Pada periode terpilih', 'neutral'],
    ['Replacement Needs', scopedNeeds.length, 'Dibuat setelah validasi', 'neutral'],
    ['Fulfilled', fulfilled.length, `${fulfillmentRate}% fulfillment rate`, 'positive'],
    ['Open', scopedNeeds.filter((item) => item.status === 'OPEN').length, 'Perlu kandidat', 'warning'],
    ['Over SLA', scopedNeeds.filter((item) => item.status === 'OVER_TARGET').length, 'Lebih dari 3 hari kerja', 'danger'],
    ['Fulfillment Rate', `${fulfillmentRate}%`, 'Target demo ≤ 3 hari', 'positive'],
    ['Average Gap', `${avgGap} hari`, 'Working-day gap', 'neutral'],
  ]
  const areaChart = areas.filter((area) => user.role !== 'AREA_SUPPORT' || area.id === user.areaId).map((area) => ({ name: area.name, exits: scopedExits.filter((exit) => employees.find((employee) => employee.id === exit.employeeId)?.areaId === area.id).length, fulfilled: scopedNeeds.filter((need) => need.areaId === area.id && ['FULFILLED', 'OVER_TARGET'].includes(need.status)).length, avgGap: (() => { const values = scopedNeeds.filter((need) => need.areaId === area.id && need.gapWorkingDays !== null).map((need) => need.gapWorkingDays ?? 0); return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)) : 0 })() }))
  const projectChart = projects.filter((project) => (!areaId || project.areaId === areaId) && (user.role !== 'AREA_SUPPORT' || project.areaId === user.areaId)).map((project) => ({ name: project.name.replace('Project ', '').replace(' Bandung', ' BDG').replace(' Semarang', ' SMG').replace(' Jakarta', ' JKT'), needs: scopedNeeds.filter((need) => need.projectId === project.id).length, fulfilled: scopedNeeds.filter((need) => need.projectId === project.id && ['FULFILLED', 'OVER_TARGET'].includes(need.status)).length }))
  const recent = movements.filter((movement) => scopedEmployees.some((employee) => employee.id === movement.employeeId)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)
  return <>
    <PageHeader eyebrow="WORKFORCE OVERVIEW" title={`Selamat datang, ${user.name.split(' ')[0]}`} description="Ringkasan movement dan fulfillment berdasarkan data sumber yang tersedia." />
    <section className="card dashboard-filters"><div><label>Periode mulai<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><span className="date-separator">—</span><label>Sampai<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></div><div><label>Area<select value={areaId} disabled={user.role === 'AREA_SUPPORT'} onChange={(event) => { setAreaId(event.target.value); setProjectId('') }}><option value="">Semua Area</option>{areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select></label><label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Semua Project</option>{projects.filter((project) => !areaId || project.areaId === areaId).map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label></div></section>
    <div className="kpi-grid">{kpis.map(([label, value, note, tone], index) => { const Icon = kpiIcons[index]; return <article className={`card kpi-card ${tone}`} key={String(label)}><div className="kpi-top"><span className="kpi-icon"><Icon /></span>{tone === 'positive' ? <ArrowUpRight /> : tone === 'danger' ? <ArrowDownRight /> : null}</div><strong>{typeof value === 'number' ? formatNumber(value) : value}</strong><h3>{label}</h3><p>{note}</p></article> })}</div>
    <div className="charts-grid"><section className="card chart-card"><div className="chart-heading"><div><h2>Turnover & Fulfillment by Area</h2><p>Perbandingan movement keluar dan replacement.</p></div><span>PERIODE TERPILIH</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={areaChart} barGap={6}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf2" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#667085', fontSize: 12 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#98a2b3', fontSize: 12 }} /><Tooltip /><Legend /><Bar dataKey="exits" name="Employee Exit" fill="#173f5f" radius={[5, 5, 0, 0]} /><Bar dataKey="fulfilled" name="Fulfilled" fill="#1a9b78" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
      <section className="card chart-card"><div className="chart-heading"><div><h2>Fulfillment by Project</h2><p>Kebutuhan dibandingkan hasil fulfillment.</p></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={projectChart} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e8edf2" /><XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} /><YAxis dataKey="name" type="category" width={78} axisLine={false} tickLine={false} tick={{ fill: '#667085', fontSize: 11 }} /><Tooltip /><Legend /><Bar dataKey="needs" name="Needs" fill="#b7c6d4" radius={[0, 5, 5, 0]} /><Bar dataKey="fulfilled" name="Fulfilled" fill="#f1a53a" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div></section></div>
    <div className="dashboard-lower"><section className="card recent-card"><div className="chart-heading"><div><h2>Recent Employee Movement</h2><p>Aktivitas terbaru dalam cakupan akses Anda.</p></div></div><div className="movement-list">{recent.map((movement) => { const employee = employees.find((item) => item.id === movement.employeeId); return <div className="movement-row" key={movement.id}><span className={`movement-icon ${movement.type.toLowerCase()}`}><Activity /></span><div><strong>{movement.title}</strong><p>{employee?.name} · {movement.description}</p></div><time>{formatDate(movement.date, true)}</time></div> })}</div></section>
      <section className="card sla-card"><div className="chart-heading"><div><h2>SLA Snapshot</h2><p>Status replacement pada periode ini.</p></div></div><div className="sla-score"><span>{fulfillmentRate}%</span><div><strong>Fulfillment Rate</strong><p>{fulfilled.length} dari {scopedNeeds.length} kebutuhan</p></div></div><div className="sla-list">{scopedNeeds.slice(0, 4).map((need) => <div key={need.id}><span>{need.id.toUpperCase()}</span><strong>{need.gapWorkingDays === null ? '—' : `${need.gapWorkingDays} hari`}</strong><StatusBadge tone={replacementTone(need.status)}>{replacementLabels[need.status]}</StatusBadge></div>)}</div><div className="rule-note compact-note">Working-day calculation is a demo assumption and subject to final confirmation.</div></section>
    </div>
  </>
}
