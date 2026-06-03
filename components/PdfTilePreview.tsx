'use client'

// ============================================================================
// PdfTilePreview — renders the first page of a PDF as a tile thumbnail.
// Ralph 2026-05-31.
//
// Why first-page preview, not a generic icon: parity with how raster/SVG tiles
// work — at a glance you should see what's in the file. The icon was a step-1
// placeholder; this is the real version.
//
// How:
//   1. Lazy-load pdfjs-dist on first mount (~1MB once, cached across tiles).
//   2. Configure the worker via /pdf.worker.min.mjs (copied to public/ from
//      node_modules/pdfjs-dist/build at install time).
//   3. Render page 1 into an offscreen canvas at ~2× the display size, then
//      hand the resulting data URL to an <img> that mirrors the raster tile
//      contract (object-fit:contain, fills the aspect-ratio:1 parent).
//   4. Module-level Map caches the data URL by source path so re-mounts
//      (scroll, parent re-render, theme toggle) don't re-rasterize.
//   5. While rendering and on hard failure, fall back to the icon view —
//      we still want a visible tile even if PDF.js chokes.
//
// pointerEvents: none on every layer so the parent <div onClick> wins. Same
// contract as the previous icon-only version, just with a real thumbnail.
// ============================================================================

import { useEffect, useState } from 'react'

// Cache rendered thumbnails by source path. Survives component unmount; lives
// for the page lifetime. Same Tile, same scroll position → no re-render.
const pdfThumbnailCache = new Map<string, string>()

// pdfjs is dynamic-imported (ES module, ~1MB) — lazy so unrelated routes
// (CRM, etc.) don't pay the cost. workerConfigured guards against re-setting
// the global workerSrc on every mount.
type PdfJsModule = typeof import('pdfjs-dist/build/pdf.mjs')
let pdfjsModule: PdfJsModule | null = null
let workerConfigured = false

async function ensurePdfJs(): Promise<PdfJsModule> {
  if (pdfjsModule) return pdfjsModule
  // Cast: pdfjs-dist ships TS types but the worker config is on the runtime
  // GlobalWorkerOptions object — using the imported module direct keeps Next
  // happy with the dynamic-import path.
  pdfjsModule = await import('pdfjs-dist/build/pdf.mjs')
  if (!workerConfigured) {
    pdfjsModule.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
    workerConfigured = true
  }
  return pdfjsModule
}

interface Props {
  /** Original filename — leading "<timestamp>-" prefix is stripped for display. */
  filename: string
  /** Public URL of the PDF (e.g. /<sessionId>/<filename>.pdf). */
  src: string
  /** 'small' = pending uploads / dense grids; 'large' = main BentoTile. Default large. */
  size?: 'small' | 'large'
}

export function PdfTilePreview({ filename, src, size = 'large' }: Props) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(
    () => pdfThumbnailCache.get(src) || null,
  )
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // Already rendered (cache hit) or hard-failed — nothing to do.
    if (thumbUrl || failed) return
    let cancelled = false

    async function render() {
      try {
        const pdfjs = await ensurePdfJs()
        const loadingTask = pdfjs.getDocument(src)
        const pdf = await loadingTask.promise
        const page = await pdf.getPage(1)
        // Aim for ~480px wide thumbnails (DPR-aware via scale, capped at 2×
        // so we don't burn time/memory on giant pages).
        const baseViewport = page.getViewport({ scale: 1 })
        const targetWidth = 480
        const scale = Math.min(2, Math.max(0.5, targetWidth / baseViewport.width))
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('No 2d context')
        await page.render({
          // pdfjs-dist v6 requires `canvas` here too (renamed from `canvasContext`).
          // Both fields are accepted; pass both for forward/backward compat.
          canvas,
          canvasContext: ctx,
          viewport,
        } as unknown as Parameters<typeof page.render>[0]).promise
        if (cancelled) return
        const dataUrl = canvas.toDataURL('image/png')
        pdfThumbnailCache.set(src, dataUrl)
        setThumbUrl(dataUrl)
      } catch (err) {
        // PDF.js throws for corrupted PDFs, network errors, etc. We show the
        // icon fallback rather than a blank tile so the asset is still visible.
        console.warn('[PdfTilePreview] render failed for', src, err)
        if (!cancelled) setFailed(true)
      }
    }
    void render()

    return () => {
      cancelled = true
    }
  }, [src, thumbUrl, failed])

  const display = filename.replace(/^\d+-/, '')

  // Successful render — show the real thumbnail with a small PDF chip on top.
  if (thumbUrl) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: '#f5f5f5',
        }}
      >
        <img
          src={thumbUrl}
          alt={display}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            pointerEvents: 'none',
          }}
        />
        {/* PDF chip — small badge so users can spot vector vs raster vs PDF
            at a glance. Top-left mirrors the file-type indicator pattern. */}
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 6,
            fontSize: 8,
            fontWeight: 800,
            color: '#fff',
            background: '#b91c1c',
            padding: '2px 5px',
            borderRadius: 2,
            letterSpacing: 0.3,
            lineHeight: 1,
            pointerEvents: 'none',
          }}
        >
          PDF
        </div>
      </div>
    )
  }

  // Loading state or hard failure → icon fallback (red document + filename).
  // Same chrome both cases; the difference is just whether a render is still
  // in flight. We deliberately don't show a spinner: most PDFs render in
  // <200ms and a spinner would flash distractingly.
  const iconSize = size === 'small' ? 28 : 40
  const labelFontSize = size === 'small' ? 8 : 10

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        gap: 6,
        backgroundColor: '#fef2f2',
        color: '#b91c1c',
        pointerEvents: 'none',
      }}
    >
      <div style={{ position: 'relative' }}>
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <div
          style={{
            position: 'absolute',
            bottom: -2,
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: 8,
            fontWeight: 800,
            color: '#fff',
            background: '#b91c1c',
            padding: '1px 5px',
            borderRadius: 2,
            letterSpacing: 0.3,
            lineHeight: 1,
          }}
        >
          PDF
        </div>
      </div>
      <div
        style={{
          fontSize: labelFontSize,
          fontWeight: 600,
          color: '#7f1d1d',
          maxWidth: '90%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'center',
          marginTop: 4,
        }}
        title={display}
      >
        {display}
      </div>
    </div>
  )
}
