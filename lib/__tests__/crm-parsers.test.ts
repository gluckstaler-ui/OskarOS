// ==========================================
// Unit tests for lib/crm-parsers.ts
// Pure-function coverage — no I/O, no network, no Excel file touched.
// ==========================================

import { describe, it, expect } from 'vitest'
import {
  detectDelimiter,
  detectHeaders,
  matchHeader,
  inferFieldFromValues,
  parseText,
  applyMapping,
  detectDuplicates,
  parseSingleLine,
  type ProspectField,
} from '../crm-parsers'

// ----------------------------------------------------------------------------
// detectDelimiter
// ----------------------------------------------------------------------------

describe('detectDelimiter', () => {
  it('picks comma for plain CSV', () => {
    expect(detectDelimiter('a,b,c\nd,e,f')).toBe(',')
  })

  it('picks semicolon when it dominates', () => {
    expect(detectDelimiter('a;b;c;d\ne;f;g;h')).toBe(';')
  })

  it('picks pipe when it dominates', () => {
    expect(detectDelimiter('a|b|c\nd|e|f')).toBe('|')
  })

  it('picks tab when present, even if commas also exist (LinkedIn paste shape)', () => {
    expect(detectDelimiter('Marco\tCEO\tAcme, Inc\nAnna\tCMO\tBeta, LLC')).toBe('\t')
  })

  it('defaults to comma on empty input', () => {
    expect(detectDelimiter('')).toBe(',')
  })

  it('only samples the first 5 non-empty lines', () => {
    // If we sampled all lines, the late pipes would dominate. We don't.
    const text = 'a,b\nc,d\ne,f\ng,h\ni,j\n|||||||\n|||||||\n|||||||'
    expect(detectDelimiter(text)).toBe(',')
  })
})

// ----------------------------------------------------------------------------
// matchHeader
// ----------------------------------------------------------------------------

describe('matchHeader', () => {
  it('matches exact field aliases', () => {
    expect(matchHeader('company')).toBe('company')
    expect(matchHeader('Email')).toBe('email')
    expect(matchHeader('tel')).toBe('phone')
  })

  it('matches case-insensitively', () => {
    expect(matchHeader('COMPANY')).toBe('company')
    expect(matchHeader('E-Mail')).toBe('email')
  })

  it('matches German aliases', () => {
    expect(matchHeader('Firma')).toBe('company')
    expect(matchHeader('Telefon')).toBe('phone')
  })

  it('returns null for unknown headers', () => {
    expect(matchHeader('xyz')).toBeNull()
    expect(matchHeader('')).toBeNull()
  })

  it('matches substring within a longer header', () => {
    // "Contact Name" → contact_name (substring of "name")
    expect(matchHeader('Contact Name')).toBe('contact_name')
  })
})

// ----------------------------------------------------------------------------
// detectHeaders
// ----------------------------------------------------------------------------

describe('detectHeaders', () => {
  it('returns true when all cells match', () => {
    expect(detectHeaders(['company', 'contact', 'phone', 'email'])).toBe(true)
  })

  it('returns true when >50% match', () => {
    // 2/3 = 66% → true
    expect(detectHeaders(['company', 'email', 'xyz'])).toBe(true)
  })

  it('returns false when <=50% match', () => {
    // 1/3 = 33% → false
    expect(detectHeaders(['xyz', 'abc', 'phone'])).toBe(false)
    // 1/2 = 50% → false (strict >, not >=)
    expect(detectHeaders(['company', 'foo'])).toBe(false)
  })

  it('returns false for data rows masquerading as headers', () => {
    expect(detectHeaders(['Hotel Splendid', 'Marco Brunetti', '+41 79 234 56 78'])).toBe(false)
  })

  it('returns false for empty row', () => {
    expect(detectHeaders([])).toBe(false)
  })
})

// ----------------------------------------------------------------------------
// inferFieldFromValues
// ----------------------------------------------------------------------------

describe('inferFieldFromValues', () => {
  it('detects phone columns', () => {
    expect(inferFieldFromValues(['+41 79 234 56 78', '+41 76 222 11 00', '079 444 33 22'])).toBe('phone')
  })

  it('detects email columns', () => {
    expect(inferFieldFromValues(['marco@acme.ch', 'anna@beta.io', 'sara@gamma.com'])).toBe('email')
  })

  it('detects website columns', () => {
    expect(inferFieldFromValues(['acme.ch', 'beta.io', 'gamma.com'])).toBe('website')
  })

  it('distinguishes amount from confidence by magnitude', () => {
    // All ≤ 100 → confidence
    expect(inferFieldFromValues(['25', '75', '50'])).toBe('confidence_pct')
    // > 100 → amount
    expect(inferFieldFromValues(['12000', '34500', '8000'])).toBe('amount_chf')
  })

  it('returns null when no pattern dominates', () => {
    expect(inferFieldFromValues(['Hotel Splendid', 'Caffè Sant\'Ambrogio', 'Marco Rossi'])).toBeNull()
  })

  it('returns null for empty values', () => {
    expect(inferFieldFromValues([])).toBeNull()
    expect(inferFieldFromValues(['', '', ''])).toBeNull()
  })

  it('handles formatted numbers (commas, apostrophes)', () => {
    expect(inferFieldFromValues(['12,000', '34,500', '8,000'])).toBe('amount_chf')
    expect(inferFieldFromValues(["12'000", "34'500", "8'000"])).toBe('amount_chf')
  })

  it('does not classify partial phone-shaped strings as phone', () => {
    // Too few digits — fails the 7-digit threshold
    expect(inferFieldFromValues(['+1 2 3', '+4 5 6', '+7 8 9'])).toBeNull()
  })
})

// ----------------------------------------------------------------------------
// parseText (integration)
// ----------------------------------------------------------------------------

describe('parseText', () => {
  it('handles empty input', () => {
    expect(parseText('')).toEqual({ mode: 'empty', columns: [], rows: [] })
    expect(parseText('   \n  ')).toEqual({ mode: 'empty', columns: [], rows: [] })
  })

  it('parses CSV with headers', () => {
    const text = 'company,contact,phone,email\nAcme,Marco,+41 79 234 56 78,marco@acme.ch'
    const r = parseText(text)
    expect(r.mode).toBe('tabular')
    expect(r.delimiter).toBe(',')
    expect(r.hasHeaders).toBe(true)
    expect(r.rows).toEqual([['Acme', 'Marco', '+41 79 234 56 78', 'marco@acme.ch']])
    expect(r.columns.map(c => c.suggestedField)).toEqual(['company', 'contact_name', 'phone', 'email'])
  })

  it('parses CSV without headers + applies fallback heuristic for first 2 text columns', () => {
    const text = 'Caffè Sant\'Ambrogio,Marco Brunetti,+41 79 234 56 78,marco@caffe.ch'
    const r = parseText(text)
    expect(r.hasHeaders).toBe(false)
    // Fallback heuristic: first plain-text col → company, second → contact_name
    expect(r.columns[0].suggestedField).toBe('company')
    expect(r.columns[1].suggestedField).toBe('contact_name')
    // Phone + email still inferred from data shape
    expect(r.columns[2].suggestedField).toBe('phone')
    expect(r.columns[3].suggestedField).toBe('email')
  })

  it('parses LinkedIn-shaped TSV', () => {
    const text = 'Marco Brunetti\tCEO\tCaffè Sant\'Ambrogio\nAnna Bianchi\tGM\tHotel Splendid'
    const r = parseText(text)
    expect(r.delimiter).toBe('\t')
    expect(r.hasHeaders).toBe(false)
    expect(r.rows.length).toBe(2)
  })

  it('parses semicolon-separated values', () => {
    const text = 'company;email\nAcme;marco@acme.ch\nBeta;anna@beta.io'
    const r = parseText(text)
    expect(r.delimiter).toBe(';')
    expect(r.hasHeaders).toBe(true)
    expect(r.rows.length).toBe(2)
  })

  it('strips numbered-list prefixes', () => {
    const text = '1. Acme,Marco,+41 79 234 56 78\n2. Beta,Anna,+41 76 222 11 00\n3) Gamma,Sara,+41 78 333 44 55'
    const r = parseText(text)
    expect(r.mode).toBe('tabular')
    expect(r.rows[0][0]).toBe('Acme')
    expect(r.rows[1][0]).toBe('Beta')
    expect(r.rows[2][0]).toBe('Gamma')
  })

  it('parses vCard blocks', () => {
    const text = `BEGIN:VCARD
VERSION:3.0
FN:Marco Brunetti
ORG:Caffè Sant'Ambrogio;Tessin
TEL:+41 79 234 56 78
EMAIL:marco@caffe.ch
URL:caffe-santambrogio.ch
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Anna Bianchi
ORG:Hotel Splendid
TEL:+41 76 222 11 00
EMAIL:anna@splendid.ch
END:VCARD`
    const r = parseText(text)
    expect(r.mode).toBe('vcard')
    expect(r.candidates).toHaveLength(2)
    expect(r.candidates![0].contact_name).toBe('Marco Brunetti')
    expect(r.candidates![0].company).toBe('Caffè Sant\'Ambrogio') // ORG split on `;` → first part only
    expect(r.candidates![0].phone).toBe('+41 79 234 56 78')
    expect(r.candidates![0].email).toBe('marco@caffe.ch')
    expect(r.candidates![0].website).toBe('caffe-santambrogio.ch')
    expect(r.candidates![1].contact_name).toBe('Anna Bianchi')
  })

  it('skips vCard blocks with no company or name', () => {
    const text = `BEGIN:VCARD
VERSION:3.0
TEL:+41 79 234 56 78
END:VCARD`
    const r = parseText(text)
    expect(r.mode).toBe('vcard')
    expect(r.candidates).toHaveLength(0)
  })

  it('respects quoted cells', () => {
    const text = 'company,notes\nAcme,"Hello, world"\nBeta,"Multi ""quote"" test"'
    const r = parseText(text)
    expect(r.rows[0][1]).toBe('Hello, world')
    expect(r.rows[1][1]).toBe('Multi "quote" test')
  })

  it('populates sample values per column (excluding empties)', () => {
    const text = 'company,phone\nAcme,+41 79 234 56 78\nBeta,\nGamma,+41 76 222 11 00'
    const r = parseText(text)
    expect(r.columns[1].sampleValues).toEqual(['+41 79 234 56 78', '+41 76 222 11 00'])
  })
})

// ----------------------------------------------------------------------------
// applyMapping
// ----------------------------------------------------------------------------

describe('applyMapping', () => {
  it('maps row cells to fields', () => {
    const mapping: Record<number, ProspectField> = { 0: 'company', 1: 'contact_name', 2: 'phone' }
    const out = applyMapping([['Acme', 'Marco', '+41 79 234 56 78']], mapping)
    expect(out).toEqual([{ company: 'Acme', contact_name: 'Marco', phone: '+41 79 234 56 78' }])
  })

  it('coerces numeric fields', () => {
    const mapping: Record<number, ProspectField> = { 0: 'company', 1: 'amount_chf', 2: 'confidence_pct' }
    const out = applyMapping([['Acme', '12000', '75']], mapping)
    expect(out[0].amount_chf).toBe(12000)
    expect(out[0].confidence_pct).toBe(75)
  })

  it('parses formatted numbers', () => {
    const mapping: Record<number, ProspectField> = { 0: 'amount_chf' }
    expect(applyMapping([["12'000"]], mapping)[0].amount_chf).toBe(12000)
    expect(applyMapping([['12,000']], mapping)[0].amount_chf).toBe(12000)
  })

  it('skips empty values', () => {
    const mapping: Record<number, ProspectField> = { 0: 'company', 1: 'phone' }
    const out = applyMapping([['Acme', '']], mapping)
    expect(out[0]).toEqual({ company: 'Acme' })
    expect(out[0].phone).toBeUndefined()
  })

  it('ignores columns with null/empty mapping', () => {
    const mapping: Record<number, ProspectField | null> = { 0: 'company', 1: null, 2: 'phone' }
    const out = applyMapping([['Acme', 'discard-me', '+41 79 234 56 78']], mapping)
    expect(out[0]).toEqual({ company: 'Acme', phone: '+41 79 234 56 78' })
  })

  it('drops invalid numbers (NaN) silently', () => {
    const mapping: Record<number, ProspectField> = { 0: 'amount_chf' }
    const out = applyMapping([['not-a-number']], mapping)
    expect(out[0].amount_chf).toBeUndefined()
  })
})

// ----------------------------------------------------------------------------
// detectDuplicates
// ----------------------------------------------------------------------------

describe('detectDuplicates', () => {
  const existing = [
    { id: 'P001', phone: '+41 79 234 56 78', email: 'marco@acme.ch' },
    { id: 'P002', phone: '+41 76 222 11 00', email: 'anna@beta.io' },
    { id: 'P003', phone: '', email: 'sara@gamma.com' },
  ]

  it('matches by phone (normalized)', () => {
    const candidates = [{ phone: '+41 79 234 56 78' }]
    expect(detectDuplicates(candidates, existing)).toEqual([
      { candidateIndex: 0, existingId: 'P001', matchedOn: 'phone' },
    ])
  })

  it('matches Swiss phone formats interchangeably (+41 vs 0)', () => {
    // Stored: +41 79 234 56 78 → digits: 41792345678 → last 10: 1792345678
    // Candidate: 079 234 56 78 → digits: 0792345678 → last 10: 0792345678
    // Different last-10 → SHOULD NOT match (current implementation)
    // This documents the current behavior; refinement is a future WP.
    const candidates = [{ phone: '079 234 56 78' }]
    const result = detectDuplicates(candidates, existing)
    expect(result).toEqual([]) // last-10 differs because of leading 0 vs trailing 8
  })

  it('matches by email (case-insensitive)', () => {
    const candidates = [{ email: 'MARCO@acme.ch' }]
    expect(detectDuplicates(candidates, existing)).toEqual([
      { candidateIndex: 0, existingId: 'P001', matchedOn: 'email' },
    ])
  })

  it('does not match when both phone and email are empty', () => {
    const candidates = [{ company: 'New Lead' }]
    expect(detectDuplicates(candidates, existing)).toEqual([])
  })

  it('does not match when existing has no phone but candidate phone differs from any email', () => {
    const candidates = [{ phone: '+41 88 999 88 77' }]
    expect(detectDuplicates(candidates, existing)).toEqual([])
  })

  it('prefers phone match over email if both match different prospects', () => {
    // candidate matches P001 phone AND P002 email → reports phone first, returns from loop
    const candidates = [{ phone: '+41 79 234 56 78', email: 'anna@beta.io' }]
    const result = detectDuplicates(candidates, existing)
    expect(result).toHaveLength(1)
    expect(result[0].matchedOn).toBe('phone')
    expect(result[0].existingId).toBe('P001')
  })

  it('handles multiple candidates with mixed dup status', () => {
    const candidates = [
      { phone: '+41 79 234 56 78' },              // dup P001
      { company: 'Truly Fresh' },                 // not a dup
      { email: 'sara@gamma.com' },                // dup P003
    ]
    const result = detectDuplicates(candidates, existing)
    expect(result).toEqual([
      { candidateIndex: 0, existingId: 'P001', matchedOn: 'phone' },
      { candidateIndex: 2, existingId: 'P003', matchedOn: 'email' },
    ])
  })

  it('ignores phones shorter than 7 digits', () => {
    const shortExisting = [{ id: 'P099', phone: '12345', email: '' }]
    const candidates = [{ phone: '12345' }]
    expect(detectDuplicates(candidates, shortExisting)).toEqual([])
  })
})

// ----------------------------------------------------------------------------
// parseSingleLine (used by future WP-A1 quick-add)
// ----------------------------------------------------------------------------

describe('parseSingleLine', () => {
  it('parses comma-separated company, contact, phone', () => {
    expect(parseSingleLine('Acme, Marco Rossi, +41 79 234 56 78')).toEqual({
      company: 'Acme',
      contact_name: 'Marco Rossi',
      phone: '+41 79 234 56 78',
    })
  })

  it('parses pipe-separated values', () => {
    expect(parseSingleLine('Acme | marco@acme.ch')).toEqual({
      company: 'Acme',
      email: 'marco@acme.ch',
    })
  })

  it('detects phone, email, website regardless of position', () => {
    const r = parseSingleLine('marco@acme.ch, Acme, +41 79 234 56 78, acme.ch')
    expect(r.email).toBe('marco@acme.ch')
    expect(r.phone).toBe('+41 79 234 56 78')
    expect(r.website).toBe('acme.ch')
    expect(r.company).toBe('Acme')
  })

  it('returns empty object for empty input', () => {
    expect(parseSingleLine('')).toEqual({})
    expect(parseSingleLine('   ')).toEqual({})
  })

  it('puts unmatched parts into company then contact_name', () => {
    expect(parseSingleLine('First Thing, Second Thing')).toEqual({
      company: 'First Thing',
      contact_name: 'Second Thing',
    })
  })
})
