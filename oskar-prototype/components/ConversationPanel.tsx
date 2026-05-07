'use client'

import { useRef, useEffect } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { QuestionFormView } from './chat/QuestionForm'
import { DiscoveryQuestionsCard } from './chat/DiscoveryQuestionsCard'
import { ConfirmUnderstandingCard } from './chat/ConfirmUnderstandingCard'
import { UploadEvalCard } from './chat/UploadEvalCard'
import { UploadEvalBatchCard } from './chat/UploadEvalBatchCard'
import { BuildJobCard } from './chat/BuildJobCard'
// WP-22 Phase 1 (Ralph 2026-05-06): three new card kinds wired alongside
// the existing discovery / confirm / upload-eval set.
import { ScreenshotCard } from './chat/ScreenshotCard'
import { ApplyPatchCard } from './chat/ApplyPatchCard'
import { DiagnosticChip } from './chat/DiagnosticChip'
// WP-22 (Ralph 2026-05-06): top-right ambient overlay surface.
import { LiveOverlay } from './chat/LiveOverlay'
import {
  RECOMMEND_TODO_EVENT,
  type RecommendTodoEventDetail,
} from './chat/UnfinishedTodosPanel'
import { splitOnQuestionForms } from '@/lib/artifacts/question-form'
import { ConversationMessage, MoodboardData, LayoutMode, StreamingProgress } from '@/lib/types'

/**
 * Render a chat message that may contain inline <question-form> blocks.
 * Splits the content via lib/artifacts/question-form's splitOnQuestionForms,
 * then renders each segment: prose via MarkdownRenderer, form via
 * QuestionFormView. Provides a tactical bridge until WP-2.5 (AssistantMessage
 * scaffold) ships the proper integration.
 */
function MessageContent({
  content,
  interactive,
  onSubmitForm,
}: {
  content: string
  interactive: boolean
  onSubmitForm?: (text: string) => void
}) {
  const segments = splitOnQuestionForms(content)
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'text') {
          if (!seg.text.trim()) return null
          return <MarkdownRenderer key={i} content={seg.text} />
        }
        return (
          <div key={i} style={{ margin: '12px 0' }}>
            <QuestionFormView
              form={seg.form}
              interactive={interactive}
              onSubmit={onSubmitForm ? (text) => onSubmitForm(text) : undefined}
            />
          </div>
        )
      })}
    </>
  )
}

// ============================================================================
// CONVERSATION PANEL - COMPLETELY REWRITTEN TO MATCH BENTO.HTML
// ============================================================================

interface ConversationPanelProps {
  messages: ConversationMessage[]
  moodboard?: MoodboardData
  onSendMessage: (message: string, images?: File[]) => void
  onMoodboardSelect: (conceptName: string) => void
  isLoading: boolean
  layoutMode: LayoutMode
  streamingText?: string
  streamingProgress?: StreamingProgress
  /** Messages the user has sent while CD is streaming (FIFO). Drained
   *  automatically by the parent when CD's current turn completes. */
  queuedMessages?: string[]
  /** Cancel a queued message before it dispatches. Index into queuedMessages. */
  onCancelQueued?: (index: number) => void
  /**
   * Fires the existing build_all_vibes trigger path — wired by the
   * parent to whatever path the user typing "build all" would take.
   * Used by ConfirmUnderstandingCard's "Build it" button. Ralph 2026-05-04.
   */
  onTriggerBuildAll?: () => void
  /**
   * The actual CD model on the wire (raw identifier — claude-opus-4-7,
   * claude-sonnet-4-6, glm-4.6, etc.). Displayed read-only in the input
   * bar so the user can see at a glance which model is answering.
   * CLI mode populates from Claude CLI's system/init event (truth on
   * wire — when ANTHROPIC_BASE_URL is base-URL-piped to Z.ai, this
   * reports the GLM identifier). API mode populates from session
   * config since /api/chat sends exactly cfg.cdModel. Updates when CD
   * model changes (NOT WebDev — that's a separate model). Ralph 2026-05-04.
   */
  currentModel?: string | null
  /**
   * WP-22 / WP-66 (Ralph 2026-05-06): the active session id, used by the
   * top-right LiveOverlay to subscribe to `todos_updated` events and to
   * read the persisted `## Todos` section of SESSION.md. Optional — when
   * null, the overlay never mounts (pre-session state, no surface to push
   * onto). Builds in-flight pass through the parent state and arrive via
   * a future prop wave; v1 ships todos-only.
   */
  sessionId?: string | null
}

export function ConversationPanel({
  messages,
  moodboard,
  onSendMessage,
  onMoodboardSelect,
  isLoading,
  layoutMode,
  streamingText = '',
  streamingProgress,
  queuedMessages = [],
  onCancelQueued,
  onTriggerBuildAll,
  currentModel,
  sessionId = null,
}: ConversationPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText, streamingProgress])

  // WP-25 (Ralph 2026-05-06, cowork.jpg pattern): the TodoWrite panel is
  // read-only, but each non-completed row has a "recommend a change" button
  // that fires a window CustomEvent. Listen for it here and prefill the
  // chat textarea with `recommend: <content> — `, then focus the input so
  // the user can finish the sentence and send. CD picks it up and encodes
  // the change as a TodoWrite next turn. Read-only panel; chat is the
  // write path. Single-writer rule preserved.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<RecommendTodoEventDetail>).detail
      if (!detail || !inputRef.current) return
      const { todo, position } = detail
      const label =
        todo.status === 'in_progress' && todo.activeForm
          ? todo.activeForm
          : todo.content
      const prefill = `recommend on item ${position} (${label}) — `
      inputRef.current.value = prefill
      inputRef.current.focus()
      // Place caret at end so the user starts typing immediately after the
      // dash without having to manually click past the prefill.
      const len = prefill.length
      inputRef.current.setSelectionRange(len, len)
    }
    window.addEventListener(RECOMMEND_TODO_EVENT, handler)
    return () => {
      window.removeEventListener(RECOMMEND_TODO_EVENT, handler)
    }
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const value = inputRef.current?.value.trim()
    if (value) {
      onSendMessage(value)
      if (inputRef.current) {
        inputRef.current.value = ''
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter to submit (Shift+Enter for newline). Always enabled — when CD
    // is streaming, the parent queues the message instead of dispatching.
    // Lets the user keep composing without feeling stuck.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  // ============================================================================
  // RENDER - MATCHING BENTO.HTML STRUCTURE EXACTLY
  // ============================================================================
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--bg-card)',
      overflow: 'hidden',
      // WP-22: position context for the top-right LiveOverlay's absolute
      // anchor. Doesn't affect any existing flex children.
      position: 'relative',
    }}>
      {/* WP-22 (Ralph 2026-05-06): top-right ambient strip — TodoWrite
          queue + in-flight build mirrors. Renders nothing when empty;
          subscribes to `todos_updated` SSE for live updates. */}
      <LiveOverlay sessionId={sessionId} />
      {/* ================================================================== */}
      {/* HEADER - h-14 (56px), flexShrink: 0                              */}
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
          // Bento header doctrine 2026-05-06 — 12px JetBrains Mono UPPERCASE.
          fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
          fontSize: '12px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.16em',
          color: 'var(--text-main)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #3B82F6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          Briefing
        </span>
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: '#22C55E',
          boxShadow: '0 0 8px rgba(34, 197, 94, 0.5)'
        }} />
      </div>

      {/* ================================================================== */}
      {/* CHAT LOG - flex: 1, overflow-y: auto                             */}
      {/* ================================================================== */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px',
        minHeight: 0
      }}>
        {/* Welcome Message */}
        {messages.length === 0 && (
          <ChatBubble role="assistant">
            <p style={{ margin: '0 0 12px 0' }}>
              Hey! I'm the Creative Director for OskarOS. I help businesses create booking pages that don't look like booking pages.
            </p>
            <p style={{ margin: 0, fontWeight: 600 }}>
              Let's start with the basics: What's your business?
            </p>
          </ChatBubble>
        )}

        {/* Moodboard Selection */}
        {moodboard && !moodboard.selectedConcept && (
          <MoodboardSelector moodboard={moodboard} onSelect={onMoodboardSelect} />
        )}

        {/* Messages
            WP-15 (2026-04-17): hide [OSKAR-SYSTEM ...] turns from the
            Briefing display. They still live in the bridge's conversation
            history for the paper trail, but visually they would distract
            the user — these are app→CD machine messages, not user chat.
            We also hide CD's responses to system messages (replies that
            start with the structured ## SEVERITY/## VERDICT/## NOTE blocks). */}
        {messages
          .filter(msg => {
            const c = msg.content || ''
            // Hide outgoing system requests
            if (c.startsWith('[OSKAR-SYSTEM ')) return false
            // Hide CD replies to those — recognized by the structured headers
            if (msg.role === 'assistant') {
              const trimmed = c.trim()
              if (
                trimmed.startsWith('## SEVERITY') ||
                trimmed.startsWith('## VERDICT')
              ) return false
            }
            return true
          })
          .flatMap(msg => {
            // 2026-05-04 (Ralph) — Phase 2 discovery cards. When CD's
            // ask_discovery_questions / confirm_understanding MCP tool
            // fires, page.tsx pushes a synthetic assistant message with
            // a `card` payload. Render the card component instead of
            // the markdown body. Cards always live in their own bubble
            // (no other content per message; .content is empty).
            if (msg.card) {
              if (msg.card.kind === 'discovery_questions') {
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview}>
                    <DiscoveryQuestionsCard
                      questions={msg.card.questions}
                      context={msg.card.context}
                      onSubmit={(formattedAnswers) => onSendMessage(formattedAnswers)}
                    />
                  </FormBubble>,
                ]
              }
              if (msg.card.kind === 'confirm_understanding') {
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview}>
                    <ConfirmUnderstandingCard
                      summary={msg.card.summary}
                      readyToGenerate={msg.card.readyToGenerate}
                      onBuild={onTriggerBuildAll}
                    />
                  </FormBubble>,
                ]
              }
              if (msg.card.kind === 'upload_eval') {
                // (Ralph 2026-05-06.) Pairs with the cd.upload-evaluated
                // snackbar — snackbar is the moment, this card is the archive.
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview}>
                    <UploadEvalCard
                      filename={msg.card.filename}
                      path={msg.card.path}
                      verdict={msg.card.verdict}
                      note={msg.card.note}
                      description={msg.card.description}
                      suggestedUses={msg.card.suggestedUses}
                      status={msg.card.status}
                      sessionId={sessionId ?? ''}
                    />
                  </FormBubble>,
                ]
              }
              if (msg.card.kind === 'upload_eval_batch') {
                // (Ralph 2026-05-06.) Anti-pollution table card for N≥3
                // simultaneous uploads. Same write-back gateway as
                // UploadEvalCard; per-row tag dropdown.
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview}>
                    <UploadEvalBatchCard
                      items={msg.card.items}
                      sessionId={sessionId ?? ''}
                    />
                  </FormBubble>,
                ]
              }
              if (msg.card.kind === 'screenshot') {
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview}>
                    <ScreenshotCard
                      savedPath={msg.card.savedPath}
                      target={msg.card.target}
                      frame={msg.card.frame}
                      dims={msg.card.dims}
                      sessionId={sessionId ?? ''}
                    />
                  </FormBubble>,
                ]
              }
              if (msg.card.kind === 'apply_patch') {
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview}>
                    <ApplyPatchCard
                      filename={msg.card.filename}
                      editKind={msg.card.editKind}
                      anchor={msg.card.anchor}
                      affected={msg.card.affected}
                      diff={msg.card.diff}
                    />
                  </FormBubble>,
                ]
              }
              if (msg.card.kind === 'diagnostic_chip') {
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview}>
                    <DiagnosticChip
                      glyph={msg.card.glyph}
                      label={msg.card.label}
                      accent={msg.card.accent}
                      ts={msg.card.ts}
                    />
                  </FormBubble>,
                ]
              }
              // (Ralph + CD 2026-05-06) Archetype 1 from the toolcards
              // mockup — long-running build job (build_vibe / build_all_vibes).
              // Live cards mount on `build_started` and update from
              // `report_build_progress` / `vibe_built` / `vibe_failed`.
              // Preview cards mount via `preview_card({kind:'build', ...})`.
              if (msg.card.kind === 'build') {
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview} fullWidth>
                    <BuildJobCard
                      title={msg.card.title}
                      jobId={msg.card.jobId}
                      rows={msg.card.rows}
                      isPreview={msg.__preview}
                      // Live wiring: cancel POSTs to /api/mcp/cancel-job; open
                      // would scroll/focus the rendered vibe. Both no-op in
                      // preview mode (the component disables the buttons).
                      onCancel={(rowId, jobId) => {
                        if (!sessionId) return
                        void fetch('/api/mcp/cancel-job', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ sessionId, jobId: jobId ?? rowId }),
                        })
                      }}
                      onOpen={(rowId, htmlPath) => {
                        // Open the rendered vibe in a NEW tab (Ralph
                        // 2026-05-06 spec): keeps the chat / build cards
                        // alive in the current tab so the user can flip
                        // between previews without losing build state.
                        // Fall back to /sessionId/rowId.html convention if
                        // htmlPath wasn't populated (shouldn't happen post
                        // vibe_built but kept defensive).
                        const url = htmlPath
                          || (sessionId ? `/${sessionId}/${rowId}.html` : null)
                        if (!url) return
                        window.open(url, '_blank', 'noopener,noreferrer')
                      }}
                    />
                  </FormBubble>,
                ]
              }
            }

            // 2026-05-03 (Ralph) — question-form blocks must render as
            // their OWN chat bubble, not embedded inside a text bubble.
            // Split message content into text+form segments and emit one
            // bubble per segment. Forms use FormBubble (no inner shell —
            // QuestionFormView carries its own .question-form chrome);
            // text segments use ChatBubble. Images attach to the last
            // text bubble (or to the first form bubble if no text exists).
            const segments = splitOnQuestionForms(msg.content || '')
            const hasForm = segments.some(s => s.kind === 'form')

            const renderImages = () =>
              msg.images && msg.images.length > 0 ? (
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                  {msg.images.map((img, i) => (
                    <img
                      key={i}
                      src={img}
                      alt=""
                      style={{
                        maxWidth: '100px',
                        maxHeight: '100px',
                        borderRadius: '8px',
                        objectFit: 'cover'
                      }}
                    />
                  ))}
                </div>
              ) : null

            // No forms — keep the single-bubble shape (preserves prior behavior).
            if (!hasForm) {
              return [
                <ChatBubble key={msg.id} role={msg.role}>
                  <MarkdownRenderer content={msg.content || ''} />
                  {renderImages()}
                </ChatBubble>
              ]
            }

            // Find the last non-empty text segment for image attachment.
            let lastTextIdx = -1
            segments.forEach((s, i) => {
              if (s.kind === 'text' && s.text.trim()) lastTextIdx = i
            })
            const firstFormIdx = segments.findIndex(s => s.kind === 'form')

            return segments
              .map((seg, i) => {
                if (seg.kind === 'text') {
                  if (!seg.text.trim()) return null
                  return (
                    <ChatBubble key={`${msg.id}-t${i}`} role={msg.role}>
                      <MarkdownRenderer content={seg.text} />
                      {i === lastTextIdx && renderImages()}
                    </ChatBubble>
                  )
                }
                return (
                  <FormBubble key={`${msg.id}-f${i}`} role={msg.role}>
                    <QuestionFormView
                      form={seg.form}
                      interactive={msg.role === 'assistant'}
                      onSubmit={(text) => onSendMessage(text)}
                    />
                    {/* If no text segments at all, attach images to the first form bubble */}
                    {lastTextIdx === -1 && i === firstFormIdx && renderImages()}
                  </FormBubble>
                )
              })
              .filter(Boolean)
          })}

        {/* Streaming State */}
        {isLoading && (
          <StreamingBubble
            text={streamingText}
            progress={streamingProgress}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ================================================================== */}
      {/* INPUT AREA - 6-line textarea with bottom toolbar                 */}
      {/* ================================================================== */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: '16px',
          borderTop: '1px solid var(--border-card)',
          backgroundColor: 'var(--bg-app)',
          flexShrink: 0
        }}
      >
        {/* Queued messages — shown above the input when the user has
            sent messages while CD is mid-stream. FIFO order. Each row
            has an X to cancel before it dispatches. */}
        {queuedMessages.length > 0 && (
          <div style={{
            marginBottom: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}>
            <div style={{
              fontSize: 9,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              paddingLeft: 4
            }}>
              Queued · {queuedMessages.length} {queuedMessages.length === 1 ? 'message' : 'messages'}
            </div>
            {queuedMessages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '6px 10px',
                  backgroundColor: 'var(--bg-app)',
                  border: '1px dashed var(--border-card)',
                  borderRadius: 6,
                  fontSize: 12,
                  color: 'var(--text-dim)'
                }}
              >
                <span style={{
                  flex: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {msg}
                </span>
                {onCancelQueued && (
                  <button
                    type="button"
                    onClick={() => onCancelQueued(idx)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: 14,
                      lineHeight: 1,
                      flexShrink: 0
                    }}
                    title="Cancel this queued message"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Input container */}
        <div style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: '12px',
          overflow: 'hidden'
        }}>
          {/* Textarea - 6 lines minimum, NOT disabled during loading so user can compose next message */}
          <textarea
            ref={inputRef}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or instruction..."
            rows={6}
            style={{
              width: '100%',
              minHeight: '144px',
              height: '144px',
              backgroundColor: 'transparent',
              border: 'none',
              padding: '12px 16px',
              fontSize: '14px',
              color: 'var(--text-main)',
              fontFamily: 'inherit',
              outline: 'none',
              resize: 'none',
              lineHeight: '1.6'
            }}
          />

          {/* Bottom toolbar: icons left, Active Model badge middle, submit right */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderTop: '1px solid var(--border-card)'
          }}>
            {/* Left: attach + mic */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Attach button */}
              <button
                type="button"
                style={{
                  padding: '4px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                  <line x1="12" x2="12" y1="19" y2="22"></line>
                </svg>
              </button>
            </div>

            {/* Middle: Active Model badge (truth on the wire). Shows the model
                that actually served the response — not the request alias.
                SMPL→opus resolves to glm-5.1 on Z.ai, claude-opus-4-7 on
                Anthropic. CLI→claude-opus-4-7[1m] resolves to glm-4.7 on
                Z.ai (the deception, surfaced). Ralph 2026-05-04. */}
            {currentModel ? (
              <span style={{
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}>
                Active Model: {currentModel}
              </span>
            ) : null}

            {/* Right: submit button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                type="submit"
                /* Always enabled. When isLoading is true the parent's
                   handleSend queues the message instead of dispatching. */
                style={{
                  padding: '6px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--text-main)',
                  color: 'var(--bg-app)',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={isLoading ? 'Queue message (CD is responding)' : 'Send'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"></line>
                  <polyline points="5 12 12 5 19 12"></polyline>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}

// ============================================================================
// CHAT BUBBLE COMPONENT - MATCHES BENTO.HTML ChatMessage
// ============================================================================
function ChatBubble({
  role,
  children
}: {
  role: 'user' | 'assistant'
  children: React.ReactNode
}) {
  const isUser = role === 'user'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      marginBottom: '24px',
      alignItems: isUser ? 'flex-end' : 'flex-start'
    }}>
      <div style={{
        maxWidth: '85%',
        padding: '16px',
        borderRadius: '16px',
        borderTopRightRadius: isUser ? '4px' : '16px',
        borderTopLeftRadius: isUser ? '16px' : '4px',
        fontSize: '14px',
        lineHeight: 1.6,
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        backgroundColor: isUser ? 'var(--text-main)' : 'var(--bg-app)',
        color: isUser ? 'var(--bg-app)' : 'var(--text-main)',
        border: isUser ? 'none' : '1px solid var(--border-card)'
      }}>
        {children}
      </div>
      <span style={{
        fontSize: '9px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        marginTop: '8px',
        opacity: 0.5,
        padding: '0 4px'
      }}>
        {isUser ? 'YOU' : 'OSKAR'}
      </span>
    </div>
  )
}

// ============================================================================
// FORM BUBBLE — chat bubble for question-form blocks.
// 2026-05-03 (Ralph) — the form must BE its own bubble, not embedded
// inside a text bubble. QuestionFormView has its own .question-form chrome
// (rounded card, border, background, header strip) — FormBubble is just
// the alignment wrapper + role label. Wider max-width than ChatBubble
// (95% vs 85%) because forms need room for option chips and direction
// cards to lay out.
// ============================================================================
function FormBubble({
  role,
  preview,
  fullWidth,
  children
}: {
  role: 'user' | 'assistant'
  /** Ralph 2026-05-06 — when true, the bubble is a sample render from the
   * `preview_card` MCP tool. Adds a "PREVIEW" badge above the card and
   * marks it visually as a non-interactive sample. */
  preview?: boolean
  /** Ralph 2026-05-06 — when true, the inner card spans the full chat
   * column width (default cap is 95%). Used by the build job card whose
   * multi-row table needs the room to breathe. */
  fullWidth?: boolean
  children: React.ReactNode
}) {
  const isUser = role === 'user'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      marginBottom: '24px',
      // Full-width bubbles stretch end-to-end regardless of role; the
      // role-based alignment only matters for narrower cards / prose.
      alignItems: fullWidth ? 'stretch' : isUser ? 'flex-end' : 'flex-start',
    }}>
      {preview && (
        <span style={{
          fontSize: '9px',
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: 'var(--brand-violet, #A78BFA)',
          background: 'rgba(167,139,250,0.10)',
          border: '1px solid rgba(167,139,250,0.45)',
          borderRadius: '3px',
          padding: '2px 8px',
          marginBottom: '6px',
          textTransform: 'uppercase',
          alignSelf: fullWidth ? 'flex-start' : undefined,
        }}>
          Preview · sample
        </span>
      )}
      <div
        className={preview ? 'tool-card-bubble-preview' : undefined}
        style={{ maxWidth: fullWidth ? '100%' : '95%', width: '100%' }}
      >
        {children}
      </div>
      <span style={{
        fontSize: '9px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        marginTop: '8px',
        opacity: 0.5,
        padding: '0 4px'
      }}>
        {isUser ? 'YOU' : 'OSKAR'}
      </span>
    </div>
  )
}

// ============================================================================
// STREAMING BUBBLE COMPONENT
// ============================================================================
function StreamingBubble({
  text,
  progress
}: {
  text: string
  progress?: StreamingProgress
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      marginBottom: '24px'
    }}>
      {/* Progress indicator */}
      {progress && progress.phase !== 'idle' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-card)',
          borderRadius: '8px',
          marginBottom: '8px',
          maxWidth: '85%'
        }}>
          <div style={{
            width: '24px',
            height: '24px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '12px'
          }}>
            {progress.phase === 'discovery' && '🔍'}
            {progress.phase === 'confirm' && '✓'}
            {progress.phase === 'vibe' && '✨'}
            {progress.phase === 'done' && '🎉'}
            {progress.phase === 'error' && '⚠️'}
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-main)', fontWeight: 500 }}>
              {progress.message}
            </span>
            {progress.currentVibeName && (
              <span style={{ display: 'block', fontSize: '11px', color: 'var(--accent)', marginTop: '2px' }}>
                {progress.currentVibeName}
              </span>
            )}
          </div>
          {progress.phase === 'vibe' && progress.vibesCurrent && (
            <div style={{
              width: '50px',
              height: '4px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '2px',
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                background: 'linear-gradient(90deg, #4a9eff, #f97316)',
                borderRadius: '2px',
                width: `${(progress.vibesCurrent / 3) * 100}%`
              }} />
            </div>
          )}
        </div>
      )}

      {/* Streaming text */}
      <div style={{
        maxWidth: '85%',
        padding: '16px',
        borderRadius: '16px',
        borderTopLeftRadius: '4px',
        fontSize: '14px',
        lineHeight: 1.6,
        backgroundColor: 'var(--bg-app)',
        border: '1px solid var(--border-card)',
        color: 'var(--text-main)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
      }}>
        {text ? (
          <>
            <MessageContent
              content={text}
              interactive={false}
              onSubmitForm={undefined}
            />
            <span style={{
              display: 'inline-block',
              color: 'var(--accent)',
              marginLeft: '2px'
            }}>▊</span>
          </>
        ) : (
          <div style={{ display: 'flex', gap: '6px', padding: '4px 0' }}>
            <span style={{ width: '6px', height: '6px', background: 'var(--text-muted)', borderRadius: '50%' }} />
            <span style={{ width: '6px', height: '6px', background: 'var(--text-muted)', borderRadius: '50%' }} />
            <span style={{ width: '6px', height: '6px', background: 'var(--text-muted)', borderRadius: '50%' }} />
          </div>
        )}
      </div>

      <span style={{
        fontSize: '9px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        marginTop: '8px',
        opacity: 0.5,
        padding: '0 4px'
      }}>OSKAR</span>
    </div>
  )
}

// ============================================================================
// MOODBOARD SELECTOR COMPONENT
// ============================================================================
function MoodboardSelector({
  moodboard,
  onSelect
}: {
  moodboard: MoodboardData
  onSelect: (conceptName: string) => void
}) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-app)',
      borderRadius: '12px',
      padding: '16px',
      marginBottom: '16px',
      border: '1px solid var(--accent, #3B82F6)'
    }}>
      <h4 style={{ margin: '0 0 4px 0', color: 'var(--text-main)', fontSize: '14px' }}>
        Choose Your Direction
      </h4>
      <p style={{ color: 'var(--text-muted)', fontSize: '12px', margin: '0 0 12px 0' }}>
        Click on a quadrant to select your vibe
      </p>
      <div style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1',
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        <img
          src={moodboard.imagePath}
          alt="Moodboard options"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr'
        }}>
          {moodboard.concepts.map((concept) => (
            <button
              key={concept.name}
              onClick={() => onSelect(concept.name)}
              title={`${concept.name}: ${concept.visualStyle}`}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <span style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#fff',
                textShadow: '0 1px 3px rgba(0,0,0,0.8)'
              }}>
                {concept.name}
              </span>
              <span style={{
                fontSize: '11px',
                color: 'var(--accent, #3B82F6)',
                textShadow: '0 1px 3px rgba(0,0,0,0.8)'
              }}>
                {concept.oneWord}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
