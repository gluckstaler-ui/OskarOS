// ============================================================================
// lib/scrapers/index.ts — registry of directory scrapers (Ralph 2026-06-05).
//
// Adds a scraper = add a line here. The discover route reads the map.
// Anything not in the map is unknown — the route 404s on a bad registerId.
// ============================================================================

import { fspScraper } from './fsp'
import type { RegisterId, Scraper } from './types'

const REGISTRY: Record<RegisterId, Scraper> = {
  fsp: fspScraper,
  // Future: 'fmh': fmhScraper, 'spv': spvScraper, ...
}

export function getScraper(id: string): Scraper | undefined {
  return REGISTRY[id as RegisterId]
}

export function listScrapers(): Array<{ id: RegisterId; label: string; criteriaFields: Scraper['criteriaFields'] }> {
  return Object.values(REGISTRY).map((s) => ({
    id: s.id,
    label: s.label,
    criteriaFields: s.criteriaFields,
  }))
}

export type { RegisterId, Scraper, ScraperCriteria, ScrapedLead, ScraperProgress } from './types'
