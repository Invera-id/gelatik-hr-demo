import { describe, expect, it } from 'vitest'
import type { Employee } from '../../types'
import { deriveHistoricalWorkforce } from './historicalWorkforce'

const employee = (id: string, overrides: Partial<Employee> = {}): Employee => ({
  id,
  personnelId: id.toUpperCase(),
  name: `PERSONIL ${id.toUpperCase()}`,
  areaId: 'area-a',
  subArea: null,
  projectId: 'project-a',
  position: 'PROMOTOR',
  employmentStatus: 'ACTIVE',
  conditionStatus: 'CONFIRMED',
  joinDate: '2025-01-01',
  contractStartDate: null,
  contractEndDate: null,
  contractStatus: 'NOT_AVAILABLE',
  bpjsStatus: null,
  profile: {},
  createdBy: 'user-hr',
  validationStatus: 'VALIDATED',
  validatedBy: 'user-hr',
  validatedAt: '2026-01-01T00:00:00.000Z',
  submittedAt: '2026-01-01T00:00:00.000Z',
  revisionNote: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

describe('imported historical workforce demo assumptions', () => {
  it('derives turnover and allocates the nearest replacement only once', () => {
    const view = deriveHistoricalWorkforce([
      employee('exit-1', { employmentStatus: 'INACTIVE', profile: { exitDate: '2026-01-05', exitReason: 'SELESAI' } }),
      employee('exit-2', { employmentStatus: 'INACTIVE', profile: { exitDate: '2026-01-06', exitReason: 'SELESAI' } }),
      employee('replacement-1', { joinDate: '2026-01-07' }),
    ])
    expect(view.exits).toHaveLength(2)
    expect(view.replacementNeeds).toHaveLength(2)
    expect(view.replacementNeeds.filter((need) => need.status === 'FULFILLED')).toHaveLength(1)
    expect(view.replacementNeeds.filter((need) => need.status === 'OPEN')).toHaveLength(1)
    expect(view.replacementNeeds.find((need) => need.status === 'FULFILLED')?.gapWorkingDays).toBe(2)
  })

  it('excludes unvalidated and needs-review masters from inferred transactions', () => {
    const view = deriveHistoricalWorkforce([
      employee('submitted', { validationStatus: 'SUBMITTED', profile: { exitDate: '2026-01-05' } }),
      employee('review', { conditionStatus: 'NEEDS_REVIEW', profile: { exitDate: '2026-01-06' } }),
    ])
    expect(view.exits).toHaveLength(0)
    expect(view.replacementNeeds).toHaveLength(0)
  })
})
