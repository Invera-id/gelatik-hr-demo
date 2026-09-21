import { AlertTriangle, ArrowLeft, RotateCcw } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { useDemo } from '../context/DemoContext'
import { areas, positions, projects } from '../data/demoData'
import { canAccessEmployee } from '../lib/businessRules'
import { getEmployeeFlagWarning } from '../lib/employeeRules'

export function ReentryPage() {
  const { employeeId } = useParams()
  const { currentUser, employees, employeeFlags, permissionConfig, reentryEmployee } = useDemo()
  const navigate = useNavigate()
  const employee = employees.find((item) => item.id === employeeId)
  const warning = employee ? getEmployeeFlagWarning(employee.id, employeeFlags) : null
  const [form, setForm] = useState({ areaId: employee?.areaId ?? '', projectId: employee?.projectId ?? '', position: employee?.position ?? '', joinDate: '2026-09-14', notes: 'Re-entry employee untuk simulasi requirement.' })
  if (!currentUser || !employee || employee.employmentStatus !== 'INACTIVE' || !canAccessEmployee(currentUser, employee, permissionConfig)) return <Navigate to="/employees" replace />
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value, ...(key === 'areaId' ? { projectId: '' } : {}) }))
  const submit = (event: FormEvent) => { event.preventDefault(); reentryEmployee(employee.id, form.areaId, form.projectId, form.position, form.joinDate, form.notes); navigate(`/employees/${employee.id}`) }
  return <><Link className="back-link" to={`/employees/${employee.id}`}><ArrowLeft /> Kembali ke Employee Detail</Link><PageHeader eyebrow="RE-ENTRY" title={`Re-entry ${employee.name}`} description="Identitas dan seluruh history lama tetap dipertahankan." />
    {warning?.requiresReview && <div className="alert warning"><AlertTriangle /><div><strong>Employee memiliki catatan historis dan memerlukan review.</strong><p>{warning.latest?.reason}. Warning ini tidak memblokir re-entry.</p></div></div>}
    <form className="card form-card" onSubmit={submit}><div className="form-section-title"><span className="section-icon"><RotateCcw /></span><div><h2>Penempatan Re-entry</h2><p>Personnel ID tetap: {employee.personnelId}</p></div></div><div className="form-grid"><label>Area *<select required value={form.areaId} onChange={(event) => update('areaId', event.target.value)}>{areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select></label><label>Project *<select required value={form.projectId} onChange={(event) => update('projectId', event.target.value)}><option value="">Pilih project</option>{projects.filter((project) => project.areaId === form.areaId).map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><label>Position *<select required value={form.position} onChange={(event) => update('position', event.target.value)}>{positions.map((position) => <option key={position}>{position}</option>)}</select></label><label>Join Date *<input required type="date" value={form.joinDate} onChange={(event) => update('joinDate', event.target.value)} /></label><label className="span-two">Notes *<textarea required rows={3} value={form.notes} onChange={(event) => update('notes', event.target.value)} /></label></div><div className="rule-note"><strong>DEMO ASSUMPTION / TBC</strong><span>Flag pada prototype merupakan warning untuk review manual, bukan keputusan otomatis.</span></div><div className="form-actions"><Link className="button ghost" to={`/employees/${employee.id}`}>Batal</Link><button className="button primary" type="submit"><RotateCcw /> Aktifkan Re-entry Demo</button></div></form>
  </>
}
