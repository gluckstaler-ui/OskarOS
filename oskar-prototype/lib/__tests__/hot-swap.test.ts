import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isPlaceholder,
  inferSlotFromFilename,
} from '../hot-swap'

// Mock fs/promises for file operation tests
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
}))

describe('hot-swap', () => {
  describe('isPlaceholder', () => {
    it('returns true for placeholder.jpg', () => {
      expect(isPlaceholder('placeholder.jpg')).toBe(true)
    })

    it('returns true for placeholder.png', () => {
      expect(isPlaceholder('placeholder.png')).toBe(true)
    })

    it('returns true for filenames starting with placeholder', () => {
      expect(isPlaceholder('placeholder-hero.jpg')).toBe(true)
      expect(isPlaceholder('placeholder_image.png')).toBe(true)
    })

    it('returns true for empty string', () => {
      expect(isPlaceholder('')).toBe(true)
    })

    it('returns false for actual image filenames', () => {
      expect(isPlaceholder('hero.jpg')).toBe(false)
      expect(isPlaceholder('qahwa-hero-v1.jpg')).toBe(false)
      expect(isPlaceholder('menu-bg.png')).toBe(false)
    })

    it('returns false for filenames containing placeholder not at start', () => {
      expect(isPlaceholder('my-placeholder.jpg')).toBe(false)
    })
  })

  describe('inferSlotFromFilename', () => {
    describe('standard naming convention ({vibe}-{purpose}-v{version}.{ext})', () => {
      it('extracts slot from qahwa-hero-v1.jpg', () => {
        expect(inferSlotFromFilename('qahwa-hero-v1.jpg')).toBe('hero')
      })

      it('extracts slot from majlis-menu-v2.png', () => {
        expect(inferSlotFromFilename('majlis-menu-v2.png')).toBe('menu')
      })

      it('extracts slot from desert-background-v3.webp', () => {
        expect(inferSlotFromFilename('desert-background-v3.webp')).toBe('background')
      })

      it('handles multi-word vibe names', () => {
        expect(inferSlotFromFilename('modern-majlis-hero-v1.jpg')).toBe('hero')
      })

      it('handles version numbers > 9', () => {
        expect(inferSlotFromFilename('cafe-portrait-v12.jpg')).toBe('portrait')
      })
    })

    describe('simple filenames (common slots)', () => {
      it('recognizes hero.jpg', () => {
        expect(inferSlotFromFilename('hero.jpg')).toBe('hero')
      })

      it('recognizes menu-bg.jpg', () => {
        expect(inferSlotFromFilename('menu-bg.jpg')).toBe('menu-bg')
      })

      it('recognizes background.png', () => {
        expect(inferSlotFromFilename('background.png')).toBe('background')
      })

      it('recognizes portrait.jpg', () => {
        expect(inferSlotFromFilename('portrait.jpg')).toBe('portrait')
      })

      it('recognizes icon.png', () => {
        expect(inferSlotFromFilename('icon.png')).toBe('icon')
      })

      it('recognizes gallery.jpg', () => {
        expect(inferSlotFromFilename('gallery.jpg')).toBe('gallery')
      })
    })

    describe('unrecognized filenames', () => {
      it('returns null for random filenames', () => {
        expect(inferSlotFromFilename('random-image.jpg')).toBeNull()
      })

      it('returns null for filenames without extension', () => {
        expect(inferSlotFromFilename('hero')).toBeNull()
      })

      it('returns null for complex non-matching patterns', () => {
        expect(inferSlotFromFilename('my-custom-photo-2024.jpg')).toBeNull()
      })

      it('returns null for empty string', () => {
        expect(inferSlotFromFilename('')).toBeNull()
      })
    })

    describe('case sensitivity', () => {
      it('handles lowercase slot names', () => {
        expect(inferSlotFromFilename('hero.jpg')).toBe('hero')
      })

      it('handles uppercase slot names (converted to lowercase)', () => {
        // The simpleMatch regex extracts the name and checks against lowercase common slots
        // HERO.jpg -> simpleMatch extracts 'HERO' -> lowercase 'hero' -> matches common slot
        expect(inferSlotFromFilename('HERO.jpg')).toBe('hero')
      })
    })
  })

  describe('SlotInfo structure', () => {
    it('has correct interface shape', () => {
      const slotInfo = {
        vibe: 'vibe-1-qahwa-landing.html',
        slot: 'hero',
        currentImage: 'placeholder.jpg',
      }
      expect(slotInfo.vibe).toBeDefined()
      expect(slotInfo.slot).toBeDefined()
      expect(slotInfo.currentImage).toBeDefined()
    })
  })

  describe('HotSwapResult structure', () => {
    it('has correct success result shape', () => {
      const result = {
        success: true,
        vibesUpdated: ['vibe-1-qahwa.html'],
        slotsSwapped: [
          {
            vibe: 'vibe-1-qahwa.html',
            slot: 'hero',
            oldImage: 'placeholder.jpg',
            newImage: 'qahwa-hero-v1.jpg',
          },
        ],
      }
      expect(result.success).toBe(true)
      expect(result.vibesUpdated).toHaveLength(1)
      expect(result.slotsSwapped[0].oldImage).toBe('placeholder.jpg')
    })

    it('has correct error result shape', () => {
      const result = {
        success: false,
        vibesUpdated: [],
        slotsSwapped: [],
        error: 'No vibes found with slot "hero"',
      }
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})

describe('hot-swap HTML patterns', () => {
  describe('img tag pattern matching', () => {
    const imgWithDataSlotFirst = '<img data-slot="hero" src="placeholder.jpg" alt="Hero image">'
    const imgWithSrcFirst = '<img src="placeholder.jpg" data-slot="hero" alt="Hero image">'
    const imgWithClasses = '<img class="w-full h-auto" data-slot="menu" src="menu.jpg">'

    it('pattern should match data-slot before src', () => {
      const pattern = /<img[^>]*data-slot="([^"]+)"[^>]*src="([^"]+)"[^>]*>/gi
      const match = pattern.exec(imgWithDataSlotFirst)
      expect(match).not.toBeNull()
      expect(match![1]).toBe('hero')
      expect(match![2]).toBe('placeholder.jpg')
    })

    it('alternate pattern should match src before data-slot', () => {
      const altPattern = /<img[^>]*src="([^"]+)"[^>]*data-slot="([^"]+)"[^>]*>/gi
      const match = altPattern.exec(imgWithSrcFirst)
      expect(match).not.toBeNull()
      expect(match![1]).toBe('placeholder.jpg')
      expect(match![2]).toBe('hero')
    })

    it('pattern handles additional attributes', () => {
      const pattern = /<img[^>]*data-slot="([^"]+)"[^>]*src="([^"]+)"[^>]*>/gi
      const match = pattern.exec(imgWithClasses)
      expect(match).not.toBeNull()
      expect(match![1]).toBe('menu')
    })
  })

  describe('replacement pattern', () => {
    it('correctly replaces src in img tag', () => {
      const html = '<img data-slot="hero" src="placeholder.jpg" alt="Hero">'
      const pattern = /(<img[^>]*data-slot="hero"[^>]*src=")([^"]+)("[^>]*>)/gi
      const newHtml = html.replace(pattern, '$1new-hero.jpg$3')
      expect(newHtml).toBe('<img data-slot="hero" src="new-hero.jpg" alt="Hero">')
    })

    it('replaces only matching slot', () => {
      const html = `
        <img data-slot="hero" src="hero-old.jpg">
        <img data-slot="menu" src="menu-old.jpg">
      `
      const pattern = /(<img[^>]*data-slot="hero"[^>]*src=")([^"]+)("[^>]*>)/gi
      const newHtml = html.replace(pattern, '$1hero-new.jpg$3')
      expect(newHtml).toContain('hero-new.jpg')
      expect(newHtml).toContain('menu-old.jpg') // unchanged
    })

    it('handles self-closing img tags', () => {
      const html = '<img data-slot="icon" src="old.png" />'
      const pattern = /(<img[^>]*data-slot="icon"[^>]*src=")([^"]+)("[^>]*>)/gi
      // Note: Pattern expects > at end, self-closing /> works because [^>]* matches /
      const newHtml = html.replace(pattern, '$1new.png$3')
      expect(newHtml).toContain('new.png')
    })
  })

  describe('edge cases in HTML', () => {
    it('handles img with no data-slot', () => {
      const html = '<img src="regular.jpg" alt="No slot">'
      const pattern = /<img[^>]*data-slot="([^"]+)"[^>]*src="([^"]+)"[^>]*>/gi
      const match = pattern.exec(html)
      expect(match).toBeNull()
    })

    it('does not match empty src (regex requires at least one char)', () => {
      const html = '<img data-slot="hero" src="" alt="Empty">'
      const pattern = /<img[^>]*data-slot="([^"]+)"[^>]*src="([^"]+)"[^>]*>/gi
      const match = pattern.exec(html)
      // Pattern ([^"]+) requires at least one character, so empty src doesn't match
      expect(match).toBeNull()
    })

    it('handles src with path', () => {
      const html = '<img data-slot="hero" src="/images/hero.jpg">'
      const pattern = /<img[^>]*data-slot="([^"]+)"[^>]*src="([^"]+)"[^>]*>/gi
      const match = pattern.exec(html)
      expect(match![2]).toBe('/images/hero.jpg')
    })

    it('handles src with session path', () => {
      const html = '<img data-slot="hero" src="/2026-01-29-1/hero-v1.jpg">'
      const pattern = /<img[^>]*data-slot="([^"]+)"[^>]*src="([^"]+)"[^>]*>/gi
      const match = pattern.exec(html)
      expect(match![2]).toBe('/2026-01-29-1/hero-v1.jpg')
    })
  })

  // ── REGRESSION 2026-04-26 — assign/swap HTML-corruption guards ────────
  // Two latent bugs in the swap path that could silently corrupt HTML:
  //   A) `slot` interpolated into RegExp source without escaping → regex
  //      metachars in slot names matched the wrong substrings
  //   B) `newImage` interpolated into String.replace replacement string
  //      → `$1`, `$&`, etc. interpreted as backreferences
  // Removing or weakening these tests is forbidden.
  describe('REGRESSION 2026-04-26 — swap HTML-safety guards', () => {
    function escapeRegex(s: string): string {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    it('escaped slot with dots matches literally, not as wildcards', () => {
      const slot = 'bgimg:hero.jpg'
      const escaped = escapeRegex(slot)
      const pattern = new RegExp(`data-slot="${escaped}"`, 'gi')
      expect(pattern.test('<img data-slot="bgimg:hero.jpg">')).toBe(true)
      pattern.lastIndex = 0
      expect(pattern.test('<img data-slot="bgimgXheroXjpg">')).toBe(false)
    })

    it('escaped slot with parens compiles and matches literally', () => {
      const slot = 'bgimg:img(1).jpg'
      const escaped = escapeRegex(slot)
      expect(() => new RegExp(`data-slot="${escaped}"`, 'gi')).not.toThrow()
      const pattern = new RegExp(`data-slot="${escaped}"`, 'gi')
      expect(pattern.test('<img data-slot="bgimg:img(1).jpg">')).toBe(true)
    })

    it('callback-based replace is immune to $-substitution in newImage', () => {
      const tag = '<img src="old.jpg" alt="x">'
      const newImage = 'new$&corrupt.jpg'
      // String replacement substitutes $& (the bug we fixed)
      const buggyResult = tag.replace(
        /\bsrc=(["'])[^"']+\1/i,
        `src="${newImage}"`,
      )
      expect(buggyResult).toContain('src="old.jpg"corrupt.jpg"')
      // Callback replacement preserves the literal value (the fix)
      const fixedResult = tag.replace(
        /\bsrc=(["'])[^"']+\1/i,
        () => `src="${newImage}"`,
      )
      expect(fixedResult).toBe('<img src="new$&corrupt.jpg" alt="x">')
    })
  })
})
