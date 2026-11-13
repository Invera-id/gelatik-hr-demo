export type DataMode = 'IMPORT_ONLY' | 'SAMPLE'

/**
 * Import-only is deliberately fail-closed. Sample data is enabled only when the
 * build explicitly opts in with VITE_DEMO_DATA_MODE=SAMPLE.
 */
export const dataMode: DataMode = import.meta.env.VITE_DEMO_DATA_MODE === 'SAMPLE'
  ? 'SAMPLE'
  : 'IMPORT_ONLY'

export const isSampleMode = dataMode === 'SAMPLE'

export const dataStorageKey = isSampleMode
  ? 'gelatik-demo-data-v2'
  : 'gelatik-import-only-data-v1'

