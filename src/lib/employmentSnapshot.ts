import type { Employee, EmployeeExit, EmployeeMovement } from '../types'

export type SnapshotExit = Pick<EmployeeExit, 'employeeId' | 'exitDate' | 'validationStatus'>

export const snapshotDateAt = (date: Date): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date)

export const isBusinessDate = (value: string | null | undefined): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export interface EmploymentSnapshot {
  status: 'ACTIVE' | 'INACTIVE' | 'NEEDS_REVIEW'
  reason: string
  latestJoin: string | null
}

/** A read-only projection. Current status may already reflect a future exit. */
export const evaluateEmploymentSnapshot = (
  records: Employee[], exits: SnapshotExit[], movements: EmployeeMovement[], snapshot: string,
): EmploymentSnapshot => {
  const result = (status: EmploymentSnapshot['status'], reason: string, latestJoin: string | null = null): EmploymentSnapshot => ({ status, reason, latestJoin })
  if (!isBusinessDate(snapshot)) throw new Error('Tanggal snapshot tidak valid.')
  if (!records.length || records.some((record) => record.validationStatus !== 'VALIDATED' || record.conditionStatus === 'NEEDS_REVIEW')) {
    return result('NEEDS_REVIEW', 'Validasi atau kondisi master belum selesai')
  }
  const aliases = new Set(records.map((record) => record.id))
  const joins = records.map((record) => record.joinDate)
  const joinHistory = movements.filter((movement) => aliases.has(movement.employeeId)
    && ['JOIN', 'REENTRY'].includes(movement.movementType))
  // Legacy bulk-import JOIN fallback could have used createdAt when join was
  // absent. Do not promote that generated date into business-date evidence.
  if (joinHistory.some((movement) => movement.id.startsWith('career-import-') && !records.some((record) => record.joinDate))) {
    return result('NEEDS_REVIEW', 'Tanggal join sumber belum tersedia')
  }
  const joinValues = [...joins.filter((date) => date !== null), ...joinHistory.map((movement) => movement.effectiveDate)]
  const exitValues = exits.filter((exit) => aliases.has(exit.employeeId) && exit.validationStatus === 'VALIDATED').map((exit) => exit.exitDate)
  if (!joinValues.length || joinValues.some((date) => !isBusinessDate(date)) || exitValues.some((date) => !isBusinessDate(date))) {
    return result('NEEDS_REVIEW', 'Tanggal episode kerja kosong atau tidak valid')
  }
  const joinDates = [...new Set(joinValues as string[])].sort()
  const exitDates = [...new Set(exitValues)].sort()
  const effectiveJoins = joinDates.filter((date) => date <= snapshot)
  const latestJoin = effectiveJoins.at(-1)
  if (!latestJoin) return result('INACTIVE', 'Belum bergabung pada snapshot')
  for (let index = 1; index < effectiveJoins.length; index++) {
    if (!exitDates.some((date) => date >= effectiveJoins[index - 1] && date < effectiveJoins[index])) {
      return result('NEEDS_REVIEW', 'Episode join/re-entry bertumpang tindih atau exit sebelumnya belum tersedia', latestJoin)
    }
  }
  // Same-day exit closes the episode. Same-day exit + reentry cannot establish
  // order without timestamps, so leave that ambiguity for HR.
  if (exitDates.includes(latestJoin) && joinHistory.some((movement) => movement.movementType === 'REENTRY' && movement.effectiveDate === latestJoin)) {
    return result('NEEDS_REVIEW', 'Exit dan re-entry pada tanggal yang sama; urutan belum jelas', latestJoin)
  }
  if (exitDates.some((date) => date >= latestJoin && date <= snapshot)) return result('INACTIVE', 'Episode telah berakhir pada snapshot', latestJoin)
  const futureExit = exitDates.some((date) => date > snapshot && date >= latestJoin)
  const reentered = joinHistory.some((movement) => movement.movementType === 'REENTRY' && movement.effectiveDate === latestJoin)
  if (records.some((record) => record.employmentStatus === 'INACTIVE') && !futureExit && !reentered) {
    return result('NEEDS_REVIEW', 'Status INACTIVE tidak didukung exit efektif pada episode terakhir', latestJoin)
  }
  return result('ACTIVE', futureExit ? 'Aktif; exit belum efektif' : 'Aktif pada snapshot', latestJoin)
}
