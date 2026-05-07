import { describe, it, expect } from 'vitest'
import {
  parseCreativeBrief,
  parseVibesFromBrief,
  parseVibePreview,
  ParsedVibe,
  ParsedBrief,
} from '../creative-brief-parser'

describe('creative-brief-parser', () => {
  describe('parseCreativeBrief', () => {
    it('extracts business name from header', () => {
      const brief = `# Creative Brief: FalCaMel Cafe

**Status:** DRAFT
`
      const result = parseCreativeBrief(brief)
      expect(result.businessName).toBe('FalCaMel Cafe')
    })

    it('extracts status', () => {
      const brief = `# Creative Brief: Test

**Status:** VIBES_READY
`
      const result = parseCreativeBrief(brief)
      expect(result.status).toBe('VIBES_READY')
    })

    it('defaults to Unknown Business when no name found', () => {
      const brief = `Some content without proper header`
      const result = parseCreativeBrief(brief)
      expect(result.businessName).toBe('Unknown Business')
    })

    it('defaults to DRAFT status when not specified', () => {
      const brief = `# Creative Brief: Test`
      const result = parseCreativeBrief(brief)
      expect(result.status).toBe('DRAFT')
    })
  })

  describe('parseVibesFromBrief - Pattern 1 (### Vibe N: Name)', () => {
    const briefWithPattern1 = `# Creative Brief: FalCaMel Cafe

**Status:** VIBES_READY

### Vibe 1: Desert Oasis
**One-liner:** Where the desert meets your cup
**Voice:** Warm, inviting, mystical
**Who it's for:** Adventure seekers
**Colors:** #C76B00, #F5F5F5, #1C1C1E
**Typography:**
- Headings: Georgia
- Body: system-ui

### Vibe 2: Modern Majlis
**One-liner:** Traditional meets contemporary
**Voice:** Sophisticated, cultured
**Who it's for:** Design enthusiasts
**Colors:** #2D5A27, #FFFFFF, #8B4513

## Selected Vibe
`

    it('parses multiple vibes', () => {
      const result = parseVibesFromBrief(briefWithPattern1)
      expect(result).toHaveLength(2)
    })

    it('extracts vibe index correctly', () => {
      const result = parseVibesFromBrief(briefWithPattern1)
      expect(result[0].index).toBe(1)
      expect(result[1].index).toBe(2)
    })

    it('extracts vibe name correctly', () => {
      const result = parseVibesFromBrief(briefWithPattern1)
      expect(result[0].name).toBe('Desert Oasis')
      expect(result[1].name).toBe('Modern Majlis')
    })

    it('creates correct slug from name', () => {
      const result = parseVibesFromBrief(briefWithPattern1)
      expect(result[0].slug).toBe('desert-oasis')
      expect(result[1].slug).toBe('modern-majlis')
    })

    it('extracts one-liner', () => {
      const result = parseVibesFromBrief(briefWithPattern1)
      expect(result[0].oneLiner).toBe('Where the desert meets your cup')
    })

    it('extracts voice', () => {
      const result = parseVibesFromBrief(briefWithPattern1)
      expect(result[0].voice).toBe('Warm, inviting, mystical')
    })

    it('extracts who it is for', () => {
      const result = parseVibesFromBrief(briefWithPattern1)
      expect(result[0].whoFor).toBe('Adventure seekers')
    })

    it('extracts colors as hex values', () => {
      const result = parseVibesFromBrief(briefWithPattern1)
      expect(result[0].colors.primary).toBe('#C76B00')
      expect(result[0].colors.secondary).toBe('#F5F5F5')
      expect(result[0].colors.accent).toBe('#1C1C1E')
    })

    it('extracts fonts', () => {
      const result = parseVibesFromBrief(briefWithPattern1)
      expect(result[0].fonts.headings).toBe('Georgia')
      expect(result[0].fonts.body).toBe('system-ui')
    })
  })

  describe('parseVibesFromBrief - Pattern 2 (## VIBE N: Name)', () => {
    const briefWithPattern2 = `# Creative Brief: Test Cafe

## VIBE 1: Sunny Days
**One-liner:** Brightness in every sip
**Voice:** Cheerful
**Who it's for:** Morning people
**Colors:** #FFD700, #FFFFFF, #000000

## VIBE 2: Night Owl
**One-liner:** For the late night crowd
**Voice:** Mysterious
**Colors:** #1A1A2E, #EAEAEA, #E94560

## MY RECOMMENDATION
`

    it('parses double-hash format', () => {
      const result = parseVibesFromBrief(briefWithPattern2)
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Sunny Days')
      expect(result[1].name).toBe('Night Owl')
    })

    it('extracts colors from double-hash format', () => {
      const result = parseVibesFromBrief(briefWithPattern2)
      expect(result[0].colors.primary).toBe('#FFD700')
    })
  })

  describe('parseVibesFromBrief - Pattern 3 (# VIBE N: Name)', () => {
    const briefWithPattern3 = `# Creative Brief: Minimal Cafe

# VIBE 1: Clean Lines
**One-liner:** Less is more
**Voice:** Minimalist
**Colors:** #FFFFFF, #000000, #808080

# VIBE 2: Bold Statement
**One-liner:** Stand out from the crowd
**Colors:** #FF0000, #000000, #FFFFFF

## Booking
`

    it('parses single-hash format', () => {
      const result = parseVibesFromBrief(briefWithPattern3)
      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Clean Lines')
      expect(result[1].name).toBe('Bold Statement')
    })
  })

  describe('color extraction edge cases', () => {
    it('uses default colors when none found', () => {
      const brief = `### Vibe 1: No Colors
**One-liner:** Missing colors
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].colors.primary).toBe('#1C1C1E')
      expect(result[0].colors.secondary).toBe('#F5F5F5')
      expect(result[0].colors.accent).toBe('#C76B00')
    })

    it('handles only one color specified', () => {
      const brief = `### Vibe 1: One Color
**Colors:** #FF0000
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].colors.primary).toBe('#FF0000')
      expect(result[0].colors.secondary).toBe('#F5F5F5') // default
    })

    it('handles two colors specified', () => {
      const brief = `### Vibe 1: Two Colors
**Colors:** #FF0000, #00FF00
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].colors.primary).toBe('#FF0000')
      expect(result[0].colors.secondary).toBe('#00FF00')
      expect(result[0].colors.accent).toBe('#C76B00') // default
    })

    it('parses individual color lines', () => {
      const brief = `### Vibe 1: Individual Colors
Primary: #AA0000
Secondary: #00AA00
Accent: #0000AA
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].colors.primary).toBe('#AA0000')
      expect(result[0].colors.secondary).toBe('#00AA00')
      expect(result[0].colors.accent).toBe('#0000AA')
    })

    it('handles lowercase hex colors', () => {
      const brief = `### Vibe 1: Lowercase
**Colors:** #aabbcc, #ddeeff, #112233
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].colors.primary).toBe('#aabbcc')
    })

    it('handles mixed case hex colors', () => {
      const brief = `### Vibe 1: Mixed Case
**Colors:** #AaBbCc
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].colors.primary).toBe('#AaBbCc')
    })
  })

  describe('font extraction edge cases', () => {
    it('uses default fonts when none found', () => {
      const brief = `### Vibe 1: No Fonts
**One-liner:** Missing fonts
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].fonts.headings).toBe('Georgia')
      expect(result[0].fonts.body).toBe('system-ui')
    })

    it('handles fonts with descriptive text', () => {
      const brief = `### Vibe 1: Descriptive Fonts
Headings: Playfair Display (elegant serif)
Body: Inter (clean sans-serif)
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].fonts.headings).toBe('Playfair Display')
      expect(result[0].fonts.body).toBe('Inter')
    })
  })

  describe('slug generation', () => {
    it('converts to lowercase', () => {
      const brief = `### Vibe 1: UPPERCASE NAME
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].slug).toBe('uppercase-name')
    })

    it('replaces spaces with hyphens', () => {
      const brief = `### Vibe 1: Multiple Word Name
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].slug).toBe('multiple-word-name')
    })

    it('removes special characters', () => {
      const brief = `### Vibe 1: Name's With! Special? Chars
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].slug).toBe('name-s-with-special-chars')
    })

    it('removes leading and trailing hyphens', () => {
      const brief = `### Vibe 1: -Leading and Trailing-
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].slug).toBe('leading-and-trailing')
    })
  })

  describe('empty and malformed content', () => {
    it('returns empty array for empty brief', () => {
      const result = parseVibesFromBrief('')
      expect(result).toHaveLength(0)
    })

    it('returns empty array for brief with no vibes', () => {
      const brief = `# Creative Brief: Test
**Status:** DRAFT

## Business Identity
Some content here
`
      const result = parseVibesFromBrief(brief)
      expect(result).toHaveLength(0)
    })

    it('handles vibe with minimal content', () => {
      const brief = `### Vibe 1: Minimal
`
      const result = parseVibesFromBrief(brief)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Minimal')
      expect(result[0].oneLiner).toBe('')
    })
  })

  describe('alternative field formats', () => {
    it('handles "For:" instead of "Who it\'s for:"', () => {
      const brief = `### Vibe 1: Alt Format
**For:** Coffee lovers
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].whoFor).toBe('Coffee lovers')
    })

    it('handles non-bold field labels', () => {
      const brief = `### Vibe 1: Plain Labels
One-liner: Simple and plain
Voice: Casual and friendly
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].oneLiner).toBe('Simple and plain')
      expect(result[0].voice).toBe('Casual and friendly')
    })
  })

  describe('content preservation', () => {
    it('preserves full vibe content', () => {
      const brief = `### Vibe 1: Full Content
**One-liner:** Test
**Voice:** Friendly

Some extra content here
that spans multiple lines.

### Vibe 2: Next Vibe
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].content).toContain('Some extra content here')
      expect(result[0].content).toContain('multiple lines')
    })
  })

  describe('audience and mood fields (gallery display)', () => {
    it('extracts audience when specified', () => {
      const brief = `### Vibe 1: Gallery Test
**Who It's For:** The Heritage Seeker who didn't know they were homesick until they arrived. Long description.
**Audience:** Heritage Seekers & Homesick Families
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].audience).toBe('Heritage Seekers & Homesick Families')
    })

    it('extracts mood when specified', () => {
      const brief = `### Vibe 1: Gallery Test
**Voice:** Warm, guilt-inducing, familiar. Like your actual grandmother who's too polite.
**Mood:** Warm, Nostalgic, Guilt-Inducing
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].mood).toBe('Warm, Nostalgic, Guilt-Inducing')
    })

    it('falls back to truncated whoFor when audience not specified', () => {
      const brief = `### Vibe 1: Fallback Test
**Who It's For:** The Heritage Seeker who didn't know they were homesick until they arrived
`
      const result = parseVibesFromBrief(brief)
      // Should fall back to whoFor truncated at 50 chars
      expect(result[0].audience).toBe('The Heritage Seeker who didn\'t know they were...')
    })

    it('falls back to voice adjectives when mood not specified', () => {
      const brief = `### Vibe 1: Mood Fallback Test
**Voice:** Warm, nostalgic, familiar. Like your actual grandmother.
`
      const result = parseVibesFromBrief(brief)
      // Should extract adjectives from voice (part before period)
      expect(result[0].mood).toBe('Warm, nostalgic, familiar')
    })

    it('handles missing audience and mood gracefully', () => {
      const brief = `### Vibe 1: Minimal
**One-liner:** Test
`
      const result = parseVibesFromBrief(brief)
      expect(result[0].audience).toBe('')
      expect(result[0].mood).toBe('')
    })
  })

  describe('parseVibePreview - Vibe Preview section', () => {
    const vibePreviewBrief = `# Creative Brief: FalCaMel

## Vibe Preview

Gallery cards for vibe selection. Each entry maps to a built HTML file.

### vibe-1-qahwa.html
**Name:** QAHWA — Original
**Audience:** Heritage Seekers & Homesick Families
**Mood:** Warm, Nostalgic, Guilt-Inducing
**Colors:**
- Primary: \`#8B4513\`
- Secondary: \`#F5F5DC\`
- Accent: \`#722F37\`
- Text: \`#2C1810\`
**Fonts:**
- Headings: Playfair Display
- Body: Source Sans Pro

### vibe-1-qahwa-v2.html
**Name:** QAHWA — Refined
**Audience:** Heritage Seekers & Homesick Families
**Mood:** Warm, Nostalgic, Guilt-Inducing
**Colors:**
- Primary: \`#8B4513\`
- Secondary: \`#F5F5DC\`
- Accent: \`#722F37\`
- Text: \`#2C1810\`
**Fonts:**
- Headings: Playfair Display
- Body: Source Sans Pro

### vibe-3-the-race.html
**Name:** THE RACE — Adrenaline
**Audience:** Champions & Adrenaline Seekers
**Mood:** Confident, Competitive, Cocky
**Colors:**
- Primary: \`#1C1C1C\`
- Secondary: \`#FFD700\`
- Accent: \`#DC143C\`
- Text: \`#FFFFFF\`
**Fonts:**
- Headings: Oswald
- Body: Roboto

---

## The Residents
`

    it('parses Vibe Preview section by filename', () => {
      const result = parseVibePreview(vibePreviewBrief)
      expect(result.size).toBe(3)
      expect(result.has('vibe-1-qahwa.html')).toBe(true)
      expect(result.has('vibe-1-qahwa-v2.html')).toBe(true)
      expect(result.has('vibe-3-the-race.html')).toBe(true)
    })

    it('extracts name from Vibe Preview', () => {
      const result = parseVibePreview(vibePreviewBrief)
      expect(result.get('vibe-1-qahwa.html')?.name).toBe('QAHWA — Original')
      expect(result.get('vibe-1-qahwa-v2.html')?.name).toBe('QAHWA — Refined')
    })

    it('extracts audience from Vibe Preview', () => {
      const result = parseVibePreview(vibePreviewBrief)
      expect(result.get('vibe-1-qahwa.html')?.audience).toBe('Heritage Seekers & Homesick Families')
    })

    it('extracts mood from Vibe Preview', () => {
      const result = parseVibePreview(vibePreviewBrief)
      expect(result.get('vibe-1-qahwa.html')?.mood).toBe('Warm, Nostalgic, Guilt-Inducing')
      expect(result.get('vibe-3-the-race.html')?.mood).toBe('Confident, Competitive, Cocky')
    })

    it('extracts colors from Vibe Preview', () => {
      const result = parseVibePreview(vibePreviewBrief)
      const qahwa = result.get('vibe-1-qahwa.html')
      expect(qahwa?.colors.primary).toBe('#8B4513')
      expect(qahwa?.colors.secondary).toBe('#F5F5DC')
      expect(qahwa?.colors.accent).toBe('#722F37')
      expect(qahwa?.colors.text).toBe('#2C1810')
    })

    it('extracts fonts from Vibe Preview', () => {
      const result = parseVibePreview(vibePreviewBrief)
      const race = result.get('vibe-3-the-race.html')
      expect(race?.fonts.headings).toBe('Oswald')
      expect(race?.fonts.body).toBe('Roboto')
    })

    it('returns empty map when no Vibe Preview section', () => {
      const briefWithoutPreview = `# Creative Brief: Test

## Business Info
Just some content
`
      const result = parseVibePreview(briefWithoutPreview)
      expect(result.size).toBe(0)
    })

    it('ignores non-html headers in Vibe Preview', () => {
      const briefWithNonHtml = `# Creative Brief: Test

## Vibe Preview

### vibe-1-qahwa.html
**Name:** QAHWA
**Audience:** Testers

### Some Other Section
This is not an HTML file

---

## Next Section
`
      const result = parseVibePreview(briefWithNonHtml)
      expect(result.size).toBe(1)
      expect(result.has('vibe-1-qahwa.html')).toBe(true)
    })
  })

  // ── REGRESSION 2026-04-26 — vibe-5.md silent parser failure ──────────
  // CD wrote `# Vibe 5: Title` (single hash, mixed-case "Vibe"). The old
  // patterns required either uppercase `VIBE` for `#`/`##`, or `###` for
  // mixed-case. Result: vibe-5 silently failed to parse → WebDev never
  // built it. Removing or weakening these tests is forbidden.
  describe('REGRESSION 2026-04-26 — case-insensitive vibe headers', () => {
    it('parses `# Vibe N: name` (single hash, mixed-case)', () => {
      const brief = '# Vibe 5: Oskar Home Staging\n\nVoice: Confident.\n'
      const vibes = parseVibesFromBrief(brief)
      expect(vibes.length).toBe(1)
      expect(vibes[0].index).toBe(5)
      expect(vibes[0].name).toBe('Oskar Home Staging')
    })

    it('parses `# vibe N: name` (single hash, all lowercase)', () => {
      const brief = '# vibe 2: Some Name\n\nVoice: foo.\n'
      const vibes = parseVibesFromBrief(brief)
      expect(vibes.length).toBe(1)
      expect(vibes[0].index).toBe(2)
    })

    it('parses `## Vibe N: name` (double hash, mixed-case)', () => {
      const brief = '## Vibe 3: Another\n\nVoice: bar.\n'
      const vibes = parseVibesFromBrief(brief)
      expect(vibes.length).toBe(1)
      expect(vibes[0].index).toBe(3)
    })

    it('parses `### VIBE N: name` (triple hash, all uppercase)', () => {
      const brief = '### VIBE 4: Third\n\nVoice: baz.\n'
      const vibes = parseVibesFromBrief(brief)
      expect(vibes.length).toBe(1)
      expect(vibes[0].index).toBe(4)
    })

    it('still parses canonical `# VIBE N: name` (uppercase, single hash)', () => {
      const brief = '# VIBE 1: Original Style\n\nVoice: classic.\n'
      const vibes = parseVibesFromBrief(brief)
      expect(vibes.length).toBe(1)
      expect(vibes[0].index).toBe(1)
    })
  })
})
