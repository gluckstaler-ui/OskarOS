'use client'

/**
 * PresetsStaging — Zone 3 of Advanced Mode
 *
 * WP-2B: Preset pills (category-grouped).
 * WP-4: Compose staging (Scene + Subject slots, toggle, reset, +).
 * WP-5: Layout staging (Hero + Cell slots, reset, +).
 *
 * 2026-04-18: Ask CD textarea/button/feedback REMOVED from this zone.
 * Moved to the new ImageChatPanel (chat column). Zone 3 is now presets-only.
 * One CD, one log — the chat column owns every Ask CD interaction and the
 * shared conversation history with Studio Briefing.
 */

import { memo, useCallback, useMemo } from 'react'
import type { AdvancedTab, ComposeStaging, LayoutStaging } from '@/components/AdvancedMode'
import { getPresetsForMode, Preset } from '@/lib/image-presets'
import type { SourceImage } from '@/lib/types'

export interface PresetsStagingProps {
  activeTab: AdvancedTab
  activePresetLabel: string | null
  onPresetSelect: (preset: Preset) => void
  // Compose staging
  composeStaging: ComposeStaging
  onComposeReset: () => void
  // Layout staging
  layoutStaging: LayoutStaging
  onLayoutReset: () => void
  onLayoutAddSlot: () => void
  onLayoutSlotClick: (index: number) => void
  // For rendering slot thumbnails
  sourceImages: SourceImage[]
  // Ask CD in Zone 3 — only rendered when the chat column is in Preview mode
  // (the normal chat-column Ask CD input is replaced by the vibe iframe, so
  // we bring the input back here). CD replies still surface via snackbar.
  showAskCD?: boolean
  cdMessage?: string
  onCDMessageChange?: (value: string) => void
  onSendToCD?: () => void
  isCDLoading?: boolean
  cdFeedback?: string | null
}

const MODE_COLORS: Record<AdvancedTab, string> = {
  view: 'var(--text-dim)',
  generate: '#F59E0B',
  edit: '#3B82F6',
  compose: '#8B5CF6',
  layout: '#10B981',
  brand: '#EC4899', // WP-B5 — never actually renders (brand tab skips PresetsStaging) but required by the exhaustive Record
}

function PresetsStagingImpl({
  activeTab,
  activePresetLabel,
  onPresetSelect,
  composeStaging,
  onComposeReset,
  layoutStaging,
  onLayoutReset,
  onLayoutAddSlot,
  onLayoutSlotClick,
  showAskCD = false,
  cdMessage = '',
  onCDMessageChange,
  onSendToCD,
  isCDLoading = false,
  cdFeedback = null,
}: PresetsStagingProps) {
  const categories = useMemo(() => getPresetsForMode(activeTab), [activeTab])
  const accentColor = MODE_COLORS[activeTab]

  if (activeTab === 'view') {
    return null
  }

  return (
    <div
      style={{
        // Fill parent bento-card; no self-positioning
        flex: 1,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {/* Presets header */}
      <div
        style={{
          fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
          color: 'var(--text-muted)', padding: '12px 16px 16px', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        Presets
      </div>

      {/* WP-13B: Scrollable preset pills — single flex-wrap container.
          Category labels and their pills flow inline across visual lines as
          one logical stream: FILTERS:  [pill] [pill]  OBJECT EDITS:  [pill]  … */}
      <div
        style={{
          overflowY: 'auto',
          padding: '0 16px 8px',
          flexShrink: 0,
          maxHeight: activeTab === 'compose' || activeTab === 'layout' ? 120 : undefined,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 5,
            rowGap: 6,
          }}
        >
          {categories.flatMap((cat, catIdx) => [
            <span
              key={`cat-${cat.label}`}
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-dim)',
                lineHeight: '24px',
                whiteSpace: 'nowrap',
                paddingLeft: catIdx > 0 ? 10 : 0,
                paddingRight: 2,
              }}
            >
              {cat.label}:
            </span>,
            ...cat.presets.map((preset) => (
              <PresetPill
                key={`${cat.label}-${preset.label}`}
                preset={preset}
                isActive={preset.label === activePresetLabel}
                accentColor={accentColor}
                onSelect={onPresetSelect}
              />
            )),
          ])}
        </div>
      </div>

      {/* Compose staging area */}
      {activeTab === 'compose' && (
        <>
          <div style={{ height: 1, margin: '0 16px', background: 'var(--border-card)', flexShrink: 0 }} />
          <ComposeStagingArea staging={composeStaging} onReset={onComposeReset} />
        </>
      )}

      {/* Layout staging area */}
      {activeTab === 'layout' && (
        <>
          <div style={{ height: 1, margin: '0 16px', background: 'var(--border-card)', flexShrink: 0 }} />
          <LayoutStagingArea staging={layoutStaging} onReset={onLayoutReset} onAddSlot={onLayoutAddSlot} onSlotClick={onLayoutSlotClick} />
        </>
      )}

      {/* Ask CD — only when the chat column is in Preview mode (then the
          chat input is not reachable). Reply surfaces as a snackbar (and
          the shared chat log). */}
      {showAskCD && (
        <>
          <div style={{ height: 1, margin: '4px 16px 0', background: 'var(--border-card)', flexShrink: 0 }} />
          <div
            style={{
              fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              color: 'var(--text-muted)', padding: '10px 16px 6px', flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Ask CD
            {isCDLoading && (
              <span style={{ fontSize: 9, color: '#F59E0B', fontWeight: 600 }}>Thinking…</span>
            )}
          </div>
          <div style={{ flex: 1, margin: '0 16px 8px', background: 'var(--bg-card-hover)', border: `1px solid ${isCDLoading ? '#F59E0B' : 'var(--border-active)'}`, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 120 }}>
            <textarea
              placeholder="Ask the Creative Director — evaluate, suggest a prompt, or get a second opinion. Reply appears as a snackbar."
              value={cdMessage}
              onChange={(e) => onCDMessageChange?.(e.target.value)}
              disabled={isCDLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && (cdMessage || '').trim() && !isCDLoading) {
                  e.preventDefault()
                  onSendToCD?.()
                }
              }}
              style={{
                flex: 1, background: 'transparent', border: 'none', color: 'var(--text-main)',
                fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55, padding: '10px 12px',
                resize: 'none', outline: 'none', opacity: isCDLoading ? 0.5 : 1,
              }}
            />
          </div>
          {cdFeedback && !isCDLoading && (
            <div style={{ padding: '0 16px 4px', fontSize: 10, color: 'var(--text-dim)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }} title={cdFeedback}>
              CD: {cdFeedback.length > 90 ? cdFeedback.slice(0, 90) + '…' : cdFeedback}
            </div>
          )}
          <div style={{ flexShrink: 0, padding: '0 16px 14px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => onSendToCD?.()}
              disabled={isCDLoading || !(cdMessage || '').trim()}
              style={{
                height: 32, padding: '0 14px', borderRadius: 8, border: 'none',
                background: '#F59E0B', color: '#fff', fontSize: 11, fontWeight: 700,
                cursor: isCDLoading || !(cdMessage || '').trim() ? 'not-allowed' : 'pointer',
                opacity: isCDLoading || !(cdMessage || '').trim() ? 0.4 : 1,
                fontFamily: 'inherit', letterSpacing: '0.05em', textTransform: 'uppercase',
              }}
            >
              {isCDLoading ? 'Thinking…' : 'Send to CD'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================================
// Compose Staging Area
// ============================================================================

function ComposeStagingArea({ staging, onReset }: { staging: ComposeStaging; onReset: () => void }) {
  const hasAny = staging.sceneImage || staging.subjectImages.length > 0
  return (
    <div style={{ padding: '8px 16px', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginRight: 4 }}>Scene:</span>
      <StagingSlot image={staging.sceneImage} color="#8B5CF6" label="Scene" isActive={!staging.sceneImage} />
      <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>&rarr;</span>
      {staging.subjectImages.length > 0 ? (
        staging.subjectImages.map((img, i) => (
          <StagingSlot key={img.id} image={img} color="#F59E0B" label="Subj" />
        ))
      ) : (
        <>
          <StagingSlot image={null} color="#F59E0B" label="+" isActive={!!staging.sceneImage} />
          <StagingSlot image={null} color="#F59E0B" label="+" />
          <StagingSlot image={null} color="#F59E0B" label="+" />
        </>
      )}
      {staging.subjectImages.length > 0 && staging.subjectImages.length < 5 && (
        <StagingSlot image={null} color="#F59E0B" label="+" isActive />
      )}
      {hasAny && <ResetButton onClick={onReset} />}
    </div>
  )
}

// ============================================================================
// Layout Staging Area
// ============================================================================

function LayoutStagingArea({
  staging, onReset, onAddSlot, onSlotClick,
}: {
  staging: LayoutStaging; onReset: () => void; onAddSlot: () => void; onSlotClick: (i: number) => void
}) {
  const hasAny = staging.slots.some(Boolean)
  return (
    <div style={{ padding: '8px 16px', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginRight: 4 }}>Grid:</span>
      {staging.slots.map((img, i) => (
        <div key={i} onClick={() => onSlotClick(i)} style={{ cursor: 'pointer' }}>
          <StagingSlot
            image={img}
            color="#10B981"
            label={i === 0 ? 'Hero' : String(i + 1)}
            isActive={i === staging.activeSlotIndex}
            isHero={i === 0}
          />
        </div>
      ))}
      {staging.slots.length < 8 && (
        <button onClick={onAddSlot} style={{ width: 48, height: 48, borderRadius: 5, border: '1px dashed var(--border-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer', background: 'transparent', flexShrink: 0 }}>
          +
        </button>
      )}
      {hasAny && <ResetButton onClick={onReset} />}
    </div>
  )
}

// ============================================================================
// Shared: StagingSlot + ResetButton
// ============================================================================

function StagingSlot({
  image, color, label, isActive, isHero,
}: {
  image: SourceImage | null; color: string; label: string; isActive?: boolean; isHero?: boolean
}) {
  const width = isHero && !image ? 64 : 48
  const filled = !!image
  return (
    <div
      style={{
        width, height: 48, borderRadius: 5,
        border: filled ? `1.5px solid ${color}` : isActive ? `1.5px dashed ${color}` : '1.5px dashed var(--border-card)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden', flexShrink: 0,
        backgroundSize: 'cover', backgroundPosition: 'center',
        backgroundImage: image ? `url(${image.path})` : 'none',
        backgroundColor: filled ? undefined : isActive ? `${color}08` : 'transparent',
      }}
    >
      {!filled && (
        <span style={{ fontSize: 7, fontWeight: 700, color: 'var(--text-dim)' }}>{label}</span>
      )}
      {filled && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          fontSize: 6, fontWeight: 700, textAlign: 'center', padding: 2,
          color: '#fff', textTransform: 'uppercase', background: color,
        }}>
          {label}
        </div>
      )}
    </div>
  )
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 22, padding: '0 8px', borderRadius: 4,
        border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.04)',
        color: '#EF4444', fontSize: 8, fontWeight: 700, cursor: 'pointer',
        marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2,
        fontFamily: 'inherit',
      }}
    >
      ✕ Reset
    </button>
  )
}

// ============================================================================
// PresetPill (WP-2B; CategorySection retired in WP-13B when categories and
// pills were flattened into a single flex-wrap container — see the render
// site above for the current inline layout.)
// ============================================================================

function PresetPill({ preset, isActive, accentColor, onSelect }: {
  preset: Preset; isActive: boolean; accentColor: string; onSelect: (p: Preset) => void
}) {
  const handleClick = useCallback(() => onSelect(preset), [preset, onSelect])
  // WP-9: Tooltip showing first line of prompt so Ralph can see what each pill does
  const tooltip = useMemo(() => {
    if (preset.kind === 'generate' && 'prompt' in preset) {
      const firstLine = preset.prompt.split('\n')[0].trim()
      return firstLine.length > 100 ? firstLine.slice(0, 100) + '…' : firstLine
    }
    return `${preset.kind}: ${preset.label}`
  }, [preset])
  return (
    <button
      onClick={handleClick}
      title={tooltip}
      style={{
        height: 24, padding: '0 11px', borderRadius: 12,
        border: `1px solid ${isActive ? accentColor : 'var(--border-card)'}`,
        background: isActive ? `${accentColor}20` : 'transparent',
        color: isActive ? accentColor : 'var(--text-muted)',
        fontWeight: isActive ? 700 : 500,
        fontSize: 11, cursor: 'pointer', transition: 'all 0.15s',
        whiteSpace: 'nowrap', fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => { if (!isActive) { const el = e.currentTarget; el.style.borderColor = 'var(--border-active)'; el.style.color = 'var(--text-main)'; el.style.background = 'var(--hover-overlay)' } }}
      onMouseLeave={(e) => { if (!isActive) { const el = e.currentTarget; el.style.borderColor = 'var(--border-card)'; el.style.color = 'var(--text-muted)'; el.style.background = 'transparent' } }}
    >
      {preset.label}
    </button>
  )
}

export const PresetsStaging = memo(PresetsStagingImpl)
