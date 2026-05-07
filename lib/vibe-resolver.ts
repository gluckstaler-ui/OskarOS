/**
 * vibe-resolver — joins HTML files from disk with parsed CREATIVE-BRIEF.md /
 * VIBE-*.md data into the `VibeData[]` shape the UI consumes.
 *
 * Extracted from `loadSession` in app/page.tsx (lines 361-505 pre-refactor).
 * The logic was previously a 150-line block inside a 2700-line React
 * component, making it hard to iterate on filename patterns without
 * accidentally breaking unrelated JSX. As a pure function here it's easy
 * to unit-test and easy for agents to locate.
 *
 * Pure function — given the same inputs it always returns the same
 * VibeData[]. No fetches, no React, no side effects. The one console.log
 * is a debug trace that can be toggled by the caller if desired
 * (optional `debug: true` flag on the input).
 */

import type { VibeData } from '@/lib/types'

/**
 * Minimal shape of an HTML file entry as returned by the admin sessions API.
 * Only the fields `resolveVibes` actually reads are typed here; additional
 * fields on the real response are ignored.
 */
export interface HtmlFileEntry {
  /** Filename without path, e.g. "vibe-1-qahwa.html". */
  name?: string
  /** Absolute URL path, e.g. "/2026-01-27-31/vibe-1-qahwa.html". */
  path?: string
}

/**
 * Minimal shape of a parsed vibe entry from CREATIVE-BRIEF.md or VIBE-*.md.
 * Produced upstream by `lib/creative-brief-parser.ts`.
 */
export interface ParsedVibeEntry {
  /** 1-based vibe index (matches the `N` in `vibe-N-*.html`). */
  index?: number
  /** Filename-derived slug (e.g. "vibe-1-qahwa"). */
  slug?: string
  name?: string
  oneLiner?: string
  audience?: string
  mood?: string
  voice?: string
  whoFor?: string
  /** Either `string[]` or `{ primary, secondary, accent, text }`. */
  colors?: string[] | {
    primary?: string
    secondary?: string
    accent?: string
    text?: string
  }
  /** Font names — both "headings" (plural) and "heading" (singular) keys
   *  have shown up historically; we accept either. */
  fonts?: {
    headings?: string
    heading?: string
    body?: string
  }
  /** Hero image filename (e.g. "sultan.jpg") as written in the vibe's
   *  `**Hero Image:**` line. The only signal the gallery trusts — see
   *  the Potemkin-removal refactor. */
  heroImage?: string
}

export interface ResolveVibesInput {
  htmlFiles: HtmlFileEntry[]
  parsedVibes: ParsedVibeEntry[]
  /** When true, emit debug logs tracing each match decision. */
  debug?: boolean
}

/**
 * Fallback color sets used when a vibe has no parsed colors. Ordered to
 * roughly match the benchmark FalCaMel vibes (QAHWA / JAREEN / RACE /
 * MAJLIS) but any vibe past index 3 wraps via modulo. Fallback only —
 * whenever parsed colors are available, they win.
 */
const FALLBACK_COLOR_SETS: string[][] = [
  ['#8B4513', '#F5F5DC', '#722F37', '#2C1810'], // warm browns
  ['#2F4F4F', '#DEB887', '#006400', '#1A1A1A'], // highlands
  ['#1C1C1C', '#FFD700', '#DC143C', '#FFFFFF'], // night gold
  ['#1A1A2E', '#C9A227', '#4A0E0E', '#F5F5F0'], // deep luxury
]

const DEFAULT_TYPOGRAPHY = { heading: 'Playfair Display', body: 'Inter' }

/**
 * Filename pattern: `vibe-<index>-<key>[-v<version>].html`.
 *   - `index` — the 1-based vibe number
 *   - `key`   — slug-ish lowercase identifier (e.g. "qahwa", "majlis-sultan")
 *   - `version` — optional `-vN` suffix (absent = v1)
 *
 * Examples that match:
 *   vibe-1-qahwa.html                      → index=1, key="qahwa",              v=1
 *   vibe-2-jareen-highlands.html           → index=2, key="jareen-highlands",   v=1
 *   vibe-1-qahwa-v2.html                   → index=1, key="qahwa",              v=2
 *
 * Anything else is ignored (non-vibe HTMLs in the session folder pass through
 * without appearing in the gallery).
 */
const VIBE_FILENAME_RE = /^vibe-(\d+)-(.+?)(?:-v(\d+))?\.html$/

/** Shape internal to the sort — not exported. */
interface VibeFileMeta {
  file: HtmlFileEntry
  vibeIndex: number
  vibeKey: string
  version: number
}

/**
 * Main entry point. Given the raw disk data, produce the sorted
 * `VibeData[]` the gallery renders.
 *
 * Sort order:
 *   1. by `vibeIndex` ascending  (vibe-1 before vibe-2)
 *   2. within the same index, by `version` ascending (v1 before v2)
 *
 * Matching chain for enrichment (colors, typography, audience, mood, hero):
 *   1. match by slug (filename without .html) against `parsedVibes[].slug`
 *   2. fallback: match by `vibeIndex` against `parsedVibes[].index`
 *   3. fallback: derive name from filename, use default typography / fallback
 *      colors, leave audience/mood/hero empty
 */
export function resolveVibes({
  htmlFiles,
  parsedVibes,
  debug = false,
}: ResolveVibesInput): VibeData[] {
  const log = debug
    ? (...args: unknown[]) => console.log('[vibe-resolver]', ...args)
    : () => {}

  // ─── Phase 1: parse + filter filenames ─────────────────────────────────
  const vibeFiles: VibeFileMeta[] = []
  for (const file of htmlFiles) {
    const filename = file.name || ''
    const match = filename.match(VIBE_FILENAME_RE)
    if (!match) continue
    vibeFiles.push({
      file,
      vibeIndex: parseInt(match[1], 10),
      vibeKey: match[2].toLowerCase(),
      version: match[3] ? parseInt(match[3], 10) : 1,
    })
    log(`file ${filename} → index=${match[1]} key="${match[2]}" v=${match[3] || 1}`)
  }

  // ─── Phase 2: sort by (index, version) ─────────────────────────────────
  vibeFiles.sort((a, b) =>
    a.vibeIndex !== b.vibeIndex
      ? a.vibeIndex - b.vibeIndex
      : a.version - b.version
  )

  // ─── Phase 3: map each file to a VibeData via match against parsedVibes ─
  return vibeFiles.map((meta, idx): VibeData => {
    const filename = meta.file.name || ''
    const slug = filename.replace('.html', '')

    const matchedBySlug = parsedVibes.find((pv) => pv.slug === slug)
    const matchedByIndex = parsedVibes.find((pv) => pv.index === meta.vibeIndex)
    const matched = matchedBySlug || matchedByIndex

    log(
      `match "${filename}" (slug="${slug}", idx=${meta.vibeIndex}): ${
        matched ? `found via ${matchedBySlug ? 'slug' : 'index'} → "${matched.name}"` : 'no match'
      }`
    )

    // Name = parsed name + version suffix, or filename-derived fallback.
    const versionSuffix = meta.version > 1 ? ` (v${meta.version})` : ''
    const name = matched?.name
      ? matched.name + versionSuffix
      : deriveNameFromFilename(filename)

    // Colors: parsed wins if present, else fallback indexed.
    const colors = resolveColors(matched?.colors, idx)

    // Typography: parsed wins if present, else default.
    const typography = resolveTypography(matched?.fonts)

    return {
      id: `vibe-${idx}`,
      name,
      category: 'premium',
      headline: matched?.oneLiner || '',
      tagline: '',
      colors,
      typography,
      voiceSamples: matched ? [matched.voice || '', matched.whoFor || ''] : [],
      audience: matched?.audience || '',
      mood: matched?.mood || '',
      htmlPath: meta.file.path || '',
      html: '',
      // Hero = only what the CD wrote in VIBE-N.md. No heuristic, no admin-API
      // fallback. See Potemkin removal.
      heroImage: matched?.heroImage || undefined,
    } as VibeData
  })
}

/**
 * Derive a display name from a filename when no parsed match exists. Strips
 * `vibe-<N>-` prefix + optional `-vN` suffix + `.html`, replaces dashes with
 * spaces, and Title-Cases the result.
 */
function deriveNameFromFilename(filename: string): string {
  const match = filename.match(/vibe-\d+-(.+?)(?:-v\d+)?\.html$/)
  const stem = match ? match[1] : filename.replace('.html', '')
  return stem
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Normalize the parsed-vibe colors blob into a 4-tuple:
 *   [primary, secondary, accent, text]
 *
 * Accepts object form `{ primary, secondary, accent, text }` OR
 * array form `string[]` (takes the first 4 entries). Falls back to
 * `FALLBACK_COLOR_SETS[idx % 4]` for any missing slots.
 */
function resolveColors(
  raw: ParsedVibeEntry['colors'] | undefined,
  idx: number,
): string[] {
  const fallback = FALLBACK_COLOR_SETS[idx % FALLBACK_COLOR_SETS.length]
  if (!raw) return fallback

  if (Array.isArray(raw)) {
    if (raw.length >= 4) return raw.slice(0, 4)
    // Short array: pad with fallback
    return [
      raw[0] || fallback[0],
      raw[1] || fallback[1],
      raw[2] || fallback[2],
      raw[3] || fallback[3],
    ]
  }

  // Object form
  return [
    raw.primary || fallback[0],
    raw.secondary || fallback[1],
    raw.accent || fallback[2],
    raw.text || fallback[3],
  ]
}

/**
 * Normalize the parsed-vibe fonts blob into `{ heading, body }`. Accepts
 * both `headings` (plural) and `heading` (singular) — both have appeared in
 * parser output historically.
 */
function resolveTypography(
  raw: ParsedVibeEntry['fonts'] | undefined,
): { heading: string; body: string } {
  if (!raw) return DEFAULT_TYPOGRAPHY
  return {
    heading: raw.headings || raw.heading || DEFAULT_TYPOGRAPHY.heading,
    body: raw.body || DEFAULT_TYPOGRAPHY.body,
  }
}
