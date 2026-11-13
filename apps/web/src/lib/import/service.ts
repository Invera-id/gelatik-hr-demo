import type { Area, Project } from '../../types'
import { parseWorkbook } from './parse'
import { reconcile } from './reconcile'
import type { PersonnelRepository } from './repository'
import type { SheetTable } from './workbook'
import type { ParseResult, ParsedSourceRecord } from './parse'
import { ImportAbortError, type FieldIssue, type ImportBatch, type ImportException, type ImportSummary, type ImportBatchStatus } from './types'
import type { ImportPlan } from './reconcile'
import { buildImportReferenceCatalog } from './referenceCatalog'

export type ImportPhase = 'READING' | 'PARSING' | 'PREVIEW' | 'SAVING' | 'DONE'

export interface PreparedImport {
  plan: ImportPlan
  repositorySnapshot: string
  discoveredAreas: Area[]
  discoveredProjects: Project[]
  scopePreview: ImportScopePreview
  allowedAreaNames: string[] | null
  /** API mode: opaque server staging token used to commit this exact preview. */
  previewId?: string
  /** API mode: row warnings computed by the server (no source rows are sent to the browser). */
  warnings?: FieldIssue[]
  /** API mode: total warnings in the plan (greater than warnings.length when the list is capped). */
  warningsTotal?: number
}

export interface OutOfScopeImportRow {
  rowNumber: number
  personnelId: string
  name: string
  areaName: string
  message: 'Di luar cakupan area — tidak diimpor.'
}

export interface ImportScopePreview {
  validInScopeRows: number
  warningReviewRows: number
  errorRows: number
  outOfScopeRows: number
  excludedRows: OutOfScopeImportRow[]
}

export interface PrepareImportResult {
  ok: boolean
  prepared: PreparedImport | null
  error: string | null
}

export interface ImportRunResult {
  ok: boolean
  batch: ImportBatch | null
  summary: ImportSummary | null
  status: ImportBatchStatus | null
  exceptions: ImportException[]
  /** Error message shown to the user when ok === false. */
  error: string | null
}

export interface RunImportOptions {
  file: File
  repository: PersonnelRepository
  areas: Area[]
  projects: Project[]
  createdBy: string
  /** Injectable reader so the file I/O layer (and worker) can be swapped/tested. */
  readWorkbook?: (file: File) => Promise<SheetTable[]>
  onProgress?: (phase: ImportPhase) => void
  date1904?: boolean
  /** Identities owned by localStorage/manual state; never duplicate them in IndexedDB. */
  existingBusinessKeys?: string[]
  /** Null/undefined means national access; an array restricts import by Area name. */
  allowedAreaNames?: string[] | null
}

/** 20 MB ceiling keeps a single spreadsheet from exhausting browser memory. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

let importInFlight = false

const repositorySignature = (
  masters: Awaited<ReturnType<PersonnelRepository['getAllPersonnel']>>,
  sources: Awaited<ReturnType<PersonnelRepository['getSourceRecords']>>,
  reviews: Awaited<ReturnType<PersonnelRepository['getReviewItems']>>,
) => JSON.stringify({
  masters: masters.map((item) => [item.businessKey, item.updatedAt]).sort(),
  sources: sources.map((item) => item.id).sort(),
  reviews: reviews.map((item) => [item.id, item.status, item.updatedAt]).sort(),
})

/** Read an .xlsx/.xls workbook into raw matrices using read-excel-file (browser build). */
export const readWorkbookBrowser = async (file: File): Promise<SheetTable[]> => {
  // read-excel-file's typings don't cover the getSheets/sheet options we rely on.
  type LooseReader = (file: File, opts?: Record<string, unknown>) => Promise<unknown>
  let read: LooseReader
  try {
    read = (await import('read-excel-file/browser')).default as unknown as LooseReader
  } catch {
    throw new ImportAbortError('Parser Excel gagal dimuat.')
  }
  try {
    const sheets = (await read(file, { getSheets: true })) as Array<{ sheet?: string; name?: string; data?: unknown[][] }>
    const tables: SheetTable[] = []
    for (const entry of sheets) {
      const name = entry.sheet ?? entry.name ?? ''
      const rows = entry.data ?? ((await read(file, { sheet: name })) as unknown[][])
      tables.push({ name, rows })
    }
    return tables
  } catch (error) {
    if (error instanceof ImportAbortError) throw error
    throw new ImportAbortError(
      'File tidak dapat dibaca. Pastikan file berupa .xlsx yang valid, tidak rusak, dan tidak terenkripsi.',
    )
  }
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const normalizeAreaName = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('id-ID')

const groupRecords = (records: ParsedSourceRecord[]) => {
  const groups = new Map<string, ParsedSourceRecord[]>()
  records.forEach((record) => groups.set(record.businessKey, [...(groups.get(record.businessKey) ?? []), record]))
  return groups
}

/** Apply Area scope before catalog discovery/reconciliation, so excluded rows cannot create references. */
const applyAreaScope = (parsed: ParseResult, allowedAreaNames: string[] | null | undefined) => {
  if (allowedAreaNames == null) return { parsed, excludedRows: [] as OutOfScopeImportRow[] }
  const allowed = new Set(allowedAreaNames.map(normalizeAreaName))
  const kept: ParsedSourceRecord[] = []
  const excludedRows: OutOfScopeImportRow[] = []
  const scopeErrors = [...parsed.exceptions]
  for (const record of parsed.records) {
    const areaName = record.fields.areaCbs?.trim() ?? ''
    if (!areaName) {
      scopeErrors.push({ rowNumber: record.rowNumber, reason: 'Area tidak dapat dipetakan. Baris tidak diimpor.', rawValues: record.rawValues })
      continue
    }
    if (!allowed.has(normalizeAreaName(areaName))) {
      excludedRows.push({ rowNumber: record.rowNumber, personnelId: record.personnelId, name: record.name, areaName, message: 'Di luar cakupan area — tidak diimpor.' })
      continue
    }
    kept.push(record)
  }
  return {
    parsed: { ...parsed, records: kept, groups: groupRecords(kept), exceptions: scopeErrors, warnings: kept.flatMap((record) => record.warnings) },
    excludedRows,
  }
}

/** Build a complete import plan without mutating IndexedDB. */
export const prepareImport = async (options: RunImportOptions): Promise<PrepareImportResult> => {
  const fail = (error: string): PrepareImportResult => ({ ok: false, prepared: null, error })
  if (importInFlight) return fail('Masih ada proses impor yang berjalan. Tunggu hingga selesai sebelum memulai impor lain.')
  if (!/\.xlsx$/i.test(options.file.name)) return fail('Format .xls tidak didukung. Simpan ulang workbook sebagai .xlsx lalu coba lagi.')
  if (options.file.size > MAX_FILE_BYTES) return fail(`Ukuran file ${(options.file.size / 1024 / 1024).toFixed(1)} MB melebihi batas ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
  importInFlight = true
  try {
    const progress = options.onProgress ?? (() => {})
    progress('READING')
    const sheets = await (options.readWorkbook ?? readWorkbookBrowser)(options.file)
    progress('PARSING')
    await nextTick()
    const parsedRaw = parseWorkbook(sheets, options.date1904 ?? false)
    const scoped = applyAreaScope(parsedRaw, options.allowedAreaNames)
    const parsed = scoped.parsed
    const [masters, sourceRecords, reviewItems] = await Promise.all([
      options.repository.getAllPersonnel(), options.repository.getSourceRecords(), options.repository.getReviewItems(),
    ])
    const references = buildImportReferenceCatalog(parsed.records, options.areas, options.projects)
    const now = new Date().toISOString()
    const plan = reconcile({ masters, sourceRecords, reviewItems }, parsed, {
      batchId: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileName: options.file.name, sheetName: parsed.sheetName, createdBy: options.createdBy,
      now, areas: references.areas, projects: references.projects,
    })
    const externalKeys = new Set(options.existingBusinessKeys ?? [])
    const collisions = plan.mastersToPut.filter((master) => externalKeys.has(master.businessKey))
    if (collisions.length) {
      return fail(`${collisions.length} Personnel ID sudah ada pada penyimpanan transaksi lokal. Import dihentikan agar tidak membuat identitas ganda; selesaikan migrasi/rekonsiliasi identitas terlebih dahulu.`)
    }
    progress('PREVIEW')
    const reviewRows = new Set(plan.reviewItemsToPut.flatMap((item) => item.rowNumbers))
    const warningRows = new Set(plan.sourceRecordsToPut.filter((record) => record.warnings.length > 0).map((record) => record.rowNumber))
    const warningReviewRows = new Set([...reviewRows, ...warningRows])
    plan.summary.outOfScopeRows = scoped.excludedRows.length
    plan.batch.summary = plan.summary
    const scopePreview: ImportScopePreview = {
      validInScopeRows: Math.max(0, parsed.records.length - warningReviewRows.size),
      warningReviewRows: warningReviewRows.size,
      errorRows: plan.exceptions.length,
      outOfScopeRows: scoped.excludedRows.length,
      excludedRows: scoped.excludedRows,
    }
    return { ok: true, prepared: { plan, repositorySnapshot: repositorySignature(masters, sourceRecords, reviewItems), discoveredAreas: references.discoveredAreas, discoveredProjects: references.discoveredProjects, scopePreview, allowedAreaNames: options.allowedAreaNames == null ? null : [...options.allowedAreaNames].sort() }, error: null }
  } catch (error) {
    return fail(error instanceof ImportAbortError ? error.message : 'Impor gagal karena kesalahan tak terduga. Data lama tetap utuh.')
  } finally {
    importInFlight = false
  }
}

/** Commit only a fresh, explicitly confirmed preview. */
export const commitPreparedImport = async (prepared: PreparedImport, repository: PersonnelRepository): Promise<ImportRunResult> => {
  const [masters, sources, reviews] = await Promise.all([repository.getAllPersonnel(), repository.getSourceRecords(), repository.getReviewItems()])
  if (repositorySignature(masters, sources, reviews) !== prepared.repositorySnapshot) {
    return { ok: false, batch: null, summary: null, status: null, exceptions: [], error: 'Preview sudah kedaluwarsa karena data berubah. Parse ulang file sebelum konfirmasi.' }
  }
  try {
    await repository.commit(prepared.plan)
    return { ok: true, batch: prepared.plan.batch, summary: prepared.plan.summary, status: prepared.plan.status, exceptions: prepared.plan.exceptions, error: null }
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'QuotaExceededError'
      ? 'Kuota penyimpanan browser habis; data impor tidak disimpan.'
      : error instanceof Error ? error.message : 'Commit impor gagal. Data lama tetap utuh.'
    return { ok: false, batch: null, summary: null, status: null, exceptions: [], error: message }
  }
}

/**
 * Run a full import: read → parse → normalize → plan → atomic commit.
 * File reading, parsing, and normalization happen BEFORE the database transaction,
 * so the IndexedDB transaction never waits on async work and cannot go inactive.
 * On any failure nothing is committed and ok=false is returned (no partial success).
 */
export const runImport = async (options: RunImportOptions): Promise<ImportRunResult> => {
  const prepared = await prepareImport(options)
  if (!prepared.ok || !prepared.prepared) return { ok: false, batch: null, summary: null, status: null, exceptions: [], error: prepared.error }
  options.onProgress?.('SAVING')
  const result = await commitPreparedImport(prepared.prepared, options.repository)
  if (result.ok) options.onProgress?.('DONE')
  return result
}
