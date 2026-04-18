'use client'

/**
 * StudioImagePicker — inverse flow for WP-8B (Studio Mode)
 *
 * Triggered when the user clicks a [data-slot] image inside the live-preview
 * iframe. Shows a grid of every image in the session; click one → assign to
 * the slot on the currently-previewed page. The Advanced Mode drawer does
 * the reverse (image-first, page-second).
 *
 * Same backend: POST /api/sessions/[id]/assign-slot.
 */

import { useEffect, useMemo, useState } from 'react'

interface SessionImage {
  filename: string
  url: string
  size: number
}

export interface StudioPickTarget {
  /** HTML file currently in the iframe, e.g. "vibe-1.html" */
  pageFilename: string
  /** Slot name clicked in the preview, e.g. "hero" */
  slot: string
  /** Human label for the slot, resolved by parent (e.g. "Opening image") */
  humanLabel: string
  /** Current image src (for "Current" highlighting) */
  currentImage: string
  /** Heading text nearest the slot, if we can resolve it parent-side */
  context?: string | null
}

export interface StudioPickResult {
  filename: string
  slot: string
  pageFilename: string
  oldImage?: string
}

interface StudioImagePickerProps {
  sessionId: string
  target: StudioPickTarget
  onClose: () => void
  onPicked: (result: StudioPickResult) => void
}

export function StudioImagePicker({
  sessionId,
  target,
  onClose,
  onPicked,
}: StudioImagePickerProps) {
  const [images, setImages] = useState<SessionImage[] | null>(null)
  const [query, setQuery] = useState('')
  const [assigning, setAssigning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Close on Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Load images once on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/images`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setImages(data.images || [])
      } catch (err) {
        if (!cancelled) setError(`Could not load images: ${err}`)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Normalize currentImage — iframe src may be absolute URL; we compare on basename
  const currentBasename = useMemo(
    () => basenameOf(target.currentImage),
    [target.currentImage]
  )

  const filtered = useMemo(() => {
    if (!images) return []
    const q = query.trim().toLowerCase()
    if (!q) return images
    return images.filter((i) => i.filename.toLowerCase().includes(q))
  }, [images, query])

  async function handlePick(filename: string) {
    if (filename === currentBasename) return // same image — no-op
    setAssigning(filename)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/assign-slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vibe: target.pageFilename,
          slot: target.slot,
          filename,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
      onPicked({
        filename,
        slot: target.slot,
        pageFilename: target.pageFilename,
        oldImage: data.result?.oldImage,
      })
    } catch (err) {
      setError(`Assign failed: ${err}`)
    } finally {
      setAssigning(null)
    }
  }

  return (
    <div
      // Full-panel overlay INSIDE the canvas (not a global modal — the live
      // preview stays visible underneath as a darker scrim).
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.78)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 200,
      }}
    >
      <div
        style={{
          width: 'min(960px, 100%)',
          maxHeight: '100%',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--text-dim)',
              }}
            >
              Swap image
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--text-main)',
                marginTop: 2,
              }}
            >
              {target.humanLabel}
              {target.context && (
                <span
                  style={{
                    fontStyle: 'italic',
                    color: 'var(--text-muted)',
                    fontWeight: 400,
                    marginLeft: 8,
                  }}
                >
                  — “{target.context}”
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                marginTop: 3,
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {target.pageFilename} · slot:{target.slot} · currently:{' '}
              {currentBasename || '(placeholder)'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 22,
              lineHeight: 1,
              flexShrink: 0,
            }}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div
          style={{
            padding: '10px 18px',
            borderBottom: '1px solid var(--border-card)',
          }}
        >
          <input
            type="text"
            placeholder="Filter images by filename…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'var(--bg-app)',
              border: '1px solid var(--border-card)',
              borderRadius: 6,
              color: 'var(--text-main)',
              fontSize: 12,
              fontFamily: 'inherit',
              outline: 'none',
            }}
            autoFocus
          />
        </div>

        {/* Grid */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 14,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 10,
            alignContent: 'start',
          }}
        >
          {images === null && (
            <div
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: 40,
                color: 'var(--text-dim)',
                fontSize: 12,
              }}
            >
              Loading images…
            </div>
          )}

          {images && filtered.length === 0 && (
            <div
              style={{
                gridColumn: '1 / -1',
                textAlign: 'center',
                padding: 40,
                color: 'var(--text-dim)',
                fontSize: 12,
              }}
            >
              {query ? `No images match “${query}”` : 'No images in this session yet.'}
            </div>
          )}

          {filtered.map((img) => {
            const isCurrent = img.filename === currentBasename
            const isAssigning = assigning === img.filename
            return (
              <button
                key={img.filename}
                onClick={() => handlePick(img.filename)}
                disabled={isAssigning || isCurrent}
                style={{
                  padding: 0,
                  background: 'var(--bg-app)',
                  border: isCurrent
                    ? '2px solid var(--border-active)'
                    : '1px solid var(--border-card)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  cursor: isCurrent ? 'default' : 'pointer',
                  opacity: isAssigning ? 0.5 : 1,
                  display: 'flex',
                  flexDirection: 'column',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  transition: 'transform 0.12s, border-color 0.12s',
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent && !isAssigning) {
                    ;(e.currentTarget as HTMLElement).style.borderColor =
                      'var(--border-active)'
                    ;(e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent && !isAssigning) {
                    ;(e.currentTarget as HTMLElement).style.borderColor =
                      'var(--border-card)'
                    ;(e.currentTarget as HTMLElement).style.transform = 'none'
                  }
                }}
                title={isCurrent ? 'Currently assigned' : `Swap in ${img.filename}`}
              >
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '1 / 1',
                    background: 'var(--hover-overlay, #111)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.filename}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                    onError={(e) => {
                      ;(e.currentTarget as HTMLElement).style.display = 'none'
                    }}
                  />
                  {isCurrent && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 6,
                        left: 6,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'var(--border-active)',
                        color: 'white',
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Current
                    </span>
                  )}
                  {isAssigning && (
                    <span
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(0,0,0,0.5)',
                        color: 'white',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      swapping…
                    </span>
                  )}
                </div>
                <div
                  style={{
                    padding: '6px 8px',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    fontFamily: 'monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {img.filename}
                </div>
              </button>
            )
          })}
        </div>

        {error && (
          <div
            style={{
              padding: '10px 18px',
              background: 'rgba(239, 68, 68, 0.1)',
              borderTop: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#EF4444',
              fontSize: 11,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

function basenameOf(src: string): string {
  if (!src) return ''
  // Strip query/hash, then take final path segment
  const clean = src.split('?')[0].split('#')[0]
  return clean.substring(clean.lastIndexOf('/') + 1)
}
