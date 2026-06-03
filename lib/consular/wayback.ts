// ============================================================================
// lib/consular/wayback.ts — Age lamp (WP-SCOUT-4 / §16.9 / WP-119)
//
// Ralph 2026-06-03 — shared between the Jedi Scout's ◐ Queried prescreen
// and the Consular research route. Asks Wayback Machine's CDX index when
// it first saw the domain + how often it was captured since (a proxy for
// "is this site living or aging-out?").
//
// Endpoint:
//   http://web.archive.org/cdx/search/cdx?url=<domain>&output=json&fl=timestamp
//   → [["timestamp"], ["20040805123456"], ["20050102003000"], ...]
//
// We pull the FULL series (capped at 5000 records — Wayback's default is
// 150k, plenty for sub-second responses on a single domain) and derive:
//   - firstSeenYear   (the founding signal — "site is from 2016")
//   - lastSeenYear    (recency — gap suggests stale/aging)
//   - distinctYears   (rough "life" — 12 ≠ "12 captures"; counts unique years)
//   - totalCaptures   (volume — high count = healthy crawl interest)
//
// Tone is displacement-opportunity:
//   - old start year (≤ 2018) + few recent captures → stale (green = pitch)
//   - young site + many captures → healthy (yellow = harder to displace)
// The classification lives in formatAgeLamp(); the raw numbers stay
// available for downstream callers.
// ============================================================================

export interface WaybackAge {
  /** First time Wayback saw this domain (4-digit year), or null on failure. */
  firstSeenYear: number | null
  /** Most recent capture year, or null. */
  lastSeenYear: number | null
  /** Distinct years the domain was captured. Crude "alive years" proxy. */
  distinctYears: number | null
  /** Total CDX records returned. High = crawl interest = healthier site. */
  totalCaptures: number | null
  /** True when the CDX call failed (timeout/4xx/parse) — caller renders empty. */
  failed: boolean
}

const CDX_URL = 'http://web.archive.org/cdx/search/cdx'

export async function lookupAge(domain: string, timeoutMs = 8000): Promise<WaybackAge> {
  const cleaned = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim()
  if (!cleaned) {
    return { firstSeenYear: null, lastSeenYear: null, distinctYears: null, totalCaptures: null, failed: true }
  }

  try {
    // `fl=timestamp` → only the 14-digit YYYYMMDDhhmmss column; tiny payload.
    // `limit=5000` is generous for sub-second response, plenty for a year-walk.
    const url = `${CDX_URL}?url=${encodeURIComponent(cleaned)}&output=json&fl=timestamp&limit=5000`
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) {
      return { firstSeenYear: null, lastSeenYear: null, distinctYears: null, totalCaptures: null, failed: true }
    }
    const rows = (await r.json()) as string[][]
    // Row 0 is the header (`["timestamp"]`); rows 1..N are data.
    const data = Array.isArray(rows) ? rows.slice(1) : []
    if (data.length === 0) {
      // Wayback knows the domain but has zero captures (rare) — not a failure,
      // just an empty history.
      return { firstSeenYear: null, lastSeenYear: null, distinctYears: 0, totalCaptures: 0, failed: false }
    }

    const years = new Set<number>()
    let firstTs = '99999999999999'
    let lastTs = '00000000000000'
    for (const row of data) {
      const ts = row[0] || ''
      if (ts.length < 4) continue
      const year = Number(ts.slice(0, 4))
      if (Number.isFinite(year)) years.add(year)
      if (ts < firstTs) firstTs = ts
      if (ts > lastTs) lastTs = ts
    }
    return {
      firstSeenYear: firstTs !== '99999999999999' ? Number(firstTs.slice(0, 4)) : null,
      lastSeenYear: lastTs !== '00000000000000' ? Number(lastTs.slice(0, 4)) : null,
      distinctYears: years.size,
      totalCaptures: data.length,
      failed: false,
    }
  } catch {
    return { firstSeenYear: null, lastSeenYear: null, distinctYears: null, totalCaptures: null, failed: true }
  }
}

/**
 * Compact one-line lamp form. Tone words map to the row's color cue (the
 * UI maps "aging"/"stale" → green / displacement opportunity):
 *
 *   "~2016 · aging"             (old start, healthy recent — primary case)
 *   "~2008 · stale"             (old start, no recent captures)
 *   "~2023 · fresh"             (new site, recent captures)
 *   "first 2016 · last 2024"    (fallback when classification ambiguous)
 *   ""                          (everything failed)
 */
export function formatAgeLamp(a: WaybackAge): string {
  if (a.failed) return ''
  if (a.firstSeenYear == null) return ''
  const currentYear = 2026  // Spec date — used as a stable comparison baseline.
  const ageYears = currentYear - a.firstSeenYear
  const lastGap = a.lastSeenYear != null ? currentYear - a.lastSeenYear : null

  let tone = ''
  if (ageYears <= 2)         tone = 'fresh'
  else if (lastGap !== null && lastGap >= 3) tone = 'stale'
  else if (ageYears >= 8)    tone = 'aging'
  else                       tone = 'mature'

  return `~${a.firstSeenYear} · ${tone}`
}
