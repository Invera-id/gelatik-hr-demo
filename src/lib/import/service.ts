import type { Area, Project } from '../../types'
import { parseWorkbook } from './parse'
import { planImport } from './plan'
import type { PersonnelRepository } from './repository'
import type { SheetTable } from './workbook'
import { ImportAbortError, type ImportBatch, type ImportException, type ImportSummary, type ImportBatchStatus } from './types'

export type ImportPhase = 'READING' | 'PARSING' | 'SAVING' | 'DONE'

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
}

/** 20 MB ceiling keeps a single spreadsheet from exhausting browser memory. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

let importInFlight = false

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

/**
 * Run a full import: read → parse → normalize → plan → atomic commit.
 * File reading, parsing, and normalization happen BEFORE the database transaction,
 * so the IndexedDB transaction never waits on async work and cannot go inactive.
 * On any failure nothing is committed and ok=false is returned (no partial success).
 */
export const runImport = async (options: RunImportOptions): Promise<ImportRunResult> => {
  const fail = (error: string): ImportRunResult => ({ ok: false, batch: null, summary: null, status: null, exceptions: [], error })

  if (importInFlight) return fail('Masih ada proses impor yang berjalan. Tunggu hingga selesai sebelum memulai impor lain.')
  const { file, repository, areas, projects, createdBy } = options
  if (file.size > MAX_FILE_BYTES) {
    return fail(`Ukuran file ${(file.size / 1024 / 1024).toFixed(1)} MB melebihi batas ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
  }
  const reader = options.readWorkbook ?? readWorkbookBrowser
  const progress = options.onProgress ?? (() => {})

  importInFlight = true
  try {
    progress('READING')
    const sheets = await reader(file)

    progress('PARSING')
    await nextTick()
    const parsed = parseWorkbook(sheets, options.date1904 ?? false)

    progress('SAVING')
    const existing = await repository.getAllPersonnel()
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()
    const plan = planImport(existing, parsed, {
      batchId,
      fileName: file.name,
      sheetName: parsed.sheetName,
      createdBy,
      now,
      areas,
      projects,
    })
    await repository.commit(plan)

    progress('DONE')
    return { ok: true, batch: plan.batch, summary: plan.summary, status: plan.status, exceptions: plan.exceptions, error: null }
  } catch (error) {
    const message = error instanceof ImportAbortError
      ? error.message
      : error instanceof DOMException && error.name === 'QuotaExceededError'
        ? 'Kuota penyimpanan browser habis; data impor tidak disimpan. Kosongkan ruang lalu coba lagi.'
        : error instanceof Error && error.name === 'QuotaExceededError'
          ? 'Kuota penyimpanan browser habis; data impor tidak disimpan. Kosongkan ruang lalu coba lagi.'
          : 'Impor gagal karena kesalahan tak terduga. Data lama tetap utuh.'
    return fail(message)
  } finally {
    importInFlight = false
  }
}
