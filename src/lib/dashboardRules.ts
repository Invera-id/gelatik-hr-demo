import type { Employee, EmployeeExit, EmployeeMovement, ReplacementNeed } from '../types'

export interface DashboardFilters {
  dateFrom: string
  dateTo: string
  areaId: string
  projectId: string
  position: string
  status: string
}

export interface DashboardSelection {
  employees: Employee[]
  activeEmployees: Employee[]
  exits: EmployeeExit[]
  needs: ReplacementNeed[]
  fulfilled: ReplacementNeed[]
  open: ReplacementNeed[]
  overSla: ReplacementNeed[]
  movements: EmployeeMovement[]
  fulfillmentRate: number
  averageGap: number
}

export const selectDashboardData = (employees: Employee[], exits: EmployeeExit[], needs: ReplacementNeed[], movements: EmployeeMovement[], filters: DashboardFilters): DashboardSelection => {
  const inPlacement = (areaId: string | null, projectId: string | null, position: string | null) => (!filters.areaId || areaId === filters.areaId) && (!filters.projectId || projectId === filters.projectId) && (!filters.position || position === filters.position)
  const selectedEmployees = employees.filter((employee) => inPlacement(employee.areaId, employee.projectId, employee.position))
  const employeeIds = new Set(selectedEmployees.map((employee) => employee.id))
  const selectedExits = exits.filter((exit) => exit.validationStatus === 'VALIDATED' && employeeIds.has(exit.employeeId) && exit.exitDate >= filters.dateFrom && exit.exitDate <= filters.dateTo)
  const selectedNeeds = needs.filter((need) => inPlacement(need.areaId, need.projectId, need.position) && need.exitDate >= filters.dateFrom && need.exitDate <= filters.dateTo && (!filters.status || need.status === filters.status))
  const fulfilled = selectedNeeds.filter((need) => ['FULFILLED', 'OVER_TARGET'].includes(need.status))
  const gaps = fulfilled.flatMap((need) => need.gapWorkingDays === null ? [] : [need.gapWorkingDays])
  return {
    employees: selectedEmployees,
    activeEmployees: selectedEmployees.filter((employee) => employee.employmentStatus === 'ACTIVE' && employee.validationStatus === 'VALIDATED'),
    exits: selectedExits,
    needs: selectedNeeds,
    fulfilled,
    open: selectedNeeds.filter((need) => need.status === 'OPEN' || need.status === 'MATCHED'),
    overSla: selectedNeeds.filter((need) => need.status === 'OVER_TARGET'),
    movements: movements.filter((movement) => employeeIds.has(movement.employeeId) && movement.effectiveDate >= filters.dateFrom && movement.effectiveDate <= filters.dateTo),
    fulfillmentRate: selectedNeeds.length ? Math.round((fulfilled.length / selectedNeeds.length) * 100) : 0,
    averageGap: gaps.length ? Number((gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length).toFixed(1)) : 0,
  }
}
