'use client'
// ============================================================================
// ScoutJobsOverlay — bottom-right ambient strip showing in-flight scout jobs
// (Ralph 2026-06-05). Modeled on the Studio's LiveOverlay pattern: one
// bento card per running job, each independently collapsible,
// the whole panel renders null when no jobs are in flight.
//
// Jobs come in three kinds:
//   - 'discover'  — POST /scout/discover     (adds new leads from a register)
//   - 'refsp'     — POST /scout/refsp        (enriches existing FSP rows)
//   - 'backfill'  — POST /scout/backfill-queried (refreshes the 9 ◐ Queried
//                                                  lamps on stale rows)
//
// The overlay is presentational — every job's state (id / progress / recent
// items) is owned by the host (ScoutPool). The host polls each job's
// progress endpoint and feeds the shape down. The overlay only handles
// collapse-per-card state + click handlers (stop, expand/collapse).
//
// Layout: fixed bottom-right of the viewport. Newest card on top (column-
// reverse). max-width: 360px so a long row name doesn't blow the layout.
// Pointer-events: none on the container, auto on each card — clicks pass
// through the gaps so the user can still interact with the pool behind it.
// ============================================================================

import { useState } from 'react'

export type ScoutJobKind = 'discover' | 'refsp' | 'backfill'

export interface ScoutJobView {
  jobId: string
  kind: ScoutJobKind
  /** Short label for the head row, e.g. "Discover — Stadt Zürich". */
  label: string
  /** Smaller subtitle under the label, e.g. "Paartherapie · de · limit 200". */
  sublabel?: string
  /**
   * processed / total — drives the progress bar fill + the head row count.
   * `total` may be 0 transiently (before the universe is harvested) — UI
   * renders "—" in that case.
   */
  processed: number
  total: number
  /** Free-form phase line shown when expanded, e.g. "Fetched 1240/6005 · matched 12". */
  phase: string
  /**
   * Activity feed — freshest first, NO CAP. Each entry: name + status +
   * optional reason/url. The overlay renders the full list in a
   * scrollable container so a 200-row Discover run shows all 200 — not
   * just the last 5 (Ralph 2026-06-05: "needs to show everything").
   *
   * Status maps to visual treatment:
   *   inserted  — green dot, name in normal weight
   *   duplicate — amber dot, name dimmed
   *   failed    — red dot, name in normal weight, reason in subtitle
   */
  recent: Array<{
    id?: string
    name: string
    status?: 'inserted' | 'duplicate' | 'failed'
    reason?: string
    detail?: string
  }>
  /** Disabled when null — the card hides the STOP button. */
  onStop?: () => void
}

export interface ScoutJobsOverlayProps {
  jobs: ScoutJobView[]
}

export function ScoutJobsOverlay({ jobs }: ScoutJobsOverlayProps) {
  // Per-card collapsed state, keyed by jobId so it survives rerenders.
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({})

  if (jobs.length === 0) return null

  const toggle = (id: string) =>
    setCollapsedMap((m) => ({ ...m, [id]: !m[id] }))

  // If ANY card is uncollapsed, the panel grows to FULL viewport height
  // (Ralph 2026-06-05). Default state is collapsed at start, so the panel
  // hugs the corner; opening any card pulls the top anchor up to top:18px.
  // CSS handles the actual positioning via the `.tall` modifier.
  const anyExpanded = jobs.some((j) => !collapsedMap[j.jobId])

  return (
    <div className={`scout-jobs-overlay${anyExpanded ? ' tall' : ''}`}>
      {jobs.map((j) => (
        <JobCard
          key={j.jobId}
          job={j}
          collapsed={!!collapsedMap[j.jobId]}
          onToggle={() => toggle(j.jobId)}
        />
      ))}
    </div>
  )
}

// ── One card per job ───────────────────────────────────────────────────

interface JobCardProps {
  job: ScoutJobView
  collapsed: boolean
  onToggle: () => void
}

function JobCard({ job, collapsed, onToggle }: JobCardProps) {
  const pct = job.total > 0
    ? Math.min(100, Math.round((job.processed / job.total) * 100))
    : 0
  const countStr = job.total > 0 ? `${job.processed} / ${job.total}` : `${job.processed}`

  return (
    <div className={`scout-job-card kind-${job.kind}${collapsed ? ' collapsed' : ''}`}>
      <button
        type="button"
        className="scout-job-head"
        onClick={onToggle}
        title={collapsed ? 'Expand' : 'Collapse'}
        aria-label={collapsed ? 'Expand job card' : 'Collapse job card'}
      >
        <span className="scout-job-icon" aria-hidden>{kindGlyph(job.kind)}</span>
        <span className="scout-job-titles">
          <span className="scout-job-label">{job.label}</span>
          {job.sublabel ? <span className="scout-job-sublabel">{job.sublabel}</span> : null}
        </span>
        <span className="scout-job-count">{countStr}</span>
        <span className="scout-job-chev" aria-hidden>{collapsed ? '▸' : '▾'}</span>
      </button>

      {/* The progress bar lives ABOVE the collapse fold — visible even when
          minimized, since it carries the same information as the count
          number in a glance-able form. Studio's todo head shows the active
          item as a pip; here the bar IS the at-a-glance state. */}
      <div className="scout-job-bar">
        <div className="scout-job-bar-fill" style={{ width: `${pct}%` }} />
      </div>

      {collapsed ? null : (
        <div className="scout-job-body">
          <div className="scout-job-phase">{job.phase}</div>

          {job.recent.length > 0 ? (
            <>
              <div className="scout-job-recent-head">
                <span>Activity ({job.recent.length})</span>
                <span className="scout-job-recent-legend" title="Status legend">
                  <span className="dot inserted" /> new
                  <span className="dot duplicate" /> dup
                  <span className="dot failed" /> fail
                </span>
              </div>
              <ul className="scout-job-recent">
                {job.recent.map((r, i) => {
                  const status = r.status ?? 'inserted'
                  return (
                    <li
                      key={`${r.id ?? r.name}-${i}`}
                      className={`scout-job-recent-row status-${status}`}
                    >
                      <span className={`scout-job-recent-dot dot ${status}`} aria-hidden />
                      {r.detail
                        ? <a
                            href={r.detail}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="scout-job-recent-name link"
                            title={r.detail}
                          >{r.name}</a>
                        : <span className="scout-job-recent-name">{r.name}</span>}
                      {r.id ? <span className="scout-job-recent-id">{r.id}</span> : null}
                      {r.reason
                        ? <span className="scout-job-recent-detail">{labelReason(r.reason)}</span>
                        : null}
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <div className="scout-job-empty">waiting for the first match…</div>
          )}

          {job.onStop ? (
            <div className="scout-job-actions">
              <button type="button" className="scout-job-stop" onClick={job.onStop}>
                ⏹ Stop
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

/**
 * Map dedup-reason strings (verbose tokens from the ingest lib) to short
 * human labels for the activity-feed subtitle. Anything unmapped passes
 * through verbatim so failure messages still render.
 */
function labelReason(reason: string): string {
  switch (reason) {
    case 'duplicate-website-in-pool':       return 'website already in pool'
    case 'duplicate-website-in-prospects':  return 'website already in pipeline'
    case 'duplicate-contact-in-pool':       return 'phone/email already in pool'
    case 'duplicate-contact-in-prospects':  return 'phone/email already in pipeline'
    case 'duplicate-name-adresse-in-pool':  return 'name+address already in pool'
    case 'duplicate-name-adresse-in-prospects': return 'name+address already in pipeline'
    case 'no-identifier':                   return 'no contactable identifier'
    default: return reason
  }
}

function kindGlyph(k: ScoutJobKind): string {
  switch (k) {
    case 'discover': return '✛'
    case 'refsp':    return '↺'
    case 'backfill': return '◐'
  }
}
