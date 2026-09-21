import { differenceInCalendarDays, parseISO } from 'date-fns'
import type { Employee } from '../types'

export const DEMO_TODAY = '2026-09-14'
export type ContractReminderCategory = 'D-30' | 'D-14' | 'D-7' | 'EXPIRED'

export const getContractReminderCategory = (employee: Employee, today = DEMO_TODAY): ContractReminderCategory | null => {
  if (!employee.contractEndDate || employee.employmentStatus !== 'ACTIVE' || employee.validationStatus !== 'VALIDATED') return null
  const days = differenceInCalendarDays(parseISO(employee.contractEndDate), parseISO(today))
  if (days < 0) return 'EXPIRED'
  if (days <= 7) return 'D-7'
  if (days <= 14) return 'D-14'
  if (days <= 30) return 'D-30'
  return null
}

export const getContractReminders = (employees: Employee[], today = DEMO_TODAY) => employees.flatMap((employee) => {
  const category = getContractReminderCategory(employee, today)
  return category ? [{ employee, category, daysRemaining: differenceInCalendarDays(parseISO(employee.contractEndDate!), parseISO(today)) }] : []
})
