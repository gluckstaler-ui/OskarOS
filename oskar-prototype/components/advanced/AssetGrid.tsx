'use client'

/**
 * AssetGrid — Zone 1 of Advanced Mode
 *
 * Thumbnail grid of all session images with upload support and tag badges
 * (Ralph 2026-04-25 parity pass: brought to feature-parity with the BRIEF/STUDIO
 * AssetsPanel — uploads, tag-driven badges including HERO + USED, drag/drop.)
 *
 * - Click to select; selected image gets green border.
 * - Compose/Layout modes show role badges (Scene/Subject/etc).
 * - HERO badge top-left for tag === 'HERO'.
 * - USED pill bottom-right when image is referenced in any vibe HTML
 *   (image.usedIn.length > 0) OR tag === 'USED'.
 * - Upload tile + drop zone at the top.
 */

import { memo, useRef } from 'react'
import { SourceImage } from '@/lib/types'

export interface AssetGridProps {
  sourceImages: SourceImage[]
  selectedImageId?: string | null
  onSelect: (image: SourceImage) => void
  /** Role badge map: image id → { label, color }. Empty outside compose/layout. */
  roleBadgeMap?: Record<string, { label: string; color: string }>
  /** WP-11A: Fired when user clicks delete on a tile. Parent handles guard + API. */
  onDelete?: (image: SourceImage) => void
  /** WP-11B: Fired when user clicks "Replace everywhere" on a tile. */
  onReplaceAll?: (image: SourceImage) => void
  /** Ralph 2026-04-25: Upload from inside Image mode — same affordance as
   *  the BRIEF/STUDIO AssetsPanel. Receives the chosen File; parent adds it
   *  to sourceImages + IMAGES.md the same way upload-from-Studio does. */
  onUpload?: (file: File) => void
}

function AssetGridImpl({ sourceImages, selectedImageId, onSelect, roleBadgeMap = {}, onDelete, onReplaceAll, onUpload }: AssetGridProps) {
  const cleanName = (filename: string) => filename.replace(/^\d+-/, '')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: React.DragEvent) => {
    if (!onUpload) return
    e.preventDefault()
    Array.from(e.dataTransfer.files).forEach((f) => {
      if (f.type.startsWith('image/')) onUpload(f)
    })
  }

  return (
    <div
      style={{
        // Fill parent bento-card; no self-positioning (parent owns layout)
        flex: 1,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {/* Header — matches BRIEF AssetsPanel header */}
      <div
        style={{
          height: 56,
          minHeight: 56,
          borderBottom: '1px solid var(--border-card)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-main)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--accent, #3B82F6)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 7h-3a2 2 0 0 1-2-2V2"></path>
            <path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z"></path>
            <path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"></path>
          </svg>
          Assets
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            padding: '4px 8px',
            borderRadius: 9999,
            backgroundColor: 'var(--bg-app)',
            border: '1px solid var(--border-card)',
          }}
        >
          {sourceImages.length} items
        </span>
      </div>

      <div
        style={{
          padding: '10px 10px 5px',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
        }}
      >
        Image Library ({sourceImages.length})
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px 16px',
          display: 'grid',
          // Responsive: match BRIEF AssetsPanel behavior
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 12,
          alignContent: 'start',
        }}
        className="adv-asset-grid"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {/* Upload tile — same affordance as BRIEF/STUDIO AssetsPanel.
            Click to file-pick OR drag-drop anywhere on the grid container. */}
        {onUpload && (
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              aspectRatio: '1',
              borderRadius: 12,
              border: '2px dashed var(--border-card)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              backgroundColor: 'var(--bg-app)',
              transition: 'border-color 0.12s, color 0.12s',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border-active)'
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-main)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border-card)'
              ;(e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
            }}
            title="Upload image (or drag-drop into the panel)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Add</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                Array.from(e.target.files || []).forEach((f) => onUpload(f))
                e.target.value = ''
              }}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {sourceImages.length === 0 && !onUpload && (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: '24px 12px',
              fontSize: 11,
              color: 'var(--text-dim)',
              textAlign: 'center',
              lineHeight: 1.6,
            }}
          >
            No images yet.
          </div>
        )}

        {sourceImages.map((img) => {
          const isSelected = img.id === selectedImageId
          const badge = roleBadgeMap[img.id]
          const borderColor = badge ? badge.color : isSelected ? '#10B981' : 'transparent'
          const showBorder = isSelected || !!badge
          // Tag-system badges (Ralph 2026-04-25 parity with BRIEF/STUDIO):
          // HERO badge top-left, USED pill bottom-right. HERO + USED coexist.
          // The role badge (Scene/Subject) takes precedence over HERO in the
          // top-left slot during compose/layout — that's a workflow signal,
          // semantic hierarchy stays consistent.
          const isHero = !badge && img.tag === 'HERO'
          const isUsed =
            (img.usedIn && img.usedIn.length > 0) || img.tag === 'USED'
          const otherTag = img.tag && img.tag !== 'HERO' && img.tag !== 'USED'
            ? img.tag
            : null

          return (
            <div
              key={img.id}
              onClick={() => onSelect(img)}
              style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              <div
                style={{
                  width: '100%',
                  aspectRatio: '1',
                  borderRadius: 12,
                  position: 'relative',
                  // WP-13C: 2px border to match BRIEF/STUDIO tile style.
                  // Role/selection state is still conveyed via border color + outer glow.
                  border: `2px solid ${borderColor || 'transparent'}`,
                  boxShadow: showBorder
                    ? `0 0 0 3px ${borderColor}40, 0 0 12px ${borderColor}66`
                    : 'none',
                  overflow: 'hidden',
                  transition: 'all 0.12s',
                  backgroundColor: 'var(--bg-card-hover)',
                }}
                onMouseEnter={(e) => {
                  if (!showBorder) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-active)'
                }}
                onMouseLeave={(e) => {
                  if (!showBorder) (e.currentTarget as HTMLElement).style.borderColor = 'transparent'
                }}
              >
                {/* WP-13C: <img> + object-fit: cover — matches AssetsPanel's
                    BRIEF/STUDIO tile rendering (was background-image before). */}
                <img
                  src={img.path}
                  alt={img.filename}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                  draggable={false}
                />
                {/* Role badge (compose/layout) — takes the top-left slot. */}
                {badge && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 3,
                      left: 3,
                      height: 14,
                      padding: '0 4px',
                      borderRadius: 3,
                      fontSize: 7,
                      fontWeight: 700,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      textTransform: 'uppercase',
                      background: badge.color,
                    }}
                  >
                    {badge.label}
                  </div>
                )}
                {/* HERO pill — top-left when no role badge is occupying the slot. */}
                {isHero && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 3,
                      left: 3,
                      height: 14,
                      padding: '0 4px',
                      borderRadius: 3,
                      fontSize: 7,
                      fontWeight: 700,
                      color: '#fff',
                      backgroundColor: '#10B981',
                      display: 'flex',
                      alignItems: 'center',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    HERO
                  </div>
                )}
                {/* USED pill — BOTTOM-RIGHT to match BRIEF/STUDIO. Coexists
                    with HERO (top-left) and the role badge (top-left during
                    compose/layout). */}
                {isUsed && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 3,
                      right: 3,
                      height: 14,
                      padding: '0 4px',
                      borderRadius: 3,
                      fontSize: 7,
                      fontWeight: 700,
                      color: '#fff',
                      backgroundColor: '#10B981',
                      display: 'flex',
                      alignItems: 'center',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    USED
                  </div>
                )}
                {/* Other non-HERO non-USED tags (B-ROLL, TRASH, READY, REDO).
                    Bottom-right, same slot as USED — they're mutually exclusive
                    with USED for a given image so there's no overlap. */}
                {!isUsed && otherTag && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 3,
                      right: 3,
                      height: 14,
                      padding: '0 4px',
                      borderRadius: 3,
                      fontSize: 7,
                      fontWeight: 700,
                      color: '#fff',
                      backgroundColor:
                        otherTag === 'TRASH' || otherTag === 'REDO' ? '#EF4444' :
                        otherTag === 'READY' ? '#10B981' : '#6B7280',
                      display: 'flex',
                      alignItems: 'center',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {otherTag}
                  </div>
                )}
                {/* WP-11A: Delete button — visible on hover via CSS class */}
                {onDelete && (
                  <button
                    className="adv-asset-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(img)
                    }}
                    title="Delete image"
                    style={{
                      position: 'absolute',
                      top: 3,
                      right: 3,
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      border: '1px solid rgba(239,68,68,0.3)',
                      background: 'rgba(0,0,0,0.6)',
                      color: '#f87171',
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'none', // shown on hover via CSS
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      lineHeight: 1,
                      fontFamily: 'inherit',
                    }}
                  >
                    ✕
                  </button>
                )}
                {/* WP-11B: Replace everywhere — visible on hover. Bottom-LEFT
                    so it doesn't collide with the bottom-right tag slot
                    (USED / B-ROLL / TRASH / READY / REDO). It's an action,
                    not a tag — the visual treatment differs (blue border,
                    "Replace" verb label). (Ralph 2026-04-25.) */}
                {onReplaceAll && (
                  <button
                    className="adv-asset-replace-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onReplaceAll(img)
                    }}
                    title="Replace everywhere with another image"
                    style={{
                      position: 'absolute',
                      bottom: 3,
                      left: 3,
                      height: 16,
                      padding: '0 5px',
                      borderRadius: 3,
                      border: '1px solid rgba(59,130,246,0.3)',
                      background: 'rgba(0,0,0,0.6)',
                      color: '#60a5fa',
                      fontSize: 7,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'none', // shown on hover via CSS
                      alignItems: 'center',
                      justifyContent: 'center',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontFamily: 'inherit',
                    }}
                  >
                    Replace
                  </button>
                )}
              </div>
              <div
                style={{
                  fontSize: 8,
                  color: showBorder ? borderColor : 'var(--text-dim)',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={img.filename}
              >
                {cleanName(img.filename)}
              </div>
            </div>
          )
        })}
      </div>

      <style jsx>{`
        .adv-asset-grid::-webkit-scrollbar {
          width: 3px;
        }
        .adv-asset-grid::-webkit-scrollbar-thumb {
          background: var(--border-card);
          border-radius: 2px;
        }
        .adv-asset-grid > div:hover .adv-asset-delete-btn {
          display: flex !important;
        }
        .adv-asset-grid > div:hover .adv-asset-replace-btn {
          display: flex !important;
        }
      `}</style>
    </div>
  )
}

export const AssetGrid = memo(AssetGridImpl)
