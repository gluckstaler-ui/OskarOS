'use client'

/**
 * AssignToVibeDrawer — WP-8B (redesigned per Ralph's correction 2026-04-16)
 *
 * Floating panel inside Zone 2 (CanvasPreview). Two-step flow:
 *
 *   Step 1: Pick a PAGE (hub or subpage) from the list of vibes
 *   Step 2: Pick a SECTION/slot on that page — shown with thumbnail
 *           of the current image, human label, and nearest heading
 *           as "where in the page" context
 *
 * Backend: GET /api/sessions/[id]/vibe-slots returns VibeGroup[]
 *          POST /api/sessions/[id]/assign-slot swaps one slot on one page
 *
 * Variants (e.g. vibe-1-grandma-s-cliff-opus.html) are filtered server-side.
 * This component never sees them.
 */

import { useEffect, useMemo, useState } from 'react'

// Must match shape returned by /api/sessions/[id]/vibe-slots
interface SlotInfo {
  slot: string
  humanLabel: string
  context: string | null
  currentImage: string
  hasValidImage: boolean
  isPlaceholder: boolean
}
interface PageInfo {
  filename: string
  displayName: string
  isHub: boolean
  parent: string | null
  slots: SlotInfo[]
}
interface VibeGroup {
  vibeKey: string
  displayName: string
  pages: PageInfo[]
}

export interface AssignResult {
  vibe: string
  slot: string
  oldImage?: string
  newImage: string
}

interface AssignToVibeDrawerProps {
  sessionId: string
  filename: string
  onClose: () => void
  onAssigned?: (result: AssignResult) => void
}

type Step = 'page' | 'slot'

export function AssignToVibeDrawer({
  sessionId,
  filename,
  onClose,
  onAssigned,
}: AssignToVibeDrawerProps) {
  const [groups, setGroups] = useState<VibeGroup[] | null>(null)
  const [step, setStep] = useState<Step>('page')
  const [pickedPage, setPickedPage] = useState<{ vibe: VibeGroup; page: PageInfo } | null>(null)
  const [assigning, setAssigning] = useState<string | null>(null) // slot id being assigned
  const [error, setError] = useState<string | null>(null)

  // Load the vibe → pages → slots map once
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/vibe-slots`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) {
          const list: VibeGroup[] = data.groups || []
          setGroups(list)
        }
      } catch (err) {
        if (!cancelled) setError(`Could not load vibes: ${err}`)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  async function handleAssign(vibeFile: string, slot: string) {
    setAssigning(slot)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/assign-slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vibe: vibeFile, slot, filename }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
      onAssigned?.({
        vibe: vibeFile,
        slot,
        oldImage: data.result?.oldImage,
        newImage: filename,
      })
      onClose()
    } catch (err) {
      setError(`Assign failed: ${err}`)
    } finally {
      setAssigning(null)
    }
  }

  const totalPages = useMemo(
    () => (groups ? groups.reduce((n, g) => n + g.pages.length, 0) : 0),
    [groups]
  )

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        width: 360,
        maxHeight: 'calc(100% - 24px)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-card)',
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          {step === 'slot' && pickedPage ? (
            <button
              onClick={() => {
                setPickedPage(null)
                setStep('page')
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 11,
                cursor: 'pointer',
                padding: 0,
                fontFamily: 'inherit',
              }}
              title="Back to pages"
            >
              <span style={{ fontSize: 14, lineHeight: 1 }}>←</span>
              <span
                style={{
                  fontWeight: 600,
                  color: 'var(--text-main)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 240,
                }}
              >
                {pickedPage.vibe.displayName} · {pickedPage.page.displayName}
              </span>
            </button>
          ) : (
            <>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--text-dim)',
                }}
              >
                Assign to page
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={filename}
              >
                {filename}
              </div>
            </>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            width: 24,
            height: 24,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            flexShrink: 0,
          }}
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {groups === null && (
          <EmptyMessage>Loading pages…</EmptyMessage>
        )}

        {groups && totalPages === 0 && (
          <EmptyMessage>
            No assignable pages found in this session.
            <br />
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              Pages need <code>data-slot</code> attributes to appear here.
            </span>
          </EmptyMessage>
        )}

        {/* Step 1: Pick a page */}
        {step === 'page' && groups && totalPages > 0 && (
          <div>
            {groups.map((group) => (
              <div key={group.vibeKey} style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--text-dim)',
                    padding: '6px 10px 4px',
                  }}
                >
                  {group.displayName}
                </div>
                {group.pages.map((page) => (
                  <button
                    key={page.filename}
                    onClick={() => {
                      setPickedPage({ vibe: group, page })
                      setStep('slot')
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      marginBottom: 2,
                      marginLeft: page.isHub ? 0 : 12,
                      width: page.isHub ? '100%' : 'calc(100% - 12px)',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-card)',
                      borderRadius: 6,
                      color: 'var(--text-main)',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      textAlign: 'left',
                      transition: 'border-color 0.12s',
                    }}
                    onMouseEnter={(e) => {
                      ;(e.currentTarget as HTMLElement).style.borderColor =
                        'var(--border-active)'
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLElement).style.borderColor =
                        'var(--border-card)'
                    }}
                    title={page.filename}
                  >
                    <span
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {page.isHub ? '' : '↳ '}
                        {page.displayName}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          color: 'var(--text-dim)',
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {page.slots.length} section
                        {page.slots.length === 1 ? '' : 's'}
                        {!page.isHub && ' · subpage'}
                      </span>
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 8 }}>
                      ›
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Step 2: Pick a slot on the chosen page */}
        {step === 'slot' && pickedPage && (
          <div>
            {pickedPage.page.slots.map((s) => {
              const isAssigning = assigning === s.slot
              const thumbSrc = s.hasValidImage
                ? `/${sessionId}/${s.currentImage}`
                : null
              return (
                <button
                  key={s.slot}
                  onClick={() => handleAssign(pickedPage.page.filename, s.slot)}
                  disabled={isAssigning}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 8,
                    marginBottom: 4,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-card)',
                    borderRadius: 8,
                    color: 'var(--text-main)',
                    fontSize: 12,
                    cursor: isAssigning ? 'default' : 'pointer',
                    opacity: isAssigning ? 0.6 : 1,
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    transition: 'border-color 0.12s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isAssigning) {
                      ;(e.currentTarget as HTMLElement).style.borderColor =
                        'var(--border-active)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isAssigning) {
                      ;(e.currentTarget as HTMLElement).style.borderColor =
                        'var(--border-card)'
                    }
                  }}
                  title={`Replace current image in "${s.humanLabel}"`}
                >
                  {/* Thumbnail of current image (with broken-image guard) */}
                  <Thumbnail src={thumbSrc} isPlaceholder={s.isPlaceholder} />

                  {/* Label + context + current filename */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 12 }}>
                      {s.humanLabel}
                    </span>
                    {s.context && (
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--text-muted)',
                          marginTop: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontStyle: 'italic',
                        }}
                      >
                        “{s.context}”
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 9,
                        color: 'var(--text-dim)',
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: 'monospace',
                      }}
                    >
                      {isAssigning
                        ? 'assigning…'
                        : s.isPlaceholder
                          ? 'Currently: (placeholder)'
                          : `Currently: ${s.currentImage}`}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: '8px 14px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderTop: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#EF4444',
            fontSize: 10,
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────
// Small presentational helpers
// ───────────────────────────────────────────────────────────────────

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 20,
        textAlign: 'center',
        fontSize: 11,
        color: 'var(--text-dim)',
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  )
}

function Thumbnail({
  src,
  isPlaceholder,
}: {
  src: string | null
  isPlaceholder: boolean
}) {
  const [broken, setBroken] = useState(false)
  const showImage = src && !isPlaceholder && !broken

  return (
    <div
      style={{
        width: 48,
        height: 48,
        flexShrink: 0,
        borderRadius: 4,
        overflow: 'hidden',
        background: 'var(--hover-overlay, rgba(255,255,255,0.04))',
        border: '1px solid var(--border-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 9,
        color: 'var(--text-dim)',
        letterSpacing: 0.5,
      }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt=""
          onError={() => setBroken(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : (
        '—'
      )}
    </div>
  )
}
