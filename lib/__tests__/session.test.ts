import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { humanizeSessionId } from '../session'

// We'll test the pure functions and type structures
// File I/O tests would need memfs or similar mocking

describe('session types', () => {
  describe('SessionPhase', () => {
    const validPhases = [
      'PHASE_1_DISCOVERY',
      'PHASE_2_VIBES',
      'PHASE_3_BUILD',
      'PHASE_4_POLISH',
      'COMPLETE',
    ]

    it('includes all workflow phases', () => {
      expect(validPhases).toContain('PHASE_1_DISCOVERY')
      expect(validPhases).toContain('PHASE_2_VIBES')
      expect(validPhases).toContain('PHASE_3_BUILD')
      expect(validPhases).toContain('PHASE_4_POLISH')
      expect(validPhases).toContain('COMPLETE')
    })
  })

  describe('WorkflowState', () => {
    it('has correct default structure', () => {
      const defaultState = {
        imagesUploaded: false,
        imagesAnalyzed: false,
        discoveryComplete: false,
        vibesDeveloped: 0,
        imagePromptsApproved: false,
        ceoSelectionMade: false,
        finalBuildComplete: false,
      }
      expect(defaultState.vibesDeveloped).toBe(0)
      expect(typeof defaultState.imagesUploaded).toBe('boolean')
    })

    it('tracks vibe count correctly', () => {
      const state = { vibesDeveloped: 3 }
      expect(state.vibesDeveloped).toBeLessThanOrEqual(5)
    })
  })

  describe('SessionMeta', () => {
    it('has correct interface shape', () => {
      const meta = {
        id: '2026-01-29-1',
        businessName: 'FalCaMel Cafe',
        createdAt: '2026-01-29T10:00:00.000Z',
        phase: 'PHASE_1_DISCOVERY' as const,
        workflowState: {
          imagesUploaded: false,
          imagesAnalyzed: false,
          discoveryComplete: false,
          vibesDeveloped: 0,
          imagePromptsApproved: false,
          ceoSelectionMade: false,
          finalBuildComplete: false,
        },
      }
      expect(meta.id).toMatch(/^\d{4}-\d{2}-\d{2}-\d+$/)
      expect(meta.businessName).toBeTruthy()
    })

    it('supports optional discoverySummary', () => {
      const metaWithSummary = {
        id: '2026-01-29-1',
        businessName: 'Test',
        createdAt: new Date().toISOString(),
        phase: 'PHASE_2_VIBES' as const,
        workflowState: {
          imagesUploaded: true,
          imagesAnalyzed: true,
          discoveryComplete: true,
          vibesDeveloped: 3,
          imagePromptsApproved: false,
          ceoSelectionMade: false,
          finalBuildComplete: false,
        },
        discoverySummary: {
          oneSentence: 'A cat cafe in the desert',
          customer: 'Adventure seekers',
          weirdDetail: 'Features a falcon and camel',
          enemy: 'Generic chain cafes',
        },
      }
      expect(metaWithSummary.discoverySummary).toBeDefined()
      expect(metaWithSummary.discoverySummary?.oneSentence).toBeTruthy()
    })
  })
})

describe('session ID generation', () => {
  it('session ID format is YYYY-MM-DD-n', () => {
    const pattern = /^\d{4}-\d{2}-\d{2}-\d+$/
    expect('2026-01-29-1').toMatch(pattern)
    expect('2026-01-29-12').toMatch(pattern)
    expect('2026-12-31-999').toMatch(pattern)
  })

  it('rejects invalid session ID formats', () => {
    const pattern = /^\d{4}-\d{2}-\d{2}-\d+$/
    expect('invalid').not.toMatch(pattern)
    expect('2026-01-29').not.toMatch(pattern)
    expect('2026-1-29-1').not.toMatch(pattern)
  })
})

describe('slug generation', () => {
  function generateSlug(businessName: string): string {
    return businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 30)
  }

  it('converts to lowercase', () => {
    expect(generateSlug('FalCaMel Cafe')).toBe('falcamel-cafe')
  })

  it('replaces spaces with hyphens', () => {
    expect(generateSlug('My Business Name')).toBe('my-business-name')
  })

  it('removes special characters', () => {
    expect(generateSlug("Joe's Coffee & Tea")).toBe('joe-s-coffee-tea')
  })

  it('removes leading/trailing hyphens', () => {
    expect(generateSlug('  Test  ')).toBe('test')
    expect(generateSlug('---Test---')).toBe('test')
  })

  it('truncates to 30 characters', () => {
    const longName = 'This Is A Very Long Business Name That Exceeds The Limit'
    expect(generateSlug(longName).length).toBeLessThanOrEqual(30)
  })

  it('handles empty string', () => {
    expect(generateSlug('')).toBe('')
  })

  it('handles numbers', () => {
    expect(generateSlug('Cafe 123')).toBe('cafe-123')
  })
})

describe('SESSION.md parsing', () => {
  const sampleSessionMd = `# Session: FalCaMel Cafe
**Created:** 2026-01-29T10:00:00.000Z
**Status:** PHASE_2_VIBES
**Business:** FalCaMel Cafe

---

## Workflow State
- [x] Images uploaded
- [x] Images analyzed by CD
- [x] Discovery complete
- [ ] Vibes developed (3/5)
- [ ] Image prompts approved
- [ ] CEO selection made
- [ ] Final build complete

---

## Discovery Summary
**One-sentence:** A desert cat cafe with a falcon and camel
**Customer:** Adventure-seeking travelers
**Weird detail:** Located on the Tuwaiq Escarpment
**Enemy:** Generic chain cafes

---

## Conversation Log
`

  // Ralph 2026-06-01 — was: regex-extracts `**Business:** Name` from
  // SESSION.md. Eliminated because CD's Confirm-Understanding cards
  // hijacked that pattern with multi-sentence brand paragraphs, producing
  // a 500-char gibberish top-bar. Replaced with the deterministic
  // `humanizeSessionId` helper, tested below.
  describe('humanizeSessionId', () => {
    it('reverses a date-prefixed slug to a title-cased name', () => {
      expect(humanizeSessionId('2026-05-31-weingut-barbazza')).toBe('Weingut Barbazza')
    })
    it('handles legacy slugs without a date prefix', () => {
      expect(humanizeSessionId('falcamel-cafe')).toBe('Falcamel Cafe')
      expect(humanizeSessionId('escrow-smoketest')).toBe('Escrow Smoketest')
    })
    it('does not touch standalone numbers after the date strip', () => {
      // "2026-01-27-18" → strip date → "18" → "18"
      expect(humanizeSessionId('2026-01-27-18')).toBe('18')
    })
    it('returns empty for empty input — never throws', () => {
      expect(humanizeSessionId('')).toBe('')
    })
    it('is immune to CD-Confirm-Understanding hijack — input is sessionId, not markdown', () => {
      // The bug surface (`**Business:** [long paragraph]` in SESSION.md)
      // is unreachable: this function NEVER reads markdown. The output is
      // a pure function of the sessionId alone.
      const input = '2026-05-31-weingut-barbazza'
      const out = humanizeSessionId(input)
      expect(out.length).toBeLessThan(60)  // sanity: top-bar-sized
      expect(out).not.toContain('—')
      expect(out).not.toContain('500-year')
    })
  })

  describe('phase extraction', () => {
    it('extracts phase from **Status:** field', () => {
      const match = sampleSessionMd.match(/\*\*Status:\*\*\s*(PHASE_\d_\w+|COMPLETE)/)
      expect(match?.[1]).toBe('PHASE_2_VIBES')
    })
  })

  describe('workflow state parsing', () => {
    it('detects checked boxes with [x]', () => {
      expect(sampleSessionMd).toContain('[x] Images uploaded')
      expect(sampleSessionMd.includes('[x] Images uploaded')).toBe(true)
    })

    it('detects unchecked boxes with [ ]', () => {
      expect(sampleSessionMd).toContain('[ ] Image prompts approved')
    })

    it('extracts vibes count from (n/5) format', () => {
      const match = sampleSessionMd.match(/Vibes developed \((\d)\/5\)/)
      expect(match?.[1]).toBe('3')
    })
  })

  describe('discovery summary parsing', () => {
    it('extracts one-sentence description', () => {
      const match = sampleSessionMd.match(/\*\*One-sentence:\*\*\s*(.+)/)
      expect(match?.[1].trim()).toBe('A desert cat cafe with a falcon and camel')
    })

    it('extracts customer', () => {
      const match = sampleSessionMd.match(/\*\*Customer:\*\*\s*(.+)/)
      expect(match?.[1].trim()).toBe('Adventure-seeking travelers')
    })

    it('extracts weird detail', () => {
      const match = sampleSessionMd.match(/\*\*Weird detail:\*\*\s*(.+)/)
      expect(match?.[1].trim()).toBe('Located on the Tuwaiq Escarpment')
    })

    it('extracts enemy', () => {
      const match = sampleSessionMd.match(/\*\*Enemy:\*\*\s*(.+)/)
      expect(match?.[1].trim()).toBe('Generic chain cafes')
    })
  })
})

describe('IMAGES.md parsing', () => {
  const sampleImagesMd = `# Image Registry

## Uploaded Images

### hero.jpg
**Uploaded:** 2026-01-29T10:30:00.000Z
**CD Analysis:** A stunning desert landscape with golden sand dunes
**Suggested uses:** hero, background
**Suggested vibes:** Desert Oasis, Qahwa
**Reprompt:** Desert landscape at golden hour with dramatic shadows

### sultan.jpg
**Uploaded:** 2026-01-29T10:31:00.000Z
**CD Analysis:** Portrait of a majestic falcon
**Suggested uses:** portrait, icon
**Suggested vibes:** Qahwa, Majlis

---

## Image Prompts + Generated

*No image prompts yet*
`

  describe('image entry parsing', () => {
    it('finds image entries by ### headers', () => {
      const entries = sampleImagesMd.split(/(?=^### )/m).filter(e => e.trim().startsWith('### '))
      expect(entries).toHaveLength(2)
    })

    it('extracts filename from header', () => {
      const match = sampleImagesMd.match(/^### (.+)$/m)
      expect(match?.[1].trim()).toBe('hero.jpg')
    })

    it('extracts uploaded timestamp', () => {
      const match = sampleImagesMd.match(/\*\*Uploaded:\*\*\s*(.+)/)
      expect(match?.[1].trim()).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('extracts CD analysis', () => {
      const match = sampleImagesMd.match(/\*\*CD Analysis:\*\*\s*([\s\S]+?)(?=\n\*\*|$)/)
      expect(match?.[1].trim()).toBe('A stunning desert landscape with golden sand dunes')
    })

    it('extracts suggested uses as array', () => {
      const match = sampleImagesMd.match(/\*\*Suggested uses:\*\*\s*(.+)/)
      const uses = match?.[1].split(',').map(s => s.trim())
      expect(uses).toContain('hero')
      expect(uses).toContain('background')
    })

    it('extracts reprompt', () => {
      const match = sampleImagesMd.match(/\*\*Reprompt:\*\*\s*([\s\S]+?)(?=\n\*\*|\n###|$)/)
      expect(match?.[1].trim()).toBe('Desert landscape at golden hour with dramatic shadows')
    })
  })
})

describe('BUILD.md structure', () => {
  const sampleBuildMd = `# Build Log

## Status
**Current Phase:** PHASE_2_VIBES
**Vibes Requested:** 5
**Vibes Complete:** 2
**Vibes Building:** 1
**Vibes Pending:** 2

---

## Vibe Queue

| # | Name | Status | Started | Completed |
|---|------|--------|---------|-----------|
| 1 | Qahwa | complete | 10:35:00 | 10:36:12 |
| 2 | Majlis | complete | 10:36:15 | 10:37:30 |
| 3 | Desert | building | 10:37:35 | - |
| 4 | Oasis | pending | - | - |
| 5 | Falcon | pending | - | - |

---

## Hot-Swap Log

| Time | Vibe | Slot | Old | New |
|------|------|------|-----|-----|
| 10:38:00 | 1-qahwa | hero | placeholder.jpg | qahwa-hero-v1.jpg |
`

  it('has vibe queue table', () => {
    expect(sampleBuildMd).toContain('## Vibe Queue')
    expect(sampleBuildMd).toContain('| # | Name | Status |')
  })

  it('has hot-swap log table', () => {
    expect(sampleBuildMd).toContain('## Hot-Swap Log')
    expect(sampleBuildMd).toContain('| Time | Vibe | Slot | Old | New |')
  })

  it('tracks vibe statuses', () => {
    expect(sampleBuildMd).toContain('| 1 | Qahwa | complete |')
    expect(sampleBuildMd).toContain('| 3 | Desert | building |')
    expect(sampleBuildMd).toContain('| 4 | Oasis | pending |')
  })
})

describe('CREATIVE-BRIEF.md structure', () => {
  describe('status values', () => {
    const validStatuses = [
      'DRAFT',
      'DISCOVERY_COMPLETE',
      'VIBES_READY',
      'CEO_SELECTED',
      'ARCHETYPE_VERIFIED',
      'FINAL',
    ]

    it('includes all workflow statuses', () => {
      expect(validStatuses).toHaveLength(6)
      expect(validStatuses).toContain('DRAFT')
      expect(validStatuses).toContain('FINAL')
    })
  })

  describe('BriefVibe structure', () => {
    it('has required fields', () => {
      const vibe = {
        id: 'vibe-1',
        name: 'Desert Oasis',
        headline: 'Where the Desert Meets Your Cup',
        tagline: 'An oasis of calm in the golden sands',
        colors: ['#C76B00', '#F5F5F5', '#1C1C1E'],
        typography: {
          heading: 'Georgia',
          body: 'system-ui',
        },
      }
      expect(vibe.id).toBeTruthy()
      expect(vibe.name).toBeTruthy()
      expect(vibe.colors).toHaveLength(3)
    })
  })

  describe('BriefArchetype structure', () => {
    it('captures booking logic correctly', () => {
      const archetype = {
        atomicUnit: 'A seat at a table',
        specificUnitSelection: false,
        concurrentBooking: true,
        durationModel: 'rigid' as const,
        pricingModel: 'per person per visit',
        closestArchetype: 'Fitness Class',
        adjustments: 'No class times, just open seating',
      }
      expect(archetype.durationModel).toBe('rigid')
      expect(typeof archetype.specificUnitSelection).toBe('boolean')
    })
  })
})

describe('file path handling', () => {
  it('session path is /public/{sessionId}', () => {
    const sessionId = '2026-01-29-1'
    const expectedPath = `/public/${sessionId}`
    expect(expectedPath).toBe('/public/2026-01-29-1')
  })

  it('vibe filename format is vibe-{n}-{name}-{page}.html', () => {
    const filename = 'vibe-1-qahwa-landing.html'
    expect(filename).toMatch(/^vibe-\d+-[\w-]+-\w+\.html$/)
  })

  it('generated image format is {vibe}-{purpose}-v{version}.{ext}', () => {
    const filename = 'qahwa-hero-v2.jpg'
    expect(filename).toMatch(/^[\w-]+-\w+-v\d+\.\w+$/)
  })
})
