import type { Area, Employee, EmploymentStatus, Project } from '../types'

export const importColumns = ['personnel_id', 'name', 'area', 'project', 'position', 'join_date', 'employment_status', 'contract_end_date', 'bpjs_status'] as const
export type ImportRowStatus = 'VALID' | 'WARNING' | 'ERROR'
export type DuplicateDecision = 'SKIP' | 'UPDATE'

export interface ImportedEmployeeFields {
  personnelId: string
  name: string
  areaId: string
  projectId: string
  position: string
  joinDate: string
  employmentStatus: EmploymentStatus
  contractEndDate: string | null
  bpjsStatus: 'NOT_REGISTERED' | 'IN_PROCESS' | 'ACTIVE'
}

export interface EmployeeImportRow {
  rowNumber: number
  status: ImportRowStatus
  messages: string[]
  values: Record<(typeof importColumns)[number], string>
  fields: ImportedEmployeeFields | null
  duplicateEmployeeId: string | null
  decision: DuplicateDecision
}

export interface EmployeeImportPreview { headerErrors: string[]; rows: EmployeeImportRow[] }

const normalize = (value: unknown) => String(value ?? '').trim()
const normalizeHeader = (value: unknown) => normalize(value).toLowerCase().replaceAll(' ', '_')
const toIsoDate = (value: unknown) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const text = normalize(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

export const parseEmployeeImport = (sheetRows: unknown[][], employees: Employee[], areas: Area[], projects: Project[]): EmployeeImportPreview => {
  if (!sheetRows.length) return { headerErrors: ['File tidak memiliki baris header.'], rows: [] }
  const headers = sheetRows[0].map(normalizeHeader)
  const headerErrors = importColumns.filter((column) => !headers.includes(column)).map((column) => `Kolom wajib tidak ditemukan: ${column}`)
  if (headerErrors.length) return { headerErrors, rows: [] }
  const rows = sheetRows.slice(1).filter((row) => row.some((cell) => normalize(cell))).map((row, index): EmployeeImportRow => {
    const values = Object.fromEntries(importColumns.map((column) => [column, normalize(row[headers.indexOf(column)])])) as EmployeeImportRow['values']
    const messages: string[] = []
    const duplicate = employees.find((employee) => employee.personnelId.toLowerCase() === values.personnel_id.toLowerCase())
    const area = areas.find((item) => item.id.toLowerCase() === values.area.toLowerCase() || item.name.toLowerCase() === values.area.toLowerCase())
    const project = projects.find((item) => item.id.toLowerCase() === values.project.toLowerCase() || item.name.toLowerCase() === values.project.toLowerCase())
    const joinDate = toIsoDate(row[headers.indexOf('join_date')])
    const contractEndDate = toIsoDate(row[headers.indexOf('contract_end_date')])
    const employmentStatus = values.employment_status.toUpperCase()
    const bpjsStatus = values.bpjs_status.toUpperCase()
    if (!values.personnel_id) messages.push('Personnel ID wajib diisi.')
    if (!values.name) messages.push('Nama wajib diisi.')
    if (!area) messages.push(values.area ? `Area tidak dikenal: ${values.area}.` : 'Area wajib diisi.')
    if (!values.project) messages.push('Project wajib diisi.')
    else if (!project) messages.push(`Project tidak dikenal: ${values.project}.`)
    else if (area && project.areaId !== area.id) messages.push('Project tidak berada pada Area yang dipilih.')
    if (!values.position) messages.push('Position wajib diisi.')
    if (!joinDate) messages.push('Join date wajib dalam format YYYY-MM-DD.')
    if (!['ACTIVE', 'INACTIVE'].includes(employmentStatus)) messages.push('Employment status harus ACTIVE atau INACTIVE.')
    if (!['NOT_REGISTERED', 'IN_PROCESS', 'ACTIVE'].includes(bpjsStatus)) messages.push('BPJS status harus NOT_REGISTERED, IN_PROCESS, atau ACTIVE.')
    if (values.contract_end_date && !contractEndDate) messages.push('Contract end date harus dalam format YYYY-MM-DD.')
    if (duplicate) messages.push(`Personnel ID sudah digunakan oleh ${duplicate.name}; pilih Skip atau Update.`)
    const hardErrors = messages.filter((message) => !message.includes('sudah digunakan'))
    const fields = hardErrors.length || !area || !project || !joinDate || !['ACTIVE', 'INACTIVE'].includes(employmentStatus) || !['NOT_REGISTERED', 'IN_PROCESS', 'ACTIVE'].includes(bpjsStatus) ? null : { personnelId: values.personnel_id, name: values.name, areaId: area.id, projectId: project.id, position: values.position, joinDate, employmentStatus: employmentStatus as EmploymentStatus, contractEndDate: contractEndDate || null, bpjsStatus: bpjsStatus as ImportedEmployeeFields['bpjsStatus'] }
    return { rowNumber: index + 2, status: hardErrors.length ? 'ERROR' : duplicate ? 'WARNING' : 'VALID', messages, values, fields, duplicateEmployeeId: duplicate?.id ?? null, decision: 'SKIP' }
  })
  return { headerErrors, rows }
}
