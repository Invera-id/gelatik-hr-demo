import { AlertTriangle, ArrowLeft, RotateCcw } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { ActionError } from '../components/ActionError'
import { useDemo } from '../context/DemoContext'
import { positions } from '../data/demoData'
import { canAccessEmployee } from '../lib/businessRules'
import { getEmployeeFlagWarning } from '../lib/employeeRules'
import { allowedAreaIds } from '../config/access'

export function ReentryPage() {
  const { employeeId } = useParams()
  const { currentUser, areas, employees, projects, employeeFlags, permissionConfig, reentryEmployee, businessDate } = useDemo()
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const employee = employees.find((item) => item.id === employeeId)
  const warning = employee ? getEmployeeFlagWarning(employee.id, employeeFlags) : null
  const accessibleAreas = currentUser ? allowedAreaIds(currentUser, permissionConfig) : []
  const [form, setForm] = useState({ areaId: employee?.areaId ?? '', projectId: employee?.projectId ?? '', position: employee?.position ?? '', joinDate: businessDate, notes: '' })
  if (!currentUser || !employee || employee.employmentStatus !== 'INACTIVE' || !canAccessEmployee(currentUser, employee, permissionConfig)) return <Navigate to="/employees" replace />
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value, ...(key === 'areaId' ? { projectId: '' } : {}) }))
  const submit = async (event: FormEvent) => { event.preventDefault(); const result = await reentryEmployee(employee.id, form.areaId, form.projectId, form.position, form.joinDate, form.notes); if (result.ok) navigate(`/employees/${employee.id}`); else setError(result.error ?? 'Gagal menyimpan.') }
  return <><Link className="back-link" to={`/employees/${employee.id}`}><ArrowLeft /> Kembali ke Employee Detail</Link><PageHeader eyebrow="RE-ENTRY" title={`Re-entry ${employee.name}`} description="Identitas dan seluruh history lama tetap dipertahankan." />
    <ActionError message={error} />
    {warning?.requiresReview && <div className="alert warning"><AlertTriangle /><div><strong>Employee memiliki catatan historis dan memerlukan review.</strong><p>{warning.latest?.reason}. Warning ini tidak memblokir re-entry.</p></div></div>}
    <form className="card form-card" onSubmit={submit}><div className="form-section-title"><span className="section-icon"><RotateCcw /></span><div><h2>Penempatan Re-entry</h2><p>Personnel ID tetap: {employee.personnelId}</p></div></div><div className="form-grid"><label>Area *<select required value={form.areaId} onChange={(event) => update('areaId', event.target.value)}>{areas.filter((area) => accessibleAreas === null || accessibleAreas.includes(area.id)).map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select></label><label>Project *<select required value={form.projectId} onChange={(event) => update('projectId', event.target.value)}><option value="">Pilih project</option>{projects.filter((project) => project.areaId === form.areaId && (accessibleAreas === null || accessibleAreas.includes(project.areaId))).map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><label>Position *<select required value={form.position} onChange={(event) => update('position', event.target.value)}>{positions.map((position) => <option key={position}>{position}</option>)}</select></label><label>Join Date *<input required type="date" value={form.joinDate} onChange={(event) => update('joinDate', event.target.value)} /></label><label className="span-two">Notes *<textarea required rows={3} value={form.notes} onChange={(event) => update('notes', event.target.value)} /></label></div><div className="form-actions"><Link className="button ghost" to={`/employees/${employee.id}`}>Batal</Link><button className="button primary" type="submit"><RotateCcw /> Aktifkan Re-entry</button></div></form>
  </>
}
