'use client'

/**
 * PromptEditor — Zone 4 of Advanced Mode
 *
 * Prompt textarea + aspect ratio pills + resolution pills + Generate button.
 *
 * WP-1A: basic textarea + pills, Generate button logs payload (no API call).
 * WP-2B: wires preset pills → prompt content.
 * WP-2C: wires Generate button → /api/edit-image.
 *
 * Exposes a ref-based insertAtCursor method so Zone 2's copy button can
 * insert the description at the current cursor position (non-destructive).
 */

import { memo, forwardRef, useImperativeHandle, useRef } from 'react'
import { AspectRatio, ImageSize } from '@/lib/types'

export interface PromptEditorProps {
  activeTab: 'view' | 'generate' | 'edit' | 'compose' | 'layout' | 'brand'
  prompt: string
  onPromptChange: (value: string) => void
  aspectRatio: AspectRatio
  onAspectRatioChange: (ar: AspectRatio) => void
  resolution: ImageSize
  onResolutionChange: (res: ImageSize) => void
  onGenerate: () => void
  isGenerating?: boolean
  /** Error message from last failed generation (cleared on next attempt). */
  generationError?: string | null
  /** Retry the last failed generation with the same payload. */
  onRetry?: () => void
  /** WP-1D: Where the current prompt came from (shown as indicator next to the label). */
  promptSource?: 'manifest' | 'reprompt' | 'sourcePrompt' | 'none' | 'modified'
  /** WP-13A: Reset handler — restores the last-loaded prompt (waterfall/preset/CD) */
  onReset?: () => void
  /** WP-13A: True if the current prompt differs from the loaded baseline */
  canReset?: boolean
  /** Ralph 2026-04-23: Send the current prompt to CD for refinement.
   *  CD's refined `## IMAGE PROMPT` replaces Zone 4 on return (handled
   *  by the parent's handleAskCD). Button sits between Reset and Generate. */
  onReviewAI?: () => void
  /** True while a Review-AI round-trip is in flight. */
  isReviewingAI?: boolean
}

// WP-1D: Labels + colors for the prompt source indicator
const PROMPT_SOURCE_META: Record<
  NonNullable<PromptEditorProps['promptSource']>,
  { label: string; color: string }
> = {
  manifest: { label: 'From IMAGES.md', color: '#10B981' },
  reprompt: { label: 'Reprompt', color: '#8B5CF6' },
  sourcePrompt: { label: 'From generation', color: '#3B82F6' },
  modified: { label: 'Modified', color: '#F59E0B' },
  none: { label: 'New', color: 'var(--text-dim)' },
}

export interface PromptEditorHandle {
  /** Insert text at the current cursor position (non-destructive). */
  insertAtCursor: (text: string) => void
  /** Get the underlying textarea element (for direct cursor-position queries). */
  getTextarea: () => HTMLTextAreaElement | null
}

const ASPECT_RATIOS: AspectRatio[] = ['1:1', '16:9', '9:16', '3:4', '4:3']
const RESOLUTIONS: ImageSize[] = ['1K', '2K', '4K']

const MODE_COLORS = {
  view: 'var(--text-dim)',
  generate: '#F59E0B',
  edit: '#3B82F6',
  compose: '#8B5CF6',
  layout: '#10B981',
  brand: '#EC4899',
} as const

const PLACEHOLDERS = {
  view: '',
  generate: 'Describe the image you want in detail — subject, style, lighting, mood, composition, colors…',
  edit: 'Select an image and a preset above, or write your own editing instruction here…',
  compose: 'Choose a preset and select images — the prompt builds automatically as you click. Edit freely to refine.',
  layout: 'Choose a grid preset and assign images to slots — the prompt builds automatically. Add style notes here.',
  brand: 'Pick a Brand preset — the prompt loads with placeholder tokens. Fill them in, or leave blanks for Nano to invent.',
} as const

function PromptEditorImpl(
  {
    activeTab,
    prompt,
    onPromptChange,
    aspectRatio,
    onAspectRatioChange,
    resolution,
    onResolutionChange,
    onGenerate,
    isGenerating,
    generationError,
    onRetry,
    promptSource,
    onReset,
    canReset,
    onReviewAI,
    isReviewingAI,
  }: PromptEditorProps,
  ref: React.Ref<PromptEditorHandle>
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useImperativeHandle(ref, () => ({
    getTextarea: () => textareaRef.current,
    insertAtCursor: (text: string) => {
      const ta = textareaRef.current
      if (!ta) {
        onPromptChange(prompt ? `${prompt}\n\n${text}` : text)
        return
      }
      const start = ta.selectionStart ?? prompt.length
      const end = ta.selectionEnd ?? prompt.length
      const before = prompt.slice(0, start)
      const after = prompt.slice(end)
      const separator = before && !before.endsWith('\n') ? '\n\n' : ''
      const trailer = after && !after.startsWith('\n') ? '\n\n' : ''
      const inserted = separator + text + trailer
      const newValue = before + inserted + after
      onPromptChange(newValue)
      requestAnimationFrame(() => {
        const ta2 = textareaRef.current
        if (!ta2) return
        const newCursor = start + inserted.length
        ta2.focus()
        ta2.setSelectionRange(newCursor, newCursor)
      })
    },
  }), [prompt, onPromptChange])

  const btnColor = MODE_COLORS[activeTab] ?? MODE_COLORS.generate
  const placeholder = PLACEHOLDERS[activeTab] ?? ''

  // In View mode, Zone 4 is hidden entirely (handled by parent)
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
      {/* Top bar: label + ratio + res */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px 10px',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Image Prompt
        </div>
        {/* WP-1D: Prompt source indicator */}
        {promptSource && (
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: PROMPT_SOURCE_META[promptSource].color,
              padding: '3px 8px',
              borderRadius: 4,
              border: `1px solid ${PROMPT_SOURCE_META[promptSource].color}`,
              background: `${PROMPT_SOURCE_META[promptSource].color}14`,
            }}
            title={`Prompt source: ${PROMPT_SOURCE_META[promptSource].label}`}
          >
            {PROMPT_SOURCE_META[promptSource].label}
          </div>
        )}
        <div style={{ flex: 1 }} />

        {/* Aspect ratio pills */}
        <PillGroup
          label="Ratio"
          options={ASPECT_RATIOS}
          value={aspectRatio}
          onChange={(v) => onAspectRatioChange(v as AspectRatio)}
        />

        {/* Resolution pills */}
        <PillGroup
          label="Res"
          options={RESOLUTIONS}
          value={resolution}
          onChange={(v) => onResolutionChange(v as ImageSize)}
        />
      </div>

      {/* Textarea */}
      <div
        style={{
          flex: 1,
          margin: '0 16px 8px',
          background: 'var(--bg-card-hover)',
          border: '1px solid var(--border-active)',
          borderRadius: 10,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => {
            // WP-9: Cmd+Enter (Mac) / Ctrl+Enter (Win) triggers Generate
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !isGenerating && prompt.trim()) {
              e.preventDefault()
              onGenerate()
            }
            // WP-9: Escape blurs focus (closes any pickers, returns focus to parent)
            if (e.key === 'Escape') {
              e.preventDefault()
              ;(e.target as HTMLElement).blur()
            }
          }}
          placeholder={placeholder}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-main)',
            fontFamily: 'inherit',
            fontSize: 14,
            lineHeight: 1.7,
            padding: '14px 18px',
            resize: 'none',
            outline: 'none',
            minHeight: 0,
          }}
        />
      </div>

      {/* Error banner */}
      {generationError && (
        <div
          style={{
            margin: '0 16px 8px',
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            color: '#f87171',
            lineHeight: 1.4,
          }}
        >
          <span style={{ flex: 1 }}>{generationError}</span>
          {onRetry && (
            <button
              onClick={onRetry}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid rgba(239,68,68,0.3)',
                background: 'rgba(239,68,68,0.1)',
                color: '#f87171',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Reset + Generate buttons (WP-13A: Reset left, Generate flex:1 right) */}
      <div
        style={{
          flexShrink: 0,
          padding: '0 16px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {/* WP-13A: Reset button — restores the last-loaded prompt (waterfall / preset / CD output).
            Disabled when current prompt already matches the loaded baseline. */}
        {onReset && (
          <button
            onClick={onReset}
            disabled={!canReset || isGenerating}
            title={
              canReset
                ? 'Reset prompt to the last-loaded value'
                : 'Nothing to reset — prompt matches loaded state'
            }
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 8,
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card-hover)',
              color: canReset ? 'var(--text-main)' : 'var(--text-dim)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              cursor: canReset && !isGenerating ? 'pointer' : 'not-allowed',
              opacity: canReset && !isGenerating ? 1 : 0.5,
              fontFamily: 'inherit',
              transition: 'all 0.12s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (canReset && !isGenerating) {
                ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border-active)'
              }
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border-card)'
            }}
          >
            Reset
          </button>
        )}

        {/* Review by AI — Ralph 2026-04-23. Hands the current prompt to CD
            via /api/ask-cd; CD returns a refined `## IMAGE PROMPT` that
            replaces Zone 4 (routed by the parent's handleAskCD, same tier-1/2
            path the chat panel already uses). Sits between Reset and
            Generate so the user can: tweak → review → generate. */}
        {onReviewAI && (
          <button
            onClick={onReviewAI}
            disabled={isReviewingAI || isGenerating || !prompt.trim()}
            title={
              prompt.trim()
                ? 'Ask CD to review + refine this prompt'
                : 'Write something first, then CD can review it'
            }
            style={{
              height: 34,
              padding: '0 14px',
              borderRadius: 8,
              border: '1px solid #F59E0B',
              background: 'transparent',
              color: '#F59E0B',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              cursor:
                isReviewingAI || isGenerating || !prompt.trim()
                  ? 'not-allowed'
                  : 'pointer',
              opacity: isReviewingAI || isGenerating || !prompt.trim() ? 0.5 : 1,
              fontFamily: 'inherit',
              transition: 'all 0.12s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (!isReviewingAI && !isGenerating && prompt.trim()) {
                ;(e.currentTarget as HTMLElement).style.background =
                  'rgba(245, 158, 11, 0.12)'
              }
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
          >
            {isReviewingAI ? 'Reviewing…' : 'Review by AI'}
          </button>
        )}

        <button
          onClick={onGenerate}
          disabled={isGenerating || !prompt.trim()}
          style={{
            flex: 1,
            height: 34,
            borderRadius: 8,
            border: 'none',
            background: btnColor,
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
            cursor: isGenerating || !prompt.trim() ? 'not-allowed' : 'pointer',
            transition: 'all 0.12s',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            opacity: isGenerating || !prompt.trim() ? 0.5 : 1,
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => {
            if (!isGenerating && prompt.trim()) {
              ;(e.currentTarget as HTMLElement).style.filter = 'brightness(1.15)'
            }
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLElement).style.filter = 'none'
          }}
        >
          {isGenerating ? 'Generating…' : 'Generate'}
        </button>
        {!isGenerating && (
          <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 4, whiteSpace: 'nowrap' }}>
            ⌘↵
          </span>
        )}
      </div>
    </div>
  )
}

export const PromptEditor = memo(forwardRef(PromptEditorImpl))

// ============================================================================
// Helper: Pill group for ratio/res selection
// ============================================================================
interface PillGroupProps {
  label: string
  options: readonly string[]
  value: string
  onChange: (v: string) => void
}

function PillGroup({ label, options, value, onChange }: PillGroupProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        background: 'var(--pill-bg)',
        borderRadius: 6,
        border: '1px solid var(--pill-border)',
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
          marginRight: 2,
          padding: '0 4px',
        }}
      >
        {label}
      </span>
      {options.map((opt) => {
        const active = opt === value
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: active ? '1px solid #10B981' : '1px solid transparent',
              background: active ? '#10B98120' : 'transparent',
              color: active ? '#10B981' : 'var(--text-muted)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.05em',
              cursor: 'pointer',
              transition: 'all 0.15s',
              boxShadow: active ? '0 1px 3px rgba(16,185,129,0.3)' : 'none',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!active) {
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text-main)'
                ;(e.currentTarget as HTMLElement).style.background = 'var(--hover-overlay)'
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                ;(e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'
                ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              }
            }}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}
