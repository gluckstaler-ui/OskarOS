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
// tool calls (`build_vibe`, `build_all_vibes`, `build_final`, `hotswap`,
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
    const { messages, sourceImages, sessionId, cliSessionId, isResume, executionMode, webDevModel } = body as {
      messages: Message[]
      sourceImages?: SourceImageInfo[]
      sessionId?: string
      cliSessionId?: string
      isResume?: boolean
      executionMode?: ExecutionMode
      webDevModel?: Model
    }

    const activeMode: ExecutionMode = executionMode || 'cli'
    const activeModel: Model = webDevModel || 'claude-sonnet-4-6'
    const effectiveSessionId = sessionId || `session-${Date.now()}`

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

    // Get the last user message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    const currentMessage = lastUserMessage?.content || 'Hello! I want to create a booking page for my business.'

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

          let fullOutput = ''
          let vibeCount = 0

          // Stream response from bridge
          for await (const event of bridgeManager.sendMessage(effectiveSessionId, currentMessage, {
            model: 'claude-opus-4-7[1m]',
            systemPrompt: fullSystemPrompt,
            cwd: process.cwd()
          })) {
            // Forward events to frontend
            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text') {
                  fullOutput += block.text
                  sendEvent({ type: 'text', content: block.text })
                }
                if (block.type === 'tool_use') {
                  sendEvent({ type: 'tool_use', tool: block.name, input: block.input })
                  // Include tool-input content in fullOutput for downstream
                  // analytics/debugging (vibe progress counter still scans
                  // it). No regex triggers fire on this content any more —
                  // builds/hotswaps/refreshes are all explicit MCP tool calls.
                  if (block.input?.content && typeof block.input.content === 'string') {
                    fullOutput += '\n' + block.input.content
                  }
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

            // Detect vibe generation progress
            const vibeMatches = fullOutput.match(/## VIBE \d+:/gi)
            if (vibeMatches && vibeMatches.length > vibeCount) {
              vibeCount = vibeMatches.length
              sendEvent({ type: 'progress', phase: 'vibe', current: vibeCount, message: `Generating vibe ${vibeCount}...` })
            }

            // Result event = response complete
            if (event.type === 'result') {
              console.log(`[${requestId}] Bridge response complete: turns=${event.num_turns}, cost=$${event.total_cost_usd?.toFixed(4)}, stop=${event.stop_reason}`)
              console.log(`[${requestId}] RAW usage:`, JSON.stringify(event.usage))

              // Extract ACTUAL context window fill (not cumulative billing tokens).
              // cache_read_input_tokens is counted once PER TURN — a 14-turn interaction
              // re-reads the full cache 14 times. Divide by num_turns to get actual fill.
              // cache_creation_input_tokens = NEW tokens added this interaction (counted once).
              // Formula: estimated_context = (cache_read / turns) + cache_creation + input
              let contextPct = 0
              let cachedInputTokens = 0
              let realInputTokens = 0
              let estimatedContextSize = 0
              let contextWindow = 200000
              // Get contextWindow from modelUsage (only place it exists).
              //
              // 2026-04-17 fix: the previous code took `Object.keys(modelUsage)[0]`
              // which silently picks whichever model the CLI inserted FIRST.
              // For requests served by Opus 4.7 [1m], the CLI also reports
              // Haiku as a sub-model (likely an internal summarizer), and
              // Haiku appears first in the object → we got Haiku's 200K
              // window instead of Opus[1m]'s 1M. Result: every USAGE.json
              // entry showed contextWindow=200000 and contextPct values >100%
              // (130-150%), making the "we have 1M" promise look broken.
              //
              // Fix: pick the LARGEST contextWindow among reported models.
              // The answering model is always at least as big as any helper
              // model, so max() gives us the true window. If only one model
              // is reported, max() returns that one. Always honest.
              if (event.modelUsage) {
                const windows = Object.values(event.modelUsage)
                  .map((u: any) => u?.contextWindow)
                  .filter((n: any) => typeof n === 'number' && n > 0)
                if (windows.length > 0) {
                  contextWindow = Math.max(...windows)
                }
              }
              // Estimate actual context fill
              if (event.usage) {
                const numTurns = event.num_turns || 1
                const cacheRead = event.usage.cache_read_input_tokens || 0
                const cacheCreation = event.usage.cache_creation_input_tokens || 0
                realInputTokens = event.usage.input_tokens || 0
                // Actual cached content in window = what existed (cache_read / turns) + what's new (cache_creation)
                cachedInputTokens = Math.round(cacheRead / numTurns) + cacheCreation
                estimatedContextSize = cachedInputTokens + realInputTokens
                contextPct = Math.round((estimatedContextSize / contextWindow) * 100)
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
                    { contextPct, contextWindow },
                    bridgeCumulativeCost,
                  )
                }
              } catch (err) { console.error(`[${requestId}] Failed to track usage:`, err) }

              // Lumberjack handles session cleanup on 10-minute timer — no per-turn consolidation

              sendEvent({ type: 'done', vibeCount: 0, cliSessionId: bridgeCliSessionId, manifestCount: manifests.length, contextPct, cachedInputTokens, realInputTokens, contextWindow })
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
