// Permanent regression suite for lib/markdown-fields.ts.
//
// The 2026-04-25-2 incident — silent WebDev failures across 11 BUILD trigger
// cycles — was caused by a one-character regex bug. This file is the
// belt-and-braces guarantee that the same class of bug can't recur silently:
// any future edit to markdown-fields.ts will run these tests in CI.

import { describe, it, expect } from 'vitest'
import {
  matchField,
  matchFieldMultiline,
  formatField,
  replaceField,
} from '../markdown-fields'

describe('markdown-fields', () => {
  describe('matchField — single line', () => {
    it('plain: "Vibe: Hero"', () => {
      expect(matchField('Vibe: Hero', 'Vibe')).toBe('Hero')
    })
    it('bold-labeled: "**Vibe:** Hero"', () => {
      expect(matchField('**Vibe:** Hero', 'Vibe')).toBe('Hero')
    })
    it('bold on wrong side: "**Vibe**: Hero"', () => {
      expect(matchField('**Vibe**: Hero', 'Vibe')).toBe('Hero')
    })
    it('extra spaces: "**Vibe:**   Hero Image"', () => {
      expect(matchField('**Vibe:**   Hero Image', 'Vibe')).toBe('Hero Image')
    })
    it('lowercase field name', () => {
      expect(matchField('vibe: Hero', 'Vibe')).toBe('Hero')
    })
    it('multi-word field: "Aspect Ratio: 16:9"', () => {
      expect(matchField('Aspect Ratio: 16:9', 'Aspect Ratio')).toBe('16:9')
    })
    it('value containing a colon', () => {
      expect(matchField('Vibe: Hero: Image', 'Vibe')).toBe('Hero: Image')
    })
    it('finds field nested in larger text', () => {
      expect(
        matchField('intro paragraph\nVibe: Hero\nmore text', 'Vibe'),
      ).toBe('Hero')
    })
    it('strips orphan asterisks from value: "Vibe: ** Hero **"', () => {
      expect(matchField('Vibe: ** Hero **', 'Vibe')).toBe('Hero')
    })
    it('keeps inner content of bold value: "**Vibe:** **Hero**"', () => {
      expect(matchField('**Vibe:** **Hero**', 'Vibe')).toBe('Hero')
    })
    it('returns null when field is absent', () => {
      expect(matchField('No vibe here', 'Vibe')).toBeNull()
    })
    it('requireLineStart: rejects field nested in prose', () => {
      expect(
        matchField('intro Vibe: Hero', 'Vibe', { requireLineStart: true }),
      ).toBeNull()
    })
    it('requireLineStart: still matches at line start', () => {
      expect(
        matchField('Vibe: Hero', 'Vibe', { requireLineStart: true }),
      ).toBe('Hero')
    })
  })

  describe('matchFieldMultiline', () => {
    it('plain field stops at next bold field', () => {
      const text = 'Reprompt: First line\nSecond line\n**Status:** PENDING'
      expect(matchFieldMultiline(text, 'Reprompt')).toBe('First line\nSecond line')
    })
    it('bold field spans paragraphs to next field', () => {
      const text = '**CD Analysis:** Para one.\n\nPara two.\n**Suggested uses:** hero'
      expect(matchFieldMultiline(text, 'CD Analysis')).toBe('Para one.\n\nPara two.')
    })
    it('stops at ### header', () => {
      const text = 'Instruction: Do this.\nAnd this.\n### Next Section'
      expect(matchFieldMultiline(text, 'Instruction')).toBe('Do this.\nAnd this.')
    })
    it('stops at #### turn marker', () => {
      const text = 'Reprompt: New text.\n#### User | 12:00'
      expect(matchFieldMultiline(text, 'Reprompt')).toBe('New text.')
    })
    it('stops at --- separator', () => {
      const text = 'CD Analysis: Lots of detail\nover multiple lines\n---\n## Next'
      expect(matchFieldMultiline(text, 'CD Analysis')).toBe('Lots of detail\nover multiple lines')
    })
    it('runs to end of string when no boundary present', () => {
      const text = 'Notes: Final field.\nLast line.'
      expect(matchFieldMultiline(text, 'Notes')).toBe('Final field.\nLast line.')
    })
  })

  describe('formatField', () => {
    it('emits canonical plain form', () => {
      expect(formatField('Vibe', 'Hero Image')).toBe('Vibe: Hero Image')
    })
  })

  describe('replaceField', () => {
    it('preserves bold-labeled format on replace', () => {
      expect(
        replaceField('intro\n**Status:** OLD\nmore', 'Status', 'NEW'),
      ).toBe('intro\n**Status:** NEW\nmore')
    })
    it('preserves plain format on replace', () => {
      expect(replaceField('Status: OLD', 'Status', 'NEW')).toBe('Status: NEW')
    })
    it('is a no-op when the field is missing', () => {
      expect(replaceField('No field here', 'Status', 'NEW')).toBe('No field here')
    })
  })

  // ── REGRESSION GUARDS — the exact 2026-04-25-2 failure shapes ───────────
  // These EXACT strings caused vibeName/vibeId/aspectRatio/status to leak
  // a `** ` prefix that propagated through to filenames and broke WebDev.
  // Removing or weakening these tests is forbidden.
  describe('REGRESSION 2026-04-25-2 — silent WebDev failure', () => {
    it('vibeName has NO leading "** " prefix', () => {
      expect(matchField('**Vibe:** Vibe 1 — Das Zuviel', 'Vibe'))
        .toBe('Vibe 1 — Das Zuviel')
    })
    it('aspectRatio has NO leading "** " prefix', () => {
      expect(matchField('**Aspect Ratio:** 16:9', 'Aspect Ratio'))
        .toBe('16:9')
    })
    it('status has NO leading "** " prefix', () => {
      expect(matchField('**Status:** ACTIVE', 'Status')).toBe('ACTIVE')
    })
    it('purpose has NO leading "** " prefix', () => {
      expect(matchField('**Purpose:** hero / praxis-baden', 'Purpose'))
        .toBe('hero / praxis-baden')
    })
    it('a value with prefix would NEVER pass through to a vibeId slug', () => {
      // Defense check: even if the parser regressed and leaked `** `, the
      // value should not contain literal asterisks that would corrupt
      // a slug. (Not a parser test — a sanity check for downstream code.)
      const v = matchField('**Vibe:** Vibe 1 — Das Zuviel', 'Vibe') || ''
      expect(v).not.toMatch(/\*/)
    })
  })
})
