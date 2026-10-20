import type { Employee, EmployeeExit, EmployeeMovement, ReplacementNeed } from '../../types'
import { calculateWorkingDayGap, getGapStatus } from '../businessRules'

export interface HistoricalWorkforceView {
  exits: EmployeeExit[]
  replacementNeeds: ReplacementNeed[]
  movements: EmployeeMovement[]
}

const placementKey = (employee: Employee): string => [employee.areaId, employee.projectId, employee.position?.trim().toLocaleUpperCase('id-ID')]
  .map((value) => value ?? '')
  .join('|')

const isoAtStartOfDay = (date: string): string => `${date}T00:00:00.000Z`

/**
 * DEMO ASSUMPTION for imported historical master data:
 * - Tanggal Keluar is a company exit and requires replacement.
 * - Replacement is inferred by exact Area + Project + Position.
 * - Candidate join must be on/after exit; nearest unused join wins.
 * - A candidate is allocated once. No inferred transaction is persisted.
 */
export const deriveHistoricalWorkforce = (importedEmployees: Employee[]): HistoricalWorkforceView => {
  const confirmed = importedEmployees.filter((employee) => employee.validationStatus === 'VALIDATED' && employee.conditionStatus !== 'NEEDS_REVIEW')
  const exiting = confirmed
    .filter((employee) => Boolean(employee.profile?.exitDate))
    .sort((a, b) => (a.profile?.exitDate ?? '').localeCompare(b.profile?.exitDate ?? '') || a.id.localeCompare(b.id))

  const candidatesByPlacement = new Map<string, Employee[]>()
  for (const employee of confirmed) {
    if (!employee.joinDate || !employee.areaId || !employee.projectId || !employee.position) continue
    const list = candidatesByPlacement.get(placementKey(employee)) ?? []
    list.push(employee)
    candidatesByPlacement.set(placementKey(employee), list)
  }
  for (const list of candidatesByPlacement.values()) list.sort((a, b) => (a.joinDate ?? '').localeCompare(b.joinDate ?? '') || a.id.localeCompare(b.id))

  const usedCandidates = new Set<string>()
  const exits: EmployeeExit[] = []
  const replacementNeeds: ReplacementNeed[] = []
  const movements: EmployeeMovement[] = []

  for (const employee of exiting) {
    const exitDate = employee.profile?.exitDate
    if (!exitDate) continue
    const exitId = `import-assumed-exit-${employee.id}`
    const createdAt = isoAtStartOfDay(exitDate)
    exits.push({
      id: exitId,
      employeeId: employee.id,
      exitDate,
      exitReason: employee.profile?.exitReason?.trim() || 'Historical exit dari import Excel',
      replacementRequired: true,
      createdBy: employee.createdBy,
      validationStatus: 'VALIDATED',
      validatedBy: employee.validatedBy,
      validatedAt: employee.validatedAt ?? createdAt,
      submittedAt: createdAt,
      revisionNote: null,
      createdAt,
      updatedAt: employee.updatedAt,
    })

    const candidates = candidatesByPlacement.get(placementKey(employee)) ?? []
    const replacement = candidates.find((candidate) =>
      candidate.id !== employee.id &&
      !usedCandidates.has(candidate.id) &&
      Boolean(candidate.joinDate && candidate.joinDate >= exitDate))
    if (replacement) usedCandidates.add(replacement.id)
    const gap = replacement?.joinDate ? calculateWorkingDayGap(exitDate, replacement.joinDate) : null
    const status = gap === null ? 'OPEN' as const : getGapStatus(gap)
    const previousNeed = replacementNeeds.find((need) => need.replacementEmployeeId === employee.id)
    const needId = `import-assumed-need-${employee.id}`
    replacementNeeds.push({
      id: needId,
      employeeExitId: exitId,
      originalEmployeeId: employee.id,
      areaId: employee.areaId,
      projectId: employee.projectId,
      position: employee.position,
      exitDate,
      replacementEmployeeId: replacement?.id ?? null,
      replacementJoinDate: replacement?.joinDate ?? null,
      previousReplacementNeedId: previousNeed?.id ?? null,
      status,
      fulfilledAt: replacement?.joinDate ? isoAtStartOfDay(replacement.joinDate) : null,
      gapWorkingDays: gap,
      createdAt,
      updatedAt: employee.updatedAt,
    })

    movements.push({
      id: `import-assumed-movement-exit-${employee.id}`,
      employeeId: employee.id,
      movementType: 'EXIT',
      effectiveDate: exitDate,
      previousAreaId: employee.areaId,
      newAreaId: employee.areaId,
      previousProjectId: employee.projectId,
      newProjectId: employee.projectId,
      previousPosition: employee.position,
      newPosition: employee.position,
      notes: `Demo assumption — ${employee.profile?.exitReason?.trim() || 'historical exit dari import Excel'}`,
      createdBy: employee.createdBy,
      createdAt,
    })
    if (replacement?.joinDate) movements.push({
      id: `import-assumed-movement-replacement-${employee.id}-${replacement.id}`,
      employeeId: replacement.id,
      movementType: 'REPLACEMENT',
      effectiveDate: replacement.joinDate,
      previousAreaId: null,
      newAreaId: replacement.areaId,
      previousProjectId: null,
      newProjectId: replacement.projectId,
      previousPosition: null,
      newPosition: replacement.position,
      notes: `Demo assumption — inferred replacement untuk Personnel ID ${employee.personnelId}`,
      createdBy: replacement.createdBy,
      createdAt: isoAtStartOfDay(replacement.joinDate),
    })
  }

  return { exits, replacementNeeds, movements }
}
