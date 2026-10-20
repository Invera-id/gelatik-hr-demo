import { AlertTriangle, Check, ClipboardCheck, Eye, GitBranch, Loader2, RotateCcw, Search, UserMinus, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { validationTone } from '../components/statusTones'
import { useDemo } from '../context/DemoContext'
import { demoUsers } from '../data/demoData'
import { formatDate, hasCompleteSourceData, validationLabels } from '../lib/businessRules'
import { canValidateTransaction, hasPermission } from '../config/access'
import { canAccessEmployee } from '../lib/businessRules'

export function ValidationPage() {
  const { currentUser, areas, employees, projects, employeeExits, movementRequests, permissionConfig, validationPolicy, setEmployeeValidation, validateEmployees, setExitValidation, setMovementValidation } = useDemo()
  const [searchParams] = useSearchParams()
  const focusId = searchParams.get('focus')
  const pendingEntries = employees.filter((employee) => ['SUBMITTED', 'REVISION_REQUIRED'].includes(employee.validationStatus) && (!currentUser || canAccessEmployee(currentUser, employee, permissionConfig)))
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
  const bulkEligible = pendingEntries.filter((employee) => employee.validationStatus === 'SUBMITTED' && employee.conditionStatus !== 'NEEDS_REVIEW' && hasCompleteSourceData(employee) && canValidateEntry(employee))
  const bulkExcluded = pendingEntries.length - bulkEligible.length
  const normalizedSearch = entrySearch.trim().toLowerCase()
  const filteredEntries = pendingEntries.filter((employee) => !normalizedSearch || employee.name.toLowerCase().includes(normalizedSearch) || employee.personnelId.toLowerCase().includes(normalizedSearch))
  const displayedEntries = filteredEntries.slice(0, 100)
  const validateAll = async () => {
    if (!canBulkValidate || !bulkEligible.length || bulkBusy) return
    if (!window.confirm(`Validasi ${bulkEligible.length} employee yang siap diproses?${bulkExcluded ? ` ${bulkExcluded} employee bermasalah/revisi tidak akan diproses.` : ''}`)) return
    setBulkBusy(true)
    setBulkMessage('')
    try {
      const count = await validateEmployees(bulkEligible.map((employee) => employee.id))
      setBulkMessage(`${count} employee berhasil divalidasi.`)
    } catch {
      setBulkMessage('Validasi massal gagal. Tidak semua data dapat diperbarui; muat ulang halaman dan periksa antrean.')
    } finally {
      setBulkBusy(false)
    }
  }

  return <>
    <PageHeader eyebrow="HR HEAD OFFICE" title="HR Validation" description="Periksa data yang dikirim Area Supporting sebelum diteruskan ke proses berikutnya." actions={<div className="queue-pill"><ClipboardCheck size={17} /> {pendingEntries.filter((item) => item.validationStatus === 'SUBMITTED').length + pendingExits.filter((item) => item.validationStatus === 'SUBMITTED').length} menunggu</div>} />
    <div className="tabs">
      <button className={tab === 'ENTRY' ? 'active' : ''} onClick={() => setTab('ENTRY')}><UserPlus /> Employee Entry <span>{pendingEntries.length}</span></button>
      <button className={tab === 'EXIT' ? 'active' : ''} onClick={() => setTab('EXIT')}><UserMinus /> Employee Exit <span>{pendingExits.length}</span></button>
    </div>
    <section className="card table-card">
      <div className="table-title"><div><span className="section-icon"><ClipboardCheck /></span><div><h2>{tab === 'ENTRY' ? 'Employee Entry Submission' : 'Employee Exit Submission'}</h2><p>Validasi hanya dapat dilakukan oleh validator yang berwenang.</p></div></div>{tab === 'ENTRY' && canBulkValidate && <button className="button success" disabled={!bulkEligible.length || bulkBusy} onClick={validateAll}>{bulkBusy ? <Loader2 className="spin" /> : <Check />} Validasi Semua ({bulkEligible.length})</button>}</div>
      {tab === 'ENTRY' && <div className="filter-card"><div className="search-box"><Search /><input aria-label="Cari antrean validasi" value={entrySearch} onChange={(event) => setEntrySearch(event.target.value)} placeholder="Cari nama atau Personnel ID..." /></div></div>}
      {tab === 'ENTRY' && bulkExcluded > 0 && <div className="alert warning"><AlertTriangle /><div><strong>{bulkExcluded} employee tidak termasuk Validasi Semua</strong><p>Data berstatus perlu review, revisi, tidak lengkap, atau di luar kewenangan harus diperiksa manual.</p></div></div>}
      {bulkMessage && <div className="alert info"><ClipboardCheck /><div><strong>Hasil validasi massal</strong><p>{bulkMessage}</p></div></div>}
      {(tab === 'ENTRY' ? filteredEntries.length : records.length) === 0 ? <EmptyState title="Queue validation kosong" description={tab === 'ENTRY' && entrySearch ? 'Tidak ada employee yang cocok dengan pencarian.' : 'Tidak ada submission yang perlu ditinjau.'} /> : <div className="validation-list">
        {tab === 'ENTRY' ? displayedEntries.map((employee) => {
          const area = areas.find((item) => item.id === employee.areaId)
          const project = projects.find((item) => item.id === employee.projectId)
          const submitter = demoUsers.find((item) => item.id === employee.createdBy)
          return <article className={`validation-item ${focusId === employee.id ? 'val-focused' : ''}`} id={`val-${employee.id}`} key={employee.id}>
            <div className="validation-type entry"><UserPlus /></div>
            <div className="validation-main"><div><span>EMPLOYEE ENTRY</span><h3>{employee.name}</h3><p>{employee.personnelId} · {area?.name ?? 'Area kosong'} · {project?.name ?? 'Project kosong'} · {employee.position ?? 'Posisi kosong'}</p></div><div className="validation-meta"><span>Dikirim oleh<strong>{submitter?.name ?? 'Demo User'}</strong></span><span>Tanggal submission<strong>{formatDate(employee.submittedAt, true)}</strong></span><StatusBadge tone={validationTone(employee.validationStatus)}>{validationLabels[employee.validationStatus]}</StatusBadge></div>{employee.revisionNote && <div className="inline-warning"><RotateCcw /> {employee.revisionNote}</div>}{!hasCompleteSourceData(employee) && <div className="inline-warning"><AlertTriangle /> Data source kritikal belum lengkap.</div>}</div>
            <div className="validation-actions"><Link className="button secondary" to={`/employees/${employee.id}`}><Eye /> Lihat Detail</Link><button className="button success" disabled={!canValidateEntry(employee) || employee.conditionStatus === 'NEEDS_REVIEW' || !hasCompleteSourceData(employee)} onClick={() => setEmployeeValidation(employee.id, 'VALIDATED')}><Check /> Validate</button><button className="button danger-outline" disabled={!canValidateEntry(employee)} onClick={() => setEmployeeValidation(employee.id, 'REVISION_REQUIRED', askRevisionNote())}><RotateCcw /> Request Revision</button></div>
          </article>
        }) : pendingExits.map((exit) => {
          const employee = employees.find((item) => item.id === exit.employeeId)
          if (!employee) return null
          const area = areas.find((item) => item.id === employee.areaId)
          const project = projects.find((item) => item.id === employee.projectId)
          const submitter = demoUsers.find((item) => item.id === exit.createdBy)
          return <article className={`validation-item ${focusId === exit.employeeId ? 'val-focused' : ''}`} id={`val-${exit.employeeId}`} key={exit.id}>
            <div className="validation-type exit"><UserMinus /></div>
            <div className="validation-main"><div><span>EMPLOYEE EXIT</span><h3>{employee.name}</h3><p>{area?.name ?? 'Area kosong'} · {project?.name ?? 'Project kosong'} · Exit {formatDate(exit.exitDate)}</p></div><div className="validation-meta"><span>Dikirim oleh<strong>{submitter?.name ?? 'Demo User'}</strong></span><span>Replacement<strong>{exit.replacementRequired ? 'Required' : 'Tidak diperlukan'}</strong></span><StatusBadge tone={validationTone(exit.validationStatus)}>{validationLabels[exit.validationStatus]}</StatusBadge></div>{exit.revisionNote && <div className="inline-warning"><RotateCcw /> {exit.revisionNote}</div>}{exit.replacementRequired && !hasCompleteSourceData(employee) && <div className="inline-warning"><AlertTriangle /> Replacement Need akan ditandai karena data sumber belum lengkap.</div>}</div>
            <div className="validation-actions"><Link className="button secondary" to={`/employees/${employee.id}`}><Eye /> Lihat Detail</Link><button className="button success" disabled={!canValidateExit} onClick={() => setExitValidation(exit.id, 'VALIDATED')}><Check /> Validate</button><button className="button danger-outline" disabled={!canValidateExit} onClick={() => setExitValidation(exit.id, 'REVISION_REQUIRED', askRevisionNote())}><RotateCcw /> Request Revision</button></div>
          </article>
        })}
      </div>}
      {tab === 'ENTRY' && filteredEntries.length > displayedEntries.length && <div className="empty-inline">Menampilkan 100 dari {filteredEntries.length} pengajuan. Gunakan pencarian untuk menemukan employee lain.</div>}
    </section>
    <section className="card table-card movement-validation-card"><div className="table-title"><div><span className="section-icon"><GitBranch /></span><div><h2>Placement Movement Submission</h2><p>{pendingMovements.length} perubahan menunggu keputusan sesuai validation policy.</p></div></div></div>{pendingMovements.length === 0 ? <EmptyState title="Tidak ada placement movement" description="Submission movement akan tampil di sini." /> : <div className="validation-list">{pendingMovements.map((request) => { const employee = employees.find((item) => item.id === request.employeeId); const previousProject = projects.find((item) => item.id === request.previousProjectId); const newProject = projects.find((item) => item.id === request.newProjectId); return <article className="validation-item" key={request.id}><div className="validation-type entry"><GitBranch /></div><div className="validation-main"><div><span>{request.movementType.replaceAll('_', ' ')}</span><h3>{employee?.name}</h3><p>{previousProject?.name ?? '—'} / {request.previousPosition ?? '—'} → {newProject?.name ?? '—'} / {request.newPosition ?? '—'}</p></div><div className="validation-meta"><span>Effective Date<strong>{formatDate(request.effectiveDate)}</strong></span><span>Notes<strong>{request.notes}</strong></span><StatusBadge tone={validationTone(request.validationStatus)}>{validationLabels[request.validationStatus]}</StatusBadge></div>{request.revisionNote && <div className="inline-warning"><RotateCcw /> {request.revisionNote}</div>}</div><div className="validation-actions">{employee && <Link className="button secondary" to={`/employees/${employee.id}`}><Eye /> Lihat Detail</Link>}<button className="button success" disabled={!canValidateMovement} onClick={() => setMovementValidation(request.id, 'VALIDATED')}><Check /> Validate</button><button className="button danger-outline" disabled={!canValidateMovement} onClick={() => setMovementValidation(request.id, 'REVISION_REQUIRED', askRevisionNote())}><RotateCcw /> Request Revision</button></div></article> })}</div>}</section>
  </>
}
