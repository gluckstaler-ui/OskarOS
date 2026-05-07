'use client'

/**
 * CropTool — WP-IMG-2 (2026-05-06).
 *
 * Body:
 *   left  — live X / Y / W / H readout (typeable, two-way bound to cropRect).
 *   right — filename input + Overwrite-source checkbox.
 *
 * Ops-bar right — aspect chips (free / 1:1 / 3:4 / 4:3 / 16:9 / 9:16 / 2:3).
 *                Active chip constrains drag to that ratio.
 *
 * Marquee on Zone 2 (`CropMarqueeOverlay`) handles the actual interaction:
 * 8 corner/edge handles + interior drag, three coordinate spaces (image-native
 * px, displayed CSS px, client-pointer px), aspect-locked drag with anchor
 * projection on the opposite corner, mouse + touch + pen pointer events.
 *
 * State is owned by AdvancedMode → `ImageOpsState.cropRect`. The marquee
 * never holds local state for the rect — single source of truth.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ImageOpsState,
  type CropAspect,
  type CropRect,
  CROP_ASPECT_ORDER,
  CROP_ASPECT_RATIOS,
} from './types'
import { FilenameInput, OverwriteCheckbox } from './ResizeTool'
import { computeProposedFilename } from './proposed-filename'
import { useAutoFill } from './use-auto-fill'

// ─────────────────────────────────────────────────────────────────────────────
// Body — readouts (typeable) + filename / overwrite
// ─────────────────────────────────────────────────────────────────────────────

interface BodyProps {
  state: ImageOpsState
  patch: (p: Partial<ImageOpsState>) => void
  natural: { naturalW: number; naturalH: number }
  sourceFilename: string
}

export function CropBody({ state, patch, natural, sourceFilename }: BodyProps) {
  const r = state.cropRect ?? defaultCropRect(natural, state.cropAspect)
  const preview = computeProposedFilename(sourceFilename, state)
  // Pre-populate the filename input with the proposed name. Auto-updates
  // when the source changes; preserves user edits.
  useAutoFill(
    state.cropFilename,
    preview?.bareName ?? '',
    (next) => patch({ cropFilename: next }),
  )

  const setField = useCallback(
    (field: 'x' | 'y' | 'w' | 'h', value: number) => {
      const next = { ...r, [field]: value }
      // Clamp to image bounds
      next.x = clamp(next.x, 0, natural.naturalW - 1)
      next.y = clamp(next.y, 0, natural.naturalH - 1)
      next.w = clamp(next.w, 1, natural.naturalW - next.x)
      next.h = clamp(next.h, 1, natural.naturalH - next.y)
      patch({ cropRect: next })
    },
    [r, natural, patch],
  )

  return (
    <>
      {/* LEFT — XYWH readout (4 inputs, two-way bound to cropRect) */}
      <div style={leftCol}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <NumField label="X" value={Math.round(r.x)} onChange={(v) => setField('x', v)} />
          <NumField label="Y" value={Math.round(r.y)} onChange={(v) => setField('y', v)} />
          <NumField label="W" value={Math.round(r.w)} onChange={(v) => setField('w', v)} />
          <NumField label="H" value={Math.round(r.h)} onChange={(v) => setField('h', v)} />
        </div>
        <div style={readoutStyle}>
          source <strong>{natural.naturalW}×{natural.naturalH}</strong>{' '}
          <span style={{ color: 'var(--text-dim)' }}>·</span>{' '}
          ratio <strong>{(r.w / r.h).toFixed(3)}</strong>
        </div>
        {!state.cropRect && (
          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4, fontStyle: 'italic' }}>
            Drag a marquee on the source image, or pick an aspect chip and click Generate.
          </div>
        )}
      </div>

      {/* RIGHT — filename + overwrite */}
      <div style={rightCol}>
        <FilenameInput
          value={state.cropFilename}
          onChange={(v) => patch({ cropFilename: v })}
          proposed={preview?.summary}
          proposedNote={preview?.note}
        />
        <OverwriteCheckbox
          checked={state.cropOverwrite}
          onChange={(v) => patch({ cropOverwrite: v })}
        />
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Ops-bar right — aspect chips
// ─────────────────────────────────────────────────────────────────────────────

export function CropOpsBarRight({
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
        ASPECT
      </span>
      {CROP_ASPECT_ORDER.map((a) => (
        <AspectChip
          key={a}
          label={a}
          active={state.cropAspect === a}
          onClick={() => {
            // When aspect changes AND the marquee is already drawn, re-shape
            // the rect to match the new aspect (keep top-left, project height
            // from width). When marquee not drawn, just store the aspect.
            const ratio = CROP_ASPECT_RATIOS[a]
            if (state.cropRect && ratio) {
              const [aw, ah] = ratio
              const newH = Math.round((state.cropRect.w * ah) / aw)
              patch({
                cropAspect: a,
                cropRect: { ...state.cropRect, h: newH },
              })
            } else {
              patch({ cropAspect: a })
            }
          }}
        />
      ))}
    </div>
  )
}

function AspectChip({ label, active, onClick }: { label: CropAspect; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px',
        borderRadius: 4,
        border: 'none',
        background: active ? '#22C55E' : 'transparent',
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

// ═════════════════════════════════════════════════════════════════════════════
// CropMarqueeOverlay — Zone 2 overlay
// ═════════════════════════════════════════════════════════════════════════════

type DragHandle =
  | null
  | 'interior'
  | 'nw' | 'ne' | 'sw' | 'se'
  | 'n' | 's' | 'e' | 'w'

interface MarqueeProps {
  /** Current rect in image-native pixels. May be null (uninitialized). */
  rect: CropRect | null
  onRectChange: (r: CropRect) => void
  natural: { naturalW: number; naturalH: number }
  /** When set, marquee resizes are constrained to [aw, ah]. */
  aspect: CropAspect
}

/**
 * Why three coordinate spaces:
 *
 *   - image-native px   — what the server cares about; lives in `cropRect`.
 *   - displayed CSS px  — what the overlay renders; same as the wrapper's
 *                         own bounding box (overlay is `inset:0` on the wrapper).
 *   - client-pointer px — what `PointerEvent.clientX/Y` returns.
 *
 * Mapping helpers below: `imgToCss`, `cssToImg`, `clientToCss`. All math is
 * one-shot per pointer move (no debouncing — reflow risk is bigger than the
 * jitter risk).
 */
export function CropMarqueeOverlay({ rect, onRectChange, natural, aspect }: MarqueeProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState<DragHandle>(null)
  const dragOriginRef = useRef<{
    startRect: CropRect
    startX: number
    startY: number
    cssW: number
    cssH: number
  } | null>(null)

  // ─ Initialize an effective rect when `rect` is null ─
  // Show a default 60% centered marquee until the user drags one for real.
  // Note: we DO NOT set state here — the parent owns the rect. We just render
  // a phantom marquee and commit on first user interaction.
  const effRect = rect ?? defaultCropRect(natural, aspect)

  // Helpers — coord-space conversions
  const cssDims = ref.current
    ? {
        cssW: ref.current.getBoundingClientRect().width,
        cssH: ref.current.getBoundingClientRect().height,
      }
    : { cssW: 0, cssH: 0 }

  const imgToCss = (px: { x: number; y: number; w: number; h: number }) => ({
    left: (px.x / natural.naturalW) * cssDims.cssW,
    top: (px.y / natural.naturalH) * cssDims.cssH,
    width: (px.w / natural.naturalW) * cssDims.cssW,
    height: (px.h / natural.naturalH) * cssDims.cssH,
  })

  // Pointer handlers
  const onPointerDown = useCallback(
    (handle: DragHandle, e: React.PointerEvent) => {
      if (!ref.current) return
      e.preventDefault()
      e.stopPropagation()
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      const r = ref.current.getBoundingClientRect()
      dragOriginRef.current = {
        startRect: { ...effRect },
        startX: e.clientX,
        startY: e.clientY,
        cssW: r.width,
        cssH: r.height,
      }
      setDragging(handle)
      // Commit the phantom rect on first interaction so the body's readout
      // stops showing the default placeholder hint.
      if (!rect) onRectChange(effRect)
    },
    [effRect, rect, onRectChange],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging || !dragOriginRef.current) return
      const o = dragOriginRef.current
      const dxCss = e.clientX - o.startX
      const dyCss = e.clientY - o.startY
      // Convert delta CSS px → delta image-native px
      const sx = natural.naturalW / o.cssW
      const sy = natural.naturalH / o.cssH
      const dxImg = dxCss * sx
      const dyImg = dyCss * sy

      let next: CropRect = { ...o.startRect }

      // Helper: compute aspect-constrained sizing from a free dx/dy.
      const ratioPair = CROP_ASPECT_RATIOS[aspect]
      const lockAspect = (w: number, h: number, anchor: 'top' | 'bottom') => {
        if (!ratioPair) return { w, h }
        const [aw, ah] = ratioPair
        const target = aw / ah
        // Choose the dominant axis: bigger relative change wins.
        const fromW = Math.round(w / target * (target / target)) // identity; we'll branch below
        // Pick the one that yields the larger rect (matches Photoshop feel).
        const wFromH = Math.round(h * target)
        const hFromW = Math.round(w / target)
        if (Math.abs(w - o.startRect.w) >= Math.abs(h - o.startRect.h)) {
          return { w, h: hFromW }
        }
        // For symmetry with the chosen anchor side
        void fromW
        return { w: wFromH, h }
      }

      switch (dragging) {
        case 'interior': {
          next.x = clamp(o.startRect.x + dxImg, 0, natural.naturalW - o.startRect.w)
          next.y = clamp(o.startRect.y + dyImg, 0, natural.naturalH - o.startRect.h)
          break
        }
        case 'se': {
          let w = o.startRect.w + dxImg
          let h = o.startRect.h + dyImg
          if (ratioPair) ({ w, h } = lockAspect(w, h, 'top'))
          next.w = clamp(w, 4, natural.naturalW - o.startRect.x)
          next.h = clamp(h, 4, natural.naturalH - o.startRect.y)
          break
        }
        case 'sw': {
          let w = o.startRect.w - dxImg
          let h = o.startRect.h + dyImg
          if (ratioPair) ({ w, h } = lockAspect(w, h, 'top'))
          w = clamp(w, 4, o.startRect.x + o.startRect.w)
          h = clamp(h, 4, natural.naturalH - o.startRect.y)
          next.x = o.startRect.x + (o.startRect.w - w)
          next.w = w
          next.h = h
          break
        }
        case 'ne': {
          let w = o.startRect.w + dxImg
          let h = o.startRect.h - dyImg
          if (ratioPair) ({ w, h } = lockAspect(w, h, 'bottom'))
          w = clamp(w, 4, natural.naturalW - o.startRect.x)
          h = clamp(h, 4, o.startRect.y + o.startRect.h)
          next.y = o.startRect.y + (o.startRect.h - h)
          next.w = w
          next.h = h
          break
        }
        case 'nw': {
          let w = o.startRect.w - dxImg
          let h = o.startRect.h - dyImg
          if (ratioPair) ({ w, h } = lockAspect(w, h, 'bottom'))
          w = clamp(w, 4, o.startRect.x + o.startRect.w)
          h = clamp(h, 4, o.startRect.y + o.startRect.h)
          next.x = o.startRect.x + (o.startRect.w - w)
          next.y = o.startRect.y + (o.startRect.h - h)
          next.w = w
          next.h = h
          break
        }
        case 'n': {
          let h = o.startRect.h - dyImg
          h = clamp(h, 4, o.startRect.y + o.startRect.h)
          next.y = o.startRect.y + (o.startRect.h - h)
          next.h = h
          if (ratioPair) {
            const [aw, ah] = ratioPair
            next.w = clamp(Math.round((h * aw) / ah), 4, natural.naturalW - next.x)
          }
          break
        }
        case 's': {
          let h = o.startRect.h + dyImg
          h = clamp(h, 4, natural.naturalH - o.startRect.y)
          next.h = h
          if (ratioPair) {
            const [aw, ah] = ratioPair
            next.w = clamp(Math.round((h * aw) / ah), 4, natural.naturalW - next.x)
          }
          break
        }
        case 'w': {
          let w = o.startRect.w - dxImg
          w = clamp(w, 4, o.startRect.x + o.startRect.w)
          next.x = o.startRect.x + (o.startRect.w - w)
          next.w = w
          if (ratioPair) {
            const [aw, ah] = ratioPair
            next.h = clamp(Math.round((w * ah) / aw), 4, natural.naturalH - next.y)
          }
          break
        }
        case 'e': {
          let w = o.startRect.w + dxImg
          w = clamp(w, 4, natural.naturalW - o.startRect.x)
          next.w = w
          if (ratioPair) {
            const [aw, ah] = ratioPair
            next.h = clamp(Math.round((w * ah) / aw), 4, natural.naturalH - next.y)
          }
          break
        }
      }

      onRectChange(next)
    },
    [dragging, natural, aspect, onRectChange],
  )

  const onPointerUp = useCallback(() => {
    setDragging(null)
    dragOriginRef.current = null
  }, [])

  // Window-level pointermove/up while dragging — pointer can leave the
  // overlay element (e.g. drag fast off the image). Capture is set on the
  // element but the listeners are reliable on window.
  useEffect(() => {
    if (!dragging) return
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [dragging, onPointerMove, onPointerUp])

  // Render — dim overlay (4 quads outside marquee) + marquee + 8 handles
  const cssRect = imgToCss(effRect)
  const isPhantom = !rect

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        inset: 0,
        cursor: dragging ? 'grabbing' : 'crosshair',
      }}
    >
      {/* DIM overlay outside the marquee. 4 absolutely-positioned divs so the
          marquee interior reads at full image opacity. */}
      <div style={dimStyle({ top: 0, left: 0, right: 0, bottom: `calc(100% - ${cssRect.top}px)` })} />
      <div style={dimStyle({ top: cssRect.top, left: 0, width: cssRect.left, height: cssRect.height })} />
      <div style={dimStyle({ top: cssRect.top, left: cssRect.left + cssRect.width, right: 0, height: cssRect.height })} />
      <div style={dimStyle({ top: cssRect.top + cssRect.height, left: 0, right: 0, bottom: 0 })} />

      {/* MARQUEE outline + interior drag */}
      <div
        onPointerDown={(e) => onPointerDown('interior', e)}
        style={{
          position: 'absolute',
          left: cssRect.left,
          top: cssRect.top,
          width: cssRect.width,
          height: cssRect.height,
          border: `2px solid ${isPhantom ? 'rgba(34,197,94,0.5)' : '#22C55E'}`,
          boxShadow: `0 0 0 1px rgba(0,0,0,0.5)`,
          cursor: dragging === 'interior' ? 'grabbing' : 'grab',
          touchAction: 'none',
          background: 'transparent',
        }}
      />

      {/* 8 HANDLES */}
      {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((h) => {
        const pos = handlePosition(h, cssRect)
        return (
          <div
            key={h}
            onPointerDown={(e) => onPointerDown(h, e)}
            style={{
              position: 'absolute',
              left: pos.left - HANDLE_SIZE / 2,
              top: pos.top - HANDLE_SIZE / 2,
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              background: '#22C55E',
              border: '2px solid #fff',
              borderRadius: 2,
              cursor: handleCursor(h),
              touchAction: 'none',
              boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
              opacity: isPhantom ? 0.65 : 1,
            }}
          />
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────

const HANDLE_SIZE = 12

function handlePosition(handle: Exclude<DragHandle, null | 'interior'>, css: { left: number; top: number; width: number; height: number }) {
  const cx = css.left + css.width / 2
  const cy = css.top + css.height / 2
  const right = css.left + css.width
  const bottom = css.top + css.height
  switch (handle) {
    case 'nw': return { left: css.left, top: css.top }
    case 'n':  return { left: cx, top: css.top }
    case 'ne': return { left: right, top: css.top }
    case 'e':  return { left: right, top: cy }
    case 'se': return { left: right, top: bottom }
    case 's':  return { left: cx, top: bottom }
    case 'sw': return { left: css.left, top: bottom }
    case 'w':  return { left: css.left, top: cy }
  }
}

function handleCursor(handle: Exclude<DragHandle, null | 'interior'>): string {
  switch (handle) {
    case 'nw': case 'se': return 'nwse-resize'
    case 'ne': case 'sw': return 'nesw-resize'
    case 'n': case 's':   return 'ns-resize'
    case 'e': case 'w':   return 'ew-resize'
  }
}

function dimStyle(rect: { top?: number | string; left?: number | string; right?: number | string; bottom?: number | string; width?: number | string; height?: number | string }): React.CSSProperties {
  return {
    position: 'absolute',
    background: 'rgba(0, 0, 0, 0.45)',
    pointerEvents: 'none',
    ...rect,
  }
}

function defaultCropRect(natural: { naturalW: number; naturalH: number }, aspect: CropAspect): CropRect {
  // 60% centered, aspect-respecting.
  let w = Math.round(natural.naturalW * 0.6)
  let h = Math.round(natural.naturalH * 0.6)
  const ratio = CROP_ASPECT_RATIOS[aspect]
  if (ratio) {
    const [aw, ah] = ratio
    const target = aw / ah
    const sourceAR = w / h
    if (sourceAR > target) {
      w = Math.round(h * target)
    } else {
      h = Math.round(w / target)
    }
  }
  return {
    x: Math.round((natural.naturalW - w) / 2),
    y: Math.round((natural.naturalH - h) / 2),
    w,
    h,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bits
// ─────────────────────────────────────────────────────────────────────────────

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          if (!Number.isNaN(n)) onChange(n)
        }}
        style={textInputStyle}
      />
    </div>
  )
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

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
const readoutStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-main)',
  fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
  marginTop: 'auto',
}
