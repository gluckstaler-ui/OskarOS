'use client'

/**
 * ImageChatPanel — the chat column for IMAGE (Advanced) mode.
 *
 * Purpose (per Ralph 2026-04-18 layout call):
 *   - Chat belongs in IMAGE view. WP-15 writes every Ask CD interaction to
 *     SESSION.md as a paper trail; without a visible chat panel the user
 *     can't read it. Snackbars auto-dismiss; this is the audit surface.
 *   - Shared conversation with Studio's Briefing — same `messages` array,
 *     same bridge. One CD, one log. Filter hides [OSKAR-SYSTEM *] system
 *     turns so the user sees human-readable conversation only.
 *   - Ask CD input lives at the BOTTOM of this panel (natural chat UX).
 *     PresetsStaging's Zone 3 becomes presets-only.
 *
 * Header has TWO independent toggles (both always visible):
 *   1. CHAT ↔ PREVIEW — switches panel content (chat feed vs vibe iframe).
 *   2. NARROW ↔ WIDE — toggles column width (2 cols vs 6 cols in the 12-col grid).
 *
 * Snackbar note: when column width is NARROW, CD's reply also fires a
 * snackbar (emitCDComment in AdvancedMode.handleAskCD for tier 5) so the
 * user gets a prominent signal even if they're not looking at the feed.
 * The chat feed still shows the full paper trail — snackbar is an alert,
 * not a replacement.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConversationMessage, SourceImage } from '@/lib/types'
import {
  LivePreviewWithDirector,
  type LivePreviewWithDirectorHandle,
} from '@/components/studio/LivePreviewWithDirector'

export type ImageChatContent = 'chat' | 'vibe'

interface VibeOption {
  label: string
  htmlPath: string
}

export interface ImageChatPanelProps {
  sessionId: string
  /** Shared conversation with Briefing — same underlying bridge turns. */
  messages: ConversationMessage[]
  /** User's question text from the input at the bottom. Parent calls /api/ask-cd. */
  onAskCD: (userMessage: string) => Promise<void> | void
  /** True while an Ask CD turn is in flight. */
  isLoading?: boolean

  /** Expand/collapse state — controlled by parent layout. */
  expanded: boolean
  onToggleExpand: () => void

  /** Only used when expanded — picks Chat vs Vibe Preview. */
  contentMode: ImageChatContent
  onContentModeChange: (mode: ImageChatContent) => void

  /** Vibe HTML files the user can preview (only when expanded + vibe mode). */
  vibeOptions?: VibeOption[]
  /** Currently-selected vibe path for preview — null = first option or none. */
  selectedVibePath?: string | null
  onSelectVibePath?: (htmlPath: string) => void
  /** The image currently selected in Zone 1 (asset grid). Director Mode
   *  in the preview uses this as the primary-click swap source. */
  zone1SelectedImage?: { filename: string; sessionId: string } | null
  /** Ralph 2026-04-23: forwarded to the embedded preview so AI-edits
   *  performed inside Director Mode surface in the parent's AssetsPanel. */
  onImageGenerated?: (image: SourceImage) => void
}

export function ImageChatPanel({
  sessionId,
  messages,
  onAskCD,
  isLoading = false,
  expanded,
  onToggleExpand,
  contentMode,
  onContentModeChange,
  vibeOptions = [],
  selectedVibePath,
  onSelectVibePath,
  zone1SelectedImage = null,
  onImageGenerated,
}: ImageChatPanelProps) {
  const [input, setInput] = useState('')
  const feedRef = useRef<HTMLDivElement>(null)
  // Director Mode lives in the header (right side, same line as CHAT/PREVIEW).
  // Default OFF — user explicitly opts in by clicking the toggle. Previously
  // defaulted ON, but mount-time initialization raced with iframe hydration
  // and Director Mode was unreliable on fresh page load. Defaulting OFF
  // means the user only turns it ON after the iframe is definitely ready,
  // so setup always runs against a live document. (Matches Claude Design
  // and Gemini Stitch which also default-off their edit mode.)
  const [directorMode, setDirectorMode] = useState(false)
  // Ref to the live preview so header buttons can call .revertAll() / .saveAll()
  const previewRef = useRef<LivePreviewWithDirectorHandle>(null)

  // Hide [OSKAR-SYSTEM *] turns + CD's structured replies to system messages
  // (same filter as Studio ConversationPanel). Keeps the paper trail readable.
  const visibleMessages = useMemo(() => {
    return messages.filter((msg) => {
      const c = msg.content || ''
      if (c.startsWith('[OSKAR-SYSTEM ')) return false
      if (msg.role === 'assistant') {
        const t = c.trim()
        if (t.startsWith('## SEVERITY') || t.startsWith('## VERDICT')) return false
      }
      return true
    })
  }, [messages])

  // Auto-scroll to newest message on every update.
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [visibleMessages.length, isLoading])

  async function handleSubmit() {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return
    setInput('')
    await onAskCD(trimmed)
  }

  return (
    <div
      style={{
        // flex:1 + width:100% so this fills the bento-card's flex parent.
        // Without it, the root stayed at ~287px in WIDE mode even though
        // the bento-card was 2832px — children measured the wrong width
        // and the scaled iframe never grew.
        flex: 1,
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {/* HEADER — CHAT/PREVIEW is always visible. NARROW/WIDE only shows when
          content mode = chat. In PREVIEW mode the column is force-widened
          by the parent (vibe pages with `100vh` heroes can't be scaled —
          the hero background stretches to fill the inflated iframe height
          and looks like a cropped desert slice. The fix isn't scaling;
          the fix is: preview always renders at WIDE, no other option). */}
      <div
        style={{
          minHeight: 56,
          borderBottom: '1px solid var(--border-card)',
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        {/* Toggle 1 — CHAT / PREVIEW (content) */}
        <ToggleGroup
          value={contentMode}
          onChange={(v) => onContentModeChange(v as ImageChatContent)}
          options={[
            { value: 'chat', label: 'Chat' },
            { value: 'vibe', label: 'Preview' },
          ]}
          activeColor="var(--accent, #3B82F6)"
        />

        <div style={{ flex: 1, minWidth: 4 }} />

        {/* Toggle 2 — NARROW / WIDE (column width). Only in CHAT mode. */}
        {contentMode === 'chat' && (
          <ToggleGroup
            value={expanded ? 'wide' : 'narrow'}
            onChange={(v) => {
              if ((v === 'wide') !== expanded) onToggleExpand()
            }}
            options={[
              { value: 'narrow', label: 'Narrow' },
              { value: 'wide', label: 'Wide' },
            ]}
            activeColor="var(--text-muted, #6B7280)"
          />
        )}

        {/* Revert — rendered BEFORE Edit HTML in DOM order so that when
            editing toggles on, Revert appears to the LEFT of the Edit HTML
            button and Edit HTML stays in the same position. Rendering
            Revert after Edit HTML would push Edit HTML sideways when it
            appears ("the button jumps"). Only visible in Preview mode when
            editing is ON. Save is handled automatically on leave (toggle-off,
            unmount, beforeunload via sendBeacon, pagehide, visibilitychange);
            Revert stays explicit because it's destructive. */}
        {contentMode === 'vibe' && directorMode && (
          <button
            onClick={() => previewRef.current?.revertAll()}
            title="Undo every edit since Edit HTML turned on"
            style={{
              padding: '5px 10px', borderRadius: 6,
              border: '1px solid rgba(239,68,68,0.55)',
              background: 'rgba(239,68,68,0.16)', color: 'rgba(239,68,68,1)',
              fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            Revert
          </button>
        )}

        {/* Toggle 3 — EDIT HTML (click-to-edit). Only in PREVIEW mode.
            Right side of the header, same line as CHAT/PREVIEW per Ralph.
            OFF = green CTA ("click to start editing"); ON = recessed white
            with a visible slate border so it reads on both the Onyx dark
            header and the Polar light header. Save-on-leave is wired in
            LivePreviewWithDirector (beforeunload + pagehide + visibility +
            unmount + toggle-off → saveAll/sendBeacon); no manual Save needed. */}
        {contentMode === 'vibe' && (
          <button
            onClick={() => setDirectorMode((m) => !m)}
            title={
              directorMode
                ? 'Editing HTML — click any image or text in the preview to edit'
                : 'Click to edit HTML directly in the preview'
            }
            style={{
              padding: '5px 11px',
              borderRadius: 6,
              border: directorMode
                ? '1px solid #cbd5e1'
                : '1px solid var(--success)',
              background: directorMode ? '#ffffff' : 'var(--success)',
              color: directorMode ? '#0f172a' : '#ffffff',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
          >
            {/* Feather edit-3 — pencil on baseline */}
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Edit HTML
          </button>
        )}
      </div>

      {/* BODY — chat feed OR vibe preview iframe (content follows contentMode regardless of width) */}
      {contentMode === 'vibe' ? (
        <VibePreviewBody
          sessionId={sessionId}
          options={vibeOptions}
          selected={selectedVibePath}
          onSelect={(p) => onSelectVibePath?.(p)}
          directorMode={directorMode}
          onDirectorModeChange={setDirectorMode}
          zone1SelectedImage={zone1SelectedImage}
          previewRef={previewRef}
          onImageGenerated={onImageGenerated}
        />
      ) : (
        <>
          {/* Chat feed */}
          <div
            ref={feedRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
            className="image-chat-feed"
          >
            {visibleMessages.length === 0 ? (
              <div
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 13,
                  fontStyle: 'italic',
                  textAlign: 'center',
                  paddingTop: 24,
                  lineHeight: 1.6,
                }}
              >
                No conversation yet.
                <br />
                Ask CD about your current image.
              </div>
            ) : (
              visibleMessages.map((msg) => (
                <ChatBubble key={msg.id} role={msg.role} content={msg.content} />
              ))
            )}
            {isLoading && (
              <div
                style={{
                  color: 'var(--text-dim)',
                  fontSize: 12,
                  fontStyle: 'italic',
                  padding: '8px 12px',
                }}
              >
                CD is thinking…
              </div>
            )}
          </div>

          {/* Ask CD input */}
          <div
            style={{
              borderTop: '1px solid var(--border-card)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              flexShrink: 0,
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder="Ask CD — evaluate, suggest a prompt, or get a second opinion"
              rows={6}
              style={{
                width: '100%',
                background: 'var(--bg-app)',
                border: '1px solid var(--border-card)',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 14,
                lineHeight: 1.55,
                color: 'var(--text-main)',
                fontFamily: 'inherit',
                resize: 'none',
                outline: 'none',
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: 'none',
                background: input.trim() && !isLoading ? '#F59E0B' : 'var(--bg-app)',
                color: input.trim() && !isLoading ? '#fff' : 'var(--text-dim)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                cursor: input.trim() && !isLoading ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
              }}
            >
              {isLoading ? 'Thinking…' : 'Send to CD'}
            </button>
          </div>
        </>
      )}

      <style jsx>{`
        .image-chat-feed::-webkit-scrollbar {
          width: 4px;
        }
        .image-chat-feed::-webkit-scrollbar-thumb {
          background: var(--border-card);
          border-radius: 2px;
        }
      `}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Toggle group — two-state pill used for CHAT/PREVIEW and NARROW/WIDE
// ─────────────────────────────────────────────────────────────────────────────

function ToggleGroup({
  value,
  onChange,
  options,
  activeColor,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  activeColor: string
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 2,
        background: 'var(--pill-bg)',
        borderRadius: 6,
        border: '1px solid var(--pill-border)',
      }}
    >
      {options.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              padding: '3px 9px',
              borderRadius: 4,
              border: 'none',
              background: active ? activeColor : 'transparent',
              color: active ? '#fff' : 'var(--text-muted)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat bubble — narrow-column-friendly
// ─────────────────────────────────────────────────────────────────────────────

function ChatBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  const isUser = role === 'user'
  return (
    <div
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        // Cap at 720px regardless of column width — chat bubbles on Slack/
        // WhatsApp/iMessage have a max readable width; stretching to 2000px
        // makes text look scaled-down relative to the giant container.
        // The `min(92%, 720px)` gives comfortable 92% in narrow columns
        // and a hard ceiling in wide columns.
        maxWidth: 'min(92%, 720px)',
        padding: '12px 16px',
        borderRadius: 12,
        background: isUser ? 'var(--bg-card-hover, #1f2937)' : 'var(--bg-app)',
        border: `1px solid var(--border-card)`,
        fontSize: 15,
        lineHeight: 1.6,
        color: 'var(--text-main)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
          marginBottom: 6,
        }}
      >
        {isUser ? 'You' : 'CD'}
      </div>
      {content}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Vibe Preview body — only rendered when expanded + contentMode === 'vibe'
// ─────────────────────────────────────────────────────────────────────────────

function VibePreviewBody({
  sessionId,
  options,
  selected,
  onSelect,
  directorMode,
  onDirectorModeChange,
  zone1SelectedImage,
  previewRef,
  onImageGenerated,
}: {
  sessionId: string
  options: VibeOption[]
  selected: string | null | undefined
  onSelect: (htmlPath: string) => void
  directorMode: boolean
  onDirectorModeChange: (next: boolean) => void
  zone1SelectedImage: { filename: string; sessionId: string } | null
  previewRef: React.RefObject<LivePreviewWithDirectorHandle | null>
  onImageGenerated?: (image: SourceImage) => void
}) {
  const current = selected || options[0]?.htmlPath || null

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Picker */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-card)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
          }}
        >
          Vibe
        </span>
        <select
          value={current || ''}
          onChange={(e) => onSelect(e.target.value)}
          style={{
            flex: 1,
            background: 'var(--bg-app)',
            border: '1px solid var(--border-card)',
            borderRadius: 4,
            color: 'var(--text-main)',
            fontSize: 11,
            padding: '4px 8px',
            fontFamily: 'inherit',
          }}
        >
          {options.length === 0 ? (
            <option value="">No vibes built yet</option>
          ) : (
            options.map((o) => (
              <option key={o.htmlPath} value={o.htmlPath}>
                {o.label}
              </option>
            ))
          )}
        </select>
      </div>

      {/* Preview body — controlled Director Mode. Toggle lives in the
          panel header (right side) instead of floating over the iframe. */}
      {current ? (
        <LivePreviewWithDirector
          ref={previewRef}
          key={current}
          htmlPath={current}
          title={options.find((o) => o.htmlPath === current)?.label}
          emptyMessage="No vibe selected"
          showOpenInNewTab={false}
          directorMode={directorMode}
          onDirectorModeChange={onDirectorModeChange}
          hideBuiltInDirectorButton={true}
          // Image Mode provides Ask CD in Zone 3 — suppress the in-iframe overlay
          hideAskCDOverlay={true}
          surface="image"
          zone1SelectedImage={zone1SelectedImage}
          onImageGenerated={onImageGenerated}
        />
      ) : (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            textAlign: 'center',
            color: 'var(--text-dim)',
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          No vibes to preview.
          <br />
          <span style={{ fontSize: 11, marginTop: 4 }}>
            Build a vibe in Studio first — then return here to see it with the current image.
          </span>
        </div>
      )}
    </div>
  )
}
