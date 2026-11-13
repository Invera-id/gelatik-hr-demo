import { describe, expect, it } from 'vitest'
import { classifyGroup, type ClassifyRecord } from './classify'
import { businessFingerprint } from './fingerprint'

let seq = 0
const rec = (fields: Record<string, string | null>, rowNumber = ++seq): ClassifyRecord => ({
  id: `r-${rowNumber}-${businessFingerprint(fields)}`,
  fingerprint: businessFingerprint(fields),
  rowNumber,
  fields: { personnelId: 'ID-X', name: 'PERSONIL CONTOH', ...fields },
})

describe('classifyGroup', () => {
  it('(1) treats same ID + identical business data (only No differs) as one duplicate, no event', () => {
    // No is not a mapped field, so two rows that differ only by No share a fingerprint.
    const a = rec({ areaCbs: 'SOLO', position: 'SALES' })
    const b = rec({ areaCbs: 'SOLO', position: 'SALES' })
    const result = classifyGroup([a, b])
    expect(result.distinctCount).toBe(1)
    expect(result.needsReview).toBe(false)
    expect(result.aspects).toHaveLength(0)
    expect(result.autoConfirmable).toBeNull()
    expect(result.primaryKind).toBe('IDENTICAL_DUPLICATE')
  })

  it('(2) driver case: area differs, same mutation date, one has exit → movement + exit candidates, pending', () => {
    const a = rec({ areaCbs: 'YOGYAKARTA', subArea: 'SOLO', mutationDate: '2026-09-07' })
    const b = rec({ areaCbs: 'SOLO', subArea: 'SOLO', mutationDate: '2026-09-07', exitDate: '2026-09-07', exitReason: 'PINDAH KOTA/NEGARA' })
    const result = classifyGroup([a, b])
    expect(result.distinctCount).toBe(2)
    expect(result.aspects.map((x) => x.kind).sort()).toEqual(['EXIT', 'PLACEMENT_CHANGE'])
    expect(result.needsReview).toBe(true)
    expect(result.autoConfirmable).toBeNull()
  })

  it('(3) swapping record order does not change the classification', () => {
    const a = rec({ areaCbs: 'YOGYAKARTA', mutationDate: '2026-09-07' })
    const b = rec({ areaCbs: 'SOLO', mutationDate: '2026-09-07', exitDate: '2026-09-07' })
    const forward = classifyGroup([a, b])
    const backward = classifyGroup([b, a])
    expect(backward.aspects.map((x) => x.kind).sort()).toEqual(forward.aspects.map((x) => x.kind).sort())
    expect(backward.needsReview).toBe(forward.needsReview)
    expect(backward.primaryKind).toBe(forward.primaryKind)
  })

  it('(4) placement change with clear before/after (one row carries the mutation date) auto-confirms', () => {
    const before = rec({ areaCbs: 'MAKASSAR', position: 'SALES' })
    const after = rec({ areaCbs: 'BANDUNG', position: 'SALES', mutationDate: '2026-03-01' })
    const result = classifyGroup([before, after])
    expect(result.autoConfirmable).not.toBeNull()
    expect(result.autoConfirmable?.effectiveDate).toBe('2026-03-01')
    expect(result.autoConfirmable?.movementType).toBe('AREA_CHANGE')
    expect(result.autoConfirmable?.beforeRecordId).toBe(before.id)
    expect(result.autoConfirmable?.afterRecordId).toBe(after.id)
    expect(result.needsReview).toBe(false)
  })

  it('(5) phone-only difference is a profile variation, not a movement', () => {
    const a = rec({ areaCbs: 'SOLO', mobilePhone: '081200000001' })
    const b = rec({ areaCbs: 'SOLO', mobilePhone: '081200000002' })
    const result = classifyGroup([a, b])
    expect(result.aspects.map((x) => x.kind)).toEqual(['PROFILE_VARIATION'])
    expect(result.needsReview).toBe(true)
    expect(result.autoConfirmable).toBeNull()
  })

  it('(6/2) an exit date surfaces an EXIT aspect for the reviewer (scope not inferred)', () => {
    const a = rec({ areaCbs: 'SOLO' })
    const b = rec({ areaCbs: 'SOLO', exitDate: '2026-09-07', exitReason: 'SELESAI PROJECT' })
    const result = classifyGroup([a, b])
    expect(result.aspects.some((x) => x.kind === 'EXIT')).toBe(true)
    expect(result.autoConfirmable).toBeNull() // exit is never auto-resolved
  })

  it('(8) exit then a later join is a re-entry candidate', () => {
    const a = rec({ joinDate: '2021-01-01', exitDate: '2023-06-30', exitReason: 'RESIGN' })
    const b = rec({ joinDate: '2024-02-01' })
    const result = classifyGroup([a, b])
    expect(result.aspects.some((x) => x.kind === 'REENTRY')).toBe(true)
  })

  it('(9) the same join date on several rows is NOT a re-entry', () => {
    const a = rec({ joinDate: '2021-01-01', position: 'SALES' })
    const b = rec({ joinDate: '2021-01-01', position: 'TEAM LEADER' })
    const result = classifyGroup([a, b])
    expect(result.aspects.some((x) => x.kind === 'REENTRY')).toBe(false)
  })

  it('(10) same ID with two different complete NoKTP is an identity conflict', () => {
    const a = rec({ nationalId: '3374010101900001' })
    const b = rec({ nationalId: '3374010101900002' })
    const result = classifyGroup([a, b])
    expect(result.identityConflict).toBe(true)
    expect(result.primaryKind).toBe('IDENTITY_CONFLICT')
    expect(result.needsReview).toBe(true)
  })

  it('(11) a masked / incomplete NoKTP is not treated as a certain conflict', () => {
    const a = rec({ nationalId: '3374010101900001' })
    const b = rec({ nationalId: '337401xxxxxx0002' })
    const result = classifyGroup([a, b])
    expect(result.identityConflict).toBe(false)
  })
})
