// ==========================================
// Creative Brief Parser
// Parses CREATIVE-BRIEF.md or per-vibe VIBE-N.md files into structured vibe objects
// ==========================================

import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { matchField } from './markdown-fields'

export interface ParsedVibe {
  index: number
  name: string
  slug: string
  oneLiner: string
  voice: string
  whoFor: string
  // NEW: Gallery-specific fields (short format for UI display)
  audience: string   // Short brand persona, e.g. "Heritage Seekers & Homesick Saudis"
  mood: string       // 3-5 adjectives, e.g. "Warm, Nostalgic, Guilt-Inducing"
  colors: {
    primary: string
    secondary: string
    accent: string
    text: string
  }
  fonts: {
    headings: string
    body: string
  }
  content: string  // Full markdown content for this vibe
  filename?: string  // HTML filename if from Vibe Preview section
}

/**
 * Vibe Preview entry - lightweight metadata for gallery display
 * Keyed by HTML filename
 */
export interface VibePreviewEntry {
  filename: string   // e.g., "vibe-1-qahwa.html"
  name: string       // Display name, e.g., "QAHWA — Original"
  audience: string   // Short brand persona
  mood: string       // 3-5 adjectives
  heroImage: string  // Hero image filename, e.g., "hero.jpg"
  colors: {
    primary: string
    secondary: string
    accent: string
    text: string
  }
  fonts: {
    headings: string
    body: string
  }
}

export interface ParsedBrief {
  businessName: string
  status: string
  vibes: ParsedVibe[]
}

/**
 * Parse the "## Vibe Preview" section from CREATIVE-BRIEF.md
 * This section contains gallery-specific metadata for each built HTML file
 * Format:
 *   ### filename.html
 *   **Name:** Display Name
 *   **Audience:** Short brand persona
 *   **Mood:** 3-5 adjectives
 *   **Colors:** (multi-line with Primary, Secondary, Accent, Text)
 *   **Fonts:** (multi-line with Headings, Body)
 */
export function parseVibePreview(briefContent: string): Map<string, VibePreviewEntry> {
  const entries = new Map<string, VibePreviewEntry>()

  // Extract the Vibe Preview section
  const vibePreviewMatch = briefContent.match(/## Vibe Preview\n([\s\S]*?)(?=\n---|\n## [^V])/i)
  if (!vibePreviewMatch) {
    return entries
  }

  const previewContent = vibePreviewMatch[1]

  // Split by ### headers (each is a filename)
  const sections = previewContent.split(/^### /gm).filter(s => s.trim())

  for (const section of sections) {
    const lines = section.split('\n')
    const filename = lines[0].trim()

    if (!filename.endsWith('.html')) continue

    // Parse the content
    const content = lines.slice(1).join('\n')

    // Field extraction — accepts BOTH `**Field:** value` (bold-labeled) and
    // `Field: value` (plain). See lib/markdown-fields.ts for the rationale
    // (preventing the 2026-04-25-2 silent-failure cascade).
    const name = matchField(content, 'Name') || filename.replace('.html', '')
    const audience = matchField(content, 'Audience') || ''
    const mood = matchField(content, 'Mood') || ''
    const heroImage = matchField(content, 'Hero Image') || ''

    // Extract Colors (multi-line format)
    let primary = '#1C1C1E', secondary = '#F5F5F5', accent = '#C76B00', text = '#1A1A1A'
    const primaryMatch = content.match(/Primary:\s*`?(#[A-Fa-f0-9]{6})`?/i)
    const secondaryMatch = content.match(/Secondary:\s*`?(#[A-Fa-f0-9]{6})`?/i)
    const accentMatch = content.match(/Accent:\s*`?(#[A-Fa-f0-9]{6})`?/i)
    const textMatch = content.match(/Text:\s*`?(#[A-Fa-f0-9]{6})`?/i)
    if (primaryMatch) primary = primaryMatch[1]
    if (secondaryMatch) secondary = secondaryMatch[1]
    if (accentMatch) accent = accentMatch[1]
    if (textMatch) text = textMatch[1]

    // Extract Fonts
    const headingsMatch = content.match(/Headings:\s*([^\n]+)/i)
    const bodyMatch = content.match(/Body:\s*([^\n]+)/i)
    const headings = headingsMatch ? headingsMatch[1].trim() : 'Georgia'
    const body = bodyMatch ? bodyMatch[1].trim() : 'system-ui'

    entries.set(filename, {
      filename,
      name,
      audience,
      mood,
      heroImage,
      colors: { primary, secondary, accent, text },
      fonts: { headings, body }
    })
  }

  return entries
}

/**
 * Parse CREATIVE-BRIEF.md content into structured vibe objects
 */
export function parseCreativeBrief(briefContent: string): ParsedBrief {
  // Extract business name
  const businessMatch = briefContent.match(/# Creative Brief: ([^\n]+)/)
  const businessName = businessMatch ? businessMatch[1].trim() : 'Unknown Business'

  // Extract status — accepts both bold-labeled and plain
  const status = matchField(briefContent, 'Status') || 'DRAFT'

  // Parse vibes
  const vibes = parseVibesFromBrief(briefContent)

  return {
    businessName,
    status,
    vibes
  }
}

/**
 * Parse vibe sections from CREATIVE-BRIEF.md
 * Handles multiple formats:
 * - # VIBE N: Name (single hash)
 * - ## VIBE N: Name
 * - ### Vibe N: Name
 */
export function parseVibesFromBrief(briefContent: string): ParsedVibe[] {
  const vibes: ParsedVibe[] = []

  // Ralph 2026-04-26: case-insensitive across ALL three header patterns.
  // Previously the `# VIBE N:` and `## VIBE N:` patterns were case-sensitive,
  // so a CD-written file titled `# Vibe 5: Name` failed every pattern silently
  // (only `### Vibe N:` had `/i`). vibe-5 in session 2026-04-25-2 sat on disk
  // with `# Vibe 5:` and got rejected → "Could not parse vibe from vibe-5.md".
  // All three now accept VIBE / Vibe / vibe.

  const tryPattern = (pattern: RegExp): boolean => {
    const sections = briefContent.split(pattern)
    if (sections.length <= 1) return false
    for (let i = 1; i < sections.length; i += 2) {
      const index = sections[i]
      const content = sections[i + 1] || ''
      const firstNewline = content.indexOf('\n')
      if (firstNewline === -1) continue
      const name = content.substring(0, firstNewline).trim()
      const body = content.substring(firstNewline + 1)
      const parsed = parseVibeContent(index, name, body)
      if (parsed) vibes.push(parsed)
    }
    return vibes.length > 0
  }

  // Try in priority order; first pattern that yields ≥1 vibe wins.
  // All three patterns case-insensitive — `# Vibe 5:` matches as readily
  // as `# VIBE 5:`.
  if (
    !tryPattern(/^# VIBE (\d+): /gim) &&
    !tryPattern(/^## VIBE (\d+): /gim) &&
    !tryPattern(/^### VIBE (\d+): /gim)
  ) {
    // No header form matched — log so future failures are visible.
    if (briefContent.trim().length > 0) {
      console.warn(
        '[parseVibesFromBrief] No vibe headers found. Expected one of: ' +
        '`# Vibe N: name`, `## Vibe N: name`, or `### Vibe N: name` (case-insensitive)',
      )
    }
  }

  return vibes
}

/**
 * Parse individual vibe content from matched regex groups
 */
function parseVibeContent(indexStr: string, nameStr: string, content: string): ParsedVibe | null {
  const index = parseInt(indexStr)
  const name = nameStr.trim()
  const trimmedContent = content.trim()

  // All field extraction goes through `matchField` (which accepts both
  // bold-labeled and plain formats). Multiple field-name aliases are tried
  // in order; first hit wins.
  const tryFields = (...names: string[]): string => {
    for (const n of names) {
      const v = matchField(trimmedContent, n)
      if (v) return v
    }
    return ''
  }

  const oneLiner = tryFields('One-liner')
  const voice = tryFields('Voice')
  const whoFor = tryFields("Who it's for", "Who It's For", 'For')

  // Audience: explicit field, fall back to derived from whoFor
  const audienceExplicit = tryFields('Audience')
  const audience = audienceExplicit
    ? audienceExplicit
    : whoFor.length > 50
      ? whoFor.substring(0, 50).replace(/\s+\S*$/, '') + '...'
      : whoFor

  // Mood: explicit field, fall back to derived from voice
  const moodExplicit = tryFields('Mood')
  let mood = ''
  if (moodExplicit) {
    mood = moodExplicit
  } else if (voice) {
    const adjPart = voice.split(/[.—–-]/)[0].trim()
    mood = adjPart.length > 50 ? adjPart.substring(0, 50).replace(/\s+\S*$/, '') : adjPart
  }

  // Default colors
  let primary = '#1C1C1E', secondary = '#F5F5F5', accent = '#C76B00', text = '#1A1A1A'

  // Try single-line format first: `Colors: #hex1 #hex2 #hex3 #hex4`
  const colorLine = tryFields('Colors')
  if (colorLine) {
    const hexColors = colorLine.match(/#[A-Fa-f0-9]{6}/g)
    if (hexColors && hexColors.length >= 1) primary = hexColors[0]
    if (hexColors && hexColors.length >= 2) secondary = hexColors[1]
    if (hexColors && hexColors.length >= 3) accent = hexColors[2]
    if (hexColors && hexColors.length >= 4) text = hexColors[3]
  }

  // Always try individual color lines (multi-line format) - these override single-line if found
  const primaryMatch = trimmedContent.match(/Primary:\s*`?(#[A-Fa-f0-9]{6})`?/i)
  const secondaryMatch = trimmedContent.match(/Secondary:\s*`?(#[A-Fa-f0-9]{6})`?/i)
  const accentMatch = trimmedContent.match(/Accent:\s*`?(#[A-Fa-f0-9]{6})`?/i)
  const textMatch = trimmedContent.match(/Text:\s*`?(#[A-Fa-f0-9]{6})`?/i)

  if (primaryMatch) primary = primaryMatch[1]
  if (secondaryMatch) secondary = secondaryMatch[1]
  if (accentMatch) accent = accentMatch[1]
  if (textMatch) text = textMatch[1]

  // Extract fonts
  const headingsMatch = trimmedContent.match(/Headings:\s*([^\n(]+)/i)
  const bodyMatch = trimmedContent.match(/Body:\s*([^\n(]+)/i)

  // Create slug from name
  const slug = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  return {
    index,
    name,
    slug,
    oneLiner,
    voice,
    whoFor,
    audience,
    mood,
    colors: { primary, secondary, accent, text },
    fonts: {
      headings: headingsMatch ? headingsMatch[1].trim() : 'Georgia',
      body: bodyMatch ? bodyMatch[1].trim() : 'system-ui'
    },
    content: trimmedContent
  }
}

/**
 * Parse vibes from individual VIBE-N.md files in a session folder.
 * Each file contains one vibe with the same `# VIBE N: "NAME"` header format.
 * Falls back to CREATIVE-BRIEF.md if no VIBE-*.md files exist.
 */
export async function parseVibesFromFiles(sessionPath: string): Promise<ParsedVibe[]> {
  const vibes: ParsedVibe[] = []

  try {
    const files = await readdir(sessionPath)
    const vibeFiles = files
      .filter(f => /^VIBE-\d+\.md$/i.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)![0])
        const numB = parseInt(b.match(/\d+/)![0])
        return numA - numB
      })

    if (vibeFiles.length === 0) {
      // No VIBE-*.md yet — normal during discovery phase. Fall back silently.
      const briefContent = await readFile(join(sessionPath, 'CREATIVE-BRIEF.md'), 'utf-8')
      return parseVibesFromBrief(briefContent)
    }

    for (const file of vibeFiles) {
      const content = await readFile(join(sessionPath, file), 'utf-8')
      const parsed = parseVibesFromBrief(content)
      if (parsed.length > 0) {
        vibes.push(parsed[0]) // Each file has exactly one vibe
      } else {
        console.warn(`[parseVibesFromFiles] Could not parse vibe from ${file}`)
      }
    }
  } catch (err) {
    console.error(`[parseVibesFromFiles] Error reading session folder: ${err}`)
  }

  return vibes
}
