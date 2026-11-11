import type { ComparisonFilters, ComparisonRow, ComparisonSnapshot, Dimensions, FinanceTarget, QualityCount, SourceGroup, SyntheticActual } from './types'

export const RULE_VERSION = 'finance-comparison-demo-1.1-date'
export const groups: readonly SourceGroup[] = ['GELATIK', 'BTB']
export const bucketKey = (value: Dimensions) => JSON.stringify([value.sourceGroup, value.areaCBS, value.client, value.project])
const normalizeId = (value: string) => value.replace(/\s+/g, ' ').trim().toUpperCase()
const validDate = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const dimensions = (value: Dimensions): Dimensions => ({ sourceGroup: value.sourceGroup, areaCBS: value.areaCBS, client: value.client, project: value.project })
const mapped = (value: Dimensions) => !!(value.sourceGroup && value.areaCBS?.trim() && value.client?.trim() && value.project?.trim())

function evaluateTarget(target: FinanceTarget | undefined, date: string): Omit<ComparisonRow, keyof Dimensions | 'id' | 'observedActual' | 'actualComparable' | 'gap' | 'rate'> {
  const effective = target?.effectiveDate ?? (target?.effectiveDateSource === 'APPROVAL_DATE_FALLBACK' ? target.approvalDate : null)
  const base = {
    targetValue: target?.targetValue ?? null, mappingStatus: target?.mappingStatus ?? 'MAPPED' as const,
    effectiveDate: effective ?? null, effectiveDateSource: target?.effectiveDateSource ?? 'UNKNOWN' as const,
    isProvisional: target?.isProvisional === true || target?.effectiveDateSource === 'APPROVAL_DATE_FALLBACK',
  }
  if (target && (target.mappingStatus !== 'MAPPED' || !mapped(target))) return { ...base, mappingStatus: target.mappingStatus === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'UNMAPPED', status: target.mappingStatus === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'UNMAPPED', contractStatus: 'UNKNOWN', reason: 'Pemetaan Finance–HR belum disetujui.' }
  if (!target) return { ...base, status: 'TARGET_UNKNOWN', contractStatus: 'UNKNOWN', reason: 'HR aktif tanpa target Finance yang diketahui; bukan target nol.' }
  if (target.approvalStatus !== 'APPROVED' || !validDate(target.approvalDate)) return { ...base, status: 'TARGET_REQUIRES_REVIEW', contractStatus: 'UNKNOWN', reason: 'Persetujuan target belum memiliki evidence sintetis yang lengkap.' }
  if (!validDate(target.contractStartDate) || !validDate(target.contractEndDate) || target.contractStartDate >= target.contractEndDate || !validDate(effective)) return { ...base, status: 'TARGET_REQUIRES_REVIEW', contractStatus: 'UNKNOWN', reason: 'Tanggal efektif atau masa kontrak belum dapat dibuktikan.' }
  if (date >= target.contractEndDate) return { ...base, status: 'CONTRACT_EXPIRED', contractStatus: 'EXPIRED', reason: 'Kontrak berakhir. Actual tersisa tidak otomatis menjadi surplus.' }
  if (date < target.approvalDate) return { ...base, status: 'TARGET_NOT_EFFECTIVE', contractStatus: date < target.contractStartDate ? 'FUTURE' : 'ACTIVE', reason: 'Persetujuan target belum berlaku pada snapshot demo.' }
  if (date < target.contractStartDate || date < effective) return { ...base, status: 'TARGET_NOT_EFFECTIVE', contractStatus: date < target.contractStartDate ? 'FUTURE' : 'ACTIVE', reason: 'Target belum berlaku pada tanggal snapshot.' }
  if (target.targetValue === null) return { ...base, status: 'TARGET_UNKNOWN', contractStatus: 'ACTIVE', reason: 'Nilai target belum diisi (NULL), berbeda dari explicit 0.' }
  if (!Number.isSafeInteger(target.targetValue) || target.targetValue < 0 || target.targetUnit !== 'MANPOWER_ALLOCATION') return { ...base, status: 'TARGET_REQUIRES_REVIEW', contractStatus: 'ACTIVE', reason: 'Nilai atau satuan target belum valid.' }
  return { ...base, status: 'MAPPED', contractStatus: 'ACTIVE', reason: 'Comparable; alokasi manpower dan distinct Actual dari evidence sintetis.' }
}

/** Pure DATE evaluator. Identity checks run globally BEFORE any view filter. */
export function calculateComparison(targets: readonly FinanceTarget[], actuals: readonly SyntheticActual[], date: string) {
  if (!validDate(date)) throw new Error('Tanggal snapshot tidak valid.')
  const rowMap = new Map<string, ComparisonRow>()
  const targetKeys = new Set<string>()
  for (const target of targets) {
    const key = bucketKey(target)
    if (targetKeys.has(key)) throw new Error('Target bucket berulang; versioning memerlukan review, bukan penjumlahan otomatis.')
    targetKeys.add(key)
    rowMap.set(key, { ...dimensions(target), id: target.id, ...evaluateTarget(target, date), observedActual: 0, actualComparable: null, gap: null, rate: null })
  }
  const identities = new Map<string, SyntheticActual[]>()
  for (const actual of actuals) {
    const id = normalizeId(actual.personnelId)
    // Fixture IDs are required; production missing-ID resolution is not simulated.
    if (!id) throw new Error('Evidence Actual memerlukan Personnel ID sintetis.')
    identities.set(id, [...(identities.get(id) ?? []), actual])
  }
  const quality: QualityCount[] = []
  const comparableCounts = new Map<string, number>()
  for (const records of identities.values()) {
    const invalid = records.some((record) => record.episodes.length === 0 || record.episodes.some((episode, index) => !validDate(episode.joinDate) || (episode.exitDate !== null && (!validDate(episode.exitDate) || episode.exitDate <= episode.joinDate)) || (index > 0 && (!record.episodes[index - 1].exitDate || episode.joinDate <= record.episodes[index - 1].exitDate!))))
    const active = records.filter((record) => record.episodes.some((episode) => episode.joinDate <= date && (!episode.exitDate || date < episode.exitDate)))
    const candidates = [...new Map((invalid ? records : active).map((record) => [bucketKey(record), dimensions(record)])).values()]
    if (!invalid && !active.length) continue
    const unresolvedGroup = candidates.some((value) => !value.sourceGroup) || new Set(candidates.map((value) => value.sourceGroup)).size > 1
    // Conflicting duplicate evidence (including active vs inactive) is not last-row-wins.
    const inconsistentEpisodes = new Set(records.map((record) => JSON.stringify(record.episodes))).size > 1
    if (invalid || inconsistentEpisodes || candidates.length > 1 || active.some((record) => !record.confirmed || record.mappingStatus === 'NEEDS_REVIEW')) {
      quality.push({ category: 'NEEDS_REVIEW', count: 1, candidates, unresolvedGroup })
      continue
    }
    const actual = active[0]
    const assignmentUnmapped = !mapped(actual) || active.some((record) => record.mappingStatus !== 'MAPPED')
    const key = bucketKey(actual)
    let row = rowMap.get(key)
    if (!row) {
      row = { ...dimensions(actual), id: `actual:${key}`, ...evaluateTarget(undefined, date), observedActual: 0, actualComparable: null, gap: null, rate: null }
      rowMap.set(key, row)
    }
    row.observedActual++
    let category: QualityCount['category']
    if (assignmentUnmapped || row.mappingStatus !== 'MAPPED') {
      category = 'UNMAPPED'
      if (row.status === 'MAPPED' && targetKeys.has(key)) {
        // Keep one budget bucket. Unknown assignment evidence is observed but
        // excluded from its comparable numerator, regardless of input order.
        row.reason = 'Sebagian assignment belum terpetakan; Actual comparable hanya memakai identitas terkonfirmasi.'
      } else {
        row.status = row.mappingStatus === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW' : 'UNMAPPED'
        row.mappingStatus = row.status
        row.reason = 'Aktif terbukti, tetapi bucket/Group belum dapat dipetakan untuk comparison.'
      }
    } else if (row.contractStatus === 'EXPIRED') {
      category = 'EXPIRED'
      row.status = 'EXPIRED_CONTRACT_REMAINING_ACTUAL'
    } else category = row.status === 'MAPPED' ? 'COMPARABLE' : 'OTHER_NONCOMPARABLE'
    if (category === 'COMPARABLE') comparableCounts.set(key, (comparableCounts.get(key) ?? 0) + 1)
    quality.push({ category, count: 1, candidates, unresolvedGroup })
  }
  const rows = [...rowMap.values()].map((row): ComparisonRow => row.status === 'MAPPED' ? {
    ...row, actualComparable: comparableCounts.get(bucketKey(row)) ?? 0, gap: row.targetValue! - (comparableCounts.get(bucketKey(row)) ?? 0),
    rate: row.targetValue! > 0 ? (comparableCounts.get(bucketKey(row)) ?? 0) / row.targetValue! * 100 : null,
  } : row)
  return { rows, quality }
}

export function matchesFilters(value: Dimensions, filters: ComparisonFilters): boolean {
  return (!filters.sourceGroup || value.sourceGroup === filters.sourceGroup) && (!filters.areaCBS || value.areaCBS === filters.areaCBS) && (!filters.client || value.client === filters.client) && (!filters.project || value.project === filters.project)
}

/** Scope gates all candidate placements; an ambiguous issue must not leak other areas. */
export function selectSnapshot(snapshot: ComparisonSnapshot, filters: ComparisonFilters, allowedAreas: readonly string[] | null = null) {
  const inScope = (value: Dimensions) => allowedAreas === null || !!(value.areaCBS && allowedAreas.includes(value.areaCBS))
  return {
    rows: snapshot.rows.filter((row) => inScope(row) && matchesFilters(row, filters)),
    quality: snapshot.quality.filter((entry) => entry.candidates.every(inScope) && entry.candidates.some((candidate) => matchesFilters(candidate, filters))),
  }
}

export function summarizeGroup(rows: readonly ComparisonRow[], group: SourceGroup) {
  const selected = rows.filter((row) => row.sourceGroup === group)
  const comparable = selected.filter((row) => row.status === 'MAPPED')
  const target = comparable.length ? comparable.reduce((sum, row) => sum + row.targetValue!, 0) : null
  const actual = comparable.length ? comparable.reduce((sum, row) => sum + row.actualComparable!, 0) : null
  return { group, target, actual, gap: target !== null && actual !== null ? target - actual : null, rate: target !== null && target > 0 ? actual! / target * 100 : null, comparableBuckets: comparable.length, totalBuckets: selected.length }
}

export function summarizeQuality(rows: readonly ComparisonRow[], quality: readonly QualityCount[]) {
  const count = (category: QualityCount['category']) => quality.filter((entry) => entry.category === category).reduce((sum, entry) => sum + entry.count, 0)
  return {
    comparable: count('COMPARABLE'), unmapped: count('UNMAPPED'), needsReview: count('NEEDS_REVIEW'), expired: count('EXPIRED'), otherNoncomparable: count('OTHER_NONCOMPARABLE'),
    unresolvedGroup: quality.filter((entry) => entry.unresolvedGroup).reduce((sum, entry) => sum + entry.count, 0),
    targetUnknownBuckets: rows.filter((row) => row.status === 'TARGET_UNKNOWN').length,
    comparableBuckets: rows.filter((row) => row.status === 'MAPPED').length, totalBuckets: rows.length,
  }
}

export function freezeSnapshot(snapshot: ComparisonSnapshot): ComparisonSnapshot {
  const copy = JSON.parse(JSON.stringify(snapshot)) as ComparisonSnapshot
  const freeze = (value: object) => {
    Object.values(value).forEach((child) => { if (child && typeof child === 'object') freeze(child) })
    Object.freeze(value)
  }
  freeze(copy)
  return copy
}

export const formatSnapshotDate = (date: string) => new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'long' }).format(new Date(`${date}T00:00:00+07:00`))
export const formatGeneratedAt = (timestamp: string) => `${new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))} WIB`
