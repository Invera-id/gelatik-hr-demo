import { useEffect, useState } from 'react'
import { errorMessage, request, type Schemas } from '../api/client'
import type { Employee, EmployeeProfile } from '../types'

export interface EmployeePageQuery {
  view: 'ALL' | 'ACTIVE'
  search: string
  areaId: string
  projectId: string
  client: string
  status: string
  page: number
  pageSize: number
}

export interface RemoteEmployeePage {
  items: Employee[]
  total: number
  loading: boolean
  error: string | null
}

/**
 * Server-side pagination, filtering and search for the employee directory.
 * Search input is debounced and superseded requests are aborted, so a slow
 * response can never overwrite a newer one. Returns null when disabled (local mode).
 */
export function useRemoteEmployeePage(enabled: boolean, query: EmployeePageQuery): RemoteEmployeePage | null {
  const [state, setState] = useState<RemoteEmployeePage>({ items: [], total: 0, loading: true, error: null })
  const { view, search, areaId, projectId, client, status, page, pageSize } = query
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, loading: true }))
      request<Schemas['EmployeePage']>('/employees', {
        signal: controller.signal,
        query: { page, pageSize, q: search.trim(), areaId, projectId, clientName: client, employmentStatus: status, tab: view === 'ACTIVE' ? 'active' : '' },
      })
        .then((res) => setState({ items: res.items.map((e) => ({ ...e, profile: (e.profile ?? {}) as EmployeeProfile, pendingChange: e.pendingChange as Employee['pendingChange'] })), total: res.total, loading: false, error: null }))
        .catch((error) => { if (!controller.signal.aborted) setState((current) => ({ ...current, loading: false, error: errorMessage(error) })) })
    }, search ? 250 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [enabled, view, search, areaId, projectId, client, status, page, pageSize])
  return enabled ? state : null
}
