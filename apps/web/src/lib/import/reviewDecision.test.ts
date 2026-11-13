import { describe, expect, it } from 'vitest'
import { validateReviewDecision } from './reviewDecision'
import type { ReviewItem, SourceImportRecord } from './types'

const item = { id: 'r1', businessKey: 'ID-1' } as ReviewItem
const records = [
  { id: 'before', fields: { areaCbs: 'A', projectName: 'P1', position: 'Sales', exitDate: '2026-01-10' } },
  { id: 'after', fields: { areaCbs: 'A', projectName: 'P2', position: 'Sales' } },
] as unknown as SourceImportRecord[]

describe('review decision validation', () => {
  it('requires an effective date and distinct before/after for mutation', () => {
    const result = validateReviewDecision(item, { decisionKind: 'PLACEMENT_CHANGE', beforeRecordId: 'before', afterRecordId: 'before', note: '' }, records)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/Tanggal efektif/)
    expect(result.errors.join(' ')).toMatch(/harus berbeda/)
  })

  it('rejects re-entry on or before the last exit', () => {
    const result = validateReviewDecision(item, { decisionKind: 'REENTRY', effectiveDate: '2026-01-10', beforeRecordId: 'before', afterRecordId: 'after', note: '' }, records)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/setelah tanggal exit/)
  })

  it('never resolves an identity conflict as a merge', () => {
    expect(validateReviewDecision(item, { decisionKind: 'IDENTITY_CONFLICT', note: '' }, records).valid).toBe(false)
  })
})
