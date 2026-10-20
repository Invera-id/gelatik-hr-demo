import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { DemoProvider, useDemo } from '../../context/DemoContext'
import { personnelRepository } from './repository'
import { runImport } from './service'
import { buildSheet, testAreas, testProjects } from './testFixtures'

function Probe() {
  const demo = useDemo()
  return <div>
    <span data-testid="mode">{demo.dataMode}</span>
    <span data-testid="employees">{demo.employees.length}</span>
    <span data-testid="ready">{String(demo.importStorageReady)}</span>
    <button onClick={demo.resetDemo}>reset</button>
  </div>
}

describe('default import-only mode', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    await personnelRepository.clearAll()
  })

  it('ignores the legacy sample namespace and starts without workforce seed', async () => {
    localStorage.setItem('gelatik-demo-data-v2', JSON.stringify({ employees: [{ id: 'legacy-seed', personnelId: 'EMP-SEED' }] }))
    render(<DemoProvider><Probe /></DemoProvider>)
    expect(screen.getByTestId('mode').textContent).toBe('IMPORT_ONLY')
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'))
    expect(screen.getByTestId('employees').textContent).toBe('0')
  })

  it('reset preserves imported IndexedDB personnel', async () => {
    await runImport({
      file: { name: 'synthetic.xlsx', size: 1000 } as File,
      repository: personnelRepository, areas: testAreas, projects: testProjects, createdBy: 'user-hr',
      readWorkbook: async () => [buildSheet('Database', [{ personnelId: 'KEEP-1', name: 'PERSONIL SINTETIS' }])],
    })
    render(<DemoProvider><Probe /></DemoProvider>)
    await waitFor(() => expect(screen.getByTestId('employees').textContent).toBe('1'))
    await act(async () => { screen.getByText('reset').click() })
    expect(await personnelRepository.getAllPersonnel()).toHaveLength(1)
    expect(screen.getByTestId('employees').textContent).toBe('1')
  })
})
