import { type Schemas } from '../api/client'
import { dataSource } from '../config/dataSource'
import { useApiResource } from './useApiResource'

export type EmployeeDocumentGap = Schemas['EmployeeDocumentStatus']['items'][number]

/**
 * Employees whose required employee documents (Dokumen Karyawan) are not all accepted.
 * Warning only: it never blocks validation. Empty when nothing is configured as required.
 */
export function useEmployeeDocumentGaps(enabled = true) {
  const res = useApiResource<Schemas['EmployeeDocumentStatus']>('/documents/employee-status', undefined, enabled && dataSource === 'api')
  const byId = new Map((res.data?.items ?? []).map((item) => [item.employeeId, item]))
  const names = new Map((res.data?.required ?? []).map((t) => [t.code, t.name]))
  const describe = (gap: EmployeeDocumentGap) => [
    gap.missing.length ? `belum diunggah: ${gap.missing.map((c) => names.get(c) ?? c).join(', ')}` : '',
    gap.rejected.length ? `ditolak: ${gap.rejected.map((c) => names.get(c) ?? c).join(', ')}` : '',
    gap.pending.length ? `menunggu pemeriksaan: ${gap.pending.map((c) => names.get(c) ?? c).join(', ')}` : '',
  ].filter(Boolean).join(' · ')
  return { data: res.data, byId, describe, reload: res.reload }
}
