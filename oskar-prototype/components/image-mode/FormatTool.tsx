'use client'

/**
 * FormatTool — WP-IMG-5 (rev 2026-05-06, Ralph).
 *
 * Body left:
 *   - Source format (read-only chip)
 *   - Output dropdown (JPG / PNG / WEBP)
 *   - Quality slider (active for JPG always; WEBP when not lossless)
 *   - Lossless toggle (WEBP only)
 *
 * Body right:
 *   - Filename + Overwrite-source checkbox (auto-disabled on cross-ext)
 *   - Alpha matte replace color — opt-in toggle, available for ALL formats
 *   - Chroma key — opt-in toggle, available for ALL formats
 *   - Eyedropper-fed color values flow into whichever addon is enabled
 *
 * Per-output enable matrix (rev'd):
 *
 *   ┌─────────┬─────────┬──────────┬─────────────┬────────────┐
 *   │ Output  │ Quality │ Lossless │ Alpha-matte │ Chroma-key │
 *   ├─────────┼─────────┼──────────┼─────────────┼────────────┤
 *   │ JPG     │   ✓     │   ✗      │     ✓       │     ✓      │
 *   │ PNG     │   ✗     │  (impl)  │     ✓       │     ✓      │
 *   │ WEBP    │ ✓ (lossy)│  ✓      │     ✓       │     ✓      │
 *   └─────────┴─────────┴──────────┴─────────────┴────────────┘
 *
 * Backend pipeline (lib/image-ops.ts → format-convert):
 *   1. chroma-key  — RGBA buffer pass; matched pixels get alpha=0
 *   2. alpha-matte — flatten over chosen flat color (consumes alpha)
 *   3. encode      — PNG / JPEG / WEBP with quality / lossless
 *
 * Eyedropper lives on the INPUT side of Zone 2 (rendered by AdvancedMode
 * via `EyedropperOverlay`) for ALL three output formats. Picked color
 * flows back here via `chromaKeyColor` / `alphaMatteColor` based on which
 * addon is enabled (or both if both are on; user-driven).
 */

import type { CSSProperties } from 'react'
import type { ImageOpsState } from './types'
import { useEffect, type ReactNode } from 'react'
import { FilenameInput } from './ResizeTool'
import { computeProposedFilename } from './proposed-filename'
import { useAutoFill } from './use-auto-fill'

interface BodyProps {
  state: ImageOpsState
  patch: (p: Partial<ImageOpsState>) => void
  natural: { naturalW: number; naturalH: number }
  /** Filename of the currently-selected source image (for source-format detection). */
  sourceFilename: string
}

// ─────────────────────────────────────────────────────────────────────────────

export function FormatBody({ state, patch, sourceFilename }: BodyProps) {
  const sourceExt = (sourceFilename.split('.').pop() || '').toLowerCase()
  const sourceFmt = sourceExt === 'jpg' ? 'JPEG' : sourceExt.toUpperCase()
  const preview = computeProposedFilename(sourceFilename, state)

  // Per-output enable flags for the body controls
  const isJPEG = state.formatTo === 'jpeg'
  const isPNG = state.formatTo === 'png'
  const isWEBP = state.formatTo === 'webp'
  const qualityActive = isJPEG || (isWEBP && !state.formatLossless)
  const losslessActive = isWEBP

  // Cross-extension gate (Ralph 2026-05-06): "overwrite source" is the
  // happy path for same-format ops, but is NOT an option when the output
  // extension differs from the source. Sharing the same path on disk would
  // leave the file with the wrong extension or silently rewrite as a new
  // file. We disable the checkbox in that case.
  const targetExt = isJPEG ? 'jpg' : state.formatTo
  const sourceExtNorm = sourceExt === 'jpeg' ? 'jpg' : sourceExt
  const overwriteAllowed = sourceExtNorm === targetExt

  // Pre-populate filename. The auto-fill hook updates the input on
  // source-image change, while preserving any custom name the user has
  // typed. Source change → new stem → auto applies (when current ===
  // lastAuto). Custom edits stick.
  useAutoFill(
    state.formatFilename,
    preview?.bareName ?? '',
    (next) => patch({ formatFilename: next }),
  )

  // Force-rewrite the EXTENSION when output format changes — even on user-
  // customized filenames. The user's stem is preserved; only the extension
  // swaps. Without this, `resolveSingle` would return their `.jpg` value
  // verbatim because the helper treats user-provided extensions as final.
  // Ralph 2026-05-06: "if I convert from jpg to png ... filename.jpg
  // becomes filename.png".
  useEffect(() => {
    const desired = state.formatTo === 'jpeg' ? 'jpg' : state.formatTo === 'png' ? 'png' : 'webp'
    const cur = state.formatFilename
    if (!cur) return
    const dot = cur.lastIndexOf('.')
    if (dot < 0) return // No extension in the current value — leave alone
    const ext = cur.slice(dot + 1).toLowerCase()
    if (ext === desired) return
    const stem = cur.slice(0, dot)
    patch({ formatFilename: `${stem}.${desired}` })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only on formatTo
  }, [state.formatTo])

  return (
    <>
      {/* LEFT — source/output + quality + lossless */}
      <div style={leftCol}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          {/* Source format (read-only) */}
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Source</label>
            <div style={readOnlyChipStyle}>{sourceFmt || '—'}</div>
          </div>
          {/* Output dropdown */}
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Output</label>
            <select
              value={state.formatTo}
              onChange={(e) => patch({ formatTo: e.target.value as 'jpeg' | 'png' | 'webp' })}
              style={selectStyle}
            >
              <option value="jpeg">JPG</option>
              <option value="png">PNG</option>
              <option value="webp">WEBP</option>
            </select>
          </div>
        </div>

        {/* Quality slider */}
        <div style={{ ...subBlock(qualityActive) }}>
          <label style={labelStyle}>Quality</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={state.formatQuality}
              disabled={!qualityActive}
              onChange={(e) => patch({ formatQuality: parseInt(e.target.value, 10) })}
              style={{ flex: 1 }}
            />
            <span
              style={{
                fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
                fontSize: 11,
                color: 'var(--text-main)',
                minWidth: 30,
                textAlign: 'right',
              }}
            >
              {state.formatQuality}
            </span>
          </div>
        </div>

        {/* Lossless toggle */}
        <div style={{ ...subBlock(losslessActive) }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
              color: 'var(--text-muted)',
              cursor: losslessActive ? 'pointer' : 'not-allowed',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={state.formatLossless}
              disabled={!losslessActive}
              onChange={(e) => patch({ formatLossless: e.target.checked })}
              style={{ margin: 0, cursor: losslessActive ? 'pointer' : 'not-allowed' }}
            />
            <span>Lossless</span>
            {!losslessActive && (
              <span style={{ fontStyle: 'italic', color: 'var(--text-dim)', fontSize: 9 }}>
                {isPNG ? '(PNG is implicitly lossless)' : '(WEBP only)'}
              </span>
            )}
          </label>
        </div>
      </div>

      {/* RIGHT — filename + addons (both available across all formats) */}
      <div style={rightCol}>
        <FilenameInput
          value={state.formatFilename}
          onChange={(v) => patch({ formatFilename: v })}
          proposed={preview?.summary}
        />
        <OverwriteSourceRow
          checked={state.formatOverwrite}
          allowed={overwriteAllowed}
          sourceExt={sourceExtNorm}
          targetExt={targetExt}
          onChange={(v) => patch({ formatOverwrite: v })}
        />

        {/* Alpha matte replace color — addon, all formats.
            Compressed: opt-in checkbox + label + color chip + hex input. */}
        <AddonRow
          enabled={state.alphaMatteEnabled}
          onEnabledChange={(v) => patch({ alphaMatteEnabled: v })}
          label="Alpha matte replace color"
          color={state.alphaMatteColor}
          onColorChange={(v) => patch({ alphaMatteColor: normalizeHex(v, state.alphaMatteColor) })}
        />

        {/* Chroma key — addon, all formats.
            Compressed: opt-in checkbox + label + color + Tol + Feather. */}
        <AddonRow
          enabled={state.chromaKeyEnabled}
          onEnabledChange={(v) => patch({ chromaKeyEnabled: v })}
          label="Chroma key"
          color={state.chromaKeyColor}
          onColorChange={(v) => patch({ chromaKeyColor: normalizeHex(v, state.chromaKeyColor) })}
          extras={
            <>
              <CompactNumField
                label="Tol"
                value={state.chromaKeyTolerance}
                min={0}
                max={150}
                disabled={!state.chromaKeyEnabled}
                onChange={(v) => patch({ chromaKeyTolerance: v })}
              />
              <CompactNumField
                label="Feather"
                value={state.chromaKeyFeather}
                min={0}
                max={50}
                disabled={!state.chromaKeyEnabled}
                onChange={(v) => patch({ chromaKeyFeather: v })}
              />
            </>
          }
        />
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Bits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AddonRow — universal addon control: opt-in checkbox + label + color chip
 * + hex input + optional extras (CompactNumFields for chroma-key Tol/Feather).
 *
 * When `enabled === false`, the chip + input + extras render greyed at 40%
 * opacity but stay LAID OUT (no reflow on toggle).
 */
function AddonRow({
  enabled,
  onEnabledChange,
  label,
  color,
  onColorChange,
  extras,
}: {
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  label: string
  color: string
  onColorChange: (v: string) => void
  extras?: ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onEnabledChange(e.target.checked)}
        style={{ margin: 0, cursor: 'pointer', flexShrink: 0 }}
        title={`Toggle ${label}`}
      />
      <span
        style={{
          ...labelStyle,
          marginBottom: 0,
          minWidth: 110,
          fontSize: 8,
          color: enabled ? 'var(--text-main)' : 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, opacity: enabled ? 1 : 0.4 }}>
        <ColorChip color={color} />
        <input
          type="text"
          value={color}
          disabled={!enabled}
          onChange={(e) => onColorChange(e.target.value)}
          style={{ ...textInputStyle, flex: 1, minWidth: 0 }}
        />
        {extras}
      </div>
    </div>
  )
}

/**
 * OverwriteSourceRow — like the generic OverwriteCheckbox, but with the
 * cross-extension HARD GATE (Ralph 2026-05-06): when source ext ≠ target
 * ext, the checkbox is disabled and we show a small note explaining why.
 * This replaces the previous "destructive" amber warning — overwrite is
 * the happy path for same-format ops, not destructive.
 */
function OverwriteSourceRow({
  checked,
  allowed,
  sourceExt,
  targetExt,
  onChange,
}: {
  checked: boolean
  allowed: boolean
  sourceExt: string
  targetExt: string
  onChange: (v: boolean) => void
}) {
  // Force OFF when not allowed (cross-extension change). useEffect rather
  // than inline so we don't trigger a setState during render → infinite loop.
  useEffect(() => {
    if (!allowed && checked) onChange(false)
  }, [allowed, checked, onChange])
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        color: allowed ? 'var(--text-muted)' : 'var(--text-dim)',
        cursor: allowed ? 'pointer' : 'not-allowed',
        userSelect: 'none',
      }}
      title={
        allowed
          ? `Replace the source file in place (.${sourceExt})`
          : `Disabled — source is .${sourceExt}, output is .${targetExt}; can't share path on disk`
      }
    >
      <input
        type="checkbox"
        checked={checked && allowed}
        disabled={!allowed}
        onChange={(e) => onChange(e.target.checked)}
        style={{ margin: 0, cursor: allowed ? 'pointer' : 'not-allowed' }}
      />
      <span>Overwrite source</span>
      {!allowed && (
        <span style={{ fontStyle: 'italic', color: 'var(--text-dim)', fontSize: 9, marginLeft: 4 }}>
          .{sourceExt} → .{targetExt}
        </span>
      )}
    </label>
  )
}

function ColorChip({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 18,
        height: 18,
        background: color,
        borderRadius: 3,
        border: '1px solid var(--border-card)',
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  )
}

/**
 * CompactNumField — narrow numeric input with a tiny inline label, used in
 * the chroma-key row so Color + Tol + Feather all fit on one horizontal
 * line within the 220px no-reflow body budget.
 */
function CompactNumField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 2,
        flexShrink: 0,
        width: 44,
      }}
    >
      <label
        style={{
          fontSize: 7,
          fontWeight: 700,
          letterSpacing: '0.05em',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          lineHeight: 1,
        }}
      >
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, n)))
        }}
        style={{ ...textInputStyle, padding: '2px 4px', fontSize: 10, width: '100%' }}
      />
    </div>
  )
}

function normalizeHex(input: string, fallback: string): string {
  const trimmed = input.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase()
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toUpperCase()}`
  // Half-typed values pass through so the user can finish typing
  if (trimmed.length < 7) return trimmed
  return fallback
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const leftCol: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
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
const selectStyle: CSSProperties = {
  ...textInputStyle,
  fontFamily: 'inherit',
  padding: '5px 6px',
}
const readOnlyChipStyle: CSSProperties = {
  ...textInputStyle,
  textAlign: 'center',
  color: 'var(--text-muted)',
  cursor: 'default',
  letterSpacing: '0.05em',
  fontWeight: 700,
}

/**
 * Sub-blocks stay rendered at 40% opacity when inactive so the body's
 * outer dimensions are identical across all output formats — switching
 * JPG ↔ PNG ↔ WEBP never reflows. Per the WP-IMG-5 NO-REFLOW invariant.
 */
function subBlock(active: boolean): CSSProperties {
  return {
    opacity: active ? 1 : 0.4,
    transition: 'opacity 0.12s',
    pointerEvents: active ? 'auto' : 'none',
  }
}
