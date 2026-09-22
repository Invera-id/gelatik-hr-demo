import { AlertTriangle, Check, ClipboardCheck, GitBranch, RotateCcw, UserMinus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { validationTone } from '../components/statusTones'
import { useDemo } from '../context/DemoContext'
import { areas, demoUsers } from '../data/demoData'
import { formatDate, hasCompleteSourceData, validationLabels } from '../lib/businessRules'
import { canValidateTransaction, hasPermission } from '../config/access'
import { canAccessEmployee } from '../lib/businessRules'

export function ValidationPage() {
  const { currentUser, employees, projects, employeeExits, movementRequests, permissionConfig, validationPolicy, setEmployeeValidation, setExitValidation, setMovementValidation } = useDemo()
  const [tab, setTab] = useState<'ENTRY' | 'EXIT'>('ENTRY')
  const pendingEntries = employees.filter((employee) => ['SUBMITTED', 'REVISION_REQUIRED'].includes(employee.validationStatus) && (!currentUser || canAccessEmployee(currentUser, employee, permissionConfig)))
  const pendingExits = employeeExits.filter((exit) => { const employee = employees.find((item) => item.id === exit.employeeId); return ['SUBMITTED', 'REVISION_REQUIRED'].includes(exit.validationStatus) && Boolean(employee && (!currentUser || canAccessEmployee(currentUser, employee, permissionConfig))) })
  const pendingMovements = movementRequests.filter((request) => { const employee = employees.find((item) => item.id === request.employeeId); return ['SUBMITTED', 'REVISION_REQUIRED'].includes(request.validationStatus) && Boolean(employee && (!currentUser || canAccessEmployee(currentUser, employee, permissionConfig))) })
  const records = tab === 'ENTRY' ? pendingEntries : pendingExits
  const askRevisionNote = () => window.prompt('Catatan revisi (opsional):', '') ?? undefined
  const canValidateEntry = (employee: (typeof employees)[number]) => Boolean(currentUser && hasPermission(currentUser, permissionConfig, 'validate_employee') && canValidateTransaction(currentUser, employee.validationTransaction ?? 'EMPLOYEE_ENTRY', validationPolicy))
  const canValidateExit = Boolean(currentUser && hasPermission(currentUser, permissionConfig, 'validate_exit') && canValidateTransaction(currentUser, 'EMPLOYEE_EXIT', validationPolicy))
  const canValidateMovement = Boolean(currentUser && hasPermission(currentUser, permissionConfig, 'validate_employee') && canValidateTransaction(currentUser, 'EMPLOYEE_PLACEMENT_CHANGE', validationPolicy))

  return <>
    <PageHeader eyebrow="HR HEAD OFFICE" title="HR Validation" description="Periksa data yang dikirim Area Supporting sebelum diteruskan ke proses berikutnya." actions={<div className="queue-pill"><ClipboardCheck size={17} /> {pendingEntries.filter((item) => item.validationStatus === 'SUBMITTED').length + pendingExits.filter((item) => item.validationStatus === 'SUBMITTED').length} menunggu</div>} />
    <div className="tabs">
      <button className={tab === 'ENTRY' ? 'active' : ''} onClick={() => setTab('ENTRY')}><UserPlus /> Employee Entry <span>{pendingEntries.length}</span></button>
      <button className={tab === 'EXIT' ? 'active' : ''} onClick={() => setTab('EXIT')}><UserMinus /> Employee Exit <span>{pendingExits.length}</span></button>
    </div>
    <section className="card table-card">
      <div className="table-title"><div><span className="section-icon"><ClipboardCheck /></span><div><h2>{tab === 'ENTRY' ? 'Employee Entry Submission' : 'Employee Exit Submission'}</h2><p>Validasi hanya dapat dilakukan oleh validator yang berwenang.</p></div></div></div>
      {records.length === 0 ? <EmptyState title="Queue validation kosong" description="Tidak ada submission yang perlu ditinjau." /> : <div className="validation-list">
        {tab === 'ENTRY' ? pendingEntries.map((employee) => {
          const area = areas.find((item) => item.id === employee.areaId)
          const project = projects.find((item) => item.id === employee.projectId)
          const submitter = demoUsers.find((item) => item.id === employee.createdBy)
          return <article className="validation-item" key={employee.id}>
            <div className="validation-type entry"><UserPlus /></div>
            <div className="validation-main"><div><span>EMPLOYEE ENTRY</span><h3>{employee.name}</h3><p>{employee.personnelId} · {area?.name ?? 'Area kosong'} · {project?.name ?? 'Project kosong'} · {employee.position ?? 'Posisi kosong'}</p></div><div className="validation-meta"><span>Dikirim oleh<strong>{submitter?.name ?? 'Demo User'}</strong></span><span>Tanggal submission<strong>{formatDate(employee.submittedAt, true)}</strong></span><StatusBadge tone={validationTone(employee.validationStatus)}>{validationLabels[employee.validationStatus]}</StatusBadge></div>{employee.revisionNote && <div className="inline-warning"><RotateCcw /> {employee.revisionNote}</div>}{!hasCompleteSourceData(employee) && <div className="inline-warning"><AlertTriangle /> Data source kritikal belum lengkap.</div>}</div>
            <div className="validation-actions"><button className="button success" disabled={!canValidateEntry(employee)} onClick={() => setEmployeeValidation(employee.id, 'VALIDATED')}><Check /> Validate</button><button className="button danger-outline" disabled={!canValidateEntry(employee)} onClick={() => setEmployeeValidation(employee.id, 'REVISION_REQUIRED', askRevisionNote())}><RotateCcw /> Request Revision</button></div>
          </article>
        }) : pendingExits.map((exit) => {
          const employee = employees.find((item) => item.id === exit.employeeId)
          if (!employee) return null
          const area = areas.find((item) => item.id === employee.areaId)
          const project = projects.find((item) => item.id === employee.projectId)
          const submitter = demoUsers.find((item) => item.id === exit.createdBy)
          return <article className="validation-item" key={exit.id}>
            <div className="validation-type exit"><UserMinus /></div>
            <div className="validation-main"><div><span>EMPLOYEE EXIT</span><h3>{employee.name}</h3><p>{area?.name ?? 'Area kosong'} · {project?.name ?? 'Project kosong'} · Exit {formatDate(exit.exitDate)}</p></div><div className="validation-meta"><span>Dikirim oleh<strong>{submitter?.name ?? 'Demo User'}</strong></span><span>Replacement<strong>{exit.replacementRequired ? 'Required' : 'Tidak diperlukan'}</strong></span><StatusBadge tone={validationTone(exit.validationStatus)}>{validationLabels[exit.validationStatus]}</StatusBadge></div>{exit.revisionNote && <div className="inline-warning"><RotateCcw /> {exit.revisionNote}</div>}{exit.replacementRequired && !hasCompleteSourceData(employee) && <div className="inline-warning"><AlertTriangle /> Replacement Need akan ditandai karena data sumber belum lengkap.</div>}</div>
            <div className="validation-actions"><button className="button success" disabled={!canValidateExit} onClick={() => setExitValidation(exit.id, 'VALIDATED')}><Check /> Validate</button><button className="button danger-outline" disabled={!canValidateExit} onClick={() => setExitValidation(exit.id, 'REVISION_REQUIRED', askRevisionNote())}><RotateCcw /> Request Revision</button></div>
          </article>
        })}
      </div>}
    </section>
    <section className="card table-card movement-validation-card"><div className="table-title"><div><span className="section-icon"><GitBranch /></span><div><h2>Placement Movement Submission</h2><p>{pendingMovements.length} perubahan menunggu keputusan sesuai validation policy.</p></div></div></div>{pendingMovements.length === 0 ? <EmptyState title="Tidak ada placement movement" description="Submission movement akan tampil di sini." /> : <div className="validation-list">{pendingMovements.map((request) => { const employee = employees.find((item) => item.id === request.employeeId); const previousProject = projects.find((item) => item.id === request.previousProjectId); const newProject = projects.find((item) => item.id === request.newProjectId); return <article className="validation-item" key={request.id}><div className="validation-type entry"><GitBranch /></div><div className="validation-main"><div><span>{request.movementType.replaceAll('_', ' ')}</span><h3>{employee?.name}</h3><p>{previousProject?.name ?? '—'} / {request.previousPosition ?? '—'} → {newProject?.name ?? '—'} / {request.newPosition ?? '—'}</p></div><div className="validation-meta"><span>Effective Date<strong>{formatDate(request.effectiveDate)}</strong></span><span>Notes<strong>{request.notes}</strong></span><StatusBadge tone={validationTone(request.validationStatus)}>{validationLabels[request.validationStatus]}</StatusBadge></div>{request.revisionNote && <div className="inline-warning"><RotateCcw /> {request.revisionNote}</div>}</div><div className="validation-actions"><button className="button success" disabled={!canValidateMovement} onClick={() => setMovementValidation(request.id, 'VALIDATED')}><Check /> Validate</button><button className="button danger-outline" disabled={!canValidateMovement} onClick={() => setMovementValidation(request.id, 'REVISION_REQUIRED', askRevisionNote())}><RotateCcw /> Request Revision</button></div></article> })}</div>}</section>
  </>
}
