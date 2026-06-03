// ==========================================
// CRM parsers — bulk-paste + quick-add intake
// Pure functions, no side effects. Used by:
//   - app/api/admin/crm/parse/route.ts (B-track bulk modal)
//   - lib/crm-store.ts (when A1 quick-add lands, via parseSingleLine)
// ==========================================

import type { Prospect } from './crm-store'

export type ProspectField = keyof Prospect

/** Known header aliases per schema field. Case-insensitive substring match. */
const FIELD_ALIASES: Partial<Record<ProspectField, string[]>> = {
  company: ['company', 'firm', 'organization', 'org', 'business', 'firma'],
  contact_name: ['contact', 'contact_name', 'contact name', 'name', 'person', 'lead', 'first name', 'last name'],
  phone: ['phone', 'tel', 'telephone', 'mobile', 'cell', 'telefon'],
  email: ['email', 'e-mail', 'mail'],
  website: ['website', 'url', 'site', 'web', 'homepage'],
  amount_chf: ['amount', 'value', 'chf', 'budget', 'deal', 'deal size'],
  confidence_pct: ['confidence', 'probability', 'score'],
  notes: ['notes', 'comment', 'description', 'remark'],
  tags: ['tags', 'categories', 'labels', 'segments'],
}

export type Delimiter = ',' | '\t' | ';' | '|'

/** Pick delimiter by counting occurrences in first 5 non-empty lines. Tabs win when present (LinkedIn paste). */
export function detectDelimiter(text: string): Delimiter {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 5)
  const counts: Record<Delimiter, number> = { ',': 0, '\t': 0, ';': 0, '|': 0 }
  for (const line of lines) {
    counts[','] += (line.match(/,/g) || []).length
    counts['\t'] += (line.match(/\t/g) || []).length
    counts[';'] += (line.match(/;/g) || []).length
    counts['|'] += (line.match(/\|/g) || []).length
  }
  if (counts['\t'] > 0) return '\t'
  let best: Delimiter = ','
  let bestN = counts[',']
  for (const d of [';', '|'] as Delimiter[]) {
    if (counts[d] > bestN) { best = d; bestN = counts[d] }
  }
  return best
}

/** Split a single line on delimiter, respecting double-quoted cells. */
function splitLine(line: string, delimiter: Delimiter): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (c === delimiter && !inQuotes) {
      cells.push(current.trim())
      current = ''
    } else {
      current += c
    }
  }
  cells.push(current.trim())
  return cells
}

/** Match a header cell against known field aliases. Returns the field or null. */
export function matchHeader(cell: string): ProspectField | null {
  const lower = cell.toLowerCase().trim()
  if (!lower) return null
  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [ProspectField, string[]][]) {
    for (const alias of aliases) {
      if (lower === alias || lower.includes(alias)) return field
    }
  }
  return null
}

/** Header row if >50% of cells match known schema fields. */
export function detectHeaders(firstRow: string[]): boolean {
  if (firstRow.length === 0) return false
  let matched = 0
  for (const cell of firstRow) {
    if (matchHeader(cell)) matched++
  }
  return matched / firstRow.length > 0.5
}

const PHONE_RE = /^[+\d][\d\s\-().]{6,}$/
const EMAIL_RE = /^[\w.+\-]+@[\w.\-]+\.\w+$/
const TLD_RE = /\.(ch|com|io|net|org|de|it|fr|at|uk|app|co|eu)\b/i
const NUMBER_RE = /^\d+(\.\d+)?$/

/** Infer a likely field for a column based on its sample values. Returns null when nothing dominates. */
export function inferFieldFromValues(values: string[]): ProspectField | null {
  const nonEmpty = values.filter(v => v.trim()).slice(0, 10)
  if (nonEmpty.length === 0) return null

  const isPhone = (v: string) => PHONE_RE.test(v) && (v.match(/\d/g) || []).length >= 7
  const isEmail = (v: string) => EMAIL_RE.test(v)
  const isWebsite = (v: string) => TLD_RE.test(v) && !v.includes('@')
  const isNumber = (v: string) => NUMBER_RE.test(v.replace(/[,'\s]/g, ''))

  const score = {
    phone: nonEmpty.filter(isPhone).length / nonEmpty.length,
    email: nonEmpty.filter(isEmail).length / nonEmpty.length,
    website: nonEmpty.filter(isWebsite).length / nonEmpty.length,
    number: nonEmpty.filter(isNumber).length / nonEmpty.length,
  }
  if (score.email >= 0.7) return 'email'
  if (score.phone >= 0.7) return 'phone'
  if (score.website >= 0.7) return 'website'
  if (score.number >= 0.7) {
    // Disambiguate by magnitude: confidence 0–100, amounts typically larger.
    const nums = nonEmpty.map(v => Number(v.replace(/[,'\s]/g, ''))).filter(n => !isNaN(n))
    const max = nums.length ? Math.max(...nums) : 0
    return max > 100 ? 'amount_chf' : 'confidence_pct'
  }
  return null
}

export interface ParsedColumn {
  index: number
  headerText: string | null
  suggestedField: ProspectField | null
  sampleValues: string[]
}

export interface ParseResult {
  mode: 'tabular' | 'vcard' | 'empty'
  delimiter?: Delimiter
  hasHeaders?: boolean
  columns: ParsedColumn[]
  rows: string[][]
  /** Pre-mapped prospect candidates — populated for vCard mode (no user mapping needed). */
  candidates?: Partial<Prospect>[]
}

/** Top-level: detect mode (vCard vs tabular), delimiter, headers, columns, samples. */
export function parseText(text: string): ParseResult {
  const trimmed = text.trim()
  if (!trimmed) return { mode: 'empty', columns: [], rows: [] }

  if (/BEGIN:VCARD/i.test(trimmed)) {
    return parseVCardBlock(trimmed)
  }

  // Strip numbered-list prefixes (`1. `, `2) `) — common from email/notes copy-paste.
  const stripped = trimmed
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*\d+[.)]\s+/, ''))
    .join('\n')

  const delimiter = detectDelimiter(stripped)
  const lines = stripped.split(/\r?\n/).filter(l => l.trim())
  const allRows = lines.map(l => splitLine(l, delimiter))
  if (allRows.length === 0) return { mode: 'empty', columns: [], rows: [] }

  const hasHeaders = detectHeaders(allRows[0])
  const headerRow = hasHeaders ? allRows[0] : null
  const dataRows = hasHeaders ? allRows.slice(1) : allRows

  const maxCols = Math.max(...allRows.map(r => r.length))
  const columns: ParsedColumn[] = []
  for (let i = 0; i < maxCols; i++) {
    const values = dataRows.map(r => r[i] ?? '')
    const headerText = headerRow?.[i] ?? null
    const fromHeader = headerText ? matchHeader(headerText) : null
    const suggestedField = fromHeader ?? inferFieldFromValues(values)
    columns.push({
      index: i,
      headerText,
      suggestedField,
      sampleValues: values.filter(v => v).slice(0, 3),
    })
  }

  // Fallback heuristic: first unmapped text-only column → company; second → contact_name.
  // Catches the common "Company, Contact, +41 …, email" headerless paste shape.
  const used = new Set(columns.map(c => c.suggestedField).filter(Boolean))
  const isPlainText = (col: ParsedColumn): boolean => {
    const samples = col.sampleValues
    if (samples.length === 0) return false
    return samples.every(v => !PHONE_RE.test(v) && !EMAIL_RE.test(v) && !TLD_RE.test(v) && !NUMBER_RE.test(v.replace(/[,'\s]/g, '')))
  }
  for (const target of ['company', 'contact_name'] as ProspectField[]) {
    if (used.has(target)) continue
    const col = columns.find(c => !c.suggestedField && isPlainText(c))
    if (col) { col.suggestedField = target; used.add(target) }
  }

  return { mode: 'tabular', delimiter, hasHeaders, columns, rows: dataRows }
}

/** Parse a blob of one or more VCARD entries. */
function parseVCardBlock(text: string): ParseResult {
  const blocks = text.split(/BEGIN:VCARD/i).filter(b => b.trim())
  const candidates: Partial<Prospect>[] = []
  for (const block of blocks) {
    const c: Partial<Prospect> = {}
    const fn = block.match(/FN[^:]*:([^\r\n]+)/i)
    const org = block.match(/ORG[^:]*:([^\r\n]+)/i)
    const tel = block.match(/TEL[^:]*:([^\r\n]+)/i)
    const email = block.match(/EMAIL[^:]*:([^\r\n]+)/i)
    const url = block.match(/URL[^:]*:([^\r\n]+)/i)
    if (fn) c.contact_name = fn[1].trim()
    if (org) c.company = org[1].trim().split(';')[0]
    if (tel) c.phone = tel[1].trim()
    if (email) c.email = email[1].trim()
    if (url) c.website = url[1].trim()
    if (c.company || c.contact_name) candidates.push(c)
  }
  return { mode: 'vcard', columns: [], rows: [], candidates }
}

/** Apply a column-index → field mapping to data rows. Numeric fields are coerced. */
export function applyMapping(
  rows: string[][],
  mapping: Record<number, ProspectField | null>,
): Partial<Prospect>[] {
  return rows.map(row => {
    const c: Record<string, unknown> = {}
    for (const [idxStr, field] of Object.entries(mapping)) {
      if (!field) continue
      const idx = Number(idxStr)
      const value = row[idx] ?? ''
      if (!value.trim()) continue
      if (field === 'amount_chf' || field === 'confidence_pct') {
        const n = Number(value.replace(/[,'\s]/g, ''))
        if (!isNaN(n)) c[field] = n
      } else {
        c[field] = value.trim()
      }
    }
    return c as Partial<Prospect>
  })
}

/** Normalize phone for dup-matching: digits only, last 10 — handles "+41 76 234 56 78" == "076 234 56 78". */
function normalizePhone(s: string): string {
  return s.replace(/\D/g, '').slice(-10)
}

function normalizeEmail(s: string): string {
  return s.toLowerCase().trim()
}

export interface DuplicateMatch {
  candidateIndex: number
  existingId: string
  matchedOn: 'phone' | 'email'
}

/** Flag candidates whose phone or email matches an existing prospect. */
export function detectDuplicates(
  candidates: Partial<Prospect>[],
  existing: { id: string; phone: string; email: string }[],
): DuplicateMatch[] {
  const phoneMap = new Map<string, string>()
  const emailMap = new Map<string, string>()
  for (const e of existing) {
    if (e.phone) {
      const p = normalizePhone(e.phone)
      if (p.length >= 7) phoneMap.set(p, e.id)
    }
    if (e.email) emailMap.set(normalizeEmail(e.email), e.id)
  }
  const matches: DuplicateMatch[] = []
  candidates.forEach((c, i) => {
    if (c.phone) {
      const p = normalizePhone(c.phone)
      if (p.length >= 7 && phoneMap.has(p)) {
        matches.push({ candidateIndex: i, existingId: phoneMap.get(p)!, matchedOn: 'phone' })
        return
      }
    }
    if (c.email) {
      const e = normalizeEmail(c.email)
      if (emailMap.has(e)) {
        matches.push({ candidateIndex: i, existingId: emailMap.get(e)!, matchedOn: 'email' })
      }
    }
  })
  return matches
}

/** Single-line quick-add parser. Used by A1 when built; defined here so the parser library is the single home for intake parsing. */
export function parseSingleLine(input: string): Partial<Prospect> {
  const trimmed = input.trim()
  if (!trimmed) return {}
  const result: Partial<Prospect> = {}
  const parts = trimmed.split(/\s*[,|]\s*/).filter(p => p)
  for (const part of parts) {
    if (!result.email && /@/.test(part)) {
      result.email = part
    } else if (!result.phone && PHONE_RE.test(part)) {
      result.phone = part
    } else if (!result.website && TLD_RE.test(part) && !part.includes('@')) {
      result.website = part
    } else if (!result.company) {
      result.company = part
    } else if (!result.contact_name) {
      result.contact_name = part
    }
  }
  return result
}
