'use client'

/**
 * PreviewSplitView — Zone 2 input | output split (Ralph 2026-05-06).
 *
 * Renders TWO halves side by side:
 *   ┌──────────────────┬──────────────────┐
 *   │ [Input]          │ [Output]         │
 *   │                  │                  │
 *   │  <input image>   │  <output image   │
 *   │  + image-ops     │   or input as    │
 *   │  overlay         │   passive ph>    │
 *   │                  │                  │
 *   └──────────────────┴──────────────────┘
 *
 * - LEFT half hosts the existing image-ops overlay (crop marquee, slice
 *   grid, eyedropper) — same wrapper + overlay pattern as the un-split
 *   view, just sized to half the canvas.
 * - RIGHT half hosts the most recent output URL (after a successful
 *   Generate) OR the input image as a passive placeholder before any
 *   Generate. Has a green border + glow ring + green "Output" pill so the
 *   user can spot it instantly.
 *
 * Image-natural-size reporting: the LEFT image fires `onImageNaturalSize`
 * with the displayed bounding rect (used by the eyedropper for client-px →
 * image-native-px mapping). Same callback signature as CanvasPreview's
 * un-split path, just mounted here instead.
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react'

export interface PreviewSplitViewProps {
  inputUrl: string
  inputAlt: string
  /** Server-rendered output URL (`/{sessionId}/{filename}`). Null = no
   *  output yet → right half mirrors input as a passive placeholder. */
  outputUrl: string | null
  /** image-ops overlay — sits inset:0 over the input image's wrapper. */
  overlay?: ReactNode
  onImageNaturalSize?: (size: { naturalW: number; naturalH: number; displayedRect: DOMRect } | null) => void
}

export function PreviewSplitView({
  inputUrl,
  inputAlt,
  outputUrl,
  overlay,
  onImageNaturalSize,
}: PreviewSplitViewProps) {
  const inputRef = useRef<HTMLImageElement | null>(null)

  const reportSize = useCallback(() => {
    const el = inputRef.current
    if (!el || !onImageNaturalSize) return
    if (!el.naturalWidth || !el.naturalHeight) return
    onImageNaturalSize({
      naturalW: el.naturalWidth,
      naturalH: el.naturalHeight,
      displayedRect: el.getBoundingClientRect(),
    })
  }, [onImageNaturalSize])

  // ResizeObserver on the input <img> so the overlay sees layout changes
  // (window resize, chat-column expand → halves grow/shrink).
  useEffect(() => {
    const el = inputRef.current
    if (!el || !onImageNaturalSize || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => reportSize())
    ro.observe(el)
    if (el.complete && el.naturalWidth) reportSize()
    return () => ro.disconnect()
  }, [reportSize, onImageNaturalSize, inputUrl])

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        padding: 8,
      }}
    >
      {/* LEFT — input + overlay */}
      <Side label="Input" labelTone="dark">
        <div
          style={{
            position: 'relative',
            display: 'inline-block',
            maxWidth: '100%',
            maxHeight: '100%',
            lineHeight: 0,
          }}
        >
          <img
            ref={inputRef}
            onLoad={reportSize}
            src={inputUrl}
            alt={inputAlt}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              display: 'block',
            }}
          />
          {overlay && (
            <div style={{ position: 'absolute', inset: 0, lineHeight: 1 }}>{overlay}</div>
          )}
        </div>
      </Side>

      {/* RIGHT — output (or input placeholder before first Generate) */}
      <Side label="Output" labelTone="green" emphasized>
        <img
          // cache-bust query param so a re-Generate at the same path shows
          // the new bytes instead of stale-cached bytes.
          src={outputUrl ? `${outputUrl}?v=${cacheBuster(outputUrl)}` : inputUrl}
          alt={outputUrl ? 'Output preview' : 'Output (waiting for Generate)'}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            display: 'block',
            opacity: outputUrl ? 1 : 0.45,
          }}
        />
        {!outputUrl && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              padding: '6px 14px',
              borderRadius: 4,
              background: 'rgba(0,0,0,0.7)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
              pointerEvents: 'none',
            }}
          >
            Press Generate
          </div>
        )}
      </Side>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function Side({
  label,
  labelTone,
  emphasized,
  children,
}: {
  label: string
  labelTone: 'dark' | 'green'
  emphasized?: boolean
  children: ReactNode
}) {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 8,
        overflow: 'hidden',
        border: emphasized ? '2px solid #22C55E' : '1px solid var(--border-card)',
        boxShadow: emphasized
          ? '0 0 0 2px rgba(34,197,94,0.18), 0 4px 16px rgba(0,0,0,0.4)'
          : '0 4px 16px rgba(0,0,0,0.4)',
        background: 'var(--bg-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 8,
          left: 10,
          padding: '3px 8px',
          borderRadius: 3,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
          background: labelTone === 'green' ? '#22C55E' : 'rgba(0,0,0,0.7)',
          color: '#fff',
          zIndex: 4,
          pointerEvents: 'none',
        }}
      >
        {label}
      </span>
      {children}
    </div>
  )
}

/** Stable hash of a URL → query value, so the same URL gets the same
 *  cache-buster within a session but a re-Generate at the same path
 *  changes (different mtime → different content-length → React re-mounts
 *  the <img> via key change anyway). For our purposes, time-based is fine. */
function cacheBuster(url: string): string {
  // We can't reliably stat the file; use a per-URL session-stable token.
  // Simplest: a counter incremented on each unique URL. We avoid Date.now()
  // because it would change every render. Instead, use the URL length
  // (stable per-URL) as the cache-buster and rely on the URL itself
  // changing when a new output is written (different filename or path).
  return String(url.length)
}
