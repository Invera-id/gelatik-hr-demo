import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DemoProvider, demoReducer, type DemoState } from '../context/DemoContext'
import { DashboardPage } from '../pages/DashboardPage'
import { ProjectsPage } from '../pages/ProjectsPage'
import { ProjectDetailPage } from '../pages/ProjectDetailPage'
import { AnalyticsPage } from '../pages/AnalyticsPage'
import { ValidationPage } from '../pages/ValidationPage'
import { createInitialData } from '../data/demoData'
import { employeeFieldGroups } from '../config/employeeDictionary'
import { getActiveEmployees } from './employeeViews'
import { dataStorageKey } from '../config/dataMode'
import { selectDashboardData } from './dashboardRules'
import { filterProjects, getMonthlySummary, getProjectMetrics, getTerminationRows, getTerminationSummaryRows, monthlyIndex, turnoverRate } from './projectAnalytics'

const data = createInitialData()
const filters = { dateFrom: '2026-08-01', dateTo: '2026-09-30', areaId: '', projectId: '', position: '', status: '' }

describe('V3 dashboard terminology and source', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(dataStorageKey, JSON.stringify(data))
    sessionStorage.setItem('gelatik-demo-user-v1', 'user-operations')
  })

  it('renders Turnover and Vacant without the Replacement Needs KPI, plus the 3-day target', () => {
    const html = renderToStaticMarkup(<MemoryRouter><DemoProvider><DashboardPage /></DemoProvider></MemoryRouter>)
    expect(html).toContain('<h3>Turnover</h3>')
    expect(html).toContain('<h3>Vacant</h3>')
    expect(html).not.toContain('<h3>Replacement Needs</h3>')
    expect(html).toContain('Target Fulfillment: ≤ 3 working days')
  })

  it('counts OPEN and MATCHED unfulfilled needs as Vacant', () => {
    const selected = selectDashboardData(data.employees, data.employeeExits, data.replacementNeeds, data.employeeMovements, filters)
    expect(selected.open.length).toBe(selected.needs.filter((need) => need.status === 'OPEN' || need.status === 'MATCHED').length)
  })

  it('renders Project list and Project Detail from the same seeded state', () => {
    const list = renderToStaticMarkup(<MemoryRouter><DemoProvider><ProjectsPage /></DemoProvider></MemoryRouter>)
    expect(list).toContain('Project Beta Bandung')
    const detail = renderToStaticMarkup(<MemoryRouter initialEntries={['/projects/project-beta-bandung']}><DemoProvider><Routes><Route path="/projects/:projectId" element={<ProjectDetailPage />} /></Routes></DemoProvider></MemoryRouter>)
    expect(detail).toContain('Monthly Analytics')
    expect(detail).toContain('PT Bintang Retail')
  })

  it('renders the consolidated Analytics / Reports workspace', () => {
    const html = renderToStaticMarkup(<MemoryRouter><DemoProvider><AnalyticsPage /></DemoProvider></MemoryRouter>)
    expect(html).toContain('Monthly Client Summary')
    expect(html).toContain('Pengakhiran Perjanjian')
  })

  it('gives HR a bulk validation action and employee detail links', () => {
    sessionStorage.setItem('gelatik-demo-user-v1', 'user-hr')
    const html = renderToStaticMarkup(<MemoryRouter><DemoProvider><ValidationPage /></DemoProvider></MemoryRouter>)
    expect(html).toContain('Validasi Semua')
    expect(html).toContain('Lihat Detail')
    expect(html).toContain('/employees/')
  })
})

describe('V3 employee master and project state', () => {
  beforeEach(() => localStorage.clear())

  it('maps unique expanded detail groups and uses fictional runtime values', () => {
    const keys = employeeFieldGroups.flatMap((group) => group.fields.map(([key]) => key))
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('ktpAddress')
    expect(keys).toContain('domicileAddress')
    expect(keys).toContain('agreementTermination')
    expect(data.employees.find((employee) => employee.personnelId === 'EMP-026')?.profile?.email).toMatch(/@example\.test$/)
    expect(data.employees.every((employee) => employee.profile?.companyName?.includes('(Dummy)'))).toBe(true)
  })

  it('derives Active Employee from the same master, excluding effective exits', () => {
    const active = getActiveEmployees(data.employees, data.employeeExits)
    expect(active.every((employee) => data.employees.includes(employee))).toBe(true)
    expect(active.some((employee) => employee.id === 'employee-001')).toBe(false)
    expect(active.some((employee) => employee.id === 'employee-026')).toBe(true)
  })

  it('creates, edits, and deactivates project without deleting referenced data', () => {
    const initial: DemoState = { ...data, currentUserId: 'user-superadmin' }
    const project = { ...data.projects[0], id: 'project-v3-test', name: 'Project Fiksi Test' }
    const created = demoReducer(initial, { type: 'SAVE_PROJECT', project })
    expect(created.projects.find((item) => item.id === project.id)?.name).toBe('Project Fiksi Test')
    const edited = demoReducer(created, { type: 'SAVE_PROJECT', project: { ...project, name: 'Project Fiksi Revisi' } })
    expect(edited.projects.find((item) => item.id === project.id)?.name).toBe('Project Fiksi Revisi')
    const inactive = demoReducer(edited, { type: 'SET_PROJECT_STATUS', projectId: project.id, status: 'INACTIVE' })
    expect(inactive.projects.find((item) => item.id === project.id)?.status).toBe('INACTIVE')
    expect(inactive.employees).toHaveLength(initial.employees.length)
  })

  it('persists independent quota records for different months', () => {
    const initial: DemoState = { ...data, currentUserId: 'user-superadmin' }
    const projectId = data.projects[0].id
    const august = demoReducer(initial, { type: 'SAVE_PROJECT_QUOTA', quota: { id: 'test-aug', projectId, period: '2026-08', quota: 20 } })
    const september = demoReducer(august, { type: 'SAVE_PROJECT_QUOTA', quota: { id: 'test-sep', projectId, period: '2026-09', quota: 25 } })
    expect(september.projectQuotas.find((item) => item.projectId === projectId && item.period === '2026-08')?.quota).toBe(20)
    expect(september.projectQuotas.find((item) => item.projectId === projectId && item.period === '2026-09')?.quota).toBe(25)
  })
})

describe('V3 calculated analytics', () => {
  it('counts New Hire by join month and only validated exits as Turnover', () => {
    const project = data.projects.find((item) => item.id === 'project-alpha-bandung')!
    const metric = getProjectMetrics(data, project, '2026-08')
    expect(metric.newHire).toBe(data.employees.filter((employee) => employee.projectId === project.id && employee.validationStatus === 'VALIDATED' && employee.joinDate?.startsWith('2026-08')).length)
    expect(metric.turnover).toBe(data.employeeExits.filter((exit) => exit.validationStatus === 'VALIDATED' && exit.exitDate.startsWith('2026-08') && data.employees.some((employee) => employee.id === exit.employeeId && employee.projectId === project.id)).length)
  })

  it('computes turnover percentage and handles zero previous rate', () => {
    expect(turnoverRate(2, 100)).toBe(2)
    expect(turnoverRate(2, 0)).toBeNull()
    expect(monthlyIndex(0, 2)).toBeNull()
    expect(monthlyIndex(2, 4)).toBe(100)
  })

  it('derives quota from unique confirmed master personnel at the start of the month', () => {
    const project = data.projects.find((item) => item.id === 'project-alpha-bandung')!
    const metric = getProjectMetrics({ ...data, projectQuotas: [] }, project, '2026-09')
    const expectedQuota = data.employees.filter((employee) => employee.projectId === project.id
      && employee.validationStatus === 'VALIDATED'
      && employee.conditionStatus !== 'NEEDS_REVIEW'
      && !data.employeeExits.some((exit) => exit.employeeId === employee.id
        && exit.validationStatus === 'VALIDATED'
        && exit.exitDate < '2026-09-01')).length

    expect(metric.quotaSource).toBe('MASTER_COUNT')
    expect(metric.quota).toBe(expectedQuota)
    expect(metric.turnoverRate).toBe(turnoverRate(metric.turnover, metric.quota))
  })

  it('keeps template-derived quota independent from legacy manual quota records', () => {
    const project = data.projects[0]
    const source = {
      ...data,
      projectQuotas: [{ id: 'quota-test', projectId: project.id, period: '2026-10', quota: 123 }],
    }
    const metric = getProjectMetrics(source, project, '2026-10')
    const withoutLegacyQuota = getProjectMetrics({ ...source, projectQuotas: [] }, project, '2026-10')

    expect(metric.quotaSource).toBe('MASTER_COUNT')
    expect(metric.quota).toBe(withoutLegacyQuota.quota)
  })

  it('reconciles the template roll-forward: next quota excludes prior-month turnover', () => {
    const project = data.projects[0]
    const employees = data.employees.slice(0, 3).map((employee, index) => ({
      ...employee,
      id: `template-person-${index + 1}`,
      projectId: project.id,
      validationStatus: 'VALIDATED' as const,
      conditionStatus: 'CONFIRMED' as const,
      joinDate: index === 2 ? '2026-09-10' : '2026-08-10',
    }))
    const employeeExits = [
      { ...data.employeeExits[0], id: 'template-exit-aug', employeeId: employees[0].id, exitDate: '2026-08-20', validationStatus: 'VALIDATED' as const },
      { ...data.employeeExits[0], id: 'template-exit-sep', employeeId: employees[1].id, exitDate: '2026-09-20', validationStatus: 'VALIDATED' as const },
    ]
    const source = { ...data, employees, employeeExits, replacementNeeds: [], projectQuotas: [] }
    const august = getProjectMetrics(source, project, '2026-08')
    const september = getProjectMetrics(source, project, '2026-09')

    expect(august.quota).toBe(3)
    expect(august.turnover).toBe(1)
    expect(september.quota).toBe(2)
    expect(september.turnover).toBe(1)
    expect(september.newHire).toBe(1)
    expect(september.turnoverRate).toBe(50)
  })

  it('aggregates monthly client summary from project metrics', () => {
    const rows = getMonthlySummary(data, data.projects, '2026-08', '2026-09')
    const arunika = rows.find((row) => row.clientName === 'PT Arunika Niaga')!
    const projects = data.projects.filter((project) => project.clientName === arunika.clientName)
    expect(arunika.current.quota).toBe(projects.reduce((sum, project) => sum + (getProjectMetrics(data, project, '2026-09').quota ?? 0), 0))
    expect(arunika.current.rate).toBe(turnoverRate(arunika.current.turnover, arunika.current.quota))
  })

  it('counts termination YES/NO/blank and respects project filters', () => {
    const project = data.projects[0]
    const selected = filterProjects(data.projects, { areaId: project.areaId, clientName: project.clientName, projectId: project.id }, null)
    expect(selected).toHaveLength(1)
    const row = getTerminationRows(data, selected)[0]
    expect(row.yes.length + row.no.length + row.notSet.length).toBe(row.total)
    expect(row.total).toBe(data.employees.filter((employee) => employee.projectId === project.id && employee.validationStatus === 'VALIDATED' && employee.conditionStatus !== 'NEEDS_REVIEW').length)
  })

  it('groups termination summary by area, sub area, and client like the Excel pivot', () => {
    const project = data.projects[0]
    const employees = data.employees.slice(0, 3).map((employee, index) => ({
      ...employee,
      id: `termination-person-${index}`,
      areaId: project.areaId,
      projectId: project.id,
      subArea: index === 2 ? 'SUB AREA B' : 'SUB AREA A',
      validationStatus: 'VALIDATED' as const,
      conditionStatus: 'CONFIRMED' as const,
      profile: { ...employee.profile, agreementTermination: index === 0 ? 'YA' as const : index === 1 ? 'TIDAK' as const : null },
    }))
    const rows = getTerminationSummaryRows({ ...data, employees }, [project])

    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.subArea === 'SUB AREA A')).toMatchObject({ total: 2 })
    expect(rows.find((row) => row.subArea === 'SUB AREA A')?.yes).toHaveLength(1)
    expect(rows.find((row) => row.subArea === 'SUB AREA A')?.no).toHaveLength(1)
    expect(rows.find((row) => row.subArea === 'SUB AREA B')?.notSet).toHaveLength(1)
  })
})
