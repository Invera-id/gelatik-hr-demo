import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DemoProvider, useDemo } from '../../context/DemoContext'
import { personnelRepository } from './repository'
import { runImport } from './service'
import { areas, projects } from '../../data/demoData'
import { clearAll as clearNotifications } from '../notifications/service'
import { buildSheet } from './testFixtures'
import type { SheetTable } from './workbook'
import type { ReviewDecision } from './types'

// Two distinct rows for one person: Bandung with an exit vs Semarang — ambiguous.
const driverSheets = (): SheetTable[] => [buildSheet('Database', [
  { personnelId: 'ID-REVIEW', name: 'PERSONIL REVIEW', areaCbs: 'Semarang', mutationDate: '2026-09-07' },
  { personnelId: 'ID-REVIEW', name: 'PERSONIL REVIEW', areaCbs: 'Bandung', mutationDate: '2026-09-07', exitDate: '2026-09-07', exitReason: 'PINDAH KOTA' },
])]

function Probe({ decision }: { decision: ReviewDecision }) {
  const demo = useDemo()
  const person = demo.employees.find((e) => e.personnelId === 'ID-REVIEW')
  const pending = demo.importReviewItems.filter((r) => r.status === 'PENDING')
  const timeline = person ? demo.employeeMovements.filter((m) => m.employeeId === person.id) : []
  return (
    <div>
      <span data-testid="ready">{String(demo.importStorageReady)}</span>
      <span data-testid="pending">{pending.length}</span>
      <span data-testid="condition">{person?.conditionStatus ?? 'none'}</span>
      <span data-testid="status">{person?.employmentStatus ?? 'none'}</span>
      <span data-testid="timeline">{timeline.length}</span>
      <button onClick={() => { if (pending[0]) { const ids = pending[0].recordIds.filter((id) => !id.startsWith('master:')); void demo.resolveReviewItem(pending[0].id, { ...decision, beforeRecordId: decision.beforeRecordId ?? ids[0], afterRecordId: decision.afterRecordId ?? ids[1] }) } }}>resolve</button>
    </div>
  )
}

describe('import → review → confirm → timeline (via DemoContext)', () => {
  beforeEach(async () => {
    await personnelRepository.clearAll()
    clearNotifications()
    localStorage.clear()
    sessionStorage.setItem('gelatik-demo-user-v1', 'user-hr')
  })

  it('keeps an ambiguous person out of active state until a reviewer confirms, then records a timeline event', async () => {
    const result = await runImport({
      file: { name: 'review.xlsx', size: 1000 } as File,
      repository: personnelRepository, areas, projects, createdBy: 'user-hr',
      readWorkbook: async () => driverSheets(),
    })
    expect(result.ok).toBe(true)

    const decision: ReviewDecision = { decisionKind: 'EXIT', exitScope: 'EMPLOYMENT_END', effectiveDate: '2026-09-07', note: 'dikonfirmasi exit' }
    render(<DemoProvider><Probe decision={decision} /></DemoProvider>)
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'))
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('1'))
    // Ambiguous import: condition needs review, no confirmed timeline event yet.
    expect(screen.getByTestId('condition').textContent).toBe('NEEDS_REVIEW')
    expect(screen.getByTestId('timeline').textContent).toBe('0')

    // Reviewer confirms a company exit.
    screen.getByText('resolve').click()

    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('0'))
    await waitFor(() => expect(screen.getByTestId('timeline').textContent).toBe('1'))
    expect(screen.getByTestId('condition').textContent).toBe('CONFIRMED')
    expect(screen.getByTestId('status').textContent).toBe('INACTIVE')
  })

  it('a reviewed decision survives a remount (refresh) without duplicating the event', async () => {
    await runImport({
      file: { name: 'review.xlsx', size: 1000 } as File,
      repository: personnelRepository, areas, projects, createdBy: 'user-hr',
      readWorkbook: async () => driverSheets(),
    })
    const decision: ReviewDecision = { decisionKind: 'PLACEMENT_CHANGE', movementType: 'MUTATION', effectiveDate: '2026-09-07', note: 'mutasi' }
    const first = render(<DemoProvider><Probe decision={decision} /></DemoProvider>)
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('1'))
    screen.getByText('resolve').click()
    await waitFor(() => expect(screen.getByTestId('timeline').textContent).toBe('1'))
    first.unmount()

    render(<DemoProvider><Probe decision={decision} /></DemoProvider>)
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'))
    await waitFor(() => expect(screen.getByTestId('pending').textContent).toBe('0'))
    // Deterministic event id → exactly one event after refresh (no duplicate).
    expect(screen.getByTestId('timeline').textContent).toBe('1')
  })
})
