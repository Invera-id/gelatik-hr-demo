import { beforeEach, describe, expect, it } from 'vitest'
import { demoUsers } from '../../data/demoData'
import { cloneDefaultPermissions, defaultValidationPolicy } from '../../config/access'
import { expandSpec, resultRecipients, validationRecipients, visibleFor, type AccessContext } from './rules'
import { buildEntrySubmission, buildImportSummary } from './events'
import * as svc from './service'
import { computeContractReminders, computeOverSla } from './reminders'
import type { Employee, ReplacementNeed, ValidationPolicy } from '../../types'
import type { ImportBatch } from '../import/types'

const ctx = (policy: ValidationPolicy = { ...defaultValidationPolicy }): AccessContext => ({
  users: demoUsers,
  permissionConfig: cloneDefaultPermissions(),
  validationPolicy: policy,
})

const employee = (over: Partial<Employee> = {}): Employee => ({
  id: 'employee-x', personnelId: 'EMP-X', name: 'Budi', areaId: 'area-bandung', subArea: null, projectId: null,
  position: 'Sales', employmentStatus: 'ACTIVE', joinDate: '2026-09-01', contractStartDate: '2026-09-01',
  contractEndDate: '2026-12-31', contractStatus: 'SIGNED', bpjsStatus: null, createdBy: 'user-bandung',
  validationStatus: 'SUBMITTED', validationTransaction: 'EMPLOYEE_ENTRY', validatedBy: null, validatedAt: null,
  submittedAt: '2026-09-10T00:00:00.000Z', revisionNote: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z',
  ...over,
})

describe('recipient rules', () => {
  it('sends an entry submission to HR validators (policy + scope), excluding the actor', () => {
    const recipients = validationRecipients('EMPLOYEE_ENTRY', 'area-bandung', 'user-bandung', ctx())
    expect(recipients).toContain('user-hr')
    expect(recipients).toContain('user-superadmin')
    expect(recipients).not.toContain('user-bandung')
    expect(recipients).not.toContain('user-operations')
  })

  it('follows validation policy — AREA_ADMIN policy excludes HR HO', () => {
    const recipients = validationRecipients('EMPLOYEE_ENTRY', 'area-bandung', 'user-bandung', ctx({ ...defaultValidationPolicy, EMPLOYEE_ENTRY: 'AREA_ADMIN' }))
    expect(recipients).not.toContain('user-hr')
  })

  it('result goes to the submission author', () => {
    expect(resultRecipients('user-bandung', ctx())).toEqual(['user-bandung'])
    expect(resultRecipients('ghost-user', ctx())).toEqual([])
  })
})

describe('service: dedupe, read separation, persistence, reconcile', () => {
  beforeEach(() => svc.clearAll())

  it('does not insert the same dedupeKey twice (idempotent across replay/StrictMode/refresh)', () => {
    const recs = buildEntrySubmission({ employee: employee(), actor: demoUsers[0], areaName: 'Bandung', ctx: ctx(), now: '2026-09-10T00:00:00.000Z' })
    expect(svc.emit(recs).inserted.length).toBeGreaterThan(0)
    expect(svc.emit(recs).inserted.length).toBe(0) // replay → nothing new
    const hrCount = svc.getSnapshot().filter((r) => r.recipientUserId === 'user-hr').length
    expect(hrCount).toBe(1)
  })

  it('a new submission cycle (new submittedAt) creates a new event', () => {
    svc.emit(buildEntrySubmission({ employee: employee({ submittedAt: 'cycle-1' }), actor: demoUsers[0], areaName: 'Bandung', ctx: ctx(), now: 'n1' }))
    svc.emit(buildEntrySubmission({ employee: employee({ submittedAt: 'cycle-2' }), actor: demoUsers[0], areaName: 'Bandung', ctx: ctx(), now: 'n2' }))
    expect(svc.getSnapshot().filter((r) => r.recipientUserId === 'user-hr').length).toBe(2)
  })

  it('keeps read state separate per recipient', () => {
    svc.emit(buildEntrySubmission({ employee: employee(), actor: demoUsers[0], areaName: 'Bandung', ctx: ctx(), now: 'n' }))
    const hrItem = svc.getSnapshot().find((r) => r.recipientUserId === 'user-hr')!
    svc.markRead(hrItem.id, 'user-hr')
    expect(svc.getSnapshot().find((r) => r.id === hrItem.id)!.readAt).toBeTruthy()
    const saItem = svc.getSnapshot().find((r) => r.recipientUserId === 'user-superadmin')!
    expect(saItem.readAt).toBeNull()
  })

  it('persists across a fresh read (refresh)', () => {
    svc.emit(buildEntrySubmission({ employee: employee(), actor: demoUsers[0], areaName: 'Bandung', ctx: ctx(), now: 'n' }))
    // Simulate a reload: the store is read fresh from localStorage.
    expect(svc.getAll().some((r) => r.recipientUserId === 'user-hr')).toBe(true)
  })

  it('resolves reminder alerts whose base is no longer valid', () => {
    const recs = expandSpec({ dedupeBase: 'contract:emp:2026-12-31:D-7', recipientIds: ['user-hr'], category: 'CONTRACT', severity: 'warning', title: 't', message: 'm', entityType: 'employee', requiresAction: true }, 'now')
    svc.emit(recs)
    svc.reconcileReminders('CONTRACT', new Set()) // nothing valid anymore
    expect(svc.getSnapshot().find((r) => r.recipientUserId === 'user-hr')!.resolvedAt).toBeTruthy()
  })

  it('clearAll empties the store', () => {
    svc.emit(buildEntrySubmission({ employee: employee(), actor: demoUsers[0], areaName: 'Bandung', ctx: ctx(), now: 'n' }))
    svc.clearAll()
    expect(svc.getAll()).toHaveLength(0)
  })
})

describe('visibility honors current access', () => {
  it('hides notifications for areas a user no longer covers', () => {
    const recs = expandSpec({ dedupeBase: 'x', recipientIds: ['user-bandung'], category: 'PERSONNEL', severity: 'info', title: 't', message: 'm', entityType: 'employee', areaId: 'area-jakarta' }, 'now')
    const bandungUser = demoUsers.find((u) => u.id === 'user-bandung')!
    // Area support covers only its own area; a jakarta-area record must not show.
    expect(visibleFor(recs, bandungUser, cloneDefaultPermissions())).toHaveLength(0)
  })
})

describe('import summary', () => {
  it('produces exactly one notification for the actor regardless of row count', () => {
    const batch: ImportBatch = {
      id: 'batch-1', fileName: 'big.xlsx', sheetName: 'Database', status: 'COMPLETED_WITH_WARNINGS', createdAt: 'now',
      summary: { fileName: 'big.xlsx', sheetName: 'Database', nonEmptyRows: 3000, uniqueIdentities: 3000, newMasters: 3000, newSourceRecords: 3000, identicalDuplicates: 0, movementCandidates: 0, exitReentryCandidates: 0, ambiguousCases: 0, identityConflicts: 0, confirmedEvents: 0, warningRows: 5, exceptionRows: 0, blankRowsSkipped: 0, pendingReviewItems: 0 },
    }
    const recs = buildImportSummary({ batch, actor: demoUsers[1], now: 'now' })
    expect(recs).toHaveLength(1)
    expect(recs[0].recipientUserId).toBe(demoUsers[1].id)
    expect(recs[0].category).toBe('IMPORT')
  })
})

describe('reminders', () => {
  const activeContract = (id: string, endDate: string): Employee => employee({ id, personnelId: id, contractEndDate: endDate, validationStatus: 'VALIDATED' })

  it('creates contract reminders only for urgent categories and escalates with a new base', () => {
    // DEMO_TODAY is 2026-09-14. D-7 window ends 2026-09-21; D-30 ends 2026-10-14.
    const d7 = computeContractReminders([activeContract('A', '2026-09-18')], ctx(), 'now')
    expect([...d7.validBases][0]).toContain(':D-7')
    const d30 = computeContractReminders([activeContract('B', '2026-10-10')], ctx(), 'now')
    expect(d30.records).toHaveLength(0) // D-30 is informational only (dashboard), not a notification
  })

  it('over-SLA only reports open needs past the working-day target', () => {
    const openOverdue: ReplacementNeed = { id: 'need-1', employeeExitId: 'x', originalEmployeeId: 'e', areaId: 'area-bandung', projectId: null, position: null, exitDate: '2026-09-01', replacementEmployeeId: null, replacementJoinDate: null, previousReplacementNeedId: null, status: 'OPEN', fulfilledAt: null, gapWorkingDays: null, createdAt: 'x', updatedAt: 'x' }
    const fulfilled: ReplacementNeed = { ...openOverdue, id: 'need-2', status: 'FULFILLED' }
    const result = computeOverSla([openOverdue, fulfilled], ctx(), 'now')
    expect([...result.validBases]).toEqual(['sla:need-1:open'])
  })
})
