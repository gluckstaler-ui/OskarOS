// ============================================================================
// app/api/admin/crm/raw-prospects/route.ts — WP-SCOUT-6 (Ralph 2026-06-03).
//
// POST → batched ingest into the Scout pool (`raw_prospects`). Mirrors the
// shape of `/api/admin/crm/prospects/bulk` (route.ts in the bulk sibling)
// but writes to the pool instead of the pipeline.
//
// Dedup discipline [SCOUT-G]:
//
//   - Live pool dedup — skip a website-domain already in the pool
//     (promoted_at IS NULL AND rejected_at IS NULL).
//   - Live pipeline dedup — skip a website-domain already a `prospects`
//     row. The Scout's job is to PRE-screen for the Kanban; tasting a lead
//     we've already committed to wastes Opus tokens.
//   - Three-leg dedup keys (any match → skip):
//       1. Website domain (host, lower-cased, www stripped) — primary.
//       2. `phone|email` — fallback for site-less leads.
//       3. `name|adresse` (ASCII-folded, alphanumeric-only) — third leg
//          for the seed shape we ran into: aargau name-only entries had
//          empty phone (`—`) AND empty email (`—`) AND empty website, so
//          legs 1+2 both returned "" and a re-import silently dup'd them.
//          The third leg catches that without depending on contact data.
//          Requires BOTH name and adresse — name alone is too noisy
//          ("Dr. med. Thomas Meier" recurs across cantons).
//   - Adresse comes from `raw_payload.adr` (aargau seed shape) or
//     `raw_payload.adresse` (zürich xlsx shape) or `raw_payload.address`.
//     Prospects-side: `address_strasse address_plz address_ort` concat.
//
// ID namespace — `R###` (separate from `P###`):
//
//   The two surfaces never share an id. A pool row stamped `promoted_to`
//   points at the prospects id; the prospects id NEVER appears as a pool
//   id and vice versa. Confirms the spec's open-decision-2 lean.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import {
  ingestRawProspect,
  readRawProspects,
  readSheet,
  type RawProspect,
} from '@/lib/crm-store'

interface PoolCandidate {
  name?: string
  company?: string
  phone?: string
  email?: string
  website?: string
  country?: string
  industry?: string
  raw_payload?: unknown
}

interface PoolRequestBody {
  candidates: PoolCandidate[]
  /** Where the ingest came from — written into `raw_prospects.source`. */
  source?: string
  /** Optional default fields applied to every candidate. */
  defaults?: { country?: string; industry?: string }
}

interface SkippedRow {
  row: number
  reason: 'duplicate-website-in-pool' | 'duplicate-website-in-prospects' |
          'duplicate-contact-in-pool' | 'duplicate-contact-in-prospects' |
          'duplicate-name-adresse-in-pool' | 'duplicate-name-adresse-in-prospects' |
          'no-identifier'
  match?: string
}

/**
 * Extract a normalised website domain from any free-form value:
 *   'https://example.ch/foo' → 'example.ch'
 *   'www.Example.CH'         → 'example.ch'
 *   ''                       → ''
 * Empty string when there's nothing usable.
 */
function domainOf(raw: string | undefined): string {
  if (!raw) return ''
  const cleaned = String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
    .trim()
  // Require at least one dot — bare 'www' or junk like '—' shouldn't match.
  return /\./.test(cleaned) ? cleaned : ''
}

/** Contact key = phone|email (lowercased), for site-less leads. */
function contactKey(c: PoolCandidate): string {
  const phone = String(c.phone ?? '').replace(/[\s+()-]/g, '').trim()
  const email = String(c.email ?? '').trim().toLowerCase()
  return phone || email ? `${phone}|${email}` : ''
}

/**
 * ASCII-fold + alphanumeric squash for stable cross-source matching.
 *   "Bäderstrasse 11, 5400 Baden" → "baederstrasse 11 5400 baden"
 *   "Dr. Anca-Maria Teaca"        → "dr anca maria teaca"
 * Without folding, "Bäderstrasse" and "Baederstrasse" wouldn't match —
 * which is a real failure mode (one source writes the umlaut, another doesn't).
 */
function asciiFold(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
}
function normName(s: string): string {
  return asciiFold(s)
    .replace(/\([^)]*\)/g, '')          // drop parentheticals like "(Praxis X)"
    .replace(/\b(dr|med|fmh|prof|phil|lic)\b\.?/g, ' ')  // drop common titles
    .replace(/[^a-z]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function normAdresse(s: string): string {
  return asciiFold(s)
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
/** Pull an adresse string out of a raw_payload blob (any of the in-the-wild keys). */
function extractAdresse(raw: unknown): string {
  if (!raw) return ''
  let obj: Record<string, unknown> = {}
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) as Record<string, unknown> } catch { return '' }
  } else if (typeof raw === 'object') {
    obj = raw as Record<string, unknown>
  }
  const v = obj.adr ?? obj.adresse ?? obj.address
  return typeof v === 'string' ? v : ''
}
/** Name+adresse dedup key — both required, else empty (no false-positive matches). */
function nameAdresseKey(name: string, adresse: string): string {
  const n = normName(name)
  const a = normAdresse(adresse)
  return n && a ? `${n}|${a}` : ''
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PoolRequestBody
    const candidates = body.candidates ?? []
    if (candidates.length === 0) {
      return NextResponse.json({ error: 'No candidates supplied' }, { status: 400 })
    }

    const source = body.source || `html-import:${new Date().toISOString().slice(0, 10)}`
    const defaults = body.defaults ?? {}

    // ── Dedup index. Read both surfaces ONCE up front and merge into a
    //    single domain-set + contact-set (cheap O(n) lookups).
    const pool = readRawProspects()                 // pool already filters to live rows
    const prospects = readSheet()

    const dedupDomains = new Set<string>()
    const dedupContacts = new Set<string>()
    const dedupNameAdresse = new Set<string>()
    // Track which surface a match came from so the skip reason can point at
    // pool-vs-prospects without re-scanning the arrays in the hot path.
    const prospectsDomains = new Set<string>()
    const prospectsContacts = new Set<string>()
    const prospectsNameAdresse = new Set<string>()
    for (const p of pool) {
      const d = domainOf(p.website); if (d) dedupDomains.add(d)
      const c = contactKey({ phone: p.phone, email: p.email }); if (c) dedupContacts.add(c)
      const na = nameAdresseKey(p.name, extractAdresse(p.raw_payload))
      if (na) dedupNameAdresse.add(na)
    }
    for (const p of prospects) {
      const d = domainOf(p.website)
      if (d) { dedupDomains.add(d); prospectsDomains.add(d) }
      const c = contactKey({ phone: p.phone, email: p.email })
      if (c) { dedupContacts.add(c); prospectsContacts.add(c) }
      const prospectAdresse = [p.address_strasse, p.address_plz, p.address_ort].filter(Boolean).join(' ')
      // Prospects expose two name fields — `contact_name` (from raw.name on
      // Promote) and `company`. Either could match a fresh candidate's name,
      // so key both.
      for (const nm of [p.contact_name, p.company]) {
        const na = nameAdresseKey(nm, prospectAdresse)
        if (na) { dedupNameAdresse.add(na); prospectsNameAdresse.add(na) }
      }
    }

    // ── ID allocation: scan ALL pool rows (including stamped ones) for the
    //    max numeric suffix; allocate from max+1. Count+1 collides with gaps
    //    (a discarded R007 + a re-ingest would re-mint R007). The DB has a
    //    unique-id constraint so we keep allocating until we land on a free
    //    slot — defence in depth against an orphan row.
    const usedIds = new Set([...pool.map((p) => p.id), ...prospects.map((p) => p.id)])
    // Also read the full pool table (incl. promoted/rejected) — readRawProspects()
    // hides those, and we don't want to reuse a once-used id even if its row
    // has left the live pool. The maximum we can compute from the visible pool
    // is a lower bound; the DB layer's IDempotent INSERT-OR-REPLACE would
    // otherwise risk overwriting a stamped row.
    let nextN = 0
    for (const p of pool) {
      const m = /^R(\d+)$/.exec(p.id); if (m) nextN = Math.max(nextN, parseInt(m[1], 10))
    }
    nextN += 1
    const allocateId = (): string => {
      let id = `R${String(nextN).padStart(3, '0')}`
      while (usedIds.has(id)) {
        nextN += 1
        id = `R${String(nextN).padStart(3, '0')}`
      }
      usedIds.add(id)
      nextN += 1
      return id
    }

    // ── Pass 1: classify each candidate. Build the to-ingest list +
    //    skipped[] in a single sweep so the response carries why each row
    //    didn't land.
    const toIngest: Array<{ idx: number; row: Partial<RawProspect> & { id: string; source: string } }> = []
    const skipped: SkippedRow[] = []
    const errors: { row: number; error: string }[] = []

    candidates.forEach((c, idx) => {
      const website = String(c.website ?? '').trim()
      const phone = String(c.phone ?? '').trim()
      const email = String(c.email ?? '').trim()
      const name = String(c.name ?? '').trim()
      const company = String(c.company ?? '').trim()
      const country = String(c.country ?? defaults.country ?? '').trim()
      const industry = String(c.industry ?? defaults.industry ?? '').trim()

      // Require ONE identifier — otherwise the row is pure noise.
      if (!website && !phone && !email && !name && !company) {
        skipped.push({ row: idx, reason: 'no-identifier' })
        return
      }

      // Three-leg dedup. Domain first (strongest), then phone|email, then
      // name|adresse (catches name-only seed rows that have empty contact
      // fields — the aargau gap). Each leg is checked independently so a
      // candidate with website+name+adresse gets all three keys recorded.
      const domain = domainOf(website)
      if (domain) {
        if (dedupDomains.has(domain)) {
          skipped.push({
            row: idx,
            reason: prospectsDomains.has(domain) ? 'duplicate-website-in-prospects' : 'duplicate-website-in-pool',
            match: domain,
          })
          return
        }
        dedupDomains.add(domain)
      }

      const ck = contactKey({ phone, email })
      if (ck) {
        if (dedupContacts.has(ck)) {
          skipped.push({
            row: idx,
            reason: prospectsContacts.has(ck) ? 'duplicate-contact-in-prospects' : 'duplicate-contact-in-pool',
            match: ck,
          })
          return
        }
        dedupContacts.add(ck)
      }

      const candidateAdresse = extractAdresse(c.raw_payload)
      const naKey = nameAdresseKey(name || company, candidateAdresse)
      if (naKey) {
        if (dedupNameAdresse.has(naKey)) {
          skipped.push({
            row: idx,
            reason: prospectsNameAdresse.has(naKey) ? 'duplicate-name-adresse-in-prospects' : 'duplicate-name-adresse-in-pool',
            match: naKey,
          })
          return
        }
        dedupNameAdresse.add(naKey)
      }

      // Survived dedup — build the row.
      const id = allocateId()
      toIngest.push({
        idx,
        row: {
          id,
          source,
          scraped_at: new Date().toISOString(),
          raw_payload: JSON.stringify(c.raw_payload ?? c),
          name,
          company,
          phone,
          email,
          website,
          country,
          industry,
        },
      })
    })

    // ── Pass 2: write. Each ingestRawProspect appends an event + writes
    //    the row — keeps the event log in sync. Sequential, not parallel:
    //    SQLite write contention is real on a hot single-file db.
    const ids: string[] = []
    for (const { idx, row } of toIngest) {
      try {
        const created = await ingestRawProspect(row)
        ids.push(created.id)
      } catch (err) {
        errors.push({ row: idx, error: err instanceof Error ? err.message : String(err) })
      }
    }

    return NextResponse.json({
      created: ids.length,
      skipped: skipped.length,
      errors,
      ids,
      // breakdown for the import-result toast in BulkImportModal
      skippedDetail: skipped,
    })
  } catch (err) {
    console.error('[CRM] raw-prospects POST failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
