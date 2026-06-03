// ============================================================================
// lib/consular/research-queried.ts — the 9-signal ◐ Queried aggregator
//
// Ralph 2026-06-03 — WP-SCOUT-4 (per the §17 spec). Built ONCE here and
// shared with both:
//   - the Jedi Scout's ◐ Queried prescreen   (pre-Kanban — fast triage)
//   - the Consular research route             (post-promote — deep-dive)
//
// Five signals come from network calls (lookupHosting · lookupAge ·
// lookupPagespeed → performance/seo/traffic); FOUR come from static grep
// over the captured HTML (stack · trackers · booking · languages). Each
// leg is independently graceful — a failure yields `null` for that signal,
// never throws — so a partial result still lights up most of the row.
//
// Tone is displacement-opportunity, NOT health (cf. §17 [SCOUT-L]):
// stale age · old stack · perf < 50 · SEO < 70 · no booking → GREEN
// (the site has more headroom to sell into).
// ============================================================================

import { lookupHosting,    formatHostingLamp,    type HostingInfo }    from './dns-lookup'
import { lookupAge,        formatAgeLamp,        type WaybackAge }     from './wayback'
import { lookupPagespeed,  formatPerformanceLamp,
         formatSeoLamp,    formatTrafficLamp,    type PagespeedSignals } from './pagespeed'

export interface QueriedSignals {
  // The nine lamps — all string-or-null for symmetric rendering. Raw blobs
  // (the typed lookup returns) are kept under `raw` for callers that want
  // the numbers / structured data.
  age: string | null
  stack: string | null
  hosting: string | null
  performance: string | null
  seo: string | null
  traffic: string | null
  trackers: string | null
  booking: string | null
  languages: string | null
  /** Where each lamp came from — for the dossier's "source" tags. */
  sources: Record<string, string>
  /** Raw lookup payloads (numbers, ASNs, capture counts, …). */
  raw: {
    hosting: HostingInfo | null
    age: WaybackAge | null
    pagespeed: PagespeedSignals | null
    /** Stack detector hits (each detector returns a name or null). */
    stackHits: string[]
  }
}

// ── Static-HTML detectors ──────────────────────────────────────────────────
//
// All grep on a normalized lowercase HTML string. They're heuristics — a
// missed detection is acceptable, a fabricated one is not. Add markers
// cheaply as they show up in real samples; remove the day they fire a
// false-positive.

function detectStack(html: string): string | null {
  const h = html
  // Order: most specific first. The FIRST hit wins to keep the lamp single-valued.
  if (h.includes('wp-content') || h.includes('wp-includes') || /<meta\s+name=["']generator["'][^>]*wordpress/i.test(h)) return 'WordPress'
  if (h.includes('cdn.shopify') || h.includes('shopify_assets'))                                                       return 'Shopify'
  if (h.includes('squarespace'))                                                                                       return 'Squarespace'
  if (h.includes('wix.com') || h.includes('_wixcss') || h.includes('parastorage.com'))                                 return 'Wix'
  if (h.includes('jimdo'))                                                                                             return 'Jimdo'
  if (h.includes('webflow'))                                                                                           return 'Webflow'
  if (h.includes('framerusercontent') || h.includes('framerstatic'))                                                   return 'Framer'
  if (h.includes('/_next/static/') || h.includes('__next_data__'))                                                     return 'Next.js'
  if (h.includes('_nuxt') || h.includes('__nuxt'))                                                                     return 'Nuxt'
  if (h.includes('drupal') || /<meta\s+name=["']generator["'][^>]*drupal/i.test(h))                                    return 'Drupal'
  if (h.includes('joomla') || /<meta\s+name=["']generator["'][^>]*joomla/i.test(h))                                    return 'Joomla'
  return 'custom / unknown'
}

function detectTrackers(html: string): string | null {
  const hits: string[] = []
  if (/gtag\s*\(|googletagmanager\.com\/gtag\/js|G-[A-Z0-9]{6,}/i.test(html)) hits.push('GA4')
  if (/connect\.facebook\.net\/.*\/fbevents\.js|fbq\s*\(/i.test(html))         hits.push('Meta')
  if (/static\.hotjar\.com|hjBootstrap/i.test(html))                            hits.push('Hotjar')
  if (/cdn\.matomo\.cloud|_paq\.push/i.test(html))                              hits.push('Matomo')
  if (/plausible\.io\/js\//i.test(html))                                        hits.push('Plausible')
  // "Tracking present + no cookie/consent layer" is the displacement signal —
  // the Scout's pitch hook is "you're collecting data without disclosure".
  const hasCookieBanner = /cookieconsent|cookie-?banner|cookiebot|usercentrics|cookiefirst/i.test(html)
  if (hits.length === 0) return '— none detected'
  return hasCookieBanner ? hits.join(' · ') : `${hits.join(' · ')} · no cookie policy ⚠`
}

function detectBooking(html: string): string | null {
  if (/calendly\.com/i.test(html))     return 'Calendly'
  if (/acuityscheduling\.com/i.test(html)) return 'Acuity'
  if (/cal\.com|cal\.com\/embed/i.test(html)) return 'Cal.com'
  if (/setmore\.com|setmore-widget/i.test(html)) return 'Setmore'
  if (/squareup\.com\/appointments|book\.squareup/i.test(html)) return 'Square Appointments'
  if (/booksy\.com/i.test(html))        return 'Booksy'
  return '— none'                       // green tone: booking-gap = pitch angle
}

function detectLanguages(html: string): string | null {
  const langs = new Set<string>()
  const langAttr = html.match(/<html\b[^>]*\blang=["']([a-zA-Z-]{2,8})["']/i)?.[1]
  if (langAttr) langs.add(langAttr.split('-')[0].toUpperCase())
  // hreflang links — the de-facto multilingual signal.
  for (const m of html.matchAll(/<link\b[^>]*\bhreflang=["']([a-zA-Z-]{2,8})["']/gi)) {
    const code = m[1].split('-')[0].toUpperCase()
    if (code !== 'X') langs.add(code)
  }
  if (langs.size === 0) return null
  return Array.from(langs).sort().join(' · ')
}

// ── The aggregator ─────────────────────────────────────────────────────────

/**
 * Resolve the nine ◐ Queried signals for a domain. If the caller already
 * has the HTML (e.g. from WP-SCOUT-2's puppeteer capture), pass it via
 * `html` to skip a network round-trip; otherwise we fetch it ourselves
 * with a tight timeout.
 *
 * Each leg fails independently — the whole call NEVER throws. A totally
 * dead site returns nine `null` lamps + the raw failure shapes for the
 * dossier to render an honest "queried — nothing came back" state.
 */
export async function researchQueried(
  domain: string,
  opts: { html?: string; htmlTimeoutMs?: number } = {},
): Promise<QueriedSignals> {
  const cleaned = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim()
  const url = `https://${cleaned}`

  // HTML — caller may supply it (puppeteer already grabbed it); otherwise
  // fetch once for the static detectors. A failure here just means the
  // 4 static lamps degrade to `null`; the network legs (DNS/Wayback/PSI)
  // still fire independently.
  const fetchHtml = async (): Promise<string | null> => {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(opts.htmlTimeoutMs ?? 8_000),
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (OskarOS Scout)' },
      })
      if (!r.ok) return null
      return (await r.text()).slice(0, 500_000)  // 500 KB cap — enough for grep
    } catch {
      return null
    }
  }

  // Fire ALL three network legs + HTML fetch (if needed) in parallel.
  const [hosting, age, pagespeed, htmlEither] = await Promise.all([
    lookupHosting(cleaned),
    lookupAge(cleaned),
    lookupPagespeed(url),
    opts.html ? Promise.resolve(opts.html) : fetchHtml(),
  ])

  // Static detectors run on the lowercased HTML for cheap case-insensitive grep.
  const htmlNorm = htmlEither ? htmlEither.toLowerCase() : null
  const stackHits = htmlNorm ? [detectStack(htmlNorm)].filter((x): x is string => !!x) : []
  const stack = htmlNorm ? detectStack(htmlNorm) : null
  const trackers = htmlNorm ? detectTrackers(htmlNorm) : null
  const booking = htmlNorm ? detectBooking(htmlNorm) : null
  const languages = htmlNorm ? detectLanguages(htmlNorm) : null

  // Format each network lamp; empty string → null so the row renders
  // identically across "no source data" and "data but empty".
  const ageStr = formatAgeLamp(age) || null
  const hostingStr = formatHostingLamp(hosting) || null
  const perfStr = formatPerformanceLamp(pagespeed) || null
  const seoStr = formatSeoLamp(pagespeed) || null
  const trafficStr = formatTrafficLamp(pagespeed) || null

  return {
    age: ageStr,
    stack,
    hosting: hostingStr,
    performance: perfStr,
    seo: seoStr,
    traffic: trafficStr,
    trackers,
    booking,
    languages,
    sources: {
      age: 'Wayback CDX',
      stack: 'HTML grep',
      hosting: 'DNS · ASN · PTR',
      performance: 'PageSpeed Lighthouse',
      seo: 'PageSpeed Lighthouse',
      traffic: 'PageSpeed CrUX',
      trackers: 'HTML grep · cookie policy',
      booking: 'HTML grep',
      languages: 'HTML · hreflang',
    },
    raw: { hosting, age, pagespeed, stackHits },
  }
}
