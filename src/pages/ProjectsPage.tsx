import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { useDemo } from '../context/DemoContext'
import { areas } from '../data/demoData'
import { allowedAreaIds } from '../config/access'
import { filterProjects, getProjectMetrics } from '../lib/projectAnalytics'
import type { Project } from '../types'

const blank = (): Project => ({ id: '', name: '', clientName: '', areaId: '', subArea: null, status: 'ACTIVE', startDate: null, endDate: null })

export function ProjectsPage() {
  const { currentUser, permissionConfig, projects, projectQuotas, employees, employeeExits, replacementNeeds, saveProject, setProjectStatus } = useDemo()
  const [search, setSearch] = useState('')
  const [areaId, setAreaId] = useState('')
  const [clientName, setClientName] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Project | null>(null)
  const allowed = useMemo(() => currentUser ? allowedAreaIds(currentUser, permissionConfig) : [], [currentUser, permissionConfig])
  const canManage = currentUser?.role === 'HR_HO' || currentUser?.role === 'SUPER_ADMIN'
  const visible = useMemo(() => filterProjects(projects, { areaId, clientName }, allowed).filter((project) => (!status || project.status === status) && (!search || `${project.name} ${project.clientName}`.toLowerCase().includes(search.toLowerCase()))), [projects, areaId, clientName, status, search, allowed])
  const source = { projects, projectQuotas, employees, employeeExits, replacementNeeds }
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!editing?.name.trim() || !editing.clientName.trim() || !editing.areaId) return
    saveProject({ ...editing, id: editing.id || `project-demo-${Date.now()}`, name: editing.name.trim(), clientName: editing.clientName.trim(), subArea: editing.subArea?.trim() || null })
    setEditing(null)
  }
  return <>
    <PageHeader eyebrow="MASTER DATA" title="Projects" description="Project dan client sebagai konteks penempatan dan analitik." actions={canManage && <button className="button primary" onClick={() => setEditing(blank())}><Plus size={17} /> Tambah Project</button>} />
    <section className="card project-filters"><input aria-label="Cari project" placeholder="Cari project atau client..." value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Filter area" value={areaId} onChange={(event) => setAreaId(event.target.value)}><option value="">Semua Area</option>{areas.filter((area) => allowed === null || allowed.includes(area.id)).map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select><select aria-label="Filter client" value={clientName} onChange={(event) => setClientName(event.target.value)}><option value="">Semua Client</option>{[...new Set(projects.map((project) => project.clientName))].sort().map((client) => <option key={client}>{client}</option>)}</select><select aria-label="Filter status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Semua Status</option><option value="ACTIVE">Aktif</option><option value="INACTIVE">Tidak Aktif</option></select></section>
    <section className="card table-card"><div className="table-title"><div><h2>Master Project</h2><p>{visible.length} project dalam cakupan akses Anda</p></div><Link className="button secondary" to="/reports/analytics">Lihat Analytics</Link></div><div className="table-scroll"><table><thead><tr><th>Project</th><th>Client</th><th>Area / Sub Area</th><th>Status</th><th>Quota Sep 2026</th><th>Active Employee</th><th>Aksi</th></tr></thead><tbody>{visible.map((project) => { const metrics = getProjectMetrics(source, project, '2026-09'); return <tr key={project.id}><td><Link className="master-id" to={`/projects/${project.id}`}>{project.name}</Link></td><td>{project.clientName}</td><td>{areas.find((area) => area.id === project.areaId)?.name ?? 'Belum Diisi'}<small>{project.subArea ?? '—'}</small></td><td>{project.status === 'ACTIVE' ? 'Aktif' : 'Tidak Aktif'}</td><td>{metrics.quota ?? 'N/A'}</td><td>{metrics.active}</td><td><div className="project-actions"><Link to={`/projects/${project.id}`}>Detail</Link>{canManage && <><button onClick={() => setEditing({ ...project })}>Edit</button><button onClick={() => setProjectStatus(project.id, project.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')}>{project.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'}</button></>}</div></td></tr> })}</tbody></table></div>{visible.length === 0 && <div className="empty-inline">Tidak ada project yang cocok dengan filter.</div>}</section>
    {editing && <div className="drawer-backdrop" onClick={() => setEditing(null)}><aside className="drill-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-head"><div><span>MASTER PROJECT</span><h2>{editing.id ? 'Edit Project' : 'Project Baru'}</h2></div><button className="icon-button" onClick={() => setEditing(null)}>×</button></div><form className="project-form" onSubmit={save}><label>Nama Project<input required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label>Nama Client<input required value={editing.clientName} onChange={(event) => setEditing({ ...editing, clientName: event.target.value })} /></label><label>Area<select required value={editing.areaId} onChange={(event) => setEditing({ ...editing, areaId: event.target.value })}><option value="">Pilih Area</option>{areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select></label><label>Sub Area<input value={editing.subArea ?? ''} onChange={(event) => setEditing({ ...editing, subArea: event.target.value })} /></label><label>Tanggal Mulai<input type="date" value={editing.startDate ?? ''} onChange={(event) => setEditing({ ...editing, startDate: event.target.value || null })} /></label><label>Tanggal Akhir<input type="date" value={editing.endDate ?? ''} onChange={(event) => setEditing({ ...editing, endDate: event.target.value || null })} /></label><button className="button primary" type="submit">Simpan Project</button></form></aside></div>}
  </>
}
