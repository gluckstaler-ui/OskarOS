/**
 * CritiqueCard — Read-only critique surface for WF-mode self-critique and
 * Phase 4 Sentinel critiques (Ralph 2026-05-18).
 *
 * Renders when the bus emits `critique_submitted`. Payload mirrors the
 * `submit_critique` MCP tool args (mcp-server/tools-sentinel.ts:16-76):
 *   { target, scores: [{dimension, score, note}, ...], summary, recommendations }
 *
 * Plus two transport-side fields added by the publish site:
 *   - agent: 'webdev' | 'sentinel' — colors the icon + pill
 *   - phase: 'wireframes' | 'vibe' — adjusts the header label
 *     (post-2026-05-18 build-API collapse: 'final' removed, Phase 5
 *     builds tag as 'vibe' since they share the build-vibe route)
 *
 * Visual contract from webdev-agent.md § "Self-Critique (WF mode only)"
 * (lines 561-565): "SVG radar across 5 huashu visual dimensions + KEEP /
 * FIX / QUICK-WINS triple column." The schema doesn't ship a literal
 * KEEP/FIX/QUICK-WINS — it ships `scores[]` (with per-dimension notes)
 * and `recommendations[]`. We render:
 *   - radar from scores[]
 *   - per-dimension notes alongside
 *   - summary paragraph
 *   - recommendations bullets
 * The triple-column variant can be derived later if needed; for now the
 * substantive content all surfaces here.
 *
 * Chrome mirrors DesignDirectionsCard / DescentSelectionCard (.tool-card
 * surface). Read-only — no CTA, no user input.
 */
'use client'

import * as React from 'react'

export interface CritiqueScore {
  dimension: string
  score: number
  note: string
}

interface CritiqueCardProps {
  target: string
  scores: CritiqueScore[]
  summary: string
  recommendations: string[]
  agent?: 'webdev' | 'sentinel'
  phase?: 'wireframes' | 'vibe'
}

const RADAR_SIZE = 200
const RADAR_RADIUS = 78
const RADAR_CX = RADAR_SIZE / 2
const RADAR_CY = RADAR_SIZE / 2

/**
 * Compute (x, y) on the radar polygon for a given axis index + score (0–10).
 * Axis 0 points straight up; rotates clockwise.
 */
function radarPoint(
  axisIdx: number,
  axisCount: number,
  scoreOutOf10: number,
): { x: number; y: number } {
  const angle = (axisIdx / axisCount) * Math.PI * 2 - Math.PI / 2
  const r = (Math.max(0, Math.min(10, scoreOutOf10)) / 10) * RADAR_RADIUS
  return { x: RADAR_CX + Math.cos(angle) * r, y: RADAR_CY + Math.sin(angle) * r }
}

function radarLabelPoint(
  axisIdx: number,
  axisCount: number,
): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  const angle = (axisIdx / axisCount) * Math.PI * 2 - Math.PI / 2
  const r = RADAR_RADIUS + 14
  const x = RADAR_CX + Math.cos(angle) * r
  const y = RADAR_CY + Math.sin(angle) * r
  let anchor: 'start' | 'middle' | 'end' = 'middle'
  if (Math.cos(angle) > 0.3) anchor = 'start'
  else if (Math.cos(angle) < -0.3) anchor = 'end'
  return { x, y, anchor }
}

function prettyDimension(d: string): string {
  return d
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function scoreTier(score: number): 'low' | 'mid' | 'high' {
  if (score >= 7.5) return 'high'
  if (score >= 5) return 'mid'
  return 'low'
}

export function CritiqueCard({
  target,
  scores,
  summary,
  recommendations,
  agent = 'webdev',
  phase = 'wireframes',
}: CritiqueCardProps) {
  const safeScores = Array.isArray(scores) ? scores.filter((s) => s && typeof s.dimension === 'string') : []
  const n = safeScores.length
  const overall =
    n > 0 ? safeScores.reduce((a, s) => a + (Number.isFinite(s.score) ? s.score : 0), 0) / n : 0

  // Radar geometry
  const radarPoints = safeScores.map((s, i) => radarPoint(i, n, s.score))
  const polygonPoints = radarPoints.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')

  // Ring gridlines at 0.25 / 0.5 / 0.75 / 1.0
  const rings = [0.25, 0.5, 0.75, 1].map((r) => r * RADAR_RADIUS)

  // Post-2026-05-18 build-API collapse: 'final' no longer reaches here
  // (build_vibe([slugs]) covers Phase 4 AND Phase 5; route can't tell
  // them apart, so critique tags as 'vibe' for both). Two header labels.
  const phaseLabel =
    phase === 'wireframes'
      ? 'Wireframe self-critique'
      : 'Vibe critique'

  return (
    <div className="tool-card critique-card" data-style="critique" data-agent={agent}>
      <div className="tool-card-head">
        <span className="tool-card-icon">{agent === 'webdev' ? 'WD' : 'ST'}</span>
        <div className="tool-card-head-text">
          <span className="tool-card-title">{phaseLabel}</span>
          <span className="tool-card-meta">{target}</span>
        </div>
        <span className="tool-card-pill" data-tier={scoreTier(overall)}>
          {overall.toFixed(1)} / 10
        </span>
      </div>

      <div className="critique-body">
        {/* Radar — only renders when there are ≥3 axes (radar needs a polygon). */}
        {n >= 3 && (
          <div className="critique-radar" aria-hidden="true">
            <svg
              width={RADAR_SIZE}
              height={RADAR_SIZE}
              viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
            >
              {rings.map((r, i) => (
                <circle
                  key={`ring-${i}`}
                  cx={RADAR_CX}
                  cy={RADAR_CY}
                  r={r}
                  fill="none"
                  stroke="var(--border-card, #2a2f37)"
                  strokeWidth={0.5}
                />
              ))}
              {safeScores.map((_, i) => {
                const p = radarPoint(i, n, 10)
                return (
                  <line
                    key={`spoke-${i}`}
                    x1={RADAR_CX}
                    y1={RADAR_CY}
                    x2={p.x}
                    y2={p.y}
                    stroke="var(--border-card, #2a2f37)"
                    strokeWidth={0.5}
                  />
                )
              })}
              <polygon
                points={polygonPoints}
                fill="rgba(34, 211, 238, 0.18)"
                stroke="var(--brand-cyan, #22d3ee)"
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
              {radarPoints.map((p, i) => (
                <circle
                  key={`vertex-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={2.5}
                  fill="var(--brand-cyan, #22d3ee)"
                />
              ))}
              {safeScores.map((s, i) => {
                const lp = radarLabelPoint(i, n)
                return (
                  <text
                    key={`label-${i}`}
                    x={lp.x}
                    y={lp.y}
                    textAnchor={lp.anchor}
                    dominantBaseline="middle"
                    fontSize={9}
                    fill="var(--text-secondary, #999)"
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                    style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
                  >
                    {prettyDimension(s.dimension).slice(0, 14)}
                  </text>
                )
              })}
            </svg>
          </div>
        )}

        {/* Per-dimension list — always shown (radar is decorative + readable below) */}
        <ul className="critique-dimensions">
          {safeScores.map((s, i) => (
            <li key={`dim-${i}`} data-tier={scoreTier(s.score)}>
              <div className="critique-dim-head">
                <span className="critique-dim-name">{prettyDimension(s.dimension)}</span>
                <span className="critique-dim-score">{s.score.toFixed(1)}</span>
              </div>
              <div className="critique-dim-meter">
                <div className="critique-dim-fill" style={{ width: `${(Math.max(0, Math.min(10, s.score)) / 10) * 100}%` }} />
              </div>
              {s.note && <div className="critique-dim-note">{s.note}</div>}
            </li>
          ))}
        </ul>
      </div>

      {summary && (
        <div className="critique-summary">
          <span className="critique-summary-label">Summary</span>
          <p>{summary}</p>
        </div>
      )}

      {Array.isArray(recommendations) && recommendations.length > 0 && (
        <div className="critique-recs">
          <span className="critique-recs-label">Recommendations</span>
          <ul>
            {recommendations.map((r, i) => (
              <li key={`rec-${i}`}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <style>{`
        .critique-card {
          background: var(--bg-card, #14181d);
          border: 1px solid var(--border-card, #2a2f37);
          border-radius: 10px;
          padding: 14px;
        }
        .critique-card .tool-card-head {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 12px;
        }
        .critique-card .tool-card-icon {
          width: 28px; height: 28px;
          border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700;
          font-family: monospace;
          background: rgba(34, 211, 238, 0.12);
          color: var(--brand-cyan, #22d3ee);
        }
        .critique-card[data-agent="sentinel"] .tool-card-icon {
          background: rgba(245, 197, 66, 0.12);
          color: var(--brand-yellow, #f5c542);
        }
        .critique-card .tool-card-head-text {
          display: flex; flex-direction: column; gap: 2px;
          flex: 1; min-width: 0;
        }
        .critique-card .tool-card-title { font-weight: 600; font-size: 14px; }
        .critique-card .tool-card-meta {
          font-size: 11px; color: var(--text-secondary, #999);
          font-family: ui-monospace, SFMono-Regular, monospace;
        }
        .critique-card .tool-card-pill {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 11px; font-weight: 700;
          padding: 3px 10px;
          border-radius: 4px;
          background: rgba(34, 211, 238, 0.12);
          color: var(--brand-cyan, #22d3ee);
        }
        .critique-card .tool-card-pill[data-tier="high"] {
          background: rgba(34, 197, 94, 0.14);
          color: var(--brand-green-bright, #22c55e);
        }
        .critique-card .tool-card-pill[data-tier="mid"] {
          background: rgba(245, 197, 66, 0.15);
          color: var(--brand-yellow, #f5c542);
        }
        .critique-card .tool-card-pill[data-tier="low"] {
          background: rgba(239, 68, 68, 0.15);
          color: var(--brand-red, #ef4444);
        }

        .critique-body {
          display: grid;
          grid-template-columns: ${RADAR_SIZE}px 1fr;
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 640px) {
          .critique-body { grid-template-columns: 1fr; }
        }
        .critique-radar {
          display: flex; align-items: center; justify-content: center;
        }
        .critique-dimensions {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .critique-dimensions li {
          display: flex; flex-direction: column; gap: 3px;
        }
        .critique-dim-head {
          display: flex; justify-content: space-between; align-items: baseline;
          gap: 8px;
        }
        .critique-dim-name {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--text-secondary, #b3bcc7);
        }
        .critique-dim-score {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 12px; font-weight: 700;
          color: var(--text-main, #e7ecf2);
        }
        .critique-dim-meter {
          height: 4px;
          background: var(--border-card, #2a2f37);
          border-radius: 2px;
          overflow: hidden;
        }
        .critique-dim-fill {
          height: 100%;
          background: var(--brand-cyan, #22d3ee);
          transition: width 240ms ease;
        }
        .critique-dimensions li[data-tier="high"] .critique-dim-fill { background: var(--brand-green-bright, #22c55e); }
        .critique-dimensions li[data-tier="mid"]  .critique-dim-fill { background: var(--brand-yellow,        #f5c542); }
        .critique-dimensions li[data-tier="low"]  .critique-dim-fill { background: var(--brand-red,           #ef4444); }
        .critique-dim-note {
          font-size: 12px;
          color: var(--text-secondary, #b3bcc7);
          line-height: 1.4;
        }

        .critique-summary {
          margin-top: 14px;
          padding: 10px 12px;
          border-left: 2px solid var(--brand-cyan, #22d3ee);
          background: rgba(34, 211, 238, 0.04);
          border-radius: 0 6px 6px 0;
        }
        .critique-summary-label {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--brand-cyan, #22d3ee);
          font-weight: 700;
        }
        .critique-summary p {
          margin: 4px 0 0;
          font-size: 13px;
          line-height: 1.55;
          color: var(--text-main, #e7ecf2);
        }

        .critique-recs {
          margin-top: 12px;
        }
        .critique-recs-label {
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted, #7c8794);
          display: block;
          margin-bottom: 6px;
        }
        .critique-recs ul {
          margin: 0; padding-left: 18px;
          display: flex; flex-direction: column; gap: 4px;
        }
        .critique-recs li {
          font-size: 12.5px;
          line-height: 1.5;
          color: var(--text-secondary, #b3bcc7);
        }
      `}</style>
    </div>
  )
}
