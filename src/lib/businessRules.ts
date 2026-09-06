import { addDays, format, isAfter, isWeekend, parseISO } from 'date-fns'
import type { DemoUser, Employee, ReplacementNeed, Role } from '../types'

export const roleLabels: Record<Role, string> = {
  AREA_SUPPORT: 'Area Supporting / Data Input',
  HR_HO: 'HR Head Office',
  MANAGEMENT: 'BoD / GM',
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

export const canEditEmployees = (user: DemoUser) => user.role !== 'MANAGEMENT'
export const canValidate = (user: DemoUser) => user.role === 'HR_HO'
export const canViewValidation = (user: DemoUser) => user.role === 'HR_HO'

export const canAccessEmployee = (user: DemoUser, employee: Employee) =>
  user.role !== 'AREA_SUPPORT' || employee.areaId === user.areaId

export const filterEmployeesForUser = (user: DemoUser, employees: Employee[]) =>
  employees.filter((employee) => canAccessEmployee(user, employee))

export const hasCompleteSourceData = (record: Pick<Employee, 'areaId' | 'projectId' | 'position'> | Pick<ReplacementNeed, 'areaId' | 'projectId' | 'position'>) =>
  Boolean(record.areaId && record.projectId && record.position)

export interface EligibilityResult {
  eligible: boolean
  reasons: string[]
}

export const getCandidateEligibility = (need: ReplacementNeed, candidate: Employee): EligibilityResult => {
  const reasons: string[] = []
  if (!hasCompleteSourceData(need)) reasons.push('Data sumber kebutuhan belum lengkap')
  if (!candidate.areaId || !candidate.projectId || !candidate.position) reasons.push('Data kandidat belum lengkap')
  if (candidate.areaId !== need.areaId) reasons.push('Area tidak sesuai')
  if (candidate.projectId !== need.projectId) reasons.push('Project tidak sesuai')
  if (candidate.position !== need.position) reasons.push('Posisi tidak sesuai')
  if (candidate.id === need.originalEmployeeId) reasons.push('Karyawan asal tidak dapat menjadi pengganti')
  if (candidate.employmentStatus !== 'ACTIVE') reasons.push('Karyawan tidak aktif')
  return { eligible: reasons.length === 0, reasons }
}

export const getFulfillmentBlockers = (candidate: Employee): string[] => {
  const reasons: string[] = []
  if (candidate.validationStatus !== 'VALIDATED') reasons.push('Data karyawan belum tervalidasi HR')
  if (candidate.contractStatus !== 'SIGNED') reasons.push('Kontrak belum ditandatangani')
  if (!candidate.joinDate) reasons.push('Tanggal bergabung belum tersedia')
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
