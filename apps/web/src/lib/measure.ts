/**
 * Client-side mirror of the server rule (apps/api/internal/domain/measure.go) for
 * immediate feedback only; the server stays the authority.
 * Accepted: "60", "60.5", "60,5", "60 kg". Max 2 decimals, > 0. Empty = no value (never 0).
 */
export interface MeasureSpec { label: string; unit: 'kg' | 'cm'; hint: string }

export const weightSpec: MeasureSpec = { label: 'Berat badan', unit: 'kg', hint: '60 atau 60,5' }
export const heightSpec: MeasureSpec = { label: 'Tinggi badan', unit: 'cm', hint: '165 atau 165,5' }

const pattern = /^(\d+)(?:[.,](\d+))?\s*([A-Za-z]+)?$/

/** Returns an error message, or null when the input is valid or empty. */
export function measureError(raw: string, spec: MeasureSpec): string | null {
  const text = raw.trim()
  if (!text) return null
  const match = pattern.exec(text)
  if (!match) return `${spec.label} harus berupa angka dalam ${spec.unit}, contoh: ${spec.hint}.`
  if (match[3] && match[3].toLowerCase() !== spec.unit) return `Gunakan satuan ${spec.unit} untuk ${spec.label.toLowerCase()}, contoh: ${spec.hint}.`
  if ((match[2] ?? '').length > 2) return `Format angka ambigu: gunakan paling banyak 2 angka desimal, contoh: ${spec.hint}.`
  if (!/[1-9]/.test(`${match[1]}${match[2] ?? ''}`)) return `${spec.label} harus lebih dari 0 ${spec.unit}.`
  return null
}

/** Stored profile text ("60.5 kg") → editable form text ("60.5"); unrecognized text is kept as-is. */
export function measureInputValue(stored: string | null | undefined, spec: MeasureSpec): string {
  if (!stored) return ''
  const match = new RegExp(`^([\\d.,]+)\\s*${spec.unit}$`, 'i').exec(stored.trim())
  return match ? match[1] : stored
}
