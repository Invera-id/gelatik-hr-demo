import { AlertTriangle, Check, ClipboardCheck, Eye, GitBranch, Loader2, RotateCcw, Search, UserMinus, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { ActionError } from '../components/ActionError'
import type { ActionResult } from '../context/DemoContext'
import { StatusBadge } from '../components/StatusBadge'
import { validationTone } from '../components/statusTones'
import { useDemo } from '../context/DemoContext'
import { formatDate, hasCompleteSourceData, validationLabels } from '../lib/businessRules'
import { canValidateTransaction, hasPermission } from '../config/access'
import { canAccessEmployee } from '../lib/businessRules'
import type { Schemas } from '../api/client'
import { dataSource } from '../config/dataSource'
import { useApiResource } from '../hooks/useApiResource'
import { useEmployeeDocumentGaps } from '../hooks/useEmployeeDocumentGaps'

type Readiness = Schemas['ValidationReadiness']
type ReadinessIssue = Schemas['ReadinessIssue']
type ReadinessFilter = 'ALL' | 'READY' | 'CHECK' | 'BLOCKED'
const issueLabels: Record<ReadinessIssue['code'], string> = {
  PLACEMENT_INCOMPLETE: 'Penempatan belum lengkap',
  IMPORT_REVIEW: 'Perlu review import',
  DOCUMENTS_INCOMPLETE: 'Dokumen wajib belum lengkap',
  IMPORT_WARNING: 'Peringatan import',
  CONTRACT_CHECK: 'Cek data kontrak',
}
const issueText = (issue: ReadinessIssue) => issue.code === 'IMPORT_WARNING'
  ? `Baris ${issue.rowNumber ?? '?'} · ${issue.column ?? '—'}${issue.rawValue ? ` "${issue.rawValue}"` : ''}: ${issue.message}`
  : issue.message

/** Server pre-check shown above the queue: what is ready, what needs a look, what is held back and why. */
function ReadinessPanel({ data, filter, onFilter }: { data: Readiness; filter: ReadinessFilter; onFilter: (f: ReadinessFilter) => void }) {
  const cards: Array<[ReadinessFilter, number, string, string]> = [
    ['READY', data.ready, 'Siap divalidasi', 'Tidak ada temuan; ikut Validasi yang Valid dan Validasi Semua.'],
    ['CHECK', data.needsCheck, 'Perlu dicek', 'Hanya temuan informatif (peringatan import, data kontrak). Ikut Validasi Semua, tidak ikut Validasi yang Valid.'],
    ['BLOCKED', data.blocked, 'Tertahan', 'Ada syarat yang belum terpenuhi; tidak dapat divalidasi sekarang.'],
  ]
  return <div className="readiness">
    <div className="readiness-cards">{cards.map(([key, count, label, hint]) => <button type="button" key={key} className={`readiness-card ${key.toLowerCase()} ${filter === key ? 'active' : ''}`} onClick={() => onFilter(filter === key ? 'ALL' : key)}><strong>{count}</strong><span>{label}</span><small>{hint}</small></button>)}</div>
    {data.issues.length > 0 && <div className="readiness-chips"><span>Temuan (jumlah personel):</span>{data.issues.map((i) => <StatusBadge key={i.code} tone={i.blocking ? 'danger' : 'warning'}>{issueLabels[i.code]} · {i.count}</StatusBadge>)}</div>}
    {data.warningColumns.length > 0 && <div className="readiness-chips"><span>Kolom dengan peringatan import:</span>{data.warningColumns.slice(0, 12).map((c) => <span className="issue-chip" key={c.column}><strong>{c.column}</strong> {c.count}</span>)}</div>}
    <p className="readiness-note">Dihitung server dari {data.total} entry berstatus Menunggu validasi dalam cakupan Anda, hanya dengan aturan yang sudah berlaku. Klik kartu untuk menyaring daftar.</p>
  </div>
}

export function ValidationPage() {
  const { currentUser, areas, employees, projects, employeeExits, movementRequests, permissionConfig, validationPolicy, setEmployeeValidation, validateEmployees, setExitValidation, setMovementValidation, users } = useDemo()
  const [actionError, setActionError] = useState('')
  // Document state per submission (server-computed); final validation is blocked server-side until complete.
  const docs = useApiResource<Schemas['DocumentQueue']>('/documents/queue', { status: 'ALL' }, dataSource === 'api')
  const docByKey = new Map((docs.data?.items ?? []).map((item) => [`${item.subjectType}:${item.subjectId}`, item]))
  const docBadge = (key: string, employeeId: string) => {
    const item = docByKey.get(key)
    if (!item || item.requiredTotal === 0) return null
    return <Link to={`/employees/${employeeId}#documents`}><StatusBadge tone={item.complete ? 'success' : 'warning'}>Dokumen wajib {item.requiredAccepted}/{item.requiredTotal} diterima</StatusBadge></Link>
  }
  const canSeeReadiness = Boolean(currentUser && hasPermission(currentUser, permissionConfig, 'validate_employee_entry_edit'))
  const docGaps = useEmployeeDocumentGaps(dataSource === 'api')
  const readiness = useApiResource<Readiness>('/validation/readiness', undefined, dataSource === 'api' && canSeeReadiness)
  const issuesById = new Map((readiness.data?.items ?? []).map((item) => [item.employeeId, item.issues]))
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>('ALL')
  const readinessOf = (id: string): ReadinessFilter => { const issues = issuesById.get(id); return !issues ? 'READY' : issues.some((i) => i.blocking) ? 'BLOCKED' : 'CHECK' }
  const act = async (pending: Promise<ActionResult>) => { const result = await pending; setActionError(result.ok ? '' : result.error ?? 'Keputusan tidak tersimpan.'); docs.reload(); readiness.reload() }
  // A pending basic-edit request on a validated record is reviewed here too; it is not effective yet.
  const entryStatus = (employee: (typeof employees)[number]) => employee.pendingChange && employee.validationStatus === 'VALIDATED' ? employee.pendingChange.status : employee.validationStatus
  const [searchParams] = useSearchParams()
  const focusId = searchParams.get('focus')
  const pendingEntries = employees.filter((employee) => ['SUBMITTED', 'REVISION_REQUIRED'].includes(entryStatus(employee)) && (!currentUser || canAccessEmployee(currentUser, employee, permissionConfig)))
  const pendingExits = employeeExits.filter((exit) => { const employee = employees.find((item) => item.id === exit.employeeId); return ['SUBMITTED', 'REVISION_REQUIRED'].includes(exit.validationStatus) && Boolean(employee && (!currentUser || canAccessEmployee(currentUser, employee, permissionConfig))) })
  const focusInExit = Boolean(focusId && pendingExits.some((exit) => exit.employeeId === focusId))
  const [tab, setTab] = useState<'ENTRY' | 'EXIT'>(focusInExit ? 'EXIT' : 'ENTRY')
  useEffect(() => {
    if (!focusId) return
    const node = document.getElementById(`val-${focusId}`)
    if (node) { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); node.classList.add('val-focused') }
  }, [focusId, tab])
  const pendingMovements = movementRequests.filter((request) => { const employee = employees.find((item) => item.id === request.employeeId); return ['SUBMITTED', 'REVISION_REQUIRED'].includes(request.validationStatus) && Boolean(employee && (!currentUser || canAccessEmployee(currentUser, employee, permissionConfig))) })
  const records = tab === 'ENTRY' ? pendingEntries : pendingExits
  const askRevisionNote = () => window.prompt('Catatan revisi (opsional):', '') ?? undefined
  const canValidateEntry = (employee: (typeof employees)[number]) => Boolean(currentUser && hasPermission(currentUser, permissionConfig, 'validate_employee_entry_edit') && canValidateTransaction(currentUser, employee.validationTransaction ?? 'EMPLOYEE_ENTRY', validationPolicy))
  const canValidateExit = Boolean(currentUser && hasPermission(currentUser, permissionConfig, 'validate_employee_exit') && canValidateTransaction(currentUser, 'EMPLOYEE_EXIT', validationPolicy))
  const canValidateMovement = Boolean(currentUser && hasPermission(currentUser, permissionConfig, 'validate_placement_change') && canValidateTransaction(currentUser, 'EMPLOYEE_PLACEMENT_CHANGE', validationPolicy))
  const canBulkValidate = Boolean(currentUser && hasPermission(currentUser, permissionConfig, 'bulk_validate'))
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMessage, setBulkMessage] = useState('')
  const [entrySearch, setEntrySearch] = useState('')
  // Two bulk modes. "Semua": every entry the rules allow (ready + informational findings).
  // "Valid": only entries the server pre-check found clean. Blocked entries are never bulk
  // validated (the server skips them too).
  const readinessReady = dataSource !== 'api' || Boolean(readiness.data)
  const bulkBase = pendingEntries.filter((employee) => employee.validationStatus === 'SUBMITTED' && employee.conditionStatus !== 'NEEDS_REVIEW' && hasCompleteSourceData(employee) && canValidateEntry(employee) && readinessReady)
  const bulkAll = dataSource === 'api' ? bulkBase.filter((employee) => readinessOf(employee.id) !== 'BLOCKED') : bulkBase
  const bulkValid = dataSource === 'api' ? bulkBase.filter((employee) => !issuesById.has(employee.id)) : bulkBase
  const bulkExcluded = pendingEntries.length - bulkAll.length
  const normalizedSearch = entrySearch.trim().toLowerCase()
  const filteredEntries = pendingEntries.filter((employee) => (!normalizedSearch || employee.name.toLowerCase().includes(normalizedSearch) || employee.personnelId.toLowerCase().includes(normalizedSearch))
    && (readinessFilter === 'ALL' || (employee.validationStatus === 'SUBMITTED' && readinessOf(employee.id) === readinessFilter)))
  const displayedEntries = filteredEntries.slice(0, 100)
  // Confirmation is rendered in the page: native confirm() dialogs are suppressed in some
  // embedded browsers, which made the button look dead.
  const [confirmBulk, setConfirmBulk] = useState<'ALL' | 'VALID' | null>(null)
  const bulkTarget = confirmBulk === 'VALID' ? bulkValid : bulkAll
  const bulkWithFindings = bulkAll.length - bulkValid.length
  const validateAll = async () => {
    const target = bulkTarget
    if (!canBulkValidate || !target.length || bulkBusy) return
    setConfirmBulk(null)
    setBulkBusy(true)
    setBulkMessage('')
    try {
      const count = await validateEmployees(target.map((employee) => employee.id))
      setBulkMessage(`${count} employee berhasil divalidasi.`)
      readiness.reload()
    } catch (error) {
      setBulkMessage(`Validasi massal berhenti. ${error instanceof Error ? error.message : ''} Periksa antrean lalu coba lagi.`)
      readiness.reload()
    } finally {
      setBulkBusy(false)
    }
  }

  return <>
    <PageHeader eyebrow="HR HEAD OFFICE" title="HR Validation" description="Periksa data yang dikirim Area Supporting sebelum diteruskan ke proses berikutnya." actions={<div className="queue-pill"><ClipboardCheck size={17} /> {pendingEntries.filter((item) => item.validationStatus === 'SUBMITTED').length + pendingExits.filter((item) => item.validationStatus === 'SUBMITTED').length} menunggu</div>} />
    <ActionError message={actionError} />
    <div className="tabs">
      <button className={tab === 'ENTRY' ? 'active' : ''} onClick={() => setTab('ENTRY')}><UserPlus /> Employee Entry <span>{pendingEntries.length}</span></button>
      <button className={tab === 'EXIT' ? 'active' : ''} onClick={() => setTab('EXIT')}><UserMinus /> Employee Exit <span>{pendingExits.length}</span></button>
    </div>
    <section className="card table-card">
      <div className="table-title"><div><span className="section-icon"><ClipboardCheck /></span><div><h2>{tab === 'ENTRY' ? 'Employee Entry Submission' : 'Employee Exit Submission'}</h2><p>Validasi hanya dapat dilakukan oleh validator yang berwenang.</p></div></div>{tab === 'ENTRY' && canBulkValidate && <div className="validation-actions">
        <button className="button secondary" disabled={!bulkValid.length || bulkBusy} title={!readinessReady ? 'Menunggu pemeriksaan kesiapan' : !bulkValid.length ? 'Tidak ada entry tanpa temuan' : 'Hanya entry tanpa temuan (Siap divalidasi)'} onClick={() => setConfirmBulk('VALID')}><Check /> Validasi yang Valid ({bulkValid.length})</button>
        <button className="button success" disabled={!bulkAll.length || bulkBusy} title={!readinessReady ? 'Menunggu pemeriksaan kesiapan' : !bulkAll.length ? 'Tidak ada entry yang dapat divalidasi' : 'Semua entry yang diizinkan aturan, termasuk yang memiliki peringatan'} onClick={() => setConfirmBulk('ALL')}>{bulkBusy ? <Loader2 className="spin" /> : <Check />} {bulkBusy ? 'Memvalidasi…' : `Validasi Semua (${bulkAll.length})`}</button></div>}</div>
      {tab === 'ENTRY' && confirmBulk && <div className="alert warning"><AlertTriangle /><div><strong>{confirmBulk === 'VALID' ? `Validasi ${bulkValid.length} employee tanpa temuan?` : `Validasi semua ${bulkAll.length} employee?`}</strong><p>{confirmBulk === 'ALL' && bulkWithFindings > 0 ? `Termasuk ${bulkWithFindings} employee dengan peringatan (import atau data kontrak) — pastikan peringatannya sudah diperiksa. ` : ''}{bulkExcluded ? `${bulkExcluded} employee tertahan, berstatus revisi, atau di luar kewenangan tidak ikut diproses. ` : ''}Keputusan validasi tercatat di riwayat dan tidak dapat dibatalkan dari halaman ini.</p></div><div className="validation-actions"><button className="button ghost" onClick={() => setConfirmBulk(null)}>Batal</button><button className="button success" onClick={validateAll}><Check /> Ya, validasi {bulkTarget.length}</button></div></div>}
      {tab === 'ENTRY' && dataSource === 'api' && canSeeReadiness && (readiness.data ? <ReadinessPanel data={readiness.data} filter={readinessFilter} onFilter={setReadinessFilter} />
        : readiness.error ? <div className="alert error"><AlertTriangle /><div><strong>Pemeriksaan kesiapan tidak dapat dimuat</strong><p>{readiness.error} Validasi Semua dinonaktifkan sampai pemeriksaan tersedia.</p></div><button className="button ghost" onClick={readiness.reload}>Coba lagi</button></div>
        : <p className="empty-inline">Memeriksa kesiapan validasi…</p>)}
      {tab === 'ENTRY' && <div className="filter-card"><label className="search-field">Cari<div className="search-box"><Search /><input aria-label="Cari antrean validasi" value={entrySearch} onChange={(event) => setEntrySearch(event.target.value)} placeholder="Cari nama atau Personnel ID..." /></div></label></div>}
      {tab === 'ENTRY' && bulkExcluded > 0 && <div className="alert warning"><AlertTriangle /><div><strong>{bulkExcluded} employee tidak dapat divalidasi massal</strong><p>Entry yang tertahan (syarat belum terpenuhi), berstatus revisi, atau di luar kewenangan harus diselesaikan dulu. Alasannya tercantum di setiap baris.</p></div></div>}
      {bulkMessage && <div className="alert info"><ClipboardCheck /><div><strong>Hasil validasi massal</strong><p>{bulkMessage}</p></div></div>}
      {(tab === 'ENTRY' ? filteredEntries.length : records.length) === 0 ? <EmptyState title="Queue validation kosong" description={tab === 'ENTRY' && entrySearch ? 'Tidak ada employee yang cocok dengan pencarian.' : 'Tidak ada submission yang perlu ditinjau.'} /> : <div className="validation-list">
        {tab === 'ENTRY' ? displayedEntries.map((employee) => {
          const area = areas.find((item) => item.id === employee.areaId)
          const project = projects.find((item) => item.id === employee.projectId)
          const submitter = users.find((item) => item.id === employee.createdBy)
          return <article className={`validation-item ${focusId === employee.id ? 'val-focused' : ''}`} id={`val-${employee.id}`} key={employee.id}>
            <div className="validation-type entry"><UserPlus /></div>
            <div className="validation-main"><div><span>{employee.pendingChange && employee.validationStatus === 'VALIDATED' ? 'PERUBAHAN DATA DASAR' : 'EMPLOYEE ENTRY'}</span><h3>{employee.name}</h3>{employee.pendingChange && employee.validationStatus === 'VALIDATED' && <p className="pending-change">Usulan: {Object.entries(employee.pendingChange.proposed).filter(([key, value]) => value !== (employee as unknown as Record<string, unknown>)[key]).map(([key, value]) => `${key}: ${value ?? '—'}`).join(' · ') || 'tidak ada perubahan nilai'}</p>}<p>{employee.personnelId} · {area?.name ?? 'Area kosong'} · {project?.name ?? 'Project kosong'} · {employee.position ?? 'Posisi kosong'}</p></div><div className="validation-meta">{docBadge(employee.pendingChange && employee.validationStatus === 'VALIDATED' ? `CHANGE_REQUEST:${employee.pendingChange.requestId}` : `PERSONNEL_ENTRY:${employee.id}`, employee.id)}<span>Dikirim oleh<strong>{submitter?.name ?? 'Demo User'}</strong></span><span>Tanggal submission<strong>{formatDate(employee.submittedAt, true)}</strong></span><StatusBadge tone={validationTone(employee.validationStatus)}>{validationLabels[employee.validationStatus]}</StatusBadge></div>{employee.revisionNote && <div className="inline-warning"><RotateCcw /> {employee.revisionNote}</div>}{(() => { const gap = docGaps.byId.get(employee.id); return gap && <div className="readiness-ok doc-gap"><AlertTriangle size={14} /> PKWT belum lengkap ({docGaps.describe(gap)}) — tidak menghalangi validasi.</div> })()}{!hasCompleteSourceData(employee) && !issuesById.has(employee.id) && <div className="inline-warning"><AlertTriangle /> Data source kritikal belum lengkap.</div>}{(() => { const issues = issuesById.get(employee.id); if (!issues) return dataSource === 'api' && readiness.data && employee.validationStatus === 'SUBMITTED' ? <div className="readiness-ok"><Check size={14} /> Pemeriksaan otomatis: tidak ada temuan.</div> : null; return <ul className="readiness-issues">{issues.slice(0, 4).map((issue, i) => <li key={i}><StatusBadge tone={issue.blocking ? 'danger' : 'warning'}>{issueLabels[issue.code]}</StatusBadge> {issueText(issue)}</li>)}{issues.length > 4 && <li><Link to={`/employees/${employee.id}`}>+{issues.length - 4} temuan lain — lihat detail</Link></li>}</ul> })()}</div>
            <div className="validation-actions"><Link className="button secondary" to={`/employees/${employee.id}`}><Eye /> Lihat Detail</Link><button className="button success" disabled={!canValidateEntry(employee) || entryStatus(employee) !== 'SUBMITTED' || employee.conditionStatus === 'NEEDS_REVIEW' || !hasCompleteSourceData(employee)} onClick={() => act(setEmployeeValidation(employee.id, 'VALIDATED'))}><Check /> Validate</button><button className="button danger-outline" disabled={!canValidateEntry(employee)} onClick={() => act(setEmployeeValidation(employee.id, 'REVISION_REQUIRED', askRevisionNote()))}><RotateCcw /> Request Revision</button></div>
          </article>
        }) : pendingExits.map((exit) => {
          const employee = employees.find((item) => item.id === exit.employeeId)
          if (!employee) return null
          const area = areas.find((item) => item.id === employee.areaId)
          const project = projects.find((item) => item.id === employee.projectId)
          const submitter = users.find((item) => item.id === exit.createdBy)
          return <article className={`validation-item ${focusId === exit.employeeId ? 'val-focused' : ''}`} id={`val-${exit.employeeId}`} key={exit.id}>
            <div className="validation-type exit"><UserMinus /></div>
            <div className="validation-main"><div><span>EMPLOYEE EXIT</span><h3>{employee.name}</h3><p>{area?.name ?? 'Area kosong'} · {project?.name ?? 'Project kosong'} · Exit {formatDate(exit.exitDate)}</p></div><div className="validation-meta">{docBadge(`CHANGE_REQUEST:${exit.id}`, exit.employeeId)}<span>Dikirim oleh<strong>{submitter?.name ?? 'Demo User'}</strong></span><span>Replacement<strong>{exit.replacementRequired ? 'Required' : 'Tidak diperlukan'}</strong></span><StatusBadge tone={validationTone(exit.validationStatus)}>{validationLabels[exit.validationStatus]}</StatusBadge></div>{exit.revisionNote && <div className="inline-warning"><RotateCcw /> {exit.revisionNote}</div>}{exit.replacementRequired && !hasCompleteSourceData(employee) && <div className="inline-warning"><AlertTriangle /> Replacement Need akan ditandai karena data sumber belum lengkap.</div>}</div>
            <div className="validation-actions"><Link className="button secondary" to={`/employees/${employee.id}`}><Eye /> Lihat Detail</Link><button className="button success" disabled={!canValidateExit} onClick={() => act(setExitValidation(exit.id, 'VALIDATED'))}><Check /> Validate</button><button className="button danger-outline" disabled={!canValidateExit} onClick={() => act(setExitValidation(exit.id, 'REVISION_REQUIRED', askRevisionNote()))}><RotateCcw /> Request Revision</button></div>
          </article>
        })}
      </div>}
      {tab === 'ENTRY' && filteredEntries.length > displayedEntries.length && <div className="empty-inline">Menampilkan 100 dari {filteredEntries.length} pengajuan. Gunakan pencarian untuk menemukan employee lain.</div>}
    </section>
    <section className="card table-card movement-validation-card"><div className="table-title"><div><span className="section-icon"><GitBranch /></span><div><h2>Placement Movement Submission</h2><p>{pendingMovements.length} perubahan menunggu keputusan sesuai validation policy.</p></div></div></div>{pendingMovements.length === 0 ? <EmptyState title="Tidak ada placement movement" description="Submission movement akan tampil di sini." /> : <div className="validation-list">{pendingMovements.map((request) => { const employee = employees.find((item) => item.id === request.employeeId); const previousProject = projects.find((item) => item.id === request.previousProjectId); const newProject = projects.find((item) => item.id === request.newProjectId); return <article className="validation-item" key={request.id}><div className="validation-type entry"><GitBranch /></div><div className="validation-main"><div><span>{request.movementType.replaceAll('_', ' ')}</span><h3>{employee?.name}</h3><p>{previousProject?.name ?? '—'} / {request.previousPosition ?? '—'} → {newProject?.name ?? '—'} / {request.newPosition ?? '—'}</p></div><div className="validation-meta">{docBadge(`CHANGE_REQUEST:${request.id}`, request.employeeId)}<span>Effective Date<strong>{formatDate(request.effectiveDate)}</strong></span><span>Notes<strong>{request.notes}</strong></span><StatusBadge tone={validationTone(request.validationStatus)}>{validationLabels[request.validationStatus]}</StatusBadge></div>{request.revisionNote && <div className="inline-warning"><RotateCcw /> {request.revisionNote}</div>}</div><div className="validation-actions">{employee && <Link className="button secondary" to={`/employees/${employee.id}`}><Eye /> Lihat Detail</Link>}<button className="button success" disabled={!canValidateMovement} onClick={() => act(setMovementValidation(request.id, 'VALIDATED'))}><Check /> Validate</button><button className="button danger-outline" disabled={!canValidateMovement} onClick={() => act(setMovementValidation(request.id, 'REVISION_REQUIRED', askRevisionNote()))}><RotateCcw /> Request Revision</button></div></article> })}</div>}</section>
  </>
}
