'use client'

/**
 * SliceTool — WP-IMG-3 (2026-05-06).
 *
 * Body left:  cols/rows numeric inputs + naming-pattern field + readout
 *             "→ N outputs at W × H".
 * Body right: 6-tile output preview row that mirrors the grid count.
 * Zone 2 overlay: cols × rows dashed grid, each cell numbered (rendered
 *                 separately by `SliceGridOverlay` — see export below).
 *
 * Single Generate writes all N outputs in one MCP call; the active tag chip
 * applies to ALL outputs (the chip lives in the workshop footer).
 */

import type { CSSProperties } from 'react'
import type { ImageOpsState } from './types'
import { computeProposedFilename } from './proposed-filename'

// ─────────────────────────────────────────────────────────────────────────────
// Body
// ─────────────────────────────────────────────────────────────────────────────

interface BodyProps {
  state: ImageOpsState
  patch: (p: Partial<ImageOpsState>) => void
  natural: { naturalW: number; naturalH: number }
  sourceFilename: string
}

export function SliceBody({ state, patch, natural, sourceFilename }: BodyProps) {
  const cols = clampInt(state.sliceCols, 1, 6)
  const rows = clampInt(state.sliceRows, 1, 6)
  const total = cols * rows
  const tileW = Math.floor(natural.naturalW / cols)
  const tileH = Math.floor(natural.naturalH / rows)
  const preview = computeProposedFilename(sourceFilename, state)

  return (
    <>
      {/* LEFT — cols/rows + naming pattern + readout */}
      <div style={leftCol}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <NumberInput
            label="Cols"
            value={cols}
            min={1}
            max={6}
            onChange={(v) => patch({ sliceCols: v })}
          />
          <NumberInput
            label="Rows"
            value={rows}
            min={1}
            max={6}
            onChange={(v) => patch({ sliceRows: v })}
          />
        </div>

        <div style={{ marginTop: 6 }}>
          <label style={labelStyle}>Naming pattern</label>
          <input
            type="text"
            value={state.sliceNamingPattern}
            placeholder="{stem}-tile-{n}"
            onChange={(e) => patch({ sliceNamingPattern: e.target.value })}
            style={textInputStyle}
          />
          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 3 }}>
            Tokens: <code>{'{stem}'}</code> <code>{'{n}'}</code> <code>{'{r}'}</code>{' '}
            <code>{'{c}'}</code> <code>{'{ext}'}</code>
          </div>
          {preview?.summary && (
            <div
              title={preview.summary}
              style={{
                marginTop: 3,
                fontSize: 9,
                color: 'var(--text-muted)',
                fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
                letterSpacing: '-0.01em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {preview.summary}
              {preview.note && (
                <span style={{ marginLeft: 6, color: 'var(--text-dim)', fontSize: 8, fontStyle: 'italic', letterSpacing: '0.04em' }}>
                  · {preview.note}
                </span>
              )}
            </div>
          )}
        </div>

        <div style={readoutStyle}>
          → <strong>{total}</strong> output{total === 1 ? '' : 's'} at{' '}
          <strong>{tileW}×{tileH}</strong>
        </div>
      </div>

      {/* RIGHT — tile preview row, mirrors grid count */}
      <div style={rightCol}>
        <label style={labelStyle}>Preview ({total} tiles)</label>
        <SliceTilePreview cols={cols} rows={rows} natural={natural} />
      </div>
    </>
  )
}

/**
 * Mini-preview: a CSS-grid with `cols × rows` cells, each numbered. Visual
 * mockup of what the output filenames will be (1..N row-major).
 */
function SliceTilePreview({
  cols,
  rows,
  natural,
}: {
  cols: number
  rows: number
  natural: { naturalW: number; naturalH: number }
}) {
  const cells: number[] = []
  for (let i = 1; i <= cols * rows; i++) cells.push(i)
  // Aspect of source determines mini-preview shape
  const aspect = natural.naturalW / natural.naturalH
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gap: 2,
        background: 'rgba(6,182,212,0.08)',
        border: '1px solid rgba(6,182,212,0.4)',
        borderRadius: 4,
        padding: 4,
        aspectRatio: `${aspect}`,
        maxHeight: 120,
        margin: '4px auto 0',
      }}
    >
      {cells.map((n) => (
        <div
          key={n}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(6,182,212,0.18)',
            border: '1px dashed rgba(6,182,212,0.55)',
            borderRadius: 2,
            fontSize: 9,
            fontWeight: 700,
            color: '#06B6D4',
            fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
          }}
        >
          {n}
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Zone 2 overlay — dashed cols × rows grid with numbered cells
// ─────────────────────────────────────────────────────────────────────────────

export function SliceGridOverlay({ cols, rows }: { cols: number; rows: number }) {
  if (cols < 1 || rows < 1) return null
  const cellsCount = cols * rows
  const cells: number[] = []
  for (let i = 1; i <= cellsCount; i++) cells.push(i)
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        pointerEvents: 'none', // doesn't block image interactions
        userSelect: 'none',
      }}
    >
      {cells.map((n) => (
        <div
          key={n}
          style={{
            position: 'relative',
            border: '1px dashed rgba(6,182,212,0.85)',
            background: 'rgba(6,182,212,0.05)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-start',
          }}
        >
          <span
            style={{
              padding: '2px 6px',
              margin: 4,
              background: 'rgba(6,182,212,0.92)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 800,
              borderRadius: 3,
              fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
              letterSpacing: '-0.02em',
              lineHeight: 1,
              boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
            }}
          >
            {n}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Bits
// ─────────────────────────────────────────────────────────────────────────────

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div style={{ flex: 1 }}>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(clampInt(parseInt(e.target.value, 10) || min, min, max))}
        style={textInputStyle}
      />
    </div>
  )
}

function clampInt(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}

// Style constants — duplicated from ResizeTool to avoid a shared-style import cycle
// while still keeping each tool self-contained.
const leftCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
}
const rightCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
  minHeight: 0,
}
const labelStyle: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 4,
  display: 'inline-block',
}
const textInputStyle: CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: 11,
  background: 'var(--input-bg, rgba(255,255,255,0.05))',
  color: 'var(--text-main)',
  border: '1px solid var(--border-card)',
  borderRadius: 5,
  fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
}
const readoutStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-main)',
  fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
  marginTop: 'auto',
}
