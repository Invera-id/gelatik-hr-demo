import { ArrowLeft, Save, Send, UserPlus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { heightSpec, measureError, measureInputValue, weightSpec } from '../lib/measure'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { ActionError } from '../components/ActionError'
import { useDemo } from '../context/DemoContext'
import { positions } from '../data/demoData'
import { canAccessEmployee } from '../lib/businessRules'
import type { ContractStatus, Employee } from '../types'
import { allowedAreaIds } from '../config/access'

export function EmployeeEntryPage() {
  const { employeeId } = useParams(); const { currentUser, areas, employees, projects, saveEmployee, permissionConfig, fetchEmployeeDetail } = useDemo(); const navigate = useNavigate()
  const existing = employees.find((item) => item.id === employeeId)
  // A pending basic-edit request is edited in place; its values are not effective yet.
  const proposed = (existing?.pendingChange?.proposed ?? {}) as Partial<Record<'name' | 'joinDate' | 'contractStatus' | 'contractStartDate' | 'contractEndDate' | 'bpjsStatus', string | null>>
  const draft = { ...existing, ...Object.fromEntries(Object.entries(proposed).filter(([, value]) => value !== undefined)) } as Partial<Employee>
  const accessibleAreas = currentUser ? allowedAreaIds(currentUser, permissionConfig) : []
  const lockedArea = accessibleAreas?.length === 1 ? accessibleAreas[0] : null
  const [form, setForm] = useState({ personnelId: existing?.personnelId ?? '', name: draft.name ?? '', areaId: existing?.areaId ?? lockedArea ?? '', projectId: existing?.projectId ?? '', position: existing?.position ?? '', joinDate: draft.joinDate ?? '', contractStatus: draft.contractStatus ?? 'DRAFT', contractStartDate: draft.contractStartDate ?? '', contractEndDate: draft.contractEndDate ?? '', bpjsStatus: draft.bpjsStatus ?? '' })
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  // Measurements live in the full profile (detail endpoint). Until it is loaded for an
  // existing record they are not sent, so the server keeps the stored values.
  const [measures, setMeasures] = useState({ height: '', weight: '' })
  const [measuresReady, setMeasuresReady] = useState(!existing)
  useEffect(() => {
    if (!existing || !fetchEmployeeDetail) return
    let cancelled = false
    void fetchEmployeeDetail(existing.id).then((full) => {
      if (cancelled || !full) return
      const pending = (full.pendingChange?.proposed as { profile?: Record<string, string | null> } | undefined)?.profile ?? {}
      const pick = (key: 'height' | 'weight') => key in pending ? pending[key] : (full.profile?.[key] as string | null | undefined)
      setMeasures({ height: measureInputValue(pick('height'), heightSpec), weight: measureInputValue(pick('weight'), weightSpec) })
      setMeasuresReady(true)
    })
    return () => { cancelled = true }
  }, [existing?.id, fetchEmployeeDetail]) // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false)
  const [intent, setIntent] = useState<'DRAFT' | 'SUBMITTED'>('DRAFT')
  if (!currentUser || (existing && !canAccessEmployee(currentUser, existing, permissionConfig))) return <Navigate to="/employees" replace />
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value, ...(key === 'areaId' ? { projectId: '' } : {}) }))
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (saving) return; const now = new Date().toISOString()
    const clientErrors: Record<string, string> = {}
    for (const [key, spec] of [['height', heightSpec], ['weight', weightSpec]] as const) { const msg = measureError(measures[key], spec); if (msg) clientErrors[key] = msg }
    setFieldErrors(clientErrors)
    if (Object.keys(clientErrors).length) { setError('Data belum valid. Periksa kembali isian yang ditandai.'); return }
    const employee: Employee = { id: existing?.id ?? `employee-${now}`, personnelId: form.personnelId, name: form.name, areaId: form.areaId || null, subArea: existing?.subArea ?? null, projectId: form.projectId || null, position: form.position || null, employmentStatus: existing?.employmentStatus ?? 'ACTIVE', joinDate: form.joinDate || null, contractStartDate: form.contractStartDate || null, contractEndDate: form.contractEndDate || null, contractStatus: form.contractStatus as ContractStatus, bpjsStatus: form.bpjsStatus || null, profile: { ...existing?.profile, areaCbs: areas.find((area) => area.id === form.areaId)?.name ?? null }, createdBy: existing?.createdBy ?? currentUser.id, validationStatus: intent, validationTransaction: existing ? 'EMPLOYEE_BASIC_EDIT' : 'EMPLOYEE_ENTRY', validatedBy: intent === 'SUBMITTED' ? null : existing?.validatedBy ?? null, validatedAt: intent === 'SUBMITTED' ? null : existing?.validatedAt ?? null, submittedAt: intent === 'SUBMITTED' ? now : existing?.submittedAt ?? null, revisionNote: intent === 'SUBMITTED' ? null : existing?.revisionNote ?? null, createdAt: existing?.createdAt ?? now, updatedAt: now }
    setSaving(true); const result = await saveEmployee(employee, measuresReady ? measures : undefined); setSaving(false)
    if (result.ok) navigate(`/employees/${result.id ?? employee.id}`); else { setError(result.error ?? 'Gagal menyimpan.'); setFieldErrors(result.fields ?? {}) }
  }
  return <><Link to={existing ? `/employees/${existing.id}` : '/employees'} className="back-link"><ArrowLeft size={16} /> Kembali</Link><PageHeader eyebrow="AREA INPUT" title={existing ? 'Edit Employee' : 'Employee Entry'} description="Lengkapi data berdasarkan source data yang disediakan oleh pemilik data." />
    <ActionError message={error} />
    {existing?.pendingChange && <div className="alert warning"><div><strong>{existing.pendingChange.status === 'REVISION_REQUIRED' ? 'Perubahan data perlu revisi' : 'Perubahan data menunggu validasi'}</strong><p>Data efektif belum berubah sampai perubahan divalidasi.</p></div></div>}
    {existing?.validationStatus === 'REVISION_REQUIRED' && <div className="alert warning"><div><strong>Perlu revisi</strong><p>{existing.revisionNote || 'Periksa kembali data sebelum dikirim ulang.'}</p></div></div>}
    <form className="card form-card" onSubmit={submit}><div className="form-section-title"><span className="section-icon"><UserPlus /></span><div><h2>Data Employee</h2><p>Kolom bertanda * wajib diisi sebelum disimpan.</p></div></div><div className="form-grid">
      <label>Personnel ID *<input required value={form.personnelId} onChange={(event) => update('personnelId', event.target.value)} placeholder="Contoh: EMP-025" /></label><label>Nama Lengkap *<input required value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
      <label>Area *<select required value={form.areaId} disabled={Boolean(existing || lockedArea)} onChange={(event) => update('areaId', event.target.value)}><option value="">Pilih area</option>{areas.filter((area) => accessibleAreas === null || accessibleAreas.includes(area.id)).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>Project *<select required value={form.projectId} disabled={Boolean(existing)} onChange={(event) => update('projectId', event.target.value)}><option value="">Pilih project</option>{projects.filter((project) => project.areaId === form.areaId).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Position *<select required value={form.position} disabled={Boolean(existing)} onChange={(event) => update('position', event.target.value)}><option value="">Pilih position</option>{positions.map((position) => <option key={position}>{position}</option>)}</select></label><label>Join Date *<input type="date" required value={form.joinDate} onChange={(event) => update('joinDate', event.target.value)} /></label>
      <label>Contract Status *<select required value={form.contractStatus} onChange={(event) => update('contractStatus', event.target.value)}><option value="NOT_AVAILABLE">Belum tersedia</option><option value="DRAFT">Draft</option><option value="SIGNED">Ditandatangani</option></select></label><label>BPJS Status<select value={form.bpjsStatus} onChange={(event) => update('bpjsStatus', event.target.value)}><option value="">Belum tersedia</option><option>Aktif</option><option>Dalam proses</option><option>Belum aktif</option></select></label>
      <label>Contract Start Date<input type="date" value={form.contractStartDate} onChange={(event) => update('contractStartDate', event.target.value)} /></label><label>Contract End Date<input type="date" value={form.contractEndDate} onChange={(event) => update('contractEndDate', event.target.value)} /></label>
      {([['height', 'Tinggi Badan', heightSpec], ['weight', 'Berat Badan', weightSpec]] as const).map(([key, label, spec]) => <label key={key}>{label} ({spec.unit})
        <span className="search-box"><input inputMode="decimal" value={measures[key]} disabled={!measuresReady} aria-invalid={Boolean(fieldErrors[key])} aria-describedby={`${key}-help`}
          placeholder={measuresReady ? `contoh: ${spec.hint}` : 'Memuat…'} onChange={(event) => { const value = event.target.value; setMeasures((current) => ({ ...current, [key]: value })); setFieldErrors((current) => { const next = { ...current }; delete next[key]; return next }) }} /><span>{spec.unit}</span></span>
        <small id={`${key}-help`} className={fieldErrors[key] ? 'form-error' : ''}>{fieldErrors[key] ?? `Angka, boleh desimal koma/titik (maks. 2 desimal). Kosongkan jika belum ada; kosong tidak sama dengan 0.`}</small></label>)}
    </div><div className="form-actions"><Link className="button ghost" to={existing ? `/employees/${existing.id}` : '/employees'}>Batal</Link><button className="button secondary" type="submit" onClick={() => setIntent('DRAFT')}><Save size={17} /> Simpan Draft</button><button className="button primary" type="submit" onClick={() => setIntent('SUBMITTED')}><Send size={17} /> Kirim untuk Validasi</button></div></form>
  </>
}
