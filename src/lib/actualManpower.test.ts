import { describe, expect, it } from 'vitest'
import { createInitialData } from '../data/demoData'
import type { Employee, EmployeeExit } from '../types'
import { buildActualManpowerSummary, type ActualManpowerInput } from './actualManpower'
import { createBusinessWorkbook } from './excelExport'
import { readWorkbookBrowser } from './import/service'
import type { ReviewItem } from './import/types'

const data = createInitialData()
const project = data.projects[0]
const base: Employee = {
  ...data.employees[0], id: 'internal-synthetic-1', personnelId: 'PRIVATE-ID-001', name: 'PRIVATE-NAME-CANARY',
  projectId: project.id, areaId: project.areaId, subArea: 'SUB AREA CONTOH',
  employmentStatus: 'ACTIVE', validationStatus: 'VALIDATED', conditionStatus: 'CONFIRMED', joinDate: '2026-01-01',
  profile: { nationalId: 'PRIVATE-KTP-CANARY', email: 'private.canary@example.test', mobilePhone: 'PRIVATE-PHONE',
    ktpAddress: 'PRIVATE-ADDRESS', bankAccountNumber: 'PRIVATE-BANK', birthDate: '1900-01-01' },
}
const input = (records: Employee[] = [base], overrides: Partial<ActualManpowerInput> = {}): ActualManpowerInput => ({
  records, exits: [], areas: data.areas, projects: data.projects, allowedAreas: null,
  exportedAt: new Date('2026-10-30T05:00:00Z'), ...overrides,
})
const exit = (employeeId: string, date = '2026-09-01'): EmployeeExit => ({
  ...data.employeeExits[0], id: 'synthetic-exit', employeeId, exitDate: date, validationStatus: 'VALIDATED',
})
const quality = (result: ReturnType<typeof buildActualManpowerSummary>, metric: string) => result.sheets[2].rows.find((row) => row[0] === metric)?.[1]
const reviewedExit = (scope: 'PLACEMENT_END' | 'EMPLOYMENT_END' | undefined, effectiveDate: string | null): ReviewItem => ({
  id: 'synthetic-review', businessKey: base.personnelId, personnelId: base.personnelId, personnelName: 'SYNTHETIC',
  kind: 'EXIT', aspects: ['EXIT'], areaId: base.areaId, recordIds: [], diffFields: [], dates: [], rowNumbers: [], reason: '', candidate: null,
  status: 'CONFIRMED', resolution: { decisionKind: 'EXIT', exitScope: scope, effectiveDate, note: '', reviewedBy: 'synthetic', reviewedAt: '2026-10-30T00:00:00Z', decisionVersion: 1 },
  createdAt: '2026-10-30T00:00:00Z', updatedAt: '2026-10-30T00:00:00Z',
})

describe('Actual Manpower current snapshot', () => {
  it('counts a normalized Personnel ID once across consistent storage aliases', () => {
    const result = buildActualManpowerSummary(input([base, { ...base, id: 'other-storage-id', personnelId: ' private-id-001 ' }]))
    expect(result.actualActive).toBe(1)
    expect(quality(result, 'Total employee records yang diperiksa')).toBe(2)
    expect(quality(result, 'Total Personnel ID unik')).toBe(1)
    expect(quality(result, 'Kelompok Personnel ID duplikat')).toBe(1)
  })

  it('uses existing active/validation/review rules without dropping incomplete placement', () => {
    const records = [base,
      { ...base, personnelId: 'INACTIVE', employmentStatus: 'INACTIVE' as const },
      { ...base, personnelId: 'DRAFT', validationStatus: 'DRAFT' as const },
      { ...base, personnelId: 'REVIEW', conditionStatus: 'NEEDS_REVIEW' as const },
    ]
    const result = buildActualManpowerSummary(input(records))
    expect(result.actualActive).toBe(1)
    expect(quality(result, 'Employee yang masih membutuhkan validasi')).toBe(1)
    expect(quality(result, 'Employee berstatus NEEDS_REVIEW')).toBe(1)
  })

  it('excludes a validated exit even when it points to another internal storage id', () => {
    const alias = { ...base, id: 'alias' }
    expect(buildActualManpowerSummary(input([base, alias], { exits: [exit(alias.id)] })).actualActive).toBe(0)
    expect(buildActualManpowerSummary(input([base], { exits: [{ ...exit(base.id), validationStatus: 'SUBMITTED' }] })).actualActive).toBe(1)
  })

  it('preserves reentry after an old exit and excludes future joins', () => {
    const reentry = { ...base, joinDate: '2026-10-01' }
    expect(buildActualManpowerSummary(input([reentry], { exits: [exit(base.id)] })).actualActive).toBe(1)
    const future = buildActualManpowerSummary(input([{ ...base, joinDate: '2027-01-01' }]))
    expect(future.actualActive).toBe(0)
    expect(quality(future, 'Record dengan Join Date setelah tanggal export')).toBe(1)
  })

  it('keeps missing area and project in the national aggregation', () => {
    const result = buildActualManpowerSummary(input([{ ...base, areaId: null, projectId: null, subArea: null }]))
    expect(result.actualActive).toBe(1)
    expect(result.rows[0]).toMatchObject({ area: 'Belum Dipetakan', client: 'Belum Dipetakan', project: 'Belum Dipetakan', actual: 1 })
    expect(quality(result, 'Employee dengan Area belum terisi')).toBe(1)
    expect(quality(result, 'Employee dengan Project belum terisi')).toBe(1)
  })

  it('marks dangling project references instead of inferring a project', () => {
    const result = buildActualManpowerSummary(input([{ ...base, projectId: 'nonexistent-project' }]))
    expect(result.actualActive).toBe(1)
    expect(result.rows[0].project).toBe('Belum Dipetakan')
    expect(quality(result, 'Employee dengan mapping project belum ditemukan')).toBe(1)
  })

  it('treats the imported catalog placeholder as an unmapped client', () => {
    const result = buildActualManpowerSummary(input([base], { projects: [{ ...project, clientName: 'Belum tersedia' }] }))
    expect(result.actualActive).toBe(1)
    expect(result.rows[0]).toMatchObject({ client: 'Belum Dipetakan', status: 'Active Unmapped' })
    expect(quality(result, 'Employee dengan Client belum terisi')).toBe(1)
  })

  it('does not invent combinations and reconciles multiple aggregate groups to the active total', () => {
    const result = buildActualManpowerSummary(input([base,
      { ...base, id: 'synthetic-2', personnelId: 'SYNTHETIC-2' },
      { ...base, id: 'synthetic-3', personnelId: 'SYNTHETIC-3', subArea: 'SUB AREA LAIN' },
    ]))
    expect(result.rows).toHaveLength(2)
    expect(result.rows.map((row) => row.actual).sort()).toEqual([1, 2])
    expect(result.rows.reduce((sum, row) => sum + (row.actual ?? 0), 0)).toBe(3)
    expect(quality(result, 'Total Actual Active')).toBe(3)
  })

  it('does not choose a placement or merge conflicting national identities', () => {
    for (const alternate of [
      { ...base, projectId: data.projects[1].id },
      { ...base, profile: { nationalId: 'DIFFERENT-PRIVATE-ID' } },
      { ...base, employmentStatus: 'INACTIVE' as const },
    ]) {
      const result = buildActualManpowerSummary(input([base, alternate]))
      expect(result.actualActive).toBe(0)
      expect(result.conflictingGroups).toBe(1)
      expect(result.rows[0]).toMatchObject({ actual: null, status: 'Perlu Review', reviewCount: 1 })
    }
  })

  it('keeps conflicts visible when another placement is hidden by scope or project filter', () => {
    const alternate = { ...base, areaId: 'other-area', projectId: 'other-project' }
    const result = buildActualManpowerSummary(input([base, alternate], { allowedAreas: [base.areaId!], projectId: base.projectId! }))
    expect(result.conflictingGroups).toBe(1)
    expect(result.actualActive).toBe(0)
    expect(JSON.stringify(result.sheets)).not.toContain('other-area')
    expect(JSON.stringify(result.sheets)).not.toContain('other-project')
  })

  it('does not turn missing Personnel ID into one anonymous employee', () => {
    const result = buildActualManpowerSummary(input([{ ...base, personnelId: '' }, { ...base, personnelId: '  ' }]))
    expect(result.withoutId).toBe(2)
    expect(result.actualActive).toBe(0)
    expect(result.rows[0]).toMatchObject({ actual: null, reviewCount: 0, unidentifiedCount: 2 })
  })

  it('applies area/project filters consistently to aggregation, quality, references, and metadata', () => {
    const otherProject = data.projects.find((item) => item.areaId !== project.areaId)!
    const result = buildActualManpowerSummary(input([base, { ...base, personnelId: 'OTHER', areaId: otherProject.areaId, projectId: otherProject.id }], {
      areaId: project.areaId, projectId: project.id, allowedAreas: [project.areaId],
    }))
    expect(result.actualActive).toBe(1)
    expect(quality(result, 'Total employee records yang diperiksa')).toBe(1)
    expect(result.sheets[1].rows).toHaveLength(1)
    expect(result.sheets[3].rows).toContainEqual(['Filter Project', project.name])
  })

  it('exports an empty snapshot with four sheets and no invented combinations', () => {
    const result = buildActualManpowerSummary(input([]))
    expect(result.rows).toHaveLength(0)
    expect(result.sheets).toHaveLength(4)
    expect(result.actualActive).toBe(0)
  })

  it('round-trips the actual four-sheet xlsx without personal canary values', async () => {
    const result = buildActualManpowerSummary(input([base]))
    const workbook = await createBusinessWorkbook(result.sheets)
    const blob = await workbook.toBlob()
    const sheets = await readWorkbookBrowser(new File([blob], 'synthetic-aggregate.xlsx'))
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Actual by Area & Project', 'HR Project Reference', 'Data Quality Summary', 'Export Metadata'])
    const output = JSON.stringify(sheets)
    for (const secret of [base.personnelId, base.name, ...Object.values(base.profile!)]) {
      expect(output).not.toContain(secret)
    }
    expect(sheets[0].rows[1][4]).toBe(1)
    expect(result.rows.reduce((sum, row) => sum + (row.actual ?? 0), 0)).toBe(result.actualActive)
    expect(output).toContain('Snapshot saat export')
  }, 20000)

  it('partitions mapped, unmapped, review, inactive, and unidentified records without double counting', () => {
    const records = [base,
      { ...base, id: 'unmapped', personnelId: 'UNMAPPED', projectId: null, areaId: null },
      { ...base, id: 'review', personnelId: 'REVIEW', conditionStatus: 'NEEDS_REVIEW' as const },
      { ...base, id: 'draft', personnelId: 'DRAFT', validationStatus: 'SUBMITTED' as const },
      { ...base, id: 'future', personnelId: 'FUTURE', joinDate: '2026-11-01' },
      { ...base, id: 'unknown', personnelId: '' },
    ]
    const result = buildActualManpowerSummary(input(records))
    expect(result).toMatchObject({ actualActive: 2, activeMapped: 1, activeUnmapped: 1, needsReview: 2, inactive: 1, withoutId: 1 })
    expect(result.actualActive).toBe(result.activeMapped + result.activeUnmapped)
    expect(quality(result, 'Total Personnel ID unik')).toBe(result.actualActive + result.needsReview + result.inactive)
    expect(result.rows.reduce((sum, row) => sum + row.reviewCount, 0)).toBe(2)
    expect(result.rows.reduce((sum, row) => sum + row.unidentifiedCount, 0)).toBe(1)
  })

  it('counts active Client conflicts once nationally but never assigns them to a guessed Client', () => {
    const conflicted = { ...base, profile: { ...base.profile, clientName: 'DIFFERENT SYNTHETIC CLIENT' } }
    const result = buildActualManpowerSummary(input([conflicted, { ...conflicted, id: 'alias', personnelId: ` ${base.personnelId.toLowerCase()} ` }]))
    expect(result).toMatchObject({ actualActive: 1, activeMapped: 0, activeUnmapped: 1, needsReview: 0 })
    expect(result.rows[0]).toMatchObject({ client: 'Belum Dipetakan', actual: 1, status: 'Active Unmapped', reviewCount: 0 })
    expect(quality(result, 'Record dengan Client profil berbeda dari Master Project')).toBe(2)
    expect(quality(result, 'Total Active dengan konflik Client')).toBe(1)
    expect(JSON.stringify(result.sheets)).not.toContain('DIFFERENT SYNTHETIC CLIENT')
  })

  it('keeps Client case/whitespace differences mapped and excludes inactive Client conflicts from active counters', () => {
    const normalized = { ...base, profile: { clientName: ` ${project.clientName.toLowerCase()} ` } }
    expect(buildActualManpowerSummary(input([normalized])).activeMapped).toBe(1)
    const ended = { ...base, profile: { clientName: 'OTHER SYNTHETIC CLIENT' } }
    const result = buildActualManpowerSummary(input([ended], { exits: [exit(base.id)] }))
    expect(quality(result, 'Record dengan Client profil berbeda dari Master Project')).toBe(1)
    expect(quality(result, 'Total Active dengan konflik Client')).toBe(0)
    expect(result.actualActive).toBe(0)
  })

  it('keeps pending masters visible in aggregate review rows rather than dropping them', () => {
    const result = buildActualManpowerSummary(input([{ ...base, conditionStatus: 'NEEDS_REVIEW' }]))
    expect(result.needsReview).toBe(1)
    expect(result.rows[0]).toMatchObject({ actual: null, status: 'Perlu Review', reviewCount: 1 })
  })

  it('uses reviewed effective company exit dates instead of profile inference dates', () => {
    const inferred = { ...exit(base.id), id: `import-assumed-exit-${base.id}` }
    const result = buildActualManpowerSummary(input([{ ...base, employmentStatus: 'INACTIVE' }], {
      exits: [inferred], reviewItems: [reviewedExit('EMPLOYMENT_END', '2026-11-01')],
    }))
    expect(result.actualActive).toBe(1)
  })

  it('does not convert placement-end to company-exit, or ignore real validated exits', () => {
    const inferred = { ...exit(base.id), id: `import-assumed-exit-${base.id}` }
    const reviewItems = [reviewedExit('PLACEMENT_END', '2026-09-01')]
    expect(buildActualManpowerSummary(input([base], { exits: [inferred], reviewItems })).actualActive).toBe(1)
    expect(buildActualManpowerSummary(input([base], { exits: [inferred, exit(base.id)], reviewItems })).actualActive).toBe(0)
  })

  it('quarantines legacy reviews without exit scope or effective date', () => {
    for (const review of [reviewedExit(undefined, '2026-09-01'), reviewedExit('EMPLOYMENT_END', null)]) {
      const result = buildActualManpowerSummary(input([base], { reviewItems: [review] }))
      expect(result.needsReview).toBe(1)
      expect(result.actualActive).toBe(0)
    }
  })
})
