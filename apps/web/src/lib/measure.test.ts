import { describe, expect, it } from 'vitest'
import { measureError, measureInputValue, weightSpec } from './measure'

describe('measureError (berat badan)', () => {
  it('accepts numbers with comma or dot decimals and an optional kg unit', () => {
    for (const ok of ['60', '60.5', '60,5', '60 kg', '60,50 KG', '0,5']) expect(measureError(ok, weightSpec)).toBeNull()
  })
  it('rejects text, zero, negatives, ambiguous separators and other units', () => {
    expect(measureError('abc', weightSpec)).toContain('harus berupa angka')
    expect(measureError('enam puluh', weightSpec)).toContain('contoh: 60 atau 60,5')
    expect(measureError('-60', weightSpec)).toContain('harus berupa angka')
    expect(measureError('0', weightSpec)).toContain('lebih dari 0')
    expect(measureError('1.234', weightSpec)).toContain('ambigu')
    expect(measureError('60 lbs', weightSpec)).toContain('satuan kg')
  })
  it('treats empty input as no value, not zero', () => {
    expect(measureError('', weightSpec)).toBeNull()
    expect(measureError('   ', weightSpec)).toBeNull()
  })
  it('maps stored values back to editable text without losing unknown input', () => {
    expect(measureInputValue('60.5 kg', weightSpec)).toBe('60.5')
    expect(measureInputValue('abc', weightSpec)).toBe('abc')
    expect(measureInputValue(null, weightSpec)).toBe('')
  })
})
