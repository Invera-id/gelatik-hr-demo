import { ChevronRight, Plus, Search, SlidersHorizontal, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { useDemo } from '../context/DemoContext'
import { areas, demoUsers } from '../data/demoData'
import { allowedAreaIds, hasPermission } from '../config/access'
import { formatDate, filterEmployeesForUser } from '../lib/businessRules'
import { getActiveEmployees, latestValidatedExit } from '../lib/employeeViews'
import { terminology as term } from '../config/terminology'

export function EmployeesPage() {
  const { currentUser, employees, employeeExits, permissionConfig, projects } = useDemo()
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
  if (!currentUser) return null
  return <>
    <PageHeader eyebrow="EMPLOYEE DATABASE" title={term.employeeMaster} description="Satu sumber data untuk seluruh employee dan tampilan Employee Aktif. Kolom detail sensitif hanya muncul pada halaman employee." actions={hasPermission(currentUser, permissionConfig, 'create_employee') && <Link to="/employees/new" className="button primary"><Plus size={18} /> {term.employeeEntry}</Link>} />
    <div className="employee-view-tabs" role="tablist" aria-label="Tampilan employee"><button role="tab" aria-selected={view === 'ALL'} className={view === 'ALL' ? 'selected' : ''} onClick={() => setView('ALL')}>Semua Employee <strong>{scoped.length}</strong></button><button role="tab" aria-selected={view === 'ACTIVE'} className={view === 'ACTIVE' ? 'selected' : ''} onClick={() => setView('ACTIVE')}>Employee Aktif <strong>{active.length}</strong></button></div>
    <section className="card filter-card"><div className="search-box"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama atau ID Personil..." /></div><div className="filter-selects"><SlidersHorizontal size={18} />
      <select aria-label="Area CBS" value={areaId} onChange={(event) => { setAreaId(event.target.value); setProjectId('') }} disabled={scopedAreas?.length === 1}><option value="">Semua area</option>{areas.filter((area) => scopedAreas === null || scopedAreas.includes(area.id)).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
      <select aria-label="Client" value={client} onChange={(event) => { setClient(event.target.value); setProjectId('') }}><option value="">Semua client</option>{clients.map((name) => <option key={name}>{name}</option>)}</select>
      <select aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Semua project</option>{projects.filter((project) => (!areaId || project.areaId === areaId) && (!client || project.clientName === client) && (scopedAreas === null || scopedAreas.includes(project.areaId))).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Semua status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
    </div></section>
    <section className="card table-card"><div className="table-title"><div><span className="section-icon"><Users size={18} /></span><div><h2>{view === 'ACTIVE' ? 'Database Aktif' : 'Employee Directory'}</h2><p>{view === 'ACTIVE' ? 'Derived view dari Master Employee, bukan database kedua.' : 'Struktur ringkas mengikuti kelompok field referensi Gelatik.'}</p></div></div><span className="record-count">{visible.length} RECORDS</span></div><div className="table-scroll"><table className="employee-master-table"><thead><tr><th>ID Personil</th><th>Nama</th><th>Area CBS</th><th>Sub Area</th><th>Nama Client</th><th>Nama Project</th><th>Nama TL</th><th>Posisi</th><th>Status</th><th>Outlet</th><th>Area Coverage</th><th>Tanggal Bergabung</th><th>Berakhir Kontrak</th><th>Tanggal Keluar</th><th>Pengakhiran Perjanjian</th><th>Masa Kerja</th><th /></tr></thead><tbody>{visible.map((employee) => {
      const area = areas.find((item) => item.id === employee.areaId)
      const project = projects.find((item) => item.id === employee.projectId)
      const exit = latestValidatedExit(employee.id, employeeExits)
      return <tr key={employee.id}><td><Link className="master-id" to={`/employees/${employee.id}`}>{employee.personnelId}</Link></td><td><strong>{employee.name}</strong></td><td>{employee.profile?.areaCbs ?? area?.name ?? <span className="missing-text">Belum Diisi</span>}</td><td>{employee.subArea ?? '—'}</td><td>{project?.clientName ?? <span className="missing-text">Belum Diisi</span>}</td><td>{project?.name ?? <span className="missing-text">Belum Diisi</span>}</td><td>{employee.profile?.teamLeader ?? '—'}</td><td>{employee.position ?? <span className="missing-text">Belum Diisi</span>}</td><td><StatusBadge tone={employee.employmentStatus === 'ACTIVE' ? 'success' : 'neutral'}>{employee.employmentStatus === 'ACTIVE' ? 'Aktif' : 'Tidak Aktif'}</StatusBadge></td><td>{employee.profile?.outlet ?? '—'}</td><td>{employee.profile?.coverageArea ?? '—'}</td><td>{formatDate(employee.joinDate)}</td><td>{formatDate(employee.contractEndDate)}</td><td>{formatDate(exit?.exitDate ?? employee.profile?.exitDate)}</td><td>{employee.profile?.agreementTermination ?? 'Belum Diisi'}</td><td>{employee.profile?.tenureLabel ?? '—'}</td><td><Link className="row-link" to={`/employees/${employee.id}`} aria-label={`Lihat ${employee.name}`}><ChevronRight size={18} /></Link></td></tr>
    })}</tbody></table></div>{visible.length === 0 && <div className="empty-inline">Tidak ada employee yang cocok dengan filter.</div>}</section>
  </>
}
