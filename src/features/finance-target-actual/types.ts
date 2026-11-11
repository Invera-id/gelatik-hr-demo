export type SourceGroup = 'GELATIK' | 'BTB'
export type MappingStatus = 'MAPPED' | 'UNMAPPED' | 'NEEDS_REVIEW'
export type ComparisonStatus = MappingStatus | 'TARGET_UNKNOWN' | 'TARGET_NOT_EFFECTIVE' | 'TARGET_REQUIRES_REVIEW' | 'EXPIRED_CONTRACT_REMAINING_ACTUAL' | 'CONTRACT_EXPIRED'

export interface Dimensions {
  sourceGroup: SourceGroup | null
  areaCBS: string | null
  client: string | null
  project: string | null
}

export interface FinanceTarget extends Dimensions {
  id: string
  sourceGroup: SourceGroup
  targetValue: number | null
  targetUnit: 'MANPOWER_ALLOCATION'
  mappingStatus: MappingStatus
  contractStartDate: string | null
  // Demo interval [start, end): the end date itself is excluded.
  contractEndDate: string | null
  effectiveDate: string | null
  effectiveDateSource: 'EXPLICIT' | 'APPROVAL_DATE_FALLBACK' | 'UNKNOWN'
  approvalDate: string | null
  approvalStatus: 'APPROVED' | 'NEEDS_REVIEW'
  isProvisional: boolean
  gmr?: string
}

export interface SyntheticActual extends Dimensions {
  personnelId: string
  mappingStatus: MappingStatus
  confirmed: boolean
  // Explicit synthetic employment + assignment evidence, never current HR master.
  episodes: readonly { joinDate: string; exitDate: string | null }[]
}

export interface ComparisonRow extends Dimensions {
  id: string
  targetValue: number | null
  observedActual: number
  actualComparable: number | null
  gap: number | null
  rate: number | null
  mappingStatus: MappingStatus
  status: ComparisonStatus
  contractStatus: 'ACTIVE' | 'EXPIRED' | 'FUTURE' | 'UNKNOWN'
  effectiveDate: string | null
  effectiveDateSource: FinanceTarget['effectiveDateSource']
  isProvisional: boolean
  reason: string
}

export type QualityCategory = 'COMPARABLE' | 'UNMAPPED' | 'NEEDS_REVIEW' | 'EXPIRED' | 'OTHER_NONCOMPARABLE'
export interface QualityCount {
  category: QualityCategory
  count: number
  unresolvedGroup: boolean
  // Conflicts retain all candidate buckets, not an arbitrarily chosen placement.
  candidates: readonly Dimensions[]
}

export interface ComparisonSnapshot {
  id: string
  snapshotDate: string
  generatedAt: string
  timezone: 'Asia/Jakarta'
  resolution: 'DATE'
  ruleVersion: string
  sourceRevision: string
  sourceGroups: readonly SourceGroup[]
  rows: readonly ComparisonRow[]
  quality: readonly QualityCount[]
}

export interface ComparisonFilters {
  sourceGroup?: SourceGroup | ''
  areaCBS?: string
  client?: string
  project?: string
}
