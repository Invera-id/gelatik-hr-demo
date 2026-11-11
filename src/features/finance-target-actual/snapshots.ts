import { freezeSnapshot } from './calculations'
import type { ComparisonRow, ComparisonSnapshot, Dimensions, QualityCount } from './types'

/**
 * Materialized, authored demo history. Deliberately NOT calculated from fixtures
 * at read time or startup. Changing the evaluator/source fixtures does not rewrite
 * these results. Tests reconcile this frozen evidence with the current rule.
 * Values and labels are synthetic; these are not employee database snapshots.
 */
const storedDimensions = {
  core: { sourceGroup: 'GELATIK', areaCBS: 'Bandung', client: 'Client Simulasi A', project: 'Project Nusa (Simulasi)' },
  zero: { sourceGroup: 'GELATIK', areaCBS: 'Bandung', client: 'Client Simulasi A', project: 'Project Nol (Simulasi)' },
  unknown: { sourceGroup: 'GELATIK', areaCBS: 'Jakarta', client: 'Client Simulasi B', project: 'Project Budget Belum Diisi' },
  expired: { sourceGroup: 'GELATIK', areaCBS: 'Jakarta', client: 'Client Simulasi B', project: 'Project Kontrak Berakhir' },
  unmapped: { sourceGroup: 'GELATIK', areaCBS: 'Bandung', client: 'Client Simulasi C', project: 'Project Belum Dipetakan' },
  review: { sourceGroup: 'GELATIK', areaCBS: 'Bandung', client: 'Client Simulasi C', project: 'Project Mapping Ambigu' },
  future: { sourceGroup: 'GELATIK', areaCBS: 'Jakarta', client: 'Client Simulasi B', project: 'Project Mendatang' },
  fallback: { sourceGroup: 'GELATIK', areaCBS: 'Jakarta', client: 'Client Simulasi B', project: 'Project Tambahan (Provisional)' },
  btb: { sourceGroup: 'BTB', areaCBS: 'Jakarta', client: 'Client Simulasi D', project: 'Project BTB (Simulasi)' },
  noTarget: { sourceGroup: 'BTB', areaCBS: 'Bandung', client: 'Client Simulasi D', project: 'Project Tanpa Target' },
  noArea: { sourceGroup: 'GELATIK', areaCBS: null, client: 'Client Simulasi A', project: null },
  noGroup: { sourceGroup: null, areaCBS: 'Bandung', client: 'Client Simulasi A', project: 'Project Nusa (Simulasi)' },
} as const satisfies Record<string, Dimensions>

type Bucket = keyof typeof storedDimensions
function storedRow(id: Bucket, targetValue: number | null, observedActual: number, status: ComparisonRow['status'] = 'MAPPED', overrides: Partial<ComparisonRow> = {}): ComparisonRow {
  const comparable = status === 'MAPPED'
  return {
    ...storedDimensions[id], id, targetValue, observedActual, status,
    actualComparable: comparable ? observedActual : null,
    gap: comparable ? targetValue! - observedActual : null,
    rate: comparable && targetValue !== null && targetValue > 0 ? observedActual / targetValue * 100 : null,
    mappingStatus: status === 'UNMAPPED' ? 'UNMAPPED' : status === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'MAPPED',
    contractStatus: 'ACTIVE', effectiveDate: '2026-01-01', effectiveDateSource: 'EXPLICIT', isProvisional: false,
    reason: comparable ? 'Comparable; evidence sintetis, bukan angka resmi perusahaan.' : status === 'TARGET_UNKNOWN' ? 'Target belum diketahui; bukan nol.' : status === 'TARGET_NOT_EFFECTIVE' ? 'Target belum berlaku pada snapshot.' : status === 'EXPIRED_CONTRACT_REMAINING_ACTUAL' ? 'Kontrak berakhir; HR Actual masih aktif. Gap/rate tidak berlaku.' : 'Pemetaan belum disetujui; tidak masuk KPI comparable.',
    ...overrides,
  }
}

function quality(category: QualityCount['category'], count: number, buckets: Bucket[], unresolvedGroup = false): QualityCount {
  return { category, count, candidates: buckets.map((bucket) => storedDimensions[bucket]), unresolvedGroup }
}

// Independently recorded results (not a query over current source state).
const materializedDates = [
  { date: '2026-11-15', nusa: 10, tambahan: 0 },
  { date: '2026-11-20', nusa: 9, tambahan: 1 },
  { date: '2026-11-25', nusa: 10, tambahan: 1 },
] as const

export const demoSnapshots: readonly ComparisonSnapshot[] = Object.freeze(materializedDates.map(({ date, nusa, tambahan }) => freezeSnapshot({
  id: `simulation-${date}-v1`, snapshotDate: date, generatedAt: `${date}T12:00:00+07:00`,
  timezone: 'Asia/Jakarta', resolution: 'DATE', ruleVersion: 'finance-comparison-demo-1.1-date',
  sourceRevision: 'synthetic-evidence-v1', sourceGroups: ['GELATIK', 'BTB'],
  rows: [
    storedRow('core', 10, nusa), storedRow('zero', 0, 2), storedRow('unknown', null, 1, 'TARGET_UNKNOWN'),
    storedRow('expired', 4, 2, 'EXPIRED_CONTRACT_REMAINING_ACTUAL', { contractStatus: 'EXPIRED' }),
    storedRow('unmapped', 3, 1, 'UNMAPPED', { contractStatus: 'UNKNOWN' }),
    storedRow('review', 2, 0, 'NEEDS_REVIEW', { contractStatus: 'UNKNOWN' }),
    storedRow('future', 3, 0, 'TARGET_NOT_EFFECTIVE', { effectiveDate: '2026-12-01' }),
    storedRow('fallback', 2, tambahan, tambahan ? 'MAPPED' : 'TARGET_NOT_EFFECTIVE', { effectiveDate: '2026-11-18', effectiveDateSource: 'APPROVAL_DATE_FALLBACK', isProvisional: true }),
    storedRow('btb', 4, 5), storedRow('noTarget', null, 1, 'TARGET_UNKNOWN', { contractStatus: 'UNKNOWN', effectiveDate: null, effectiveDateSource: 'UNKNOWN' }),
    storedRow('noArea', null, 1, 'UNMAPPED', { contractStatus: 'UNKNOWN', effectiveDate: null, effectiveDateSource: 'UNKNOWN' }),
    storedRow('noGroup', null, 1, 'UNMAPPED', { contractStatus: 'UNKNOWN', effectiveDate: null, effectiveDateSource: 'UNKNOWN' }),
  ],
  quality: [
    quality('COMPARABLE', nusa, ['core']), quality('COMPARABLE', 2, ['zero']), quality('COMPARABLE', 5, ['btb']),
    ...(tambahan ? [quality('COMPARABLE', tambahan, ['fallback'])] : []),
    quality('OTHER_NONCOMPARABLE', 1, ['unknown']), quality('OTHER_NONCOMPARABLE', 1, ['noTarget']),
    quality('EXPIRED', 2, ['expired']), quality('UNMAPPED', 1, ['unmapped']), quality('UNMAPPED', 1, ['noArea']), quality('UNMAPPED', 1, ['noGroup'], true),
    quality('NEEDS_REVIEW', 1, ['core', 'btb'], true), quality('NEEDS_REVIEW', 1, ['core']),
  ],
})))

export const findDemoSnapshot = (date: string) => demoSnapshots.find((snapshot) => snapshot.snapshotDate === date)
