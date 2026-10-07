import type { Employee, ReplacementNeed } from '../../types'
import { getContractReminderCategory, DEMO_TODAY, type ContractReminderCategory } from '../contractRules'
import { calculateWorkingDayGap, getGapStatus } from '../businessRules'
import { expandSpec, userCoversArea, type AccessContext } from './rules'
import type { NotificationRecord, NotificationSeverity } from './types'

/**
 * Reminder reconciliation (contract + over-SLA). Pure: returns the records that
 * should currently exist plus the set of valid dedupe bases, so the caller can
 * emit idempotently and resolve alerts whose condition no longer holds.
 */

export interface ReminderResult {
  records: NotificationRecord[]
  validBases: Set<string>
}

const severityForContract = (category: ContractReminderCategory): NotificationSeverity =>
  category === 'EXPIRED' ? 'error' : category === 'D-7' ? 'warning' : 'info'

const contractRecipients = (employee: Employee, ctx: AccessContext): string[] =>
  ctx.users
    .filter((user) => user.role === 'HR_HO' || user.role === 'AREA_SUPPORT')
    .filter((user) => userCoversArea(user, employee.areaId, ctx.permissionConfig))
    .map((user) => user.id)

/**
 * Contract reminders for the current business date. One alert per employee for the
 * category in effect now (not all categories at once). Escalation to a more urgent
 * category produces a new base; the old category is reconciled away as resolved.
 */
/** Only the urgent, actionable categories become notifications (the dashboard shows all four). */
const NOTIFY_CATEGORIES: ContractReminderCategory[] = ['D-7', 'EXPIRED']
const CONTRACT_CAP = 50

export const computeContractReminders = (
  employees: Employee[],
  ctx: AccessContext,
  now: string,
  today = DEMO_TODAY,
): ReminderResult => {
  const records: NotificationRecord[] = []
  const validBases = new Set<string>()
  let made = 0
  for (const employee of employees) {
    const category = getContractReminderCategory(employee, today)
    if (!category || !employee.contractEndDate || !NOTIFY_CATEGORIES.includes(category)) continue
    if (made >= CONTRACT_CAP) break
    made += 1
    const base = `contract:${employee.id}:${employee.contractEndDate}:${category}`
    validBases.add(base)
    records.push(
      ...expandSpec({
        dedupeBase: base,
        recipientIds: contractRecipients(employee, ctx),
        category: 'CONTRACT',
        severity: severityForContract(category),
        title: category === 'EXPIRED' ? 'Kontrak sudah berakhir' : `Kontrak mendekati berakhir (${category})`,
        message: `Kontrak ${employee.name} (${employee.personnelId}) ${category === 'EXPIRED' ? 'sudah berakhir pada' : 'berakhir pada'} ${employee.contractEndDate}.`,
        entityType: 'employee',
        entityId: employee.id,
        areaId: employee.areaId,
        target: { kind: 'employee', id: employee.id },
        requiresAction: true,
      }, now),
    )
  }
  return { records, validBases }
}

/**
 * Open replacement needs that have passed the working-day SLA and are not yet
 * fulfilled. Fulfilled-but-late needs are NOT reported as open here.
 */
export const computeOverSla = (
  needs: ReplacementNeed[],
  ctx: AccessContext,
  now: string,
  today = DEMO_TODAY,
): ReminderResult => {
  const records: NotificationRecord[] = []
  const validBases = new Set<string>()
  for (const need of needs) {
    const open = need.status === 'OPEN' || need.status === 'MATCHED'
    if (!open) continue
    const gap = calculateWorkingDayGap(need.exitDate, today)
    if (getGapStatus(gap) !== 'OVER_TARGET') continue
    const base = `sla:${need.id}:open`
    validBases.add(base)
    const recipients = ctx.users
      .filter((user) => ['HR_HO', 'OPERATIONS_MANAGER', 'MANAGEMENT'].includes(user.role))
      .filter((user) => userCoversArea(user, need.areaId, ctx.permissionConfig))
      .map((user) => user.id)
    records.push(
      ...expandSpec({
        dedupeBase: base,
        recipientIds: recipients,
        category: 'SLA',
        severity: 'warning',
        title: 'Replacement melewati SLA',
        message: `Kebutuhan ${need.id.toUpperCase()} masih terbuka ${gap} hari kerja sejak exit (target ≤ 3).`,
        entityType: 'replacement',
        entityId: need.id,
        areaId: need.areaId,
        target: { kind: 'replacement', id: need.id },
        requiresAction: true,
      }, now),
    )
  }
  return { records, validBases }
}
