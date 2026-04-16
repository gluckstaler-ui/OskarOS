'use client'

import { useState, useRef, useEffect, memo } from 'react'
import { SourceImage, ImageAsset, ImageManifest, ImageQueueItem, LayoutMode } from '@/lib/types'
import { getImageEntriesAction } from '@/lib/session-actions'

// ============================================================================
// DEBOUNCED TEXTAREA - Prevents re-renders on every keystroke
// Uses local state, syncs to parent on blur
// ============================================================================
interface DebouncedTextareaProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  style?: React.CSSProperties
  onClick?: (e: React.MouseEvent) => void
}

const DebouncedTextarea = memo(function DebouncedTextarea({
  value,
  onChange,
  placeholder,
  style,
  onClick
}: DebouncedTextareaProps) {
  const [localValue, setLocalValue] = useState(value)
  const isInitialMount = useRef(true)

  // Sync from parent when value prop changes (but not on mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    setLocalValue(value)
  }, [value])

  return (
    <textarea
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={() => {
        if (localValue !== value) {
          onChange(localValue)
        }
      }}
      onClick={onClick}
      style={style}
      placeholder={placeholder}
    />
  )
})

// ============================================================================
// ASSETS PANEL - UPLOADS → IMAGE LIBRARY → REPROMPTS
// ============================================================================

interface AssetsPanelProps {
  sessionId: string  // Required for reading IMAGES.md
  sourceImages: SourceImage[]
  imageManifests: ImageManifest[]
  imageQueue: ImageQueueItem[]
  onUpload: (file: File) => void
  onAssetSelect: (asset: ImageAsset) => void
  onAssetGenerate: (asset: ImageAsset) => void
  onAssetUpdate?: (asset: ImageAsset) => void
  onAssetDismiss?: (asset: ImageAsset) => void  // Dismiss/remove an asset from manifests
  onApproveImage: (itemId: string) => void
  onSkipImage: (itemId: string) => void
  onSubmitImages: () => void
  onSourceImageEdit?: (sourceImage: SourceImage, instruction: string, operation: 'edit' | 'generate') => void
  onSourceImageCompose?: (baseImage: SourceImage, extractImage: SourceImage, instruction: string) => void
  onSourceImageUpdate?: (sourceImage: SourceImage) => void
  onSourceImageDelete?: (sourceImage: SourceImage) => void
  selectedAssetId?: string
  layoutMode: LayoutMode
}

// Operation types parsed from prompt keywords
type PromptOperation = 'EDIT' | 'COMPOSE' | 'GENERATE'

// Parse operation from prompt text
function parseOperation(prompt: string): PromptOperation {
  const upper = prompt.toUpperCase().trim()
  if (upper.startsWith('EDIT') || upper.includes('EDIT:')) return 'EDIT'
  if (upper.startsWith('COMPOSE') || upper.includes('COMPOSE:')) return 'COMPOSE'
  return 'GENERATE'
}

// Parse source files from prompt (for EDIT/COMPOSE)
function parseSourceFiles(prompt: string): string[] {
  const filePattern = /[\w-]+\.(jpg|jpeg|png|webp)/gi
  const matches = prompt.match(filePattern)
  return matches || []
}

// ============================================================================
// BENTO TILE - Image with hover overlay for controls
// ============================================================================
interface BentoTileProps {
  image: SourceImage
  prompt: string
  originalPrompt: string  // Original prompt from CD agent to detect modifications
  isHovered: boolean
  onHover: (hovered: boolean) => void
  onPromptChange: (text: string) => void
  onEdit: () => void
  onDelete: () => void
  onFullscreen?: () => void  // Open fullscreen modal
  allImages: SourceImage[]  // All available images for compose selection
}

function BentoTile({
  image,
  prompt,
  originalPrompt,
  isHovered,
  onHover,
  onPromptChange,
  onEdit,
  onDelete,
  onFullscreen,
  allImages
}: BentoTileProps) {
  // Check if prompt has been modified from original
  const isModified = prompt !== originalPrompt
  const [showComposeDropdown, setShowComposeDropdown] = useState(false)
  const [selectedComposeImages, setSelectedComposeImages] = useState<Set<string>>(new Set())

  // Get clean filename without timestamp prefix
  const cleanFilename = (filename: string) => filename.replace(/^\d+-/, '')

  // Handle compose image selection - immediately updates prompt
  const handleComposeSelect = (selectedImg: SourceImage) => {
    const newSelected = new Set(selectedComposeImages)
    if (newSelected.has(selectedImg.id)) {
      newSelected.delete(selectedImg.id)
    } else {
      newSelected.add(selectedImg.id)
    }
    setSelectedComposeImages(newSelected)

    // Immediately update prompt with COMPOSE at the BEGINNING
    if (newSelected.size > 0) {
      const selectedFilenames = allImages
        .filter(img => newSelected.has(img.id))
        .map(img => cleanFilename(img.filename))
      const composeText = `COMPOSE [${selectedFilenames.join(' + ')}]: `

      // Remove any existing COMPOSE prefix first
      const cleanedPrompt = prompt.replace(/^COMPOSE\s*\[[^\]]*\]\s*:\s*/i, '')
      // PREPEND compose text to existing prompt
      const newPrompt = composeText + cleanedPrompt
      onPromptChange(newPrompt)
    } else {
      // If no images selected, remove COMPOSE prefix
      const cleanedPrompt = prompt.replace(/^COMPOSE\s*\[[^\]]*\]\s*:\s*/i, '')
      onPromptChange(cleanedPrompt)
    }
  }

  // Show ALL images in dropdown (including current image)
  const composeOptions = allImages

  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => {
        if (!showComposeDropdown) onHover(false)
      }}
      style={{
        position: 'relative',
        aspectRatio: '1',
        borderRadius: '12px',
        overflow: 'visible',  // Allow dropdown to overflow
        cursor: 'pointer',
        height: '100%'
      }}
    >
      {/* Image */}
      {(() => {
        // Parse operation from prompt for badges
        // Image Library cards are always for EXISTING images, so default is EDIT (blue)
        // GENERATE (green) is only for the GenerateTile (new images from scratch)
        const upperPrompt = prompt.toUpperCase().trim()
        const isCompose = upperPrompt.startsWith('COMPOSE')
        // For existing images: COMPOSE or EDIT (default) - never GENERATE
        const operation = isCompose ? 'COMPOSE' : 'EDIT'
        const operationColor = isCompose ? '#8B5CF6' : '#3B82F6'

        return (
          <div style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: '12px',
            overflow: 'hidden'
          }}>
            <img
              src={image.path}
              alt={image.filename}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transition: 'transform 0.2s',
                transform: isHovered ? 'scale(1.02)' : 'scale(1)'
              }}
            />

            {/* Always-visible operation tag (top-left) - always shows EDIT or COMPOSE */}
            {!isHovered && (
              <div style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                padding: '3px 6px',
                backgroundColor: operationColor,
                borderRadius: '4px',
                fontSize: '8px',
                fontWeight: 700,
                color: 'white',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                {operation}
              </div>
            )}

            {/* Always-visible tag badge (bottom-right) */}
            {!isHovered && (() => {
              // Tag display logic based on IMAGES.md Status field:
              // HERO → Green tag | INGESTED/APPROVED → Green checkmark | B-ROLL → Gray tag | TRASH/REDO → Red tag
              const displayTag = image.tag

              // INGESTED and APPROVED show as green checkmarks, not tag badges
              if (displayTag === 'INGESTED' || displayTag === 'APPROVED') {
                return (
                  <div style={{
                    position: 'absolute',
                    bottom: '8px',
                    right: '8px',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    backgroundColor: '#10B981',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                )
              }

              // Other tags show as colored badges (INGESTED/APPROVED already handled above)
              if (displayTag) {
                return (
                  <div style={{
                    position: 'absolute',
                    bottom: '8px',
                    right: '8px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '7px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    color: 'white',
                    backgroundColor: displayTag === 'HERO' ? '#10B981' :
                      displayTag === 'READY' ? '#10B981' :
                      displayTag === 'TRASH' ? '#EF4444' :
                      displayTag === 'REDO' ? '#EF4444' :
                      '#6B7280'  // B-ROLL and others are gray
                  }}>
                    {displayTag}
                  </div>
                )
              }

              // No tag - show nothing or subtle indicator for images with prompts
              if (prompt.trim()) {
                return (
                  <div style={{
                    position: 'absolute',
                    bottom: '8px',
                    right: '8px',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    backgroundColor: isModified ? '#F59E0B' : 'rgba(255,255,255,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }} />
                )
              }

              return null
            })()}

        {/* Hover overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.85)',
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.2s',
          display: 'flex',
          flexDirection: 'column',
          padding: '12px',
          pointerEvents: isHovered ? 'auto' : 'none'
        }}>
          {/* Header: Filename + Maximize + Delete buttons */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px'
          }}>
            <div style={{
              fontSize: '10px',
              fontWeight: 600,
              color: 'white',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1
            }}>
              {cleanFilename(image.filename)}
            </div>
            <div style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
              {/* Fullscreen button */}
              {onFullscreen && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onFullscreen()
                  }}
                  style={{
                    width: '24px',
                    height: '24px',
                    padding: 0,
                    border: 'none',
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <polyline points="15 3 21 3 21 9"/>
                    <polyline points="9 21 3 21 3 15"/>
                    <line x1="21" y1="3" x2="14" y2="10"/>
                    <line x1="3" y1="21" x2="10" y2="14"/>
                  </svg>
                </button>
              )}
              {/* Delete button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
                style={{
                  width: '24px',
                  height: '24px',
                  padding: 0,
                  border: 'none',
                  backgroundColor: 'rgba(239, 68, 68, 0.8)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Prompt textarea */}
          <DebouncedTextarea
            value={prompt}
            onChange={onPromptChange}
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              width: '100%',
              padding: '8px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'white',
              backgroundColor: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '6px',
              resize: 'none',
              outline: 'none',
              lineHeight: 1.4
            }}
            placeholder="Enter reprompt..."
          />

          {/* Buttons */}
          {(() => {
            // Parse operation from prompt
            // Image Library = existing images, so only COMPOSE or EDIT (default)
            const upperPrompt = prompt.toUpperCase().trim()
            const isCompose = upperPrompt.startsWith('COMPOSE')

            // Colors and icons: COMPOSE (purple) or EDIT (blue) - no GENERATE for existing images
            const generateColor = isCompose ? '#8B5CF6' : '#3B82F6'
            const generateIcon = isCompose ? (
              // Compose icon - layers/stack
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="8" y="8" width="12" height="12" rx="2"/>
                <path d="M4 16V6a2 2 0 0 1 2-2h10"/>
              </svg>
            ) : (
              // Edit icon - pencil (default for existing images)
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>
              </svg>
            )

            return (
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowComposeDropdown(!showComposeDropdown)
                  }}
                  style={{
                    flex: 1,
                    padding: '8px',
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    backgroundColor: showComposeDropdown ? '#D97706' : '#F59E0B',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Images
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  style={{
                    flex: 1,
                    padding: '8px',
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    backgroundColor: generateColor,
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '4px'
                  }}
                >
                  {generateIcon}
                  Generate
                </button>
              </div>
            )
          })()}
        </div>
      </div>
        )
      })()}

      {/* Compose Dropdown - positioned below the tile */}
      {showComposeDropdown && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            width: '280px',
            marginTop: '4px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: '8px',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
          }}
        >
          <div style={{
            padding: '8px 10px',
            borderBottom: '1px solid var(--border-card)',
            fontSize: '9px',
            fontWeight: 700,
            textTransform: 'uppercase',
            color: 'var(--text-muted)'
          }}>
            Select images to compose:
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '8px',
            padding: '10px'
          }}>
            {composeOptions.map((opt) => {
              const isSelected = selectedComposeImages.has(opt.id)
              return (
                <div
                  key={opt.id}
                  onClick={() => handleComposeSelect(opt)}
                  style={{
                    position: 'relative',
                    width: '120px',
                    height: '120px',
                    cursor: 'pointer',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: isSelected ? '3px solid #F59E0B' : '3px solid transparent'
                  }}
                >
                  <img
                    src={opt.path}
                    alt={opt.filename}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />
                  {/* Checkmark overlay when selected */}
                  {isSelected && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundColor: 'rgba(245, 158, 11, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: '#F59E0B',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </div>
                    </div>
                  )}
                  {/* Filename label */}
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: '4px 6px',
                    backgroundColor: 'rgba(0,0,0,0.75)',
                    fontSize: '9px',
                    color: 'white',
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {cleanFilename(opt.filename)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// GENERATE TILE - Empty tile for creating new images from scratch
// ============================================================================
interface GenerateTileProps {
  isHovered: boolean
  onHover: (hovered: boolean) => void
  prompt: string
  onPromptChange: (text: string) => void
  onGenerate: () => void
}

function GenerateTile({
  isHovered,
  onHover,
  prompt,
  onPromptChange,
  onGenerate
}: GenerateTileProps) {
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        position: 'relative',
        aspectRatio: '1',
        borderRadius: '12px',
        border: '2px dashed var(--border-card)',
        backgroundColor: isHovered ? 'var(--bg-card)' : 'var(--bg-app)',
        transition: 'background-color 0.2s',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        overflow: 'hidden'
      }}
    >
      {!isHovered ? (
        /* Default state - plus icon */
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          color: 'var(--text-muted)'
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          <span style={{ fontSize: '11px', fontWeight: 600 }}>Generate</span>
        </div>
      ) : (
        /* Hover state - prompt input */
        <div style={{
          width: '100%',
          height: '100%',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{
            fontSize: '10px',
            fontWeight: 600,
            color: 'var(--text-main)',
            marginBottom: '8px'
          }}>
            New Image
          </div>

          <DebouncedTextarea
            value={prompt}
            onChange={onPromptChange}
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              width: '100%',
              padding: '8px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-main)',
              backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-card)',
              borderRadius: '6px',
              resize: 'none',
              outline: 'none',
              lineHeight: 1.4
            }}
            placeholder="Describe the image..."
          />

          <button
            onClick={(e) => { e.stopPropagation(); onGenerate(); }}
            disabled={!prompt.trim()}
            style={{
              marginTop: '8px',
              padding: '10px',
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              backgroundColor: prompt.trim() ? '#10B981' : 'var(--text-dim)',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: prompt.trim() ? 'pointer' : 'not-allowed',
              opacity: prompt.trim() ? 1 : 0.5
            }}
          >
            Generate
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// REPROMPT CARD - Card with image tile (hover for prompt) + permanent buttons
// For GENERATE (no source): prompt is permanently visible until generated
// ============================================================================
interface RepromptCardProps {
  asset: ImageAsset
  prompt: string
  originalPrompt: string
  operation: PromptOperation
  sourceSrc?: string  // Source image for EDIT/COMPOSE
  sourceFilename?: string
  isHovered: boolean
  onHover: (hovered: boolean) => void
  onPromptChange: (text: string) => void
  onGenerate: () => void
  onDismiss?: () => void  // Dismiss this suggestion
  onFullscreen?: () => void  // Open fullscreen modal
  onAddImages?: () => void  // Open image selector
  showAddImagesDropdown?: boolean
  allImages?: SourceImage[]
  selectedImageIds?: Set<string>
  onToggleImage?: (imgId: string) => void
}

function RepromptCard({
  asset,
  prompt,
  originalPrompt,
  operation,
  sourceSrc,
  sourceFilename,
  isHovered,
  onHover,
  onPromptChange,
  onGenerate,
  onDismiss,
  onFullscreen,
  onAddImages,
  showAddImagesDropdown,
  allImages,
  selectedImageIds,
  onToggleImage
}: RepromptCardProps) {
  const isModified = prompt !== originalPrompt
  const cleanFilename = (filename: string) => filename.replace(/^\d+-/, '')

  // Check if this is a GENERATE with no image yet
  const isNewGenerate = operation === 'GENERATE' && asset.status !== 'complete'

  // Operation colors for the tag (top-left)
  const operationColor = operation === 'EDIT' ? '#3B82F6' :
    operation === 'COMPOSE' ? '#8B5CF6' : '#10B981'

  // Button color (always by operation type)
  const buttonColor = operation === 'EDIT' ? '#3B82F6' :
    operation === 'COMPOSE' ? '#8B5CF6' : '#10B981'

  // Status color for bottom-right badge - PENDING is RED
  const statusColor = asset.status === 'complete' ? '#10B981' :
    asset.status === 'generating' ? '#F59E0B' :
    asset.status === 'pending' ? '#EF4444' : 'rgba(255,255,255,0.3)'

  // Operation icons
  const operationIcon = operation === 'EDIT' ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>
    </svg>
  ) : operation === 'COMPOSE' ? (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="8" width="12" height="12" rx="2"/>
      <path d="M4 16V6a2 2 0 0 1 2-2h10"/>
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    </svg>
  )

  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => {
        if (!showAddImagesDropdown) onHover(false)
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        overflow: 'visible',
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        height: '100%'
      }}
    >
      {/* IMAGE TILE - with hover overlay for prompt (like BentoTile) */}
      <div style={{
        position: 'relative',
        aspectRatio: '1',
        borderRadius: '12px 12px 0 0',
        overflow: 'hidden'
      }}>
        {/* For EDIT/COMPOSE: show source image, For GENERATE: show placeholder with permanent prompt */}
        {(operation === 'EDIT' || operation === 'COMPOSE') && sourceSrc ? (
          <>
            <img
              src={sourceSrc}
              alt={sourceFilename || 'Source'}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transition: 'transform 0.2s',
                transform: isHovered ? 'scale(1.02)' : 'scale(1)'
              }}
            />
            {/* Always-visible elements when NOT hovered */}
            {!isHovered && (
              <>
                {/* Operation tag (top-left) */}
                <div style={{
                  position: 'absolute',
                  top: '8px',
                  left: '8px',
                  padding: '3px 6px',
                  backgroundColor: operationColor,
                  borderRadius: '4px',
                  fontSize: '8px',
                  fontWeight: 700,
                  color: 'white',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  {operation}
                </div>
                {/* Status badge (bottom-right) - RED for PENDING */}
                <div style={{
                  position: 'absolute',
                  bottom: '8px',
                  right: '8px',
                  padding: '2px 6px',
                  backgroundColor: statusColor,
                  borderRadius: '4px',
                  fontSize: '7px',
                  fontWeight: 700,
                  color: 'white',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  {asset.status === 'pending' ? 'PENDING' : asset.status}
                </div>
              </>
            )}
          </>
        ) : (
          /* GENERATE placeholder - prompt always visible, hover changes header */
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: isHovered ? 'rgba(0,0,0,0.85)' : 'var(--bg-app)',
            padding: '12px',
            transition: 'background-color 0.2s'
          }}>
            {/* Header row */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px'
            }}>
              {/* Non-hover: GENERATE tag + PENDING, Hover: Slot name + buttons */}
              {!isHovered ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{
                    padding: '3px 6px',
                    backgroundColor: operationColor,
                    borderRadius: '4px',
                    fontSize: '8px',
                    fontWeight: 700,
                    color: 'white',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    GENERATE
                  </div>
                  {/* PENDING badge next to GENERATE - same size */}
                  {asset.status === 'pending' && (
                    <div style={{
                      padding: '3px 6px',
                      backgroundColor: statusColor,
                      borderRadius: '4px',
                      fontSize: '8px',
                      fontWeight: 700,
                      color: 'white',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      PENDING
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    color: 'white',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1
                  }}>
                    {asset.slot || asset.id}
                  </div>
                  {/* Top-right buttons: Fullscreen + Dismiss - only on hover */}
                  <div style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
                    {/* Fullscreen button - only when image is complete */}
                    {asset.status === 'complete' && asset.generatedUrl && onFullscreen && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onFullscreen()
                        }}
                        style={{
                          width: '20px',
                          height: '20px',
                          padding: 0,
                          border: 'none',
                          backgroundColor: 'rgba(255,255,255,0.2)',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                          <polyline points="15 3 21 3 21 9"/>
                          <polyline points="9 21 3 21 3 15"/>
                          <line x1="21" y1="3" x2="14" y2="10"/>
                          <line x1="3" y1="21" x2="10" y2="14"/>
                        </svg>
                      </button>
                    )}
                    {/* Dismiss button */}
                    {onDismiss && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDismiss()
                        }}
                        style={{
                          width: '20px',
                          height: '20px',
                          padding: 0,
                          border: 'none',
                          backgroundColor: 'rgba(239, 68, 68, 0.8)',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Prompt textarea - ALWAYS VISIBLE */}
            <DebouncedTextarea
              value={prompt}
              onChange={onPromptChange}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                width: '100%',
                padding: '8px',
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                color: isHovered ? 'white' : 'var(--text-main)',
                backgroundColor: isHovered ? 'rgba(255,255,255,0.1)' : 'var(--bg-card)',
                border: isHovered ? '1px solid rgba(255,255,255,0.2)' : '1px solid var(--border-card)',
                borderRadius: '6px',
                resize: 'none',
                outline: 'none',
                lineHeight: 1.4,
                transition: 'background-color 0.2s, border-color 0.2s, color 0.2s'
              }}
              placeholder="Describe the image..."
            />
          </div>
        )}

        {/* HOVER OVERLAY - prompt textarea (like BentoTile) - only for EDIT/COMPOSE */}
        {(operation === 'EDIT' || operation === 'COMPOSE') && (
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 0.2s',
            display: 'flex',
            flexDirection: 'column',
            padding: '12px',
            pointerEvents: isHovered ? 'auto' : 'none'
          }}>
            {/* Header: Slot name + Maximize + Dismiss */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px'
            }}>
              <div style={{
                fontSize: '10px',
                fontWeight: 600,
                color: 'white',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1
              }}>
                {asset.slot || asset.id}
              </div>
              <div style={{ display: 'flex', gap: '4px', marginLeft: '8px' }}>
                {/* Fullscreen button - only when image is complete */}
                {asset.status === 'complete' && asset.generatedUrl && onFullscreen && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onFullscreen()
                    }}
                    style={{
                      width: '20px',
                      height: '20px',
                      padding: 0,
                      border: 'none',
                      backgroundColor: 'rgba(255,255,255,0.2)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                      <polyline points="15 3 21 3 21 9"/>
                      <polyline points="9 21 3 21 3 15"/>
                      <line x1="21" y1="3" x2="14" y2="10"/>
                      <line x1="3" y1="21" x2="10" y2="14"/>
                    </svg>
                  </button>
                )}
                {/* Dismiss button */}
                {onDismiss && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDismiss()
                    }}
                    style={{
                      width: '20px',
                      height: '20px',
                      padding: 0,
                      border: 'none',
                      backgroundColor: 'rgba(239, 68, 68, 0.8)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Prompt textarea */}
            <DebouncedTextarea
              value={prompt}
              onChange={onPromptChange}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                width: '100%',
                padding: '8px',
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                color: 'white',
                backgroundColor: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '6px',
                resize: 'none',
                outline: 'none',
                lineHeight: 1.4
              }}
              placeholder="Enter prompt..."
            />
          </div>
        )}

        {/* Generated image overlay when complete - hides on hover to show prompt */}
        {asset.status === 'complete' && asset.generatedUrl && (
          <div style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: isHovered ? 'none' : 'auto',
            opacity: isHovered ? 0 : 1,
            transition: 'opacity 0.2s'
          }}>
            <img
              src={asset.generatedUrl}
              alt="Generated"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />
            {/* Operation tag (top-left) */}
            <div style={{
              position: 'absolute',
              top: '8px',
              left: '8px',
              padding: '3px 6px',
              backgroundColor: operationColor,
              borderRadius: '4px',
              fontSize: '8px',
              fontWeight: 700,
              color: 'white',
              textTransform: 'uppercase'
            }}>
              {operation}
            </div>
            {/* Status badge (bottom-right) */}
            <div style={{
              position: 'absolute',
              bottom: '8px',
              right: '8px',
              padding: '2px 6px',
              backgroundColor: '#10B981',
              borderRadius: '4px',
              fontSize: '7px',
              fontWeight: 700,
              color: 'white',
              textTransform: 'uppercase'
            }}>
              COMPLETE
            </div>
          </div>
        )}
      </div>

      {/* PERMANENT BUTTONS - always visible underneath */}
      <div style={{
        padding: '8px',
        display: 'flex',
        gap: '6px',
        borderTop: '1px solid var(--border-card)'
      }}>
        {/* Add Images button (for EDIT/COMPOSE) */}
        {(operation === 'EDIT' || operation === 'COMPOSE') && onAddImages && (
          <div style={{ position: 'relative', flex: 1 }}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAddImages()
              }}
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '9px',
                fontWeight: 700,
                textTransform: 'uppercase',
                backgroundColor: showAddImagesDropdown ? '#D97706' : '#F59E0B',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px'
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Images
            </button>

            {/* Dropdown for image selection */}
            {showAddImagesDropdown && allImages && onToggleImage && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  width: '280px',
                  marginBottom: '4px',
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-card)',
                  borderRadius: '8px',
                  zIndex: 1000,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
                }}
              >
                <div style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--border-card)',
                  fontSize: '9px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)'
                }}>
                  Select source images:
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '8px',
                  padding: '10px',
                  maxHeight: '280px',
                  overflowY: 'auto'
                }}>
                  {allImages.map((img) => {
                    const isSelected = selectedImageIds?.has(img.id)
                    return (
                      <div
                        key={img.id}
                        onClick={() => onToggleImage(img.id)}
                        style={{
                          position: 'relative',
                          width: '120px',
                          height: '120px',
                          cursor: 'pointer',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          border: isSelected ? `3px solid ${buttonColor}` : '3px solid transparent'
                        }}
                      >
                        <img
                          src={img.path}
                          alt={img.filename}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                        {isSelected && (
                          <div style={{
                            position: 'absolute',
                            inset: 0,
                            backgroundColor: `${buttonColor}40`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}>
                            <div style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '50%',
                              backgroundColor: buttonColor,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            </div>
                          </div>
                        )}
                        <div style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          padding: '4px 6px',
                          backgroundColor: 'rgba(0,0,0,0.75)',
                          fontSize: '9px',
                          color: 'white',
                          textAlign: 'center',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {cleanFilename(img.filename)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Generate button - outline style when complete (not urgent) */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onGenerate()
          }}
          disabled={asset.status === 'generating'}
          style={{
            flex: 1,
            padding: '8px',
            fontSize: '9px',
            fontWeight: 700,
            textTransform: 'uppercase',
            backgroundColor: asset.status === 'generating'
              ? 'var(--text-dim)'
              : asset.status === 'complete'
                ? 'transparent'
                : buttonColor,
            color: asset.status === 'complete' ? buttonColor : 'white',
            border: asset.status === 'complete' ? `1px solid ${buttonColor}` : 'none',
            borderRadius: '4px',
            cursor: asset.status === 'generating' ? 'not-allowed' : 'pointer',
            opacity: asset.status === 'generating' ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px'
          }}
        >
          {operationIcon}
          {asset.status === 'complete' || asset.status === 'error' ? 'Regenerate' : 'Generate'}
        </button>
      </div>
    </div>
  )
}

export function AssetsPanel({
  sessionId,
  sourceImages,
  imageManifests,
  imageQueue,
  onUpload,
  onAssetSelect,
  onAssetGenerate,
  onAssetUpdate,
  onAssetDismiss,
  onApproveImage,
  onSkipImage,
  onSubmitImages,
  onSourceImageEdit,
  onSourceImageCompose,
  onSourceImageUpdate,
  onSourceImageDelete,
  selectedAssetId,
  layoutMode
}: AssetsPanelProps) {
  const [expandedVibes, setExpandedVibes] = useState<Set<string>>(new Set())
  const [imageLibraryExpanded, setImageLibraryExpanded] = useState(true)
  const [hoveredTile, setHoveredTile] = useState<string | null>(null)
  const [newGeneratePrompt, setNewGeneratePrompt] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Track source images per reprompt card (for editing COMPOSE sources)
  const [repromptSources, setRepromptSources] = useState<Record<string, Set<string>>>({})
  const [repromptDropdownOpen, setRepromptDropdownOpen] = useState<string | null>(null)

  // Delete confirmation dialog state
  const [deleteConfirmImage, setDeleteConfirmImage] = useState<SourceImage | null>(null)
  const [deleteConfirmVibes, setDeleteConfirmVibes] = useState<string[]>([])
  const [isCheckingDelete, setIsCheckingDelete] = useState(false)


  // Fullscreen image modal state
  const [fullscreenImage, setFullscreenImage] = useState<{ url: string; title: string } | null>(null)

  // (Compose selection now handled inside BentoTile component)

  // Track edited prompts for Track 1 (evaluated images) and Track 2 (generation assets)
  const [editedPrompts, setEditedPrompts] = useState<Record<string, string>>({})
  const [editedAssetPrompts, setEditedAssetPrompts] = useState<Record<string, string>>({})

  // Handle delete - direct delete for pending uploads, confirm for analyzed/tagged images
  const handleDeleteImage = async (img: SourceImage) => {
    // For pending images (not yet analyzed and no tag), delete directly - no confirmation
    if (!img.analysis?.description && !img.tag) {
      onSourceImageDelete?.(img)
      return
    }

    // For analyzed or tagged images, show confirmation dialog
    setDeleteConfirmImage(img)
    setDeleteConfirmVibes([])

    // Check if used by vibes (for display purposes)
    if (sessionId) {
      setIsCheckingDelete(true)
      try {
        const result = await getImageEntriesAction(sessionId)
        if (result.success && result.entries) {
          const cleanFilename = img.filename.replace(/^\d+-/, '')
          const entry = result.entries[img.filename] || result.entries[cleanFilename]
          if (entry?.suggestedVibes && entry.suggestedVibes.length > 0) {
            setDeleteConfirmVibes(entry.suggestedVibes)
          }
        }
      } catch (error) {
        console.error('Error checking image usage:', error)
      }
      setIsCheckingDelete(false)
    }
  }

  // Confirm delete (from dialog)
  const confirmDelete = () => {
    if (deleteConfirmImage) {
      onSourceImageDelete?.(deleteConfirmImage)
      setDeleteConfirmImage(null)
      setDeleteConfirmVibes([])
    }
  }

  // Cancel delete
  const cancelDelete = () => {
    setDeleteConfirmImage(null)
    setDeleteConfirmVibes([])
  }

  // Check if image is generated (either by flag or by filename pattern)
  const isGeneratedImage = (img: SourceImage): boolean => {
    // Explicit flag
    if (img.isGenerated) return true
    // Generated images have filenames like "vibe-1-hero-1234567890.jpg" or contain "generated"
    // Do NOT use path pattern - uploaded images to session folders would match incorrectly
    const filename = img.filename.toLowerCase()
    return filename.includes('-generated') || /^vibe-\d+-/.test(filename)
  }

  // Split source images:
  // - Pending: uploaded but not evaluated AND not a generated image AND not yet submitted (INGESTED)
  // - Evaluated: has analysis from CD agent OR is a generated image OR has been submitted (INGESTED)
  const pendingImages = sourceImages.filter(img => !img.analysis?.description && !isGeneratedImage(img) && !img.tag)
  const evaluatedImages = sourceImages.filter(img => img.analysis?.description || isGeneratedImage(img) || img.tag)

  // Get/set prompts for Track 1 evaluated images
  const getPrompt = (img: SourceImage): string => {
    // Priority: user edits > CD reprompt > source prompt (for generated images)
    return editedPrompts[img.id] ?? img.analysis?.reprompt ?? img.sourcePrompt ?? ''
  }
  const setPrompt = (imgId: string, text: string) => {
    setEditedPrompts(prev => ({ ...prev, [imgId]: text }))
  }

  // Get/set prompts for Track 2 generation assets
  const getAssetPrompt = (asset: ImageAsset): string => {
    return editedAssetPrompts[asset.id] ?? asset.instruction ?? ''
  }
  const setAssetPrompt = (assetId: string, text: string) => {
    setEditedAssetPrompts(prev => ({ ...prev, [assetId]: text }))
  }

  // Get/toggle source images for a specific reprompt card
  const getRepromptSources = (assetId: string, initialSources: SourceImage[]): Set<string> => {
    if (!repromptSources[assetId]) {
      // Initialize from parsed sources
      return new Set(initialSources.map(s => s.id))
    }
    return repromptSources[assetId]
  }
  const toggleRepromptSource = (assetId: string, imgId: string, initialSources: SourceImage[]) => {
    setRepromptSources(prev => {
      const current = prev[assetId] || new Set(initialSources.map(s => s.id))
      const next = new Set(current)
      if (next.has(imgId)) next.delete(imgId)
      else next.add(imgId)
      return { ...prev, [assetId]: next }
    })
  }
  const removeRepromptSource = (assetId: string, imgId: string, initialSources: SourceImage[]) => {
    setRepromptSources(prev => {
      const current = prev[assetId] || new Set(initialSources.map(s => s.id))
      const next = new Set(current)
      next.delete(imgId)
      return { ...prev, [assetId]: next }
    })
  }


  // Find source image by filename
  const findSourceByFilename = (filename: string): SourceImage | undefined => {
    return sourceImages.find(img =>
      img.filename.toLowerCase().includes(filename.toLowerCase()) ||
      filename.toLowerCase().includes(img.filename.replace(/^\d+-/, '').toLowerCase())
    )
  }

  useEffect(() => {
    if (imageManifests.length > 0) {
      setExpandedVibes(new Set(imageManifests.map(m => m.vibeId)))
    }
  }, [imageManifests])

  const toggleVibe = (vibeId: string) => {
    const next = new Set(expandedVibes)
    if (next.has(vibeId)) next.delete(vibeId)
    else next.add(vibeId)
    setExpandedVibes(next)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    Array.from(e.dataTransfer.files).forEach(f => {
      if (f.type.startsWith('image/')) onUpload(f)
    })
  }

  const totalAssets = imageManifests.reduce((sum, m) => sum + m.assets.length, 0)
  const completedAssets = imageManifests.reduce((sum, m) => sum + m.assets.filter(a => a.status === 'complete').length, 0)

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--bg-card)',
      overflow: 'hidden'
    }}>
      {/* ================================================================== */}
      {/* HEADER                                                            */}
      {/* ================================================================== */}
      <div style={{
        height: '56px',
        minHeight: '56px',
        borderBottom: '1px solid var(--border-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        flexShrink: 0
      }}>
        <span style={{
          fontSize: '12px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--text-main)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #3B82F6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 7h-3a2 2 0 0 1-2-2V2"></path>
            <path d="M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z"></path>
            <path d="M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8"></path>
          </svg>
          Assets
        </span>
        <span style={{
          fontSize: '10px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          padding: '4px 8px',
          borderRadius: '9999px',
          backgroundColor: 'var(--bg-app)',
          border: '1px solid var(--border-card)'
        }}>
          {sourceImages.length} items
        </span>
      </div>

      {/* ================================================================== */}
      {/* SCROLLABLE CONTENT                                                */}
      {/* ================================================================== */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        minHeight: 0
      }}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
      >
        {/* ============================================================== */}
        {/* UPLOADS - Raw images before submission                         */}
        {/* ============================================================== */}
        <div style={{ padding: '16px' }}>
          <div style={{
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-muted)',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Uploads
          </div>

          {/* Grid of uploads - responsive columns, tiles ~200px */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '8px',
            alignContent: 'start',
            marginBottom: '12px'
          }}>
            {/* Upload Tile */}
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                aspectRatio: '1',
                borderRadius: '6px',
                border: '2px dashed var(--border-card)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                backgroundColor: 'var(--bg-app)'
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span style={{ fontSize: '7px', fontWeight: 700, textTransform: 'uppercase' }}>Add</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={e => {
                  Array.from(e.target.files || []).forEach(f => onUpload(f))
                  e.target.value = ''
                }}
                style={{ display: 'none' }}
              />
            </div>

            {/* Pending (not yet evaluated) images */}
            {pendingImages.map((img, index) => {
              const uploadId = `upload-${img.id}`
              const isHovered = hoveredTile === uploadId
              const cleanFilename = img.filename.replace(/^\d+-/, '')
              return (
                <div
                  key={`pending-${img.id}-${index}`}
                  onMouseEnter={() => setHoveredTile(uploadId)}
                  onMouseLeave={() => setHoveredTile(null)}
                  style={{
                    position: 'relative',
                    aspectRatio: '1',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    border: '1px solid var(--border-card)',
                    cursor: 'pointer'
                  }}
                >
                  <img
                    src={img.path}
                    alt={img.filename}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  {/* Hover overlays: delete button + filename */}
                  {isHovered && (
                    <>
                      {/* Delete button (top-right) */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteImage(img)
                        }}
                        style={{
                          position: 'absolute',
                          top: '8px',
                          right: '8px',
                          width: '24px',
                          height: '24px',
                          padding: 0,
                          border: 'none',
                          backgroundColor: 'rgba(239, 68, 68, 0.9)',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                          <line x1="18" y1="6" x2="6" y2="18"/>
                          <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                      {/* Filename (bottom) */}
                      <div style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        padding: '8px',
                        background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
                        fontSize: '10px',
                        fontWeight: 600,
                        color: 'white',
                        textAlign: 'center',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {cleanFilename}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* Submit button */}
          {pendingImages.length > 0 && (
            <button
              onClick={onSubmitImages}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: 'var(--success, #10B981)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13"/>
                <path d="M22 2L15 22L11 13L2 9L22 2Z"/>
              </svg>
              Submit {pendingImages.length} Image{pendingImages.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>

        {/* ============================================================== */}
        {/* IMAGE LIBRARY - Evaluated images with reprompts (Collapsible)  */}
        {/* ============================================================== */}
        {evaluatedImages.length > 0 && (
          <div style={{ padding: '0 16px 16px 16px' }}>
            {/* Section header - clickable to collapse */}
            <div
              onClick={() => setImageLibraryExpanded(!imageLibraryExpanded)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: imageLibraryExpanded ? '12px' : '0',
                cursor: 'pointer',
                userSelect: 'none'
              }}
            >
              <span style={{
                fontSize: '10px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="10" height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{
                    transform: imageLibraryExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s'
                  }}
                >
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
                Image Library
              </span>
              <span style={{
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-dim)'
              }}>
                {evaluatedImages.length} evaluated
              </span>
            </div>

            {imageLibraryExpanded && (
              <>
                {/* BENTO GRID - responsive columns, tiles ~200px */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: '8px'
                }}>
                  {evaluatedImages.map((img, idx) => {
                    const libCardId = `lib-${img.id}`
                    const prompt = getPrompt(img)
                    const originalPrompt = img.analysis?.reprompt ?? ''
                    const isHovered = hoveredTile === libCardId

                    return (
                      <BentoTile
                        key={`lib-${img.id}-${idx}`}
                        image={img}
                        prompt={prompt}
                        originalPrompt={originalPrompt}
                        isHovered={isHovered}
                        onHover={(hovered) => setHoveredTile(hovered ? libCardId : null)}
                        onPromptChange={(text) => setPrompt(img.id, text)}
                        onEdit={() => onSourceImageEdit?.(img, prompt, 'edit')}
                        onDelete={() => handleDeleteImage(img)}
                        onFullscreen={() => setFullscreenImage({
                          url: img.path,
                          title: img.filename.replace(/^\d+-/, '')
                        })}
                        allImages={evaluatedImages}
                      />
                    )
                  })}

                  {/* Empty tile for GENERATE - always at the end */}
                  <GenerateTile
                    isHovered={hoveredTile === 'generate-new'}
                    onHover={(hovered) => setHoveredTile(hovered ? 'generate-new' : null)}
                    prompt={newGeneratePrompt}
                    onPromptChange={setNewGeneratePrompt}
                    onGenerate={() => {
                      if (!newGeneratePrompt.trim()) return
                      const newAsset: ImageAsset = {
                        id: `gen-${Date.now()}`,
                        filename: `generated-${Date.now()}.jpg`,
                        operation: 'generate',
                        sourceImages: [],
                        instruction: newGeneratePrompt.trim(),
                        usage: 'gallery',
                        aspectRatio: '1:1',
                        resolution: '1K',
                        status: 'pending',
                        vibeId: 'standalone',
                        vibeName: 'Generated'
                      }
                      onAssetGenerate(newAsset)
                      setNewGeneratePrompt('')
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* REPROMPTS - Track 2 Image Prompts from IMAGES.md               */}
        {/* Using same card design as Image Library (bento grid)           */}
        {/* ============================================================== */}
        {imageManifests.length > 0 && (
          <div style={{ padding: '0 16px 16px 16px' }}>
            <div style={{
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--text-muted)',
              marginBottom: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>
              </svg>
              Reprompts
            </div>

            {imageManifests.map(manifest => (
              <div key={manifest.vibeId} style={{ marginBottom: '12px' }}>
                {/* Vibe header - collapsible */}
                <div
                  onClick={() => toggleVibe(manifest.vibeId)}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: 'var(--bg-card)',
                    borderRadius: expandedVibes.has(manifest.vibeId) ? '8px 8px 0 0' : '8px',
                    border: '1px solid var(--border-card)',
                    borderBottom: expandedVibes.has(manifest.vibeId) ? 'none' : '1px solid var(--border-card)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    userSelect: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="10" height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--text-muted)"
                      strokeWidth="2"
                      style={{
                        transform: expandedVibes.has(manifest.vibeId) ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 0.15s'
                      }}
                    >
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-main)' }}>
                      {manifest.vibeName}
                    </span>
                  </div>
                  <span style={{
                    fontSize: '9px',
                    fontFamily: 'var(--font-mono)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: manifest.assets.filter(a => a.status === 'complete').length === manifest.assets.length
                      ? 'rgba(16, 185, 129, 0.15)'
                      : 'rgba(100, 100, 100, 0.15)',
                    color: manifest.assets.filter(a => a.status === 'complete').length === manifest.assets.length
                      ? '#10B981'
                      : 'var(--text-muted)'
                  }}>
                    {manifest.assets.filter(a => a.status === 'complete').length}/{manifest.assets.length}
                  </span>
                </div>

                {/* Assets as BENTO GRID - same as Image Library */}
                {/* If only 1 asset, make it full width */}
                {expandedVibes.has(manifest.vibeId) && (
                  <div style={{
                    backgroundColor: 'var(--bg-app)',
                    border: '1px solid var(--border-card)',
                    borderTop: 'none',
                    borderRadius: '0 0 8px 8px',
                    padding: '12px'
                  }}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: manifest.assets.length === 1
                        ? '1fr'
                        : 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: '8px'
                    }}>
                      {manifest.assets.map((asset, idx) => {
                        const prompt = getAssetPrompt(asset)
                        const originalPrompt = asset.instruction ?? ''
                        const operation = parseOperation(prompt)
                        const sourceFiles = parseSourceFiles(prompt)
                        const matchedSources = sourceFiles
                          .map(f => findSourceByFilename(f))
                          .filter(Boolean) as SourceImage[]

                        // Get primary source image for display
                        const currentSources = getRepromptSources(asset.id, matchedSources)
                        const displaySources = sourceImages.filter(img => currentSources.has(img.id))
                        const primarySource = displaySources[0]

                        const cardId = `reprompt-${manifest.vibeId}-${asset.id || idx}`
                        const isHovered = hoveredTile === cardId

                        return (
                          <RepromptCard
                            key={asset.id || `${manifest.vibeId}-${idx}`}
                            asset={asset}
                            prompt={prompt}
                            originalPrompt={originalPrompt}
                            operation={operation}
                            sourceSrc={primarySource?.path}
                            sourceFilename={primarySource?.filename}
                            isHovered={isHovered}
                            onHover={(hovered) => setHoveredTile(hovered ? cardId : null)}
                            onPromptChange={(text) => setAssetPrompt(asset.id, text)}
                            onGenerate={() => {
                              const updatedAsset = { ...asset, instruction: prompt }
                              onAssetGenerate(updatedAsset)
                            }}
                            onDismiss={onAssetDismiss ? () => onAssetDismiss(asset) : undefined}
                            onFullscreen={asset.generatedUrl ? () => setFullscreenImage({
                              url: asset.generatedUrl!,
                              title: asset.slot || asset.id
                            }) : undefined}
                            onAddImages={() => setRepromptDropdownOpen(repromptDropdownOpen === asset.id ? null : asset.id)}
                            showAddImagesDropdown={repromptDropdownOpen === asset.id}
                            allImages={sourceImages}
                            selectedImageIds={currentSources}
                            onToggleImage={(imgId) => toggleRepromptSource(asset.id, imgId, matchedSources)}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Progress Bar */}
      {totalAssets > 0 && (
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-card)',
          backgroundColor: 'var(--bg-app)'
        }}>
          <div style={{
            height: '4px',
            backgroundColor: 'var(--border-card)',
            borderRadius: '2px',
            overflow: 'hidden',
            marginBottom: '8px'
          }}>
            <div style={{
              height: '100%',
              backgroundColor: 'var(--accent, #3B82F6)',
              width: `${(completedAssets / totalAssets) * 100}%`,
              transition: 'width 0.3s'
            }} />
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)'
            }}>
              {completedAssets}/{totalAssets} generated
            </span>
            {totalAssets > completedAssets && (
              <button
                onClick={() => {
                  imageManifests.forEach(m => {
                    m.assets.filter(a => a.status === 'pending').forEach(a => onAssetGenerate(a))
                  })
                }}
                style={{
                  padding: '4px 8px',
                  backgroundColor: 'var(--accent, #3B82F6)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '9px',
                  fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase',
                  cursor: 'pointer'
                }}
              >
                Generate All
              </button>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmImage && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: '12px',
            padding: '20px',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
          }}>
            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '16px'
            }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: deleteConfirmVibes.length > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={deleteConfirmVibes.length > 0 ? '#EF4444' : '#F59E0B'} strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>
                  {deleteConfirmVibes.length > 0 ? 'Image In Use' : 'Remove Image?'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {deleteConfirmVibes.length > 0 ? 'This image is referenced in vibes' : 'This will remove the image from this session'}
                </div>
              </div>
            </div>

            {/* Image preview */}
            <div style={{
              display: 'flex',
              gap: '12px',
              marginBottom: '16px',
              padding: '12px',
              backgroundColor: 'var(--bg-app)',
              borderRadius: '8px'
            }}>
              <img
                src={deleteConfirmImage.path}
                alt={deleteConfirmImage.filename}
                style={{
                  width: '60px',
                  height: '60px',
                  objectFit: 'cover',
                  borderRadius: '6px'
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  {deleteConfirmImage.filename.replace(/^\d+-/, '')}
                </div>
                {deleteConfirmVibes.length > 0 && (
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    Used in: {deleteConfirmVibes.join(', ')}
                  </div>
                )}
              </div>
            </div>

            {/* Message */}
            <p style={{
              fontSize: '12px',
              color: 'var(--text-main)',
              lineHeight: 1.5,
              marginBottom: '20px'
            }}>
              {deleteConfirmVibes.length > 0
                ? 'Removing this image will affect the vibes listed above. Are you sure you want to continue?'
                : 'Are you sure you want to remove this image from the session?'}
            </p>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={cancelDelete}
                style={{
                  padding: '10px 16px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: 'var(--bg-app)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-card)',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                style={{
                  padding: '10px 16px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: deleteConfirmVibes.length > 0 ? '#EF4444' : '#F59E0B',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                {deleteConfirmVibes.length > 0 ? 'Remove Anyway' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Image Modal */}
      {fullscreenImage && (
        <div
          onClick={() => setFullscreenImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.95)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          {/* Close button */}
          <button
            onClick={() => setFullscreenImage(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              width: '44px',
              height: '44px',
              padding: 0,
              border: 'none',
              backgroundColor: 'rgba(255,255,255,0.2)',
              borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.3)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          {/* Title */}
          {fullscreenImage.title && (
            <div style={{
              position: 'absolute',
              top: '20px',
              left: '20px',
              color: 'white',
              fontSize: '14px',
              fontWeight: 600,
              maxWidth: 'calc(100% - 100px)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {fullscreenImage.title}
            </div>
          )}
          {/* Image */}
          <img
            src={fullscreenImage.url}
            alt={fullscreenImage.title || 'Fullscreen'}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              objectFit: 'contain',
              borderRadius: '8px',
              cursor: 'default'
            }}
          />
        </div>
      )}
    </div>
  )
}
