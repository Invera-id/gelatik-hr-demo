import { ArrowLeft, GitBranch, Save, Send } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { ActionError } from '../components/ActionError'
import { useDemo } from '../context/DemoContext'
import { positions } from '../data/demoData'
import { canAccessEmployee } from '../lib/businessRules'
import type { EmployeeMovementType, PlacementChangeRequest } from '../types'
import { allowedAreaIds } from '../config/access'

const supportedTypes: Array<{ value: PlacementChangeRequest['movementType']; label: string }> = [
  { value: 'PROMOTION', label: 'Promotion' }, { value: 'MUTATION', label: 'Mutation' }, { value: 'PROJECT_CHANGE', label: 'Project Change' }, { value: 'POSITION_CHANGE', label: 'Position Change' }, { value: 'AREA_CHANGE', label: 'Area Change' },
]

export function EmployeeMovementPage() {
  const { employeeId } = useParams()
  const { currentUser, areas, employees, projects, movementRequests, permissionConfig, saveMovementRequest } = useDemo()
  const navigate = useNavigate()
  const employee = employees.find((item) => item.id === employeeId)
  const existing = movementRequests.find((item) => item.employeeId === employeeId && ['DRAFT', 'SUBMITTED', 'REVISION_REQUIRED'].includes(item.validationStatus))
  const accessibleAreas = currentUser ? allowedAreaIds(currentUser, permissionConfig) : []
  const [form, setForm] = useState({ movementType: existing?.movementType ?? 'MUTATION', effectiveDate: existing?.effectiveDate ?? '', newAreaId: existing?.newAreaId ?? employee?.areaId ?? '', newProjectId: existing?.newProjectId ?? employee?.projectId ?? '', newPosition: existing?.newPosition ?? employee?.position ?? '', notes: existing?.notes ?? '' })
  const [intent, setIntent] = useState<'DRAFT' | 'SUBMITTED'>('DRAFT')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  if (!currentUser || !employee || !canAccessEmployee(currentUser, employee, permissionConfig)) return <Navigate to="/employees" replace />
  const currentArea = areas.find((item) => item.id === employee.areaId)
  const currentProject = projects.find((item) => item.id === employee.projectId)
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value, ...(key === 'newAreaId' ? { newProjectId: '' } : {}) }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    const now = new Date().toISOString()
    const request: PlacementChangeRequest = { id: existing?.id ?? `movement-request-${Date.now()}`, employeeId: employee.id, movementType: form.movementType as Extract<EmployeeMovementType, 'PROMOTION' | 'MUTATION' | 'AREA_CHANGE' | 'PROJECT_CHANGE' | 'POSITION_CHANGE'>, effectiveDate: form.effectiveDate, previousAreaId: employee.areaId, newAreaId: form.newAreaId || null, previousProjectId: employee.projectId, newProjectId: form.newProjectId || null, previousPosition: employee.position, newPosition: form.newPosition || null, notes: form.notes, createdBy: existing?.createdBy ?? currentUser.id, validationStatus: intent, validatedBy: null, validatedAt: null, submittedAt: intent === 'SUBMITTED' ? now : existing?.submittedAt ?? null, revisionNote: intent === 'SUBMITTED' ? null : existing?.revisionNote ?? null, createdAt: existing?.createdAt ?? now, updatedAt: now }
    setSaving(true)
    const result = await saveMovementRequest(request)
    setSaving(false)
    if (result.ok) navigate(`/employees/${employee.id}`)
    else setError(result.error ?? 'Gagal menyimpan.')
  }
  return <>
    <Link className="back-link" to={`/employees/${employee.id}`}><ArrowLeft /> Kembali ke Employee Detail</Link>
    <ActionError message={error} />
    <PageHeader eyebrow="PLACEMENT MOVEMENT" title="Tambah Perubahan / Movement" description="Perubahan penempatan berlaku setelah divalidasi." />
    {existing?.revisionNote && <div className="alert warning"><div><strong>Perlu revisi</strong><p>{existing.revisionNote}</p></div></div>}
    <form className="card form-card" onSubmit={submit}><div className="form-section-title"><span className="section-icon"><GitBranch /></span><div><h2>Current → New Placement</h2><p>Nilai lama disimpan ke movement history.</p></div></div><div className="placement-form-split"><section><h3>Current</h3><dl><div><dt>Area</dt><dd>{currentArea?.name ?? 'Belum tersedia'}</dd></div><div><dt>Project</dt><dd>{currentProject?.name ?? 'Belum tersedia'}</dd></div><div><dt>Position</dt><dd>{employee.position ?? 'Belum tersedia'}</dd></div></dl></section><section><h3>New</h3><div className="form-grid compact"><label>Movement Type *<select required value={form.movementType} onChange={(event) => update('movementType', event.target.value)}>{supportedTypes.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label><label>Effective Date *<input type="date" required value={form.effectiveDate} onChange={(event) => update('effectiveDate', event.target.value)} /></label><label>Area *<select required value={form.newAreaId} onChange={(event) => update('newAreaId', event.target.value)}>{areas.filter((area) => accessibleAreas === null || accessibleAreas.includes(area.id)).map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select></label><label>Project *<select required value={form.newProjectId} onChange={(event) => update('newProjectId', event.target.value)}><option value="">Pilih project</option>{projects.filter((project) => project.areaId === form.newAreaId && (accessibleAreas === null || accessibleAreas.includes(project.areaId))).map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><label>Position *<select required value={form.newPosition} onChange={(event) => update('newPosition', event.target.value)}>{positions.map((position) => <option key={position}>{position}</option>)}</select></label><label className="span-two">Notes *<textarea required rows={3} value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Jelaskan alasan perubahan..." /></label></div></section></div><div className="form-actions"><Link className="button ghost" to={`/employees/${employee.id}`}>Batal</Link><button type="submit" className="button secondary" onClick={() => setIntent('DRAFT')}><Save /> Simpan Draft</button><button type="submit" className="button primary" onClick={() => setIntent('SUBMITTED')}><Send /> Kirim untuk Validasi</button></div></form>
  </>
}
