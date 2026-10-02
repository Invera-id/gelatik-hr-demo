import { AlertCircle, AlertTriangle, CheckCircle2, Database, Download, FileSpreadsheet, HardDriveDownload, Loader2, Upload, XCircle } from 'lucide-react'
import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { useDemo } from '../context/DemoContext'
import { exportBusinessTable, type ExportValue } from '../lib/excelExport'
import { COLUMN_TEMPLATE } from '../lib/import/columns'
import type { ImportPhase, ImportRunResult } from '../lib/import/service'
import type { ImportBatchStatus } from '../lib/import/types'

const PHASES: Array<{ key: ImportPhase; label: string }> = [
  { key: 'READING', label: 'Membaca file' },
  { key: 'PARSING', label: 'Memvalidasi data' },
  { key: 'SAVING', label: 'Menyimpan ke browser' },
  { key: 'DONE', label: 'Selesai' },
]

const STATUS_META: Record<ImportBatchStatus, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  COMPLETED: { label: 'Selesai', tone: 'success' },
  COMPLETED_WITH_WARNINGS: { label: 'Selesai dengan peringatan', tone: 'warning' },
  COMPLETED_WITH_EXCEPTIONS: { label: 'Selesai dengan baris perlu diperbaiki', tone: 'warning' },
  FAILED: { label: 'Gagal', tone: 'danger' },
}

const MAX_ISSUE_ROWS = 300

export function ImportPage() {
  const { currentUser, canImportPersonnel, importPersonnelFile, importedPersonnel, importExceptions, importStorageReady, importStorageError } = useDemo()
  const inputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<ImportPhase | null>(null)
  const [result, setResult] = useState<ImportRunResult | null>(null)
  const [fileName, setFileName] = useState('')

  const processing = phase !== null && phase !== 'DONE'
  const batchId = result?.ok ? result.batch?.id ?? null : null

  const warnings = useMemo(
    () => (batchId ? importedPersonnel.filter((p) => p.batchId === batchId).flatMap((p) => p.warnings) : []),
    [batchId, importedPersonnel],
  )
  const exceptions = useMemo(
    () => (batchId ? importExceptions.filter((e) => e.batchId === batchId) : []),
    [batchId, importExceptions],
  )

  if (!currentUser) return null

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || processing) return
    setFileName(file.name)
    setResult(null)
    setPhase('READING')
    const runResult = await importPersonnelFile(file, setPhase)
    setResult(runResult)
    setPhase(runResult.ok ? 'DONE' : null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const downloadTemplate = async () => {
    try {
      // write-excel-file's single-sheet "data" overload typings don't expose `sheet`.
      type LooseWriter = (data: unknown, options?: Record<string, unknown>) => { toFile: (name: string) => Promise<void> }
      const write = (await import('write-excel-file/browser')).default as unknown as LooseWriter
      const header = COLUMN_TEMPLATE.map((column) => ({ value: column.header, fontWeight: 'bold' as const }))
      const example = COLUMN_TEMPLATE.map((column) =>
        column.field === 'personnelId' ? { value: 'ID-CONTOH-001', type: String } :
        column.field === 'name' ? { value: 'Nama Contoh', type: String } : { value: null },
      )
      const columns = COLUMN_TEMPLATE.map((column) => ({ width: Math.max(14, Math.min(34, column.header.length + 4)) }))
      await write([header, example], { sheet: 'Database', stickyRowsCount: 1, columns }).toFile('template-import-personil.xlsx')
    } catch {
      await exportBusinessTable({ headers: COLUMN_TEMPLATE.map((c) => c.header), rows: [] }, 'template-import-personil.xlsx')
    }
  }

  const downloadIssues = () => {
    const rows: ExportValue[][] = [
      ...exceptions.map((e) => [e.rowNumber, '-', 'EXCEPTION', e.reason, Object.entries(e.rawValues).slice(0, 3).map(([k, v]) => `${k}=${v}`).join('; ')]),
      ...warnings.map((w) => [w.rowNumber, w.column, 'WARNING', w.reason, w.rawValue ?? '']),
    ].sort((a, b) => Number(a[0]) - Number(b[0]))
    exportBusinessTable({ headers: ['Baris Excel', 'Kolom', 'Jenis', 'Alasan', 'Nilai Sumber'], rows }, `laporan-masalah-import-${batchId}.csv`)
  }

  const summary = result?.ok ? result.summary : null
  const statusMeta = result?.ok && result.status ? STATUS_META[result.status] : null
  const issueRows = [
    ...exceptions.map((e) => ({ key: `e-${e.id}`, rowNumber: e.rowNumber, column: '—', type: 'EXCEPTION' as const, reason: e.reason })),
    ...warnings.map((w, i) => ({ key: `w-${i}`, rowNumber: w.rowNumber, column: w.column, type: 'WARNING' as const, reason: w.reason })),
  ].sort((a, b) => a.rowNumber - b.rowNumber)

  return <>
    <PageHeader
      eyebrow="CONTROLLED DATA INPUT"
      title="Import Excel Personil"
      description="Pilih satu file Excel; sistem membaca sheet Database, menormalisasi, memvalidasi, lalu menyimpan otomatis."
      actions={<button className="button secondary" onClick={downloadTemplate}><Download /> Download template Database</button>}
    />

    <div className="rule-note">
      <strong>Penyimpanan lokal</strong> Data impor disimpan di browser/perangkat ini (IndexedDB) dan tetap ada setelah refresh — bukan di server. Hanya sheet bernama <strong>Database</strong> yang diproses; sheet lain (termasuk <em>Database aktif</em>) diabaikan.
    </div>

    {importStorageReady && importStorageError && (
      <div className="alert error"><XCircle /><div><strong>Penyimpanan lokal tidak tersedia</strong><p>{importStorageError}</p></div></div>
    )}

    {!canImportPersonnel && (
      <div className="alert warning"><AlertTriangle /><div><strong>Akses terbatas</strong><p>Hanya HR Head Office dan Super Admin yang dapat mengimpor personil.</p></div></div>
    )}

    <section className="card import-upload">
      <input ref={inputRef} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFile} disabled={processing || !canImportPersonnel} />
      <span><Upload /></span>
      <div>
        <h2>{processing ? 'Memproses…' : fileName || 'Pilih file Excel (.xlsx)'}</h2>
        <p>Impor otomatis berjalan begitu file dipilih. Hanya sheet <strong>Database</strong> yang dibaca.</p>
      </div>
      <button className="button primary" onClick={() => inputRef.current?.click()} disabled={processing || !canImportPersonnel}>
        {processing ? <><Loader2 className="spin" /> Memproses</> : <>Pilih Excel</>}
      </button>
    </section>

    {phase && (
      <section className="card">
        <div className="import-steps">
          {PHASES.map((step) => {
            const activeIndex = PHASES.findIndex((p) => p.key === phase)
            const stepIndex = PHASES.findIndex((p) => p.key === step.key)
            const state = stepIndex < activeIndex ? 'done' : stepIndex === activeIndex ? 'active' : 'pending'
            return <div key={step.key} className={`import-step ${state}`}>
              {state === 'done' ? <CheckCircle2 size={18} /> : state === 'active' && processing ? <Loader2 size={18} className="spin" /> : <Database size={18} />}
              <span>{step.label}</span>
            </div>
          })}
        </div>
      </section>
    )}

    {result && !result.ok && (
      <div className="alert error"><XCircle /><div><strong>Impor gagal — tidak ada perubahan data</strong><p>{result.error}</p></div></div>
    )}

    {result?.ok && summary && statusMeta && (
      <>
        <div className={`alert ${statusMeta.tone === 'success' ? 'success' : 'warning'}`}>
          {statusMeta.tone === 'success' ? <CheckCircle2 /> : <AlertCircle />}
          <div>
            <strong>Impor {statusMeta.label.toLowerCase()}</strong>
            <p>{summary.fileName} · sheet {summary.sheetName}. Data tersimpan di browser ini. <Link to="/employees">Lihat daftar personil →</Link></p>
          </div>
        </div>

        <section className="import-counts">
          <article className="card"><CheckCircle2 /><strong>{summary.added}</strong><span>Personil ditambahkan</span></article>
          <article className="card"><HardDriveDownload /><strong>{summary.updated}</strong><span>Personil diperbarui</span></article>
          <article className="card"><Database /><strong>{summary.unchanged}</strong><span>Tidak berubah</span></article>
          <article className="card warning"><AlertCircle /><strong>{summary.warningRows}</strong><span>Baris dengan peringatan</span></article>
          <article className="card error"><XCircle /><strong>{summary.exceptionRows}</strong><span>Baris perlu diperbaiki</span></article>
        </section>

        <section className="card">
          <div className="table-title"><div><span className="section-icon"><FileSpreadsheet /></span><div><h2>Ringkasan Impor</h2><p>Perhitungan lengkap untuk setiap baris sumber.</p></div></div><StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge></div>
          <div className="summary-grid">
            <div><span>Baris nonkosong</span><strong>{summary.nonEmptyRows}</strong></div>
            <div><span>ID unik</span><strong>{summary.uniqueIds}</strong></div>
            <div><span>Duplikat dalam file</span><strong>{summary.duplicatesInFile}</strong></div>
            <div><span>Baris kosong dilewati</span><strong>{summary.blankRowsSkipped}</strong></div>
            <div><span>Ditambahkan</span><strong>{summary.added}</strong></div>
            <div><span>Diperbarui</span><strong>{summary.updated}</strong></div>
            <div><span>Tidak berubah</span><strong>{summary.unchanged}</strong></div>
            <div><span>Baris exception</span><strong>{summary.exceptionRows}</strong></div>
          </div>
        </section>

        {issueRows.length > 0 && (
          <section className="card table-card">
            <div className="table-title">
              <div><span className="section-icon"><AlertTriangle /></span><div><h2>Rincian Masalah</h2><p>Peringatan tidak menggagalkan baris; exception perlu diperbaiki di sumber.</p></div></div>
              <button className="button secondary" onClick={downloadIssues}><Download /> Unduh laporan</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Baris</th><th>Kolom</th><th>Jenis</th><th>Alasan</th></tr></thead>
                <tbody>
                  {issueRows.slice(0, MAX_ISSUE_ROWS).map((row) => (
                    <tr key={row.key}>
                      <td>{row.rowNumber}</td>
                      <td>{row.column}</td>
                      <td><StatusBadge tone={row.type === 'EXCEPTION' ? 'danger' : 'warning'}>{row.type === 'EXCEPTION' ? 'Perlu diperbaiki' : 'Peringatan'}</StatusBadge></td>
                      <td>{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {issueRows.length > MAX_ISSUE_ROWS && <div className="empty-inline">Menampilkan {MAX_ISSUE_ROWS} dari {issueRows.length} masalah. Unduh laporan untuk daftar lengkap.</div>}
          </section>
        )}
      </>
    )}
  </>
}
