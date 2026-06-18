// ============================================================================
// lib/scout-backfill-progress.ts — globalThis-pinned per-job progress for
// the queried-lamp backfill. Ralph 2026-06-05 spec-review M-iii.
//
// Replaces the client's "poll the whole pool every 3s" pattern with a
// purpose-built status endpoint. Same shape as scout-discover-progress.
//
// Carries enough detail for the L-ii lamp-level snackbar:
//   "✓ 28 rows · 234 lamps filled · 5 rows had nothing to fill · 1 failed"
//
// HMR-safe via Symbol.for pin — survives Next dev reload, lost on process
// restart (acceptable; the running runner observes the same loss).
// ============================================================================

import type { JobStatus } from './build-escrow'

/**
 * Per-row outcome accumulated by the runner. Mirrors the route's PerRow
 * union but flattened for serialisation. `filledLamps` carries the lamp
 * keys that newly got values this run; null on non-success outcomes.
 */
export interface BackfillRowResult {
  id: string
  status: 'filled' | 'skipped' | 'failed' | 'cancelled'
  /** Lamp keys newly populated this run (only present when status === 'filled'). */
  filledLamps?: string[]
  /** Human-readable reason for skipped / failed rows. */
  reason?: string
}

export interface BackfillProgress {
  jobId: string
  /** Total rows the runner picked up at start. Stable for the whole run. */
  total: number
  /** How many rows have settled (any status). */
  processed: number
  /** Per-row results, appended as the runner completes each one. */
  perRow: BackfillRowResult[]
  /** Sum of `filledLamps.length` across all rows — the L-ii headline number. */
  lampsFilled: number
  /** ISO timestamp set when the runner returns (success / cancelled / failed). */
  finishedAt?: string
  /** Mirrored from the escrow job for the client poll's terminal-state check. */
  jobStatus?: JobStatus
}

const PROGRESS_KEY = Symbol.for('oskar.scout-backfill.progress') as unknown as string
const g = globalThis as Record<string, unknown>
const progressMap: Map<string, BackfillProgress> =
  (g[PROGRESS_KEY] as Map<string, BackfillProgress>) ||
  ((g[PROGRESS_KEY] = new Map<string, BackfillProgress>()) as Map<string, BackfillProgress>)

/** Seed an entry at runner start. Overwrites any prior with the same id. */
export function initBackfillProgress(jobId: string, total: number): void {
  progressMap.set(jobId, { jobId, total, processed: 0, perRow: [], lampsFilled: 0 })
}

/**
 * Record one row's outcome. Called by the runner as each worker settles.
 * Increments `processed` + `lampsFilled` atomically — no external locking
 * needed because Node's single-thread serialises the increment.
 */
export function appendBackfillRow(jobId: string, row: BackfillRowResult): void {
  const e = progressMap.get(jobId)
  if (!e) return
  e.perRow.push(row)
  e.processed += 1
  if (row.status === 'filled' && Array.isArray(row.filledLamps)) {
    e.lampsFilled += row.filledLamps.length
  }
}

/** Stamp the terminal status (called from the runner's outer try). */
export function finishBackfillProgress(jobId: string, jobStatus: JobStatus): void {
  const e = progressMap.get(jobId)
  if (!e) return
  e.finishedAt = new Date().toISOString()
  e.jobStatus = jobStatus
}

export function getBackfillProgress(jobId: string): BackfillProgress | undefined {
  return progressMap.get(jobId)
}
