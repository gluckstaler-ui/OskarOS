// ============================================================================
// lib/consular/wayback.ts — Age lamp (WP-SCOUT-4 / §16.9 / WP-119)
//
// Ralph 2026-06-03 — shared between the Jedi Scout's ◐ Queried prescreen
// and the Consular research route. Asks Wayback Machine when it first saw
// the domain + when it last saw it (a proxy for "is this site living or
// aging-out?").
//
// 2026-06-03 (Ralph) — REWRITTEN to use the **Availability API** instead of
// the CDX index. The CDX endpoint (`web.archive.org/cdx/search/cdx`) is
// notoriously unreliable — it times out for major domains (apple.com,
// praxisich.ch, etc.) for stretches of hours. Independent test confirmed
// every CDX call hangs while the Availability API responds in 1-5 s.
//
// Endpoint:
//   https://archive.org/wayback/available?url=<domain>[&timestamp=YYYYMMDD]
//   → { "url": "...", "archived_snapshots": { "closest": {
//         "available": true, "url": "...", "timestamp": "20140312123456",
//         "status": "200" } } }
//
// 2026-06-05 (Ralph) — AGE-empty fix. The previous implementation asked the
// API for `?timestamp=19990101` to find the earliest capture. The API has
// an undocumented ~10-year tolerance window: when the request timestamp is
// more than ~9-10 years before the site's first archive, the API returns
// `archived_snapshots: {}` even when captures EXIST further forward. So:
//   - psychologie.ch (first archive 1999-02) → ts=19990101 returns empty;
//     ts=20000101 returns the actual 1999-02 snapshot.
//   - psy-bern.ch (first archive 2009-12)   → ts=19990101 + 20000101 both
//     return empty; ts=20100101 returns the 2009-12 snapshot.
//   - psychotherapie-diener.ch (only archive 2025-04) → ts=19990101 returns
//     empty; ts=20000101 returns the 2025 snapshot (only data point).
//
// Fix: use a ladder of three anchor timestamps in parallel — 2000 / 2010 /
// 2020 — then take the EARLIEST snapshot timestamp across whatever the
// API returned. Plus the no-timestamp call for "latest". 4 parallel calls
// instead of 2; same wall time (~3-5s), much better recall.
//
// What we lose vs CDX: distinctYears + totalCaptures. The Age tone() in
// types.ts only pattern-matches the *string* (e.g. "stale" / "aging" /
// year ranges), so losing those numbers is invisible at the lamp level —
// classification stays correct from firstSeenYear + lastSeenYear alone.
//
// Tone is displacement-opportunity:
//   - old start year (≤ 2018) + no recent captures → stale (green = pitch)
//   - old start + recent captures                  → aging (yellow)
//   - new site with recent captures                → fresh / mature
// The classification lives in formatAgeLamp(); the raw years stay
// available for downstream callers.
// ============================================================================

export interface WaybackAge {
  /** First time Wayback saw this domain (4-digit year), or null on failure. */
  firstSeenYear: number | null
  /** Most recent capture year, or null. */
  lastSeenYear: number | null
  /** Kept for the contract — null since Availability gives 1 snapshot per call. */
  distinctYears: number | null
  /** Kept for the contract — null since Availability doesn't enumerate captures. */
  totalCaptures: number | null
  /** True when BOTH calls failed (timeout/4xx/parse) — caller renders empty. */
  failed: boolean
}

const AVAILABILITY_URL = 'https://archive.org/wayback/available'

/** Shape of one Availability API response. */
interface AvailResp {
  url?: string
  archived_snapshots?: {
    closest?: {
      available?: boolean
      timestamp?: string
      status?: string
      url?: string
    }
  }
}

/** Pull the closest snapshot to `targetTs` (YYYYMMDD) for `domain`. Returns null on failure. */
async function fetchClosest(domain: string, targetTs: string | null, timeoutMs: number): Promise<string | null> {
  const params = new URLSearchParams({ url: domain })
  if (targetTs) params.set('timestamp', targetTs)
  const url = `${AVAILABILITY_URL}?${params.toString()}`
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const j = (await r.json()) as AvailResp
    const ts = j.archived_snapshots?.closest?.timestamp
    return (typeof ts === 'string' && ts.length >= 4) ? ts : null
  } catch {
    return null
  }
}

/**
 * Anchor timestamps for finding the EARLIEST snapshot. Covers Wayback's
 * full operating range (Brewster started archiving in 1996) in three steps
 * tight enough that no decade of new sites slips through the API's ~10-
 * year-tolerance window.
 *
 *   2000 → catches anything first archived between ~1996 and ~2010
 *   2010 → catches the missing late-2000s sites + first-archived-2010-2020
 *   2020 → catches first-archived-after-2020 (when 2000/2010 anchors fail)
 *
 * For a site first archived in 1999, ts=2000 returns its 1999 snapshot
 * (closest available). For a site first archived in 2024, ts=2000 might
 * return empty (window too far) but ts=2020 returns the 2024 snapshot.
 * We take the EARLIEST timestamp returned across all three.
 */
const EARLIEST_ANCHORS = ['20000101', '20100101', '20200101'] as const

export async function lookupAge(domain: string, timeoutMs = 8000): Promise<WaybackAge> {
  const cleaned = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim()
  if (!cleaned) {
    return { firstSeenYear: null, lastSeenYear: null, distinctYears: null, totalCaptures: null, failed: true }
  }

  // Four parallel calls — 3 anchors for "earliest" (ladder) + 1 no-ts for
  // "latest". Same wall time as before (one round-trip), much better recall.
  const [t2000, t2010, t2020, lastTs] = await Promise.all([
    fetchClosest(cleaned, EARLIEST_ANCHORS[0], timeoutMs),
    fetchClosest(cleaned, EARLIEST_ANCHORS[1], timeoutMs),
    fetchClosest(cleaned, EARLIEST_ANCHORS[2], timeoutMs),
    fetchClosest(cleaned, null,                timeoutMs),
  ])

  // EARLIEST snapshot across all anchor responses. Sort timestamps lexically
  // (YYYYMMDDHHMMSS strings sort chronologically), filter out nulls, pick [0].
  const anchorHits = [t2000, t2010, t2020].filter((t): t is string => t !== null).sort()
  const firstTs = anchorHits[0] ?? null

  if (firstTs == null && lastTs == null) {
    return { firstSeenYear: null, lastSeenYear: null, distinctYears: null, totalCaptures: null, failed: true }
  }

  // Robustness — if only ONE call succeeded (rare), use it for both ends
  // so formatAgeLamp can still emit a useful string. A single data point
  // sets both firstSeen and lastSeen to that year; the lamp tone falls
  // back to "fresh" or "mature" depending on age vs current year.
  const effectiveFirst = firstTs ?? lastTs
  const effectiveLast  = lastTs  ?? firstTs

  return {
    firstSeenYear: effectiveFirst ? Number(effectiveFirst.slice(0, 4)) : null,
    lastSeenYear:  effectiveLast  ? Number(effectiveLast.slice(0, 4))  : null,
    distinctYears: null,
    totalCaptures: null,
    failed: false,
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
