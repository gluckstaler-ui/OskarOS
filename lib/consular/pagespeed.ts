// ============================================================================
// lib/consular/pagespeed.ts — Performance + SEO + Traffic lamps (WP-SCOUT-4)
//
// Ralph 2026-06-03 — one PageSpeed Insights v5 call returns Lighthouse
// (performance + SEO scores) AND CrUX field data (real-user latency cohort).
// We run mobile + desktop in parallel and average the scores; CrUX presence
// is the Traffic signal (a site that gets enough real visits shows up in
// CrUX; thin-traffic sites don't, no matter how fast Lighthouse rates them).
//
// Endpoint:
//   GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed
//     ?url=<url>&strategy=mobile&category=performance&category=seo&key=<KEY>
//
// API key: GOOGLE_API_KEY env var (same key the project already uses for
// Gemini — single Google Cloud project, multiple APIs enabled).
//
// Tone is displacement-opportunity (the Jedi Scout's lens, [SCOUT-L]):
//   perf < 50 / seo < 70 / no CrUX data → GREEN (more to sell into)
// The formatters mark the qualitative band; raw numbers stay available.
//
// Independent-leg discipline: a failed strategy yields nulls for that leg
// (e.g. mobile times out → desktop still fills); a totally-failed lookup
// returns the typed `failed:true` shape — never throws.
// ============================================================================

const PSI_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

export interface PagespeedSignals {
  /** Average of mobile + desktop performance scores (0-100), or null. */
  performance: number | null
  /** Average of mobile + desktop SEO scores (0-100), or null. */
  seo: number | null
  /**
   * "Traffic" is qualitative because PageSpeed doesn't report visit counts.
   * Derived from CrUX cohort presence:
   *   - 'measured · FAST/AVERAGE/SLOW'  → CrUX has enough real-user data
   *   - 'thin · below CrUX threshold'   → no CrUX data (low traffic)
   *   - null                            → both strategies failed
   */
  traffic: string | null
  /** True when both mobile + desktop calls failed. */
  failed: boolean
  /** True when API key is missing — UI may surface "config the key" hint. */
  noApiKey: boolean
}

interface PsiResult {
  ok: true
  performance: number | null
  seo: number | null
  cruxCategory: string | null   // 'FAST' | 'AVERAGE' | 'SLOW' | null
  cruxLcpMs: number | null      // raw 75th-percentile LCP in ms (continuous; feeds the 4-tier traffic lamp)
}
interface PsiFail { ok: false }

async function callPsi(
  url: string,
  strategy: 'mobile' | 'desktop',
  apiKey: string,
  timeoutMs: number,
): Promise<PsiResult | PsiFail> {
  const u = new URL(PSI_BASE)
  u.searchParams.set('url', url)
  u.searchParams.set('strategy', strategy)
  u.searchParams.append('category', 'performance')
  u.searchParams.append('category', 'seo')
  u.searchParams.set('key', apiKey)
  try {
    const r = await fetch(u.toString(), { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return { ok: false }
    type CruxMetric = { percentile?: number; category?: string }
    type CruxBlock = {
      overall_category?: string
      metrics?: { LARGEST_CONTENTFUL_PAINT_MS?: CruxMetric }
    }
    const j = (await r.json()) as {
      lighthouseResult?: { categories?: Record<string, { score?: number }> }
      loadingExperience?: CruxBlock
      originLoadingExperience?: CruxBlock
    }
    const cats = j.lighthouseResult?.categories || {}
    // Lighthouse scores are 0-1 floats; ×100 → 0-100 integer for display.
    const perf = typeof cats.performance?.score === 'number' ? Math.round(cats.performance.score * 100) : null
    const seo = typeof cats.seo?.score === 'number' ? Math.round(cats.seo.score * 100) : null
    // Prefer page-specific CrUX cohort; fall back to origin cohort. Either
    // tells us "real users visit this often enough to be measurable".
    const pageCrux = j.loadingExperience
    const origCrux = j.originLoadingExperience
    const cruxCategory = pageCrux?.overall_category ?? origCrux?.overall_category ?? null
    // Ralph 2026-06-03 · also extract LCP 75th-percentile (ms) — Google's
    // overall_category is only 3 buckets (FAST/AVG/SLOW), so for our 4-tier
    // lamp we need the continuous metric underneath. LCP is the most
    // representative single number (it's also what dominates Google's own
    // ranking signal). Same cohort precedence: page first, origin fallback.
    const cruxLcpMs = pageCrux?.metrics?.LARGEST_CONTENTFUL_PAINT_MS?.percentile
      ?? origCrux?.metrics?.LARGEST_CONTENTFUL_PAINT_MS?.percentile
      ?? null
    return { ok: true, performance: perf, seo, cruxCategory, cruxLcpMs }
  } catch {
    return { ok: false }
  }
}

export async function lookupPagespeed(url: string, timeoutMs = 25_000): Promise<PagespeedSignals> {
  // Ralph 2026-06-03 · key fallback chain. PAGESPEED_API_KEY (dedicated)
  // wins so a key with looser API restrictions can be dropped in without
  // touching the shared GOOGLE_API_KEY that other integrations use (Images,
  // Maps, etc.). Falls back to GOOGLE_API_KEY for backwards compatibility.
  // Diagnostic: the previous setup hit `API_KEY_SERVICE_BLOCKED` because
  // GOOGLE_API_KEY had an API-restriction list that excluded PageSpeed.
  const apiKey = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_API_KEY || ''
  if (!apiKey) {
    return { performance: null, seo: null, traffic: null, failed: true, noApiKey: true }
  }
  // Scheme-normalize so bare domains work the way the rest of the Scout does.
  const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^www\./, '')}`

  // Mobile + desktop in parallel — independent legs, neither blocks the other.
  // PSI is SLOW (10-25s per call cold), so the timeout is generous.
  const [mobile, desktop] = await Promise.all([
    callPsi(fullUrl, 'mobile', apiKey, timeoutMs),
    callPsi(fullUrl, 'desktop', apiKey, timeoutMs),
  ])

  if (!mobile.ok && !desktop.ok) {
    return { performance: null, seo: null, traffic: null, failed: true, noApiKey: false }
  }

  // Average across legs that succeeded; skip nulls.
  const avg = (xs: (number | null)[]) => {
    const okv = xs.filter((x): x is number => typeof x === 'number')
    return okv.length === 0 ? null : Math.round(okv.reduce((a, b) => a + b, 0) / okv.length)
  }
  const perf = avg([mobile.ok ? mobile.performance : null, desktop.ok ? desktop.performance : null])
  const seo  = avg([mobile.ok ? mobile.seo         : null, desktop.ok ? desktop.seo         : null])

  // CrUX presence — prefer mobile's signal (where real users live for SMB sites);
  // fall back to desktop's. Either means "site has enough traffic to be measured".
  const crux = (mobile.ok && mobile.cruxCategory) || (desktop.ok && desktop.cruxCategory) || null
  // Ralph 2026-06-03 · 4-tier traffic label driven by raw LCP percentile.
  // Google's `overall_category` only gives 3 buckets; the continuous LCP
  // value below subdivides the messy "AVERAGE" range (2.5-4.0s) into two
  // halves so 2.8s (almost fast) reads visibly different from 3.8s (almost
  // slow). Thresholds use Google's own LCP cutoffs for good/poor (2.5s,
  // 4.0s); the 3.25s split is the midpoint of the in-between band.
  const lcpMs = (mobile.ok && mobile.cruxLcpMs) || (desktop.ok && desktop.cruxLcpMs) || null
  let traffic: string
  if (lcpMs != null) {
    const sec = (lcpMs / 1000).toFixed(1)
    if (lcpMs < 2500)      traffic = `LCP ${sec}s · fast`
    else if (lcpMs < 3250) traffic = `LCP ${sec}s · ok`
    else if (lcpMs < 4000) traffic = `LCP ${sec}s · slow`
    else                   traffic = `LCP ${sec}s · poor`
  } else if (crux) {
    // No LCP percentile but we have an overall category — keep it informative.
    traffic = `measured · ${crux}`
  } else {
    traffic = 'thin · below CrUX threshold'
  }

  return { performance: perf, seo, traffic, failed: false, noApiKey: false }
}

/**
 * Compact lamp formatters. Numbers stay raw for downstream sorts; the string
 * form is what the row's strip displays.
 */
// Ralph 2026-06-03 · 4-tier labels mirror the 4-tier tone in types.ts:
//   ≥90 fast/clean (green) · 70-89 ok (yellow) · 50-69 slow/low (orange) · <50 poor (red)
export function formatPerformanceLamp(s: PagespeedSignals): string {
  if (s.performance == null) return ''
  if (s.performance >= 90) return `${s.performance} · fast`
  if (s.performance >= 70) return `${s.performance} · ok`
  if (s.performance >= 50) return `${s.performance} · slow`
  return `${s.performance} · poor`
}
export function formatSeoLamp(s: PagespeedSignals): string {
  if (s.seo == null) return ''
  if (s.seo >= 90) return `${s.seo} · clean`
  if (s.seo >= 70) return `${s.seo} · ok`
  if (s.seo >= 50) return `${s.seo} · low`
  return `${s.seo} · poor`
}
export function formatTrafficLamp(s: PagespeedSignals): string {
  return s.traffic || ''
}
