import type { EmployeeFlag } from '../types'

export const getEmployeeFlagWarning = (employeeId: string, flags: EmployeeFlag[]) => {
  const historical = flags.filter((flag) => flag.employeeId === employeeId && ['REVIEW_REQUIRED', 'FLAGGED'].includes(flag.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { requiresReview: historical.length > 0, latest: historical[0] ?? null, historical }
}
