import { Plus, Search, SlidersHorizontal, Users, AlertTriangle } from 'lucide-react'
import { useMemo, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { useEmployeeDocumentGaps } from '../hooks/useEmployeeDocumentGaps'
import { useDemo } from '../context/DemoContext'
import { demoUsers } from '../data/demoData'
import { allowedAreaIds, hasPermission } from '../config/access'
import { formatDate, filterEmployeesForUser } from '../lib/businessRules'
import { getActiveEmployees, latestValidatedExit } from '../lib/employeeViews'
import { terminology as term } from '../config/terminology'
import { useRemoteEmployeePage } from '../hooks/useRemoteEmployeePage'

export function EmployeesPage() {
  const { currentUser, areas, employees, employeeExits, permissionConfig, projects, dataSource } = useDemo()
  const user = currentUser ?? demoUsers[0]
  const scopedAreas = allowedAreaIds(user, permissionConfig)
  const [view, setView] = useState<'ALL' | 'ACTIVE'>('ALL')
  const [search, setSearch] = useState('')
  const [areaId, setAreaId] = useState(scopedAreas?.length === 1 ? scopedAreas[0] : '')
  const [projectId, setProjectId] = useState('')
  const [client, setClient] = useState('')
  const [status, setStatus] = useState('')
  const scoped = useMemo(() => filterEmployeesForUser(user, employees, permissionConfig), [employees, permissionConfig, user])
  const active = useMemo(() => getActiveEmployees(scoped, employeeExits), [scoped, employeeExits])
  const clients = [...new Set(projects.map((project) => project.clientName))].sort()
  const visible = (view === 'ACTIVE' ? active : scoped).filter((employee) => {
    const project = projects.find((item) => item.id === employee.projectId)
    const query = search.toLowerCase()
    return (!query || employee.name.toLowerCase().includes(query) || employee.personnelId.toLowerCase().includes(query)) && (!areaId || employee.areaId === areaId) && (!projectId || employee.projectId === projectId) && (!client || project?.clientName === client) && (!status || employee.employmentStatus === status)
  })
  const PAGE_SIZE = 50
  const [page, setPage] = useState(1)
  // Reset to page 1 whenever filters change (adjust-state-during-render pattern).
  const filterKey = `${view}|${search}|${areaId}|${projectId}|${client}|${status}`
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (filterKey !== prevFilterKey) { setPrevFilterKey(filterKey); setPage(1) }
  const navigate = useNavigate()
  const docGaps = useEmployeeDocumentGaps(dataSource === 'api')
  const remote = useRemoteEmployeePage(dataSource === 'api', { view, search, areaId, projectId, client, status, page, pageSize: PAGE_SIZE })
  const total = remote ? remote.total : visible.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = remote ? page : Math.min(page, pageCount)
  const paged = remote ? remote.items : visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  if (!currentUser) return null
  return <>
    <PageHeader eyebrow="EMPLOYEE DATABASE" title={term.employeeMaster} description="Cari, filter, dan buka detail personil." actions={hasPermission(currentUser, permissionConfig, 'create_employee') && <Link to="/employees/new" className="button primary"><Plus size={18} /> {term.employeeEntry}</Link>} />
    <div className="employee-view-tabs" role="tablist" aria-label="Tampilan employee"><button role="tab" aria-selected={view === 'ALL'} className={view === 'ALL' ? 'selected' : ''} onClick={() => setView('ALL')}>Semua Employee <strong>{scoped.length}</strong></button><button role="tab" aria-selected={view === 'ACTIVE'} className={view === 'ACTIVE' ? 'selected' : ''} onClick={() => setView('ACTIVE')}>Employee Aktif <strong>{active.length}</strong></button></div>
    <section className="card filter-card"><label className="search-field">Cari<div className="search-box"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama atau ID Personil..." /></div></label><div className="filter-selects"><SlidersHorizontal size={18} />
      <label>Area CBS<select aria-label="Area CBS" value={areaId} onChange={(event) => { setAreaId(event.target.value); setProjectId('') }} disabled={scopedAreas?.length === 1}><option value="">Semua area</option>{areas.filter((area) => scopedAreas === null || scopedAreas.includes(area.id)).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
      <label>Client<select aria-label="Client" value={client} onChange={(event) => { setClient(event.target.value); setProjectId('') }}><option value="">Semua client</option>{clients.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label>Project<select aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Semua project</option>{projects.filter((project) => (!areaId || project.areaId === areaId) && (!client || project.clientName === client) && (scopedAreas === null || scopedAreas.includes(project.areaId))).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Status<select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Semua status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
    </div></section>
    {docGaps.data && docGaps.data.incomplete > 0 && <div className="alert warning"><AlertTriangle /><div><strong>{docGaps.data.incomplete} dari {docGaps.data.monitored} karyawan aktif belum memiliki PKWT yang diterima</strong><p>Karyawan tetap bisa divalidasi. Unggah PKWT dari halaman detail masing-masing karyawan; baris yang belum lengkap ditandai di tabel. <Link to="/documents">Lihat daftar →</Link></p></div></div>}
    <section className="card table-card"><div className="table-title"><div><span className="section-icon"><Users size={18} /></span><div><h2>{view === 'ACTIVE' ? 'Database Aktif' : 'Employee Directory'}</h2><p>{view === 'ACTIVE' ? 'Personil aktif saat ini.' : 'Seluruh personil.'}</p></div></div><span className="record-count">{remote?.loading ? 'MEMUAT…' : `${total} RECORDS`}</span></div><div className="table-scroll"><table className="employee-master-table"><thead><tr><th>ID Personil</th><th>Nama</th><th>Area CBS</th><th>Sub Area</th><th>Nama Client</th><th>Nama Project</th><th>Nama TL</th><th>Posisi</th><th>Status</th><th>Outlet</th><th>Area Coverage</th><th>Tanggal Bergabung</th><th>Berakhir Kontrak</th><th>Tanggal Keluar</th><th>Pengakhiran Perjanjian</th><th>Masa Kerja</th></tr></thead><tbody>{paged.map((employee) => {
      const area = areas.find((item) => item.id === employee.areaId)
      const project = projects.find((item) => item.id === employee.projectId)
      const exit = latestValidatedExit(employee.id, employeeExits)
      const clientName = project?.clientName ?? employee.profile?.clientName
      const projectName = project?.name ?? employee.profile?.projectName
      // The whole row opens the detail; links inside the row (ID, PKWT badge) keep their own target.
      const open = (event: MouseEvent) => { if (!(event.target as HTMLElement).closest('a')) navigate(`/employees/${encodeURIComponent(employee.id)}`) }
      return <tr key={employee.id} className="clickable-row" onClick={open}><td><Link className="master-id" to={`/employees/${employee.id}`}>{employee.personnelId}</Link></td><td><strong>{employee.name}</strong>{(() => { const gap = docGaps.byId.get(employee.id); return gap && <Link to={`/employees/${employee.id}#documents`} title={docGaps.describe(gap)}><StatusBadge tone="warning">PKWT belum ada</StatusBadge></Link> })()}</td><td>{employee.profile?.areaCbs ?? area?.name ?? <span className="missing-text">Belum Diisi</span>}</td><td>{employee.subArea ?? '—'}</td><td>{clientName ?? <span className="missing-text">Belum Diisi</span>}</td><td>{projectName ?? <span className="missing-text">Belum Diisi</span>}</td><td>{employee.profile?.teamLeader ?? '—'}</td><td>{employee.position ?? <span className="missing-text">Belum Diisi</span>}</td><td><StatusBadge tone={employee.employmentStatus === 'ACTIVE' ? 'success' : 'neutral'}>{employee.employmentStatus === 'ACTIVE' ? 'Aktif' : 'Tidak Aktif'}</StatusBadge></td><td>{employee.profile?.outlet ?? '—'}</td><td>{employee.profile?.coverageArea ?? '—'}</td><td>{formatDate(employee.joinDate)}</td><td>{formatDate(employee.contractEndDate)}</td><td>{formatDate(exit?.exitDate ?? employee.profile?.exitDate)}</td><td>{employee.profile?.agreementTermination ?? 'Belum Diisi'}</td><td>{employee.profile?.tenureLabel ?? '—'}</td></tr>
    })}</tbody></table></div>{remote?.error && <div className="empty-inline" role="alert">{remote.error}</div>}{total === 0 && !remote?.loading && <div className="empty-inline">Tidak ada employee yang cocok dengan filter.</div>}{pageCount > 1 && <div className="import-confirm"><p>Menampilkan {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, total)} dari {total}</p><div style={{ display: 'flex', gap: 8 }}><button className="button secondary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Sebelumnya</button><button className="button secondary" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Berikutnya</button></div></div>}</section>
  </>
}
