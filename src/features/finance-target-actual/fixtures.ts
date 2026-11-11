import type { Dimensions, FinanceTarget, SyntheticActual } from './types'

// All labels and keys below are synthetic. No employee workbook is used.
export const demoEvidenceDates = ['2026-11-15', '2026-11-20', '2026-11-25'] as const
export const syntheticBuckets = {
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
  noGroup: { sourceGroup: null, areaCBS: 'Bandung', client: 'Client Simulasi A', project: 'Project Nusa (Simulasi)' },
  noArea: { sourceGroup: 'GELATIK', areaCBS: null, client: 'Client Simulasi A', project: null },
} as const satisfies Record<string, Dimensions>

export function createSyntheticSources(): { targets: FinanceTarget[]; actuals: SyntheticActual[] } {
  const target = (id: keyof typeof syntheticBuckets, targetValue: number | null, overrides: Partial<FinanceTarget> = {}): FinanceTarget => ({
    ...syntheticBuckets[id], sourceGroup: syntheticBuckets[id].sourceGroup ?? 'GELATIK', id,
    targetValue, targetUnit: 'MANPOWER_ALLOCATION', mappingStatus: 'MAPPED',
    contractStartDate: '2026-01-01', contractEndDate: '2027-01-01', effectiveDate: '2026-01-01',
    effectiveDateSource: 'EXPLICIT', approvalDate: '2026-01-01', approvalStatus: 'APPROVED', isProvisional: false,
    gmr: 'GMR Simulasi — informasi saja', ...overrides,
  })
  const actual = (personnelId: string, bucket: keyof typeof syntheticBuckets, overrides: Partial<SyntheticActual> = {}): SyntheticActual => ({
    ...syntheticBuckets[bucket], personnelId, mappingStatus: 'MAPPED', confirmed: true,
    episodes: [{ joinDate: '2026-01-01', exitDate: null }], ...overrides,
  })
  const core = Array.from({ length: 9 }, (_, index) => actual(`SYN-NUSA-${index + 1}`, 'core'))
  core[0].episodes = [{ joinDate: '2026-01-01', exitDate: '2026-10-01' }, { joinDate: '2026-11-01', exitDate: null }]
  return {
    targets: [
      target('core', 10), target('zero', 0), target('unknown', null),
      target('expired', 4, { contractEndDate: '2026-11-10' }),
      target('unmapped', 3, { mappingStatus: 'UNMAPPED' }),
      target('review', 2, { mappingStatus: 'NEEDS_REVIEW' }),
      target('future', 3, { effectiveDate: '2026-12-01' }),
      target('fallback', 2, { effectiveDate: null, approvalDate: '2026-11-18', effectiveDateSource: 'APPROVAL_DATE_FALLBACK', isProvisional: true }),
      target('btb', 4),
    ],
    actuals: [
      ...core,
      actual(' syn-nusa-2 ', 'core'), // Same normalized identity, same evidence: count once.
      actual('SYN-EXIT', 'core', { episodes: [{ joinDate: '2026-01-01', exitDate: '2026-11-20' }] }),
      actual('SYN-REPLACEMENT', 'core', { episodes: [{ joinDate: '2026-11-25', exitDate: null }] }),
      ...Array.from({ length: 2 }, (_, i) => actual(`SYN-ZERO-${i}`, 'zero')),
      actual('SYN-UNKNOWN', 'unknown'),
      ...Array.from({ length: 2 }, (_, i) => actual(`SYN-EXPIRED-${i}`, 'expired')),
      actual('SYN-UNMAPPED', 'unmapped', { mappingStatus: 'UNMAPPED' }),
      actual('SYN-NO-AREA', 'noArea', { mappingStatus: 'UNMAPPED' }),
      actual('SYN-NO-GROUP', 'noGroup', { mappingStatus: 'UNMAPPED' }),
      actual('SYN-FALLBACK', 'fallback', { episodes: [{ joinDate: '2026-11-18', exitDate: null }] }),
      ...Array.from({ length: 5 }, (_, i) => actual(`SYN-BTB-${i}`, 'btb')),
      actual('SYN-NO-TARGET', 'noTarget'),
      actual('SYN-CONFLICT', 'core'), actual(' syn-conflict ', 'btb'),
      actual('SYN-PENDING', 'core', { confirmed: false }),
    ],
  }
}
