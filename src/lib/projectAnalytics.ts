import type { Employee, EmployeeExit, Project, ProjectQuota, ReplacementNeed } from '../types'
import { getActiveEmployees } from './employeeViews'

export interface AnalyticsSource {
  projects: Project[]
  projectQuotas: ProjectQuota[]
  employees: Employee[]
  employeeExits: EmployeeExit[]
  replacementNeeds: ReplacementNeed[]
}

export interface ProjectMetrics {
  project: Project
  period: string
  quota: number | null
  active: number
  newHire: number
  turnover: number
  turnoverRate: number | null
  vacant: number
  fulfilled: number
  overSla: number
  averageGap: number | null
}

export const turnoverRate = (turnover: number, quota: number | null): number | null => quota && quota > 0 ? (turnover / quota) * 100 : null
export const monthlyIndex = (previousRate: number | null, currentRate: number | null): number | null => previousRate && previousRate > 0 && currentRate !== null ? ((currentRate / previousRate) - 1) * 100 : null
export const formatPercent = (value: number | null) => value === null ? 'N/A' : `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value)}%`

export const getProjectMetrics = (source: AnalyticsSource, project: Project, period: string): ProjectMetrics => {
  const employees = source.employees.filter((employee) => employee.projectId === project.id)
  const exits = source.employeeExits.filter((exit) => exit.validationStatus === 'VALIDATED' && exit.exitDate.startsWith(period) && employees.some((employee) => employee.id === exit.employeeId))
  const needs = source.replacementNeeds.filter((need) => need.projectId === project.id && need.exitDate.startsWith(period))
  const completed = needs.filter((need) => need.status === 'FULFILLED' || need.status === 'OVER_TARGET')
  const gaps = completed.flatMap((need) => need.gapWorkingDays === null ? [] : [need.gapWorkingDays])
  const quota = source.projectQuotas.find((item) => item.projectId === project.id && item.period === period)?.quota ?? null
  const turnover = exits.length
  return {
    project, period, quota,
    active: getActiveEmployees(employees, source.employeeExits).filter((employee) => employee.validationStatus === 'VALIDATED').length,
    newHire: employees.filter((employee) => employee.validationStatus === 'VALIDATED' && employee.joinDate?.startsWith(period)).length,
    turnover, turnoverRate: turnoverRate(turnover, quota),
    vacant: needs.filter((need) => need.status === 'OPEN' || need.status === 'MATCHED').length,
    fulfilled: completed.length,
    overSla: needs.filter((need) => need.status === 'OVER_TARGET').length,
    averageGap: gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null,
  }
}

export const filterProjects = (projects: Project[], filters: { areaId?: string; clientName?: string; projectId?: string }, allowedAreas: string[] | null) => projects.filter((project) =>
  (allowedAreas === null || allowedAreas.includes(project.areaId)) &&
  (!filters.areaId || project.areaId === filters.areaId) &&
  (!filters.clientName || project.clientName === filters.clientName) &&
  (!filters.projectId || project.id === filters.projectId))

export interface MonthlySummaryRow {
  clientName: string
  previous: { quota: number; newHire: number; turnover: number; rate: number | null }
  current: { quota: number; newHire: number; turnover: number; rate: number | null }
  index: number | null
}

export const getMonthlySummary = (source: AnalyticsSource, projects: Project[], previousPeriod: string, currentPeriod: string): MonthlySummaryRow[] => {
  const clients = [...new Set(projects.map((project) => project.clientName))].sort()
  return clients.map((clientName) => {
    const clientProjects = projects.filter((project) => project.clientName === clientName)
    const sumPeriod = (period: string) => {
      const metrics = clientProjects.map((project) => getProjectMetrics(source, project, period))
      const quota = metrics.reduce((sum, item) => sum + (item.quota ?? 0), 0)
      const newHire = metrics.reduce((sum, item) => sum + item.newHire, 0)
      const turnover = metrics.reduce((sum, item) => sum + item.turnover, 0)
      return { quota, newHire, turnover, rate: turnoverRate(turnover, quota) }
    }
    const previous = sumPeriod(previousPeriod)
    const current = sumPeriod(currentPeriod)
    return { clientName, previous, current, index: monthlyIndex(previous.rate, current.rate) }
  })
}

export interface TerminationRow {
  project: Project
  yes: Employee[]
  no: Employee[]
  notSet: Employee[]
  total: number
}

export const getTerminationRows = (source: AnalyticsSource, projects: Project[]): TerminationRow[] => projects.map((project) => {
  const employees = source.employees.filter((employee) => employee.projectId === project.id)
  return {
    project,
    yes: employees.filter((employee) => employee.profile?.agreementTermination === 'YA'),
    no: employees.filter((employee) => employee.profile?.agreementTermination === 'TIDAK'),
    notSet: employees.filter((employee) => !employee.profile?.agreementTermination),
    total: employees.length,
  }
})
