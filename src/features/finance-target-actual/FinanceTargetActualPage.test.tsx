import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../../App'
import * as demo from '../../context/DemoContext'
import { defaultPermissionConfig } from '../../config/access'
import { demoUsers } from '../../data/demoData'
import { FinanceTargetActualView } from './FinanceTargetActualPage'
import { syntheticBuckets } from './fixtures'

vi.mock('../../components/NotificationBell', () => ({ NotificationBell: () => null }))
vi.mock('../../components/Toaster', () => ({ Toaster: () => null }))
vi.mock('../../pages/DashboardPage', () => ({ DashboardPage: () => <h1>Dashboard existing fallback</h1> }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const kpiValues = (group = 'GELATIK') => [...within(screen.getByRole('region', { name: `Ringkasan ${group}` })).getAllByRole('article')].map((card) => card.querySelector(':scope > strong')!.textContent)
const showCore = () => { choose('Source Group', 'GELATIK'); choose('Area CBS', 'Bandung'); choose('Client', syntheticBuckets.core.client); choose('Project', syntheticBuckets.core.project) }

describe('Finance Target vs Actual prototype UI', () => {
  it('shows separate Group KPIs, synthetic/DATE labels and no combined official KPI', () => {
    render(<FinanceTargetActualView />)
    expect(kpiValues()).toEqual(['12', '12', '0', '100%'])
    expect(kpiValues('BTB')).toEqual(['4', '5', '-1', '125%'])
    expect(screen.getByText('PROTOTYPE · DATA SINTETIS')).toBeInTheDocument()
    expect(screen.getByText(/Resolusi snapshot: DATE/)).toHaveTextContent('Bukan data aktual perusahaan')
    expect(screen.getByText(/Tidak ada grand total resmi gabungan/)).toBeInTheDocument()
    expect(screen.queryByText(/SYN-NUSA/)).not.toBeInTheDocument()
  })

  it('dependent filters reset Client/Project on Area change and all dimensions on Group change', () => {
    render(<FinanceTargetActualView />)
    showCore()
    expect(kpiValues()).toEqual(['10', '9', '+1', '90%'])
    expect(within(screen.getByLabelText('Client')).queryByRole('option', { name: 'Client Simulasi B' })).not.toBeInTheDocument()
    choose('Area CBS', 'Jakarta')
    expect(screen.getByLabelText('Client')).toHaveValue('')
    expect(screen.getByLabelText('Project')).toHaveValue('')
    expect(within(screen.getByLabelText('Project')).queryByRole('option', { name: syntheticBuckets.core.project })).not.toBeInTheDocument()
    choose('Source Group', 'BTB')
    expect(screen.getByLabelText('Area CBS')).toHaveValue('')
    expect(screen.queryByRole('region', { name: 'Ringkasan GELATIK' })).not.toBeInTheDocument()
    expect(kpiValues('BTB')).toEqual(['4', '5', '-1', '125%'])
  })

  it('core fixture presents 10/9/10 and frozen history remains unchanged on navigation', () => {
    render(<FinanceTargetActualView />)
    showCore()
    const oldHistory = screen.getByRole('button', { name: 'Buka snapshot 2026-11-20 GELATIK' }).textContent
    choose('Snapshot Date', '2026-11-15')
    expect(kpiValues()).toEqual(['10', '10', '0', '100%'])
    fireEvent.click(screen.getByRole('button', { name: 'Buka snapshot 2026-11-25 GELATIK' }))
    expect(kpiValues()).toEqual(['10', '10', '0', '100%'])
    expect(screen.getByRole('button', { name: 'Buka snapshot 2026-11-20 GELATIK' }).textContent).toBe(oldHistory)
    fireEvent.click(screen.getByRole('button', { name: 'Buka snapshot 2026-11-20 GELATIK' }))
    expect(kpiValues()).toEqual(['10', '9', '+1', '90%'])
  })

  it('missing evidence gives an empty state rather than zero KPIs or fabricated history', () => {
    render(<FinanceTargetActualView />)
    choose('Snapshot Date', '2026-11-21')
    expect(screen.getByRole('status')).toHaveTextContent('Snapshot belum tersedia')
    expect(screen.queryByRole('region', { name: 'Ringkasan GELATIK' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Detail comparison' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buka snapshot 2026-11-20 GELATIK' })).toBeInTheDocument()
  })

  it('NULL vs zero, provisional approval fallback, and expired Actual are visible', () => {
    render(<FinanceTargetActualView />)
    const detail = within(screen.getByRole('region', { name: 'Detail comparison' }))
    const rowFor = (text: string) => within(detail.getByText(text, { selector: 'strong' }).closest('tr')!)
    expect(rowFor(syntheticBuckets.unknown.project).getByText('Belum diisi (NULL)')).toBeInTheDocument()
    expect(rowFor(syntheticBuckets.zero.project).getByText('-2')).toBeInTheDocument()
    expect(rowFor(syntheticBuckets.expired.project).getByText('EXPIRED_CONTRACT_REMAINING_ACTUAL')).toBeInTheDocument()
    expect(rowFor(syntheticBuckets.expired.project).getAllByText('N/A')).toHaveLength(3)
    expect(detail.getByText(/PROVISIONAL · effective date fallback approval: 2026-11-18/)).toBeInTheDocument()
    const panel = within(screen.getByRole('region', { name: 'Kualitas data comparison' }))
    expect(panel.getByText('Active Unmapped for Comparison').nextElementSibling).toHaveTextContent('3')
    expect(panel.getByText('Needs Review · identitas').nextElementSibling).toHaveTextContent('2')
  })

  it('area scope applies to filter options, KPIs, detail and every historical snapshot', () => {
    render(<FinanceTargetActualView allowedAreas={['Bandung']} />)
    expect(within(screen.getByLabelText('Area CBS')).queryByRole('option', { name: 'Jakarta' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Detail comparison' })).not.toHaveTextContent(syntheticBuckets.btb.project)
    expect(kpiValues('BTB')).toEqual(['N/A', 'N/A', 'N/A', 'N/A'])
    const btbHistory = within(screen.getByRole('region', { name: 'Histori BTB' }))
    expect(btbHistory.getAllByText('Target N/A')).toHaveLength(3)
    expect(btbHistory.queryByText('Actual 5')).not.toBeInTheDocument()
  })

  it('opening/filtering history does not write any HR persistence or launch network requests', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const fetch = vi.spyOn(globalThis, 'fetch')
    render(<FinanceTargetActualView />)
    showCore()
    fireEvent.click(screen.getByRole('button', { name: 'Buka snapshot 2026-11-25 GELATIK' }))
    expect(write).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('new route/menu uses existing permission without changing role definitions', () => {
  const setup = (allowed: boolean, ownArea = false) => {
    const user = demoUsers.find((user) => user.role === 'HR_HO')!
    vi.spyOn(demo, 'useDemo').mockReturnValue({
      currentUser: user, permissionConfig: defaultPermissionConfig.map((entry) => entry.role === user.role ? { ...entry, permissions: allowed ? entry.permissions : entry.permissions.filter((permission) => permission !== 'view_analytics'), scope: ownArea ? 'SELECTED_AREAS' : 'ALL_AREAS', selectedAreaIds: ownArea ? ['area-bandung'] : [] } : entry),
      areas: [{ id: 'area-bandung', name: 'BANDUNG' }, { id: 'area-jakarta', name: 'Jakarta' }],
      dataMode: 'IMPORT_ONLY',
    } as ReturnType<typeof demo.useDemo>)
    render(<MemoryRouter initialEntries={['/reports/finance-target-actual']}><App /></MemoryRouter>)
  }

  it('authorized URL renders the page and navigation entry; configured scope is respected', () => {
    setup(true, true)
    expect(screen.getByRole('heading', { level: 1, name: 'Finance Target vs Actual' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Finance Target vs Actual' })).toHaveAttribute('href', '/reports/finance-target-actual')
    expect(screen.getByRole('region', { name: 'Detail comparison' })).not.toHaveTextContent(syntheticBuckets.btb.project)
  })

  it('missing view_analytics hides the menu and redirects a direct URL', () => {
    setup(false)
    expect(screen.getByRole('heading', { name: 'Dashboard existing fallback' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Finance Target vs Actual' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Finance Target vs Actual' })).not.toBeInTheDocument()
  })
})
