import { AlertTriangle, ArrowLeft, BriefcaseBusiness, CalendarDays, Edit3, Flag, GitBranch, LogOut, MapPin, RotateCcw, StickyNote, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ActionError } from '../components/ActionError'
import type { Employee } from '../types'
import { Link, Navigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { CareerTimeline } from '../components/CareerTimeline'
import { validationTone } from '../components/statusTones'
import { useEmployeeDocumentGaps } from '../hooks/useEmployeeDocumentGaps'
import { useDemo } from '../context/DemoContext'
import { canAccessEmployee, conditionNeedsReview, contractLabels, formatDate, hasCompleteSourceData, validationLabels } from '../lib/businessRules'
import { hasPermission } from '../config/access'
import { employeeFieldGroups } from '../config/employeeDictionary'
import { latestValidatedExit } from '../lib/employeeViews'
import { DocumentsPanel } from '../components/DocumentsPanel'
import { dataSource } from '../config/dataSource'

function Field({ label, value }: { label: string; value: string | null | undefined }) { return <div className="detail-field"><span>{label}</span><strong className={!value ? 'missing-text' : ''}>{value || 'Belum tersedia'}</strong></div> }

export function EmployeeDetailPage() {
  const { employeeId } = useParams()
  const { currentUser, areas, employees, projects, movements, employeeMovements, employeeExits, employeeNotes, employeeFlags, permissionConfig, addEmployeeNote, setEmployeeFlag, pendingReviewFor, fetchEmployeeDetail } = useDemo()
  const listed = employees.find((item) => item.id === employeeId)
  // API mode: list data carries a reduced profile; the full profile comes from the detail endpoint.
  const [detail, setDetail] = useState<{ id: string; profile: Employee['profile'] | null } | null>(null)
  const [detailTick, setDetailTick] = useState(0)
  const [actionError, setActionError] = useState('')
  useEffect(() => {
    if (!fetchEmployeeDetail || !employeeId) return
    let cancelled = false
    void fetchEmployeeDetail(employeeId).then((full) => { if (!cancelled) setDetail({ id: employeeId, profile: full?.profile ?? null }) })
    return () => { cancelled = true }
  }, [fetchEmployeeDetail, employeeId, listed?.updatedAt, detailTick])
  // Until the full profile arrives (or if it fails) the list's reduced profile must not be
  // presented as "Belum tersedia": that would claim data is missing when it is only not loaded.
  const detailState: 'ok' | 'loading' | 'error' = !fetchEmployeeDetail ? 'ok' : !detail || detail.id !== employeeId ? 'loading' : detail.profile ? 'ok' : 'error'
  const employee = listed && detail?.id === listed.id && detail.profile ? { ...listed, profile: detail.profile } : listed
  const docGaps = useEmployeeDocumentGaps(Boolean(fetchEmployeeDetail))
  if (!currentUser || !employee || !canAccessEmployee(currentUser, employee, permissionConfig)) return <Navigate to="/employees" replace />
  const pendingImportReview = pendingReviewFor(employee.id)
  const area = areas.find((item) => item.id === employee.areaId); const project = projects.find((item) => item.id === employee.projectId)
  const history = movements.filter((item) => item.employeeId === employee.id).sort((a, b) => b.date.localeCompare(a.date))
  const activeExit = employeeExits.find((item) => item.employeeId === employee.id && ['DRAFT', 'SUBMITTED', 'REVISION_REQUIRED'].includes(item.validationStatus))
  const notes = employeeNotes.filter((item) => item.employeeId === employee.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const flag = employeeFlags.filter((item) => item.employeeId === employee.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const validatedExit = latestValidatedExit(employee.id, employeeExits)
  const canEdit = hasPermission(currentUser, permissionConfig, 'edit_employee_basic')
  const canReentry = hasPermission(currentUser, permissionConfig, 'reentry_employee')
  const canMove = hasPermission(currentUser, permissionConfig, 'request_placement_change')
  const canExit = hasPermission(currentUser, permissionConfig, 'request_employee_exit')
  const canManageNotes = hasPermission(currentUser, permissionConfig, 'manage_employee_notes_flags')
  return <><Link to="/employees" className="back-link"><ArrowLeft size={16} /> Kembali ke Master Employee</Link>
    <PageHeader eyebrow={employee.personnelId} title={employee.name} description={`${area?.name ?? 'Area belum tersedia'} · ${project?.name ?? 'Project belum tersedia'}`} actions={(canEdit || canReentry || canMove || canExit) && <>{canEdit && <Link className="button secondary" to={`/employees/${employee.id}/edit`}><Edit3 size={17} /> Edit</Link>}{employee.employmentStatus === 'INACTIVE' && canReentry && <Link className="button primary" to={`/employees/${employee.id}/reentry`}><RotateCcw size={17} /> Re-entry Employee</Link>}{employee.employmentStatus === 'ACTIVE' && canMove && <Link className="button secondary" to={`/employees/${employee.id}/movement`}><GitBranch size={17} /> Tambah Movement</Link>}{employee.employmentStatus === 'ACTIVE' && canExit && <Link className="button danger-outline" to={`/employees/${employee.id}/exit`}><LogOut size={17} /> Employee Exit</Link>}</>} />
    <ActionError message={actionError} />
    {(() => { const gap = docGaps.byId.get(employee.id); return gap && <div className="alert warning"><AlertTriangle /><div><strong>PKWT belum lengkap</strong><p>{docGaps.describe(gap)}. Karyawan tetap dapat divalidasi; unggah dokumen di bagian <a href="#documents">Dokumen</a> di bawah.</p></div></div> })()}
    {conditionNeedsReview(employee) && <div className="alert warning"><AlertTriangle /><div><strong>Kondisi terkini perlu ditinjau</strong><p>Personil ini memiliki catatan impor yang ambigu, sehingga kondisi terkininya belum dapat dipastikan dan tidak dihitung sebagai workforce aktif sampai ditinjau. <Link to="/import">Buka antrean peninjauan →</Link></p></div></div>}
    {!hasCompleteSourceData(employee) && <div className="alert warning"><AlertTriangle /><div><strong>Data sumber belum lengkap</strong><p>Area, Project, dan Posisi harus dilengkapi oleh pihak pemilik data sebelum proses fulfillment dapat dilakukan.</p></div></div>}
    {activeExit && <div className="alert info"><CalendarDays /><div><strong>Proses exit sedang berjalan</strong><p>Status saat ini: {validationLabels[activeExit.validationStatus]}.</p></div></div>}
    <div className="detail-grid"><section className="card detail-section"><div className="section-heading"><UserRound /><h2>Informasi Dasar</h2></div><div className="field-grid"><Field label="Personnel ID" value={employee.personnelId} /><Field label="Nama Lengkap" value={employee.name} /></div></section>
      <section className="card detail-section"><div className="section-heading"><MapPin /><h2>Penempatan</h2></div><div className="field-grid"><Field label="Area" value={area?.name ?? employee.profile?.areaCbs} /><Field label="Sub Area" value={employee.subArea} /><Field label="Client" value={project?.clientName ?? employee.profile?.clientName} /><Field label="Project" value={project?.name ?? employee.profile?.projectName} /><Field label="Position" value={employee.position} /></div></section>
      <section className="card detail-section"><div className="section-heading"><BriefcaseBusiness /><h2>Employment</h2></div><div className="field-grid"><Field label="Employment Status" value={employee.employmentStatus} /><Field label="Join Date" value={formatDate(employee.joinDate)} /><Field label="Contract Start" value={formatDate(employee.contractStartDate)} /><Field label="Contract End" value={formatDate(employee.contractEndDate)} /><Field label="Contract Status" value={contractLabels[employee.contractStatus]} /><div className="detail-field"><span>Validation Status</span><strong><StatusBadge tone={validationTone(employee.validationStatus)}>{validationLabels[employee.validationStatus]}</StatusBadge></strong></div></div></section>
      <section className="card detail-section"><div className="section-heading"><CalendarDays /><h2>Informasi Demo Lainnya</h2></div><div className="field-grid"><Field label="BPJS Status" value={employee.bpjsStatus} /><Field label="Terakhir diperbarui" value={formatDate(employee.updatedAt, true)} /></div></section>
    </div>
    <section className="employee-schema-section"><div className="schema-section-head"><h2>Expanded Employee Database</h2><p>Field detail dikelompokkan mengikuti struktur referensi. Data yang tidak tersedia tetap ditandai Belum Diisi; sistem tidak menebaknya. Sel Excel berisi tanda "-" dibaca sebagai kosong.</p></div>{detailState === 'loading' ? <p className="empty-inline">Memuat data lengkap…</p> : detailState === 'error' ? <div className="alert error"><div><strong>Data lengkap tidak dapat dimuat</strong><p>Field di bawah tidak ditampilkan agar tidak terbaca sebagai kosong.</p></div><button className="button ghost" onClick={() => setDetailTick((n) => n + 1)}>Coba lagi</button></div> : <div className="schema-group-grid">{employeeFieldGroups.map((group) => <section className="card schema-group" key={group.title}><div className="schema-group-head">{group.title}<span>{group.fields.length} fields</span></div><div className="field-grid">{group.fields.map(([key, label]) => <Field key={key} label={label} value={key === 'exitDate' ? validatedExit?.exitDate ?? employee.profile?.exitDate : key === 'exitReason' ? validatedExit?.exitReason ?? employee.profile?.exitReason : employee.profile?.[key]} />)}</div></section>)}</div>}</section>
    <div className="employee-review-grid"><section className="card review-card"><div className="section-heading"><Flag /><h2>Employee Flag</h2></div>{flag ? <div className="flag-summary"><StatusBadge tone={flag.status === 'FLAGGED' ? 'danger' : flag.status === 'REVIEW_REQUIRED' ? 'warning' : 'success'}>{flag.status.replaceAll('_', ' ')}</StatusBadge><strong>{flag.reason}</strong><p>{flag.notes}</p></div> : <div className="empty-inline">Tidak ada flag historis.</div>}{canManageNotes && <button className="button secondary" onClick={() => { const reason = window.prompt('Alasan flag:', 'Perlu review manual'); if (reason) void setEmployeeFlag(employee.id, 'REVIEW_REQUIRED', reason, 'Warning untuk review manual, bukan keputusan otomatis.') }}><Flag /> Tambah Flag Review</button>}<div className="rule-note compact-note">Flag adalah warning manual, bukan blacklist otomatis.</div></section><section className="card review-card"><div className="section-heading"><StickyNote /><h2>Employee Notes</h2></div><div className="note-list">{notes.map((note) => <div key={note.id}><p>{note.notes}</p><small>{formatDate(note.createdAt, true)}</small></div>)}{notes.length === 0 && <div className="empty-inline">Belum ada employee notes.</div>}</div>{canManageNotes && <button className="button secondary" onClick={() => { const note = window.prompt('Employee note:'); if (note) void addEmployeeNote(employee.id, note).then((result) => setActionError(result.ok ? '' : result.error ?? 'Catatan tidak tersimpan.')) }}><StickyNote /> Tambah Note</button>}</section></div>
    {pendingImportReview.length > 0 && <section className="card timeline-card"><div className="section-heading"><AlertTriangle /><h2>Riwayat Impor Perlu Ditinjau</h2></div><div className="rule-note compact-note">Catatan ini belum dikonfirmasi dan tidak masuk career history sampai ditinjau. <Link to="/import">Buka antrean peninjauan →</Link></div><div className="pending-review-list">{pendingImportReview.map((item) => <div key={item.id} className="pending-review-row"><div className="review-tags">{item.aspects.map((a) => <StatusBadge key={a} tone={a === 'EXIT' ? 'danger' : a === 'PLACEMENT_CHANGE' ? 'info' : a === 'IDENTITY_CONFLICT' ? 'warning' : 'purple'}>{a.replaceAll('_', ' ')}</StatusBadge>)}</div><p>{item.reason}</p><small>{item.recordIds.length} catatan berbeda · baris {item.rowNumbers.join(', ')}</small></div>)}</div></section>}
    {dataSource === 'api' && <DocumentsPanel employeeId={employee.id} />}
    <section className="card timeline-card"><div className="section-heading"><BriefcaseBusiness /><h2>Career & Placement History</h2></div><CareerTimeline records={employeeMovements.filter((item) => item.employeeId === employee.id)} /></section>
    <section className="card timeline-card"><div className="section-heading"><CalendarDays /><h2>Movement History</h2></div>{history.length ? <div className="timeline">{history.map((item) => <div key={item.id} className="timeline-item"><span className={`timeline-dot ${item.type.toLowerCase()}`} /><div><strong>{item.title}</strong><p>{item.description}</p><small>{formatDate(item.date, true)}</small></div></div>)}</div> : <div className="empty-inline">Belum ada movement history untuk employee ini.</div>}</section>
  </>
}
