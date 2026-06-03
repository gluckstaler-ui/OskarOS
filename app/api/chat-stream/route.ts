import { NextRequest } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { buildCDPrompt } from '@/lib/cd-agent-prompt'
import { buildSagePrompt } from '@/lib/sage-agent-prompt'

// Which agent powers the main chat. Flip this between 'sage' and 'cd' to
// change who the user talks to on web-app load. CD-specific routes
// (ask-cd, proofread, verdict, evaluate) keep using CD regardless.
const MAIN_CHAT_AGENT: 'sage' | 'cd' = 'cd'
import { type ExecutionMode, type Model } from '@/lib/run-webdev'
import { appendUsage } from '@/lib/usage-tracker'
import { bridgeManager } from '@/lib/bridge-process-manager'
// 2026-05-27 (Ralph): card-vs-chat strip + feedback loop. See
// lib/strip-feedback.ts for the full doctrine. Streaming path can't
// un-send text that has already streamed to the client, so its strip
// is twofold: (1) persist the collision at end-of-stream for next-turn
// feedback injection (the learning signal); (2) emit a `strip_chat`
// SSE event so the client can DOM-remove the displayed text.
import {
  isCardThatOwnsTheTurn,
  persistStrippedChat,
  consumeStrippedChat,
  buildFeedbackSystemNote,
} from '@/lib/strip-feedback'
// Consolidator removed — Lumberjack runs on 10-minute timer instead.
// All build/hotswap/asset-refresh actions moved to MCP tool calls
// (mcp-server/) in the 2026-04-29 cutover; this route no longer parses
// CD's prose for triggers.

export const maxDuration = 300 // 5 minutes

interface Message {
  role: 'user' | 'assistant'
  content: string
  images?: string[]
}

interface SourceImageInfo {
  path: string
  analysis?: { elements: string[]; description: string }
}

interface ImagePrompt {
  vibe: string
  purpose: string
  prompt: string
  aspectRatio?: string
}

// Legacy prose-parsing of CD's response was deleted in the 2026-04-29 MCP
// cutover. CD now signals build/hotswap/refresh actions through typed MCP
// tool calls (`build_vibe`, `build_wireframes`, `hotswap`,
// `images_needed`, `refresh_assets`) — see `mcp-server/`. Nothing in CD's
// text response can fire any of those actions any more. IMAGES.md is the
// file-based source of truth for prompts; we re-parse it after every
// response via `parseImagePromptsFromImagesMd` below.

// ==========================================
// IMAGES.md Parser
// ==========================================
// Reads the structured ### img-N blocks from IMAGES.md.
// This is the canonical format the CD agent writes to.

function parseImagePromptsFromImagesMd(imagesMd: string, sessionId: string): { manifests: any[], prompts: ImagePrompt[] } {
  const prompts: ImagePrompt[] = []
  const manifestMap: Map<string, any> = new Map()

  // Match ### img-N blocks with structured fields
  const imgBlocks = imagesMd.matchAll(/### img-(\d+)\s*\n([\s\S]*?)(?=\n### img-|\n---|\n## |$)/gi)

  let blockCount = 0
  for (const block of imgBlocks) {
    blockCount++
    const imgNum = block[1]
    const content = block[2]

    console.log(`[IMAGES.md parser] Block img-${imgNum}, content length: ${content.length}`)

    const vibeMatch = content.match(/Vibe:\s*(.+)/i)
    const purposeMatch = content.match(/Purpose:\s*(.+)/i)
    const ratioMatch = content.match(/Aspect Ratio:\s*(.+)/i)
    const statusMatch = content.match(/Status:\s*(.+)/i)
    const promptMatch = content.match(/Prompt:\s*([\s\S]+?)$/i)

    console.log(`[IMAGES.md parser] img-${imgNum}: vibe=${vibeMatch?.[1]}, purpose=${purposeMatch?.[1]}, prompt=${!!promptMatch}`)

    if (!promptMatch) { console.log(`[IMAGES.md parser] SKIP img-${imgNum}: no prompt match`); continue }

    const rawVibeName = vibeMatch?.[1]?.trim() || 'shared'
    const purpose = purposeMatch?.[1]?.trim() || 'hero'
    const aspectRatio = ratioMatch?.[1]?.trim() || '16:9'
    const status = statusMatch?.[1]?.trim() || 'PENDING'
    const instruction = promptMatch[1].trim()

    // Detect operation from prompt prefix
    let operation = 'generate'
    if (/^EDIT[\s:]/i.test(instruction)) operation = 'edit'
    else if (/^COMPOSE[\s:]/i.test(instruction)) operation = 'compose'

    const usage = purpose.toLowerCase()

    // Normalize vibe name: "shared (all vibes)" / "all" / "shared" → shared
    // Multi-vibe: "SAYF, THE HUNT" → split and assign to each
    const isShared = /^(?:shared|all)\b/i.test(rawVibeName)
    const vibeNames = isShared
      ? ['shared']
      : rawVibeName.split(/,\s*/).map(v => v.trim()).filter(Boolean)

    for (const singleVibe of vibeNames) {
      const vibeName = singleVibe.toLowerCase().replace(/\s+/g, '-')
      const vibeId = vibeName === 'shared' ? 'vibe-shared' : `vibe-${vibeName}`
      const displayName = vibeName === 'shared' ? 'All Vibes (Shared)' : singleVibe

      const assetId = `${vibeId}-asset-${imgNum}`
      const filename = `${vibeName}-${usage}-${imgNum}.jpg`

      if (!manifestMap.has(vibeId)) {
        manifestMap.set(vibeId, { vibeId, vibeName: displayName, assets: [] })
      }

      manifestMap.get(vibeId).assets.push({
        id: assetId, filename, operation, sourceImages: [], instruction, usage, aspectRatio,
        resolution: '2K', status: status.toLowerCase(), vibeId, vibeName: displayName
      })
      prompts.push({ vibe: vibeName, purpose: `${usage}-${imgNum}`, prompt: instruction, aspectRatio })
    }
  }

  console.log(`[IMAGES.md parser] DONE: ${blockCount} blocks found, ${prompts.length} prompts, ${manifestMap.size} vibes`)
  return { manifests: Array.from(manifestMap.values()), prompts }
}

// ==========================================
// Per-response IMAGES.md refresh
// ==========================================
// CD writes prompts into IMAGES.md as part of its normal work. After every
// chat turn we re-read that file and push the parsed manifests to the
// frontend so the Assets panel stays in sync without requiring CD to call
// a tool. This is the ONLY remaining response-time side effect — every
// other build/hotswap/refresh action is now an MCP tool call.

async function parseSessionImages(
  effectiveSessionId: string,
  sendEvent: (event: object) => void,
  requestId: number
): Promise<{ manifests: any[] }> {
  let manifests: any[] = []
  let prompts: ImagePrompt[] = []
  try {
    const imagesPath = path.join(process.cwd(), 'public', effectiveSessionId, 'IMAGES.md')
    const imagesMd = await readFile(imagesPath, 'utf-8').catch(() => '')
    if (imagesMd) {
      const parsed = parseImagePromptsFromImagesMd(imagesMd, effectiveSessionId)
      manifests = parsed.manifests
      prompts = parsed.prompts
      if (prompts.length > 0) {
        console.log(`[${requestId}] Parsed ${prompts.length} prompts from IMAGES.md across ${manifests.length} vibes`)
      }
    }
  } catch (err) {
    console.error(`[${requestId}] Failed to read IMAGES.md:`, err)
  }

  if (manifests.length > 0) {
    sendEvent({
      type: 'image_manifests',
      manifests,
      message: `Found ${prompts.length} images across ${manifests.length} vibes`
    })
  }

  return { manifests }
}

// ==========================================
// POST Handler — Bridge Mode
// ==========================================

export async function POST(req: NextRequest) {
  const requestId = Date.now()
  console.log(`=== Streaming Chat API (Bridge Mode) called [${requestId}] ===`)

  try {
    const body = await req.json()
    const { messages, sourceImages, sessionId, cliSessionId, isResume, executionMode, webDevModel, cdModel } = body as {
      messages: Message[]
      sourceImages?: SourceImageInfo[]
      sessionId?: string
      cliSessionId?: string
      isResume?: boolean
      executionMode?: ExecutionMode
      webDevModel?: Model
      cdModel?: string
    }

    const effectiveSessionId = sessionId || `session-${Date.now()}`

    // Phase 2 toggle wiring (Ralph 2026-05-04). The user's TopBar pills now
    // actually take effect: webDevModel/executionMode flow through to the
    // MCP build routes via the session-config file (page.tsx writes on
    // every toggle), and cdModel resolves here per request → file →
    // default. The legacy `activeMode`/`activeModel` vars used to be
    // declared and never read — gone now. WebDev's mode/model are not
    // resolved here; the MCP build routes do their own resolveConfig
    // call so this route stays focused on CD.
    const { resolveConfig } = await import('@/lib/session-config')
    const resolvedCdModel = resolveConfig(
      'cdModel',
      cdModel as any,
      effectiveSessionId,
      'claude-opus-4-8[1m]',  // CLI default — 1M context on Anthropic, never silently demotes to SMPL/API. Ralph 2026-05-27.
    )
    // Touch the unused destructured vars so TS doesn't complain — they're
    // still accepted in the body for forward-compat (page.tsx sends them).
    void executionMode; void webDevModel

    console.log(`[${requestId}] OskarOS Session: ${effectiveSessionId}, Bridge: ${bridgeManager.hasProcess(effectiveSessionId) ? 'EXISTING' : 'NEW'}`)

    // Load memory system files for prompt context
    const memorySessionFiles = await (async () => {
      try {
        const { getSessionMdPath, getUserMemoryPath, getDreamLogPath } = await import('@/lib/memory/paths')
        const { readFile } = await import('fs/promises')

        const consolidatedSessionMd = await readFile(getSessionMdPath(effectiveSessionId), 'utf-8').catch(() => undefined)
        const userMd = await readFile(getUserMemoryPath(effectiveSessionId), 'utf-8').catch(() => undefined)

        // Build clock block
        const dreamLog = await readFile(getDreamLogPath(effectiveSessionId), 'utf-8').catch(() => '')
        const dreamTimestamp = dreamLog.match(/^# Dream Cycle — (.+)$/m)?.[1] || 'never'
        const clockBlock = (consolidatedSessionMd || userMd) ? `
## MEMORY CLOCK
- Dreamer last ran: ${dreamTimestamp}
` : ''

        return { consolidatedSessionMd, userMd, clockBlock }
      } catch {
        return {}
      }
    })()

    // Detect if bridge will resume (has saved CLI session on disk or in memory)
    const willBridgeResume = bridgeManager.hasProcess(effectiveSessionId) || bridgeManager.wasResumed(effectiveSessionId)
    // Check disk mapping if no live process (server restart scenario)
    const hasDiskMapping = !bridgeManager.hasProcess(effectiveSessionId) &&
      (() => { try { return require('fs').existsSync(require('path').join(process.cwd(), 'public', effectiveSessionId, 'logs', 'BRIDGE.json')) } catch { return false } })()
    const bridgeResumed = willBridgeResume || hasDiskMapping

    // Build system prompt (only used on first spawn — bridge remembers after that)
    // Route to Sage or CD based on MAIN_CHAT_AGENT flag at the top of this file.
    const systemPrompt = MAIN_CHAT_AGENT === 'sage'
      ? buildSagePrompt(effectiveSessionId, isResume || false, memorySessionFiles, bridgeResumed)
      : buildCDPrompt(sourceImages || [], effectiveSessionId, isResume || false, memorySessionFiles, bridgeResumed)

    // Include conversation history in system prompt for first spawn only
    // Skip if bridge is resuming — it already has full history
    let fullSystemPrompt = systemPrompt
    if (!bridgeResumed && !bridgeManager.hasProcess(effectiveSessionId) && messages.length > 1) {
      const MAX_HISTORY_MESSAGES = 8
      const previousMessages = messages.slice(0, -1).slice(-MAX_HISTORY_MESSAGES)
      if (previousMessages.length > 0) {
        let historyText = `\n\n=== RECENT CONVERSATION (last ${previousMessages.length} messages) ===\n`
        historyText += `(Full history available in SESSION.md if needed)\n\n`
        for (const msg of previousMessages) {
          if (msg.role === 'user') {
            historyText += `User: ${msg.content}\n\n`
          } else {
            const textOnly = msg.content.replace(/```[\s\S]*?```/g, '[code block]').trim()
            historyText += `You (${MAIN_CHAT_AGENT === 'sage' ? 'Sage' : 'CD'}): ${textOnly.substring(0, 1000)}${textOnly.length > 1000 ? '...' : ''}\n\n`
          }
        }
        historyText += '=== END RECENT HISTORY ===\n\nContinue the conversation. The user just said:\n'
        fullSystemPrompt = systemPrompt + historyText
      }
    }

    // Pick the "current" user message — i.e., the one this turn is
    // responding to. Two paths:
    //   1. Client passed `currentMessage` explicitly. ALWAYS prefer this.
    //      The queue + drain pipeline dispatches one message per turn,
    //      and the dispatched content may NOT be the most recent
    //      user-role message in the history (the user may have queued
    //      additional messages mid-stream that landed in `messages` but
    //      are awaiting their own dispatch). Without this guard the
    //      route picked .pop() of the user-filter and silently dropped
    //      every queued message except the latest. Ralph 2026-05-02.
    //   2. Fallback: pick the last user-role message in history. Covers
    //      legacy callers and the no-queue-no-mid-stream-message case.
    let currentMessage = (typeof body.currentMessage === 'string' && body.currentMessage.length > 0)
      ? body.currentMessage
      : (messages.filter(m => m.role === 'user').pop()?.content
        || 'Hello! I want to create a booking page for my business.')

    // 2026-05-27 (Ralph): strip-feedback injection (streaming path).
    // The CLI bridge keeps its system-prompt cache from first-spawn; new
    // system-prompt edits don't reach the model mid-conversation. So the
    // feedback note rides in on the user message instead, prepended in
    // an obvious system-marker block. The model sees it as preamble to
    // whatever the user actually typed.
    const strippedRecord = consumeStrippedChat(effectiveSessionId)
    if (strippedRecord) {
      const note = buildFeedbackSystemNote(strippedRecord)
      currentMessage = note + currentMessage
      console.log(`[${requestId}] Strip-feedback injected (streaming): ${strippedRecord.cardNames.join('+')} stripped ${strippedRecord.stripped.length}ch`)
    }

    console.log(`[${requestId}] System prompt: ${fullSystemPrompt.length} chars, User prompt: ${currentMessage.length} chars`)

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        let streamClosed = false

        const closeStream = () => {
          if (streamClosed) return
          streamClosed = true
          try { controller.close() } catch {}
        }

        const sendEvent = (event: object) => {
          if (streamClosed) return
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)) }
          catch { streamClosed = true }
        }

        try {
          const bridgeCliSessionId = bridgeManager.hasProcess(effectiveSessionId)
            ? effectiveSessionId  // reuse
            : effectiveSessionId  // new spawn

          sendEvent({ type: 'start', message: bridgeManager.hasProcess(effectiveSessionId) ? 'Resuming bridge session...' : 'Starting Claude Code bridge...', cliSessionId: bridgeCliSessionId })
          // Bug M (Ralph 2026-05-04): seed the badge from the bridge's
          // CACHED actual model when one exists (resumed sessions).
          // Falls back to the configured cdModel ONLY when it's a real
          // value — never seeds 'auto' (the literal string would render
          // as AUTO in the badge, not what the user wants). Once Claude
          // CLI's init event fires, the model_info{source:'init'} event
          // below overrides whatever was seeded with truth on the wire.
          const cachedActual = bridgeManager.getProcessActualModel?.(effectiveSessionId) ?? null
          if (cachedActual) {
            sendEvent({ type: 'model_info', model: cachedActual, source: 'init' })
          } else if (resolvedCdModel && resolvedCdModel !== 'auto') {
            sendEvent({ type: 'model_info', model: resolvedCdModel, source: 'config' })
          }

          let fullOutput = ''
          let vibeCount = 0
          // 2026-05-27 (Ralph): track chat-vs-card collision across the
          // stream. `streamedText` = the text the user actually saw
          // streaming. `tcCardsFiredThisTurn` = the tc_* tool names that
          // own the user's response. At end-of-stream (result event), if
          // both are non-empty, we have a collision — persist + emit a
          // strip_chat event so the client can clear the displayed text.
          let streamedText = ''
          const tcCardsFiredThisTurn: string[] = []

          // Bridge respawn on CD model change (Ralph 2026-05-04). CLI
          // subprocesses are model-locked at spawn — if the user toggled
          // CD model since the last turn, the only way the new model
          // takes effect is to kill the bridge and let it respawn fresh.
          // One-turn delay is the price; surfaced via snackbar so the
          // user knows the click registered.
          const currentBridgeModel = bridgeManager.getProcessModel?.(effectiveSessionId) ?? null
          if (currentBridgeModel && currentBridgeModel !== resolvedCdModel) {
            console.log(
              `[${requestId}] CD model changed (${currentBridgeModel} → ${resolvedCdModel}); killing bridge for respawn`,
            )
            try {
              const { publish } = await import('@/lib/event-bus')
              publish(effectiveSessionId, {
                type: 'cd_snackbar',
                text: `Switching CD to ${resolvedCdModel}…`,
                severity: 'info',
                sticky: false,
              } as any)
            } catch { /* non-fatal */ }
            try { bridgeManager.kill?.(effectiveSessionId) } catch { /* non-fatal */ }
          }

          // Stream response from bridge
          for await (const event of bridgeManager.sendMessage(effectiveSessionId, currentMessage, {
            model: resolvedCdModel,
            systemPrompt: fullSystemPrompt,
            cwd: process.cwd(),
            // CLI-route fence (Ralph 2026-05-28): ONLY this interactive CD
            // chat opts into the 1M re-roll loop. The one-shot CD helpers
            // (cd-bridge-call) leave this unset and never re-roll.
            ensure1M: true,
          })) {
            // Bug M (Ralph 2026-05-04): forward Claude CLI's system/init
            // model field to the client so the input-bar badge shows the
            // ACTUAL model on the wire (matches open-design's mechanism).
            // When ANTHROPIC_BASE_URL is base-URL-piped to Z.ai/GLM, the
            // init event reports the GLM model identifier — that's the
            // truth we want displayed, not the user's TopBar request.
            // source:'init' lets the client know this is the wire truth,
            // overrides any config-seeded model_info from the start event.
            if (((event.type === 'init') || (event.type === 'system' && (event as any).subtype === 'init')) && (event as any).model) {
              sendEvent({
                type: 'model_info',
                model: (event as any).model,
                sessionId: (event as any).session_id ?? null,
                source: 'init',
              })
            }
            // Forward events to frontend
            if (event.type === 'assistant' && event.message?.content) {
              // 2026-05-05 (Ralph): truth-on-wire. Init reports what Claude
              // Code THINKS it's using (post-tier-resolution); message.model
              // reports what the upstream actually served. Different when
              // Z.ai reroutes claude-opus-4-8 → glm-4.7. source:'wire'
              // outranks source:'init' in the frontend trust ladder.
              if (typeof (event as any).message?.model === 'string' && (event as any).message.model.length > 0) {
                sendEvent({ type: 'model_info', model: (event as any).message.model, source: 'wire' })
              }
              for (const block of event.message.content) {
                if (block.type === 'text') {
                  fullOutput += block.text
                  streamedText += block.text
                  sendEvent({ type: 'text', content: block.text })
                }
                if (block.type === 'tool_use') {
                  sendEvent({ type: 'tool_use', tool: block.name, input: block.input })
                  // 2026-05-27 (Ralph): track tc_* cards that own the
                  // user's response — collision check fires at result.
                  if (typeof block.name === 'string' && isCardThatOwnsTheTurn(block.name)) {
                    tcCardsFiredThisTurn.push(block.name)
                  }
                  // 2026-05-28 (Ralph): tool-input content is NOT injected
                  // into fullOutput. The previous code appended `block.input.content`
                  // (entire Write-tool file bodies, etc.) into the agent's
                  // text buffer for a vibe-progress regex that's been dead
                  // since the MCP cutover. Side-effect: 600-line HTML files
                  // were leaking into mcp_chat_echo.assistantText → chat
                  // messages → MarkdownRenderer (where they got mangled).
                  // fullOutput must stay a clean record of what the agent
                  // SAID, never what the agent DID. Tool effects are
                  // surfaced via the tool_use event above, not echoed as
                  // assistant speech.
                }
              }
            }

            if (event.type === 'tool_result') {
              sendEvent({
                type: 'tool_result',
                tool: event.tool,
                result: typeof event.result === 'string' ? event.result.substring(0, 200) : '[result]'
              })
            }

            // 2026-05-28 (Ralph): vibe-progress regex counter REMOVED.
            // Since the MCP cutover, vibes are built via explicit
            // build_vibe / build_wireframes tool calls (not CD narrating
            // "## VIBE N: ..." inline). The counter was the sole reason
            // tool-input content was being injected into fullOutput
            // above — which leaked file bodies into chat. Counter is
            // dead; progress signals come from the MCP build routes'
            // own SSE events now.

            // Result event = response complete
            if (event.type === 'result') {
              console.log(`[${requestId}] Bridge response complete: turns=${event.num_turns}, cost=$${event.total_cost_usd?.toFixed(4)}, stop=${event.stop_reason}`)
              console.log(`[${requestId}] RAW usage:`, JSON.stringify(event.usage))

              // 2026-05-27 (Ralph): card-vs-chat strip + persist (streaming).
              // If this turn fired a tc_* card AND streamed chat text, we
              // have a collision. Persist for next-turn feedback (the
              // learning signal); emit a strip_chat event so the client
              // can clear the visible text (the enforcement layer).
              // Doctrine alone bends the curve; this closes the loop.
              if (tcCardsFiredThisTurn.length > 0 && streamedText.trim()) {
                persistStrippedChat(effectiveSessionId, streamedText, tcCardsFiredThisTurn)
                sendEvent({ type: 'strip_chat', reason: 'tc_card_collision', cards: tcCardsFiredThisTurn })
                console.log(`[${requestId}] Strip-feedback armed (streaming): stripped ${streamedText.length}ch alongside ${tcCardsFiredThisTurn.join('+')}`)
              }

              // Extract ACTUAL context window fill (not cumulative billing tokens).
              // cache_read_input_tokens is counted once PER TURN — a 14-turn interaction
              // re-reads the full cache 14 times. Divide by num_turns to get actual fill.
              // cache_creation_input_tokens = NEW tokens added this interaction (counted once).
              // Formula: estimated_context = (cache_read / turns) + cache_creation + input
              let contextPct = 0
              let cachedInputTokens = 0
              let realInputTokens = 0
              let estimatedContextSize = 0
              // 2026-05-04 (Ralph, Bug L): default fallback uses the
              // per-model lookup instead of hardcoded 200K. The dynamic
              // path below (event.modelUsage) overrides this when Claude
              // Code CLI reports usage; the fallback is only used when
              // modelUsage is missing/empty (rare but possible during
              // bridge-respawn windows).
              const { getContextWindow } = await import('@/lib/providers/model-context')
              // Trust wire truth, not the request. event.modelUsage keys are
              // the actual model that served the response (e.g. 'glm-4.7' on
              // Z.ai, not 'claude-opus-4-8[1m]' from our config). Fall back
              // to the request identifier only when modelUsage is absent.
              const wireModelKey = event.modelUsage && Object.keys(event.modelUsage).length > 0
                ? Object.keys(event.modelUsage)[0]
                : resolvedCdModel
              let contextWindow = getContextWindow(wireModelKey)
              // event.modelUsage also reports contextWindow directly from the
              // wire. Use that when available — it's the most accurate.
              if (event.modelUsage && event.modelUsage[wireModelKey]?.contextWindow) {
                contextWindow = event.modelUsage[wireModelKey].contextWindow
              }

              // Estimate actual context fill — RESTORED from git
              // (Ralph 2026-05-04: "CLI = to version in GIT").
              //
              // Insight: Claude Code's result.usage cache_read is the
              // CUMULATIVE bytes-read across all turns in the --print
              // invocation. Each turn re-reads the entire cache, so over
              // N turns cache_read ≈ N × actual_cache_size. Divide by
              // num_turns to get the cache that actually exists in the
              // window right now. input_tokens and cache_creation are
              // per-turn deltas (new content added this turn) — do NOT
              // divide them.
              //
              //   actual_cache_in_window = cache_read / num_turns + cache_creation
              //   per_call_fill = input_tokens + actual_cache_in_window
              //
              // This is the formula that produced sane percentages for
              // months. The variant I tried (divide everything by
              // num_turns) underestimates fill — Ralph's whole point of
              // the badge is to know when context is COLLAPSING so he
              // can trigger order66.
              if (event.usage) {
                const numTurns = event.num_turns || 1
                const cacheRead = event.usage.cache_read_input_tokens || 0
                const cacheCreation = event.usage.cache_creation_input_tokens || 0
                realInputTokens = event.usage.input_tokens || 0
                // Actual cached content in window = what existed (cache_read / turns) + what's new (cache_creation)
                cachedInputTokens = Math.round(cacheRead / numTurns) + cacheCreation
                estimatedContextSize = realInputTokens + cachedInputTokens
                contextPct = contextWindow > 0
                  ? Math.round((estimatedContextSize / contextWindow) * 100)
                  : 0
                console.log(`[${requestId}] Context: ${contextPct}% (${estimatedContextSize}/${contextWindow} — turns:${numTurns} cached:${cachedInputTokens} new:${realInputTokens} raw_billing:${cacheRead + cacheCreation + realInputTokens})`)
              }

              // Re-parse IMAGES.md and push manifests to the Assets panel.
              // No prose triggers run; build/hotswap/refresh are MCP tools.
              const { manifests } = await parseSessionImages(effectiveSessionId, sendEvent, requestId)

              // Track usage from structured event (NOT from CLI text output — bridge doesn't put usage in fullOutput)
              //
              // Ralph 2026-04-25 BUG FIX: `event.total_cost_usd` is the bridge's
              // MONOTONICALLY CUMULATIVE total since boot, not per-turn. Pass it
              // as `bridgeCumulativeCost` so appendUsage computes the per-turn
              // delta against the previously stored baseline. Without this, the
              // dollar reset button silently undid itself on the next chat turn
              // because the next turn would dump the entire bridge lifetime
              // cost into a single new entry.
              try {
                if (event.usage) {
                  const inputTokens = (event.usage.input_tokens || 0) + (event.usage.cache_creation_input_tokens || 0) + (event.usage.cache_read_input_tokens || 0)
                  const outputTokens = event.usage.output_tokens || 0
                  const bridgeCumulativeCost = event.total_cost_usd || 0
                  await appendUsage(
                    effectiveSessionId,
                    'CD',
                    { inputTokens, outputTokens, cost: bridgeCumulativeCost },
                    'Chat interaction (bridge)',
                    { contextPct, contextWindow, contextSize: estimatedContextSize },
                    bridgeCumulativeCost,
                    'cli',  // Bug N: tag entry as CLI mode
                  )
                }
              } catch (err) { console.error(`[${requestId}] Failed to track usage:`, err) }

              // Lumberjack handles session cleanup on 10-minute timer — no per-turn consolidation

              sendEvent({ type: 'done', vibeCount: 0, cliSessionId: bridgeCliSessionId, manifestCount: manifests.length, contextPct, cachedInputTokens, realInputTokens, contextWindow })

              // mcp_chat_echo is NOT published here. The MCP-injection path
              // (orchestrator send_user_input → /api/mcp/echo-chat, see
              // mcp-server/tools-orchestrator.ts:777) is the sole publisher,
              // and it fires only for server-injected turns the browser can't
              // see on its own. The always-publish that used to live here also
              // fired for browser-typed turns — which the streaming path
              // already renders AND persists to SESSION.md — so every typed
              // turn got appended a second time by the page's mcp_chat_echo
              // handler, multiplied per open tab (the content-dedup is
              // per-tab). That was the SESSION.md butchering. Removed
              // 2026-05-13 (Ralph): one publisher, correctly scoped.
              break
            }
          }

          closeStream()

        } catch (error) {
          console.error(`[${requestId}] Bridge error:`, error)
          sendEvent({ type: 'error', message: String(error) })
          closeStream()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })

  } catch (error) {
    console.error(`[${requestId}] Streaming error:`, error)
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
