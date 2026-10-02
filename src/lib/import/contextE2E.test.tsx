import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DemoProvider, useDemo } from '../../context/DemoContext'
import { personnelRepository } from './repository'
import { runImport } from './service'
import { projects } from '../../data/demoData'
import { areas } from '../../data/demoData'
import type { SheetTable } from './workbook'

const REAL_FILE = '/Users/dzaky/Downloads/Demo_Personil_3000_Baris-2.xlsx'
type LooseReader = (file: string, opts?: Record<string, unknown>) => Promise<unknown>

const readRealAsDatabase = async (): Promise<SheetTable[] | null> => {
  try {
    const read = (await import('read-excel-file/node')).default as unknown as LooseReader
    const sheets = (await read(REAL_FILE, { getSheets: true })) as Array<{ sheet: string; data: unknown[][] }>
    return sheets.map((s) => ({ name: 'Database', rows: s.data }))
  } catch {
    return null
  }
}

function Probe() {
  const { employees, importedPersonnel, importStorageReady } = useDemo()
  return (
    <div>
      <span data-testid="ready">{String(importStorageReady)}</span>
      <span data-testid="employees">{employees.length}</span>
      <span data-testid="imported">{importedPersonnel.length}</span>
    </div>
  )
}

describe('end-to-end: import → IndexedDB → context → views', () => {
  beforeEach(async () => {
    await personnelRepository.clearAll()
    sessionStorage.setItem('gelatik-demo-user-v1', 'user-hr')
    localStorage.clear()
  })

  it('hydrates imported personnel into the shared employees source and survives a remount (refresh)', async () => {
    const sheets = await readRealAsDatabase()
    if (!sheets) return // real file unavailable (e.g. CI)

    // Commit a real import straight into the same repository the app uses.
    const result = await runImport({
      file: { name: 'Demo.xlsx', size: 1_000_000 } as File,
      repository: personnelRepository,
      areas,
      projects,
      createdBy: 'user-hr',
      readWorkbook: async () => sheets,
    })
    expect(result.ok).toBe(true)
    const importedCount = result.summary?.added ?? 0
    expect(importedCount).toBeGreaterThan(2900)

    // First mount: context hydrates from IndexedDB and merges into employees.
    const first = render(<DemoProvider><Probe /></DemoProvider>)
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'))
    await waitFor(() => expect(Number(screen.getByTestId('imported').textContent)).toBe(importedCount))
    // employees = seed (34) + imported, read from one source.
    expect(Number(screen.getByTestId('employees').textContent)).toBeGreaterThan(importedCount)
    first.unmount()

    // Remount simulates a page refresh: data persists, no re-import needed.
    render(<DemoProvider><Probe /></DemoProvider>)
    await waitFor(() => expect(Number(screen.getByTestId('imported').textContent)).toBe(importedCount))
  })
})
