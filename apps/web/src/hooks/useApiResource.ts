import { useCallback, useEffect, useState } from 'react'
import { errorMessage, request } from '../api/client'

export interface ApiResource<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * GET a server resource with loading/error state. Superseded requests are aborted so a
 * slow response never overwrites a newer one; the previous data stays visible while a
 * new request loads. Pass enabled=false to skip (local mode).
 */
export function useApiResource<T>(path: string | null, query?: Record<string, string | number | undefined>, enabled = true, version: string | number = ''): ApiResource<T> {
  const [tick, setTick] = useState(0)
  const queryKey = JSON.stringify(query ?? {})
  // version: an external change marker (e.g. an unread count) that should trigger a refetch.
  const requestKey = `${path}|${queryKey}|${tick}|${version}`
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({ key: null, data: null, error: null })
  useEffect(() => {
    if (!path || !enabled) return
    const controller = new AbortController()
    request<T>(path, { signal: controller.signal, query: JSON.parse(queryKey) as Record<string, string> })
      .then((data) => setState({ key: requestKey, data, error: null }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setState({ key: requestKey, data: null, error: errorMessage(error) })
      })
    return () => controller.abort()
  }, [path, queryKey, enabled, requestKey])
  const reload = useCallback(() => setTick((value) => value + 1), [])
  const current = state.key === requestKey
  return { data: state.data, loading: Boolean(path && enabled) && !current, error: current ? state.error : null, reload }
}
