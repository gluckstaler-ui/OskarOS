// ============================================================================
// lib/scout-colocation.ts — co-location (Ralph 2026-06-09).
//
// An address shared by ≥2 practitioners IS a practice. For a person with NO
// website at a shared STREET address, their practice site is the host the
// majority of their address-mates declare. This surfaces the people the
// per-person scrape misses — e.g. the 7 empty-website therapists at Via
// Landriani 7, Lugano whose practice (psicoterapiacognitiva.ch) three of their
// neighbours already list.
//
// PURE + DERIVED. Computed live in the CRM (ScoutPool useMemo, same pattern as
// sharedPractice) — never written to the DB. The result is shown as "probably
// ‹site›"; a websearch on the scout step is what promotes a "probably" into a
// real, written website. No shadow store, no blocklist — the websearch, not a
// hardcoded list, is what rejects a register/social host that slips in.
// ============================================================================

interface Row { id: string; website: string; raw_payload: string }

function pp(s: string): Record<string, unknown> { try { return JSON.parse(s || '{}') } catch { return {} } }
function hostOf(u: string): string { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).host.replace(/^www\./, '') } catch { return '' } }

/** Normalise to a street address ("via landriani 7|6900"); '' for a city-only
 *  address ("Zürich", "5400 Baden") — those aren't a practice, just bad data. */
function normAddr(p: Record<string, unknown>): string {
  let s = String(p.adr || '').toLowerCase().replace(/[^a-z0-9äöü ]/g, ' ').replace(/\b\d{4}\b/g, ' ')
  const o = String(p.ort || '').toLowerCase().replace(/[^a-z0-9äöü]/g, '')
  if (o) s = s.split(' ').filter((t) => t.replace(/[^a-z0-9äöü]/g, '') !== o).join(' ')
  s = s.replace(/\s+/g, ' ').trim()
  if (!s || !/\d/.test(s)) return '' // a real address needs a street number
  return `${s}|${String(p.plz || '')}`
}

export interface CoLocation { site: string; count: number }

/**
 * id → probable practice site, for every empty-website person sharing a street
 * address with ≥2 colleagues who declare the same host. A host held by only ONE
 * person is a personal site and is never propagated.
 */
export function computeCoLocation(rows: Row[]): Map<string, CoLocation> {
  // Pool-wide host counts + a clean sample URL. A host ≥2 people declare anywhere
  // is a real practice; held by 1 it's personal — don't spread it.
  const poolHost = new Map<string, number>()
  const sample = new Map<string, string>()
  for (const r of rows) {
    const w = (r.website || '').trim(); if (!w) continue
    const h = hostOf(w); if (!h) continue
    poolHost.set(h, (poolHost.get(h) || 0) + 1)
    const cur = sample.get(h); if (!cur || w.length < cur.length) sample.set(h, w)
  }
  const byAddr = new Map<string, Row[]>()
  for (const r of rows) {
    const k = normAddr(pp(r.raw_payload)); if (!k) continue
    const g = byAddr.get(k); if (g) g.push(r); else byAddr.set(k, [r])
  }
  const out = new Map<string, CoLocation>()
  for (const g of byAddr.values()) {
    if (g.length < 2) continue
    const hosts = new Set<string>()
    for (const r of g) { const h = hostOf((r.website || '').trim()); if (h) hosts.add(h) }
    let best = ''; let bestN = 0
    for (const h of hosts) { const n = poolHost.get(h) || 0; if (n > bestN) { bestN = n; best = h } }
    if (!best || bestN < 2) continue // no shared practice site at this address
    const site = sample.get(best)!
    for (const r of g) if (!(r.website || '').trim()) out.set(r.id, { site, count: bestN })
  }
  return out
}
