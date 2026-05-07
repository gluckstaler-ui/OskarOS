'use client'

/**
 * EyedropperOverlay — WP-IMG-6 (2026-05-06).
 *
 * Reusable color-sampling overlay used by FORMAT-CONVERT add-ons (chroma-key
 * for PNG output, alpha-matte for JPG output). Active on the INPUT half of
 * Zone 2 regardless of which addon would consume the picked value (consistent
 * UX — the user always picks from the same surface).
 *
 * Surfaces:
 *   1. Crosshair cursor over the input image.
 *   2. 16×16 sampling grid loupe inset, anchored near the pointer with a
 *      small offset so the cursor doesn't occlude the sample.
 *   3. Live readout pill at top-right of Zone 2:
 *        glyph + label · 16×16 swatch + #HEX · pixel-x, pixel-y
 *      Updates live on hover; freezes on click.
 *
 * Cross-origin: the canvas-backed sampling reads pixels from a hidden
 * `<canvas>` painted from the source `<img>`. When the source serves the
 * image without proper CORS, `getImageData` throws SecurityError; we catch
 * that and surface it via `onError` once. The pre-WP spike confirmed our
 * session uploads serve same-origin (under /uploads/, /public/), so this
 * is a defense-in-depth path. If a user-uploaded asset later ships with
 * blocked CORS, WP-IMG-6's spec contingency is a server-side proxy
 * (`/api/sample-image?url=…`) — not implemented in v1.
 *
 * State is owned by the parent (Format-Convert body). The overlay is purely
 * a UI surface that fires `onPick` with `{hex, x, y}` on click. The picked
 * color is then written into either the chroma-key or alpha-matte addon
 * block depending on the active output format.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface EyedropperPick {
  hex: string  // '#RRGGBB'
  r: number
  g: number
  b: number
  a: number  // 0..255 — useful for alpha-matte logic later
  x: number  // image-native px
  y: number  // image-native px
}

export interface EyedropperOverlayProps {
  /** Source image URL (same as the `<img>` we're sampling from). */
  imageUrl: string
  /** Image-native dimensions. */
  natural: { naturalW: number; naturalH: number }
  /** Optional label shown in the readout pill (e.g. 'CHROMA' / 'ALPHA-MATTE'). */
  label?: string
  /** Fires when the user clicks — final pick, frozen value. */
  onPick: (pick: EyedropperPick) => void
  /** Fires when sampling fails (CORS, missing canvas, image not loaded). */
  onError?: (err: string) => void
  /**
   * The currently-committed picked value — when set, the readout pill
   * shows it (with a "frozen" indicator) until the user re-enters the
   * overlay surface. Optional; if omitted, the pill shows live hover only.
   */
  committed?: EyedropperPick | null
}

// ─────────────────────────────────────────────────────────────────────────────

const LOUPE_GRID = 9        // 9×9 sampled pixels (odd → centered cell)
const LOUPE_CELL = 14       // CSS px per loupe cell
const LOUPE_SIZE = LOUPE_GRID * LOUPE_CELL  // 126 px square
const LOUPE_OFFSET = 24     // distance from cursor

export function EyedropperOverlay({
  imageUrl,
  natural,
  label = 'PICK',
  onPick,
  onError,
  committed = null,
}: EyedropperOverlayProps) {
  // The hidden canvas is sized to image-native pixels and painted ONCE per
  // source URL. All sampling reads come from this single buffer — no per-
  // pointer-move repaint.
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const [ready, setReady] = useState(false)
  const erroredRef = useRef(false)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [hover, setHover] = useState<EyedropperPick | null>(null)
  // Track displayed CSS dims so we can map pointer coords → image-native px
  // even when the image gets resized (window resize, chat-column expand).
  const cssDimsRef = useRef<{ cssW: number; cssH: number }>({ cssW: 0, cssH: 0 })

  // ── Paint the canvas once per source URL ─────────────────────────────────
  useEffect(() => {
    erroredRef.current = false
    setReady(false)
    const c = document.createElement('canvas')
    c.width = natural.naturalW
    c.height = natural.naturalH
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      onError?.('canvas 2D context unavailable')
      erroredRef.current = true
      return
    }
    canvasRef.current = c
    ctxRef.current = ctx
    const img = new Image()
    // crossOrigin: 'anonymous' lets the canvas stay clean if the server
    // returns the right CORS headers. Same-origin requests ignore this.
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, natural.naturalW, natural.naturalH)
        setReady(true)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        onError?.(`canvas paint failed: ${msg}`)
        erroredRef.current = true
      }
    }
    img.onerror = () => {
      onError?.('image failed to load for sampling')
      erroredRef.current = true
    }
    img.src = imageUrl
    return () => {
      // No explicit teardown — canvas + ctx are GC'd with the closure.
    }
  }, [imageUrl, natural.naturalW, natural.naturalH, onError])

  // ── Map pointer client px → image-native px ──────────────────────────────
  const pointerToNative = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const root = overlayRef.current
    if (!root) return null
    const rect = root.getBoundingClientRect()
    cssDimsRef.current.cssW = rect.width
    cssDimsRef.current.cssH = rect.height
    if (rect.width <= 0 || rect.height <= 0) return null
    const cssX = clientX - rect.left
    const cssY = clientY - rect.top
    if (cssX < 0 || cssY < 0 || cssX > rect.width || cssY > rect.height) return null
    const sx = natural.naturalW / rect.width
    const sy = natural.naturalH / rect.height
    return { x: Math.floor(cssX * sx), y: Math.floor(cssY * sy) }
  }, [natural.naturalW, natural.naturalH])

  // ── Read RGBA at image-native coord ──────────────────────────────────────
  const sample = useCallback((x: number, y: number): EyedropperPick | null => {
    const ctx = ctxRef.current
    if (!ctx || !ready || erroredRef.current) return null
    if (x < 0 || y < 0 || x >= natural.naturalW || y >= natural.naturalH) return null
    try {
      const data = ctx.getImageData(x, y, 1, 1).data
      const r = data[0]
      const g = data[1]
      const b = data[2]
      const a = data[3]
      const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase()}`
      return { hex, r, g, b, a, x, y }
    } catch (err) {
      // CORS-tainted canvas → SecurityError. Fire once, then mute so we
      // don't pile up errors on every move.
      if (!erroredRef.current) {
        onError?.(err instanceof Error ? err.message : String(err))
        erroredRef.current = true
      }
      return null
    }
  }, [ready, natural.naturalW, natural.naturalH, onError])

  // ── Pointer handlers ─────────────────────────────────────────────────────
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const native = pointerToNative(e.clientX, e.clientY)
    if (!native) return
    const pick = sample(native.x, native.y)
    if (pick) setHover(pick)
  }, [pointerToNative, sample])

  const onPointerLeave = useCallback(() => setHover(null), [])

  const onClick = useCallback((e: React.PointerEvent) => {
    const native = pointerToNative(e.clientX, e.clientY)
    if (!native) return
    const pick = sample(native.x, native.y)
    if (pick) onPick(pick)
  }, [pointerToNative, sample, onPick])

  // ── Loupe overlay position ───────────────────────────────────────────────
  const [loupePos, setLoupePos] = useState<{ left: number; top: number; pointerX: number; pointerY: number } | null>(null)

  const onPointerMoveTrack = useCallback((e: React.PointerEvent) => {
    const root = overlayRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const cssX = e.clientX - rect.left
    const cssY = e.clientY - rect.top
    // Place loupe top-right of pointer by default; flip across axes near edges
    // so it stays fully within the overlay.
    let left = cssX + LOUPE_OFFSET
    let top = cssY + LOUPE_OFFSET
    if (left + LOUPE_SIZE > rect.width) left = cssX - LOUPE_OFFSET - LOUPE_SIZE
    if (top + LOUPE_SIZE > rect.height) top = cssY - LOUPE_OFFSET - LOUPE_SIZE
    setLoupePos({ left, top, pointerX: cssX, pointerY: cssY })
    onPointerMove(e)
  }, [onPointerMove])

  // ── Render: surface + readout pill + loupe ───────────────────────────────
  const display: EyedropperPick | null = hover ?? committed

  return (
    <div
      ref={overlayRef}
      onPointerMove={onPointerMoveTrack}
      onPointerLeave={() => { onPointerLeave(); setLoupePos(null) }}
      onPointerDown={onClick}
      style={{
        position: 'absolute',
        inset: 0,
        cursor: ready && !erroredRef.current ? 'crosshair' : 'not-allowed',
        userSelect: 'none',
        touchAction: 'none',
      }}
      title={ready ? 'Click to pick a color' : erroredRef.current ? 'Sampling unavailable (CORS)' : 'Loading…'}
    >
      {/* ── Loupe (zoomed pixel grid) ── */}
      {loupePos && hover && ready && !erroredRef.current && (
        <Loupe
          left={loupePos.left}
          top={loupePos.top}
          centerX={hover.x}
          centerY={hover.y}
          natural={natural}
          sample={sample}
          centerHex={hover.hex}
        />
      )}

      {/* ── Readout pill — top-right of Zone 2 ── */}
      <ReadoutPill
        label={label}
        pick={display}
        frozen={!hover && !!committed}
        ready={ready && !erroredRef.current}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface LoupeProps {
  left: number
  top: number
  centerX: number
  centerY: number
  natural: { naturalW: number; naturalH: number }
  sample: (x: number, y: number) => EyedropperPick | null
  centerHex: string
}

function Loupe({ left, top, centerX, centerY, natural, sample, centerHex }: LoupeProps) {
  const half = Math.floor(LOUPE_GRID / 2)
  const cells: { hex: string; x: number; y: number; isCenter: boolean }[] = []
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const x = centerX + dx
      const y = centerY + dy
      let hex = '#000000'
      const out = x < 0 || y < 0 || x >= natural.naturalW || y >= natural.naturalH
      if (!out) {
        const p = sample(x, y)
        if (p) hex = p.hex
      }
      cells.push({ hex: out ? '#0a0a0a' : hex, x, y, isCenter: dx === 0 && dy === 0 })
    }
  }
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: LOUPE_SIZE,
        height: LOUPE_SIZE + 22,
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      {/* Pixel grid */}
      <div
        style={{
          width: LOUPE_SIZE,
          height: LOUPE_SIZE,
          display: 'grid',
          gridTemplateColumns: `repeat(${LOUPE_GRID}, ${LOUPE_CELL}px)`,
          gridTemplateRows: `repeat(${LOUPE_GRID}, ${LOUPE_CELL}px)`,
          border: '2px solid rgba(255,255,255,0.85)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,0,0,0.4)',
          background: '#000',
          imageRendering: 'pixelated',
        }}
      >
        {cells.map((c, i) => (
          <div
            key={i}
            style={{
              background: c.hex,
              outline: c.isCenter ? '2px solid #F59E0B' : 'none',
              outlineOffset: c.isCenter ? -2 : 0,
              boxShadow: c.isCenter ? '0 0 0 1px #000 inset' : 'none',
            }}
          />
        ))}
      </div>
      {/* Center hex readout below the loupe */}
      <div
        style={{
          width: LOUPE_SIZE,
          height: 20,
          marginTop: 2,
          background: 'rgba(0,0,0,0.85)',
          color: '#fff',
          fontSize: 10,
          fontWeight: 700,
          fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
          letterSpacing: '0.04em',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 3,
        }}
      >
        {centerHex}
      </div>
    </div>
  )
}

interface ReadoutPillProps {
  label: string
  pick: EyedropperPick | null
  frozen: boolean
  ready: boolean
}

function ReadoutPill({ label, pick, frozen, ready }: ReadoutPillProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        padding: '4px 8px',
        background: 'rgba(0, 0, 0, 0.78)',
        border: `1px solid ${frozen ? '#F59E0B' : 'rgba(255,255,255,0.18)'}`,
        borderRadius: 4,
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 10,
        fontWeight: 700,
        color: '#fff',
        fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
        letterSpacing: '-0.01em',
        zIndex: 25,
        pointerEvents: 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {/* Glyph */}
      <span style={{ fontSize: 11, lineHeight: 1 }}>⊕</span>
      {/* Label */}
      <span style={{ color: frozen ? '#F59E0B' : 'var(--text-muted, #9ca3af)', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.25)' }}>│</span>
      {pick ? (
        <>
          <span
            style={{
              width: 16,
              height: 16,
              background: pick.hex,
              border: '1px solid rgba(255,255,255,0.35)',
              borderRadius: 2,
              display: 'inline-block',
            }}
          />
          <span>{pick.hex}</span>
          <span style={{ color: 'var(--text-muted, #9ca3af)' }}>·</span>
          <span>{pick.x}, {pick.y}</span>
          {frozen && <span style={{ color: '#F59E0B', fontSize: 9 }}>FROZEN</span>}
        </>
      ) : (
        <span style={{ color: 'var(--text-muted, #9ca3af)', fontStyle: 'italic' }}>
          {ready ? 'hover the input' : 'loading…'}
        </span>
      )}
    </div>
  )
}
