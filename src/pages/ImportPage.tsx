import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { useDemo } from '../context/DemoContext'
import { areas } from '../data/demoData'
import { exportBusinessTable } from '../lib/excelExport'
import { importColumns, parseEmployeeImport, type DuplicateDecision, type EmployeeImportPreview } from '../lib/importRules'
import type { Employee } from '../types'

const templateRows = [
  ['IMP-001', 'Nabila Putri', 'Bandung', 'Project Alpha Bandung', 'SPG', '2026-09-20', 'ACTIVE', '2027-09-19', 'IN_PROCESS'],
  ['EMP-026', 'Salsa Maharani Updated', 'Bandung', 'Project Beta Bandung', 'Team Leader', '2024-02-01', 'ACTIVE', '2027-01-31', 'ACTIVE'],
  ['IMP-003', 'Dedi Kurnia', 'Semarang', '', 'Sales', '2026-09-22', 'ACTIVE', '2027-09-21', 'NOT_REGISTERED'],
  ['IMP-004', 'Mila Azzahra', 'Surabaya', 'Project Delta', 'Promotor', '2026-09-23', 'ACTIVE', '2027-09-22', 'ACTIVE'],
]

export function ImportPage() {
  const { currentUser, employees, projects, importEmployees } = useDemo()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<EmployeeImportPreview | null>(null)
  const [fileName, setFileName] = useState('')
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('')
  if (!currentUser) return null

  const counts = preview?.rows.reduce((result, row) => ({ ...result, [row.status]: result[row.status] + 1 }), { VALID: 0, WARNING: 0, ERROR: 0 }) ?? { VALID: 0, WARNING: 0, ERROR: 0 }
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setProcessing(true); setMessage(''); setFileName(file.name)
    try {
      const { readSheet } = await import('read-excel-file/browser')
      setPreview(parseEmployeeImport(await readSheet(file) as unknown[][], employees, areas, projects))
    } catch {
      setPreview({ headerErrors: ['File tidak dapat dibaca. Pastikan menggunakan format .xlsx yang valid.'], rows: [] })
    } finally { setProcessing(false) }
  }
  const setDecision = (rowNumber: number, decision: DuplicateDecision) => setPreview((current) => current ? { ...current, rows: current.rows.map((row) => row.rowNumber === rowNumber ? { ...row, decision } : row) } : current)
  const confirmImport = () => {
    if (!preview) return
    const now = new Date().toISOString()
    const accepted = preview.rows.filter((row) => row.fields && (row.status === 'VALID' || row.decision === 'UPDATE'))
    const records: Employee[] = accepted.map((row, index) => {
      const existing = employees.find((employee) => employee.id === row.duplicateEmployeeId)
      const fields = row.fields!
      if (existing) return { ...existing, name: fields.name, areaId: fields.areaId, projectId: fields.projectId, position: fields.position, joinDate: fields.joinDate, employmentStatus: fields.employmentStatus, contractEndDate: fields.contractEndDate, contractStatus: fields.contractEndDate ? 'SIGNED' : existing.contractStatus, bpjsStatus: fields.bpjsStatus, profile: { ...existing.profile, areaCbs: areas.find((area) => area.id === fields.areaId)?.name ?? null }, updatedAt: now }
      return { id: `employee-import-${Date.now()}-${index}`, personnelId: fields.personnelId, name: fields.name, areaId: fields.areaId, subArea: null, projectId: fields.projectId, position: fields.position, employmentStatus: fields.employmentStatus, joinDate: fields.joinDate, contractStartDate: fields.joinDate, contractEndDate: fields.contractEndDate, contractStatus: fields.contractEndDate ? 'SIGNED' : 'NOT_AVAILABLE', bpjsStatus: fields.bpjsStatus, profile: { areaCbs: areas.find((area) => area.id === fields.areaId)?.name ?? null }, createdBy: currentUser.id, validationStatus: 'VALIDATED', validatedBy: currentUser.id, validatedAt: now, submittedAt: now, revisionNote: null, createdAt: now, updatedAt: now }
    })
    importEmployees(records)
    const updated = records.filter((record) => employees.some((employee) => employee.id === record.id)).length
    setMessage(`${records.length - updated} employee baru ditambahkan dan ${updated} data dasar diperbarui. Baris error/skip tidak diimpor.`)
    setPreview(null); setFileName(''); if (inputRef.current) inputRef.current.value = ''
  }
  const downloadTemplate = () => exportBusinessTable({ headers: [...importColumns], rows: templateRows }, 'template-import-employee-demo.xlsx')

  return <>
    <PageHeader eyebrow="CONTROLLED DATA INPUT" title="Import Excel" description="Simulasi alur Excel → Preview → Validation → Import, seluruhnya diproses di browser." actions={<button className="button secondary" onClick={downloadTemplate}><Download /> Download template & test cases</button>} />
    <div className="rule-note"><strong>Prototype Import</strong> Production mapping akan disesuaikan kembali dengan struktur database final PT Gelatik Supra. Import tidak pernah menghapus movement history.</div>
    {message && <div className="alert success"><CheckCircle2 /><div><strong>Import selesai</strong><p>{message}</p></div></div>}
    <section className="card import-upload"><input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFile} /><span><Upload /></span><div><h2>{processing ? 'Membaca file...' : fileName || 'Pilih file Excel (.xlsx)'}</h2><p>Kolom yang didukung: {importColumns.join(', ')}</p></div><button className="button primary" onClick={() => inputRef.current?.click()} disabled={processing}>Pilih Excel</button></section>
    {preview && <>{preview.headerErrors.length > 0 && <div className="alert error"><XCircle /><div><strong>Struktur file belum sesuai</strong>{preview.headerErrors.map((error) => <p key={error}>{error}</p>)}</div></div>}{!preview.headerErrors.length && <>
      <section className="import-counts"><article className="card"><CheckCircle2 /><strong>{counts.VALID}</strong><span>Valid Rows</span></article><article className="card warning"><AlertCircle /><strong>{counts.WARNING}</strong><span>Warning Rows</span></article><article className="card error"><XCircle /><strong>{counts.ERROR}</strong><span>Error Rows</span></article></section>
      <section className="card table-card"><div className="table-title"><div><span className="section-icon"><FileSpreadsheet /></span><div><h2>Import Preview</h2><p>Tinjau konflik Personnel ID sebelum konfirmasi.</p></div></div><span className="record-count">{preview.rows.length} ROWS</span></div><div className="table-scroll"><table><thead><tr><th>Row</th><th>Personnel ID / Name</th><th>Placement</th><th>Join / Status</th><th>Result</th><th>Conflict Action</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td><strong>{row.values.personnel_id || '-'}</strong><small>{row.values.name || '-'}</small></td><td><strong>{row.values.area || '-'}</strong><small>{row.values.project || '-'} · {row.values.position || '-'}</small></td><td><strong>{row.values.join_date || '-'}</strong><small>{row.values.employment_status || '-'}</small></td><td><StatusBadge tone={row.status === 'VALID' ? 'success' : row.status === 'WARNING' ? 'warning' : 'danger'}>{row.status}</StatusBadge><small>{row.messages.join(' ') || 'Siap diimpor.'}</small></td><td>{row.duplicateEmployeeId ? <select value={row.decision} onChange={(event) => setDecision(row.rowNumber, event.target.value as DuplicateDecision)}><option value="SKIP">Skip</option><option value="UPDATE">Update current basic fields</option></select> : '-'}</td></tr>)}</tbody></table></div><div className="import-confirm"><p><strong>{counts.ERROR}</strong> baris error tidak akan diproses. Duplicate default-nya Skip.</p><button className="button success" onClick={confirmImport} disabled={!preview.rows.some((row) => row.fields && (row.status === 'VALID' || row.decision === 'UPDATE'))}><Upload /> Confirm Import Valid Data</button></div></section>
    </>}</>}
  </>
}
