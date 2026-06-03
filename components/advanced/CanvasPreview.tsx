'use client'

/**
 * CanvasPreview — Zone 2 of Advanced Mode
 *
 * Standard mode: full-size preview + description overlay + copy button + version sidebar.
 * Layout mode: live bento grid showing staged images in their grid cells.
 *
 * WP-1A: basic preview.
 * WP-1C: version sidebar — walks generation lineage (ancestors + descendants).
 * WP-5: bento grid preview for Layout tab.
 */

import { memo, useMemo, useRef, useCallback, useEffect, useState, type ReactNode } from 'react'
import { SourceImage } from '@/lib/types'
import type { AdvancedTab, LayoutStaging } from '@/components/AdvancedMode'
import { buildSidebarList } from '@/lib/image-lineage'
import { AssignToVibeDrawer, type AssignResult } from './AssignToVibeDrawer'

export interface CanvasPreviewProps {
  selectedImage: SourceImage | null
  onCopyDescription: (description: string) => void
  /** Fired when user clicks a version in the sidebar. */
  onSelectVersion?: (image: SourceImage) => void
  activeTab?: AdvancedTab
  layoutStaging?: LayoutStaging
  /** Full sourceImages list — used to build the lineage for the version sidebar. */
  sourceImages?: SourceImage[]
  /** Session id — required for the "Assign to Vibe" drawer (WP-8B). */
  sessionId?: string
  /** Fired after a successful vibe-slot assign — parent can emit snackbar. */
  onAssignedToVibe?: (result: AssignResult) => void
  /** Drawer open state — parent-controlled (button lives in the tab bar). */
  assignOpen?: boolean
  /** Called when the drawer closes itself (× button or after successful swap). */
  onCloseAssign?: () => void
  /** WP-9: When true, show a loading overlay with spinner over the canvas. */
  isGenerating?: boolean
  /** WP-5: Active layout preset label so BentoPreview can pick the right grid. */
  activePresetLabel?: string | null
  /**
   * WP-IMG-2/3 (2026-05-06): optional overlay rendered on top of the source
   * image inside Zone 2. Used by image-ops mode (crop marquee, slice grid).
   * The overlay is positioned `inset:0` over a wrapper that shrink-wraps to
   * the displayed image — so overlay CSS pixels === displayed image CSS
   * pixels (1:1 mapping). Image-native pixel math comes from
   * `onImageNaturalSize` (fired on img onLoad).
   */
  imageOpsOverlay?: ReactNode
  /** WP-IMG-2: report image-native dimensions when the img loads / changes. */
  onImageNaturalSize?: (size: { naturalW: number; naturalH: number; displayedRect: DOMRect } | null) => void
  /**
   * Ralph 2026-05-06: when set, fully REPLACES the standard `<img>` area
   * with this content (input | output split). The chrome (filename pill,
   * version sidebar, isGenerating spinner, assign drawer) still renders.
   * The split itself owns its own image refs; `onImageNaturalSize` should
   * be wired by the parent into the split's input image, not the standard
   * one (the standard `<img>` is unmounted when this prop is set).
   */
  imageOpsSplitView?: ReactNode
}

function CanvasPreviewImpl({
  selectedImage,
  onCopyDescription,
  onSelectVersion,
  activeTab,
  layoutStaging,
  sourceImages = [],
  sessionId,
  onAssignedToVibe,
  assignOpen = false,
  onCloseAssign,
  isGenerating,
  activePresetLabel,
  imageOpsOverlay,
  onImageNaturalSize,
  imageOpsSplitView,
}: CanvasPreviewProps) {
  // WP-IMG-2: track the displayed <img> so the overlay (marquee, grid) can
  // get pixel-accurate dimensions. We notify the parent when the image loads
  // and when it resizes (window resize → ResizeObserver).
  const imgRef = useRef<HTMLImageElement | null>(null)
  const reportSize = useCallback(() => {
    const el = imgRef.current
    if (!el || !onImageNaturalSize) return
    if (!el.naturalWidth || !el.naturalHeight) return
    onImageNaturalSize({
      naturalW: el.naturalWidth,
      naturalH: el.naturalHeight,
      displayedRect: el.getBoundingClientRect(),
    })
  }, [onImageNaturalSize])

  // WP-IMG-2: ResizeObserver on the <img> so the overlay sees layout changes
  // (window resize, expand/collapse chat column → image grows/shrinks). Without
  // this the marquee would be pinned to stale coords after any layout shift.
  useEffect(() => {
    const el = imgRef.current
    if (!el || !onImageNaturalSize || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => reportSize())
    ro.observe(el)
    // Fire once for cached images that won't trigger onLoad.
    if (el.complete && el.naturalWidth) reportSize()
    return () => ro.disconnect()
  }, [reportSize, onImageNaturalSize, selectedImage?.path])
  const description = selectedImage?.analysis?.description || ''
  const hasDescription = description.trim().length > 0
  const isLayoutMode = activeTab === 'layout'
  const hasLayoutImages = isLayoutMode && layoutStaging?.slots.some(Boolean)

  // WP-8B: Assign-to-vibe drawer open/close is now owned by AdvancedMode —
  // the toggle lives in the tab bar. This component just renders the drawer
  // when the parent says to.
  const canAssign = Boolean(sessionId && selectedImage && !isLayoutMode)

  // WP-1C: compute the version sidebar list (root + descendants in chronological order)
  const versionChain = useMemo(() => {
    if (!selectedImage || sourceImages.length === 0 || isLayoutMode) return []
    const chain = buildSidebarList(selectedImage, sourceImages)
    // Only show sidebar when there's more than one version (root + at least one gen)
    return chain.length > 1 ? chain : []
  }, [selectedImage, sourceImages, isLayoutMode])

  const showSidebar = versionChain.length > 0

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--bg-card)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Image area — flex:1, takes remaining space */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        {/* Image-ops split view (Ralph 2026-05-06) — replaces the standard
            single-image area when the workshop's preview toggle is ON.
            Filename pill, version sidebar, etc. still render around it. */}
        {imageOpsSplitView ? (
          imageOpsSplitView
        ) : isLayoutMode && hasLayoutImages ? (
          <BentoPreview staging={layoutStaging!} activePresetLabel={activePresetLabel} />
        ) : (
          /* Standard mode: single image preview */
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
            }}
          >
            {selectedImage ? (
              <>
                {/* WP-IMG-2: wrap the <img> in a relative, shrink-wrapped
                    container so the image-ops overlay (crop marquee, slice
                    grid) can sit `inset:0` exactly over the displayed image
                    — not over the whole canvas. inline-block + max 100%
                    keeps the wrapper sized to the contained <img>.

                    Ralph 2026-05-31 · SVG carve-out. Many SVGs (Illustrator
                    exports, the `logo-key.svg` family) declare viewBox only,
                    no width/height attrs. In the inline-block + max:100%
                    geometry above, Chrome can't resolve the circular layout
                    (parent shrinks to child; child's max-width: 100% is of
                    parent) and the SVG collapses to 0×0 — the preview goes
                    blank even though the thumbnail renders. For SVGs we drop
                    the shrink-wrap and use a flex-centered 100% container
                    so the <img> has a definite max-width/height to compute
                    against. Image-ops (crop/slice) is raster-only, so the
                    overlay-alignment reason for shrink-wrap doesn't apply. */}
                {(() => {
                  const isSvg = /\.svg($|\?)/i.test(selectedImage.path || selectedImage.filename || '')
                  const wrapperStyle: React.CSSProperties = isSvg
                    ? { position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 0 }
                    : { position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: '100%', lineHeight: 0 }
                  return (
                <div style={wrapperStyle}>
                  <img
                    ref={imgRef}
                    onLoad={reportSize}
                    src={selectedImage.path}
                    alt={selectedImage.filename}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      display: 'block',
                    }}
                  />
                  {imageOpsOverlay && (
                    <div style={{ position: 'absolute', inset: 0, lineHeight: 1 }}>
                      {imageOpsOverlay}
                    </div>
                  )}
                </div>
                  )
                })()}
                {/* Filename pill — top-right of the preview. The filename
                    is the image's identity downstream (used in HTML, CD
                    references it, version sidebar groups by it). Sits on
                    the right edge so it doesn't collide with the bottom
                    description overlay. Offsets left of the version
                    sidebar (90px) when one is open. (Ralph 2026-04-25.) */}
                <div
                  title={selectedImage.filename}
                  style={{
                    position: 'absolute',
                    top: 12,
                    right: showSidebar ? 102 : 12,
                    maxWidth: 'calc(100% - 24px)',
                    padding: '4px 8px',
                    borderRadius: 4,
                    background: 'rgba(0, 0, 0, 0.65)',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
                    letterSpacing: '-0.02em',
                    backdropFilter: 'blur(6px)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    zIndex: 5,
                    pointerEvents: 'auto',
                    userSelect: 'text',
                  }}
                >
                  {selectedImage.filename.replace(/^\d+-/, '')}
                </div>
                {/* Tag overlay — display chips for auto-assigned tags + 3-button
                    user-curation row (STAR / B-ROLL / TRASH). Renders only when
                    we have a sessionId AND image-ops split isn't active (which
                    has its own overlay needs). (Ralph 2026-05-05.)
                    sourceImages threaded so the overlay can resolve the FRESH
                    tag after assets_updated refreshes — `selectedImage` itself
                    is a snapshot stored in tab state and would otherwise stay
                    stale until the user re-clicked. */}
                {sessionId && !imageOpsSplitView && (
                  <TagOverlay
                    selectedImage={selectedImage}
                    sourceImages={sourceImages}
                    sessionId={sessionId}
                  />
                )}
              </>
            ) : (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-dim)',
                  textAlign: 'center',
                  lineHeight: 1.6,
                  padding: 20,
                }}
              >
                {isLayoutMode
                  ? 'Click images in the library to fill grid slots.\nThe bento preview appears here as you assign images.'
                  : 'Select an image from the library on the left\nto view it at full size.'}
              </div>
            )}
          </div>
        )}

        {/* WP-9: Generating overlay with spinner */}
        {isGenerating && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              zIndex: 10,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                border: '3px solid rgba(255,255,255,0.15)',
                borderTopColor: '#F59E0B',
                borderRadius: '50%',
                animation: 'adv-spin 0.8s linear infinite',
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: '#F59E0B',
              }}
            >
              Generating…
            </span>
            <style>{`@keyframes adv-spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {/* WP-1C: Version sidebar — overlays image area */}
        {showSidebar && (
          <VersionSidebar
            versions={versionChain}
            selectedId={selectedImage?.id}
            onSelect={onSelectVersion}
          />
        )}

        {/* Description — text on image, no background */}
        {!isLayoutMode && selectedImage && hasDescription && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: showSidebar ? 90 : 0,
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'flex-end',
              gap: 8,
              pointerEvents: 'none',
            }}
          >
            <span
              style={{
                flex: 1,
                fontSize: 11,
                lineHeight: 1.5,
                color: 'var(--text-muted)',
                userSelect: 'text',
                pointerEvents: 'auto',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical' as const,
                textShadow: '0 1px 3px rgba(0,0,0,0.5)',
              }}
            >
              {description}
            </span>
            <button
              onClick={() => onCopyDescription(description)}
              style={{
                pointerEvents: 'auto',
                height: 22,
                padding: '0 8px',
                borderRadius: 4,
                border: '1px solid var(--desc-btn-border)',
                background: 'var(--desc-btn-bg)',
                color: 'var(--desc-btn-text)',
                fontSize: 10,
                cursor: 'pointer',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.12s',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.color = 'var(--desc-btn-hover-text)'
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--desc-btn-hover-border)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.color = 'var(--desc-btn-text)'
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--desc-btn-border)'
              }}
              title="Insert description at cursor in prompt (non-destructive)"
            >
              📋 Copy
            </button>
          </div>
        )}

        {/* WP-8B: Assign-to-vibe drawer.
            Toggle button lives in the parent tab bar (AdvancedMode);
            this component only renders the drawer when told to. */}
        {assignOpen && canAssign && selectedImage && sessionId && (
          <AssignToVibeDrawer
            sessionId={sessionId}
            filename={selectedImage.filename}
            onClose={() => onCloseAssign?.()}
            onAssigned={(result) => {
              onAssignedToVibe?.(result)
            }}
          />
        )}

        {/* No-description placeholder */}
        {!isLayoutMode && selectedImage && !hasDescription && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: '10px 16px',
              fontSize: 11,
              color: 'var(--text-dim)',
              fontStyle: 'italic',
              textShadow: '0 1px 3px rgba(0,0,0,0.5)',
            }}
          >
            No description available — Nano Banana hasn't analyzed this image yet.
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// WP-1C: VersionSidebar — walks generation lineage, click to switch versions
// ============================================================================

interface VersionSidebarProps {
  versions: SourceImage[]
  selectedId?: string
  onSelect?: (image: SourceImage) => void
}

function VersionSidebar({ versions, selectedId, onSelect }: VersionSidebarProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 90,
        height: '100%',
        background: 'var(--backdrop-overlay)',
        borderLeft: '1px solid var(--border-card)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 2,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 8px 4px',
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        Versions ({versions.length})
      </div>

      {/* Scrollable list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 6px 6px',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
        className="adv-version-list"
      >
        {versions.map((img, idx) => {
          const isSelected = img.id === selectedId
          const isOriginal = idx === 0
          const label = isOriginal ? 'orig' : `v${idx}`
          return (
            <div
              key={img.id}
              onClick={() => onSelect?.(img)}
              style={{
                width: '100%',
                aspectRatio: '4 / 3',
                borderRadius: 4,
                position: 'relative',
                cursor: 'pointer',
                border: `2px solid ${isSelected ? '#10B981' : 'transparent'}`,
                overflow: 'hidden',
                transition: 'all 0.12s',
                flexShrink: 0,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundImage: `url(${img.path})`,
                backgroundColor: 'var(--bg-card)',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border-active)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  ;(e.currentTarget as HTMLElement).style.borderColor = 'transparent'
                }
              }}
              title={`${label} — ${img.filename}${img.preset ? ` (${img.preset})` : ''}`}
            >
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: '2px 4px',
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
                  fontSize: 7,
                  color: 'rgba(255,255,255,0.55)',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {label}
              </div>
            </div>
          )
        })}
      </div>

      <style jsx>{`
        .adv-version-list::-webkit-scrollbar {
          width: 2px;
        }
        .adv-version-list::-webkit-scrollbar-thumb {
          background: var(--border-card);
          border-radius: 1px;
        }
      `}</style>
    </div>
  )
}

// ============================================================================
// BentoPreview — CSS grid layout from staging slots
// (WP-5 rewired 2026-04-17: now consumes the active layout preset's
//  GridConfig via lib/grid-engine.ts instead of a hardcoded slot-count
//  algorithm. Different presets now render visibly different grids.)
// ============================================================================

import { computeGridSpec } from '@/lib/grid-engine'
import { findPreset } from '@/lib/image-presets'
import type { LayoutPreset } from '@/lib/image-presets'

interface BentoPreviewProps {
  staging: LayoutStaging
  /** Active layout preset label, if user picked one. Null = fallback grid. */
  activePresetLabel?: string | null
}

function BentoPreview({ staging, activePresetLabel }: BentoPreviewProps) {
  const filled = staging.slots.filter(Boolean)
  const count = filled.length
  if (count === 0) return null

  // Resolve the active preset (if any) and compute the grid spec from it.
  const preset = activePresetLabel
    ? (findPreset('layout', activePresetLabel) as LayoutPreset | null)
    : null
  const { columns, rows, areas } = computeGridSpec(preset, staging.slots)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: columns,
        gridTemplateRows: rows,
        height: '100%',
        padding: 8,
        gap: 5,
      }}
    >
      {staging.slots.map((img, i) => {
        const area = areas[i]
        if (!area) return null
        const isHero = area.isHero === true
        return (
          <div
            key={i}
            style={{
              gridColumn: area.col,
              gridRow: area.row,
              borderRadius: 4,
              overflow: 'hidden',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundImage: img ? `url(${img.path})` : 'none',
              backgroundColor: 'var(--bg-card)',
              border: img ? 'none' : `1px dashed ${isHero ? '#10B981' : 'var(--border-card)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {!img && (
              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600 }}>
                {isHero ? 'Hero' : i + 1}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ============================================================================
// TagOverlay — display chips for auto-assigned tags + 3-button user-curation
// row (STAR / B-ROLL / TRASH).
//
// (Ralph 2026-05-05, restructured 2026-05-06.) The IMAGES.md tag enum splits
// into two layers:
//   - AUTO-ASSIGNED: HERO (placement), USED (referenced) — render as small
//     placement chips at the top.
//   - USER-ASSIGNABLE: ★ / B-ROLL / TRASH. Three small assign buttons in a
//     row, ALWAYS in their identity color (no onyx-only inactive state).
//     Click → POST update_image_metadata, then optimistically update local
//     pendingTag. Below the buttons sits the BIG current tag (twice the
//     button height) in its identity color — the canonical readout for
//     "what is this image tagged?" INGESTED is the system-assigned fallback
//     when CD didn't pick a user tag.
// ============================================================================

type UserTag = 'STAR' | 'B-ROLL' | 'TRASH'

// Color identity for every tag the BIG current-tag readout can show.
// Kept deliberately small — only the tags that surface in this overlay.
// Alphas pushed up + greys darkened so chips read on BOTH onyx (dark) AND
// polar (white) backgrounds — the previous 0.18-0.20 fills washed out
// against polar's white card and the muted grey vanished entirely.
// (Ralph 2026-05-06: tags-polar.jpg bug.)
const TAG_COLORS: Record<string, { color: string; bgFill: string }> = {
  STAR:     { color: '#ca8a04', bgFill: 'rgba(202,138,4,0.18)' },   // amber-700 (reads on white)
  'B-ROLL': { color: '#475569', bgFill: 'rgba(71,85,105,0.18)' },   // slate-600 (replaces washed-out grey)
  TRASH:    { color: '#dc2626', bgFill: 'rgba(220,38,38,0.18)' },   // red-600
  INGESTED: { color: '#64748b', bgFill: 'rgba(100,116,139,0.18)' }, // slate-500 (system fallback)
  HERO:     { color: '#d97706', bgFill: 'rgba(217,119,6,0.18)' },   // amber-600
  USED:     { color: '#059669', bgFill: 'rgba(5,150,105,0.18)' },   // emerald-600
  READY:    { color: '#0891b2', bgFill: 'rgba(8,145,178,0.18)' },   // cyan-600
  APPROVED: { color: '#0d9488', bgFill: 'rgba(13,148,136,0.18)' },  // teal-600
  REDO:     { color: '#ca8a04', bgFill: 'rgba(202,138,4,0.18)' },   // amber-700
}

const FEATHER_STAR_POINTS = '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'

function TagOverlay({
  selectedImage,
  sourceImages,
  sessionId,
}: {
  selectedImage: SourceImage
  sourceImages: SourceImage[]
  sessionId: string
}) {
  // Optimistic local state — flips immediately on click, server reconciles
  // on next IMAGES.md re-parse.
  const [pendingTag, setPendingTag] = useState<UserTag | null>(null)
  const [pendingClear, setPendingClear] = useState(false)
  const [isWriting, setIsWriting] = useState(false)

  // Resolve the FRESH version of the selected image from the live sourceImages
  // array. selectedImage itself is a snapshot stored in tab state — when
  // assets_updated fires after a tag write, sourceImages refreshes but the
  // snapshot stays stale until the user re-clicks. Threading the fresh lookup
  // here keeps the BIG current-tag readout always-correct. (Ralph 2026-05-06.)
  const liveImage = useMemo(() => {
    return sourceImages.find((s) => s.id === selectedImage.id) ?? selectedImage
  }, [sourceImages, selectedImage])

  // Reset optimistic state whenever the selected image changes — otherwise
  // the previous picture's pending tag leaks into the new selection and
  // the assign buttons look "active" for an image they don't apply to.
  // (Ralph bug, 2026-05-06.)
  useEffect(() => {
    setPendingTag(null)
    setPendingClear(false)
    setIsWriting(false)
  }, [selectedImage.filename])

  // Clear the pending optimistic flags once the server has caught up — i.e.
  // once liveImage.tag matches what we wrote. Without this, the optimistic
  // state shadows the real value forever (e.g. user clicks STAR → server
  // writes STAR → liveImage.tag becomes STAR → but pendingTag still says
  // STAR, so toggling off would incorrectly fall back to lifecycle).
  useEffect(() => {
    if (pendingTag && liveImage.tag === pendingTag) {
      setPendingTag(null)
    }
    if (pendingClear) {
      // Server has written either INGESTED or the lifecycle fallback. Once
      // liveImage.tag is no longer one of the user-curation tags, we're synced.
      const stillUserTag = liveImage.tag === 'STAR' || liveImage.tag === 'B-ROLL' || liveImage.tag === 'TRASH'
      if (!stillUserTag) setPendingClear(false)
    }
  }, [liveImage.tag, pendingTag, pendingClear])

  // Placement signals — independent from user-curation, displayed above.
  const isHero = liveImage.tag === 'HERO'
  const isUsed = (liveImage.usedIn && liveImage.usedIn.length > 0) || liveImage.tag === 'USED'

  // Resolve current user-curation tag from liveImage OR optimistic pending.
  // pendingClear takes precedence (just toggled OFF) → returns null.
  const currentUserTag: UserTag | null = pendingClear
    ? null
    : (pendingTag ??
       (liveImage.tag === 'STAR' ? 'STAR' :
        liveImage.tag === 'B-ROLL' ? 'B-ROLL' :
        liveImage.tag === 'TRASH' ? 'TRASH' : null))

  // Resolve the BIG current-tag display label. Priority:
  //   user-curation tag → lifecycle tag → INGESTED (fallback)
  const lifecycleTag = (() => {
    if (liveImage.tag === 'READY') return 'READY'
    if (liveImage.tag === 'APPROVED') return 'APPROVED'
    if (liveImage.tag === 'REDO') return 'REDO'
    if (liveImage.tag === 'INGESTED') return 'INGESTED'
    return null
  })()
  const bigTagLabel: string = currentUserTag ?? lifecycleTag ?? 'INGESTED'

  const setTag = useCallback(async (next: UserTag) => {
    if (isWriting) return
    // Toggle off if clicking the active one — clears the user-curation tag,
    // which surfaces as the lifecycle tag (or INGESTED fallback) in BIG.
    const isClear = currentUserTag === next
    if (isClear) {
      setPendingClear(true)
      setPendingTag(null)
    } else {
      setPendingClear(false)
      setPendingTag(next)
    }
    setIsWriting(true)
    try {
      // If toggling off, fall back to whatever lifecycle tag was previously
      // there. If none, INGESTED — the system's "processed but no user tag"
      // sentinel.
      const statusToWrite = isClear ? (lifecycleTag ?? 'INGESTED') : next
      await fetch('/api/mcp/update-image-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          filename: liveImage.filename,
          status: statusToWrite,
        }),
      })
    } catch {
      // Optimistic update stays on-screen; user can retry.
    } finally {
      setIsWriting(false)
    }
  }, [currentUserTag, isWriting, lifecycleTag, liveImage.filename, sessionId])

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        zIndex: 5,
        pointerEvents: 'none', // children re-enable as needed
      }}
    >
      {/* TOP ROW: BIG current tag + placement chips (HERO/USED) inline alongside.
          BIG is the canonical "what is this image?" readout; placement chips
          sit to the right at small size as auxiliary signals.
          (Ralph 2026-05-06: BIG + placement chips share TOP row, assignables UNDERNEATH.) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <BigCurrentTag label={bigTagLabel} />
        {isHero && <PlacementChip label="HERO" />}
        {isUsed && <PlacementChip label="USED" />}
      </div>
      {/* The three possibilities — STAR / B-ROLL / TRASH. UNDERNEATH the BIG.
          Always in their identity color. Active = filled stronger.
          Wrapper uses var(--pill-bg) + var(--border-card) so it adapts to
          both themes (onyx dark backdrop, polar white backdrop). */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: 3,
          background: 'var(--pill-bg)',
          borderRadius: 6,
          border: '1px solid var(--border-card)',
          backdropFilter: 'blur(6px)',
          pointerEvents: 'auto',
          alignSelf: 'flex-start',
        }}
      >
        <UserTagButton variant="STAR" active={currentUserTag === 'STAR'} onClick={() => setTag('STAR')} disabled={isWriting} />
        <UserTagButton variant="B-ROLL" active={currentUserTag === 'B-ROLL'} onClick={() => setTag('B-ROLL')} disabled={isWriting} />
        <UserTagButton variant="TRASH" active={currentUserTag === 'TRASH'} onClick={() => setTag('TRASH')} disabled={isWriting} />
      </div>
    </div>
  )
}

function PlacementChip({ label }: { label: string }) {
  const c = TAG_COLORS[label] ?? { color: '#9ca3af', bgFill: 'rgba(107,114,128,0.18)' }
  return (
    <span
      style={{
        // Sized BIGGER than the UserTagButton (22px / fontSize 10) so the
        // placement signals carry visual weight alongside the BIG current
        // tag. Sits between BIG (44px) and assignables (22px) in hierarchy.
        // (Ralph 2026-05-06.)
        display: 'inline-flex',
        alignItems: 'center',
        height: 30,
        fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
        fontSize: 13,
        fontWeight: 700,
        padding: '0 12px',
        borderRadius: 5,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        background: c.bgFill,
        border: `1.5px solid ${c.color}`,
        color: c.color,
        textShadow: '0 1px 2px rgba(0,0,0,0.6)',
      }}
    >
      {label}
    </span>
  )
}

function BigCurrentTag({ label }: { label: string }) {
  const c = TAG_COLORS[label] ?? { color: '#9ca3af', bgFill: 'rgba(107,114,128,0.18)' }
  const isStar = label === 'STAR'
  return (
    <div
      style={{
        alignSelf: 'flex-start',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 44, // ~2x the 22px assign-button height
        padding: isStar ? '0 14px' : '0 18px',
        borderRadius: 8,
        background: c.bgFill,
        border: `1.5px solid ${c.color}`,
        color: c.color,
        fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
        fontSize: 17, // ~2x the 9-10px button text
        fontWeight: 800,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        textShadow: '0 1px 2px rgba(0,0,0,0.6)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(6px)',
      }}
    >
      {isStar ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill={c.color}
          stroke={c.color}
          strokeWidth="1.5"
          strokeLinejoin="round"
        >
          <polygon points={FEATHER_STAR_POINTS}></polygon>
        </svg>
      ) : (
        label
      )}
    </div>
  )
}

function UserTagButton({
  variant,
  active,
  onClick,
  disabled,
}: {
  variant: UserTag
  active: boolean
  onClick: () => void
  disabled: boolean
}) {
  const c = TAG_COLORS[variant]
  const isStar = variant === 'STAR'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={
        variant === 'STAR' ? 'Mark as a great picture'
        : variant === 'B-ROLL' ? 'Keep as secondary / variant'
        : 'Cull this asset'
      }
      style={{
        fontFamily: 'JetBrains Mono, var(--font-mono), monospace',
        fontSize: 10,
        fontWeight: 700,
        padding: isStar ? '4px 7px' : '4px 8px',
        borderRadius: 4,
        // Always-colored: identity color always present in border + text.
        // Active strengthens the fill.
        border: `1px solid ${c.color}`,
        background: active ? `${c.color}33` : `${c.color}10`,
        color: c.color,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'all 0.12s',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 22,
      }}
      onMouseEnter={(e) => {
        if (!active && !disabled) {
          ;(e.currentTarget as HTMLElement).style.background = `${c.color}22`
        }
      }}
      onMouseLeave={(e) => {
        if (!active && !disabled) {
          ;(e.currentTarget as HTMLElement).style.background = `${c.color}10`
        }
      }}
    >
      {isStar ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill={active ? c.color : 'none'}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points={FEATHER_STAR_POINTS}></polygon>
        </svg>
      ) : (
        variant
      )}
    </button>
  )
}

export const CanvasPreview = memo(CanvasPreviewImpl)
