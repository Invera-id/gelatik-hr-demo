import { Download, FileSpreadsheet, Filter, History, RefreshCw, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { allowedAreaIds } from '../config/access'
import { useDemo } from '../context/DemoContext'
import { formatDate, replacementLabels, roleLabels } from '../lib/businessRules'
import { selectDashboardData } from '../lib/dashboardRules'
import { exportBusinessTable, exportBusinessWorkbook, type ExportTable } from '../lib/excelExport'
import { buildActualManpowerSummary } from '../lib/actualManpower'

type ExportKind = 'EMPLOYEE' | 'MOVEMENT' | 'TURNOVER' | 'REPLACEMENT' | 'DASHBOARD'

const today = '2026-09-14'
const fileStamp = today.replaceAll('-', '')

export function ExportPage() {
  const { currentUser, areas, employees, projects, employeeExits, replacementNeeds, employeeMovements, permissionConfig, actualManpowerRecords, importReviewItems, importStorageReady, importStorageError } = useDemo()
  const scopedAreas = useMemo(() => currentUser ? allowedAreaIds(currentUser, permissionConfig) : [], [currentUser, permissionConfig])
  const initialArea = scopedAreas?.length === 1 ? scopedAreas[0] : ''
  const [areaId, setAreaId] = useState(initialArea)
  const [projectId, setProjectId] = useState('')
  const [dateFrom, setDateFrom] = useState('2026-01-01')
  const [dateTo, setDateTo] = useState(today)
  const [exporting, setExporting] = useState<ExportKind | 'ACTUAL' | null>(null)
  const [message, setMessage] = useState('')
  const [actualError, setActualError] = useState('')

  const permittedAreaIds = useMemo(() => scopedAreas === null ? areas.map((area) => area.id) : scopedAreas, [areas, scopedAreas])
  const scopedEmployees = useMemo(() => employees.filter((employee) => employee.areaId && permittedAreaIds.includes(employee.areaId)), [employees, permittedAreaIds])
  const selected = useMemo(() => selectDashboardData(scopedEmployees, employeeExits, replacementNeeds.filter((need) => need.areaId && permittedAreaIds.includes(need.areaId)), employeeMovements, { dateFrom, dateTo, areaId, projectId, position: '', status: '' }), [areaId, dateFrom, dateTo, employeeExits, employeeMovements, permittedAreaIds, projectId, replacementNeeds, scopedEmployees])

  if (!currentUser) return null
  const areaName = (id: string | null) => areas.find((item) => item.id === id)?.name ?? '-'
  const projectName = (id: string | null) => projects.find((item) => item.id === id)?.name ?? '-'
  const employeeName = (id: string) => employees.find((item) => item.id === id)?.name ?? '-'

  const tables: Record<ExportKind, { title: string; description: string; icon: typeof Users; file: string; table: ExportTable }> = {
    EMPLOYEE: {
      title: 'Employee Master', description: `${selected.employees.length} employee sesuai scope dan placement filter.`, icon: Users, file: `employee-master-${fileStamp}.xlsx`,
      table: { headers: ['Personnel ID', 'Nama Employee', 'Area', 'Project', 'Position', 'Employment Status', 'Join Date', 'Contract End Date', 'Contract Status', 'BPJS Status', 'Validation'], rows: selected.employees.map((employee) => [employee.personnelId, employee.name, areaName(employee.areaId), projectName(employee.projectId), employee.position, employee.employmentStatus, employee.joinDate, employee.contractEndDate, employee.contractStatus, employee.bpjsStatus, employee.validationStatus]) },
    },
    MOVEMENT: {
      title: 'Employee Movement History', description: `${selected.movements.length} movement pada periode terpilih.`, icon: History, file: `employee-movement-${fileStamp}.xlsx`,
      table: { headers: ['Effective Date', 'Personnel ID', 'Nama Employee', 'Movement Type', 'Previous Area', 'New Area', 'Previous Project', 'New Project', 'Previous Position', 'New Position', 'Notes', 'Created By'], rows: selected.movements.map((movement) => { const employee = employees.find((item) => item.id === movement.employeeId); return [movement.effectiveDate, employee?.personnelId, employee?.name, movement.movementType, areaName(movement.previousAreaId), areaName(movement.newAreaId), projectName(movement.previousProjectId), projectName(movement.newProjectId), movement.previousPosition, movement.newPosition, movement.notes, movement.createdBy] }) },
    },
    TURNOVER: {
      title: 'Turnover Data', description: `${selected.exits.length} employee exit tervalidasi pada periode terpilih.`, icon: RefreshCw, file: `turnover-${fileStamp}.xlsx`,
      table: { headers: ['Exit ID', 'Personnel ID', 'Nama Employee', 'Area', 'Project', 'Position', 'Exit Date', 'Exit Reason', 'Replacement Required', 'Validation'], rows: selected.exits.map((exit) => { const employee = employees.find((item) => item.id === exit.employeeId); return [exit.id, employee?.personnelId, employee?.name, areaName(employee?.areaId ?? null), projectName(employee?.projectId ?? null), employee?.position, exit.exitDate, exit.exitReason, exit.replacementRequired ? 'Yes' : 'No', exit.validationStatus] }) },
    },
    REPLACEMENT: {
      title: 'Replacement / Fulfillment Data', description: `${selected.needs.length} replacement need pada periode terpilih.`, icon: FileSpreadsheet, file: `replacement-fulfillment-${fileStamp}.xlsx`,
      table: { headers: ['Need ID', 'Employee Exit', 'Replacement Employee', 'Area', 'Project', 'Position', 'Exit Date', 'Replacement Join Date', 'Working-Day Gap', 'Status'], rows: selected.needs.map((need) => [need.id, employeeName(need.originalEmployeeId), need.replacementEmployeeId ? employeeName(need.replacementEmployeeId) : '-', areaName(need.areaId), projectName(need.projectId), need.position, need.exitDate, need.replacementJoinDate, need.gapWorkingDays, replacementLabels[need.status]]) },
    },
    DASHBOARD: {
      title: 'Dashboard Filtered Data', description: 'Ringkasan KPI persis sesuai filter aktif di halaman ini.', icon: Filter, file: `dashboard-filtered-${fileStamp}.xlsx`,
      table: { headers: ['Metric', 'Value', 'Area Filter', 'Project Filter', 'Date From', 'Date To', 'Role Scope'], rows: [['Active Employee', selected.activeEmployees.length], ['Validated Employee Exit', selected.exits.length], ['Replacement Needs', selected.needs.length], ['Fulfilled', selected.fulfilled.length], ['Open', selected.open.length], ['Over SLA', selected.overSla.length], ['Fulfillment Rate', `${selected.fulfillmentRate}%`], ['Average Working-Day Gap', selected.averageGap]].map(([metric, value]) => [metric, value, areaId ? areaName(areaId) : 'Semua area dalam scope', projectId ? projectName(projectId) : 'Semua project', formatDate(dateFrom), formatDate(dateTo), roleLabels[currentUser.role]]) },
    },
  }

  const handleExport = async (kind: ExportKind) => {
    setExporting(kind); setMessage('')
    const item = tables[kind]
    const format = await exportBusinessTable(item.table, item.file)
    setMessage(format === 'XLSX' ? `${item.title} berhasil dibuat dalam format .xlsx.` : `Browser gagal membuat .xlsx; fallback CSV berhasil diunduh.`)
    setExporting(null)
  }

  const handleActualExport = async () => {
    if (!importStorageReady || importStorageError || exporting) return
    setExporting('ACTUAL'); setMessage(''); setActualError('')
    try {
      const exportedAt = new Date()
      const summary = buildActualManpowerSummary({ records: actualManpowerRecords, exits: employeeExits, movements: employeeMovements, reviewItems: importReviewItems, areas, projects, allowedAreas: scopedAreas, areaId, projectId, exportedAt })
      await exportBusinessWorkbook(summary.sheets, `actual-manpower-summary-${exportedAt.toISOString().slice(0, 10)}.xlsx`)
      setMessage(`Snapshot ${summary.snapshotDate}: ${summary.actualActive} Active Confirmed = ${summary.activeMapped} Active Mapped + ${summary.activeUnmapped} Active Unmapped. ${summary.needsReview} identitas Needs Review; ${summary.withoutId} record tanpa ID terpisah. Empat sheet agregat berhasil dibuat.`)
    } catch {
      setActualError('Actual Manpower Summary gagal dibuat. Tidak ada data yang diubah. Coba unduh ulang; export ini membutuhkan keempat sheet .xlsx sehingga tidak menggunakan fallback CSV.')
    } finally {
      setExporting(null)
    }
  }

  return <>
    <PageHeader eyebrow="REPORTS / EXPORT" title="Excel Export" description="Unduh dataset bisnis yang sudah mengikuti filter aktif dan scope role pengguna." />
    <div className="rule-note"><strong>File dibuat di browser</strong><span>Tidak dikirim ke server; hasil mengikuti hak akses Anda.</span></div>
    <section className="card export-filter"><div><label>Date From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>Date To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label></div><div><label>Area<select value={areaId} disabled={permittedAreaIds.length === 1} onChange={(event) => { setAreaId(event.target.value); setProjectId('') }}><option value="">Semua area dalam scope</option>{areas.filter((area) => permittedAreaIds.includes(area.id)).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">Semua project</option>{projects.filter((project) => (!areaId || project.areaId === areaId) && permittedAreaIds.includes(project.areaId)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div></section>
    {message && <div className="alert success"><FileSpreadsheet /><div><strong>Export selesai</strong><p>{message}</p></div></div>}
    {actualError && <div className="alert error" role="alert"><FileSpreadsheet /><div><strong>Export gagal</strong><p>{actualError}</p></div></div>}
    <section className="export-grid">{(Object.keys(tables) as ExportKind[]).map((kind) => { const item = tables[kind]; const Icon = item.icon; return <article className="card export-card" key={kind}><span className="export-icon"><Icon /></span><div><h2>{item.title}</h2><p>{item.description}</p></div><button className="button secondary" onClick={() => handleExport(kind)} disabled={exporting !== null}><Download /> {exporting === kind ? 'Menyiapkan...' : 'Export .xlsx'}</button></article> })}
      <article className="card export-card"><span className="export-icon"><Users /></span><div><h2>Actual Manpower Summary</h2><p>Rekap jumlah employee aktif berdasarkan Area, Client, dan Project tanpa menampilkan identitas individu.</p><p>Snapshot saat export. Mengikuti filter Area/Project dan scope role; Date From/Date To tidak diterapkan. Konflik dipisahkan untuk review.</p>{!importStorageReady && <p>Menunggu data import dimuat...</p>}{importStorageError && <p role="alert">Penyimpanan import tidak dapat dibaca. Export ditahan agar tidak menghasilkan rekap parsial.</p>}</div><button className="button secondary" onClick={handleActualExport} disabled={exporting !== null || !importStorageReady || Boolean(importStorageError)}><Download /> {exporting === 'ACTUAL' ? 'Menyiapkan...' : 'Export .xlsx'}</button></article>
    </section>
  </>
}
