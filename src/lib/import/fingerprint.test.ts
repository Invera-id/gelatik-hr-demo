import { describe, expect, it } from 'vitest'
import {
  businessFingerprint,
  diffBusinessFields,
  EXIT_FIELDS,
  PLACEMENT_FIELDS,
  PROFILE_FIELDS,
  classifyFieldChange,
} from './fingerprint'

describe('businessFingerprint', () => {
  it('is identical for the same business values regardless of key order', () => {
    const a = businessFingerprint({ personnelId: 'ID-1', name: 'BUDI', position: 'SALES' })
    const b = businessFingerprint({ position: 'SALES', name: 'BUDI', personnelId: 'ID-1' })
    expect(a).toBe(b)
  })

  it('treats null, undefined and empty string as the same (absent)', () => {
    const a = businessFingerprint({ personnelId: 'ID-1', outlet: null })
    const b = businessFingerprint({ personnelId: 'ID-1', outlet: '' })
    const c = businessFingerprint({ personnelId: 'ID-1' })
    expect(a).toBe(b)
    expect(a).toBe(c)
  })

  it('differs when a business value differs', () => {
    const a = businessFingerprint({ personnelId: 'ID-1', areaCbs: 'YOGYAKARTA' })
    const b = businessFingerprint({ personnelId: 'ID-1', areaCbs: 'SOLO' })
    expect(a).not.toBe(b)
  })

  it('is an opaque token that does not embed the raw values', () => {
    const fp = businessFingerprint({ personnelId: 'ID-1', nationalId: '7371115310010944' })
    expect(fp).not.toContain('7371115310010944')
    expect(fp).not.toContain('ID-1')
    expect(fp.length).toBeLessThan(32)
  })
})

describe('diffBusinessFields', () => {
  it('lists only the fields whose normalized value differs', () => {
    const a = { personnelId: 'ID-1', areaCbs: 'YOGYAKARTA', position: 'SALES' }
    const b = { personnelId: 'ID-1', areaCbs: 'SOLO', position: 'SALES' }
    expect(diffBusinessFields(a, b)).toEqual(['areaCbs'])
  })

  it('treats empty vs absent as equal', () => {
    expect(diffBusinessFields({ outlet: '' }, { outlet: null })).toEqual([])
  })
})

describe('classifyFieldChange', () => {
  it('maps placement, exit and profile fields to their change groups', () => {
    expect(PLACEMENT_FIELDS).toContain('areaCbs')
    expect(EXIT_FIELDS).toContain('exitDate')
    expect(PROFILE_FIELDS).toContain('mobilePhone')
    expect(classifyFieldChange('areaCbs')).toBe('PLACEMENT')
    expect(classifyFieldChange('exitReason')).toBe('EXIT')
    expect(classifyFieldChange('mobilePhone')).toBe('PROFILE')
    expect(classifyFieldChange('mutationDate')).toBe('MUTATION')
  })
})
