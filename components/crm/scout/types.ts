// ============================================================================
// components/crm/scout/types.ts — shared types for the Scout pool UI
// (WP-SCOUT-7, Ralph 2026-06-03). Split out of the old monolithic
// components/crm/ScoutPool.tsx so the four spec'd components
// (ScoutPool · ScoutRow · ScoutDossier · DecisionDeck) can import one
// canonical surface instead of redeclaring shapes in each file.
// ============================================================================

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

export type Taste = {
  palate?: number | null
  execution?: number | null
  gap?: number | null
  heat?: string | null
  palate_choice?: string | null
  verdict?: string | null
  photos?: string | null
}

export type Queried = Record<string, string | null>

/**
 * Capture record left on `scout_json` by WP-SCOUT-5 once the Taste batch
 * runs `captureUrl()` (lib/screenshot.ts). All fields optional so a
 * pre-WP-5 row still parses — we just render the "not yet captured" state.
 */
export type Capture = {
  fullPageUrl?: string | null
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
export type FilterKey = 'all' | 'hot' | 'warm' | 'cold' | 'raw' | 'green'

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

/** gap = palate − execution. Null when either is missing. */
export function gapOf(t: Taste): number | null {
  return typeof t.palate === 'number' && typeof t.execution === 'number'
    ? t.palate - t.execution
    : null
}

/** Server-side 3-tier heat band (locked per §17 [SCOUT-J]). */
export const HEAT = (g: number): Heat => (g >= 2 ? 'hot' : g === 1 ? 'warm' : 'cold')

/** Read `heat` if the model gave it, else derive from gap. */
export function heatOf(t: Taste): Heat | null {
  if (t.heat === 'hot' || t.heat === 'warm' || t.heat === 'cold') return t.heat
  const g = gapOf(t)
  return g == null ? null : HEAT(g)
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
 * Displacement-opportunity tone for a queried lamp (§17 [SCOUT-L]):
 *   good = a pitch angle (stale/slow/low-SEO/no booking)
 *   bad  = the site is competent (less to displace)
 *   mid / info = inconclusive
 */
export function tone(key: string, v: string | null | undefined): string {
  if (v == null) return ''
  if (key === 'age') return /stale|201[0-5]|seen 200/.test(v) ? 'good' : /aging|201[6-9]/.test(v) ? 'mid' : 'bad'
  if (key === 'stack') return /old|jimdo|wix|table|static/i.test(v) ? 'good' : /wordpress/i.test(v) ? 'mid' : 'info'
  if (key === 'performance') { const n = +(v.replace(/\D/g, '')); return n && n < 50 ? 'good' : n < 75 ? 'mid' : 'bad' }
  if (key === 'seo') { const n = +(v.replace(/\D/g, '')); return n && n < 70 ? 'good' : 'info' }
  if (key === 'photos') return /stock|clip|demo/.test(v) ? 'good' : /art|real|honest|hand-drawn|portrait/.test(v) ? 'bad' : 'mid'
  return 'info'
}

/** Source-tag map for the dossier's ◐ Queried lamp labels. */
export const QUERIED_SOURCES: Record<string, string> = {
  age: 'Wayback', stack: 'HTML', hosting: 'DNS·ASN',
  performance: 'PageSpeed', seo: 'PageSpeed', traffic: 'CrUX',
  trackers: 'cookie+grep', booking: 'HTML', languages: 'HTML',
}
