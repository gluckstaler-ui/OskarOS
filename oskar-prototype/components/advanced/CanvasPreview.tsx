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

import { memo, useMemo } from 'react'
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
}: CanvasPreviewProps) {
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
        {/* Layout mode: bento grid preview */}
        {isLayoutMode && hasLayoutImages ? (
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
                <img
                  src={selectedImage.path}
                  alt={selectedImage.filename}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                  }}
                />
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

export const CanvasPreview = memo(CanvasPreviewImpl)
