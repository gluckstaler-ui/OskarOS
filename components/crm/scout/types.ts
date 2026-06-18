// ============================================================================
// components/crm/scout/types.ts — shared types for the Scout pool UI
// (WP-SCOUT-7, Ralph 2026-06-03). Split out of the old monolithic
// components/crm/ScoutPool.tsx so the four spec'd components
// (ScoutPool · ScoutRow · ScoutDossier · DecisionDeck) can import one
// canonical surface instead of redeclaring shapes in each file.
// ============================================================================

import { palateBand, tagFromLegacyHeat, isVerdictTag, isVerdictTone, verdictTagTone, type VerdictTone } from '@/lib/verdict'

export interface RawProspect {
  id: string
  source: string
  scraped_at: string
  raw_payload: string
  name: string
  company: string
  phone: string
  email: string
  website: string
  country: string
  industry: string
  promoted_at: string | null
  promoted_to: string | null
  rejected_at: string | null
  rejected_reason: string | null
  scout_json: string
}

// Ralph 2026-06-10 · TASTED redesign — ONE language with Kanban's intel_json:
// the unified teardown keys are IDENTICAL on both blobs (verdict_tag /
// verdict_tone / verdict_subline / verdict_prose / who / chf_est / heads /
// buying / switching_pain / pitch) so a promote is a row move with zero field
// translation. Legacy keys (palate_choice → who, execution → buying, verdict
// → verdict_subline, heat → tone) stay READABLE via the *Of helpers below —
// never written again, no destructive migration. PALAT/BUDGET is DERIVED from
// chf_est ÷ heads (lib/verdict palateBand) and never stored.
export type Taste = {
  /** WHO — the portrait, the report's centrepiece. Same key on intel_json. */
  who?: string | null
  /** BUYING readiness 0–5 (cited seed; Kanban ripens it). Same key on intel_json. */
  buying?: number | null
  /** One-line verdict under the tag. Same key on intel_json. */
  verdict_subline?: string | null
  /** Signal bullets — one per line, rendered as › rows. Same key on intel_json. */
  verdict_prose?: string | null
  /** The Consular's words — free text; PERSUE · WARMING UP · WATCH · SKIP are
   *  house defaults, not a straitjacket. Same key on intel_json. */
  verdict_tag?: string | null
  /** THE four-value contract: good · mid · low · bad (rendered green ·
   *  phosphor · orange · red). Stored explicitly; tag/heat derivations are
   *  fallback only. Same key on intel_json. */
  verdict_tone?: string | null
  /** Realistic CHF redesign estimate. Editable. Same key on intel_json. */
  chf_est?: number | null
  /** Team headcount counted from the site (1 = solo/unclear). Same key on intel_json. */
  heads?: number | null
  /** How dug-in the incumbent is — free text. Same key on intel_json. */
  switching_pain?: string | null
  /** WHAT TO PITCH — one row per line, trailing « · price». Same key on intel_json. */
  pitch?: string | null
  /** Design quality 0–5 (evidence lamp) + one-line citation. */
  design?: number | null
  design_cite?: string | null
  /** Photos quality 0–5 + citation. LEGACY rows hold the old prose string. */
  photos?: number | string | null
  photos_cite?: string | null

  // ── LEGACY (read-only, never written again) ────────────────────────────
  /** LEGACY: stored palate 1–5; PALAT now derives from chf_est ÷ heads. */
  palate?: number | null
  /** LEGACY: was execution 1–5 (build realisation), then briefly BUYING. */
  execution?: number | null
  /** LEGACY: derived gap; retired. */
  gap?: number | null
  /** LEGACY: hot/warm/cold; read-maps to a tone. */
  heat?: string | null
  /** LEGACY: "the choice" / the old WHO; read-maps to who. */
  palate_choice?: string | null
  /** LEGACY: the old one-line verdict; read-maps to verdict_subline. */
  verdict?: string | null
}

export type Queried = Record<string, string | null>

/**
 * Capture record left on `scout_json` by WP-SCOUT-5 once the Taste batch
 * runs `captureUrl()` (lib/screenshot.ts). All fields optional so a
 * pre-WP-5 row still parses — we just render the "not yet captured" state.
 */
export type Capture = {
  fullPageUrl?: string | null
  /** Practitioner's own page on a shared-site (Gemeinschaftspraxis). Optional;
   *  null on solo sites. Stacks ABOVE the full-page shot in the dossier. */
  profilePageUrl?: string | null
  innerPageUrl?: string | null
  capturedAt?: string | null
  failed?: boolean | null
  fail_reason?: string | null
}

export type Scout = {
  scanned_at?: string
  taste?: Taste
  queried?: Queried
  capture?: Capture
  failed?: boolean
  fail_reason?: string | null
}

export type RowState = 'greenfield' | 'scouted' | 'raw'
export type Heat = 'hot' | 'warm' | 'cold'
export type FilterKey = 'all' | 'persue' | 'warming' | 'watch' | 'skip' | 'stale' | 'raw' | 'green' | 'scouted'

/** Filter chip key → verdict TONE. Filters key off the stored tone (the
 *  contract), not the tag — tags are the Consular's free text and can't be
 *  enumerated. Chip labels keep the house-default names. */
export const FILTER_TONE: Record<string, VerdictTone> = {
  persue: 'good', warming: 'mid', watch: 'low', skip: 'bad',
}

// ── Pure helpers (no React, no DOM) ──────────────────────────────────────

/** JSON parse that never throws — empty/malformed → the fallback. */
export function parseJSON<T>(s: string, fb: T): T {
  try { return JSON.parse(s || '') as T } catch { return fb }
}

/** Read the scout_json blob. Always returns an object (never undefined). */
export function scoutOf(p: RawProspect): Scout {
  return parseJSON<Scout>(p.scout_json, {})
}

/** Derive the row state from disk fields + scout_json — never stored. */
export function stateOf(p: RawProspect): RowState {
  if (!p.website) return 'greenfield'
  return scoutOf(p).scanned_at ? 'scouted' : 'raw'
}

/** LEGACY (retired 2026-06-10) — gap = palate − execution on pre-redesign rows.
 *  Only feeds the legacy heat → tag read-mapping below; no new derivation. */
export function gapOf(t: Taste): number | null {
  return typeof t.palate === 'number' && typeof t.execution === 'number'
    ? t.palate - t.execution
    : null
}

/** LEGACY band — kept solely so old rows (heat never stored) still map to a tag. */
export const HEAT = (g: number): Heat => (g >= 2 ? 'hot' : g === 1 ? 'warm' : 'cold')

/** LEGACY read — heat on old rows; new rows never write it. */
export function heatOf(t: Taste): Heat | null {
  if (t.heat === 'hot' || t.heat === 'warm' || t.heat === 'cold') return t.heat
  const g = gapOf(t)
  return g == null ? null : HEAT(g)
}

/** THE verdict tag — free text (the Consular's words); house defaults are
 *  suggestions. Legacy rows read-map their heat (hot→PERSUE · warm→WARMING UP
 *  · cold→SKIP). Null = not tasted. */
export function verdictTagOf(t: Taste): string | null {
  const tag = typeof t.verdict_tag === 'string' ? t.verdict_tag.trim() : ''
  if (tag) return tag
  return tagFromLegacyHeat(heatOf(t))
}

/** THE verdict tone — stored four-value wins; house-default tag derivation is
 *  the fallback; legacy heat maps last. Null = not tasted. */
export function verdictToneOf(t: Taste): VerdictTone | null {
  if (isVerdictTone(t.verdict_tone)) return t.verdict_tone
  if (isVerdictTag(t.verdict_tag)) return verdictTagTone(t.verdict_tag)
  const legacy = tagFromLegacyHeat(heatOf(t))
  return legacy ? verdictTagTone(legacy) : null
}

/** WHO — the portrait; legacy rows carry it under palate_choice. */
export function whoOf(t: Taste): string | null {
  return t.who ?? t.palate_choice ?? null
}

/** One-line verdict; legacy rows carry it under `verdict`. */
export function sublineOf(t: Taste): string | null {
  return t.verdict_subline ?? t.verdict ?? null
}

/** PALAT / BUDGET 0–5 — derived from chf_est ÷ heads; legacy rows fall back
 *  to their stored palate score. Null = no basis yet. */
export function palatOf(t: Taste): number | null {
  const band = palateBand(t.chf_est, t.heads)
  if (band != null) return band
  return typeof t.palate === 'number' ? t.palate : null
}

/** BUYING readiness 0–5 — unified key; legacy rows carry it under execution. */
export function buyingOf(t: Taste): number | null {
  if (typeof t.buying === 'number') return t.buying
  return typeof t.execution === 'number' ? t.execution : null
}

/** Photos as a 0–5 score; legacy prose rows → null (render the prose instead). */
export function photoScoreOf(t: Taste): number | null {
  return typeof t.photos === 'number' ? t.photos : null
}

/** STALE-ERA row (Ralph 2026-06-11) — tasted under the pre-redesign contract:
 *  old keys (palate / palate_choice / verdict) present, no verdict_tag. These
 *  render through the legacy fallbacks but carry NONE of the unified fields
 *  (who · chf_est · heads · buying · pitch · …) in the database — 1032 of
 *  them at the census. They count as tastable so a re-run upgrades them. */
export function isStaleTaste(t: Taste): boolean {
  const hasOld = typeof t.palate === 'number'
    || (t.palate_choice != null && t.palate_choice !== '')
    || (t.verdict != null && t.verdict !== '')
  const hasNew = (t.verdict_tag != null && t.verdict_tag !== '')
    || (t.who != null && t.who !== '')
  return hasOld && !hasNew
}

/** Coarse "pursue" hint for greenfield leads — keep it simple for v1. */
export function pursueOf(p: RawProspect): 'high' | 'low' {
  return /tief/i.test(p.industry) ? 'low' : 'high'
}

/** Read the original imported row from raw_payload as a flat string map. */
export function payloadOf(p: RawProspect): Record<string, string> {
  return parseJSON<Record<string, string>>(p.raw_payload, {})
}

/**
 * Tone for a queried lamp (§17 [SCOUT-L], Ralph 2026-06-03 — 4-tier).
 *
 *   good (green)   = doing well
 *   mid  (yellow)  = almost there
 *   low  (orange)  = needs work
 *   bad  (red)     = poor / broken
 *   info (gray)    = no data / inconclusive
 *
 * For numeric Lighthouse scores (performance, seo), Google's 3-tier
 * coloring (0-49 red, 50-89 yellow, 90+ green) lumps a 55 in with a 85 —
 * both "needs improvement" — even though they read very differently. We
 * subdivide the middle band: 50-69 orange (slow), 70-89 yellow (almost
 * there). The 50 and 90 boundaries still match Google's; the 70 split
 * gives real discrimination where Ralph needs it.
 *
 * CrUX (traffic) and categorical lamps (age, stack) stay 3-tier — only
 * the two numeric Lighthouse scores get the 4-tier treatment because they
 * have a continuous range to subdivide.
 *
 * Tone reflects WHAT THE LAMP SAYS, not WHETHER WE CAN PITCH IT — the
 * pitch decision is the Scout agent's job, not a color rule.
 */
export function tone(key: string, v: string | null | undefined): string {
  if (v == null) return ''
  // Age — older = red, mid-aged = yellow, fresh = green.
  if (key === 'age') return /stale|201[0-5]|seen 200/.test(v) ? 'bad' : /aging|201[6-9]/.test(v) ? 'mid' : 'good'
  // Ralph 2026-06-05 (v4) · 4-tier stack mapping per target mockup:
  //   bad  (red)      jimdo, wix, weebly, squarespace generic templates, old static
  //   low  (orange)   wordpress — functional but generic, "could be better"
  //   good (green)    modern frameworks: nuxt, next, react, vue, svelte, astro,
  //                   gatsby, remix, solid, qwik — and custom modern stacks
  //   info (grey)     unknown / nothing detected
  if (key === 'stack') {
    if (/old|jimdo|wix|weebly|table|static/i.test(v)) return 'bad'
    if (/wordpress/i.test(v)) return 'low'
    // "custom / unknown" means detection failed — that's NOT a modern stack
    // signal, it's an absence of signal. Show as info (grey).
    if (/unknown|—/i.test(v)) return 'info'
    if (/nuxt|next\b|react|vue|svelte|astro|gatsby|remix|solid|qwik/i.test(v)) return 'good'
    return 'info'
  }
  // Performance — 4-tier Lighthouse: ≥90 good · 70-89 mid · 50-69 low · <50 bad.
  if (key === 'performance') {
    const n = +(v.replace(/\D/g, ''))
    if (!n) return 'info'
    return n >= 90 ? 'good' : n >= 70 ? 'mid' : n >= 50 ? 'low' : 'bad'
  }
  // SEO — same 4-tier as Performance.
  if (key === 'seo') {
    const n = +(v.replace(/\D/g, ''))
    if (!n) return 'info'
    return n >= 90 ? 'good' : n >= 70 ? 'mid' : n >= 50 ? 'low' : 'bad'
  }
  // Traffic — 4-tier driven by the raw LCP percentile in ms. The label
  // ("LCP 2.8s · ok") carries the suffix word that maps to the tone band.
  // Fallback: if only the 3-tier category came through ("measured · FAST"),
  // map FAST/AVERAGE/SLOW → good/mid/bad. "thin · below CrUX" → info (no data).
  if (key === 'traffic') {
    if (/thin|below CrUX/i.test(v)) return 'info'
    // 4-tier from LCP-driven label.
    if (/·\s*fast\b/i.test(v))      return 'good'
    if (/·\s*ok\b/i.test(v))        return 'mid'
    if (/·\s*slow\b/i.test(v))      return 'low'
    if (/·\s*poor\b/i.test(v))      return 'bad'
    // Fallback: 3-tier CrUX category words.
    if (/FAST/.test(v))             return 'good'
    if (/AVERAGE/.test(v))          return 'mid'
    if (/SLOW/.test(v))             return 'bad'
    return 'info'
  }
  if (key === 'photos') return /art|real|honest|hand-drawn|portrait/.test(v) ? 'good' : /stock|clip|demo/.test(v) ? 'bad' : 'mid'
  // Sections — code-counted across the site's pages (Ralph 2026-06-10). Any
  // count = data found = green, same semantic as the other categorical lamps.
  if (key === 'sections') return /^(0|—)/.test(v.trim()) ? 'info' : 'good'
  // Ralph 2026-06-04 · categorical lamps below — data-found = green, "none"
  // or empty / unknown = gray. The mockup shows these in green when populated
  // because the semantic is "we successfully detected this signal".
  if (key === 'hosting') return /none|unknown|—/i.test(v) ? 'info' : 'good'
  if (key === 'languages') return /none|—/i.test(v) ? 'info' : 'good'
  if (key === 'booking') {
    if (/none|—|not detected/i.test(v)) return 'info'
    return 'good'   // any detected booking system is a green signal
  }
  // Ralph 2026-06-06 — `trackers` split into `analytics` + `marketing`.
  // Same tone logic for each (any hit = good; none = info).
  if (key === 'analytics' || key === 'marketing') {
    if (/none|—|not detected/i.test(v)) return 'info'
    return 'good'   // GA4/Plausible/Meta/etc. detected
  }
  // Reviews: rating-driven. 4.5+ = good, 3.5-4.4 = mid, <3.5 = bad,
  // null/no-listing renders as 'info' (no displacement signal either way).
  if (key === 'reviews') {
    if (/^—/.test(v)) return 'info'
    const m = v.match(/^(\d[.,]\d)/)
    if (m) {
      const r = parseFloat(m[1].replace(',', '.'))
      if (r >= 4.5) return 'good'
      if (r >= 3.5) return 'mid'
      return 'bad'
    }
    return 'info'
  }
  // Ralph 2026-06-06 — SaaS/CRM, industry, location lamps. SaaS: any
  // detected CRM = info (factual, no displacement direction); "— none
  // detected" = info too (could mean white-space pitch, depends on context).
  // Industry + location: factual, info-toned (no good/bad polarity).
  if (key === 'saas' || key === 'industry' || key === 'location') {
    return 'info'
  }
  return 'info'
}

/** Source-tag map for the dossier's ◐ Queried lamp labels. */
export const QUERIED_SOURCES: Record<string, string> = {
  age: 'Wayback', stack: 'HTML', hosting: 'DNS·ASN',
  performance: 'PageSpeed', seo: 'PageSpeed', traffic: 'CrUX',
  analytics: 'cookie+grep', marketing: 'cookie+grep',
  reviews: 'DDG·Google Business',
  booking: 'HTML', languages: 'HTML',
  saas: 'HTML grep', industry: 'JSON-LD', location: 'JSON-LD',
  sections: 'HTML crawl',
}
