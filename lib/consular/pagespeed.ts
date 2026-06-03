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
    const j = (await r.json()) as {
      lighthouseResult?: {
        categories?: Record<string, { score?: number }>
      }
      loadingExperience?: { overall_category?: string }
      originLoadingExperience?: { overall_category?: string }
    }
    const cats = j.lighthouseResult?.categories || {}
    // Lighthouse scores are 0-1 floats; ×100 → 0-100 integer for display.
    const perf = typeof cats.performance?.score === 'number' ? Math.round(cats.performance.score * 100) : null
    const seo = typeof cats.seo?.score === 'number' ? Math.round(cats.seo.score * 100) : null
    // Prefer page-specific CrUX cohort; fall back to origin cohort. Either
    // tells us "real users visit this often enough to be measurable".
    const cruxCategory = j.loadingExperience?.overall_category
      ?? j.originLoadingExperience?.overall_category
      ?? null
    return { ok: true, performance: perf, seo, cruxCategory }
  } catch {
    return { ok: false }
  }
}

export async function lookupPagespeed(url: string, timeoutMs = 25_000): Promise<PagespeedSignals> {
  const apiKey = process.env.GOOGLE_API_KEY || ''
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
  const traffic = crux
    ? `measured · ${crux}`            // 'FAST' / 'AVERAGE' / 'SLOW'
    : 'thin · below CrUX threshold'   // No real-user data = low-traffic site

  return { performance: perf, seo, traffic, failed: false, noApiKey: false }
}

/**
 * Compact lamp formatters. Numbers stay raw for downstream sorts; the string
 * form is what the row's strip displays.
 */
export function formatPerformanceLamp(s: PagespeedSignals): string {
  if (s.performance == null) return ''
  if (s.performance >= 90) return `${s.performance} · fast`
  if (s.performance >= 50) return `${s.performance} · ok`
  return `${s.performance} · slow`     // green tone: more to sell into
}
export function formatSeoLamp(s: PagespeedSignals): string {
  if (s.seo == null) return ''
  if (s.seo >= 90) return `${s.seo} · clean`
  if (s.seo >= 70) return `${s.seo} · ok`
  return `${s.seo} · low`              // green tone: SEO room to grow
}
export function formatTrafficLamp(s: PagespeedSignals): string {
  return s.traffic || ''
}
