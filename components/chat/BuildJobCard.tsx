'use client'

/**
 * BuildJobCard — Archetype 1 from docs/toolcards-mockup.html.
 *
 * Single shape backs `build_vibe` (one row) and `build_all_vibes` (N rows).
 * Each row carries thumb · id+label · timeline · ETA · ONE button.
 *
 *   - Button is CANCEL while the row is in progress, OPEN when it lands `done`.
 *   - WF (worktree-fork) step renders only for JuniorDev rows.
 *   - No card-foot, no "cancel all" — each row owns its own cancel.
 *   - Single-vibe view (build_vibe): same primitive, just one row, optional
 *     milestone bullets sourced from `report_build_progress` events.
 *
 * Data flow (live builds, not previews):
 *   build_started      → push card with rows[].state='queued'
 *   report_build_progress (per-vibe) → flip a row's state (wf → html → verify)
 *   vibe_built         → row.state = 'done', button → OPEN
 *   vibe_failed        → row.state = 'failed', show row.error
 *   build_complete     → no further updates (terminal)
 *
 * Preview path: lands here when CD calls `preview_card({kind:'build', payload})`.
 * Cancel/Open buttons are no-ops in preview mode (the parent component checks
 * `__preview` and disables side-effects).
 *
 * CSS classes match the mockup verbatim — `.build-row` grammar lives in
 * globals.css under the same rules.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import type { BuildCardPayload, BuildCardRow, BuildRowState } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Live ETA helpers (CD 2026-05-06)
// ─────────────────────────────────────────────────────────────────────────────

/** Format milliseconds as `m:ss` (e.g. 508_000 → "8:28"). */
function fmtElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = (totalSec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

/** Compute a row's display ETA. Done rows freeze at row.eta. In-flight
 *  rows with a startedAt show live elapsed since startedAt. Queued rows
 *  (no startedAt yet) show "—". */
function rowEta(row: BuildCardRow, now: number): string {
  if (row.state === 'done') return row.eta ?? 'done'
  if (row.state === 'failed') return '—'
  if (!row.startedAt) return row.eta ?? '—'
  return fmtElapsed(now - Date.parse(row.startedAt))
}

/** Tick once a second for live ETA updates. Returns the current epoch
 *  ms which any cell can use to recompute its label. Cheap — one
 *  setInterval per mounted card; cells re-render via prop, not state. */
function useTick(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export interface BuildJobCardProps extends Omit<BuildCardPayload, 'kind'> {
  /** When true, this is a preview render — buttons are disabled, no fetches fire. */
  isPreview?: boolean
  /** Cancel handler — receives the row's jobId (or row.id as fallback). */
  onCancel?: (rowId: string, jobId?: string) => void
  /** Open handler — receives the vibe id AND the rendered htmlPath so the
   *  parent can window.open the rendered HTML in a new tab. htmlPath is
   *  populated lazily by vibe_built; falls back to undefined for preview
   *  rows. */
  onOpen?: (rowId: string, htmlPath?: string) => void
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the timeline step list for a row. Single 4-stage ladder for ALL rows
 * (Ralph 2026-05-06 spec): queued → html → verify → done. The old WF stage
 * (worktree-fork / JuniorDev path) is retired — `juniorDev` flag is kept on
 * the row type for back-compat but no longer affects the ladder.
 *
 * State semantics:
 *   - queued  → all steps pending; "queued" pulses
 *   - html    → "queued" done, "html" active, rest pending
 *   - verify  → "queued"+"html" done, "verify" active, "done" pending
 *   - done    → all four done
 *   - failed  → stages up to and including the failed one render active so
 *               the failure visibly halts the sweep; error renders below.
 */
function buildSteps(row: BuildCardRow): { lbl: string; status: 'done' | 'active' | 'pending' }[] {
  const ladder: BuildRowState[] = ['queued', 'html', 'verify', 'done']
  const labelByState: Record<BuildRowState, string> = {
    queued: 'queued',
    wf: 'queued',     // legacy alias — wf rows treated as queued
    html: 'html',
    verify: 'verify',
    done: 'done',
    failed: 'verify',    // unreached after failure; harmless default
    cancelled: 'verify', // user cancel — treated like failure for label fallback
  }
  const cur = row.state
  const curIdx = ladder.indexOf(cur === 'wf' ? 'queued' : cur)
  return ladder.map((step, i) => {
    const lbl = labelByState[step]
    if (cur === 'failed') {
      return { lbl, status: i <= curIdx ? 'active' : 'pending' }
    }
    if (cur === 'done') return { lbl, status: 'done' }
    if (i < curIdx) return { lbl, status: 'done' }
    if (i === curIdx) return { lbl, status: 'active' }
    return { lbl, status: 'pending' }
  })
}

// ─────────────────────────────────────────────────────────────────────────────

export function BuildJobCard({
  title,
  jobId,
  rows,
  isPreview,
  onCancel,
  onOpen,
}: BuildJobCardProps) {
  const safeRows = Array.isArray(rows) ? rows : []
  // 1Hz tick — used for live ETA cells. Done rows freeze; in-flight rows
  // show seconds since their startedAt was stamped on the html-stage
  // transition.
  const now = useTick(1000)

  return (
    <div className="tool-card build-job-card" role="region" aria-label={title}>
      <div className="tool-card-head">
        <span className="tool-card-icon" data-accent="cyan" aria-hidden>⚙</span>
        <span className="tool-card-title">{title}</span>
        {jobId && <span className="tool-card-meta">{jobId}</span>}
      </div>

      <div className="tool-card-body" style={tightBody}>
        {safeRows.length === 0 ? (
          <div style={emptyMsg}>No vibes in this job.</div>
        ) : (
          safeRows.map((row, idx) => (
            <BuildRow
              key={row.id ?? `row-${idx}`}
              row={row}
              now={now}
              isPreview={isPreview}
              onCancel={onCancel}
              onOpen={onOpen}
              showMilestones={safeRows.length === 1}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function BuildRow({
  row,
  now,
  isPreview,
  onCancel,
  onOpen,
  showMilestones,
}: {
  row: BuildCardRow
  now: number
  isPreview?: boolean
  onCancel?: (rowId: string, jobId?: string) => void
  onOpen?: (rowId: string, htmlPath?: string) => void
  showMilestones: boolean
}) {
  const steps = buildSteps(row)
  const isDone = row.state === 'done'
  const isFailed = row.state === 'failed'
  const milestones = showMilestones && row.milestones ? row.milestones : []

  return (
    <div className="build-row">
      <div className={`thumb${row.thumb ? '' : ' empty'}`}>
        {row.thumb ? <img src={row.thumb} alt="" /> : '—'}
      </div>
      <div className="name">
        <span className="id">{row.id}</span>
        <span className="label">
          {row.label}
          {row.juniorDev && <span className="juniorDev-tag"> JuniorDev</span>}
        </span>
      </div>
      <div className="timeline">
        {steps.map((s, i) => (
          <span key={`${row.id}-step-${i}`} style={{ display: 'contents' }}>
            <div className={`step ${s.status === 'done' ? 'done' : s.status === 'active' ? 'active' : ''}`}>
              <span className="dot" />
              <span className="lbl">{s.lbl}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`connector${s.status === 'done' ? ' done' : ''}`} />
            )}
          </span>
        ))}
      </div>
      <span className={`eta${isDone ? ' done' : ''}`}>{rowEta(row, now)}</span>
      {isDone ? (
        <button
          className="row-btn open"
          disabled={isPreview}
          onClick={() => !isPreview && onOpen?.(row.id, row.htmlPath)}
          title={isPreview ? 'Preview — open is disabled' : `Open ${row.id} in new tab`}
        >
          open
        </button>
      ) : isFailed ? (
        <button
          className="row-btn cancel"
          disabled
          title="Build failed — see error below"
        >
          failed
        </button>
      ) : (
        <button
          className="row-btn cancel"
          disabled={isPreview}
          onClick={() => !isPreview && onCancel?.(row.id, row.jobId)}
          title={isPreview ? 'Preview — cancel is disabled' : `Cancel ${row.id}`}
        >
          cancel
        </button>
      )}
      {/* Error / milestones live INSIDE the grid as full-width rows
          (grid-column: 1 / -1) so they span all columns natively, not
          orphaned siblings outside the row layout. CD 2026-05-06. */}
      {isFailed && row.error && (
        <div className="row-error">⚠ {row.error}</div>
      )}
      {milestones.length > 0 && (
        <div className="row-milestones">
          <span className="row-milestones-label">milestones</span>
          {milestones.map((m, i) => (
            <div key={`m-${i}`} className="row-milestones-row">
              <span className="row-milestones-bullet">▸</span>
              <span>{m}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Local style fragments — overflow / empty-state / body-padding only.
// Row internals (error, milestones) are styled via globals.css so they can
// take part in the grid layout (`grid-column: 1 / -1` for full-width spans).
// ─────────────────────────────────────────────────────────────────────────────

const tightBody: CSSProperties = {
  paddingTop: 4,
  paddingBottom: 4,
}
const emptyMsg: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  fontStyle: 'italic',
  padding: '8px 4px',
}
