import { AlertTriangle, ArrowLeft, BriefcaseBusiness, CalendarDays, Edit3, LogOut, MapPin, UserRound } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { validationTone } from '../components/statusTones'
import { useDemo } from '../context/DemoContext'
import { areas, projects } from '../data/demoData'
import { canAccessEmployee, canEditEmployees, contractLabels, formatDate, hasCompleteSourceData, validationLabels } from '../lib/businessRules'

function Field({ label, value }: { label: string; value: string | null | undefined }) { return <div className="detail-field"><span>{label}</span><strong className={!value ? 'missing-text' : ''}>{value || 'Belum tersedia'}</strong></div> }

export function EmployeeDetailPage() {
  const { employeeId } = useParams()
  const { currentUser, employees, movements, employeeExits } = useDemo()
  const employee = employees.find((item) => item.id === employeeId)
  if (!currentUser || !employee || !canAccessEmployee(currentUser, employee)) return <Navigate to="/employees" replace />
  const area = areas.find((item) => item.id === employee.areaId); const project = projects.find((item) => item.id === employee.projectId)
  const history = movements.filter((item) => item.employeeId === employee.id).sort((a, b) => b.date.localeCompare(a.date))
  const activeExit = employeeExits.find((item) => item.employeeId === employee.id && ['DRAFT', 'SUBMITTED'].includes(item.validationStatus))
  return <><Link to="/employees" className="back-link"><ArrowLeft size={16} /> Kembali ke Master Employee</Link>
    <PageHeader eyebrow={employee.personnelId} title={employee.name} description={`${area?.name ?? 'Area belum tersedia'} · ${project?.name ?? 'Project belum tersedia'}`} actions={canEditEmployees(currentUser) && <><Link className="button secondary" to={`/employees/${employee.id}/edit`}><Edit3 size={17} /> Edit</Link>{employee.employmentStatus === 'ACTIVE' && <Link className="button danger-outline" to={`/employees/${employee.id}/exit`}><LogOut size={17} /> Employee Exit</Link>}</>} />
    {!hasCompleteSourceData(employee) && <div className="alert warning"><AlertTriangle /><div><strong>Data sumber belum lengkap</strong><p>Area, Project, dan Posisi harus dilengkapi oleh pihak pemilik data sebelum proses fulfillment dapat dilakukan.</p></div></div>}
    {activeExit && <div className="alert info"><CalendarDays /><div><strong>Proses exit sedang berjalan</strong><p>Status saat ini: {validationLabels[activeExit.validationStatus]}.</p></div></div>}
    <div className="detail-grid"><section className="card detail-section"><div className="section-heading"><UserRound /><h2>Informasi Dasar</h2></div><div className="field-grid"><Field label="Personnel ID" value={employee.personnelId} /><Field label="Nama Lengkap" value={employee.name} /></div></section>
      <section className="card detail-section"><div className="section-heading"><MapPin /><h2>Penempatan</h2></div><div className="field-grid"><Field label="Area" value={area?.name} /><Field label="Sub Area" value={employee.subArea} /><Field label="Client" value={project?.clientName} /><Field label="Project" value={project?.name} /><Field label="Position" value={employee.position} /></div></section>
      <section className="card detail-section"><div className="section-heading"><BriefcaseBusiness /><h2>Employment</h2></div><div className="field-grid"><Field label="Employment Status" value={employee.employmentStatus} /><Field label="Join Date" value={formatDate(employee.joinDate)} /><Field label="Contract Start" value={formatDate(employee.contractStartDate)} /><Field label="Contract End" value={formatDate(employee.contractEndDate)} /><Field label="Contract Status" value={contractLabels[employee.contractStatus]} /><div className="detail-field"><span>Validation Status</span><strong><StatusBadge tone={validationTone(employee.validationStatus)}>{validationLabels[employee.validationStatus]}</StatusBadge></strong></div></div></section>
      <section className="card detail-section"><div className="section-heading"><CalendarDays /><h2>Informasi Demo Lainnya</h2></div><div className="field-grid"><Field label="BPJS Status" value={employee.bpjsStatus} /><Field label="Terakhir diperbarui" value={formatDate(employee.updatedAt, true)} /></div></section>
    </div>
    <section className="card timeline-card"><div className="section-heading"><CalendarDays /><h2>Movement History</h2></div>{history.length ? <div className="timeline">{history.map((item) => <div key={item.id} className="timeline-item"><span className={`timeline-dot ${item.type.toLowerCase()}`} /><div><strong>{item.title}</strong><p>{item.description}</p><small>{formatDate(item.date, true)}</small></div></div>)}</div> : <div className="empty-inline">Belum ada movement history untuk employee ini.</div>}</section>
  </>
}
