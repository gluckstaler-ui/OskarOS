'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ImageAsset, VibeData, VibePreview, AspectRatio, ImageSize, SelectedElement, TextQuickAction, ImageQuickAction } from '@/lib/types'
import { MagicToolbar } from './MagicToolbar'
import { StudioImagePicker, type StudioPickTarget } from './studio/StudioImagePicker'
import { STUDIO_BRIDGE_PATCH, parseHtmlPath, humanizeSlot } from '@/lib/studio-bridge'

// ============================================================================
// CANVAS PANEL - COMPLETELY REWRITTEN TO MATCH BENTO.HTML
// ============================================================================

interface CanvasPanelProps {
  vibes: VibeData[]
  selectedVibe?: VibeData
  selectedAsset?: ImageAsset
  onVibeSelect: (vibe: VibeData) => void
  onAssetUpdate: (asset: ImageAsset) => void
  onAssetRegenerate: (asset: ImageAsset) => void
  onClearAsset: () => void
  directorMode?: boolean
  onToggleDirectorMode?: () => void
  onElementSelect?: (element: SelectedElement | null) => void
  selectedElement?: SelectedElement | null
  onTextEdit?: (elementId: string, newText: string) => void
  availableVibes?: VibePreview[]
  selectedVibeFile?: string | null
  onVibeFileSelect?: (filename: string) => void
  onVibeDelete?: (filename: string) => void
  onImageEditRequest?: (imageUrl: string, instruction: string) => void
}

export function CanvasPanel({
  vibes,
  selectedVibe,
  selectedAsset,
  onVibeSelect,
  onAssetUpdate,
  onAssetRegenerate,
  onClearAsset,
  directorMode = false,
  onToggleDirectorMode,
  onElementSelect,
  selectedElement,
  onTextEdit,
  availableVibes = [],
  selectedVibeFile = null,
  onVibeFileSelect,
  onVibeDelete,
  onImageEditRequest
}: CanvasPanelProps) {
  // Inject hover CSS for vibe tab delete buttons
  useEffect(() => {
    const styleId = 'vibe-tab-hover-styles'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        .vibe-tab-wrapper:hover .vibe-tab-delete { opacity: 1 !important; }
        .vibe-card-wrapper:hover .vibe-card-delete { opacity: 1 !important; }
      `
      document.head.appendChild(style)
    }
  }, [])

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [bridgeReady, setBridgeReady] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [showMagicToolbar, setShowMagicToolbar] = useState(false)
  const [imageEditInstruction, setImageEditInstruction] = useState('')
  // Studio Mode slot-swap picker (WP-8B inverse flow)
  const [studioTarget, setStudioTarget] = useState<StudioPickTarget | null>(null)

  // Show magic toolbar when TEXT element is selected (not images)
  useEffect(() => {
    setShowMagicToolbar(!!selectedElement && directorMode && selectedElement.elementType === 'text')
  }, [selectedElement, directorMode])

  // Check if we're in image edit mode
  const showImageEditPanel = directorMode && selectedElement?.elementType === 'image'

  // Reset instruction when image changes
  useEffect(() => {
    if (showImageEditPanel) {
      setImageEditInstruction('')
    }
  }, [selectedElement?.id, showImageEditPanel])

  // Determine active vibe to display
  const activeVibe = availableVibes.find(v => v.filename === selectedVibeFile && v.status === 'ready')
  const vibeToShow = activeVibe
    ? { name: activeVibe.name, htmlPath: activeVibe.htmlPath }
    : selectedVibe

  // Debug logging
  console.log('🎨 CanvasPanel render:', {
    availableVibesCount: availableVibes.length,
    vibeNames: availableVibes.map(v => v.name),
    selectedVibeFile,
    vibeToShow: vibeToShow?.name
  })

  // Listen for messages from iframe (Director Mode + Bridge Ready)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return

      // Bridge is ready - now we can send commands
      if (event.data.type === 'BRIDGE_READY') {
        console.log('🎬 Director Mode: Bridge ready in iframe')
        setBridgeReady(true)
      }

      // Element selected in Director Mode
      if (event.data.type === 'ELEMENT_SELECTED' && onElementSelect) {
        const iframeEl = iframeRef.current
        let adjustedRect = event.data.rect
        if (iframeEl && event.data.rect) {
          const iframeRect = iframeEl.getBoundingClientRect()
          adjustedRect = {
            top: iframeRect.top + event.data.rect.top,
            left: iframeRect.left + event.data.rect.left,
            width: event.data.rect.width,
            height: event.data.rect.height
          }
        }
        console.log('🎬 Director Mode: Element selected:', event.data.id)
        onElementSelect({
          elementType: event.data.elementType,
          id: event.data.id,
          currentValue: event.data.currentValue,
          tagName: event.data.tagName,
          rect: adjustedRect
        })
      }

      // Studio Mode slot click: [data-slot] IMG tapped in iframe
      // Opens the StudioImagePicker so user can swap the image
      if (event.data.type === 'SLOT_SELECTED') {
        const { sessionId: sid, pageFilename } = parseHtmlPath(
          typeof vibeToShow?.htmlPath === 'string' ? vibeToShow.htmlPath : undefined
        )
        if (!sid || !pageFilename) {
          console.warn('🎨 Studio: SLOT_SELECTED ignored — no session/page context')
          return
        }
        console.log('🎨 Studio: slot clicked', event.data.slot, 'on', pageFilename)
        setStudioTarget({
          pageFilename,
          slot: event.data.slot,
          humanLabel: humanizeSlot(event.data.slot),
          currentImage: event.data.currentSrc || '',
          context: event.data.headingText || null,
        })
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onElementSelect, vibeToShow?.htmlPath])

  // Reset bridge ready when vibe changes
  useEffect(() => {
    setBridgeReady(false)
  }, [vibeToShow?.htmlPath])

  // Toggle Director Mode in iframe - send after iframe loads
  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      // Small delay to ensure iframe has loaded
      const timer = setTimeout(() => {
        console.log('🎬 Director Mode: Sending SET_DIRECTOR_MODE, enabled:', directorMode)
        iframeRef.current?.contentWindow?.postMessage({
          type: 'SET_DIRECTOR_MODE',
          enabled: directorMode
        }, '*')
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [directorMode, vibeToShow?.htmlPath])

  // Studio Mode bridge patch — injected into the iframe's DOM so that
  // existing vibes (which ship with the OLD bridge that doesn't know about
  // data-slot) gain click-to-swap functionality without re-saving the file.
  //
  // Same-origin iframe, so we can directly mutate contentDocument.
  // The patch:
  //   1. Captures clicks on <img data-slot="..."> when Director Mode is on
  //   2. Posts SLOT_SELECTED to the parent with slot + current src + heading
  //   3. Listens for UPDATE_SLOT_IMAGE to swap the image in place
  useEffect(() => {
    const iframeEl = iframeRef.current
    if (!iframeEl) return
    if (!vibeToShow?.htmlPath) return

    function injectPatch() {
      try {
        const doc = iframeEl?.contentDocument
        if (!doc) return
        if (doc.getElementById('oskar-studio-patch')) return // already injected
        const s = doc.createElement('script')
        s.id = 'oskar-studio-patch'
        s.textContent = STUDIO_BRIDGE_PATCH
        doc.body.appendChild(s)
        console.log('🎨 Studio: bridge patch injected')
      } catch (err) {
        console.warn('🎨 Studio: could not inject bridge patch', err)
      }
    }

    // If already loaded, inject now. Otherwise wait for onload.
    if (iframeEl.contentDocument?.readyState === 'complete') {
      injectPatch()
    } else {
      iframeEl.addEventListener('load', injectPatch)
      return () => iframeEl.removeEventListener('load', injectPatch)
    }
  }, [vibeToShow?.htmlPath])

  // Studio Mode: fire after a successful slot swap.
  // Tells the iframe to swap the image in place + clears the picker state.
  const handleStudioPicked = useCallback(
    (result: { filename: string; slot: string; pageFilename: string; oldImage?: string }) => {
      const iframeWin = iframeRef.current?.contentWindow
      if (iframeWin) {
        iframeWin.postMessage(
          {
            type: 'UPDATE_SLOT_IMAGE',
            slot: result.slot,
            url: result.filename, // relative path — iframe is same-origin as session folder
          },
          '*'
        )
      }
      setStudioTarget(null)
      console.log(
        `🎨 Studio: slot "${result.slot}" on ${result.pageFilename} now shows ${result.filename}`
      )
    },
    []
  )

  // Persist edit to HTML file
  const persistEdit = useCallback(async (elementId: string, newValue: string, elementType: 'text' | 'image') => {
    if (!vibeToShow?.htmlPath) return

    try {
      const res = await fetch('/api/director/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          htmlPath: vibeToShow.htmlPath,
          elementId,
          newValue,
          elementType
        })
      })
      if (!res.ok) {
        console.error('Failed to persist edit')
      }
    } catch (err) {
      console.error('Error persisting edit:', err)
    }
  }, [vibeToShow?.htmlPath])

  // Apply edit to iframe and persist
  const applyEdit = useCallback((newValue: string) => {
    if (!selectedElement || !iframeRef.current?.contentWindow) return

    if (selectedElement.elementType === 'text') {
      iframeRef.current.contentWindow.postMessage({
        type: 'UPDATE_TEXT',
        id: selectedElement.id,
        text: newValue
      }, '*')
    } else if (selectedElement.elementType === 'image') {
      iframeRef.current.contentWindow.postMessage({
        type: 'UPDATE_IMAGE',
        usage: selectedElement.id,
        url: newValue
      }, '*')
    }

    // Persist to file
    persistEdit(selectedElement.id, newValue, selectedElement.elementType)
  }, [selectedElement, persistEdit])

  // Handle quick edit actions (punchier, shorter, longer, etc.)
  const handleQuickEdit = useCallback(async (action: TextQuickAction | ImageQuickAction) => {
    if (!selectedElement) return
    setIsProcessing(true)
    console.log('🎬 Quick edit:', action, 'on', selectedElement.id)

    try {
      const res = await fetch('/api/quick-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: selectedElement.elementType,
          action,
          currentValue: selectedElement.currentValue,
          elementId: selectedElement.id
        })
      })

      const data = await res.json()
      console.log('🎬 Quick edit result:', data)

      if (data.success && data.result) {
        applyEdit(data.result)
      } else if (data.error) {
        console.error('Quick edit API error:', data.error)
      }
    } catch (err) {
      console.error('Quick edit error:', err)
    } finally {
      setIsProcessing(false)
      onElementSelect?.(null)
    }
  }, [selectedElement, applyEdit, onElementSelect])

  // Handle custom edit instruction
  const handleCustomEdit = useCallback(async (instruction: string) => {
    if (!selectedElement) return
    setIsProcessing(true)
    console.log('🎬 Custom edit:', instruction, 'on', selectedElement.id)

    try {
      const res = await fetch('/api/quick-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: selectedElement.elementType,
          action: 'custom',
          currentValue: selectedElement.currentValue,
          elementId: selectedElement.id,
          customInstruction: instruction
        })
      })

      const data = await res.json()
      console.log('🎬 Custom edit result:', data)

      if (data.success && data.result) {
        applyEdit(data.result)
      } else if (data.error) {
        console.error('Custom edit API error:', data.error)
      }
    } catch (err) {
      console.error('Custom edit error:', err)
    } finally {
      setIsProcessing(false)
      onElementSelect?.(null)
    }
  }, [selectedElement, applyEdit, onElementSelect])

  // Close magic toolbar
  const handleCloseMagicToolbar = useCallback(() => {
    onElementSelect?.(null)
    setShowMagicToolbar(false)
  }, [onElementSelect])

  // ============================================================================
  // RENDER - MATCHING BENTO.HTML STRUCTURE EXACTLY
  // ============================================================================
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--bg-card)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* ================================================================== */}
      {/* TOOLBAR - h-14 (56px), flexShrink: 0, border-bottom              */}
      {/* ================================================================== */}
      <div style={{
        height: '56px',
        minHeight: '56px',
        borderBottom: '1px solid var(--border-card)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        backgroundColor: 'var(--bg-card)',
        zIndex: 20,
        flexShrink: 0
      }}>
        {/* LEFT: Vibe Tabs - Priority: availableVibes > vibes > empty */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '5px',
          backgroundColor: 'var(--bg-app)',
          borderRadius: '10px',
          border: '1px solid var(--border-card)',
          overflow: 'auto'
        }}>
          {/* Use availableVibes if populated (from streaming) */}
          {availableVibes.length > 0 ? (
            availableVibes.map((vibe, idx) => {
              const isActive = selectedVibeFile === vibe.filename
              const isDisabled = vibe.status !== 'ready'
              return (
                <div
                  key={`av-${vibe.filename}`}
                  style={{ position: 'relative', display: 'inline-flex' }}
                  className="vibe-tab-wrapper"
                >
                  <button
                    onClick={() => {
                      if (!isDisabled && onVibeFileSelect) {
                        onVibeFileSelect(vibe.filename)
                        onClearAsset()
                      }
                    }}
                    disabled={isDisabled}
                    style={{
                      padding: '10px 24px 10px 18px',
                      fontSize: '12px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      borderRadius: '8px',
                      transition: 'all 0.2s',
                      border: isActive ? '1px solid var(--border-card)' : '1px solid var(--border-subtle, transparent)',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      opacity: isDisabled ? 0.4 : 1,
                      backgroundColor: isActive ? 'var(--bg-card)' : 'transparent',
                      color: isActive ? 'var(--text-main)' : 'var(--text-muted)',
                      boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                      outline: isActive ? '1px solid var(--border-card)' : 'none',
                      outlineOffset: '1px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {vibe.name}
                  </button>
                  {/* Delete button — visible on hover via CSS class.
                      Confirmation modal lives in `page.tsx` so both this
                      Studio-tab path and the Gallery-card path share one
                      guard. `onVibeDelete` here is the `requestVibeDelete`
                      trigger; the actual destructive call is gated by the
                      confirm modal at the shell level. */}
                  {onVibeDelete && (
                    <button
                      className="vibe-tab-delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        onVibeDelete(vibe.filename)
                      }}
                      title={`Delete ${vibe.name}`}
                      style={{
                        position: 'absolute',
                        top: '-6px',
                        right: '-6px',
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        backgroundColor: '#dc2626',
                        color: 'white',
                        border: '2px solid var(--bg-app)',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 700,
                        lineHeight: '1',
                        padding: 0,
                        opacity: 0,
                        transition: 'opacity 0.15s, transform 0.15s',
                        zIndex: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  )}
                </div>
              )
            })
          ) : vibes.length > 0 ? (
            /* Fallback to vibes array (from session load) */
            vibes.map((vibe, idx) => {
              const isActive = selectedVibe?.id === vibe.id
              return (
                <button
                  key={`v-${vibe.id}`}
                  onClick={() => {
                    onVibeSelect(vibe)
                    onClearAsset()
                  }}
                  style={{
                    padding: '6px 16px',
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.075em',
                    borderRadius: '6px',
                    transition: 'all 0.2s',
                    border: isActive ? '1px solid var(--border-card)' : '1px solid transparent',
                    cursor: 'pointer',
                    backgroundColor: isActive ? 'var(--bg-card)' : 'transparent',
                    color: isActive ? 'var(--text-main)' : 'var(--text-muted)',
                    boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  {vibe.name}
                </button>
              )
            })
          ) : (
            <span style={{
              padding: '6px 16px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              No vibes yet
            </span>
          )}
        </div>

        {/* RIGHT: Live Preview + Director Mode */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Live Preview Indicator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            backgroundColor: 'var(--bg-app)',
            borderRadius: '9999px',
            border: '1px solid var(--border-card)'
          }}>
            <div style={{
              width: '6px',
              height: '6px',
              backgroundColor: '#10B981',
              borderRadius: '50%',
              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
            }} />
            <span style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              textTransform: 'uppercase'
            }}>Live Preview</span>
          </div>

          {/* Director Mode Button */}
          {onToggleDirectorMode && (
            <button
              onClick={onToggleDirectorMode}
              title="Director Mode"
              style={{
                padding: '8px',
                borderRadius: '8px',
                border: directorMode ? '1px solid var(--accent, #3B82F6)' : '1px solid var(--border-card)',
                transition: 'all 0.3s',
                cursor: 'pointer',
                backgroundColor: directorMode ? 'var(--accent, #3B82F6)' : 'var(--bg-app)',
                color: directorMode ? 'white' : 'var(--text-muted)',
                boxShadow: directorMode ? '0 4px 6px -1px rgba(59, 130, 246, 0.2)' : 'none'
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
                <path d="M2 2l7.586 7.586"></path>
                <circle cx="11" cy="11" r="2"></circle>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* CONTENT AREA - flex: 1, relative, bg-background/30              */}
      {/* ================================================================== */}
      <div style={{
        flex: 1,
        position: 'relative',
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'stretch',
        backgroundColor: 'rgba(9, 9, 11, 0.3)',
        padding: '0',
        overflow: 'hidden',
        minHeight: 0
      }}>
        {/* Dot Grid Background */}
        <div style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.2,
          pointerEvents: 'none',
          backgroundImage: 'radial-gradient(circle at 1px 1px, var(--text-muted) 1px, transparent 0)',
          backgroundSize: '24px 24px'
        }} />

        {/* CONTENT */}
        {selectedAsset ? (
          // ============== ASSET DETAIL VIEW ==============
          <AssetDetailView
            asset={selectedAsset}
            onBack={onClearAsset}
            onUpdate={onAssetUpdate}
            onRegenerate={onAssetRegenerate}
          />
        ) : vibeToShow ? (
          // ============== VIBE PREVIEW - EDGE TO EDGE ==============
          <div style={{
            width: '100%',
            height: '100%',
            backgroundColor: 'white',
            overflow: 'hidden',
            position: 'relative',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column'
          }}>
            {directorMode && (
              <DirectorToolbar
                selectedElement={selectedElement ?? null}
                iframeRef={iframeRef}
                onClearSelection={() => onElementSelect?.(null)}
                vibeHtmlPath={vibeToShow?.htmlPath}
              />
            )}
            <iframe
              ref={iframeRef}
              src={vibeToShow.htmlPath}
              title={vibeToShow.name}
              style={{
                width: '100%',
                flex: 1,
                border: 'none',
                backgroundColor: 'white'
              }}
            />
            <a
              href={vibeToShow.htmlPath}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                position: 'absolute',
                bottom: '16px',
                right: '16px',
                padding: '6px 12px',
                backgroundColor: 'var(--bg-card)',
                color: 'var(--accent, #3B82F6)',
                fontSize: '12px',
                textDecoration: 'none',
                borderRadius: '6px',
                border: '1px solid var(--border-card)',
                zIndex: 20
              }}
            >
              Open in new tab ↗
            </a>

            {/* MAGIC TOOLBAR POPUP - for text only */}
            {showMagicToolbar && selectedElement && (
              <MagicToolbar
                selectedElement={selectedElement}
                onQuickEdit={handleQuickEdit}
                onCustomEdit={handleCustomEdit}
                onClose={handleCloseMagicToolbar}
                isProcessing={isProcessing}
              />
            )}

            {/* STUDIO MODE — slot swap picker (WP-8B inverse flow).
                Opens when the user clicks a [data-slot] image in the iframe
                while Director Mode is on. Grid of session images; click one
                → hotSwapToVibe + UPDATE_SLOT_IMAGE back to the iframe. */}
            {studioTarget && (() => {
              const { sessionId: sid } = parseHtmlPath(vibeToShow?.htmlPath)
              if (!sid) return null
              return (
                <StudioImagePicker
                  sessionId={sid}
                  target={studioTarget}
                  onClose={() => setStudioTarget(null)}
                  onPicked={handleStudioPicked}
                />
              )
            })()}

            {/* IMAGE EDIT PANEL - for images in Director Mode */}
            {showImageEditPanel && selectedElement && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.85)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '32px',
                zIndex: 100
              }}>
                {/* Header */}
                <div style={{
                  position: 'absolute',
                  top: '16px',
                  left: '16px',
                  right: '16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span style={{
                    color: 'white',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    backgroundColor: 'var(--accent, #3B82F6)',
                    padding: '6px 12px',
                    borderRadius: '4px'
                  }}>
                    🎬 Director Mode — Edit Image
                  </span>
                  <button
                    onClick={() => onElementSelect?.(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'white',
                      fontSize: '24px',
                      cursor: 'pointer',
                      opacity: 0.7
                    }}
                  >
                    ×
                  </button>
                </div>

                {/* Image */}
                <img
                  src={selectedElement.currentValue}
                  alt="Edit this image"
                  style={{
                    maxWidth: '80%',
                    maxHeight: '50%',
                    objectFit: 'contain',
                    borderRadius: '8px',
                    border: '3px solid var(--accent, #3B82F6)',
                    marginBottom: '24px'
                  }}
                />

                {/* Edit Input */}
                <div style={{
                  width: '100%',
                  maxWidth: '600px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  <input
                    type="text"
                    value={imageEditInstruction}
                    onChange={e => setImageEditInstruction(e.target.value)}
                    placeholder="Describe your edit... (e.g., 'make it sunset', 'add more cats', 'zoom out')"
                    style={{
                      width: '100%',
                      padding: '14px 18px',
                      borderRadius: '8px',
                      border: '2px solid var(--accent, #3B82F6)',
                      backgroundColor: 'white',
                      color: '#111',
                      fontSize: '15px'
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && imageEditInstruction.trim()) {
                        onImageEditRequest?.(selectedElement.currentValue, imageEditInstruction)
                        onElementSelect?.(null)
                      }
                      if (e.key === 'Escape') {
                        onElementSelect?.(null)
                      }
                    }}
                    autoFocus
                  />
                  <div style={{
                    display: 'flex',
                    gap: '12px',
                    justifyContent: 'center'
                  }}>
                    <button
                      onClick={() => {
                        if (imageEditInstruction.trim()) {
                          onImageEditRequest?.(selectedElement.currentValue, imageEditInstruction)
                          onElementSelect?.(null)
                        }
                      }}
                      disabled={!imageEditInstruction.trim()}
                      style={{
                        padding: '12px 24px',
                        borderRadius: '8px',
                        border: 'none',
                        backgroundColor: imageEditInstruction.trim() ? '#f97316' : '#555',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: imageEditInstruction.trim() ? 'pointer' : 'not-allowed',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}
                    >
                      Edit Image
                    </button>
                    <button
                      onClick={() => onElementSelect?.(null)}
                      style={{
                        padding: '12px 24px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255,255,255,0.3)',
                        backgroundColor: 'transparent',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  <span style={{
                    textAlign: 'center',
                    fontSize: '12px',
                    color: 'rgba(255,255,255,0.5)'
                  }}>
                    Press Enter to submit • Esc to cancel
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          // ============== EMPTY STATE ==============
          <div style={{
            textAlign: 'center',
            padding: '48px',
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
            borderRadius: '12px',
            position: 'relative',
            zIndex: 10
          }}>
            <h2 style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '16px',
              color: 'var(--text-main)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '12px'
            }}>OskarOS</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '4px' }}>
              Start a conversation to discover your brand and generate vibes.
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}>
              Upload images and answer questions from the Creative Director.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// ASSET DETAIL VIEW COMPONENT
// ============================================================================
function AssetDetailView({
  asset,
  onBack,
  onUpdate,
  onRegenerate
}: {
  asset: ImageAsset
  onBack: () => void
  onUpdate: (asset: ImageAsset) => void
  onRegenerate: (asset: ImageAsset) => void
}) {
  const [instruction, setInstruction] = useState(asset.instruction)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(asset.aspectRatio)
  const [resolution, setResolution] = useState<ImageSize>(asset.resolution)
  const aspectRatios: AspectRatio[] = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9']

  useEffect(() => {
    setInstruction(asset.instruction)
    setAspectRatio(asset.aspectRatio)
    setResolution(asset.resolution)
  }, [asset.id])

  return (
    <div style={{
      width: '100%',
      maxWidth: '600px',
      backgroundColor: 'var(--bg-card)',
      borderRadius: '12px',
      overflow: 'hidden',
      border: '1px solid var(--border-card)',
      position: 'relative',
      zIndex: 10
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-card)'
      }}>
        <button
          onClick={onBack}
          style={{
            padding: '6px 12px',
            backgroundColor: 'var(--bg-app)',
            border: '1px solid var(--border-card)',
            borderRadius: '6px',
            color: 'var(--text-main)',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          ← Back
        </button>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)', flex: 1 }}>
          {asset.filename}
        </h2>
        <span style={{
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '12px',
          textTransform: 'uppercase',
          backgroundColor: asset.operation === 'compose' ? 'rgba(16, 185, 129, 0.15)' :
            asset.operation === 'extract' ? 'rgba(239, 68, 68, 0.15)' :
            asset.operation === 'generate' ? 'rgba(59, 130, 246, 0.15)' :
            'rgba(245, 158, 11, 0.15)',
          color: asset.operation === 'compose' ? '#10B981' :
            asset.operation === 'extract' ? '#EF4444' :
            asset.operation === 'generate' ? '#3B82F6' :
            '#F59E0B'
        }}>
          {asset.operation}
        </span>
      </div>

      {/* Content */}
      <div style={{ padding: '16px', maxHeight: '400px', overflowY: 'auto' }}>
        {/* Result Preview */}
        {asset.resultPath && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              Generated Result:
            </label>
            <img src={asset.resultPath} alt="Generated result" style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: '8px', objectFit: 'contain' }} />
          </div>
        )}

        {/* Instruction */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Instruction:
          </label>
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            rows={3}
            placeholder="Describe what you want..."
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-card)',
              borderRadius: '6px',
              color: 'var(--text-main)',
              fontSize: '14px',
              resize: 'vertical'
            }}
          />
        </div>

        {/* Settings */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Aspect Ratio:
            </label>
            <select
              value={aspectRatio}
              onChange={e => setAspectRatio(e.target.value as AspectRatio)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-card)',
                borderRadius: '6px',
                color: 'var(--text-main)',
                fontSize: '14px'
              }}
            >
              {aspectRatios.map(ar => (
                <option key={ar} value={ar}>{ar}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Resolution:
            </label>
            <select
              value={resolution}
              onChange={e => setResolution(e.target.value as ImageSize)}
              style={{
                width: '100%',
                padding: '8px',
                backgroundColor: 'var(--bg-app)',
                border: '1px solid var(--border-card)',
                borderRadius: '6px',
                color: 'var(--text-main)',
                fontSize: '14px'
              }}
            >
              <option value="1K">1K</option>
              <option value="2K">2K</option>
            </select>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px' }}>
          {asset.status === 'pending' && (
            <button
              onClick={() => onRegenerate({ ...asset, instruction, aspectRatio, resolution })}
              style={{
                padding: '10px 20px',
                backgroundColor: 'var(--accent, #3B82F6)',
                color: 'white',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer',
                border: 'none'
              }}
            >
              Generate
            </button>
          )}
          {asset.status === 'complete' && (
            <button
              onClick={() => onRegenerate({ ...asset, instruction, aspectRatio, resolution })}
              style={{
                padding: '10px 20px',
                backgroundColor: 'transparent',
                color: 'var(--accent, #3B82F6)',
                border: '1px solid var(--accent, #3B82F6)',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              Regenerate
            </button>
          )}
          {asset.status === 'generating' && (
            <button
              disabled
              style={{
                padding: '10px 20px',
                backgroundColor: 'var(--bg-app)',
                color: 'var(--text-muted)',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'not-allowed',
                border: 'none'
              }}
            >
              Generating...
            </button>
          )}
          {asset.status === 'error' && (
            <>
              <p style={{ width: '100%', color: '#EF4444', fontSize: '14px', marginBottom: '8px' }}>{asset.error}</p>
              <button
                onClick={() => onRegenerate({ ...asset, instruction, aspectRatio, resolution })}
                style={{
                  padding: '10px 20px',
                  backgroundColor: 'var(--accent, #3B82F6)',
                  color: 'white',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  border: 'none'
                }}
              >
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// DIRECTOR MODE TOOLBAR - Editing UI for selected elements
// ============================================================================
function DirectorToolbar({
  selectedElement,
  iframeRef,
  onClearSelection,
  vibeHtmlPath
}: {
  selectedElement: SelectedElement | null
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  onClearSelection: () => void
  vibeHtmlPath?: string
}) {
  const [editValue, setEditValue] = useState('')
  const [isEditing, setIsEditing] = useState(false)

  // Sync edit value when selection changes
  useEffect(() => {
    if (selectedElement) {
      // For text, show current value; for images, start with empty instruction
      setEditValue(selectedElement.elementType === 'text' ? selectedElement.currentValue : '')
      setIsEditing(true)
    } else {
      setIsEditing(false)
      setEditValue('')
    }
  }, [selectedElement])

  const persistEdit = async (elementId: string, newValue: string, elementType: 'text' | 'image') => {
    if (!vibeHtmlPath) return
    try {
      await fetch('/api/director/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ htmlPath: vibeHtmlPath, elementId, newValue, elementType })
      })
    } catch (err) {
      console.error('Failed to persist edit:', err)
    }
  }

  const handleApply = async () => {
    if (!selectedElement || !iframeRef.current?.contentWindow) return

    if (selectedElement.elementType === 'text') {
      iframeRef.current.contentWindow.postMessage({
        type: 'UPDATE_TEXT',
        id: selectedElement.id,
        text: editValue
      }, '*')
      // Persist to HTML file
      persistEdit(selectedElement.id, editValue, selectedElement.elementType)
      onClearSelection()
    } else if (selectedElement.elementType === 'image') {
      // For images, editValue is an edit instruction, not a URL
      // TODO: Call image editing API and get new URL
      console.log('🎬 Image edit requested:', {
        imageUrl: selectedElement.currentValue,
        instruction: editValue,
        elementId: selectedElement.id
      })
      // For now, just close the selection
      // Image editing will be implemented via the CD flow
      alert(`Image edit: "${editValue}"\n\nThis will trigger image regeneration.`)
      onClearSelection()
    }
  }

  const handleCancel = () => {
    onClearSelection()
  }

  return (
    <div style={{
      padding: '8px 16px',
      backgroundColor: 'var(--accent, #3B82F6)',
      color: 'white',
      fontSize: '12px',
      fontFamily: 'var(--font-mono)',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      minHeight: '44px'
    }}>
      {!selectedElement ? (
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          🎬 DIRECTOR MODE — Click any text or image to edit
        </span>
      ) : (
        <>
          <span style={{
            fontSize: '10px',
            backgroundColor: 'rgba(0,0,0,0.2)',
            padding: '2px 8px',
            borderRadius: '4px',
            textTransform: 'uppercase',
            flexShrink: 0
          }}>
            {selectedElement.elementType === 'image' ? '🖼️' : '📝'} {selectedElement.tagName.toLowerCase()}
          </span>

          {selectedElement.elementType === 'text' ? (
            <>
              <textarea
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                placeholder="Edit text..."
                rows={2}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: 'white',
                  color: '#111',
                  fontSize: '13px',
                  minWidth: '200px',
                  resize: 'none',
                  lineHeight: '1.4'
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleApply() }
                  if (e.key === 'Escape') handleCancel()
                }}
                autoFocus
              />
              <button
                onClick={handleApply}
                style={{
                  padding: '6px 12px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: '#10B981',
                  color: 'white',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}
              >
                Apply
              </button>
            </>
          ) : (
            <>
              {/* Image thumbnail */}
              <img
                src={selectedElement.currentValue}
                alt="Selected"
                style={{
                  width: '40px',
                  height: '40px',
                  objectFit: 'cover',
                  borderRadius: '4px',
                  border: '2px solid rgba(255,255,255,0.3)',
                  flexShrink: 0
                }}
              />
              {/* Edit instruction input */}
              <input
                type="text"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                placeholder="Describe your edit... (e.g., 'make it sunset', 'add more cats')"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: 'white',
                  color: '#111',
                  fontSize: '13px',
                  minWidth: '250px'
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleApply()
                  if (e.key === 'Escape') handleCancel()
                }}
                autoFocus
              />
              <button
                onClick={handleApply}
                style={{
                  padding: '8px 16px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: '#f97316',
                  color: 'white',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}
              >
                Edit Image
              </button>
            </>
          )}
          <button
            onClick={handleCancel}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: '1px solid rgba(255,255,255,0.3)',
              backgroundColor: 'transparent',
              color: 'white',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
          >
            ×
          </button>
        </>
      )}
    </div>
  )
}

