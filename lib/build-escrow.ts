/**
 * build-escrow.ts — async job ledger for long-running tools (Phase 2.5, Ralph 2026-04-30).
 *
 * Problem: synchronous MCP calls to build_vibe / build_wireframes /
 * generate_image block CD for the full 2–10 minutes the underlying work
 * needs. CD looks dead for that whole window.
 *
 * Fix: escrow. The MCP route accepts the job, kicks the runner off in
 * the background WITHOUT awaiting, and returns {jobId, status: "running"}
 * to CD in <100ms. CD polls via job_status whenever she wants. Cancel
 * via cancel_job.
 *
 * Five contract decisions baked into this file (per CD's 2026-04-30 review):
 *
 *   1. **Dedup is transparent.** If enqueue() finds a running job for
 *      the same {sessionId, kind, target}, it returns the existing job
 *      AND sets `deduped: true` + `originalStartedAt` on the response.
 *      CD's mental model never drifts from reality.
 *
 *   2. **Stuck detection is server-side.** getJob() derives
 *      `status: "stuck"` when a job has been running > STUCK_THRESHOLD_MS.
 *      CD reads the verdict, never does timestamp math.
 *
 *   3. **Per-job IDs for array-based builds.** Both /api/mcp/build-vibe
 *      and /api/mcp/build-wireframes take `slugs[]` and enqueue one
 *      job per slug, returning the array of jobIds. CD acts per slug
 *      (e.g. retry just the one that failed) without an extra
 *      list_jobs round-trip.
 *
 *   4. **Cancellation surface.** Each job has an AbortController. The
 *      runner is given .signal and is expected to react. cancel(jobId)
 *      aborts the controller, flips status to "cancelled", and waits
 *      for the runner to settle. Builds propagate the signal to the
 *      WebDev child via SIGTERM (see lib/run-webdev.ts wiring).
 *
 *   5. **No wait_for_X helpers.** Any synchronous-feeling tool would
 *      become CD's default and the blocking shape would return. Polling
 *      is the only contract.
 *
 * State persistence: pinned to globalThis (HMR-safe). Lost on Node
 * process restart — that's acceptable; jobs that disappear can be
 * detected by CD as "unknown jobId" → re-fire if needed.
 *
 * Ralph 2026-05-18: build_all_vibes + build_final removed from JobKind.
 * Both collapsed into array-based build_vibe (which already used the
 * 'build_vibe' kind for its escrow rows). See:
 * docs/INSTITUTIONAL-MEMORY.md "Two build-tool surfaces" entry.
 */

import { randomUUID } from 'crypto'

export type JobKind = 'build_vibe' | 'build_wireframes' | 'generate_image' | 'scout_taste'

export type JobStatus = 'running' | 'complete' | 'failed' | 'cancelled' | 'stuck'

/** A job is "stuck" if running for longer than this without finishing. */
const STUCK_THRESHOLD_MS = 15 * 60_000

export interface JobResult {
  // build_vibe / build_wireframes (per-slug rows)
  filename?: string
  vibeName?: string
  vibeIndex?: number
  paths?: { landing?: string }
  // generate_image
  savedPath?: string
  geminiText?: string | null
}

export interface BuildJob {
  jobId: string
  sessionId: string
  kind: JobKind
  /** Target argument: vibe slug for build_vibe, undefined for the others. */
  target?: string
  /**
   * Status. Persisted values are "running" / "complete" / "failed" /
   * "cancelled". "stuck" is a server-derived projection emitted at read
   * time when a job has been running > STUCK_THRESHOLD_MS. The persisted
   * record never directly stores "stuck" — only getJob/listJobs/enqueue
   * surface it via projectJob().
   */
  status: JobStatus
  /** ISO timestamp. */
  startedAt: string
  /** ISO timestamp; set when status leaves 'running'. */
  finishedAt?: string
  result?: JobResult
  error?: string
}

export interface EnqueueResponse {
  job: BuildJob
  /** True iff we returned an existing in-flight job. */
  deduped: boolean
  /** Set iff deduped — the startedAt of the original job. */
  originalStartedAt?: string
}

// ── Globally pinned ledger (HMR-safe) ────────────────────────────────────────

interface InternalEntry {
  job: BuildJob
  controller: AbortController
}

const GLOBAL_KEY = Symbol.for('oskar.build-escrow.entries') as unknown as string
const g = globalThis as Record<string, unknown>
const entries: Map<string, InternalEntry> =
  (g[GLOBAL_KEY] as Map<string, InternalEntry>) ||
  ((g[GLOBAL_KEY] = new Map<string, InternalEntry>()) as Map<string, InternalEntry>)

// ── Helpers ──────────────────────────────────────────────────────────────────

function deriveStatus(job: BuildJob): JobStatus {
  if (job.status !== 'running') return job.status
  const startedMs = new Date(job.startedAt).getTime()
  if (Date.now() - startedMs > STUCK_THRESHOLD_MS) return 'stuck'
  return 'running'
}

/**
 * Returns a snapshot with the derived `status` field. Internal record's
 * `.status` is left untouched — "stuck" is purely a read-time projection
 * (the runner hasn't actually crashed).
 */
function projectJob(job: BuildJob): BuildJob {
  return { ...job, status: deriveStatus(job) }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Find an in-flight (or stuck) job for {sessionId, kind, target}. Used
 * by enqueue() for dedup. "Cancelled" / "complete" / "failed" jobs are
 * NOT returned — they're terminal, a fresh enqueue should run.
 */
export function findRunning(
  sessionId: string,
  kind: JobKind,
  target?: string,
): BuildJob | undefined {
  for (const e of entries.values()) {
    if (e.job.sessionId !== sessionId) continue
    if (e.job.kind !== kind) continue
    if (e.job.target !== target) continue
    if (e.job.status === 'running') return e.job
  }
  return undefined
}

/**
 * Enqueue a job. The runner is invoked in the background with an
 * AbortSignal it MUST observe to honor cancel_job. Returns immediately
 * with a {job, deduped} envelope.
 */
export function enqueueBuild(args: {
  sessionId: string
  kind: JobKind
  target?: string
  /**
   * Background work. Resolve with `{ok:true, result}` on success or
   * `{ok:false, error}` on failure. Throws are caught and recorded as
   * status=failed. The runner SHOULD react to `signal.aborted` — for
   * builds, kill the WebDev child.
   */
  runner: (ctx: { signal: AbortSignal; jobId: string }) => Promise<
    | { ok: true; result?: JobResult }
    | { ok: false; error: string }
  >
}): EnqueueResponse {
  const { sessionId, kind, target, runner } = args

  const existing = findRunning(sessionId, kind, target)
  if (existing) {
    return { job: projectJob(existing), deduped: true, originalStartedAt: existing.startedAt }
  }

  const controller = new AbortController()
  const job: BuildJob = {
    jobId: randomUUID(),
    sessionId,
    kind,
    target,
    status: 'running',
    startedAt: new Date().toISOString(),
  }
  entries.set(job.jobId, { job, controller })

  void (async () => {
    try {
      const r = await runner({ signal: controller.signal, jobId: job.jobId })
      // If cancel landed during the runner's work, respect that — don't
      // overwrite cancelled status with whatever the runner returned.
      if (job.status === 'cancelled') {
        job.finishedAt ||= new Date().toISOString()
        return
      }
      job.finishedAt = new Date().toISOString()
      if (r.ok === true) {
        job.status = 'complete'
        job.result = r.result
      } else {
        job.status = 'failed'
        job.error = r.error
      }
    } catch (err) {
      if (job.status === 'cancelled') {
        job.finishedAt ||= new Date().toISOString()
        return
      }
      job.finishedAt = new Date().toISOString()
      job.status = 'failed'
      job.error = err instanceof Error ? err.message : String(err)
    }
  })()

  return { job: projectJob(job), deduped: false }
}

/** Read a job by id with the derived "stuck" projection applied. */
export function getJob(jobId: string): BuildJob | undefined {
  const e = entries.get(jobId)
  if (!e) return undefined
  return projectJob(e.job)
}

/** All jobs for a session, newest-first, with derived statuses. */
export function listJobs(sessionId: string): BuildJob[] {
  const out: BuildJob[] = []
  for (const e of entries.values()) {
    if (e.job.sessionId === sessionId) out.push(projectJob(e.job))
  }
  out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
  return out
}

/**
 * Cancel a running job. Sends abort to the runner's signal and flips
 * status to "cancelled" immediately. Returns the projected job.
 *
 * If the runner doesn't honor the signal cleanly, the underlying work
 * may continue running orphaned in the background. Builds (lib/run-webdev.ts)
 * propagate the signal to the WebDev child as SIGTERM — that path is clean.
 */
export function cancelJob(jobId: string): BuildJob | undefined {
  const e = entries.get(jobId)
  if (!e) return undefined
  if (e.job.status !== 'running') return projectJob(e.job)
  e.job.status = 'cancelled'
  e.job.finishedAt = new Date().toISOString()
  e.job.error = 'cancelled by cancel_job'
  try { e.controller.abort(new Error('cancelled by cancel_job')) } catch {}
  return projectJob(e.job)
}

// ── Per-session WebDev mutex ─────────────────────────────────────────────────
// build_vibe / build_wireframes both enqueue N jobs at once (array-based).
// Without this, all N runners would spawn Claude CLIs in parallel and
// saturate the API. The mutex serializes runners that opt in via
// withWebdevMutex() — CD still sees all N jobIds up-front (so she can
// monitor / cancel any of them); the actual spawns run one at a time.

const webdevChains = new Map<string, Promise<unknown>>()

export function withWebdevMutex<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = webdevChains.get(sessionId) || Promise.resolve()
  const next = prev.then(fn, fn)
  webdevChains.set(sessionId, next)
  void next.finally(() => {
    if (webdevChains.get(sessionId) === next) webdevChains.delete(sessionId)
  })
  return next
}

/** Retire old terminal jobs to keep the map bounded. Lazy-called. */
export function gc(maxFinishedPerSession = 50): void {
  const finishedBySession = new Map<string, BuildJob[]>()
  for (const e of entries.values()) {
    if (e.job.status === 'running') continue
    const arr = finishedBySession.get(e.job.sessionId) || []
    arr.push(e.job)
    finishedBySession.set(e.job.sessionId, arr)
  }
  for (const arr of finishedBySession.values()) {
    if (arr.length <= maxFinishedPerSession) continue
    arr.sort((a, b) => ((a.finishedAt || '') < (b.finishedAt || '') ? 1 : -1))
    for (const old of arr.slice(maxFinishedPerSession)) entries.delete(old.jobId)
  }
}
