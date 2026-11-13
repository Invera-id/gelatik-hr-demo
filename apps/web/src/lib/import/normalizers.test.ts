import { describe, expect, it } from 'vitest'
import {
  normalizeBoolean,
  normalizeDate,
  normalizeGender,
  normalizeIdentifier,
  normalizeMeasure,
  normalizeRtRw,
  normalizeScore,
  normalizeStatusCode,
  normalizeText,
  parseTenureMonths,
} from './normalizers'

describe('normalizeText', () => {
  it('maps blank-like tokens to null but keeps 0', () => {
    expect(normalizeText('')).toBeNull()
    expect(normalizeText('   ')).toBeNull()
    expect(normalizeText('-')).toBeNull()
    expect(normalizeText('Tidak berlaku')).toBeNull()
    expect(normalizeText(0)).toBe('0')
  })
  it('keeps business tokens when whitelisted', () => {
    expect(normalizeText('N/A')).toBeNull()
    expect(normalizeText('N/A', new Set(['n/a']))).toBe('N/A')
  })
})

describe('normalizeIdentifier', () => {
  it('preserves leading zeros and long digit strings as text', () => {
    expect(normalizeIdentifier('002').value).toBe('002')
    expect(normalizeIdentifier('ID-KR000944').value).toBe('ID-KR000944')
    expect(normalizeIdentifier('7371115310010944').value).toBe('7371115310010944')
  })
  it('never emits scientific notation for numeric input', () => {
    expect(normalizeIdentifier(1280010009).value).toBe('1280010009')
  })
  it('flags masked identifiers', () => {
    const out = normalizeIdentifier('0821xxxx0944')
    expect(out.value).toBe('0821xxxx0944')
    expect(out.masked).toBe(true)
  })
  it('maps dash to null', () => {
    expect(normalizeIdentifier('-').value).toBeNull()
  })
})

describe('normalizeRtRw', () => {
  it('pads clearly numeric values to three digits', () => {
    expect(normalizeRtRw(2)).toBe('002')
    expect(normalizeRtRw('2')).toBe('002')
    expect(normalizeRtRw('002')).toBe('002')
  })
  it('keeps non-numeric values untouched', () => {
    expect(normalizeRtRw('00A')).toBe('00A')
  })
})

describe('normalizeDate', () => {
  it('formats Date objects as date-only without timezone shift', () => {
    expect(normalizeDate(new Date('2001-10-13T00:00:00.000Z')).value).toBe('2001-10-13')
  })
  it('reads Excel 1900 serials', () => {
    // 2010-07-05 is serial 40364 in the 1900 system.
    expect(normalizeDate(40364).value).toBe('2010-07-05')
  })
  it('reads Excel 1904 serials when flagged', () => {
    // 1904-01-01 is serial 0 in the 1904 system; day 1 => 1904-01-02.
    expect(normalizeDate(1, true).value).toBe('1904-01-02')
  })
  it('parses month-name formats', () => {
    expect(normalizeDate('21-Oct-00').value).toBe('2000-10-21')
    expect(normalizeDate('9-Sep-26').value).toBe('2026-09-09')
  })
  it('parses numeric slash as day/month/year', () => {
    expect(normalizeDate('09/09/2026').value).toBe('2026-09-09')
    expect(normalizeDate('13/10/2001').value).toBe('2001-10-13')
  })
  it('parses ISO', () => {
    expect(normalizeDate('2026-09-09').value).toBe('2026-09-09')
  })
  it('applies two-digit year rule', () => {
    expect(normalizeDate('01/01/49').value).toBe('2049-01-01')
    expect(normalizeDate('01/01/50').value).toBe('1950-01-01')
  })
  it('rejects impossible dates with invalid flag, never rolls over', () => {
    const out = normalizeDate('31-Feb-26')
    expect(out.value).toBeNull()
    expect(out.invalid).toBe(true)
  })
  it('treats dash as empty, not epoch', () => {
    expect(normalizeDate('-')).toEqual({ value: null, invalid: false })
  })
})

describe('normalizeScore', () => {
  it('keeps 65 and 65/100 distinct', () => {
    expect(normalizeScore(65).result).toEqual({ raw: '65', score: 65, maxScore: null, percentage: null })
    expect(normalizeScore('65/100').result).toEqual({ raw: '65/100', score: 65, maxScore: 100, percentage: 65 })
    expect(normalizeScore(' 65 / 100 ').result).toEqual({ raw: '65 / 100', score: 65, maxScore: 100, percentage: 65 })
  })
  it('keeps 0 as 0', () => {
    expect(normalizeScore(0).result.score).toBe(0)
  })
  it('maps dash to null score', () => {
    expect(normalizeScore('-').result.score).toBeNull()
  })
  it('warns on zero denominator', () => {
    const out = normalizeScore('65/0')
    expect(out.result.maxScore).toBeNull()
    expect(out.warning).toMatch(/penyebut/i)
  })
  it('warns when score exceeds max', () => {
    expect(normalizeScore('120/100').warning).toMatch(/melebihi/i)
  })
})

describe('normalizeMeasure', () => {
  it('keeps bare numbers in default unit', () => {
    expect(normalizeMeasure(160, 'height').result.value).toBe(160)
    expect(normalizeMeasure('50', 'weight').result.value).toBe(50)
  })
  it('strips recognized same-unit suffixes', () => {
    expect(normalizeMeasure('160 cm', 'height').result.value).toBe(160)
    expect(normalizeMeasure('50 kg', 'weight').result.value).toBe(50)
  })
  it('converts explicit units', () => {
    expect(normalizeMeasure('1,60 m', 'height').result.value).toBe(160)
    expect(normalizeMeasure('50000 g', 'weight').result.value).toBe(50)
  })
  it('warns on unknown units', () => {
    expect(normalizeMeasure('5 stone', 'weight').warning).toMatch(/satuan tidak dikenal/i)
  })
})

describe('normalizeBoolean', () => {
  it('maps YA/TIDAK without inverting meaning', () => {
    expect(normalizeBoolean('YA').result).toBe(true)
    expect(normalizeBoolean('TIDAK').result).toBe(false)
  })
  it('maps empty and dash to null', () => {
    expect(normalizeBoolean('').result).toBeNull()
    expect(normalizeBoolean('-').result).toBeNull()
  })
  it('warns on unknown values', () => {
    expect(normalizeBoolean('kadang').warning).toBeTruthy()
  })
})

describe('normalizeStatusCode', () => {
  it('canonicalizes known codes', () => {
    expect(normalizeStatusCode('r/p').result).toBe('R/P')
    expect(normalizeStatusCode('r / p').result).toBe('R/P')
    expect(normalizeStatusCode('n/a').result).toBe('N/A')
  })
  it('keeps N/A as a valid business code (not null)', () => {
    expect(normalizeStatusCode('N/A').result).toBe('N/A')
  })
  it('keeps unknown codes raw with a warning', () => {
    const out = normalizeStatusCode('KONTRAK')
    expect(out.result).toBe('KONTRAK')
    expect(out.warning).toBeTruthy()
  })
})

describe('normalizeGender', () => {
  it('normalizes clear variants', () => {
    expect(normalizeGender('LAKI-LAKI')).toBe('Laki-laki')
    expect(normalizeGender('p')).toBe('Perempuan')
  })
})

describe('parseTenureMonths', () => {
  it('parses tahun/bulan', () => {
    expect(parseTenureMonths('3 tahun 8 bulan')).toBe(44)
    expect(parseTenureMonths('0 tahun 0 bulan')).toBe(0)
  })
  it('returns null for dash', () => {
    expect(parseTenureMonths('-')).toBeNull()
  })
})
