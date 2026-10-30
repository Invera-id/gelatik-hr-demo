import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ExportPage } from './ExportPage'
import * as context from '../context/DemoContext'
import * as excel from '../lib/excelExport'
import { createInitialData, demoUsers } from '../data/demoData'

const data = createInitialData()
const setup = (error: string | null = null) => {
  vi.spyOn(context, 'useDemo').mockReturnValue({
    ...data, currentUser: demoUsers.find((user) => user.role === 'HR_HO')!,
    actualManpowerRecords: data.employees, importStorageReady: true, importStorageError: error,
  } as ReturnType<typeof context.useDemo>)
  render(<ExportPage />)
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Reports / Export integration', () => {
  it('keeps all existing export cards and routes their download to the existing table writer', async () => {
    const write = vi.spyOn(excel, 'exportBusinessTable').mockResolvedValue('XLSX')
    setup()
    for (const title of ['Employee Master', 'Employee Movement History', 'Turnover Data', 'Replacement / Fulfillment Data', 'Dashboard Filtered Data']) {
      const card = screen.getByRole('heading', { name: title }).closest('article')!
      fireEvent.click(within(card).getByRole('button', { name: 'Export .xlsx' }))
      await waitFor(() => expect(within(card).getByRole('button')).not.toBeDisabled())
    }
    expect(write).toHaveBeenCalledTimes(5)
  })

  it('downloads the new four-sheet aggregate workbook through the actual UI handler', async () => {
    const write = vi.spyOn(excel, 'exportBusinessWorkbook').mockResolvedValue()
    setup()
    const card = screen.getByRole('heading', { name: 'Actual Manpower Summary' }).closest('article')!
    fireEvent.click(within(card).getByRole('button', { name: 'Export .xlsx' }))
    await waitFor(() => expect(write).toHaveBeenCalledOnce())
    expect(write.mock.calls[0][0]).toHaveLength(4)
    expect(write.mock.calls[0][1]).toMatch(/^actual-manpower-summary-\d{4}-\d{2}-\d{2}\.xlsx$/)
  })

  it('prevents incomplete export on storage failure and reports a writer failure without CSV fallback', async () => {
    const write = vi.spyOn(excel, 'exportBusinessWorkbook').mockRejectedValue(new Error('synthetic failure'))
    setup('synthetic storage failure')
    let card = screen.getByRole('heading', { name: 'Actual Manpower Summary' }).closest('article')!
    expect(within(card).getByRole('button')).toBeDisabled()
    cleanup()
    setup()
    card = screen.getByRole('heading', { name: 'Actual Manpower Summary' }).closest('article')!
    fireEvent.click(within(card).getByRole('button'))
    await screen.findByText('Export gagal')
    expect(write).toHaveBeenCalledOnce()
    expect(within(card).getByRole('button')).not.toBeDisabled()
  })
})
