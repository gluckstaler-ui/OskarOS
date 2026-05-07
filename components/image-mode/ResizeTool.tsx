'use client'

/**
 * ResizeTool — WP-IMG-4 (2026-05-06).
 *
 * Body left:  width slider + live readout (`source W×H → output W×H · −X%`).
 * Body right: kernel select + `?` reference popover, filename, overwrite checkbox.
 * Ops-bar right: aspect-lock chips (free / 1:1 / 4:3 / 16:9 / 9:16). Active chip
 *                = locked ratio (height computed from width).
 *
 * Single source of truth for `resizeWidth` is the parent `ImageOpsState`. Aspect
 * lock is informational client-side; height is computed at submit-time in
 * `run-op.ts` (the server still receives both w and h when locked).
 */

import { useState } from 'react'
import {
  type ImageOpsState,
  type ResizeAspect,
  type ResizeKernel,
  RESIZE_ASPECT_ORDER,
  RESIZE_ASPECT_RATIOS,
  RESIZE_KERNEL_ORDER,
  KERNEL_REFERENCE,
} from './types'
import { computeProposedFilename } from './proposed-filename'
import { useAutoFill } from './use-auto-fill'

interface BodyProps {
  state: ImageOpsState
  patch: (p: Partial<ImageOpsState>) => void
  natural: { naturalW: number; naturalH: number }
  sourceFilename: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Body — 2-col grid: slider on left, kernel/filename/overwrite on right
// ─────────────────────────────────────────────────────────────────────────────

export function ResizeBody({ state, patch, natural, sourceFilename }: BodyProps) {
  const preview = computeProposedFilename(sourceFilename, state)
  useAutoFill(
    state.resizeFilename,
    preview?.bareName ?? '',
    (next) => patch({ resizeFilename: next }),
  )
  const minW = 16
  const maxW = natural.naturalW * 2 // allow up to 2× upscale
  const w = clamp(state.resizeWidth, minW, maxW)

  // Compute output dimensions for readout
  let outW = w
  let outH: number
  if (state.resizeAspect !== 'free') {
    const [aw, ah] = RESIZE_ASPECT_RATIOS[state.resizeAspect]!
    outH = Math.round((w * ah) / aw)
  } else {
    outH = Math.round((w * natural.naturalH) / natural.naturalW)
  }
  const pctChange = ((w / natural.naturalW) * 100 - 100).toFixed(1)
  const pctSign = w >= natural.naturalW ? '+' : ''

  return (
    <>
      {/* LEFT — slider + readout */}
      <div style={leftCol}>
        <label style={labelStyle}>Width</label>
        <input
          type="range"
          min={minW}
          max={maxW}
          step={1}
          value={w}
          onChange={(e) => patch({ resizeWidth: parseInt(e.target.value, 10) })}
          style={{ width: '100%', marginTop: 6 }}
        />
        <div style={readoutStyle}>
          <span style={{ color: 'var(--text-muted)' }}>source</span>{' '}
          <strong>{natural.naturalW}×{natural.naturalH}</strong>{' '}
          <span style={{ color: 'var(--text-dim)' }}>→</span>{' '}
          <span style={{ color: 'var(--text-muted)' }}>output</span>{' '}
          <strong>{outW}×{outH}</strong>{' '}
          <span style={{ color: w >= natural.naturalW ? '#86efac' : '#fbbf24' }}>
            {pctSign}{pctChange}%
          </span>
        </div>
      </div>

      {/* RIGHT — kernel select + filename + overwrite */}
      <div style={rightCol}>
        <KernelRow value={state.resizeKernel} onChange={(k) => patch({ resizeKernel: k })} />
        <FilenameInput
          value={state.resizeFilename}
          onChange={(v) => patch({ resizeFilename: v })}
          proposed={preview?.summary}
          proposedNote={preview?.note}
        />
        <OverwriteCheckbox
          checked={state.resizeOverwrite}
          onChange={(v) => patch({ resizeOverwrite: v })}
        />
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Ops-bar right — aspect-lock chips
// ─────────────────────────────────────────────────────────────────────────────

export function ResizeOpsBarRight({
  state,
  patch,
}: {
  state: ImageOpsState
  patch: (p: Partial<ImageOpsState>) => void
  natural: { naturalW: number; naturalH: number } | null
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 3,
        background: 'var(--pill-bg)',
        borderRadius: 6,
        border: '1px solid var(--pill-border)',
      }}
    >
      <span style={{ fontSize: 8, color: 'var(--text-dim)', padding: '0 6px', letterSpacing: '0.06em' }}>
        LOCK
      </span>
      {RESIZE_ASPECT_ORDER.map((a) => (
        <AspectChip
          key={a}
          label={a}
          active={state.resizeAspect === a}
          onClick={() => patch({ resizeAspect: a })}
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function AspectChip({ label, active, onClick }: { label: ResizeAspect; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px',
        borderRadius: 4,
        border: 'none',
        background: active ? '#F59E0B' : 'transparent',
        color: active ? '#fff' : 'var(--text-muted)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.05em',
        cursor: 'pointer',
        transition: 'all 0.12s',
        fontFamily: 'inherit',
      }}
    >
      {label === 'free' ? 'FREE' : label}
    </button>
  )
}

function KernelRow({ value, onChange }: { value: ResizeKernel; onChange: (k: ResizeKernel) => void }) {
  const [helpOpen, setHelpOpen] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
      <label style={{ ...labelStyle, marginBottom: 0 }}>Kernel</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ResizeKernel)}
        style={selectStyle}
      >
        {RESIZE_KERNEL_ORDER.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <button
        onClick={() => setHelpOpen((v) => !v)}
        title="Kernel reference"
        style={helpButtonStyle}
      >
        ?
      </button>
      {helpOpen && <KernelReferenceCard active={value} onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

function KernelReferenceCard({ active, onClose }: { active: ResizeKernel; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        right: 0,
        zIndex: 50,
        width: 280,
        padding: 12,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>Resize Kernels</span>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      {RESIZE_KERNEL_ORDER.map((k) => {
        const ref = KERNEL_REFERENCE[k]
        const isActive = k === active
        return (
          <div
            key={k}
            style={{
              padding: 8,
              marginBottom: 6,
              borderRadius: 6,
              background: isActive ? 'rgba(245,158,11,0.10)' : 'transparent',
              border: `1px solid ${isActive ? 'rgba(245,158,11,0.3)' : 'transparent'}`,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-main)' }}>
              {k} {isActive && <span style={{ color: '#F59E0B' }}>· active</span>}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              <strong>Strength:</strong> {ref.strength}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              <strong>Trade-off:</strong> {ref.tradeoff}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              <strong>Use for:</strong> {ref.useFor}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared inputs (filename, overwrite). Re-exported for CropTool too — same UI.
// ─────────────────────────────────────────────────────────────────────────────

export function FilenameInput({
  value,
  onChange,
  proposed,
  proposedNote,
}: {
  value: string
  onChange: (v: string) => void
  /** WP-IMG (mockup, 2026-05-06): "→ {filename}" hint shown under the input. */
  proposed?: string
  /** Optional secondary note (e.g. "clobbers source"). */
  proposedNote?: string
}) {
  return (
    <div>
      <label style={labelStyle}>Filename</label>
      <input
        type="text"
        value={value}
        placeholder="(auto-suffix)"
        onChange={(e) => onChange(e.target.value)}
        style={textInputStyle}
      />
      {proposed && (
        <div
          title={proposed}
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
          {proposed}
          {proposedNote && (
            <span style={{ marginLeft: 6, color: '#fbbf24', fontWeight: 700, fontSize: 8, letterSpacing: '0.04em' }}>
              · {proposedNote}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export function OverwriteCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  // Ralph 2026-05-06: overwrite-source is the HAPPY PATH (replace the file
  // in place) for crop / resize — same extension always, no destructive
  // warning needed. The cross-ext hard gate lives only in FormatTool.
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        color: 'var(--text-muted)',
        cursor: 'pointer',
        userSelect: 'none',
      }}
      title="Replace the source file in place"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ margin: 0, cursor: 'pointer' }}
      />
      <span>Overwrite source</span>
    </label>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles + helpers
// ─────────────────────────────────────────────────────────────────────────────

const leftCol: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
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
const textInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: 11,
  background: 'var(--input-bg, rgba(255,255,255,0.05))',
  color: 'var(--text-main)',
  border: '1px solid var(--border-card)',
  borderRadius: 5,
  fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
}
const selectStyle: React.CSSProperties = {
  ...textInputStyle,
  width: 'auto',
  padding: '4px 6px',
  fontSize: 10,
  fontFamily: 'inherit',
}
const helpButtonStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  padding: 0,
  borderRadius: '50%',
  border: '1px solid var(--border-card)',
  background: 'transparent',
  color: 'var(--text-muted)',
  fontSize: 10,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  lineHeight: 1,
}
const readoutStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-main)',
  fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
  marginTop: 'auto',
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
