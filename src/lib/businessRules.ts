import { addDays, format, isAfter, isBefore, isWeekend, parseISO } from 'date-fns'
import type { DemoUser, Employee, ReplacementNeed, Role, RolePermissionConfig } from '../types'
import { allowedAreaIds, hasPermission } from '../config/access'

export const roleLabels: Record<Role, string> = {
  AREA_SUPPORT: 'Area Supporting / Data Input',
  HR_HO: 'HR Head Office',
  OPERATIONS_MANAGER: 'Operational / Manager',
  MANAGEMENT: 'BoD / GM',
  SUPER_ADMIN: 'Super Admin',
}

export const validationLabels = {
  DRAFT: 'Draft', SUBMITTED: 'Menunggu validasi', VALIDATED: 'Tervalidasi', REVISION_REQUIRED: 'Perlu revisi',
} as const

export const replacementLabels = {
  OPEN: 'Open', MATCHED: 'Matched', FULFILLED: 'Fulfilled', OVER_TARGET: 'Over SLA',
} as const

export const contractLabels = {
  NOT_AVAILABLE: 'Belum tersedia', DRAFT: 'Draft', SIGNED: 'Ditandatangani',
} as const

/** A person counts as active workforce only when their current condition is confirmed. */
export const isCountableActive = (employee: Pick<Employee, 'employmentStatus' | 'conditionStatus'>) =>
  employee.employmentStatus === 'ACTIVE' && employee.conditionStatus !== 'NEEDS_REVIEW'

/** Whether the person's current condition still needs review (undetermined by import). */
export const conditionNeedsReview = (employee: Pick<Employee, 'conditionStatus'>) =>
  employee.conditionStatus === 'NEEDS_REVIEW'

/**
 * Import review visibility and resolution are separate permissions. Both remain
 * constrained by area scope; unknown-area items require all-area scope.
 */
export const canViewImportReviewItem = (
  user: DemoUser,
  config: RolePermissionConfig[],
  item: { areaId: string | null },
): boolean => {
  if (!hasPermission(user, config, 'view_import_review')) return false
  const areaIds = allowedAreaIds(user, config)
  if (areaIds === null) return true
  return Boolean(item.areaId && areaIds.includes(item.areaId))
}

export const canReviewImportItem = (user: DemoUser, config: RolePermissionConfig[], item: { areaId: string | null }) =>
  hasPermission(user, config, 'resolve_import_review') && canViewImportReviewItem(user, config, item)

export const canAccessEmployee = (user: DemoUser, employee: Employee, config?: RolePermissionConfig[]) => {
  if (!config) return user.role !== 'AREA_SUPPORT' || employee.areaId === user.areaId
  const areaIds = allowedAreaIds(user, config)
  return areaIds === null || Boolean(employee.areaId && areaIds.includes(employee.areaId))
}

export const filterEmployeesForUser = (user: DemoUser, employees: Employee[], config?: RolePermissionConfig[]) =>
  employees.filter((employee) => canAccessEmployee(user, employee, config))

export const hasCompleteSourceData = (record: Pick<Employee, 'areaId' | 'projectId' | 'position'> | Pick<ReplacementNeed, 'areaId' | 'projectId' | 'position'>) =>
  Boolean(record.areaId && record.projectId && record.position)

export interface EligibilityResult {
  eligible: boolean
  reasons: string[]
}

export const getCandidateEligibility = (need: ReplacementNeed, candidate: Employee, needs: ReplacementNeed[] = []): EligibilityResult => {
  const reasons: string[] = []
  if (!hasCompleteSourceData(need)) reasons.push('Data sumber kebutuhan belum lengkap')
  if (!candidate.areaId || !candidate.projectId || !candidate.position) reasons.push('Data kandidat belum lengkap')
  if (candidate.areaId !== need.areaId) reasons.push('Area tidak sesuai')
  if (candidate.projectId !== need.projectId) reasons.push('Project tidak sesuai')
  if (candidate.position !== need.position) reasons.push('Posisi tidak sesuai')
  if (candidate.id === need.originalEmployeeId) reasons.push('Karyawan asal tidak dapat menjadi pengganti')
  if (candidate.employmentStatus !== 'ACTIVE') reasons.push('Karyawan tidak aktif')
  if (candidate.conditionStatus === 'NEEDS_REVIEW') reasons.push('Kondisi terkini belum ditinjau')
  if (needs.some((item) => item.id !== need.id && item.replacementEmployeeId === candidate.id && ['OPEN', 'MATCHED'].includes(item.status))) reasons.push('Karyawan sudah dialokasikan pada kebutuhan aktif lain')
  return { eligible: reasons.length === 0, reasons }
}

export const getFulfillmentBlockers = (candidate: Employee, need?: ReplacementNeed, needs: ReplacementNeed[] = []): string[] => {
  const reasons: string[] = need ? getCandidateEligibility(need, candidate, needs).reasons : []
  if (candidate.validationStatus !== 'VALIDATED') reasons.push('Data karyawan belum tervalidasi HR')
  if (candidate.contractStatus !== 'SIGNED') reasons.push('Kontrak belum ditandatangani')
  if (!candidate.joinDate) reasons.push('Tanggal bergabung belum tersedia')
  if (need && candidate.joinDate && isBefore(parseISO(candidate.joinDate), parseISO(need.exitDate))) reasons.push('Tanggal bergabung tidak boleh lebih awal dari tanggal exit employee sebelumnya')
  return reasons
}

export const calculateWorkingDayGap = (exitDate: string, joinDate: string): number => {
  const end = parseISO(joinDate)
  let cursor = addDays(parseISO(exitDate), 1)
  let total = 0
  while (!isAfter(cursor, end)) {
    if (!isWeekend(cursor)) total += 1
    cursor = addDays(cursor, 1)
  }
  return total
}

export const getGapStatus = (gap: number) => gap <= 3 ? 'FULFILLED' as const : 'OVER_TARGET' as const

export const formatDate = (value: string | null | undefined, withTime = false) => {
  if (!value) return '—'
  return format(parseISO(value), withTime ? 'dd MMM yyyy, HH:mm' : 'dd MMM yyyy')
}

export const formatNumber = (value: number) => new Intl.NumberFormat('id-ID').format(value)
