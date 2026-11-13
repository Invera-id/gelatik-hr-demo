export type DataSource = 'api' | 'local'

/**
 * `api` (default): the Go/PostgreSQL backend is the only source of business data.
 * `local`: the original browser-only prototype (localStorage + IndexedDB), enabled
 * only with an explicit VITE_DATA_SOURCE=local build. The two never mix.
 */
export const dataSource: DataSource = import.meta.env.VITE_DATA_SOURCE === 'local' ? 'local' : 'api'
