export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple'

export const validationTone = (status: string): BadgeTone => status === 'VALIDATED' ? 'success' : status === 'SUBMITTED' ? 'info' : status === 'REVISION_REQUIRED' ? 'danger' : 'neutral'
export const replacementTone = (status: string): BadgeTone => status === 'FULFILLED' ? 'success' : status === 'OVER_TARGET' ? 'danger' : status === 'MATCHED' ? 'purple' : 'warning'

