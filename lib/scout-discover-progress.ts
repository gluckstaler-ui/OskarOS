// ============================================================================
// lib/scout-discover-progress.ts — globalThis-pinned progress store for
// the /api/admin/crm/scout/discover job. Ralph 2026-06-05.
//
// Lifted out of the route file so the sibling /progress GET endpoint can
// read it without a cross-route import (which Next 16 tolerates but is
// fragile under HMR/RSC reordering).
// ============================================================================

import type { ScraperCriteria, ScraperProgress } from './scrapers/types'

/**
 * One row in the discover overlay's activity log — Ralph 2026-06-05.
 *
 * The overlay used to show ONLY the last 5 inserted IDs (hardcoded slice
 * with no transparency about deduplication or failures). That hid what
 * was actually happening when a Discover run mostly hit already-known
 * profiles: matched climbs, inserted stays 0, panel looks broken.
 *
 * Now every matched lead pushes ONE entry into this list with its outcome:
 *   inserted  — a brand-new R### row in the pool
 *   duplicate — dedup-rejected (with reason: website / contact / name+adresse)
 *   failed    — ingest threw (network / write error)
 *
 * Server keeps the full list (no cap). Client renders it as a scrollable
 * activity feed in the overlay card. JSON size grows ~100 bytes per
 * entry; for a typical 200-row Discover that's 20KB per poll — fine.
 */
export interface DiscoverLeadEntry {
  /** Display name for the card row. */
  name: string
  /** Profile URL or other context the user might want to click through to. */
  detail?: string
  /** Outcome of the ingest attempt. */
  status: 'inserted' | 'duplicate' | 'failed'
  /** Pool ID when status === 'inserted'. */
  id?: string
  /** Dedup reason when status === 'duplicate'; error message when 'failed'. */
  reason?: string
}

export interface DiscoverProgress extends ScraperProgress {
  register: string
  criteria: ScraperCriteria
  startedAt: string
  finishedAt?: string
  insertedIds: string[]
  /**
   * Per-lead activity log, newest first. Populated by the discover route's
   * flush handler after each ingest call. Drives the overlay's full
   * activity-feed display.
   */
  recentLeads: DiscoverLeadEntry[]
}

const PROGRESS_KEY = Symbol.for('oskar.scout-discover.progress') as unknown as string
const g = globalThis as Record<string, unknown>
const progressMap: Map<string, DiscoverProgress> =
  (g[PROGRESS_KEY] as Map<string, DiscoverProgress>) ||
  ((g[PROGRESS_KEY] = new Map<string, DiscoverProgress>()) as Map<string, DiscoverProgress>)

export function setProgress(jobId: string, p: DiscoverProgress): void {
  progressMap.set(jobId, p)
}
export function updateProgress(jobId: string, patch: Partial<DiscoverProgress>): void {
  const prev = progressMap.get(jobId)
  if (!prev) return
  progressMap.set(jobId, { ...prev, ...patch })
}
export function getProgress(jobId: string): DiscoverProgress | undefined {
  return progressMap.get(jobId)
}
export function appendInsertedIds(jobId: string, ids: string[]): void {
  const prev = progressMap.get(jobId)
  if (!prev) return
  progressMap.set(jobId, { ...prev, insertedIds: [...prev.insertedIds, ...ids] })
}
/** Push lead entries onto the activity log. Newest-first ordering — prepend. */
export function appendRecentLeads(jobId: string, entries: DiscoverLeadEntry[]): void {
  const prev = progressMap.get(jobId)
  if (!prev) return
  progressMap.set(jobId, {
    ...prev,
    recentLeads: [...entries, ...prev.recentLeads],
  })
}
