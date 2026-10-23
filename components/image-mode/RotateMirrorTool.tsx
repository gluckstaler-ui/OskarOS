'use client'

/**
 * RotateMirrorTool — ROTATE tab of the image-ops Workshop (Ralph 2026-07-16).
 *
 * Body left:  5 transform buttons (90° CW / 90° CCW / 180° / mirror-H /
 *             mirror-V) — radio-select, the active one fires on Generate.
 *             Dimension readout below (90/270 swap W×H, the rest keep them).
 * Body right: overwrite checkbox (DEFAULT ON — in-place correction, no
 *             copies, per Ralph's directive) + filename input that only
 *             appears when overwrite is OFF.
 *
 * Why default-overwrite here and nowhere else: a rotation or mirror is a
 * CORRECTION to the same asset (sideways HEIC import, flipped scan) — not a
 * derivative. Crop/resize/format produce genuinely new variants; this tool
 * repairs the original.
 */

import {
  type ImageOpsState,
  type RotateMirrorOp,
} from './types'
import { computeProposedFilename } from './proposed-filename'
import { FilenameInput, OverwriteCheckbox } from './ResizeTool'

interface BodyProps {
  state: ImageOpsState
  patch: (p: Partial<ImageOpsState>) => void
  natural: { naturalW: number; naturalH: number }
  sourceFilename: string
}

const OPS: { id: RotateMirrorOp; glyph: string; label: string; title: string }[] = [
  { id: 'rot90', glyph: '⟳', label: '90°', title: 'Rotate 90° clockwise' },
  { id: 'rot270', glyph: '⟲', label: '90°', title: 'Rotate 90° counter-clockwise' },
  { id: 'rot180', glyph: '⟳', label: '180°', title: 'Rotate 180°' },
  { id: 'mirror-h', glyph: '↔', label: 'MIRROR', title: 'Mirror horizontally (left ↔ right)' },
  { id: 'mirror-v', glyph: '↕', label: 'MIRROR', title: 'Mirror vertically (top ↕ bottom)' },
]

const ACCENT = '#EC4899' // rose — matches the ROTATE tab color in the ops-bar

export function RotateMirrorBody({ state, patch, natural, sourceFilename }: BodyProps) {
  const preview = computeProposedFilename(sourceFilename, state)

  // 90/270 swap output dimensions; 180 + mirrors keep them.
  const swaps = state.rotateMirrorOp === 'rot90' || state.rotateMirrorOp === 'rot270'
  const outW = swaps ? natural.naturalH : natural.naturalW
  const outH = swaps ? natural.naturalW : natural.naturalH

  return (
    <>
      {/* LEFT — transform picker + dimension readout */}
      <div style={leftCol}>
        <label style={labelStyle}>Transform</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {OPS.map((op) => {
            const active = op.id === state.rotateMirrorOp
            return (
              <button
                key={op.id}
                onClick={() => patch({ rotateMirrorOp: op.id })}
                title={op.title}
                aria-pressed={active}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '7px 11px',
                  borderRadius: 6,
                  border: `1px solid ${active ? 'rgba(236,72,153,0.55)' : 'var(--border-card)'}`,
                  background: active ? 'rgba(236,72,153,0.18)' : 'transparent',
                  color: active ? ACCENT : 'var(--text-muted)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ fontSize: 13, lineHeight: 1 }} aria-hidden="true">
                  {op.glyph}
                </span>
                <span>{op.label}</span>
              </button>
            )
          })}
        </div>
        <div style={readoutStyle}>
          <span style={{ color: 'var(--text-muted)' }}>source</span>{' '}
          <strong>{natural.naturalW}×{natural.naturalH}</strong>{' '}
          <span style={{ color: 'var(--text-dim)' }}>→</span>{' '}
          <span style={{ color: 'var(--text-muted)' }}>output</span>{' '}
          <strong>{outW}×{outH}</strong>
        </div>
      </div>

      {/* RIGHT — overwrite (default ON) + conditional filename */}
      <div style={rightCol}>
        <OverwriteCheckbox
          checked={state.rotateOverwrite}
          onChange={(v) => patch({ rotateOverwrite: v })}
        />
        <div
          style={{
            fontSize: 9,
            color: state.rotateOverwrite ? '#fbbf24' : 'var(--text-dim)',
            lineHeight: 1.5,
          }}
        >
          {state.rotateOverwrite
            ? 'Replaces the file in place — no copy is created.'
            : 'Writes a new file next to the source.'}
        </div>
        {!state.rotateOverwrite && (
          <FilenameInput
            value={state.rotateFilename}
            onChange={(v) => patch({ rotateFilename: v })}
            proposed={preview?.summary}
            proposedNote={preview?.note}
          />
        )}
        {state.rotateOverwrite && preview && (
          <div
            title={preview.summary}
            style={{
              fontSize: 9,
              color: 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {preview.summary}
            <span style={{ marginLeft: 6, color: '#fbbf24', fontWeight: 700, fontSize: 8, letterSpacing: '0.04em' }}>
              · overwrites source
            </span>
          </div>
        )}
      </div>
    </>
  )
}

// ── Styles (mirrors ResizeTool's column conventions) ──────────────────────

const leftCol: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
}
const rightCol: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
}
const labelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 4,
  display: 'inline-block',
}
const readoutStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-main)',
  fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
  marginTop: 'auto',
}
