/**
 * brand-data.ts — WP-B1 (client-safe half)
 *
 * Pulls the brand data that feeds the Branding tab's deliverable prompts.
 * Source of truth is the `VibeData` the streaming generator already produces
 * and keeps in React state.
 *
 * Every brand deliverable prompt (`lib/brand-deliverables.ts`) embeds the
 * block returned by `brandDataBlock()` so a single edit here propagates to
 * all deliverables. See docs/BRANDING-PLAN.md §6 for the shape contract.
 *
 * Split 2026-04-17: the server-side `brandDataFromFile()` lives in
 * `lib/brand-data-server.ts`. It uses `fs/promises`, which Next.js cannot
 * bundle into a client component. Importing `lib/brand-data` from
 * `BrandingPanel.tsx` (a client component) used to break the build with
 * "Module not found: 'fs/promises'". This file is now pure — safe to
 * import from anywhere.
 */

import type { VibeData } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Public type — consumed by BrandingPanel, brand-deliverables, API route.
// ─────────────────────────────────────────────────────────────────────────────

export interface BrandData {
  /** Display name of the business (usually the session's business, not the vibe label). */
  businessName: string
  /** Headline / display / hero font. */
  fontHeading: string
  /** Body / UI / caption font. */
  fontBody: string
  /** Target audience — who the brand talks to (the vibe's `audience` or `whoItsFor` field). */
  audience: string
  /** 3-5 adjectives separated by commas, e.g. "Warm, Nostalgic, Guilt-Inducing". */
  mood: string
  /** Hex codes in declared order: [primary, secondary, accent, text]. */
  colors: string[]
  /** A sentence of brand voice — usually tagline or the first voice sample. */
  voiceSample: string
  /** Optional short one-liner headline for use in cards, slides, etc. */
  oneLiner?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Client path — build directly from a VibeData in React state.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract brand data from a VibeData (fast path — no filesystem access).
 * `businessName` comes from session state separately; pass an empty string
 * if unknown and the deliverable prompts will fall back to the vibe name.
 */
export function brandDataFromVibe(vibe: VibeData, businessName: string): BrandData {
  const fallbackVoice =
    vibe.voiceSamples?.[0]?.trim() ||
    vibe.tagline?.trim() ||
    vibe.headline?.trim() ||
    ''

  return {
    businessName: (businessName || vibe.name || '').trim(),
    fontHeading: vibe.typography?.heading?.trim() || '',
    fontBody: vibe.typography?.body?.trim() || '',
    audience: (vibe.audience || '').trim(),
    mood: (vibe.mood || '').trim(),
    colors: Array.isArray(vibe.colors) ? vibe.colors.slice(0, 4) : [],
    voiceSample: fallbackVoice,
    oneLiner: vibe.tagline?.trim() || vibe.headline?.trim() || undefined,
  }
}

// `brandDataFromFile()` lived here pre-2026-04-17. It now lives in
// `lib/brand-data-server.ts` to keep this file fs-free. Import it from
// server code (API routes, server components) only.

// ─────────────────────────────────────────────────────────────────────────────
// The shared metadata block every deliverable prompt embeds.
// Single source of truth — if the contract ever changes, change it HERE.
// ─────────────────────────────────────────────────────────────────────────────

export function brandDataBlock(b: BrandData): string {
  const colors = b.colors.length ? b.colors.join(' | ') : '(no colors declared)'
  const lines = [
    '# BRAND DATA',
    `Business: ${b.businessName || '(unnamed)'}`,
    `Primary Font: ${b.fontHeading || '(unspecified)'}`,
    `Secondary Font: ${b.fontBody || '(unspecified)'}`,
    `Target Audience: ${b.audience || '(unspecified)'}`,
    `Mood: ${b.mood || '(unspecified)'}`,
    `Colors: ${colors}`,
    `Voice sample: ${b.voiceSample || '(no sample)'}`,
  ]
  if (b.oneLiner) lines.push(`One-liner: ${b.oneLiner}`)
  return lines.join('\n')
}

/**
 * Minimum viable check — returns true if the brand data has enough signal
 * to produce a meaningful deliverable. BrandingPanel uses this to gate the
 * Generate button.
 */
export function isBrandDataComplete(b: BrandData): boolean {
  return (
    !!b.businessName.trim() &&
    !!b.fontHeading.trim() &&
    b.colors.filter(Boolean).length >= 2 &&
    !!b.mood.trim()
  )
}

// (Server-side parsing helpers moved to `lib/brand-data-server.ts` along
// with `brandDataFromFile()` — see split note in the header.)
