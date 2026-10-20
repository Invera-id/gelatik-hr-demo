import 'fake-indexeddb/auto'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { useEffect } from 'react'
import App from '../App'
import { defaultPermissionConfig, hasPermission, migratePermissionConfig } from '../config/access'
import { dataStorageKey } from '../config/dataMode'
import { DemoProvider, demoReducer, useDemo, type DemoContextValue, type DemoState } from '../context/DemoContext'
import { NotificationProvider } from '../context/NotificationContext'
import { createInitialData, demoUsers } from '../data/demoData'
import { personnelRepository } from './import/repository'
import { buildSheet, InMemoryPersonnelRepository, testAreas, testProjects } from './import/testFixtures'
import { commitPreparedImport, prepareImport } from './import/service'
import type { Employee, Permission, Role, RolePermissionConfig } from '../types'

const data = createInitialData()
const fakeFile = (name = 'synthetic.xlsx') => ({ name, size: 1000 }) as File

const permissionsFor = (role: Role, permissions: Permission[], config = defaultPermissionConfig): RolePermissionConfig[] =>
  config.map((item) => item.role === role ? { ...item, permissions } : { ...item, permissions: [...item.permissions], selectedAreaIds: [...item.selectedAreaIds] })

const storeSession = (userId: string, permissionConfig = defaultPermissionConfig) => {
  localStorage.setItem(dataStorageKey, JSON.stringify({ ...data, permissionConfig }))
  sessionStorage.setItem('gelatik-demo-user-v1', userId)
}

const syntheticSubmittedEmployee = (): Employee => ({
  ...data.employees.find((employee) => employee.areaId === 'area-bandung')!,
  id: 'employee-validation-synthetic',
  personnelId: 'SYN-VALIDATION-1',
  name: 'Personel Validasi Sintetis',
  validationStatus: 'SUBMITTED',
  validationTransaction: 'EMPLOYEE_ENTRY',
})

const renderApp = (path = '/dashboard') => render(
  <MemoryRouter initialEntries={[path]}>
    <DemoProvider><NotificationProvider><App /></NotificationProvider></DemoProvider>
  </MemoryRouter>,
)

let context: DemoContextValue | null = null
function ContextProbe({ onReady }: { onReady: (value: DemoContextValue) => void }) {
  const demo = useDemo()
  useEffect(() => onReady(demo), [demo, onReady])
  return <span data-testid="employee-count">{demo.employees.length}</span>
}

const captureContext = (value: DemoContextValue) => { context = value }
const renderContext = () => render(<DemoProvider><ContextProbe onReady={captureContext} /></DemoProvider>)

describe('RBAC route, sidebar, and migration consistency', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    context = null
    await personnelRepository.clearAll()
  })

  it('shows Import Excel in the Area Supporting sidebar when import permission is active', async () => {
    storeSession('user-bandung')
    renderApp()
    expect(await screen.findByRole('link', { name: 'Import Excel' })).not.toBeNull()
  })

  it('hides Import Excel and redirects the direct route when import permission is inactive', async () => {
    const areaPermissions = defaultPermissionConfig.find((item) => item.role === 'AREA_SUPPORT')!.permissions.filter((permission) => permission !== 'import_personnel' && permission !== 'view_import_review')
    storeSession('user-bandung', permissionsFor('AREA_SUPPORT', areaPermissions))
    renderApp('/import')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Import Excel' })).toBeNull())
    expect(await screen.findByText(/Selamat datang/)).not.toBeNull()
    expect(screen.queryByText('Import Excel Personil')).toBeNull()
  })

  it('keeps import permission independent from manual employee creation', () => {
    const config = permissionsFor('AREA_SUPPORT', ['view_dashboard', 'import_personnel'])
    const user = demoUsers.find((item) => item.id === 'user-bandung')!
    expect(hasPermission(user, config, 'import_personnel')).toBe(true)
    expect(hasPermission(user, config, 'create_employee')).toBe(false)
  })

  it('migrates broad legacy permissions and drops unavailable manage_users safely', () => {
    const migrated = migratePermissionConfig([{ role: 'AREA_SUPPORT', scope: 'OWN_AREA', selectedAreaIds: [], permissions: ['view_dashboard', 'view_employee', 'edit_employee', 'create_exit', 'manage_users'] }])
    const area = migrated.find((item) => item.role === 'AREA_SUPPORT')!
    expect(area.permissions).toEqual(expect.arrayContaining(['edit_employee_basic', 'request_placement_change', 'request_employee_exit']))
    expect(area.permissions).not.toContain('manage_users')
  })

  it('preserves an explicitly disabled permission in current browser configuration', () => {
    const current = permissionsFor('AREA_SUPPORT', ['view_dashboard', 'view_employee'])
    expect(migratePermissionConfig(current).find((item) => item.role === 'AREA_SUPPORT')?.permissions).toEqual(['view_dashboard', 'view_employee'])
  })

  it('restores the complete default matrix through Reset Permission Configuration', () => {
    const changed: DemoState = { ...data, currentUserId: 'user-superadmin', permissionConfig: permissionsFor('AREA_SUPPORT', ['view_dashboard']) }
    const reset = demoReducer(changed, { type: 'RESET_PERMISSIONS' })
    expect(reset.permissionConfig).toEqual(defaultPermissionConfig)
  })

  it('redirects an own-area user away from another Area employee detail route', async () => {
    const other = data.employees.find((employee) => employee.areaId === 'area-semarang')!
    storeSession('user-bandung')
    renderApp(`/employees/${other.id}`)
    expect(await screen.findByRole('heading', { name: 'Master Employee' })).not.toBeNull()
    expect(screen.queryByRole('heading', { name: other.name })).toBeNull()
  })
})

describe('Area-scoped import planning and commit', () => {
  const rows = [
    { personnelId: 'SYN-BDG-1', name: 'Personel Bandung Sintetis', areaCbs: 'Bandung', projectName: 'Project Sintetis Bandung', position: 'Sales', joinDate: '2026-10-01' },
    { personnelId: 'SYN-OUT-1', name: 'Personel Luar Sintetis', areaCbs: 'Area Sintetis Luar', projectName: 'Project Sintetis Luar', position: 'Sales', joinDate: '2026-10-01' },
  ]

  it('previews and confirms only own-area records for Area Supporting', async () => {
    const repository = new InMemoryPersonnelRepository()
    const preview = await prepareImport({ file: fakeFile(), repository, areas: testAreas, projects: testProjects, createdBy: 'user-bandung', allowedAreaNames: ['Bandung'], readWorkbook: async () => [buildSheet('Database', rows)] })
    expect(preview.prepared?.scopePreview).toMatchObject({ validInScopeRows: 1, outOfScopeRows: 1 })
    expect(preview.prepared?.scopePreview.excludedRows[0].message).toBe('Di luar cakupan area — tidak diimpor.')
    const result = await commitPreparedImport(preview.prepared!, repository)
    expect(result.ok).toBe(true)
    expect((await repository.getAllPersonnel()).map((item) => item.businessKey)).toEqual(['SYN-BDG-1'])
  })

  it('does not create Area or Project references from out-of-scope rows', async () => {
    const repository = new InMemoryPersonnelRepository()
    const preview = await prepareImport({ file: fakeFile(), repository, areas: testAreas, projects: testProjects, createdBy: 'user-bandung', allowedAreaNames: ['Bandung'], readWorkbook: async () => [buildSheet('Database', rows)] })
    expect(preview.prepared?.discoveredAreas.some((area) => area.name === 'Area Sintetis Luar')).toBe(false)
    expect(preview.prepared?.discoveredProjects.some((project) => project.name === 'Project Sintetis Luar')).toBe(false)
  })

  it('keeps national import available for all areas', async () => {
    const repository = new InMemoryPersonnelRepository()
    const preview = await prepareImport({ file: fakeFile(), repository, areas: testAreas, projects: testProjects, createdBy: 'user-hr', allowedAreaNames: null, readWorkbook: async () => [buildSheet('Database', rows)] })
    expect(preview.prepared?.scopePreview.outOfScopeRows).toBe(0)
    expect(preview.prepared?.plan.mastersToPut).toHaveLength(2)
    expect(preview.prepared?.discoveredAreas.some((area) => area.name === 'Area Sintetis Luar')).toBe(true)
  })

  it('treats a missing Area as an error instead of assigning the user Area', async () => {
    const repository = new InMemoryPersonnelRepository()
    const preview = await prepareImport({ file: fakeFile(), repository, areas: testAreas, projects: testProjects, createdBy: 'user-bandung', allowedAreaNames: ['Bandung'], readWorkbook: async () => [buildSheet('Database', [{ ...rows[0], personnelId: 'SYN-NO-AREA', areaCbs: '' }])] })
    expect(preview.prepared?.scopePreview.errorRows).toBe(1)
    expect(preview.prepared?.plan.mastersToPut).toHaveLength(0)
    expect(preview.prepared?.plan.exceptions[0].reason).toMatch(/Area tidak dapat dipetakan/)
  })
})

describe('permission and scope checks in the context action layer', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    context = null
    await personnelRepository.clearAll()
  })

  it('blocks project create when manage_project is disabled and permits it when enabled', async () => {
    const hrDefaults = defaultPermissionConfig.find((item) => item.role === 'HR_HO')!.permissions
    storeSession('user-hr', permissionsFor('HR_HO', hrDefaults.filter((permission) => permission !== 'manage_project')))
    const first = renderContext()
    const project = { ...data.projects[0], id: 'project-synthetic-rbac', name: 'Project Sintetis RBAC' }
    act(() => context!.saveProject(project))
    expect(context!.projects.some((item) => item.id === project.id)).toBe(false)
    first.unmount()

    storeSession('user-hr')
    renderContext()
    act(() => context!.saveProject(project))
    await waitFor(() => expect(context!.projects.some((item) => item.id === project.id)).toBe(true))
  })

  it('requires the dedicated project quota permission', async () => {
    const project = data.projects[0]
    const hrDefaults = defaultPermissionConfig.find((item) => item.role === 'HR_HO')!.permissions
    storeSession('user-hr', permissionsFor('HR_HO', hrDefaults.filter((permission) => permission !== 'manage_project_quota')))
    const first = renderContext()
    act(() => context!.saveProjectQuota({ id: 'quota-synthetic', projectId: project.id, period: '2026-10', quota: 77 }))
    expect(context!.projectQuotas.some((item) => item.id === 'quota-synthetic')).toBe(false)
    first.unmount()

    storeSession('user-hr')
    renderContext()
    act(() => context!.saveProjectQuota({ id: 'quota-synthetic', projectId: project.id, period: '2026-10', quota: 77 }))
    await waitFor(() => expect(context!.projectQuotas.find((item) => item.id === 'quota-synthetic')?.quota).toBe(77))
  })

  it('requires the dedicated project status permission', () => {
    const project = data.projects[0]
    const hrPermissions = defaultPermissionConfig.find((item) => item.role === 'HR_HO')!.permissions.filter((permission) => permission !== 'toggle_project_status')
    storeSession('user-hr', permissionsFor('HR_HO', hrPermissions))
    renderContext()
    act(() => context!.setProjectStatus(project.id, 'INACTIVE'))
    expect(context!.projects.find((item) => item.id === project.id)?.status).toBe(project.status)
  })

  it('requires both validation permission and the configured Validation Policy', () => {
    const target = syntheticSubmittedEmployee()
    const withValidation = permissionsFor('AREA_SUPPORT', [...defaultPermissionConfig.find((item) => item.role === 'AREA_SUPPORT')!.permissions, 'validate_employee_entry_edit'])
    localStorage.setItem(dataStorageKey, JSON.stringify({ ...data, employees: [...data.employees, target], permissionConfig: withValidation }))
    sessionStorage.setItem('gelatik-demo-user-v1', 'user-bandung')
    const first = renderContext()
    act(() => context!.setEmployeeValidation(target.id, 'VALIDATED'))
    expect(context!.employees.find((employee) => employee.id === target.id)?.validationStatus).toBe('SUBMITTED')
    first.unmount()

    localStorage.setItem(dataStorageKey, JSON.stringify({ ...data, employees: [...data.employees, target], permissionConfig: withValidation, validationPolicy: { ...data.validationPolicy, EMPLOYEE_ENTRY: 'AREA_ADMIN' } }))
    sessionStorage.setItem('gelatik-demo-user-v1', 'user-bandung')
    renderContext()
    act(() => context!.setEmployeeValidation(target.id, 'VALIDATED'))
    expect(context!.employees.find((employee) => employee.id === target.id)?.validationStatus).toBe('VALIDATED')
  })

  it('requires bulk_validate in addition to entry validation permission', async () => {
    const target = syntheticSubmittedEmployee()
    const hrPermissions = defaultPermissionConfig.find((item) => item.role === 'HR_HO')!.permissions.filter((permission) => permission !== 'bulk_validate')
    localStorage.setItem(dataStorageKey, JSON.stringify({ ...data, employees: [...data.employees, target], permissionConfig: permissionsFor('HR_HO', hrPermissions) }))
    sessionStorage.setItem('gelatik-demo-user-v1', 'user-hr')
    renderContext()
    let count = -1
    await act(async () => { count = await context!.validateEmployees([target.id]) })
    expect(count).toBe(0)
    expect(context!.employees.find((employee) => employee.id === target.id)?.validationStatus).toBe('SUBMITTED')
  })

  it('keeps replacement matching and fulfillment as separate actions', () => {
    const need = data.replacementNeeds.find((item) => item.id === 'need-001')!
    const candidate = data.employees.find((employee) => employee.id === 'employee-002')!
    const hrPermissions = defaultPermissionConfig.find((item) => item.role === 'HR_HO')!.permissions.filter((permission) => permission !== 'fulfill_replacement')
    storeSession('user-hr', permissionsFor('HR_HO', hrPermissions))
    renderContext()
    act(() => context!.matchCandidate(need.id, candidate.id))
    expect(context!.replacementNeeds.find((item) => item.id === need.id)?.status).toBe('MATCHED')
    act(() => context!.fulfillNeed(need.id))
    expect(context!.replacementNeeds.find((item) => item.id === need.id)?.status).toBe('MATCHED')
  })

  it('blocks an own-area user from modifying another Area through the action layer', () => {
    storeSession('user-bandung')
    renderContext()
    const other = data.employees.find((employee) => employee.areaId === 'area-semarang')!
    const changed: Employee = { ...other, name: 'Nama Sintetis Diubah' }
    act(() => context!.saveEmployee(changed))
    expect(context!.employees.find((employee) => employee.id === other.id)?.name).toBe(other.name)
  })
})
