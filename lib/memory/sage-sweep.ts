/**
 * Sage Sunday sweep — the shared engine behind the weekly compaction.
 *
 * ONE orchestration, TWO callers (kept DRY so they can't drift):
 *   - scripts/sage-sunday-cron.ts   — the autonomous cron entrypoint (no server)
 *   - app/api/cron/sage-all/route.ts — optional HTTP trigger (long-lived server)
 *
 * What it does — feature-x.md §16.4, "WE REUSE SAGE, WE REUSE THE GAUGE":
 *   - Enumerates every session: public/{id}/ (listSessions) + CRM db/ (sentinel).
 *   - Skips any session whose log files were touched within the last hour — never
 *     compact a SESSION.md a live bridge is writing.
 *   - Processes 3 at a time (CONCURRENCY) to bound wall time, with a small
 *     per-worker startup stagger matching order66's OAuth cold-start stagger.
 *   - Per session: runSagePortrait (paints user.md) THEN runSage240_40 (compresses
 *     SESSION.md). Portrait first — it reads the full log before 240/40 cuts it.
 *     skipPortrait=true runs 240/40 alone (testing only; the weekly cron runs both).
 */

import { existsSync, statSync } from 'fs'
import { listSessions } from '@/lib/session'
import { runSagePortrait, runSage240_40 } from '@/lib/memory/dreamer'
import { getSessionMdPath, getRawLogPath, CRM_SESSION_ID } from '@/lib/memory/paths'

const ACTIVITY_WINDOW_MS = 60 * 60 * 1000 // skip sessions active within 1 hour
const CONCURRENCY = 3 // sessions processed in parallel

export interface SessionResult {
  session: string
  ok: boolean
  portraitUpdated?: boolean
  cutTriggered?: boolean
  bytesCut?: number
  error?: string
}

export interface SageSweepResult {
  ok: boolean
  mode: 'full' | 'sage240-only'
  startedAt: string
  finishedAt: string
  candidates: number
  processed: number
  skippedActive: string[]
  results: SessionResult[]
}

// Freshest mtime across a session's log files. A live bridge appends to the raw
// monthly log every turn and Lumberjack rewrites SESSION.md — the newer of the
// two is the truest "last activity" signal. Missing files are not activity.
function lastActivityMs(sid: string): number {
  let newest = 0
  for (const p of [getSessionMdPath(sid), getRawLogPath(sid)]) {
    try {
      const m = statSync(p).mtimeMs
      if (m > newest) newest = m
    } catch {
      /* file absent → not activity */
    }
  }
  return newest
}

export async function runSageSweep(
  opts: { skipPortrait?: boolean } = {},
): Promise<SageSweepResult> {
  const skipPortrait = !!opts.skipPortrait

  // All candidates: public/{id}/ sessions + the CRM session (db/), if present.
  const allIds = (await listSessions()).map((s) => s.id)
  if (existsSync(getSessionMdPath(CRM_SESSION_ID))) allIds.push(CRM_SESSION_ID)

  // Activity guard — never compact a session a live bridge is writing.
  const now = Date.now()
  const skippedActive: string[] = []
  const sessionIds: string[] = []
  for (const sid of allIds) {
    if (now - lastActivityMs(sid) < ACTIVITY_WINDOW_MS) skippedActive.push(sid)
    else sessionIds.push(sid)
  }

  const startedAt = new Date().toISOString()

  const processSession = async (sid: string): Promise<SessionResult> => {
    try {
      let portraitUpdated: boolean | undefined
      if (!skipPortrait) {
        // Portrait first — it reads the full SESSION.md before 240/40 cuts it.
        const portrait = await runSagePortrait(sid)
        portraitUpdated = portrait.stats.userMemoryUpdated
      }
      const cut = await runSage240_40(sid)
      console.log(
        `[sage-sweep] ${sid} — ` +
          (skipPortrait
            ? '240-only'
            : `Portrait:${portraitUpdated ? 'updated' : 'unchanged'}`) +
          `, 240/40:${cut.stats.triggered ? `cut ${cut.stats.bytesCut}B` : 'skipped'}`,
      )
      return {
        session: sid,
        ok: true,
        portraitUpdated,
        cutTriggered: cut.stats.triggered,
        bytesCut: cut.stats.bytesCut ?? 0,
      }
    } catch (err) {
      // One session's failure must not abort the rest of the weekly batch.
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[sage-sweep] ${sid} — FAILED:`, message)
      return { session: sid, ok: false, error: message }
    }
  }

  // 3-wide worker pool. cursor++ is synchronous before each await, so no two
  // workers claim the same session.
  const results: SessionResult[] = new Array(sessionIds.length)
  let cursor = 0
  const worker = async (workerIndex: number) => {
    await new Promise((r) => setTimeout(r, workerIndex * 3000)) // OAuth cold-start stagger
    while (true) {
      const i = cursor++
      if (i >= sessionIds.length) break
      results[i] = await processSession(sessionIds[i])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, sessionIds.length) }, (_, wi) =>
      worker(wi),
    ),
  )

  const finishedAt = new Date().toISOString()
  console.log(
    `[sage-sweep] Done — ${results.filter((r) => r.ok).length}/${results.length} ok, ` +
      `${skippedActive.length} skipped (active <1h), portrait=${!skipPortrait}, ` +
      `started ${startedAt}, finished ${finishedAt}`,
  )

  return {
    ok: true,
    mode: skipPortrait ? 'sage240-only' : 'full',
    startedAt,
    finishedAt,
    candidates: allIds.length,
    processed: results.length,
    skippedActive,
    results,
  }
}
