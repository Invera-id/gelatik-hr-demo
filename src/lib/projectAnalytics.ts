import type { Employee, EmployeeExit, Project, ProjectQuota, ReplacementNeed } from '../types'

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
  quota: number
  quotaSource: 'MASTER_COUNT' | 'MANUAL'
  active: number
  newHire: number
  turnover: number
  turnoverRate: number | null
  vacant: number
  fulfilled: number
  overSla: number
  averageGap: number | null
}

type SummaryQuotaSource = ProjectMetrics['quotaSource']

export const turnoverRate = (turnover: number, quota: number | null): number | null => quota && quota > 0 ? (turnover / quota) * 100 : null
export const monthlyIndex = (previousRate: number | null, currentRate: number | null): number | null => previousRate && previousRate > 0 && currentRate !== null ? ((currentRate / previousRate) - 1) * 100 : null
export const formatPercent = (value: number | null) => value === null ? 'N/A' : `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value)}%`

export const currentPeriod = (date = new Date()): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${month}`
}

export const formatPeriodLabel = (period: string): string => {
  const [year, month] = period.split('-').map(Number)
  if (!year || !month) return period
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)))
}

const endOfPeriod = (period: string): string => {
  const [year, month] = period.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

const isActiveAt = (employee: Employee, exits: EmployeeExit[], date: string): boolean => {
  if (employee.validationStatus !== 'VALIDATED' || employee.conditionStatus === 'NEEDS_REVIEW') return false
  if (!employee.joinDate || employee.joinDate > date) return false
  return !exits.some((exit) => exit.employeeId === employee.id
    && exit.validationStatus === 'VALIDATED'
    && exit.exitDate >= employee.joinDate!
    && exit.exitDate <= date)
}

export const formatQuota = (metrics: Pick<ProjectMetrics, 'quota'>): string => new Intl.NumberFormat('id-ID').format(metrics.quota)

export const getProjectMetrics = (source: AnalyticsSource, project: Project, period: string): ProjectMetrics => {
  const employees = source.employees.filter((employee) => employee.projectId === project.id)
  const exits = source.employeeExits.filter((exit) => exit.validationStatus === 'VALIDATED' && exit.exitDate.startsWith(period) && employees.some((employee) => employee.id === exit.employeeId))
  const needs = source.replacementNeeds.filter((need) => need.projectId === project.id && need.exitDate.startsWith(period))
  const completed = needs.filter((need) => need.status === 'FULFILLED' || need.status === 'OVER_TARGET')
  const gaps = completed.flatMap((need) => need.gapWorkingDays === null ? [] : [need.gapWorkingDays])
  const periodStart = `${period}-01`
  const periodEnd = endOfPeriod(period)
  const active = employees.filter((employee) => isActiveAt(employee, source.employeeExits, periodEnd)).length
  // The Gelatik template calls this value "Quota", but its pivot is a headcount:
  // count every confirmed master person assigned to the project, excluding only
  // people whose exit happened before the selected month. Join date is not a
  // quota condition in the supplied template.
  const derivedQuota = employees.filter((employee) => employee.validationStatus === 'VALIDATED'
    && employee.conditionStatus !== 'NEEDS_REVIEW'
    && !source.employeeExits.some((exit) => exit.employeeId === employee.id
      && exit.validationStatus === 'VALIDATED'
      && exit.exitDate < periodStart)).length
  const configuredQuota = source.projectQuotas.find((item) => item.projectId === project.id && item.period === period)
  const quota = configuredQuota?.quota ?? derivedQuota
  const turnover = exits.length
  return {
    project, period, quota, quotaSource: configuredQuota ? 'MANUAL' : 'MASTER_COUNT',
    active,
    newHire: employees.filter((employee) => employee.validationStatus === 'VALIDATED' && employee.conditionStatus !== 'NEEDS_REVIEW' && employee.joinDate?.startsWith(period)).length,
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
  previous: { quota: number; quotaSource: SummaryQuotaSource; newHire: number; turnover: number; rate: number | null }
  current: { quota: number; quotaSource: SummaryQuotaSource; newHire: number; turnover: number; rate: number | null }
  index: number | null
}

export const getMonthlySummary = (source: AnalyticsSource, projects: Project[], previousPeriod: string, currentPeriod: string): MonthlySummaryRow[] => {
  const clients = [...new Set(projects.map((project) => project.clientName))].sort()
  return clients.map((clientName) => {
    const clientProjects = projects.filter((project) => project.clientName === clientName)
    const sumPeriod = (period: string) => {
      const metrics = clientProjects.map((project) => getProjectMetrics(source, project, period))
      const quota = metrics.reduce((sum, item) => sum + item.quota, 0)
      const quotaSource: SummaryQuotaSource = metrics.some((item) => item.quotaSource === 'MANUAL') ? 'MANUAL' : 'MASTER_COUNT'
      const newHire = metrics.reduce((sum, item) => sum + item.newHire, 0)
      const turnover = metrics.reduce((sum, item) => sum + item.turnover, 0)
      return { quota, quotaSource, newHire, turnover, rate: turnoverRate(turnover, quota) }
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

export interface TerminationSummaryRow {
  key: string
  areaId: string | null
  subArea: string | null
  clientName: string
  yes: Employee[]
  no: Employee[]
  notSet: Employee[]
  total: number
}

export const getTerminationRows = (source: AnalyticsSource, projects: Project[]): TerminationRow[] => projects.map((project) => {
  const employees = source.employees.filter((employee) => employee.projectId === project.id && employee.validationStatus === 'VALIDATED' && employee.conditionStatus !== 'NEEDS_REVIEW')
  return {
    project,
    yes: employees.filter((employee) => employee.profile?.agreementTermination === 'YA'),
    no: employees.filter((employee) => employee.profile?.agreementTermination === 'TIDAK'),
    notSet: employees.filter((employee) => !employee.profile?.agreementTermination),
    total: employees.length,
  }
})

export const getTerminationSummaryRows = (source: AnalyticsSource, projects: Project[]): TerminationSummaryRow[] => {
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const groups = new Map<string, { areaId: string | null; subArea: string | null; clientName: string; employees: Employee[] }>()
  for (const employee of source.employees) {
    if (employee.validationStatus !== 'VALIDATED' || employee.conditionStatus === 'NEEDS_REVIEW' || !employee.projectId) continue
    const project = projectById.get(employee.projectId)
    if (!project) continue
    const subArea = employee.subArea?.trim() || null
    const key = `${employee.areaId ?? ''}|${subArea ?? ''}|${project.clientName}`
    const group = groups.get(key) ?? { areaId: employee.areaId, subArea, clientName: project.clientName, employees: [] }
    group.employees.push(employee)
    groups.set(key, group)
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    areaId: group.areaId,
    subArea: group.subArea,
    clientName: group.clientName,
    yes: group.employees.filter((employee) => employee.profile?.agreementTermination === 'YA'),
    no: group.employees.filter((employee) => employee.profile?.agreementTermination === 'TIDAK'),
    notSet: group.employees.filter((employee) => !employee.profile?.agreementTermination),
    total: group.employees.length,
  })).sort((a, b) => `${a.areaId}|${a.subArea}|${a.clientName}`.localeCompare(`${b.areaId}|${b.subArea}|${b.clientName}`, 'id-ID'))
}
