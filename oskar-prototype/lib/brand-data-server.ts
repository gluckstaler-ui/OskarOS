/**
 * brand-data-server.ts — WP-B1 server-only sibling of brand-data.ts
 *
 * Separated 2026-04-17 because BrandingPanel (a client component) imports
 * from `lib/brand-data` for `brandDataFromVibe` + `brandDataBlock`. Bundling
 * any `fs/promises` import into a client module trips Next.js with:
 *
 *   Module not found: Can't resolve 'fs/promises'
 *
 * The pure helpers stay in `lib/brand-data.ts`. Anything that touches disk
 * lives here. API routes (`app/api/brand/generate/route.ts`) import from
 * THIS file; React components must NOT.
 *
 * The signature is unchanged — `brandDataFromFile(sessionId, vibeKey)`
 * returns `Promise<BrandData | null>`.
 */

import { readFile } from 'fs/promises'
import path from 'path'
import type { BrandData } from './brand-data'

/**
 * Parse a session's VIBE-N.md into BrandData. Returns null when:
 *   - vibeKey doesn't resolve to a numeric vibe (no matching VIBE-N.md)
 *   - the file doesn't exist
 *   - the file is unreadable
 *
 * `vibeKey` accepts either `"vibe-1"` (matches `VIBE-1.md`) or a bare number.
 */
export async function brandDataFromFile(
  sessionId: string,
  vibeKey: string
): Promise<BrandData | null> {
  const num = vibeKey.replace(/^vibe-/i, '').trim()
  if (!/^\d+$/.test(num)) return null

  const mdPath = path.join(process.cwd(), 'public', sessionId, `VIBE-${num}.md`)
  let md: string
  try {
    md = await readFile(mdPath, 'utf-8')
  } catch {
    return null
  }

  const vibeName = parseFirstHeading(md) || `Vibe ${num}`
  // Best-effort business-name from CREATIVE-BRIEF.md if present.
  let businessName = ''
  try {
    const brief = await readFile(
      path.join(process.cwd(), 'public', sessionId, 'CREATIVE-BRIEF.md'),
      'utf-8'
    )
    const h1 = brief.match(/^#\s+([^\n]+?)\s*$/m)
    if (h1) businessName = h1[1].trim()
  } catch {
    // No brief — fall back to vibe name below.
  }

  return {
    businessName: businessName || vibeName,
    fontHeading: parseField(md, /\bFonts?\b[^\n]*:\s*([^/\n(]+)/i)?.trim() || '',
    fontBody: parseSecondFont(md) || '',
    audience:
      parseField(md, /\bAudience\b\s*[:\-]\s*([^\n]+)/i) ||
      parseField(md, /\bWho it'?s for\b\s*[:\-]\s*([^\n]+)/i) ||
      parseField(md, /\bTarget(?:\s+Group)?\b\s*[:\-]\s*([^\n]+)/i) ||
      '',
    mood: parseField(md, /\bMood\b\s*[:\-]\s*([^\n]+)/i) || '',
    colors: parseColors(md),
    voiceSample:
      parseField(md, /\bTagline\b\s*[:\-]\s*"?([^"\n]+)"?/i) ||
      parseField(md, /\bOne-liner\b\s*[:\-]\s*([^\n]+)/i) ||
      parseField(md, /\bVoice\b\s*[:\-]\s*([^\n]+)/i) ||
      '',
    oneLiner:
      parseField(md, /\bOne-liner\b\s*[:\-]\s*([^\n]+)/i) ||
      parseField(md, /\bTagline\b\s*[:\-]\s*"?([^"\n]+)"?/i) ||
      undefined,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal parsers (mirrored from the original lib/brand-data.ts pre-split).
// Kept identical to preserve regex behavior — DO NOT optimize during the split.
// ─────────────────────────────────────────────────────────────────────────────

function parseField(md: string, re: RegExp): string | null {
  const m = md.match(re)
  return m ? m[1].trim().replace(/\*\*/g, '').replace(/^["']|["']$/g, '').trim() : null
}

function parseFirstHeading(md: string): string | null {
  const m = md.match(/^#\s*VIBE\s+\d+\s*[:\-—]\s*"?([^"\n]+?)"?\s*$/im)
  return m ? m[1].trim() : null
}

function parseColors(md: string): string[] {
  const line = md.match(/\bColors?\b\s*[:\-][^\n]+/i)?.[0] || ''
  const hexes: string[] = []
  const re = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    hexes.push(normalizeHex(m[0]))
    if (hexes.length >= 4) break
  }
  if (hexes.length >= 2) return hexes

  const allRe = /#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g
  const seen = new Set<string>()
  const out: string[] = []
  while ((m = allRe.exec(md)) !== null) {
    const h = normalizeHex(m[0])
    if (!seen.has(h)) {
      seen.add(h)
      out.push(h)
    }
    if (out.length >= 4) break
  }
  return out
}

function normalizeHex(h: string): string {
  const clean = h.trim()
  if (clean.length === 4) {
    const [_, a, b, c] = clean.match(/^#([0-9A-Fa-f])([0-9A-Fa-f])([0-9A-Fa-f])$/) || []
    if (a && b && c) return `#${a}${a}${b}${b}${c}${c}`.toUpperCase()
  }
  return clean.toUpperCase()
}

function parseSecondFont(md: string): string | null {
  const m = md.match(/\bFonts?\b[^\n]*:\s*[^/\n]+\/\s*([^()\n/]+)/i)
  if (m) return m[1].trim()
  const twoLine = md.match(/\bBody\s+Font\b\s*[:\-]\s*([^\n(]+)/i)
  if (twoLine) return twoLine[1].trim()
  return null
}
