import 'fake-indexeddb/auto'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { DemoProvider, useDemo, type DemoContextValue } from '../../context/DemoContext'
import * as svc from './service'
import type { Employee } from '../../types'

/**
 * End-to-end priority flow through the real DemoContext:
 * Area Supporting submits → HR HO is notified → HR HO validates → submitter is notified.
 */

let container: HTMLDivElement
let root: Root

const mountAs = (userId: string): DemoContextValue => {
  sessionStorage.setItem('gelatik-demo-user-v1', userId)
  let api!: DemoContextValue
  function Capture() { api = useDemo(); return null }
  act(() => {
    root = createRoot(container)
    root.render(<MemoryRouter><DemoProvider><Capture /></DemoProvider></MemoryRouter>)
  })
  return api
}

const unmount = () => act(() => root.unmount())

const submittedEntry = (over: Partial<Employee> = {}): Employee => ({
  id: `employee-flow-${over.personnelId ?? 'A'}`, personnelId: 'FLOW-1', name: 'Pegawai Flow', areaId: 'area-bandung',
  subArea: null, projectId: 'project-alpha-bandung', position: 'Sales', employmentStatus: 'ACTIVE', joinDate: '2026-09-01',
  contractStartDate: '2026-09-01', contractEndDate: '2026-12-31', contractStatus: 'SIGNED', bpjsStatus: null,
  createdBy: 'user-bandung', validationStatus: 'SUBMITTED', validationTransaction: 'EMPLOYEE_ENTRY', validatedBy: null,
  validatedAt: null, submittedAt: '2026-09-10T00:00:00.000Z', revisionNote: null, createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z', ...over,
})

const hrRequests = () => svc.getAll().filter((r) => r.recipientUserId === 'user-hr' && r.category === 'VALIDATION_REQUEST')
const authorResults = () => svc.getAll().filter((r) => r.recipientUserId === 'user-bandung' && r.category === 'VALIDATION_RESULT')

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  svc.clearAll()
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  try { unmount() } catch { /* already unmounted */ }
  container.remove()
})

describe('priority flow: entry → HR HO → result', () => {
  it('Simpan Draft does NOT notify HR HO', () => {
    const api = mountAs('user-bandung')
    act(() => api.saveEmployee(submittedEntry({ validationStatus: 'DRAFT', submittedAt: null })))
    expect(hrRequests()).toHaveLength(0)
  })

  it('Submit notifies authorized HR HO; a live subscriber is pinged', () => {
    const api = mountAs('user-bandung')
    let pinged = 0
    const off = svc.subscribe(() => { pinged += 1 })
    act(() => api.saveEmployee(submittedEntry()))
    off()
    const requests = hrRequests()
    expect(requests).toHaveLength(1)
    expect(requests[0].target).toEqual({ kind: 'validation', id: 'employee-flow-A' })
    expect(requests[0].requiresAction).toBe(true)
    expect(pinged).toBeGreaterThan(0) // other-tab / live update mechanism fired
  })

  it('duplicate submit of the same cycle does not duplicate notifications', () => {
    const api = mountAs('user-bandung')
    act(() => api.saveEmployee(submittedEntry()))
    act(() => api.saveEmployee(submittedEntry())) // same submittedAt cycle, replay
    expect(hrRequests()).toHaveLength(1)
  })

  it('HR HO validates → submitter notified, request resolved; re-login shows persisted inbox', () => {
    const area = mountAs('user-bandung')
    act(() => area.saveEmployee(submittedEntry()))
    unmount()

    // HR HO logs in later on the same browser and sees the pending request persisted.
    const hr = mountAs('user-hr')
    expect(hrRequests()).toHaveLength(1)
    act(() => hr.setEmployeeValidation('employee-flow-A', 'VALIDATED'))

    expect(authorResults()).toHaveLength(1)
    expect(authorResults()[0].title).toMatch(/disetujui/i)
    // The HR action item for this cycle is now resolved (but kept as history).
    expect(hrRequests()[0].resolvedAt).toBeTruthy()
  })

  it('revision then resubmit creates a new request event', () => {
    const area = mountAs('user-bandung')
    act(() => area.saveEmployee(submittedEntry()))
    unmount()
    const hr = mountAs('user-hr')
    act(() => hr.setEmployeeValidation('employee-flow-A', 'REVISION_REQUIRED', 'Lengkapi data'))
    unmount()
    // Author resubmits — new cycle (new submittedAt) → new request.
    const area2 = mountAs('user-bandung')
    act(() => area2.saveEmployee(submittedEntry({ submittedAt: '2026-09-11T00:00:00.000Z' })))
    expect(hrRequests()).toHaveLength(2)
  })
})
