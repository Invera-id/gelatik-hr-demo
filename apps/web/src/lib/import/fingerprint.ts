/**
 * Deterministic content fingerprint + business-field diff for personnel source rows.
 *
 * The fingerprint is derived ONLY from normalized business values. It never
 * includes the running "No", the Excel row number, the import time, the file
 * name, or the sheet order (§6, §12). The returned token is opaque — it embeds
 * none of the raw values, so it is safe to show in logs and the UI as a dedupe
 * key without leaking personal data.
 */

/** Fields whose change implies a placement movement (area/project/position). */
export const PLACEMENT_FIELDS = [
  'areaCbs',
  'subArea',
  'clientName',
  'projectName',
  'position',
  'teamLeader',
  'outlet',
  'coverageArea',
  'program',
] as const

/** Fields that describe an exit / end. */
export const EXIT_FIELDS = ['exitDate', 'exitReason'] as const

/** The single field that marks a mutation effective date. */
export const MUTATION_FIELDS = ['mutationDate'] as const

/** Employment/contract dates used for re-entry detection (not placement, not profile). */
export const EMPLOYMENT_FIELDS = ['joinDate', 'contractStartDate', 'contractEndDate'] as const

/** Identity fields (same within a group; different complete NoKTP ⇒ conflict). */
export const IDENTITY_FIELDS = ['personnelId', 'name', 'nationalId'] as const

export type FieldChangeGroup = 'PLACEMENT' | 'EXIT' | 'MUTATION' | 'EMPLOYMENT' | 'IDENTITY' | 'PROFILE'

/** Which change group a business field belongs to (everything else is PROFILE). */
export const classifyFieldChange = (field: string): FieldChangeGroup => {
  if ((PLACEMENT_FIELDS as readonly string[]).includes(field)) return 'PLACEMENT'
  if ((EXIT_FIELDS as readonly string[]).includes(field)) return 'EXIT'
  if ((MUTATION_FIELDS as readonly string[]).includes(field)) return 'MUTATION'
  if ((EMPLOYMENT_FIELDS as readonly string[]).includes(field)) return 'EMPLOYMENT'
  if ((IDENTITY_FIELDS as readonly string[]).includes(field)) return 'IDENTITY'
  return 'PROFILE'
}

/** Profile fields = every mapped business field that is not in another group. Kept as a helper list for tests/UI. */
export const PROFILE_FIELDS = [
  'birthPlace', 'birthDate', 'gender', 'ktpAddress', 'ktpRt', 'ktpRw', 'ktpKelurahan', 'ktpKecamatan',
  'ktpCity', 'ktpProvince', 'ktpPostalCode', 'religion', 'domicileAddress', 'domicileRt', 'domicileRw',
  'domicileKelurahan', 'domicileKecamatan', 'domicileCity', 'domicileProvince', 'domicilePostalCode',
  'maritalStatus', 'education', 'homePhone', 'mobilePhone', 'email', 'initialDepositDate',
  'bankAccountNumber', 'bankAccountName', 'taxId', 'jamsostekNumber', 'bpjsHealthNumber', 'motherName',
  'motherNationalId', 'penalty', 'academicScore', 'personalityScore', 'basicAbilityScore', 'logicScore',
  'height', 'weight', 'employeeStatus', 'warningLetter', 'companyName', 'tenureLabel',
] as const

/** Canonicalize a single value so null / undefined / "" / untrimmed all compare equal. */
const canon = (value: string | number | boolean | null | undefined): string => {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/** Build a stable, sorted canonical string of the business values. */
const canonicalString = (fields: Record<string, string | number | boolean | null | undefined>): string => {
  const keys = Object.keys(fields).filter((key) => canon(fields[key]) !== '').sort()
  return keys.map((key) => `${key}=${canon(fields[key])}`).join('')
}

/** FNV-1a 32-bit hash → base36. Deterministic and short; collision risk is negligible for demo scale. */
const hash = (input: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Opaque business-content fingerprint. Same business values ⇒ same token. */
export const businessFingerprint = (
  fields: Record<string, string | number | boolean | null | undefined>,
): string => hash(canonicalString(fields))

/** The set of business fields whose normalized value differs between two records. */
export const diffBusinessFields = (
  a: Record<string, string | null | undefined>,
  b: Record<string, string | null | undefined>,
): string[] => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const changed: string[] = []
  for (const key of keys) {
    if (canon(a[key]) !== canon(b[key])) changed.push(key)
  }
  return changed.sort()
}
