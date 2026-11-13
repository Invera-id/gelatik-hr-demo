import { AlertCircle, AlertTriangle, CheckCircle2, Database, Download, FileSpreadsheet, GitCompareArrows, HardDriveDownload, Loader2, Upload, XCircle } from 'lucide-react'
import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { ImportReviewQueue } from '../components/ImportReviewQueue'
import { StatusBadge } from '../components/StatusBadge'
import { useDemo } from '../context/DemoContext'
import { exportBusinessTable, type ExportValue } from '../lib/excelExport'
import { COLUMN_TEMPLATE } from '../lib/import/columns'
import type { ImportPhase, ImportRunResult, PreparedImport } from '../lib/import/service'
import type { FieldIssue, ImportBatchStatus } from '../lib/import/types'

const phases = (target: string): Array<{ key: ImportPhase; label: string }> => [
  { key: 'READING', label: 'Membaca file' },
  { key: 'PARSING', label: 'Memvalidasi data' },
  { key: 'PREVIEW', label: 'Periksa peringatan & konfirmasi' },
  { key: 'SAVING', label: `Menyimpan ke ${target}` },
  { key: 'DONE', label: 'Selesai' },
]

const STATUS_META: Record<ImportBatchStatus, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  COMPLETED: { label: 'Selesai', tone: 'success' },
  COMPLETED_WITH_REVIEW: { label: 'Selesai, perlu review', tone: 'warning' },
  COMPLETED_WITH_WARNINGS: { label: 'Selesai dengan peringatan', tone: 'warning' },
  COMPLETED_WITH_EXCEPTIONS: { label: 'Selesai dengan baris perlu diperbaiki', tone: 'warning' },
  FAILED: { label: 'Gagal', tone: 'danger' },
}

const MAX_ISSUE_ROWS = 300

interface IssueRow { key: string; rowNumber: number; column: string; type: 'EXCEPTION' | 'WARNING'; reason: string; rawValue: string }

/** Row/column issue list. Shown on the preview (before anything is saved) and after commit. */
function IssueDetails({ rows, total, beforeSave, onDownload }: { rows: IssueRow[]; total: number; beforeSave: boolean; onDownload: () => void }) {
  const byColumn = [...rows.reduce((map, row) => map.set(row.column, (map.get(row.column) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])
  return <section className="card table-card">
    <div className="table-title">
      <div><span className="section-icon"><AlertTriangle /></span><div><h2>{beforeSave ? 'Peringatan & Error Sebelum Disimpan' : 'Rincian Masalah'}</h2><p>{beforeSave ? 'Periksa baris dan kolom berikut. Peringatan tidak menggagalkan baris (nilai asli disimpan apa adanya dan tidak dipakai sebagai angka); error harus diperbaiki di workbook lalu file dipilih ulang.' : 'Peringatan tidak menggagalkan baris; exception perlu diperbaiki di sumber.'}</p></div></div>
      <button className="button secondary" onClick={onDownload}><Download /> Unduh laporan</button>
    </div>
    <div className="issue-columns">{byColumn.map(([column, count]) => <span key={column}><strong>{column}</strong> {count}</span>)}</div>
    <div className="table-scroll">
      <table>
        <thead><tr><th>Baris Excel</th><th>Kolom</th><th>Jenis</th><th>Nilai di file</th><th>Alasan</th></tr></thead>
        <tbody>
          {rows.slice(0, MAX_ISSUE_ROWS).map((row) => (
            <tr key={row.key}>
              <td>{row.rowNumber}</td>
              <td>{row.column}</td>
              <td><StatusBadge tone={row.type === 'EXCEPTION' ? 'danger' : 'warning'}>{row.type === 'EXCEPTION' ? 'Error, perlu diperbaiki' : 'Peringatan'}</StatusBadge></td>
              <td>{row.rawValue || '—'}</td>
              <td>{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {(rows.length > MAX_ISSUE_ROWS || total > rows.length) && <div className="empty-inline">Menampilkan {Math.min(MAX_ISSUE_ROWS, rows.length)} dari {total} masalah. {total > rows.length ? `Laporan memuat ${rows.length} masalah pertama; perbaiki lalu unggah ulang untuk melihat sisanya.` : 'Unduh laporan untuk daftar lengkap.'}</div>}
  </section>
}

const KIND_PREVIEW_LABEL: Record<string, string> = {
  IDENTICAL_DUPLICATE: 'Duplikasi identik',
  PROFILE_VARIATION: 'Variasi profil',
  PLACEMENT_CHANGE: 'Perubahan penempatan',
  EXIT: 'Exit',
  REENTRY: 'Re-entry',
  IDENTITY_CONFLICT: 'Konflik identitas',
  UNDETERMINED: 'Belum dapat ditentukan',
}

export function ImportPage() {
  const { currentUser, canImportPersonnel, preparePersonnelImport, confirmPersonnelImport, importSourceRecords, importExceptions, importStorageReady, importStorageError, dataSource } = useDemo()
  const inputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<ImportPhase | null>(null)
  const [result, setResult] = useState<ImportRunResult | null>(null)
  const [fileName, setFileName] = useState('')
  const [prepared, setPrepared] = useState<PreparedImport | null>(null)
  const [lastWarnings, setLastWarnings] = useState<FieldIssue[]>([])
  const [acknowledged, setAcknowledged] = useState(false)
  const PHASES = phases(dataSource === 'api' ? 'server' : 'browser')

  const processing = phase !== null && !['PREVIEW', 'DONE'].includes(phase)
  const batchId = result?.ok ? result.batch?.id ?? null : null

  const warnings = useMemo(
    () => prepared ? prepared.warnings ?? prepared.plan.sourceRecordsToPut.flatMap((record) => record.warnings) : (batchId ? lastWarnings.length ? lastWarnings : importSourceRecords.filter((record) => record.batchId === batchId).flatMap((record) => record.warnings) : []),
    [batchId, importSourceRecords, lastWarnings, prepared],
  )
  const exceptions = useMemo(
    () => prepared ? prepared.plan.exceptions : (batchId ? importExceptions.filter((e) => e.batchId === batchId) : []),
    [batchId, importExceptions, prepared],
  )

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || processing) return
    setFileName(file.name)
    setResult(null)
    setPrepared(null)
    setLastWarnings([])
    setAcknowledged(false)
    setPhase('READING')
    const previewResult = await preparePersonnelImport(file, setPhase)
    if (previewResult.ok && previewResult.prepared) {
      setPrepared(previewResult.prepared)
      setLastWarnings(previewResult.prepared.warnings ?? previewResult.prepared.plan.sourceRecordsToPut.flatMap((record) => record.warnings))
      setPhase('PREVIEW')
    } else {
      setResult({ ok: false, batch: null, summary: null, status: null, exceptions: [], error: previewResult.error })
      setPhase(null)
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  const confirmImport = async () => {
    if (!prepared || processing) return
    setPhase('SAVING')
    const runResult = await confirmPersonnelImport(prepared, setPhase)
    setResult(runResult)
    if (runResult.ok) setPrepared(null)
    setPhase(runResult.ok ? 'DONE' : null)
  }

  const cancelPreview = () => {
    setPrepared(null)
    setLastWarnings([])
    setAcknowledged(false)
    setResult(null)
    setPhase(null)
    setFileName('')
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
      ...issueRows.map((row) => [row.rowNumber, row.column, row.type === 'EXCEPTION' ? 'ERROR' : 'WARNING', row.reason, row.rawValue]),
    ]
    const base = (fileName || 'import').replace(/\.xlsx$/i, '')
    exportBusinessTable({ headers: ['Baris Excel', 'Kolom', 'Jenis', 'Alasan', 'Nilai Sumber'], rows }, `laporan-masalah-${base}${batchId ? `-${batchId}` : '-preview'}.csv`)
  }

  const summary = prepared?.plan.summary ?? (result?.ok ? result.summary : null)
  const statusMeta = result?.ok && result.status ? STATUS_META[result.status] : null
  const issueRows: IssueRow[] = [
    ...exceptions.map((e) => ({ key: `e-${e.id}`, rowNumber: e.rowNumber, column: '—', type: 'EXCEPTION' as const, reason: e.reason, rawValue: Object.entries(e.rawValues).slice(0, 3).map(([k, v]) => `${k}=${v}`).join('; ') })),
    ...warnings.map((w, i) => ({ key: `w-${i}`, rowNumber: w.rowNumber, column: w.column, type: 'WARNING' as const, reason: w.reason, rawValue: w.rawValue ?? '' })),
  ].sort((a, b) => a.rowNumber - b.rowNumber)
  const issueTotal = exceptions.length + (prepared?.warningsTotal ?? warnings.length)
  const needsAck = Boolean(prepared && warnings.length > 0)
  const repeatedIdentities = useMemo(() => {
    if (!prepared) return []
    const allSources = [...importSourceRecords, ...prepared.plan.sourceRecordsToPut]
    const sourceById = new Map(allSources.map((record) => [record.id, record]))
    const byBusinessKey = new Map<string, { personnelId: string; name: string; rowNumbers: number[]; kinds: Set<string> }>()
    for (const item of prepared.plan.reviewItemsToPut) {
      const sourceRecords = item.recordIds.map((id) => sourceById.get(id)).filter(Boolean)
      // API previews carry row numbers only; local previews resolve their source records.
      const rows = sourceRecords.length ? sourceRecords.map((record) => record!.rowNumber) : item.rowNumbers
      if (Math.max(sourceRecords.length, item.rowNumbers.length) < 2) continue
      const current = byBusinessKey.get(item.businessKey) ?? {
        personnelId: item.personnelId,
        name: item.personnelName,
        rowNumbers: [],
        kinds: new Set<string>(),
      }
      current.rowNumbers.push(...rows)
      item.aspects.forEach((kind) => current.kinds.add(kind))
      byBusinessKey.set(item.businessKey, current)
    }
    return [...byBusinessKey.entries()].map(([businessKey, value]) => ({
      businessKey,
      personnelId: value.personnelId,
      name: value.name,
      rowNumbers: [...new Set(value.rowNumbers)].sort((a, b) => a - b),
      kinds: [...value.kinds],
    }))
  }, [importSourceRecords, prepared])

  if (!currentUser) return null

  return <>
    <PageHeader
      eyebrow="CONTROLLED DATA INPUT"
      title="Import Excel Personil"
      description={`Pilih file, periksa validasi dan preview, lalu konfirmasi sebelum data disimpan ${dataSource === 'api' ? 'ke server' : 'ke browser'}.`}
      actions={<button className="button secondary" onClick={downloadTemplate}><Download /> Download template Database</button>}
    />

    <div className="rule-note">
      <strong>{dataSource === 'api' ? 'Diproses di server' : 'Penyimpanan lokal'}</strong>
      <span>{dataSource === 'api' ? 'File diparse dan direkonsiliasi oleh server; preview disimpan sementara dan baru menjadi data setelah konfirmasi. Workbook mentah tidak disimpan.' : 'Data impor disimpan di browser/perangkat ini (IndexedDB) dan tetap ada setelah refresh — bukan di server.'} Hanya sheet bernama <b>Database</b> yang diproses; sheet lain (termasuk <em>Database aktif</em>) diabaikan.</span>
    </div>

    {importStorageReady && importStorageError && (
      <div className="alert error"><XCircle /><div><strong>Penyimpanan lokal tidak tersedia</strong><p>{importStorageError}</p></div></div>
    )}

    {!canImportPersonnel && (
      <div className="alert warning"><AlertTriangle /><div><strong>Akses terbatas</strong><p>Role Anda tidak memiliki permission Mengimpor Excel Personel. Antrean review tetap dapat dilihat jika permission terkait aktif.</p></div></div>
    )}

    <section className="card import-upload">
      <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFile} disabled={processing || !canImportPersonnel} />
      <span><Upload /></span>
      <div>
        <h2>{processing ? 'Memproses…' : fileName || 'Pilih file Excel (.xlsx)'}</h2>
        <p>File belum disimpan saat dipilih. Hanya .xlsx dengan sheet <strong>Database</strong>; kolom dikenali berdasarkan nama header.</p>
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

    {prepared && summary && (
      <section className="card">
        <div className="alert warning"><AlertTriangle /><div><strong>Preview siap — belum ada data yang disimpan</strong><p>{prepared.scopePreview.validInScopeRows} valid dalam scope, {prepared.scopePreview.warningReviewRows} warning/review, {prepared.scopePreview.errorRows} error, dan {prepared.scopePreview.outOfScopeRows} di luar scope.</p><p>{prepared.discoveredAreas.length} Area dan {prepared.discoveredProjects.length} Project baru di dalam scope akan disimpan setelah konfirmasi.</p></div></div>
        <div className="import-counts scope-preview-counts">
          <article className="card"><CheckCircle2 /><strong>{prepared.scopePreview.validInScopeRows}</strong><span>Valid dalam scope</span></article>
          <article className="card warning"><AlertTriangle /><strong>{prepared.scopePreview.warningReviewRows}</strong><span>Warning / review</span></article>
          <article className="card error"><XCircle /><strong>{prepared.scopePreview.errorRows}</strong><span>Error</span></article>
          <article className="card"><Database /><strong>{prepared.scopePreview.outOfScopeRows}</strong><span>Di luar scope</span></article>
        </div>
        {issueTotal > 0 ? <p className="field-error">{issueTotal} masalah ditemukan di {new Set(issueRows.map((row) => row.rowNumber)).size} baris. Rincian baris dan kolomnya ada di tabel di bawah. Belum ada yang disimpan.</p> : <p className="empty-inline">Tidak ada peringatan atau error pada baris dalam scope.</p>}
        {needsAck && summary.exceptionRows === 0 && <label className="checkbox-line"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> Saya sudah memeriksa peringatan di bawah dan tetap ingin menyimpan</label>}
        <div className="form-actions">
          <button className="button secondary" onClick={cancelPreview} disabled={processing}>Batal</button>
          <button className="button primary" onClick={confirmImport} disabled={processing || summary.exceptionRows > 0 || (needsAck && !acknowledged)}><HardDriveDownload /> Konfirmasi & Simpan</button>
        </div>
        {summary.exceptionRows > 0 && <p className="field-error">Perbaiki seluruh exception di workbook lalu pilih file kembali. Plan ini tidak dapat dikomit.</p>}
      </section>
    )}

    {prepared && issueRows.length > 0 && <IssueDetails rows={issueRows} total={issueTotal} beforeSave onDownload={downloadIssues} />}

    {prepared && prepared.scopePreview.excludedRows.length > 0 && (
      <section className="card table-card">
        <div className="table-title"><div><span className="section-icon"><AlertTriangle /></span><div><h2>Baris di Luar Cakupan Area</h2><p>Baris berikut tidak masuk plan import dan tidak dapat membuat referensi Area/Project.</p></div></div><span className="record-count">{prepared.scopePreview.excludedRows.length} BARIS</span></div>
        <div className="table-scroll"><table><thead><tr><th>Baris</th><th>Personnel ID</th><th>Nama</th><th>Area</th><th>Status</th></tr></thead><tbody>{prepared.scopePreview.excludedRows.slice(0, 100).map((row) => <tr key={`${row.rowNumber}-${row.personnelId}`}><td>{row.rowNumber}</td><td>{row.personnelId}</td><td>{row.name}</td><td>{row.areaName}</td><td><StatusBadge tone="neutral">{row.message}</StatusBadge></td></tr>)}</tbody></table></div>
      </section>
    )}

    {prepared && repeatedIdentities.length > 0 && (
      <section className="card table-card">
        <div className="table-title"><div><span className="section-icon"><GitCompareArrows /></span><div><h2>Personnel ID dengan Beberapa Catatan</h2><p>Ini bukan otomatis data ganda. Catatan dapat mewakili koreksi, mutasi, exit, atau re-entry dan perlu ditinjau.</p></div></div><span className="record-count">{repeatedIdentities.length} ID</span></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Personnel ID</th><th>Nama</th><th>Jumlah Catatan</th><th>Baris Excel</th><th>Indikasi</th></tr></thead>
            <tbody>{repeatedIdentities.slice(0, 100).map((item) => <tr key={item.businessKey}><td><strong>{item.personnelId}</strong></td><td>{item.name}</td><td>{item.rowNumbers.length}</td><td>{item.rowNumbers.join(', ')}</td><td>{item.kinds.map((kind) => KIND_PREVIEW_LABEL[kind] ?? kind).join(', ') || 'Perlu review'}</td></tr>)}</tbody>
          </table>
        </div>
        {repeatedIdentities.length > 100 && <div className="empty-inline">Menampilkan 100 dari {repeatedIdentities.length} Personnel ID.</div>}
      </section>
    )}

    {result?.ok && summary && statusMeta && (
      <>
        <div className={`alert ${statusMeta.tone === 'success' ? 'success' : 'warning'}`}>
          {statusMeta.tone === 'success' ? <CheckCircle2 /> : <AlertCircle />}
          <div>
            <strong>Impor {statusMeta.label.toLowerCase()}</strong>
            <p>{summary.fileName} · sheet {summary.sheetName}. Data tersimpan {dataSource === 'api' ? 'di server' : 'di browser ini'}. <Link to="/employees">Lihat daftar personil →</Link></p>
          </div>
        </div>

        <section className="import-counts">
          <article className="card"><CheckCircle2 /><strong>{summary.newMasters}</strong><span>Personil baru</span></article>
          <article className="card"><HardDriveDownload /><strong>{summary.newSourceRecords}</strong><span>Catatan riwayat baru</span></article>
          <article className="card"><Database /><strong>{summary.identicalDuplicates}</strong><span>Duplikasi identik</span></article>
          <article className="card warning"><GitCompareArrows /><strong>{summary.pendingReviewItems}</strong><span>Perlu ditinjau</span></article>
          <article className="card error"><XCircle /><strong>{summary.exceptionRows}</strong><span>Baris perlu diperbaiki</span></article>
        </section>

        <section className="card">
          <div className="table-title"><div><span className="section-icon"><FileSpreadsheet /></span><div><h2>Ringkasan Impor</h2><p>Jumlah baris sumber tidak sama dengan jumlah personil — satu personil dapat punya beberapa catatan.</p></div></div><StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge></div>
          <div className="summary-grid">
            <div><span>Baris nonkosong</span><strong>{summary.nonEmptyRows}</strong></div>
            <div><span>Identitas unik</span><strong>{summary.uniqueIdentities}</strong></div>
            <div><span>Personil baru</span><strong>{summary.newMasters}</strong></div>
            <div><span>Catatan riwayat baru</span><strong>{summary.newSourceRecords}</strong></div>
            <div><span>Duplikasi identik</span><strong>{summary.identicalDuplicates}</strong></div>
            <div><span>Kandidat movement</span><strong>{summary.movementCandidates}</strong></div>
            <div><span>Kandidat exit/re-entry</span><strong>{summary.exitReentryCandidates}</strong></div>
            <div><span>Kasus ambigu</span><strong>{summary.ambiguousCases}</strong></div>
            <div><span>Konflik identitas</span><strong>{summary.identityConflicts}</strong></div>
            <div><span>Kejadian terkonfirmasi</span><strong>{summary.confirmedEvents}</strong></div>
            <div><span>Perlu ditinjau</span><strong>{summary.pendingReviewItems}</strong></div>
            <div><span>Baris dengan peringatan</span><strong>{summary.warningRows}</strong></div>
            <div><span>Baris exception</span><strong>{summary.exceptionRows}</strong></div>
            <div><span>Di luar scope</span><strong>{summary.outOfScopeRows ?? 0}</strong></div>
            <div><span>Baris kosong dilewati</span><strong>{summary.blankRowsSkipped}</strong></div>
          </div>
        </section>

        {issueRows.length > 0 && <IssueDetails rows={issueRows} total={issueTotal} beforeSave={false} onDownload={downloadIssues} />}
      </>
    )}

    <ImportReviewQueue />
  </>
}
