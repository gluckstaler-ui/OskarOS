'use client'

import { useState, memo, useEffect, useRef } from 'react'

// ============================================================================
// RESPONSIVE FONT SIZES - Based on container width breakpoints
// Container widths: 320px (min) → 480px (mid) → 640px (max)
// ============================================================================
const FONT_SIZES = {
  // At 320px → 480px → 640px container width
  vibeName: { min: 14, mid: 18, max: 24 },
  vibeNameLabel: { min: 8, mid: 10, max: 12 },
  whoItsFor: { min: 10, mid: 12, max: 15 },
  whoItsForLabel: { min: 7, mid: 9, max: 11 },
  moodLabel: { min: 8, mid: 10, max: 12 },
  moodValue: { min: 10, mid: 12, max: 14 },
  colorPrimary: { min: 6, mid: 8, max: 10 },
  colorSecondary: { min: 5, mid: 7, max: 9 },
  colorSmall: { min: 5, mid: 6, max: 8 },
  selectedBadge: { min: 8, mid: 10, max: 12 },
  headerTitle: { min: 12, mid: 14, max: 18 },
  emptyState: { min: 11, mid: 13, max: 15 },
  emptyStateSmall: { min: 9, mid: 11, max: 13 },
}

// ============================================================================
// VIBE GALLERY CARD DATA
// ============================================================================
export interface VibeCardData {
  id: string
  name: string
  /**
   * Hero image path, or null when the CD hasn't selected one yet.
   * The card renders a gradient placeholder (using the vibe's colors) for
   * null. Previously this was a non-nullable string backed by a 6-strategy
   * fallback chain; that's been removed — agents couldn't tell real signal
   * from facade. One source of truth now: the CD sets heroImage or it's null.
   */
  heroImage: string | null
  whoItsFor: string           // Target audience description (displayed on image)
  mood: string                // Mood/feeling description (displayed below image)
  colors: string[]            // 4 hex color codes [primary, secondary, accent, text]
  fonts: {
    heading: string           // e.g., "Playfair Display"
    body: string              // e.g., "Inter"
  }
  filename?: string           // HTML filename for deletion (e.g., "vibe-1-grandmas-cliff.html")
}

// ============================================================================
// RESPONSIVE SIZE CALCULATOR
// Interpolates between min/mid/max based on container width
// ============================================================================
function getResponsiveSize(
  containerWidth: number,
  sizes: { min: number; mid: number; max: number }
): number {
  const MIN_WIDTH = 320
  const MID_WIDTH = 480
  const MAX_WIDTH = 640

  if (containerWidth <= MIN_WIDTH) return sizes.min
  if (containerWidth >= MAX_WIDTH) return sizes.max

  // Linear interpolation
  if (containerWidth <= MID_WIDTH) {
    // Between min and mid
    const ratio = (containerWidth - MIN_WIDTH) / (MID_WIDTH - MIN_WIDTH)
    return sizes.min + (sizes.mid - sizes.min) * ratio
  } else {
    // Between mid and max
    const ratio = (containerWidth - MID_WIDTH) / (MAX_WIDTH - MID_WIDTH)
    return sizes.mid + (sizes.max - sizes.mid) * ratio
  }
}

// ============================================================================
// GOOGLE FONTS LOADER
// ============================================================================
const loadedFonts = new Set<string>()

function loadGoogleFont(fontName: string) {
  if (loadedFonts.has(fontName)) return
  loadedFonts.add(fontName)

  // Create link element for Google Fonts
  const link = document.createElement('link')
  link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/\s+/g, '+')}:wght@400;600;700&display=swap`
  link.rel = 'stylesheet'
  document.head.appendChild(link)
}

// ============================================================================
// VIBE GALLERY CARD COMPONENT
// ============================================================================
interface VibeCardProps {
  vibe: VibeCardData
  isSelected: boolean
  onSelect: (id: string) => void
  onDelete?: (filename: string) => void
  containerWidth: number  // For responsive sizing
}

const VibeCard = memo(function VibeCard({ vibe, isSelected, onSelect, onDelete, containerWidth }: VibeCardProps) {
  // Load fonts when card mounts
  useEffect(() => {
    if (vibe.fonts.heading) loadGoogleFont(vibe.fonts.heading)
    if (vibe.fonts.body) loadGoogleFont(vibe.fonts.body)
  }, [vibe.fonts.heading, vibe.fonts.body])

  // Calculate responsive font sizes
  const fontSize = {
    vibeName: getResponsiveSize(containerWidth, FONT_SIZES.vibeName),
    vibeNameLabel: getResponsiveSize(containerWidth, FONT_SIZES.vibeNameLabel),
    whoItsFor: getResponsiveSize(containerWidth, FONT_SIZES.whoItsFor),
    whoItsForLabel: getResponsiveSize(containerWidth, FONT_SIZES.whoItsForLabel),
    moodLabel: getResponsiveSize(containerWidth, FONT_SIZES.moodLabel),
    moodValue: getResponsiveSize(containerWidth, FONT_SIZES.moodValue),
    colorPrimary: getResponsiveSize(containerWidth, FONT_SIZES.colorPrimary),
    colorSecondary: getResponsiveSize(containerWidth, FONT_SIZES.colorSecondary),
    colorSmall: getResponsiveSize(containerWidth, FONT_SIZES.colorSmall),
    selectedBadge: getResponsiveSize(containerWidth, FONT_SIZES.selectedBadge),
  }

  // Debug: Log font sizes when container width changes
  console.log(`[VibeCard ${vibe.name}] containerWidth=${containerWidth}, vibeName fontSize=${fontSize.vibeName}px`)

  return (
    <div
      className="vibe-card-wrapper"
      onClick={() => onSelect(vibe.id)}
      style={{
        position: 'relative',
        backgroundColor: 'var(--bg-card)',
        borderRadius: '12px',
        overflow: 'hidden',
        cursor: 'pointer',
        border: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'border-color 0.2s ease',
      }}
    >
      {/* Delete button - upper right, visible on hover */}
      {onDelete && vibe.filename && (
        <button
          className="vibe-card-delete"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(vibe.filename!)
          }}
          title={`Delete ${vibe.name}`}
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            backgroundColor: '#dc2626',
            color: 'white',
            border: '2px solid rgba(255,255,255,0.5)',
            cursor: 'pointer',
            fontSize: '14px',
            lineHeight: '1',
            textAlign: 'center',
            padding: 0,
            opacity: 0,
            transition: 'opacity 0.15s',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
          }}
        >
          ✕
        </button>
      )}

      {/* Hero area — renders the CD-chosen image when set; otherwise a
          gradient placeholder using the vibe's own palette so the card
          reads as "this vibe exists, hero not yet assigned" rather than
          showing a random arbitrary image or a broken-image icon. */}
      <div style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16/9',
        overflow: 'hidden',
      }}>
        {vibe.heroImage ? (
          <img
            src={vibe.heroImage}
            alt={vibe.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: `linear-gradient(135deg, ${vibe.colors[0] || '#1C1C1E'} 0%, ${vibe.colors[2] || vibe.colors[1] || '#3a3a3c'} 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: vibe.colors[3] || '#ffffff',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              opacity: 0.7,
            }}
          >
            No hero image yet
          </div>
        )}
        {/* Dark gradient overlay for text readability */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.15) 100%)',
        }} />

        {/* Selection indicator - top LEFT */}
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          padding: isSelected ? '6px 12px' : '0',
          minWidth: isSelected ? 'auto' : '24px',
          height: '24px',
          borderRadius: '12px',
          backgroundColor: isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.2)',
          border: isSelected ? 'none' : '2px solid rgba(255,255,255,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          transition: 'all 0.2s ease',
        }}>
          {isSelected && (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span style={{ fontSize: `${fontSize.selectedBadge}px`, fontWeight: 600, color: 'white' }}>Selected</span>
            </>
          )}
        </div>

        {/* ALL TEXT LEFT-ALIGNED - Vibe Name (heading font) + Who It's For (body font) */}
        <div style={{
          position: 'absolute',
          bottom: '12px',
          left: '12px',
          right: '12px',
        }}>
          {/* Vibe Name — rendered in heading font */}
          <div style={{
            fontSize: `${fontSize.vibeName}px`,
            fontWeight: 700,
            fontFamily: vibe.fonts.heading ? `"${vibe.fonts.heading}", serif` : 'serif',
            color: '#FFFFFF',
            textShadow: '0 2px 6px rgba(0,0,0,0.6)',
            marginBottom: '2px',
          }}>
            {vibe.name}
            <span style={{
              fontSize: `${fontSize.vibeNameLabel}px`,
              fontWeight: 400,
              color: 'rgba(255,255,255,0.6)',
              marginLeft: '8px',
            }}>
              ({vibe.fonts.heading})
            </span>
          </div>

          {/* Who It's For — rendered in body font */}
          <div style={{
            fontSize: `${fontSize.whoItsFor}px`,
            fontFamily: vibe.fonts.body ? `"${vibe.fonts.body}", sans-serif` : 'sans-serif',
            color: 'rgba(255,255,255,0.9)',
            textShadow: '0 1px 4px rgba(0,0,0,0.5)',
            lineHeight: 1.4,
          }}>
            {vibe.whoItsFor}
            <span style={{
              fontSize: `${fontSize.whoItsForLabel}px`,
              color: 'rgba(255,255,255,0.5)',
              marginLeft: '6px',
            }}>
              ({vibe.fonts.body})
            </span>
          </div>
        </div>
      </div>

      {/* Mood - single line, label left, value right */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{
          fontSize: `${fontSize.moodLabel}px`,
          fontWeight: 500,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Mood
        </span>
        <span style={{
          fontSize: `${fontSize.moodValue}px`,
          color: 'var(--text-secondary)',
          fontStyle: 'italic',
        }}>
          {vibe.mood}
        </span>
      </div>

      {/* Colors - Bento Grid Style */}
      <div style={{
        padding: '10px',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: 'auto auto',
          gap: '4px',
          borderRadius: '8px',
          overflow: 'hidden',
        }}>
          {/* Primary - larger, spans both columns on top or takes more space */}
          <div
            title={`Primary: ${vibe.colors[0]?.toUpperCase() || '#000'}`}
            style={{
              gridColumn: '1 / 2',
              gridRow: '1 / 3',
              backgroundColor: vibe.colors[0] || '#1C1C1E',
              borderRadius: '8px',
              minHeight: '64px',
              display: 'flex',
              alignItems: 'flex-end',
              padding: '6px',
            }}
          >
            <span style={{
              fontSize: `${fontSize.colorPrimary}px`,
              color: 'rgba(255,255,255,0.7)',
              fontFamily: 'monospace',
              textTransform: 'uppercase',
              textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            }}>
              {vibe.colors[0] || '#1C1C1E'}
            </span>
          </div>
          {/* Secondary */}
          <div
            title={`Secondary: ${vibe.colors[1]?.toUpperCase() || '#F5F5F5'}`}
            style={{
              backgroundColor: vibe.colors[1] || '#F5F5F5',
              borderRadius: '8px',
              minHeight: '30px',
              display: 'flex',
              alignItems: 'flex-end',
              padding: '4px',
            }}
          >
            <span style={{
              fontSize: `${fontSize.colorSecondary}px`,
              color: 'rgba(0,0,0,0.5)',
              fontFamily: 'monospace',
              textTransform: 'uppercase',
            }}>
              {vibe.colors[1] || '#F5F5F5'}
            </span>
          </div>
          {/* Accent + Text in bottom right */}
          <div style={{
            display: 'flex',
            gap: '4px',
          }}>
            <div
              title={`Accent: ${vibe.colors[2]?.toUpperCase() || '#C76B00'}`}
              style={{
                flex: 1,
                backgroundColor: vibe.colors[2] || '#C76B00',
                borderRadius: '8px',
                minHeight: '30px',
                display: 'flex',
                alignItems: 'flex-end',
                padding: '4px',
              }}
            >
              <span style={{
                fontSize: `${fontSize.colorSmall}px`,
                color: 'rgba(255,255,255,0.8)',
                fontFamily: 'monospace',
                textTransform: 'uppercase',
              }}>
                {vibe.colors[2] || '#C76B00'}
              </span>
            </div>
            <div
              title={`Text: ${vibe.colors[3]?.toUpperCase() || '#1A1A1A'}`}
              style={{
                flex: 1,
                backgroundColor: vibe.colors[3] || '#1A1A1A',
                borderRadius: '8px',
                minHeight: '30px',
                display: 'flex',
                alignItems: 'flex-end',
                padding: '4px',
              }}
            >
              <span style={{
                fontSize: `${fontSize.colorSmall}px`,
                color: 'rgba(255,255,255,0.6)',
                fontFamily: 'monospace',
                textTransform: 'uppercase',
              }}>
                {vibe.colors[3] || '#1A1A1A'}
              </span>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
})

// ============================================================================
// VIBES GALLERY COMPONENT
// ============================================================================
interface VibesGalleryProps {
  vibes: VibeCardData[]
  selectedVibeId: string | null
  onVibeSelect: (id: string) => void
  onVibeDelete?: (filename: string) => void
  title?: string
}

export function VibesGallery({
  vibes,
  selectedVibeId,
  onVibeSelect,
  onVibeDelete,
  title = 'Vibes'
}: VibesGalleryProps) {
  // Inject hover CSS for delete buttons
  useEffect(() => {
    const styleId = 'vibe-card-hover-styles'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        .vibe-card-wrapper:hover .vibe-card-delete { opacity: 1 !important; }
      `
      document.head.appendChild(style)
    }
  }, [])

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(400) // Default middle value

  // Track container width for responsive sizing
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newWidth = entry.contentRect.width
        console.log('[VibesGallery] Container width changed:', newWidth)
        setContainerWidth(newWidth)
      }
    })

    resizeObserver.observe(container)
    // Initial measurement
    setContainerWidth(container.offsetWidth)

    return () => resizeObserver.disconnect()
  }, [])

  // Calculate responsive font sizes for header/empty state
  const headerFontSize = getResponsiveSize(containerWidth, FONT_SIZES.headerTitle)
  const emptyStateFontSize = getResponsiveSize(containerWidth, FONT_SIZES.emptyState)
  const emptyStateSmallFontSize = getResponsiveSize(containerWidth, FONT_SIZES.emptyStateSmall)

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header — bento header doctrine 2026-05-06: 12px JetBrains Mono
          UPPERCASE 700, 0.16em tracking, Feather icon prefix. */}
      {title && (
        <div style={{
          padding: '16px',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          <h2 style={{
            fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
            fontSize: '12px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.16em',
            color: 'var(--text-main)',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            {/* Feather grid icon — vibes are a gallery of variants. Same
                icon family + accent stroke as Briefing / Image Prompts. */}
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #3B82F6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
            {title}
          </h2>
        </div>
      )}

      {/* Gallery List - Vertical scrollable */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '16px',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}>
          {vibes.map((vibe) => (
            <VibeCard
              key={vibe.id}
              vibe={vibe}
              isSelected={selectedVibeId === vibe.id}
              onSelect={onVibeSelect}
              onDelete={onVibeDelete}
              containerWidth={containerWidth}
            />
          ))}
        </div>

        {vibes.length === 0 && (
          <div style={{
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: `${emptyStateFontSize}px`,
            padding: '48px 20px',
          }}>
            <div style={{
              fontSize: '32px',
              marginBottom: '12px',
              opacity: 0.5,
            }}>
              🎨
            </div>
            <div style={{ marginBottom: '6px', fontWeight: 500 }}>
              No vibes yet
            </div>
            <div style={{ fontSize: `${emptyStateSmallFontSize}px`, opacity: 0.7 }}>
              Generate vibes to see them here
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
