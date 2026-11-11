import { describe, expect, it } from 'vitest'
import { calculateComparison, formatGeneratedAt, formatSnapshotDate, freezeSnapshot, selectSnapshot, summarizeGroup, summarizeQuality } from './calculations'
import { createSyntheticSources, demoEvidenceDates, syntheticBuckets } from './fixtures'
import { demoSnapshots, findDemoSnapshot } from './snapshots'
import type { FinanceTarget, SyntheticActual } from './types'

const date = '2026-11-20'
const target = (overrides: Partial<FinanceTarget> = {}): FinanceTarget => ({ ...createSyntheticSources().targets[0], ...overrides })
const actual = (id = 'SYN-1', overrides: Partial<SyntheticActual> = {}): SyntheticActual => ({ ...syntheticBuckets.core, personnelId: id, confirmed: true, mappingStatus: 'MAPPED', episodes: [{ joinDate: '2026-01-01', exitDate: null }], ...overrides })
const count = (n: number) => Array.from({ length: n }, (_, i) => actual(`SYN-${i}`))

describe('isolated Finance comparison DATE calculations', () => {
  it.each([[9, 1, 90], [10, 0, 100], [12, -2, 120]])('target 10 and Actual %i => gap %i / rate %i', (people, gap, rate) => {
    const { rows } = calculateComparison([target()], count(people), date)
    expect(rows[0]).toMatchObject({ actualComparable: people, gap, rate })
  })

  it('keeps NULL unknown rather than manufacturing gap zero or surplus', () => {
    expect(calculateComparison([target({ targetValue: null })], count(2), date).rows[0]).toMatchObject({ targetValue: null, actualComparable: null, gap: null, rate: null, observedActual: 2, status: 'TARGET_UNKNOWN' })
  })

  it('explicit 0 can produce negative gap, but denominator 0 means rate N/A', () => {
    expect(calculateComparison([target({ targetValue: 0 })], count(2), date).rows[0]).toMatchObject({ targetValue: 0, actualComparable: 2, gap: -2, rate: null })
    expect(summarizeGroup(calculateComparison([target({ targetValue: 0 })], [], date).rows, 'GELATIK')).toMatchObject({ target: 0, actual: 0, gap: 0, rate: null })
  })

  it('normalizes synthetic Personnel IDs and counts identical duplicates only once', () => {
    const result = calculateComparison([target()], [actual(' syn-001 '), actual('SYN-001'), actual(' SYN-001 ')], date)
    expect(result.rows[0].actualComparable).toBe(1)
    expect(summarizeQuality(result.rows, result.quality).comparable).toBe(1)
  })

  it('conflicting buckets are Needs Review once, before applying a bucket filter', () => {
    const result = calculateComparison([target()], [actual(), actual('SYN-1', syntheticBuckets.btb)], date)
    expect(result.quality).toHaveLength(1)
    expect(result.quality[0]).toMatchObject({ category: 'NEEDS_REVIEW', count: 1, unresolvedGroup: true })
    expect(result.rows[0].actualComparable).toBe(0)
    const selected = selectSnapshot({ ...demoSnapshots[0], ...result }, { sourceGroup: 'GELATIK', project: syntheticBuckets.core.project })
    expect(summarizeQuality(selected.rows, selected.quality).needsReview).toBe(1)
    expect(summarizeGroup(selected.rows, 'GELATIK').actual).toBe(0)
  })

  it('does not allocate unknown Group to Gelatik or BTB', () => {
    const result = calculateComparison([], [actual('SYN-UNKNOWN-GROUP', { sourceGroup: null })], date)
    expect(result.quality[0]).toMatchObject({ category: 'UNMAPPED', unresolvedGroup: true })
    for (const group of ['GELATIK', 'BTB'] as const) expect(summarizeGroup(result.rows, group)).toMatchObject({ target: null, actual: null, gap: null, rate: null })
  })

  it('keeps Group numerators/denominators separate, not a combined official total', () => {
    const result = calculateComparison([target(), target({ ...syntheticBuckets.btb, id: 'btb', targetValue: 4 })], [...count(9), actual('SYN-BTB', syntheticBuckets.btb)], date)
    expect(summarizeGroup(result.rows, 'GELATIK')).toMatchObject({ target: 10, actual: 9, gap: 1 })
    expect(summarizeGroup(result.rows, 'BTB')).toMatchObject({ target: 4, actual: 1, gap: 3 })
  })

  it('expired remaining Actual has no gap/rate and is not lost from observation', () => {
    const result = calculateComparison([target({ contractEndDate: '2026-11-20' })], count(2), date)
    expect(result.rows[0]).toMatchObject({ observedActual: 2, actualComparable: null, gap: null, rate: null, status: 'EXPIRED_CONTRACT_REMAINING_ACTUAL' })
    expect(summarizeQuality(result.rows, result.quality)).toMatchObject({ expired: 2, comparable: 0 })
  })

  it('future join excluded, future exit retained, effective exit excluded', () => {
    const records = [
      actual('SYN-FUTURE-JOIN', { episodes: [{ joinDate: '2026-11-21', exitDate: null }] }),
      actual('SYN-FUTURE-EXIT', { episodes: [{ joinDate: '2026-01-01', exitDate: '2026-11-21' }] }),
      actual('SYN-TODAY-EXIT', { episodes: [{ joinDate: '2026-01-01', exitDate: date }] }),
    ]
    expect(calculateComparison([target()], records, date).rows[0].actualComparable).toBe(1)
  })

  it('old exit does not close a later re-entry episode', () => {
    const person = actual('SYN-REENTRY', { episodes: [{ joinDate: '2026-01-01', exitDate: '2026-10-01' }, { joinDate: '2026-11-01', exitDate: null }] })
    expect(calculateComparison([target()], [person], date).rows[0].actualComparable).toBe(1)
    expect(calculateComparison([target()], [person], '2026-10-20').rows[0].actualComparable).toBe(0)
  })

  it('invalid/overlapping or conflicting episode evidence goes to review without fake dates', () => {
    const result = calculateComparison([target()], [actual('SYN-BAD', { episodes: [{ joinDate: '2026-02-30', exitDate: null }] }), actual('SYN-OVERLAP', { episodes: [{ joinDate: '2026-01-01', exitDate: null }, { joinDate: '2026-11-01', exitDate: null }] })], date)
    expect(summarizeQuality(result.rows, result.quality)).toMatchObject({ needsReview: 2, comparable: 0 })
  })

  it('fallback is explicit, provisional and based on approval, never import time', () => {
    const fallback = target({ effectiveDate: null, approvalDate: date, effectiveDateSource: 'APPROVAL_DATE_FALLBACK', isProvisional: true })
    expect(calculateComparison([fallback], count(1), date).rows[0]).toMatchObject({ effectiveDate: date, effectiveDateSource: 'APPROVAL_DATE_FALLBACK', isProvisional: true, status: 'MAPPED' })
    expect(calculateComparison([fallback], count(1), '2026-11-19').rows[0].gap).toBeNull()
    expect(calculateComparison([target({ effectiveDate: null, approvalDate: null })], count(1), date).rows[0].status).toBe('TARGET_REQUIRES_REVIEW')
    expect(calculateComparison([target({ approvalDate: '2026-11-21' })], count(1), date).rows[0].actualComparable).toBeNull()
  })

  it.each([{ contractEndDate: null }, { effectiveDate: '2026-12-01' }, { mappingStatus: 'NEEDS_REVIEW' as const }, { targetValue: -1 }, { approvalStatus: 'NEEDS_REVIEW' as const }, { approvalDate: null }])('noncomparable target excluded from rate: %o', (overrides) => {
    const result = calculateComparison([target(overrides)], count(2), date)
    expect(result.rows[0].gap).toBeNull()
    expect(summarizeGroup(result.rows, 'GELATIK').actual).toBeNull()
  })

  it('keeps active missing dimensions and actual without target visible, not allocated randomly', () => {
    const result = calculateComparison([], [actual('SYN-NO-AREA', { areaCBS: null }), actual('SYN-NO-PROJECT', { project: null }), actual('SYN-NO-TARGET')], date)
    expect(result.rows).toHaveLength(3)
    expect(result.rows.reduce((sum, row) => sum + row.observedActual, 0)).toBe(3)
    expect(summarizeQuality(result.rows, result.quality)).toMatchObject({ unmapped: 2, otherNoncomparable: 1, comparable: 0, targetUnknownBuckets: 1 })
  })

  it('unproven assignments never inflate comparable Actual or depend on input order', () => {
    const confirmed = actual('SYN-CONFIRMED')
    const unproven = actual('SYN-UNPROVEN', { mappingStatus: 'UNMAPPED' })
    for (const records of [[confirmed, unproven], [unproven, confirmed]]) {
      const result = calculateComparison([target()], records, date)
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].observedActual).toBe(2)
      expect(summarizeGroup(result.rows, 'GELATIK')).toMatchObject({ actual: 1, gap: 9 })
      expect(summarizeQuality(result.rows, result.quality)).toMatchObject({ comparable: 1, unmapped: 1 })
    }
  })

  it('never sums repeated target buckets or silently accepts missing IDs', () => {
    expect(() => calculateComparison([target(), target({ id: 'duplicate' })], [], date)).toThrow(/bucket berulang/)
    expect(() => calculateComparison([], [actual(' ')], date)).toThrow(/Personnel ID/)
    expect(() => calculateComparison([], [], '2026-02-30')).toThrow(/tidak valid/)
  })
})

describe('frozen demo snapshots and filtered coverage', () => {
  it.each([['2026-11-15', 10, 0], ['2026-11-20', 9, 1], ['2026-11-25', 10, 0]])('Nusa snapshot %s => Actual %i, gap %i', (date, actual, gap) => {
    const row = findDemoSnapshot(date)!.rows.find((row) => row.id === 'core')!
    expect(row).toMatchObject({ targetValue: 10, actualComparable: actual, gap })
  })

  it('frozen history is independently materialized and matches evaluator evidence on all supported dates', () => {
    const source = createSyntheticSources()
    for (const date of demoEvidenceDates) {
      const computed = calculateComparison(source.targets, source.actuals, date)
      const stored = findDemoSnapshot(date)!
      const normalizeRows = (rows: typeof computed.rows | typeof stored.rows) => rows.map((row) => ({ ...row, id: '', reason: '' })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      expect(normalizeRows(stored.rows)).toEqual(normalizeRows(computed.rows))
      expect(summarizeQuality(stored.rows, stored.quality)).toEqual(summarizeQuality(computed.rows, computed.quality))
    }
  })

  it('20 November stays 9/+1 after 25 November and after changing source fixtures/rules', () => {
    const source = createSyntheticSources()
    const before = JSON.stringify(findDemoSnapshot('2026-11-20'))
    source.targets[0].targetValue = 999
    source.actuals.length = 0
    calculateComparison(source.targets, source.actuals, '2026-11-25')
    expect(findDemoSnapshot('2026-11-25')!.rows[0].actualComparable).toBe(10)
    expect(JSON.stringify(findDemoSnapshot('2026-11-20'))).toBe(before)
    expect(Object.isFrozen(findDemoSnapshot('2026-11-20')!.rows[0])).toBe(true)
    expect(Reflect.set(findDemoSnapshot('2026-11-20')!.rows[0], 'gap', 123)).toBe(false)
  })

  it('capture makes a defensive deep copy including quality candidates and labels', () => {
    const input = JSON.parse(JSON.stringify(demoSnapshots[1]))
    const captured = freezeSnapshot(input)
    input.rows[0].project = 'Changed demo label'
    input.quality[0].candidates[0].project = 'Changed candidate'
    expect(captured.rows[0].project).toBe(syntheticBuckets.core.project)
    expect(captured.quality[0].candidates[0].project).toBe(syntheticBuckets.core.project)
  })

  it('unsupported dates do not fabricate history; resolution is DATE not intraday', () => {
    expect(findDemoSnapshot('2026-11-21')).toBeUndefined()
    expect(findDemoSnapshot('2026-11-20T12:00:00+07:00')).toBeUndefined()
    for (const stored of demoSnapshots) {
      expect(stored.resolution).toBe('DATE')
      expect(stored.timezone).toBe('Asia/Jakarta')
      expect(stored.generatedAt).toMatch(/\+07:00$/)
      expect(stored.ruleVersion).toBe('finance-comparison-demo-1.1-date')
      expect(JSON.stringify(stored)).not.toContain('personnelId')
    }
    expect(formatSnapshotDate('2026-11-20')).toContain('20 November 2026')
    expect(formatGeneratedAt('2026-11-20T05:00:00Z')).toContain('12.00 WIB')
  })

  it('group/project filtering uses equal bucket populations for all KPIs', () => {
    const selected = selectSnapshot(demoSnapshots[1], { sourceGroup: 'GELATIK', areaCBS: 'Bandung', client: syntheticBuckets.core.client, project: syntheticBuckets.core.project })
    expect(selected.rows).toHaveLength(1)
    expect(summarizeGroup(selected.rows, 'GELATIK')).toMatchObject({ target: 10, actual: 9, gap: 1, rate: 90, comparableBuckets: 1, totalBuckets: 1 })
    expect(summarizeQuality(selected.rows, selected.quality)).toMatchObject({ comparable: 9, needsReview: 2 })
  })

  it('quality identity partitions reconcile; unresolved Group is a subset not extra people', () => {
    const source = createSyntheticSources()
    const { rows, quality } = calculateComparison(source.targets, source.actuals, date)
    const totals = summarizeQuality(rows, quality)
    expect(totals).toMatchObject({ comparable: 17, unmapped: 3, expired: 2, otherNoncomparable: 2, needsReview: 2, unresolvedGroup: 2 })
    expect(quality.reduce((sum, item) => sum + item.count, 0)).toBe(26)
    expect(rows.reduce((sum, row) => sum + row.observedActual, 0)).toBe(24)
    expect(rows.filter((row) => row.status === 'MAPPED').reduce((sum, row) => sum + row.actualComparable!, 0)).toBe(totals.comparable)
  })

  it('scope excludes unknown-area records and cross-area review candidates in detail/history', () => {
    const result = selectSnapshot(demoSnapshots[1], {}, ['Bandung'])
    expect(result.rows.every((row) => row.areaCBS === 'Bandung')).toBe(true)
    expect(result.quality.every((item) => item.candidates.every((candidate) => candidate.areaCBS === 'Bandung'))).toBe(true)
    expect(summarizeQuality(result.rows, result.quality).needsReview).toBe(1)
    expect(selectSnapshot(demoSnapshots[1], {}, []).rows).toHaveLength(0)
  })
})
