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
import { lookupReviews,    formatReviewsLamp,    type ReviewsInfo }    from './reviews'

export interface QueriedSignals {
  // The eleven lamps — all string-or-null for symmetric rendering. Raw blobs
  // (the typed lookup returns) are kept under `raw` for callers that want
  // the numbers / structured data.
  age: string | null
  stack: string | null
  hosting: string | null
  performance: string | null
  seo: string | null
  traffic: string | null
  reviews: string | null      // Ralph 2026-06-06 — new lamp (DDG-backed lookup).
  // Ralph 2026-06-06 — `trackers` split into `analytics` (measurement: GA4,
  // Hotjar, Matomo, Plausible) and `marketing` (retargeting pixels: Meta,
  // Google Ads conversion, LinkedIn Insight Tag). The displacement read is
  // sharper when the two are separated — Filippo sells "you measure but
  // don't retarget" vs "you retarget without a CMP."
  analytics: string | null
  marketing: string | null
  booking: string | null
  languages: string | null
  // Ralph 2026-06-06 — three additional easy lamps shipped alongside the
  // trackers split. SaaS/CRM is HTML grep across 8 common platforms;
  // industry + location lift from schema.org JSON-LD where present.
  saas: string | null
  industry: string | null
  location: string | null
  /** Ralph 2026-06-10 (TASTED redesign) — sections counted across the site's
   *  pages (homepage + same-origin nav links, capped). Code counts, no LLM;
   *  feeds the SECTIONS lamp + anchors the agent's CHF estimate. Label is
   *  "<total> · <n> pages". */
  sections: string | null
  /** WP-21 (2026-06-10) — the per-page breakdown behind the sections count
   *  ("/ 7 · /angebot 4 · /team 3"). The breakdown IS the citation for the
   *  lamp; promote carries it onto intel_json as `sections_detail`. */
  sections_detail: string | null
  /** Where each lamp came from — for the dossier's "source" tags. */
  sources: Record<string, string>
  /** Raw lookup payloads (numbers, ASNs, capture counts, …). */
  raw: {
    hosting: HostingInfo | null
    age: WaybackAge | null
    pagespeed: PagespeedSignals | null
    reviews: ReviewsInfo | null
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

// Takes the ORIGINAL-case HTML (reads the <meta generator> + footer credit with
// case intact) and lowercases internally for path grep. "custom / unknown" is
// gone: the residual is "static / hand-coded" (genuinely no fingerprint) or a
// "placeholder / redirect" stub — both honest, neither a detector blind spot.
export function detectStack(htmlRaw: string): string {
  const html = htmlRaw
  const h = html.toLowerCase()

  // 0. Placeholder / redirect — not a real site (meta-refresh to a directory
  //    profile, or a near-empty "coming soon" page).
  if (html.length < 600 || /<meta[^>]+http-equiv=["']refresh["'][^>]*\burl=/i.test(html)) return 'placeholder / redirect'

  // 1. <meta generator> — the site's own self-declaration. The single richest
  //    signal, and the one the old detector ignored (TYPO3/CMSimple/WebSite X5/…).
  const gen = html.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/i)?.[1]?.trim()
  if (gen) {
    const g = gen.toLowerCase()
    if (g.includes('wordpress')) return 'WordPress'
    if (g.includes('typo3')) return 'TYPO3'
    if (g.includes('joomla')) return 'Joomla'
    if (g.includes('drupal')) return 'Drupal'
    if (g.includes('wix')) return 'Wix'
    if (g.includes('squarespace')) return 'Squarespace'
    if (g.includes('contao')) return 'Contao'
    if (g.includes('cmsimple')) return 'CMSimple'
    if (g.includes('websitex5') || g.includes('website x5')) return 'WebSite X5'
    if (g.includes('serif') || g.includes('webplus')) return 'Serif WebPlus'
    if (g.includes('basekit')) return 'BaseKit'
    if (g.includes('mobirise')) return 'Mobirise'
    if (g.includes('hugo')) return 'Hugo'
    if (g.includes('gatsby')) return 'Gatsby'
    return gen.length <= 28 ? gen : gen.slice(0, 28) // unknown but self-declared — beats "unknown"
  }

  // 2. Platform asset / path markers (specific → general).
  if (h.includes('wp-content') || h.includes('wp-includes') || h.includes('wp-json')) return 'WordPress'
  if (h.includes('typo3conf') || h.includes('typo3temp') || h.includes('/fileadmin/')) return 'TYPO3'
  if (h.includes('/media/jui/') || h.includes('com_content') || h.includes('option=com_')) return 'Joomla'
  if (h.includes('/bundles/contao') || h.includes('/tl_files/')) return 'Contao'
  if (h.includes('sites/default/files') || h.includes('drupal-settings-json')) return 'Drupal'
  if (h.includes('cdn.shopify') || h.includes('shopify_assets')) return 'Shopify'
  if (h.includes('squarespace') || h.includes('sqsp.net')) return 'Squarespace'
  if (h.includes('wix.com') || h.includes('_wixcss') || h.includes('parastorage.com')) return 'Wix'
  if (h.includes('jimdo')) return 'Jimdo'
  if (h.includes('webflow') || h.includes('assets.website-files')) return 'Webflow'
  if (h.includes('framerusercontent') || h.includes('framerstatic')) return 'Framer'
  if (h.includes('weebly') || h.includes('editmysite')) return 'Weebly'
  if (h.includes('webnode')) return 'Webnode'

  // 3. Swiss / builder SaaS the long tail actually uses (the old detector's gap).
  if (h.includes('digitalone.site') || h.includes('map.search.ch') || /localsearch|mywebsite/i.test(h)) return 'localsearch MyWEBSITE'
  if (/(cdn|app)\.one\.com|simplesite/.test(h)) return 'one.com builder'
  if (h.includes('ionos') || h.includes('1and1')) return 'IONOS MyWebsite'

  // 4. Dev frameworks (a custom-built app — different lead type than a builder).
  if (h.includes('/livewire/livewire.js') || h.includes('wire-end:') || h.includes('wire:id')) return 'Laravel (Livewire)'
  if (h.includes('/_next/static/') || h.includes('__next_data__')) return 'Next.js'
  if (h.includes('_nuxt') || h.includes('__nuxt')) return 'Nuxt'
  if (h.includes('drupal')) return 'Drupal'

  // 5. Footer credit — Swiss SMB sites name their agency/builder ("Webdesign X").
  const credit = html.match(/(?:powered by|realisiert (?:durch|von)|webdesign|web design|created by)\s*:?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .&'-]{2,38})/i)?.[1]?.trim()
  if (credit) return `built by ${credit}`

  // 6. No platform fingerprint anywhere — genuinely hand-coded static HTML.
  return 'static / hand-coded'
}

// CMP / consent-layer markers — the loader script + widget classes that ship
// in the page (cookiebot's uc.js, OneTrust's optanon, Borlabs on German WP,
// usercentrics, etc.). Far broader than the old 5-name list, which is why
// real consent layers were read as "none".
const CMP_RE = /cookiebot|usercentrics|onetrust|optanon|otsdkstub|borlabs|klaro|iubenda|complianz|cookieconsent|cookie-?consent|cookiefirst|cookieyes|cookie-?notice|real-?cookie-?banner|termly|didomi|axeptio|osano|consentmanager|quantcast|sourcepoint|sp_consent|civic.{0,4}cookie|tarteaucitron|orejime|wpcc|moove_gdpr|gdpr-?cookie/i
// A plain privacy/cookie policy LINK or wording counts as disclosure too — a
// Datenschutz link in the footer is disclosure even without a fancy banner.
const POLICY_LINK_RE = /datenschutz|privacy-?policy|privacy_policy|cookie-?policy|cookie-?richtlinie|cookie-?hinweis|cookie-?erkl|politique-de-confidentialit|informativa-privacy|privacybeleid/i
const CONSENT_WORDING_RE = /wir verwenden cookies|diese (website|webseite|seite) verwendet cookies|uses cookies|nutzt cookies|verwendung von cookies|cookie-?einstellungen|cookie settings|manage cookies/i
// A JS shell we can't read: a tiny body or framework boot markers. On these the
// raw HTML tells us NOTHING about consent — so "absence" is unknowable, never ⚠.
const SPA_SHELL_RE = /__nuxt|__next_data__|window\.__|ng-version|data-reactroot|id=["'](app|root|__nuxt|__next)["']/i

/**
 * Format one tracker-category hit list with the same SPA-aware disclosure
 * warning logic both `detectAnalytics` and `detectMarketing` use. Splits
 * the prior `detectTrackers` so each lamp renders its own value (Filippo
 * wants Analytics and Marketing as distinct lamps in the Big-6/Small-7
 * split — measurement tools vs retargeting pixels carry different
 * displacement-opportunity meanings).
 */
function formatTrackerHits(hits: string[], html: string): string | null {
  if (hits.length === 0) return '— none detected'

  // "Tracking present + no consent/disclosure" is the displacement pitch — but
  // ONLY claim it when we can actually SEE the absence. Disclosure = a CMP
  // library, OR a privacy/cookie-policy link, OR consent wording in the page.
  if (CMP_RE.test(html) || POLICY_LINK_RE.test(html) || CONSENT_WORDING_RE.test(html)) {
    return hits.join(' · ')
  }
  // No disclosure found. If this is a JS shell (SPA), the banner is rendered
  // client-side and we simply can't see it from this HTML — say so honestly,
  // don't fabricate a compliance gap.
  if (html.length < 4000 || SPA_SHELL_RE.test(html)) {
    return `${hits.join(' · ')} · cookie policy unknown (JS-rendered)`
  }
  return `${hits.join(' · ')} · no cookie policy ⚠`
}

/**
 * Analytics — what they MEASURE. GA4, Hotjar, Matomo, Plausible. The
 * displacement pitch when these light up alone (no marketing pixels) is
 * "you instrument but don't activate" — Filippo sells the retargeting
 * layer on top.
 */
function detectAnalytics(html: string): string | null {
  const hits: string[] = []
  if (/gtag\s*\(|googletagmanager\.com\/gtag\/js|G-[A-Z0-9]{6,}/i.test(html)) hits.push('GA4')
  if (/static\.hotjar\.com|hjBootstrap/i.test(html))                          hits.push('Hotjar')
  if (/cdn\.matomo\.cloud|_paq\.push/i.test(html))                            hits.push('Matomo')
  if (/plausible\.io\/js\//i.test(html))                                      hits.push('Plausible')
  return formatTrackerHits(hits, html)
}

/**
 * Marketing — who they RETARGET. Meta Pixel, Google Ads conversion tag
 * (AW-* IDs distinct from GA4's G-* IDs), LinkedIn Insight Tag. The
 * displacement pitch when these light up without a CMP is the strongest
 * "you have a compliance gap" sell — retargeting pixels are the GDPR
 * high-stakes layer the FFs of the world will pay to fix.
 */
function detectMarketing(html: string): string | null {
  const hits: string[] = []
  if (/connect\.facebook\.net\/[a-z_]+\/fbevents\.js|fbq\s*\(['"]/i.test(html)) hits.push('Meta')
  // Google Ads conversion tag IDs are `AW-...` (distinct from GA4's `G-...`).
  // Catch both gtag('config', 'AW-...') and google_conversion_id legacy form.
  if (/gtag\s*\(\s*['"]config['"]\s*,\s*['"]AW-[0-9]+|google_conversion_id\s*=/i.test(html)) hits.push('Google Ads')
  if (/snap\.licdn\.com\/li\.lms-analytics\/insight\.min\.js|_linkedin_partner_id\s*=/i.test(html)) hits.push('LinkedIn')
  return formatTrackerHits(hits, html)
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

/**
 * SaaS / CRM detector v1 (Ralph 2026-06-06). Pure HTML grep, same shape as
 * `detectStack` / `detectBooking`. The first hit wins to keep the lamp
 * single-valued; if more than one CRM is loaded (rare — usually a
 * Salesforce-on-the-website + HubSpot-for-marketing combo) the most
 * load-bearing one shows.
 *
 * Honest scope: a v1 grep across 8 common platforms. Each platform ships
 * multiple obfuscated signature variants; signatures churn. Hit rate
 * against real Swiss SMEs is the open question — instrumenting which
 * platforms light up at all is the next step. Maintenance burden is real:
 * expect to refresh patterns quarterly as platforms re-version their
 * snippets.
 */
function detectSaas(html: string): string | null {
  if (/hs-scripts\.com|js\.hsforms\.net|_hsq\.push|hbspt\.forms|hs-analytics\.net|track\.hubspot\.com/i.test(html)) return 'HubSpot'
  if (/salesforce\.com\/(?:engage|sites|s)|s\.cdn\.forcecf\.com|pardot\.com|_pardot/i.test(html))                  return 'Salesforce'
  if (/pipedrive\.com|pipedrive-leadbooster|cf\.leadbooster\.com/i.test(html))                                     return 'Pipedrive'
  if (/widget\.intercom\.io|intercomcdn\.com|intercomSettings/i.test(html))                                        return 'Intercom'
  if (/js\.driftt\.com|drift\.com\/embed|driftSettings/i.test(html))                                               return 'Drift'
  if (/chimpstatic\.com|list-manage\.com|mailchimp\.com\/mc/i.test(html))                                          return 'Mailchimp'
  if (/static\.zdassets\.com|zendesk\.com\/embeddable|zESettings/i.test(html))                                     return 'Zendesk'
  if (/activehosted\.com|trackcmp\.net/i.test(html))                                                               return 'ActiveCampaign'
  if (/zohopublic\.com|zoho\.com\/(?:crm|desk|forms)|zohostatic\.com/i.test(html))                                 return 'Zoho'
  return '— none detected'   // green tone: no embedded CRM = white-space pitch
}

// ── JSON-LD parsing (Ralph 2026-06-06). ────────────────────────────────────
//
// Industry + Location lamps lift from schema.org JSON-LD blocks, which are
// the cleanest structured-data source on a real website. Sites that bothered
// to ship `<script type="application/ld+json">` blocks tend to be the ones
// with actual SEO investment — useful displacement signal in itself.
//
// We tolerate the four common shapes:
//   1. A single object: { "@type": "Organization", ... }
//   2. An array of objects: [{...}, {...}]
//   3. A @graph wrapper: { "@graph": [{...}, {...}] }
//   4. Multiple <script type="application/ld+json"> tags on the same page
//
// Failures (malformed JSON, missing fields) degrade to null — honest "—".

const JSONLD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
const ORG_TYPE_RE = /^(?:Organization|LocalBusiness|ProfessionalService|LegalService|MedicalBusiness|FoodEstablishment|Restaurant|Store|Dentist|HealthAndBeautyBusiness|Corporation|EducationalOrganization|NGO|GovernmentOrganization)$/i

interface JsonLdItem {
  '@type'?: string | string[]
  '@graph'?: JsonLdItem[]
  industry?: string
  address?: string | { addressLocality?: string; addressRegion?: string; addressCountry?: string | { name?: string } }
  [k: string]: unknown
}

function jsonLdItems(html: string): JsonLdItem[] {
  const items: JsonLdItem[] = []
  for (const m of html.matchAll(JSONLD_RE)) {
    try {
      const parsed = JSON.parse(m[1].trim())
      const arr = Array.isArray(parsed) ? parsed : (parsed['@graph'] ?? [parsed])
      for (const it of arr) {
        if (it && typeof it === 'object') items.push(it as JsonLdItem)
      }
    } catch { /* malformed — skip, NEVER fabricate */ }
  }
  return items
}

/**
 * Industry — read the schema.org `@type` of any Organization-ish JSON-LD
 * item on the page. Subtype wins over the generic "Organization" (a
 * LegalService is more useful than "Organization"). Bare-Organization
 * sites get the explicit `industry` string if they shipped one. Null
 * means the site has no structured-data declaration — common on small
 * Swiss SMEs.
 */
function detectIndustry(html: string): string | null {
  let best: string | null = null
  for (const item of jsonLdItems(html)) {
    const types = Array.isArray(item['@type']) ? item['@type'] : (item['@type'] ? [item['@type']] : [])
    for (const t of types) {
      if (typeof t !== 'string') continue
      if (!ORG_TYPE_RE.test(t)) continue
      // Prefer explicit `industry` string when present.
      if (typeof item.industry === 'string' && item.industry.length <= 80) return item.industry
      // Else hold the type; bias toward subtypes (anything that's not the
      // bare "Organization" string) since they carry more info.
      if (t.toLowerCase() !== 'organization' || best == null) best = t
    }
  }
  return best
}

/**
 * Location — `address.addressLocality` (+ optional country) from any
 * PostalAddress on the page. We don't try to disambiguate multiple
 * branches; the first valid address wins. Null means no structured
 * address present.
 */
function detectLocation(html: string): string | null {
  for (const item of jsonLdItems(html)) {
    const addr = item.address
    if (!addr) continue
    if (typeof addr === 'string') {
      // Free-text address — return as-is if reasonably short.
      const trimmed = addr.trim()
      if (trimmed.length >= 3 && trimmed.length <= 120) return trimmed
      continue
    }
    if (typeof addr === 'object') {
      const city = addr.addressLocality?.trim() || addr.addressRegion?.trim()
      if (!city) continue
      const country =
        typeof addr.addressCountry === 'string'
          ? addr.addressCountry.trim()
          : addr.addressCountry?.name?.trim()
      return country ? `${city} · ${country}` : city
    }
  }
  return null
}

// ── Sections counter (Ralph 2026-06-10 · TASTED redesign) ──────────────────
//
// Counts buildable page sections across the site: per page, max(<section>
// tag count, h2 count, 1) — designers structure pages by section tags or by
// h2 blocks; whichever the site uses, one of the two catches it. Crawls the
// homepage's same-origin links, capped at 6 extra pages with tight timeouts;
// a dead link just drops out. The total anchors the agent's CHF estimate
// (≈ CHF 300/section as the sanity anchor) and renders as the SECTIONS lamp.

function countPageSections(html: string): number {
  const sec = (html.match(/<section[\s>]/gi) || []).length
  const h2 = (html.match(/<h2[\s>]/gi) || []).length
  return Math.max(sec, h2, 1)
}

async function countSiteSections(
  homeUrl: string,
  homeHtml: string,
): Promise<{ label: string; detail: string } | null> {
  try {
    const origin = new URL(homeUrl).origin
    const seen = new Set<string>()
    const links: string[] = []
    for (const m of homeHtml.matchAll(/href=["']([^"'#?]+)[^"']*["']/gi)) {
      let u: URL
      try { u = new URL(m[1], origin) } catch { continue }
      if (u.origin !== origin) continue
      if (/\.(jpe?g|png|webp|svg|gif|pdf|zip|mp4|css|js|xml|ico|woff2?)$/i.test(u.pathname)) continue
      if (!u.pathname || u.pathname === '/') continue
      const norm = `${u.origin}${u.pathname}`.replace(/\/$/, '')
      if (seen.has(norm)) continue
      seen.add(norm)
      links.push(norm)
      if (links.length >= 6) break
    }
    const pages = await Promise.all(links.map(async (l) => {
      try {
        const r = await fetch(l, {
          signal: AbortSignal.timeout(4_000),
          redirect: 'follow',
          headers: { 'user-agent': 'Mozilla/5.0 (OskarOS Scout)' },
        })
        if (!r.ok) return null
        return {
          path: new URL(l).pathname.replace(/\/$/, '') || '/',
          html: (await r.text()).slice(0, 300_000),
        }
      } catch { return null }
    }))
    // WP-21 (2026-06-10) — keep the per-page breakdown alongside the total:
    // the breakdown IS the citation ("/ 7 · /angebot 4"). Homepage renders
    // as "/".
    const homeCount = countPageSections(homeHtml)
    const parts: string[] = [`/ ${homeCount}`]
    let total = homeCount
    let pageCount = 1
    for (const pg of pages) {
      if (!pg) continue
      const n = countPageSections(pg.html)
      total += n
      pageCount += 1
      parts.push(`${pg.path} ${n}`)
    }
    return {
      label: `${total} · ${pageCount} page${pageCount === 1 ? '' : 's'}`,
      detail: parts.join(' · '),
    }
  } catch {
    return null
  }
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

  // HTML for the static detectors. Precedence:
  //   1. caller-supplied `opts.html` — the taste flow passes captureUrl's
  //      already-RENDERED DOM, so we use it directly (no fetch, no double render);
  //   2. a plain fetch — fast, correct for server-rendered sites;
  //   3. if that fetch comes back a JS shell (a Nuxt/Next/Vue SPA ships a near-
  //      empty raw HTML), RENDER it in Chromium so the cookie banner + the
  //      Datenschutz link the detector needs are actually present. Without this,
  //      the "no cookie policy ⚠" flag false-positives on every SPA (it sees the
  //      GA snippet in the shell but the consent layer is injected by JS later).
  // A total failure just degrades the 4 static lamps to null; the network legs
  // (DNS/Wayback/PSI) fire independently.
  const fetchHtml = async (): Promise<string | null> => {
    let raw: string | null = null
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(opts.htmlTimeoutMs ?? 8_000),
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (OskarOS Scout)' },
      })
      if (r.ok) raw = (await r.text()).slice(0, 500_000)  // 500 KB cap — enough for grep
    } catch { /* raw stays null */ }

    const looksLikeShell =
      !raw || raw.length < 4000 ||
      /__nuxt|__next_data__|ng-version|data-reactroot|id=["'](app|root|__nuxt|__next)["']/i.test(raw)
    if (looksLikeShell) {
      try {
        // Lazy import — keeps puppeteer out of this module's bundle unless an
        // SPA actually forces a render.
        const { fetchRenderedHtml } = await import('@/lib/screenshot')
        const rendered = await fetchRenderedHtml(url)
        if (rendered) return rendered.slice(0, 800_000)
      } catch { /* puppeteer unavailable → fall back to the raw shell */ }
    }
    return raw
  }

  // Fire ALL network legs + HTML fetch in parallel. Reviews uses the cleaned
  // domain (no protocol) so we can derive a likely company name from it; the
  // lookup is best-effort and degrades to null gracefully if DDG returns
  // nothing parseable.
  const [hosting, age, pagespeed, reviews, htmlEither] = await Promise.all([
    lookupHosting(cleaned),
    lookupAge(cleaned),
    lookupPagespeed(url),
    lookupReviews(cleaned),
    opts.html ? Promise.resolve(opts.html) : fetchHtml(),
  ])

  // Static detectors run on the lowercased HTML for cheap case-insensitive grep.
  const htmlNorm = htmlEither ? htmlEither.toLowerCase() : null
  const stack = htmlEither ? detectStack(htmlEither) : null
  const stackHits = stack ? [stack] : []
  // Ralph 2026-06-06 — trackers split into analytics + marketing (Big-6/Small-7
  // distinction). Both functions share the same SPA-aware disclosure logic.
  const analytics = htmlNorm ? detectAnalytics(htmlNorm) : null
  const marketing = htmlNorm ? detectMarketing(htmlNorm) : null
  const booking = htmlNorm ? detectBooking(htmlNorm) : null
  const languages = htmlNorm ? detectLanguages(htmlNorm) : null
  // Ralph 2026-06-06 — SaaS grep runs on lowercased HTML. Industry + Location
  // need the ORIGINAL HTML (JSON-LD content is case-sensitive — addressLocality
  // wouldn't match if we lowercased).
  const saas = htmlNorm ? detectSaas(htmlNorm) : null
  const industry = htmlEither ? detectIndustry(htmlEither) : null
  const location = htmlEither ? detectLocation(htmlEither) : null
  // Sections — needs the homepage HTML + a bounded same-origin crawl.
  const sectionsRes = htmlEither ? await countSiteSections(url, htmlEither) : null

  // Format each network lamp; empty string → null so the row renders
  // identically across "no source data" and "data but empty".
  const ageStr = formatAgeLamp(age) || null
  const hostingStr = formatHostingLamp(hosting) || null
  const perfStr = formatPerformanceLamp(pagespeed) || null
  const seoStr = formatSeoLamp(pagespeed) || null
  const trafficStr = formatTrafficLamp(pagespeed) || null
  const reviewsStr = formatReviewsLamp(reviews) || null

  return {
    age: ageStr,
    stack,
    hosting: hostingStr,
    performance: perfStr,
    seo: seoStr,
    traffic: trafficStr,
    reviews: reviewsStr,
    analytics,
    marketing,
    booking,
    languages,
    saas,
    industry,
    location,
    sections: sectionsRes?.label ?? null,
    sections_detail: sectionsRes?.detail ?? null,
    sources: {
      age: 'Wayback CDX',
      stack: 'HTML grep',
      hosting: 'DNS · ASN · PTR',
      performance: 'PageSpeed Lighthouse',
      seo: 'PageSpeed Lighthouse',
      traffic: 'PageSpeed CrUX',
      reviews: 'DuckDuckGo · Google Business',
      analytics: 'HTML grep · cookie policy',
      marketing: 'HTML grep · cookie policy',
      booking: 'HTML grep',
      languages: 'HTML · hreflang',
      saas: 'HTML grep',
      industry: 'schema.org JSON-LD',
      location: 'schema.org JSON-LD',
      sections: 'HTML crawl · section count',
      sections_detail: 'HTML crawl · per-page breakdown',
    },
    raw: { hosting, age, pagespeed, reviews, stackHits },
  }
}
