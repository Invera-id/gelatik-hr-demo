import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DemoProvider, demoReducer, type DemoState } from '../context/DemoContext'
import { DashboardPage } from '../pages/DashboardPage'
import { ProjectsPage } from '../pages/ProjectsPage'
import { ProjectDetailPage } from '../pages/ProjectDetailPage'
import { AnalyticsPage } from '../pages/AnalyticsPage'
import { createInitialData } from '../data/demoData'
import { employeeFieldGroups } from '../config/employeeDictionary'
import { getActiveEmployees } from './employeeViews'
import { selectDashboardData } from './dashboardRules'
import { filterProjects, getMonthlySummary, getProjectMetrics, getTerminationRows, monthlyIndex, turnoverRate } from './projectAnalytics'

const data = createInitialData()
const filters = { dateFrom: '2026-08-01', dateTo: '2026-09-30', areaId: '', projectId: '', position: '', status: '' }

describe('V3 dashboard terminology and source', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.setItem('gelatik-demo-user-v1', 'user-operations') })

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
    expect(row.total).toBe(data.employees.filter((employee) => employee.projectId === project.id).length)
  })
})
