import { ArrowLeft, Save, Send, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { useDemo } from '../context/DemoContext'
import { positions } from '../data/demoData'
import { canAccessEmployee } from '../lib/businessRules'
import type { ContractStatus, Employee } from '../types'
import { allowedAreaIds } from '../config/access'

export function EmployeeEntryPage() {
  const { employeeId } = useParams(); const { currentUser, areas, employees, projects, saveEmployee, permissionConfig } = useDemo(); const navigate = useNavigate()
  const existing = employees.find((item) => item.id === employeeId)
  const accessibleAreas = currentUser ? allowedAreaIds(currentUser, permissionConfig) : []
  const lockedArea = accessibleAreas?.length === 1 ? accessibleAreas[0] : null
  const [form, setForm] = useState({ personnelId: existing?.personnelId ?? '', name: existing?.name ?? '', areaId: existing?.areaId ?? lockedArea ?? '', projectId: existing?.projectId ?? '', position: existing?.position ?? '', joinDate: existing?.joinDate ?? '', contractStatus: existing?.contractStatus ?? 'DRAFT', contractStartDate: existing?.contractStartDate ?? '', contractEndDate: existing?.contractEndDate ?? '', bpjsStatus: existing?.bpjsStatus ?? '' })
  const [intent, setIntent] = useState<'DRAFT' | 'SUBMITTED'>('DRAFT')
  if (!currentUser || (existing && !canAccessEmployee(currentUser, existing, permissionConfig))) return <Navigate to="/employees" replace />
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value, ...(key === 'areaId' ? { projectId: '' } : {}) }))
  const submit = (event: FormEvent) => {
    event.preventDefault(); const now = new Date().toISOString()
    const employee: Employee = { id: existing?.id ?? `employee-${now}`, personnelId: form.personnelId, name: form.name, areaId: form.areaId || null, subArea: existing?.subArea ?? null, projectId: form.projectId || null, position: form.position || null, employmentStatus: existing?.employmentStatus ?? 'ACTIVE', joinDate: form.joinDate || null, contractStartDate: form.contractStartDate || null, contractEndDate: form.contractEndDate || null, contractStatus: form.contractStatus as ContractStatus, bpjsStatus: form.bpjsStatus || null, profile: { ...existing?.profile, areaCbs: areas.find((area) => area.id === form.areaId)?.name ?? null }, createdBy: existing?.createdBy ?? currentUser.id, validationStatus: intent, validationTransaction: existing ? 'EMPLOYEE_BASIC_EDIT' : 'EMPLOYEE_ENTRY', validatedBy: intent === 'SUBMITTED' ? null : existing?.validatedBy ?? null, validatedAt: intent === 'SUBMITTED' ? null : existing?.validatedAt ?? null, submittedAt: intent === 'SUBMITTED' ? now : existing?.submittedAt ?? null, revisionNote: intent === 'SUBMITTED' ? null : existing?.revisionNote ?? null, createdAt: existing?.createdAt ?? now, updatedAt: now }
    saveEmployee(employee); navigate(`/employees/${employee.id}`)
  }
  return <><Link to={existing ? `/employees/${existing.id}` : '/employees'} className="back-link"><ArrowLeft size={16} /> Kembali</Link><PageHeader eyebrow="AREA INPUT" title={existing ? 'Edit Employee' : 'Employee Entry'} description="Lengkapi data berdasarkan source data yang disediakan oleh pemilik data." />
    {existing?.validationStatus === 'REVISION_REQUIRED' && <div className="alert warning"><div><strong>Perlu revisi</strong><p>{existing.revisionNote || 'Periksa kembali data sebelum dikirim ulang.'}</p></div></div>}
    <form className="card form-card" onSubmit={submit}><div className="form-section-title"><span className="section-icon"><UserPlus /></span><div><h2>Data Employee</h2><p>Kolom bertanda * wajib diisi sebelum disimpan.</p></div></div><div className="form-grid">
      <label>Personnel ID *<input required value={form.personnelId} onChange={(event) => update('personnelId', event.target.value)} placeholder="Contoh: EMP-025" /></label><label>Nama Lengkap *<input required value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
      <label>Area *<select required value={form.areaId} disabled={Boolean(existing || lockedArea)} onChange={(event) => update('areaId', event.target.value)}><option value="">Pilih area</option>{areas.filter((area) => accessibleAreas === null || accessibleAreas.includes(area.id)).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>Project *<select required value={form.projectId} disabled={Boolean(existing)} onChange={(event) => update('projectId', event.target.value)}><option value="">Pilih project</option>{projects.filter((project) => project.areaId === form.areaId).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Position *<select required value={form.position} disabled={Boolean(existing)} onChange={(event) => update('position', event.target.value)}><option value="">Pilih position</option>{positions.map((position) => <option key={position}>{position}</option>)}</select></label><label>Join Date *<input type="date" required value={form.joinDate} onChange={(event) => update('joinDate', event.target.value)} /></label>
      <label>Contract Status *<select required value={form.contractStatus} onChange={(event) => update('contractStatus', event.target.value)}><option value="NOT_AVAILABLE">Belum tersedia</option><option value="DRAFT">Draft</option><option value="SIGNED">Ditandatangani</option></select></label><label>BPJS Status<select value={form.bpjsStatus} onChange={(event) => update('bpjsStatus', event.target.value)}><option value="">Belum tersedia</option><option>Aktif</option><option>Dalam proses</option><option>Belum aktif</option></select></label>
      <label>Contract Start Date<input type="date" value={form.contractStartDate} onChange={(event) => update('contractStartDate', event.target.value)} /></label><label>Contract End Date<input type="date" value={form.contractEndDate} onChange={(event) => update('contractEndDate', event.target.value)} /></label>
    </div><div className="form-actions"><Link className="button ghost" to={existing ? `/employees/${existing.id}` : '/employees'}>Batal</Link><button className="button secondary" type="submit" onClick={() => setIntent('DRAFT')}><Save size={17} /> Simpan Draft</button><button className="button primary" type="submit" onClick={() => setIntent('SUBMITTED')}><Send size={17} /> Kirim untuk Validasi</button></div></form>
  </>
}
