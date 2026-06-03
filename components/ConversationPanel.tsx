'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { PasteTextDialog } from './PasteTextDialog'
import { useSnackbar } from './SnackbarProvider'
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
// WP-70 + WP-71 (Ralph 2026-05-10): Image Strategy Card
import { ImageStrategyCard } from './chat/ImageStrategyCard'
// WP-74 (Ralph 2026-05-10): Design Directions Card
import { DesignDirectionsCard } from './chat/DesignDirectionsCard'
// WP-77 (Ralph 2026-05-10): Design System Card
import { DesignSystemCard } from './chat/DesignSystemCard'
// WP-75 (Ralph 2026-05-10): Descent Selection Card
import { DescentSelectionCard } from './chat/DescentSelectionCard'
// Ralph 2026-05-18: Critique Card — WF-mode self-critique (WebDev). Fires from
// the build-wireframes route's onToolCall when submit_critique lands. Read-only.
import { CritiqueCard } from './chat/CritiqueCard'
// WP-22 (Ralph 2026-05-06): top-right ambient overlay surface.
import { LiveOverlay } from './chat/LiveOverlay'
import {
  RECOMMEND_TODO_EVENT,
  type RecommendTodoEventDetail,
} from './chat/UnfinishedTodosPanel'
import { splitOnQuestionForms } from '@/lib/artifacts/question-form'
import { ConversationMessage, LayoutMode, StreamingProgress } from '@/lib/types'

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
  onSendMessage: (message: string, images?: File[]) => void
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
   * Fires the array-based `build_vibe([...slugs])` trigger path — wired
   * by the parent to whatever path the user typing "build all" would
   * take. Used by ConfirmUnderstandingCard's "Build it" button.
   * Ralph 2026-05-04 / collapsed shape 2026-05-18.
   */
  onTriggerBuildAll?: () => void
  /**
   * The actual CD model on the wire (raw identifier — claude-opus-4-8,
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
  onSendMessage,
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
  const snackbar = useSnackbar()
  const [showPasteDialog, setShowPasteDialog] = useState(false)

  // Paste an image from the clipboard into the chat (Ralph 2026-05-29) — same
  // gesture you'd use pasting a screenshot to Claude. Self-contained in the
  // shared composer so BOTH hosts (studio CD + CRM Consular) get it identically.
  // The host's onSendMessage(text, images) uploads them to the session and
  // points the agent at the files (see lib/chat-image-upload.ts).
  const [stagedImages, setStagedImages] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])

  // Object-URL thumbnails for the staged strip. Rebuilt whenever the staged
  // set changes; the previous batch is revoked on cleanup so we don't leak.
  useEffect(() => {
    const urls = stagedImages.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [stagedImages])

  const removeStagedImage = useCallback((idx: number) => {
    setStagedImages((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    // Accept images AND PDFs — both are file types the agent's Read tool can
    // open directly. Anything else (Word docs, text, video, …) still falls
    // through to the default text-paste behaviour. Ralph 2026-05-30.
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue
      const t = item.type
      const isImage = t.startsWith('image/')
      const isPdf = t === 'application/pdf'
      if (!isImage && !isPdf) continue
      const f = item.getAsFile()
      if (f) files.push(f)
    }
    if (files.length) {
      // Captured a file → don't also let the textarea paste a filename/blob.
      e.preventDefault()
      setStagedImages((prev) => [...prev, ...files])
    }
    // No supported file items → let the default text paste happen.
  }, [])

  // Paste-as-file (FEATURE-X §1.4 WP-3.5): stage a chunk of pasted text as a
  // .txt in the session via the generic upload route. Self-contained — needs
  // only the sessionId prop (no studio coupling), so it works in any host that
  // mounts ConversationPanel. NOT routed through the image-upload handler
  // (that one runs CD image-eval, wrong for text).
  const handlePasteSave = useCallback(async (name: string, content: string) => {
    setShowPasteDialog(false)
    try {
      const file = new File([content], name, { type: 'text/plain' })
      const fd = new FormData()
      fd.append('file', file)
      if (sessionId) fd.append('sessionId', sessionId)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
      snackbar.show('success', `Staged ${data.filename} in the session`)
    } catch (err) {
      snackbar.show('error', `Couldn't stage pasted text: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [sessionId, snackbar])

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
    const value = inputRef.current?.value.trim() ?? ''
    const imgs = stagedImages
    // Send when there's text OR at least one staged image (image-only is fine —
    // "look at this" with no words).
    if (value || imgs.length > 0) {
      onSendMessage(value, imgs.length > 0 ? imgs : undefined)
      if (inputRef.current) inputRef.current.value = ''
      if (imgs.length > 0) setStagedImages([])
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
                      preamble={msg.card.preamble}
                      context={msg.card.context}
                      title={msg.card.title}
                      progress={msg.card.progress}
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
                      preamble={msg.card.preamble}
                      distillation={msg.card.distillation}
                      conversion={msg.card.conversion}
                      weirdDetail={msg.card.weirdDetail}
                      signatureMoment={msg.card.signatureMoment}
                      discoveryProgress={msg.card.discoveryProgress}
                      stillNeed={msg.card.stillNeed}
                      phaseLabel={msg.card.phaseLabel}
                      onSubmit={(response) => {
                        // Ralph 2026-05-15: unified onSubmit. Card is no
                        // longer split into READY vs CHECK-IN — single
                        // editable-fields state, CTA gated on completeness.
                        // When the user clicks, all 9 fields are guaranteed
                        // filled (the card disables the button otherwise).
                        // Post the consolidated inline state as a structured
                        // message AND fire the build trigger.
                        const lines: string[] = ['**Looks right — build wireframes.**', '']
                        const labels: Record<string, string> = {
                          business: 'Business',
                          location: 'Location',
                          whoWeAre: 'Who we are',
                          howItWorks: 'How it works',
                          customers: 'Customer(s)',
                          voice: 'Voice',
                        }
                        for (const [key, label] of Object.entries(labels)) {
                          const v = response.distillation[key]?.trim?.()
                          if (v) lines.push(`- **${label}:** ${v}`)
                        }
                        if (response.mechanisms.length > 0) {
                          lines.push(`- **Conversion mechanisms:** ${response.mechanisms.join(' · ')}`)
                        }
                        if (response.pricing) lines.push(`- **Pricing:** ${response.pricing}`)
                        if (response.weirdDetail) lines.push(`- **Weird detail:** ${response.weirdDetail}`)
                        if (response.signatureMoment) lines.push(`- **Signature moment:** ${response.signatureMoment}`)
                        if (response.freeformText) {
                          lines.push('')
                          lines.push(response.freeformText)
                        }
                        onSendMessage(lines.join('\n'))
                        if (onTriggerBuildAll) onTriggerBuildAll()
                      }}
                    />
                  </FormBubble>,
                ]
              }
              if (msg.card.kind === 'image_strategy') {
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview}>
                    <ImageStrategyCard
                      vibeSlug={msg.card.vibeSlug}
                      vibeName={msg.card.vibeName}
                      layout={msg.card.layout}
                      phaseLabel={msg.card.phaseLabel}
                      preamble={msg.card.preamble}
                      slots={msg.card.slots}
                      sessionId={sessionId ?? ''}
                      onSubmit={(response) => {
                        const msg_text = `**Image Strategy Response:**\n\nAction: ${response.action}${
                          response.generatedSlotName ? `\nSlot: ${response.generatedSlotName}` : ''
                        }${
                          response.freeformText ? `\n\n${response.freeformText}` : ''
                        }`
                        onSendMessage(msg_text)
                      }}
                    />
                  </FormBubble>,
                ]
              }
              if (msg.card.kind === 'design_directions') {
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview}>
                    <DesignDirectionsCard
                      directions={msg.card.directions}
                      preamble={msg.card.preamble}
                      prompt={msg.card.prompt}
                      onSubmit={(response) => {
                        // New contract 2026-05-21 — enriched payload (survivors/killed
                        // denorm so Phase 3 amplification reads axis_hook + audience
                        // off the user message directly).
                        const survivorLines = response.survivors
                          .map((s) => `  • ${s.bet_name} — hook: ${s.axis_hook}, axis: ${s.axis_linear_position.toFixed(2)}, audience: ${s.audience}`)
                          .join('\n')
                        const killedLines = response.killed
                          .map((k) => `  • ${k.bet_name}`)
                          .join('\n')
                        const msg_text =
                          `**Strategic Bets — 4 survivors:**\n${survivorLines}\n\n` +
                          `**Killed:**\n${killedLines}` +
                          (response.kill_why ? `\n\n**Why killed:**\n${response.kill_why}` : '')
                        onSendMessage(msg_text)
                      }}
                    />
                  </FormBubble>,
                ]
              }
              if (msg.card.kind === 'design_system') {
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview}>
                    <DesignSystemCard
                      vibes={msg.card.vibes}
                      onSubmit={(response) => {
                        const msg_text = `**Design System Selection:** ${response.action === 'select' ? response.selectedVibeSlug : 'CREATE NEW'}${
                          response.freeformText ? `\n\n${response.freeformText}` : ''
                        }`
                        onSendMessage(msg_text)
                      }}
                    />
                  </FormBubble>,
                ]
              }
              if (msg.card.kind === 'descent_selection') {
                // WP-75 (Ralph 2026-05-10): Descent Selection Card. Variable-cap
                // vibe picker. cap=1 → radio. cap>1 → multi-select. CD specifies
                // ctaLabel verbatim. Picks → formatted text → onSendMessage; CD
                // reads it as plain user message. Same pattern as DesignDirectionsCard.
                // (COO test harness uses the orchestrator's structured
                // {type:'descent_selection',picks} dispatch case at
                // mcp-server/tools-orchestrator.ts:856 instead.)
                const ctaLabel = msg.card.ctaLabel
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview}>
                    <DescentSelectionCard
                      cap={msg.card.cap}
                      ctaLabel={ctaLabel}
                      contextLabel={msg.card.contextLabel}
                      vibes={msg.card.vibes}
                      sessionId={sessionId ?? ''}
                      preamble={msg.card.preamble}
                      prompt={msg.card.prompt}
                      onSubmit={(response) => {
                        const msg_text = `**Descent Selection (${ctaLabel}):** ${response.picks.join(', ')}${
                          response.freeformText ? `\n\n${response.freeformText}` : ''
                        }`
                        onSendMessage(msg_text)
                      }}
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
              // mockup — long-running build job (build_vibe / build_wireframes).
              // Live cards mount on `build_started` and update from
              // `build_progress` / `vibe_built` / `vibe_failed`.
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

              // Ralph 2026-05-18: Critique card — WF-mode self-critique (WebDev)
              // fires per-slug above each wireframe job row. Read-only: scores +
              // summary + recommendations. Fires from build-wireframes route's
              // onToolCall when submit_critique lands.
              if (msg.card.kind === 'critique') {
                return [
                  <FormBubble key={msg.id} role={msg.role} preview={msg.__preview} fullWidth>
                    <CritiqueCard
                      target={msg.card.target}
                      scores={msg.card.scores}
                      summary={msg.card.summary}
                      recommendations={msg.card.recommendations}
                      agent={msg.card.agent}
                      phase={msg.card.phase}
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
          {/* Staged-image thumbnail strip — shown above the textarea when the
              user has pasted/dropped/attached images. Each has an ✕ to remove
              before sending. (Ralph 2026-05-29.) */}
          {stagedImages.length > 0 && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px',
              padding: '10px 12px',
              borderBottom: '1px solid var(--border-card)',
            }}>
              {stagedImages.map((file, i) => (
                <div key={i} style={{ position: 'relative', width: 56, height: 56 }}>
                  {previews[i] && (
                    <img
                      src={previews[i]}
                      alt={file.name}
                      title={file.name}
                      style={{
                        width: 56,
                        height: 56,
                        objectFit: 'cover',
                        borderRadius: 8,
                        border: '1px solid var(--border-card)',
                        display: 'block',
                      }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeStagedImage(i)}
                    title="Remove image"
                    aria-label={`Remove ${file.name}`}
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      border: 'none',
                      background: 'var(--text-main)',
                      color: 'var(--bg-app)',
                      cursor: 'pointer',
                      fontSize: 11,
                      lineHeight: '18px',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Textarea - 6 lines minimum, NOT disabled during loading so user can compose next message */}
          <textarea
            ref={inputRef}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Type a command or instruction…  (paste an image or PDF to attach it)"
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
            {/* Left: paste-text */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Paste-as-file button (was a dead mic placeholder; repurposed
                  2026-05-29 per Ralph — opens PasteTextDialog).
                  Note: pasting an IMAGE needs no button — just ⌘V into the
                  textarea (see handlePaste / the staged-thumbnail strip). */}
              <button
                type="button"
                onClick={() => setShowPasteDialog(true)}
                title="Paste text as a file"
                aria-label="Paste text as a file"
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
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" x2="8" y1="13" y2="13"></line>
                  <line x1="16" x2="8" y1="17" y2="17"></line>
                  <line x1="10" x2="8" y1="9" y2="9"></line>
                </svg>
              </button>
            </div>

            {/* Middle: Active Model badge (truth on the wire). Shows the model
                that actually served the response — not the request alias.
                SMPL→opus resolves to glm-5.1 on Z.ai, claude-opus-4-8 on
                Anthropic. CLI→claude-opus-4-8[1m] resolves to glm-4.7 on
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

      {/* Paste-as-file modal (FEATURE-X §1.4 WP-3.5) — mounted in ConversationPanel
          scope, where showPasteDialog/handlePasteSave are defined. */}
      {showPasteDialog && (
        <PasteTextDialog onSave={handlePasteSave} onClose={() => setShowPasteDialog(false)} />
      )}
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

