// ==========================================
// Creative Brief Parser
// Parses CREATIVE-BRIEF.md or per-vibe VIBE-N.md files into structured vibe objects
// ==========================================

import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

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

    // Extract Name
    const nameMatch = content.match(/\*\*Name:\*\*\s*([^\n]+)/i)
    const name = nameMatch ? nameMatch[1].trim() : filename.replace('.html', '')

    // Extract Audience
    const audienceMatch = content.match(/\*\*Audience:\*\*\s*([^\n]+)/i)
    const audience = audienceMatch ? audienceMatch[1].trim() : ''

    // Extract Mood
    const moodMatch = content.match(/\*\*Mood:\*\*\s*([^\n]+)/i)
    const mood = moodMatch ? moodMatch[1].trim() : ''

    // Extract Hero Image
    const heroImageMatch = content.match(/\*\*Hero Image:\*\*\s*([^\n]+)/i)
    const heroImage = heroImageMatch ? heroImageMatch[1].trim() : ''

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

  // Extract status
  const statusMatch = briefContent.match(/\*\*Status:\*\*\s*([^\n]+)/)
  const status = statusMatch ? statusMatch[1].trim() : 'DRAFT'

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

  // Primary approach: Split by vibe headers (most reliable)
  // This handles "# VIBE N: Name" format
  const singleHashSections = briefContent.split(/^# VIBE (\d+): /gm)
  // sections[0] = everything before first vibe
  // sections[1] = "1", sections[2] = content of vibe 1
  // sections[3] = "2", sections[4] = content of vibe 2, etc.

  if (singleHashSections.length > 1) {
    for (let i = 1; i < singleHashSections.length; i += 2) {
      const index = singleHashSections[i]
      const content = singleHashSections[i + 1] || ""

      // Get name (first line) and body (rest)
      const firstNewline = content.indexOf("\n")
      if (firstNewline === -1) continue

      const name = content.substring(0, firstNewline).trim()
      const body = content.substring(firstNewline + 1)

      const parsed = parseVibeContent(index, name, body)
      if (parsed) vibes.push(parsed)
    }
  }

  // Fallback: Try ## VIBE N: format
  if (vibes.length === 0) {
    const doubleHashSections = briefContent.split(/^## VIBE (\d+): /gm)
    if (doubleHashSections.length > 1) {
      for (let i = 1; i < doubleHashSections.length; i += 2) {
        const index = doubleHashSections[i]
        const content = doubleHashSections[i + 1] || ""
        const firstNewline = content.indexOf("\n")
        if (firstNewline === -1) continue
        const name = content.substring(0, firstNewline).trim()
        const body = content.substring(firstNewline + 1)
        const parsed = parseVibeContent(index, name, body)
        if (parsed) vibes.push(parsed)
      }
    }
  }

  // Fallback: Try ### Vibe N: format
  if (vibes.length === 0) {
    const tripleHashSections = briefContent.split(/^### Vibe (\d+): /gim)
    if (tripleHashSections.length > 1) {
      for (let i = 1; i < tripleHashSections.length; i += 2) {
        const index = tripleHashSections[i]
        const content = tripleHashSections[i + 1] || ""
        const firstNewline = content.indexOf("\n")
        if (firstNewline === -1) continue
        const name = content.substring(0, firstNewline).trim()
        const body = content.substring(firstNewline + 1)
        const parsed = parseVibeContent(index, name, body)
        if (parsed) vibes.push(parsed)
      }
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

  // Extract one-liner (various formats)
  const oneLinerMatch = trimmedContent.match(/\*\*One-liner:\*\*\s*([^\n]+)/i)
    || trimmedContent.match(/One-liner:\s*([^\n]+)/i)
  const oneLiner = oneLinerMatch ? oneLinerMatch[1].trim() : ''

  // Extract voice
  const voiceMatch = trimmedContent.match(/\*\*Voice:\*\*\s*([^\n]+)/i)
    || trimmedContent.match(/Voice:\s*([^\n]+)/i)
  const voice = voiceMatch ? voiceMatch[1].trim() : ''

  // Extract who it's for (detailed, for WebDev)
  const whoForMatch = trimmedContent.match(/\*\*(?:Who it's for|Who It's For|For):\*\*\s*([^\n]+)/i)
    || trimmedContent.match(/(?:Who it's for|Who It's For|For):\s*([^\n]+)/i)
  const whoFor = whoForMatch ? whoForMatch[1].trim() : ''

  // Extract audience (short brand persona for gallery display)
  const audienceMatch = trimmedContent.match(/\*\*Audience:\*\*\s*([^\n]+)/i)
    || trimmedContent.match(/Audience:\s*([^\n]+)/i)
  // Fallback: derive from whoFor if audience not specified (take first 50 chars)
  const audience = audienceMatch
    ? audienceMatch[1].trim()
    : whoFor.length > 50
      ? whoFor.substring(0, 50).replace(/\s+\S*$/, '') + '...'  // Truncate at word boundary
      : whoFor

  // Extract mood (3-5 adjectives for gallery display)
  const moodMatch = trimmedContent.match(/\*\*Mood:\*\*\s*([^\n]+)/i)
    || trimmedContent.match(/Mood:\s*([^\n]+)/i)
  // Fallback: derive from voice if mood not specified (extract adjectives or truncate)
  let mood = ''
  if (moodMatch) {
    mood = moodMatch[1].trim()
  } else if (voice) {
    // Try to extract just adjectives from voice (words before the first period or dash)
    const adjPart = voice.split(/[.—–-]/)[0].trim()
    mood = adjPart.length > 50 ? adjPart.substring(0, 50).replace(/\s+\S*$/, '') : adjPart
  }

  // Extract colors (multiple formats)
  // Default colors
  let primary = '#1C1C1E', secondary = '#F5F5F5', accent = '#C76B00', text = '#1A1A1A'

  // Try single-line format first: **Colors:** #hex1 #hex2 #hex3 #hex4
  const colorsMatch = trimmedContent.match(/\*\*Colors:\*\*\s*([^\n]+)/i)
    || trimmedContent.match(/Colors:\s*([^\n]+)/i)

  if (colorsMatch) {
    const colorLine = colorsMatch[1]
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
