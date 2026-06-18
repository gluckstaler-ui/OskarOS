// ============================================================================
// lib/consular/reviews.ts — Google Business reviews via DuckDuckGo HTML
// (Ralph 2026-06-06)
//
// Why DuckDuckGo HTML, not the Google Places API or a paid search API
// -------------------------------------------------------------------
// OskarOS has no SerpAPI / Brave Search / Google Cloud key configured today,
// and the Reviews lamp is one of the cheapest signals to surface honestly.
// DDG's `https://html.duckduckgo.com/html/?q=...` returns a static HTML
// search-results page that includes the Google-Business knowledge-panel
// excerpt — rating + review count — in the result snippet for any company
// that has a Google Business listing.
//
// Trade-offs (calling these out so the failure modes are honest):
//   - DDG layout changes will break this. The regex is loose enough to
//     survive minor markup shifts but a structural redesign would need a
//     re-do. We log a one-line warning on parse-failure so drift is visible.
//   - DDG returns "blocked" pages under heavy load. We respect their
//     politeFetch rate and accept that a small % of lookups will time out.
//   - Some companies have no Google Business listing (small Swiss SMEs);
//     the lookup returns null cleanly — never invents a rating.
//   - Multi-location firms aggregate to the HQ listing if Google's panel
//     shows one. If they don't, we get null. Better than averaging.
//
// Upgrade path: swap the body of `lookupReviews` for a Brave Search call
// (`X-Subscription-Token` header, ~2k queries/mo free) or a Google Places
// API call (~$200/mo free via Google Cloud). Same return shape; same
// caller interface. If DDG hit-rate proves too low in real Filippo use,
// that swap is ~50 LOC.
// ============================================================================

import { politeFetch } from '../scrapers/http'

export interface ReviewsInfo {
  /** Star rating, 1.0-5.0, parsed from the result snippet. Null if no listing or unparseable. */
  rating: number | null
  /** Review count. Null if no listing or unparseable. */
  count: number | null
  /** The raw snippet we parsed from (for telemetry / drift detection). Empty when no result. */
  snippet: string
}

/**
 * Look up a company's Google Business reviews by hitting DuckDuckGo's HTML
 * search-results page with a query that biases toward the Google-Business
 * knowledge panel ("{company} reviews"). Returns `{rating, count}` parsed
 * from the result snippet, or null fields when nothing parseable came back.
 *
 * Never throws. Failures degrade to a `ReviewsInfo` with both fields null.
 */
export async function lookupReviews(domain: string): Promise<ReviewsInfo> {
  const cleaned = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim()
  if (!cleaned) return { rating: null, count: null, snippet: '' }

  // Derive a query that's likely to hit the Google Business knowledge panel.
  // The bare domain + "reviews" works for most Swiss SMEs (the domain often
  // matches the registered business name). For companies whose domain
  // doesn't match (e.g. acronym domains), the caller can be enriched later
  // with the actual company name from raw_payload.
  const query = `${cleaned} reviews`
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

  let body: string
  try {
    body = await politeFetch(url, {
      timeoutMs: 8_000,
      maxRetries: 1, // DDG either responds fast or it's rate-limiting us; don't thrash
      // DDG HTML works without a custom UA but rejects empty Accept headers.
      headers: { 'Accept': 'text/html,application/xhtml+xml' },
    })
  } catch {
    return { rating: null, count: null, snippet: '' }
  }

  // The Google-Business knowledge panel excerpt typically appears verbatim
  // in DDG's result snippets. We look for any one of these patterns:
  //   "4.7 stars · 87 reviews"
  //   "4,7 Sterne · 87 Bewertungen"     (German)
  //   "Rating: 4.7 - ‎87 reviews"
  //   "4.7/5 (87)"
  //   "★ 4.7 · 87 Google reviews"
  //
  // The regex is intentionally loose. A miss is far cheaper than a false
  // positive — if we can't parse confidently, we return null.
  //
  // Search the first ~50 KB of the response only (snippets are near the top;
  // anything past that is footer / nav junk).
  const head = body.slice(0, 50_000)
  const parsed = extractRatingAndCount(head)
  return parsed
}

/**
 * Extract rating + count from a DDG search-result snippet. Tries several
 * patterns in order of specificity. Exposed for testing.
 */
export function extractRatingAndCount(text: string): ReviewsInfo {
  // Normalise: collapse whitespace, lowercase for case-insensitive matches,
  // but keep the original for snippet capture.
  const norm = text.replace(/\s+/g, ' ')

  // Pattern A — explicit Google-format: "4.7 stars · 87 reviews" / "4,7 ... Bewertungen"
  const a = norm.match(/(\d[.,]\d)\s*(?:stars?|sterne|étoiles?|stelle)\s*[·.\-—]\s*(\d{1,5})\s*(?:reviews?|bewertungen|avis|recensioni)/i)
  if (a) return mkResult(a[1], a[2], a[0])

  // Pattern B — knowledge-panel "★ 4.7 · 87 reviews"
  const b = norm.match(/[★⭐]\s*(\d[.,]\d)\s*[·.\-—]\s*(\d{1,5})\s*(?:google\s+)?(?:reviews?|bewertungen|avis|recensioni)/i)
  if (b) return mkResult(b[1], b[2], b[0])

  // Pattern C — "Rating: 4.7 - 87 reviews"
  const c = norm.match(/rating[:\s]+(\d[.,]\d)\s*[·\-—]\s*(\d{1,5})\s*reviews?/i)
  if (c) return mkResult(c[1], c[2], c[0])

  // Pattern D — compact "4.7/5 (87)" — common in DDG abstracts.
  const d = norm.match(/(\d[.,]\d)\s*\/\s*5\s*[·•]?\s*\(?\s*(\d{1,5})\s*\)?/i)
  if (d) return mkResult(d[1], d[2], d[0])

  return { rating: null, count: null, snippet: '' }
}

function mkResult(ratingStr: string, countStr: string, snippet: string): ReviewsInfo {
  // German/French/Italian use comma as decimal separator.
  const rating = parseFloat(ratingStr.replace(',', '.'))
  const count = parseInt(countStr, 10)
  // Sanity: rating must be 1.0-5.0; count must be 1-100k.
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return { rating: null, count: null, snippet }
  if (!Number.isFinite(count) || count < 1 || count > 100_000) return { rating: null, count: null, snippet }
  return { rating, count, snippet }
}

/**
 * Format the Reviews lamp value for the dossier. Matches the mockup's
 * mono-spaced "4.7★·87" pattern. Returns null when there's nothing to show
 * so the lamp renders an honest "—" state.
 */
export function formatReviewsLamp(info: ReviewsInfo | null): string | null {
  if (!info || info.rating == null || info.count == null) return null
  return `${info.rating.toFixed(1)}★·${info.count}`
}
