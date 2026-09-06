import { ChevronRight, Plus, Search, SlidersHorizontal, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { validationTone } from '../components/statusTones'
import { useDemo } from '../context/DemoContext'
import { areas, demoUsers, projects } from '../data/demoData'
import { canEditEmployees, contractLabels, filterEmployeesForUser, validationLabels } from '../lib/businessRules'

export function EmployeesPage() {
  const { currentUser, employees } = useDemo()
  const [search, setSearch] = useState('')
  const [areaId, setAreaId] = useState(currentUser?.role === 'AREA_SUPPORT' ? currentUser.areaId ?? '' : '')
  const [projectId, setProjectId] = useState('')
  const [status, setStatus] = useState('')
  const user = currentUser ?? demoUsers[0]
  const visible = useMemo(() => filterEmployeesForUser(user, employees).filter((employee) => {
    const query = search.toLowerCase()
    return (!query || employee.name.toLowerCase().includes(query) || employee.personnelId.toLowerCase().includes(query)) && (!areaId || employee.areaId === areaId) && (!projectId || employee.projectId === projectId) && (!status || employee.employmentStatus === status)
  }), [areaId, employees, projectId, search, status, user])
  if (!currentUser) return null
  return <>
    <PageHeader eyebrow="EMPLOYEE DATABASE" title="Master Employee" description={`${visible.length} dari ${filterEmployeesForUser(currentUser, employees).length} employee dalam cakupan akses Anda.`} actions={canEditEmployees(currentUser) && <Link to="/employees/new" className="button primary"><Plus size={18} /> Employee Entry</Link>} />
    <section className="card filter-card"><div className="search-box"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama atau Personnel ID..." /></div><div className="filter-selects"><SlidersHorizontal size={18} />
      <select value={areaId} onChange={(event) => { setAreaId(event.target.value); setProjectId('') }} disabled={currentUser.role === 'AREA_SUPPORT'}><option value="">Semua area</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select>
      <select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Semua project</option>{projects.filter((project) => !areaId || project.areaId === areaId).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Semua status</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select>
    </div></section>
    <section className="card table-card"><div className="table-title"><div><span className="section-icon"><Users size={18} /></span><div><h2>Employee Directory</h2><p>Data master berdasarkan source data yang tersedia.</p></div></div><span className="record-count">{visible.length} RECORDS</span></div><div className="table-scroll"><table><thead><tr><th>Employee</th><th>Area & Project</th><th>Position</th><th>Employment</th><th>Contract</th><th>Validation</th><th /></tr></thead><tbody>{visible.map((employee) => {
      const area = areas.find((item) => item.id === employee.areaId); const project = projects.find((item) => item.id === employee.projectId)
      return <tr key={employee.id}><td><Link className="employee-cell" to={`/employees/${employee.id}`}><span className="initials">{employee.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><span><strong>{employee.name}</strong><small>{employee.personnelId}</small></span></Link></td><td><strong className={!area || !project ? 'missing-text' : ''}>{area?.name ?? 'Area belum tersedia'}</strong><small>{project?.name ?? 'Project belum tersedia'}</small></td><td>{employee.position ?? <span className="missing-text">Belum tersedia</span>}</td><td><StatusBadge tone={employee.employmentStatus === 'ACTIVE' ? 'success' : 'neutral'}>{employee.employmentStatus === 'ACTIVE' ? 'Active' : 'Inactive'}</StatusBadge></td><td>{contractLabels[employee.contractStatus]}</td><td><StatusBadge tone={validationTone(employee.validationStatus)}>{validationLabels[employee.validationStatus]}</StatusBadge></td><td><Link className="row-link" to={`/employees/${employee.id}`} aria-label="Lihat detail"><ChevronRight size={18} /></Link></td></tr>
    })}</tbody></table></div>{visible.length === 0 && <div className="empty-inline">Tidak ada employee yang cocok dengan filter.</div>}</section>
  </>
}
