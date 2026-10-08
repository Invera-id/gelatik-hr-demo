import 'fake-indexeddb/auto'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { DemoProvider, useDemo, type DemoContextValue } from '../../context/DemoContext'
import { personnelRepository } from '../import/repository'
import * as svc from './service'
import type { EmployeeExit } from '../../types'
import type { StoredPersonnel } from '../import/types'

/** Regression: exit/validation/notifications must work for IndexedDB-backed imported personnel. */

const importedPersonnel = (): StoredPersonnel => ({
  businessKey: 'IMP1',
  employee: {
    id: 'personnel-IMP1', personnelId: 'IMP1', name: 'Imported Pegawai', areaId: null, subArea: null, projectId: null,
    position: 'Sales', employmentStatus: 'ACTIVE', joinDate: '2025-01-01', contractStartDate: '2025-01-01',
    contractEndDate: '2026-12-31', contractStatus: 'SIGNED', bpjsStatus: null, createdBy: 'user-hr',
    validationStatus: 'VALIDATED', validatedBy: 'user-hr', validatedAt: '2025-01-01T00:00:00.000Z',
    submittedAt: '2025-01-01T00:00:00.000Z', revisionNote: null, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  },
  raw: {}, structured: { scores: {}, measures: {}, booleans: {}, tenureMonths: null }, warnings: [],
  sourceRowNumber: 2, fileName: 'f.xlsx', sheetName: 'Database',
  batchId: 'b', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
})

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear(); svc.clearAll()
  await personnelRepository.clearAll()
  await personnelRepository.seedPersonnel([importedPersonnel()])
  sessionStorage.setItem('gelatik-demo-user-v1', 'user-hr')
})
afterEach(() => svc.clearAll())

describe('imported personnel can be exited and validated', () => {
  it('creates the exit, surfaces it, notifies, validates, and flips status to INACTIVE', async () => {
    let latest: DemoContextValue
    const api = () => latest
    function Capture() { latest = useDemo(); return null }
    render(<MemoryRouter><DemoProvider><Capture /></DemoProvider></MemoryRouter>)
    // Imported personnel is hydrated into the shared employees source.
    await waitFor(() => expect(api().employees.some((e) => e.id === 'personnel-IMP1')).toBe(true))

    const exit: EmployeeExit = {
      id: 'exit-imp1', employeeId: 'personnel-IMP1', exitDate: '2026-09-20', exitReason: 'Mengundurkan diri',
      replacementRequired: true, createdBy: 'user-hr', validationStatus: 'SUBMITTED', validatedBy: null, validatedAt: null,
      submittedAt: '2026-09-15T00:00:00.000Z', revisionNote: null, createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z',
    }
    await act(async () => { api().saveExit(exit) })
    // Exit is actually created (previously it silently failed for imported personnel).
    expect(api().employeeExits.some((x) => x.id === 'exit-imp1')).toBe(true)
    // Exit submission notified a validator (super admin, since HR actor is excluded)...
    expect(svc.getAll().some((r) => r.category === 'EXIT' && r.requiresAction)).toBe(true)
    // ...and the submitter (HR) gets a confirmation that it entered validation — not only after it is validated.
    expect(svc.getAll().some((r) => r.recipientUserId === 'user-hr' && r.category === 'EXIT' && !r.requiresAction)).toBe(true)

    await act(async () => { api().setExitValidation('exit-imp1', 'VALIDATED') })
    expect(api().employeeExits.find((x) => x.id === 'exit-imp1')!.validationStatus).toBe('VALIDATED')
    expect(api().replacementNeeds.some((n) => n.employeeExitId === 'exit-imp1')).toBe(true)
    // Write-through flipped the imported employee to INACTIVE in IndexedDB.
    await waitFor(() => expect(api().employees.find((e) => e.id === 'personnel-IMP1')!.employmentStatus).toBe('INACTIVE'))
  })
})
