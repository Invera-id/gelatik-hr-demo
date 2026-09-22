import type { Employee, EmployeeExit } from '../types'

export const isEffectivelyActive = (employee: Employee, exits: EmployeeExit[]) => employee.employmentStatus === 'ACTIVE' && !exits.some((exit) => exit.employeeId === employee.id && exit.validationStatus === 'VALIDATED' && (!employee.joinDate || exit.exitDate >= employee.joinDate))
export const getActiveEmployees = (employees: Employee[], exits: EmployeeExit[]) => employees.filter((employee) => isEffectivelyActive(employee, exits))
export const latestValidatedExit = (employeeId: string, exits: EmployeeExit[]) => exits.filter((exit) => exit.employeeId === employeeId && exit.validationStatus === 'VALIDATED').sort((a, b) => b.exitDate.localeCompare(a.exitDate))[0] ?? null
