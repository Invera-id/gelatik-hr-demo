import type { ReviewDecision, ReviewItem, SourceImportRecord } from './types'

export interface DecisionValidation {
  valid: boolean
  errors: string[]
}

export const validateReviewDecision = (
  item: ReviewItem,
  decision: ReviewDecision,
  records: SourceImportRecord[],
): DecisionValidation => {
  const errors: string[] = []
  if (decision.keepPending) return { valid: true, errors }
  if (decision.decisionKind === 'IDENTITY_CONFLICT') {
    errors.push('Konflik identitas tidak dapat diselesaikan sebagai merge tanpa kebijakan bisnis. Simpan sebagai pending.')
  }
  const needsDate = ['PLACEMENT_CHANGE', 'EXIT', 'REENTRY'].includes(decision.decisionKind)
  if (needsDate && !decision.effectiveDate) errors.push('Tanggal efektif wajib diisi untuk keputusan ini.')
  if (['PLACEMENT_CHANGE', 'REENTRY'].includes(decision.decisionKind)) {
    if (!decision.beforeRecordId || !decision.afterRecordId) errors.push('Kondisi sebelum dan sesudah wajib dipilih.')
    if (decision.beforeRecordId === decision.afterRecordId) errors.push('Kondisi sebelum dan sesudah harus berbeda.')
    if (decision.afterRecordId && !records.some((record) => record.id === decision.afterRecordId)) errors.push('Catatan kondisi sesudah tidak ditemukan.')
  }
  if (decision.decisionKind === 'PLACEMENT_CHANGE') {
    const before = records.find((record) => record.id === decision.beforeRecordId)
    const after = records.find((record) => record.id === decision.afterRecordId)
    if (before && after && ['areaCbs', 'projectName', 'position'].every((key) => before.fields[key] === after.fields[key])) {
      errors.push('Keputusan mutation harus memiliki perubahan Area, Project, atau Position.')
    }
  }
  if (decision.decisionKind === 'REENTRY' && decision.effectiveDate) {
    const exitDates = records.flatMap((record) => record.fields.exitDate ? [record.fields.exitDate] : [])
    const latestExit = exitDates.sort().at(-1)
    if (latestExit && decision.effectiveDate <= latestExit) errors.push('Tanggal re-entry harus setelah tanggal exit terakhir.')
  }
  if (decision.decisionKind === 'PROFILE_VARIATION' && decision.afterRecordId && !records.some((record) => record.id === decision.afterRecordId)) {
    errors.push('Catatan profil terpilih tidak ditemukan.')
  }
  if (!item.businessKey) errors.push('Identitas review tidak valid.')
  return { valid: errors.length === 0, errors }
}

