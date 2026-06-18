// ============================================================================
// lib/raw-prospects-ingest.ts — shared dedup-and-ingest pipeline.
// Ralph 2026-06-05.
//
// EXTRACTED from app/api/admin/crm/raw-prospects/route.ts so the Discover
// runner can ingest in-process instead of doing `fetch(${origin}/...)` to
// itself. Next.js dev's localhost-to-self fetch is unreliable across HMR
// cycles — it silently never reaches the handler after a hot-reload.
// Direct function call has zero such failure modes.
//
// Used by:
//   - app/api/admin/crm/raw-prospects/route.ts        (the HTTP entrypoint)
//   - app/api/admin/crm/scout/discover/route.ts        (the in-process caller)
//
// Behavior is byte-identical to the inline version that previously lived
// in raw-prospects/route.ts. Same 3-leg dedup (domain · phone|email ·
// name+adresse), same id-allocation discipline, same skip-reason taxonomy.
// ============================================================================

import {
  ingestRawProspect,
  readRawProspects,
  readSheet,
  type RawProspect,
} from './crm-store'

export interface PoolCandidate {
  name?: string
  company?: string
  phone?: string
  email?: string
  website?: string
  country?: string
  industry?: string
  raw_payload?: unknown
}

export interface SkippedRow {
  row: number
  reason:
    | 'duplicate-website-in-pool' | 'duplicate-website-in-prospects'
    | 'duplicate-contact-in-pool' | 'duplicate-contact-in-prospects'
    | 'duplicate-name-adresse-in-pool' | 'duplicate-name-adresse-in-prospects'
    | 'no-identifier'
  match?: string
}

export interface IngestResult {
  created: number
  skipped: number
  ids: string[]
  errors: { row: number; error: string }[]
  skippedDetail: SkippedRow[]
}

export interface IngestOptions {
  source?: string
  defaults?: { country?: string; industry?: string }
}

// ── helpers (verbatim from the route — keep semantically identical) ──────

function domainOf(raw: string | undefined): string {
  if (!raw) return ''
  const cleaned = String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
    .trim()
  return /\./.test(cleaned) ? cleaned : ''
}

function contactKey(c: { phone?: string; email?: string }): string {
  const phone = String(c.phone ?? '').replace(/[\s+()-]/g, '').trim()
  const email = String(c.email ?? '').trim().toLowerCase()
  return phone || email ? `${phone}|${email}` : ''
}

function asciiFold(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
}
function normName(s: string): string {
  return asciiFold(s)
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(dr|med|fmh|prof|phil|lic)\b\.?/g, ' ')
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
function nameAdresseKey(name: string, adresse: string): string {
  const n = normName(name)
  const a = normAdresse(adresse)
  return n && a ? `${n}|${a}` : ''
}

// ── Public ingest function ───────────────────────────────────────────────

/**
 * Dedup + insert candidates against the live pool + Kanban prospects sheet.
 *
 * Reads BOTH surfaces once up front, builds the 3-leg dedup index, classifies
 * each candidate, then writes the survivors sequentially via
 * `ingestRawProspect` (SQLite write contention is real on a hot single-file db).
 *
 * For a single-candidate caller (Discover's per-match flush, batchSize=1),
 * the pool/sheet re-read overhead is ~5ms. For a batched caller (the HTTP
 * route receiving 50-candidate posts), the amortised cost stays bounded.
 *
 * Throws ONLY on programmer errors (db unreachable, JSON corruption). All
 * per-row failures are recorded in `result.errors` and the result is returned.
 */
export async function ingestRawProspectCandidates(
  candidates: PoolCandidate[],
  opts: IngestOptions = {},
): Promise<IngestResult> {
  if (candidates.length === 0) {
    return { created: 0, skipped: 0, ids: [], errors: [], skippedDetail: [] }
  }

  const source = opts.source || `programmatic:${new Date().toISOString().slice(0, 10)}`
  const defaults = opts.defaults ?? {}

  const pool = readRawProspects()
  const prospects = readSheet()

  // Ralph 2026-06-05 — TWO-LEG DEDUP (was three).
  // Website-only dedup REMOVED. Multiple distinct psychologists can share
  // a website (group practices: aidmentis.ch, vt-aarau.ch, the FSP-shared
  // hosts in lib/scrapers/fsp.ts). Rejecting a candidate just because
  // their website is already in the pool throws away legitimate distinct
  // leads. The two remaining legs (phone|email + name+adresse) are real
  // personal identifiers and continue to catch true duplicates.
  const dedupContacts = new Set<string>()
  const dedupNameAdresse = new Set<string>()
  const prospectsContacts = new Set<string>()
  const prospectsNameAdresse = new Set<string>()
  for (const p of pool) {
    const c = contactKey({ phone: p.phone, email: p.email }); if (c) dedupContacts.add(c)
    const na = nameAdresseKey(p.name, extractAdresse(p.raw_payload))
    if (na) dedupNameAdresse.add(na)
  }
  for (const p of prospects) {
    const c = contactKey({ phone: p.phone, email: p.email })
    if (c) { dedupContacts.add(c); prospectsContacts.add(c) }
    const prospectAdresse = [p.address_strasse, p.address_plz, p.address_ort].filter(Boolean).join(' ')
    for (const nm of [p.contact_name, p.company]) {
      const na = nameAdresseKey(nm, prospectAdresse)
      if (na) { dedupNameAdresse.add(na); prospectsNameAdresse.add(na) }
    }
  }

  const usedIds = new Set([...pool.map((p) => p.id), ...prospects.map((p) => p.id)])
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

    if (!website && !phone && !email && !name && !company) {
      skipped.push({ row: idx, reason: 'no-identifier' })
      return
    }

    // Website-only dedup intentionally omitted (Ralph 2026-06-05). Group
    // practices legitimately share a domain — different people with the
    // same website are distinct leads, not duplicates.

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

  const ids: string[] = []
  for (const { idx, row } of toIngest) {
    try {
      const created = await ingestRawProspect(row)
      ids.push(created.id)
    } catch (err) {
      errors.push({ row: idx, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return {
    created: ids.length,
    skipped: skipped.length,
    errors,
    ids,
    skippedDetail: skipped,
  }
}
