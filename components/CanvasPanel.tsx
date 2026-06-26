'use client'

import { useState, useEffect } from 'react'
import { ImageAsset, VibeData, VibePreview, AspectRatio, ImageSize } from '@/lib/types'
import { LivePreviewWithDirector } from './studio/LivePreviewWithDirector'

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
  availableVibes?: VibePreview[]
  selectedVibeFile?: string | null
  onVibeFileSelect?: (filename: string) => void
  onVibeDelete?: (filename: string) => void
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
  availableVibes = [],
  selectedVibeFile = null,
  onVibeFileSelect,
  onVibeDelete
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


  // STUDIO vibe split (2026-06-19): root-folder vibes render as the canvas
  // tab row; subfolder vibes (Old_Vibes/, "Silke Lengler/…") go into the
  // archive dropdown on the second row. parentDir is threaded from the
  // gallery API → availableVibes; null/undefined = root.
  const rootVibes = availableVibes.filter(v => !v.parentDir)
  const subfolderVibes = availableVibes.filter(v => !!v.parentDir)
  const subfolderGroups = subfolderVibes.reduce<Record<string, VibePreview[]>>((acc, v) => {
    const dir = v.parentDir || 'Other'
    ;(acc[dir] ||= []).push(v)
    return acc
  }, {})

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
          {/* Root-folder vibes render as tabs. Subfolder vibes live in the
              archive dropdown on the second row below this toolbar. */}
          {rootVibes.length > 0 ? (
            rootVibes.map((vibe, idx) => {
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
          ) : availableVibes.length > 0 ? (
            /* No root vibes, but subfolder vibes exist → they're in the
               archive dropdown on the second row. */
            <span style={{
              padding: '6px 16px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Alle Vibes im Archiv ↓
            </span>
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
      {/* ARCHIVE ROW (second line) — subfolder vibes in a dropdown         */}
      {/* Root vibes are the tabs above; everything in Old_Vibes/ and other  */}
      {/* subfolders is reachable here without cluttering the tab strip.     */}
      {/* ================================================================== */}
      {subfolderVibes.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 20px',
          borderBottom: '1px solid var(--border-card)',
          backgroundColor: 'var(--bg-card)',
          flexShrink: 0,
          zIndex: 19,
        }}>
          <span style={{
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
          }}>
            Archiv
          </span>
          <select
            value={activeVibe?.parentDir ? activeVibe.htmlPath : ''}
            onChange={(e) => {
              const path = e.target.value
              if (!path || !onVibeFileSelect) return
              const v = subfolderVibes.find(s => s.htmlPath === path)
              if (v) {
                onVibeFileSelect(v.filename)
                onClearAsset()
              }
            }}
            style={{
              flex: 1,
              maxWidth: '460px',
              padding: '6px 10px',
              fontSize: '12px',
              backgroundColor: 'var(--bg-app)',
              border: '1px solid var(--border-card)',
              borderRadius: '6px',
              color: 'var(--text-main)',
              cursor: 'pointer',
            }}
          >
            <option value="">
              {subfolderVibes.length} archivierte Vibe{subfolderVibes.length === 1 ? '' : 's'} — auswählen…
            </option>
            {Object.entries(subfolderGroups).map(([dir, list]) => (
              <optgroup key={dir} label={dir}>
                {list.map(v => (
                  <option key={v.htmlPath} value={v.htmlPath}>{v.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}

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
            {/* Director preview — UNIFIED on LivePreviewWithDirector, the SAME
                component the gallery uses. The bespoke studio director (its own
                iframe + postMessage bridge + STUDIO_BRIDGE_PATCH) was ripped out
                per Ralph 2026-06-16. Controlled by the studio's existing Director
                button via `directorMode`; its built-in button is hidden. */}
            <LivePreviewWithDirector
              htmlPath={vibeToShow.htmlPath || null}
              title={vibeToShow.name}
              surface="studio"
              directorMode={directorMode}
              onDirectorModeChange={(v) => { if (v !== directorMode) onToggleDirectorMode?.() }}
              hideBuiltInDirectorButton
            />


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

