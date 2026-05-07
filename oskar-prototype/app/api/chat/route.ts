import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, appendFile, readFile, readdir } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { buildCDPrompt } from '@/lib/cd-agent-prompt'
import { buildSagePrompt } from '@/lib/sage-agent-prompt'

// Which agent powers the main chat (API-mode path). Must match
// `MAIN_CHAT_AGENT` in `chat-stream/route.ts` so CLI and API modes route
// to the same identity.
const MAIN_CHAT_AGENT: 'sage' | 'cd' = 'cd'
// 2026-05-04 (Ralph): trimmed import — VibeToolInput, ImageAsset,
// AspectRatio, ImageSize, ImageOperation were all references for the
// deleted generate_vibe dispatcher. ImageManifest stays because the
// ParsedVibeResult shape still declares it (kept for now to avoid
// cascading downstream changes).
import { ImageManifest } from '@/lib/types'
import { appendUsage, calculateCost } from '@/lib/usage-tracker'
import {
  getSessionMdPath, getUserMemoryPath, getDreamLogPath,
  getLogsDir
} from '@/lib/memory/paths'
import { maybeRunLumberjack } from '@/lib/memory/lumberjack'
import {
  MCP_TOOL_DEFINITIONS_FOR_ANTHROPIC,
  isMcpTool,
  dispatchMcpTool,
  makeApiToolContext,
} from '@/lib/api-mcp-bridge'
import {
  streamAnthropicMessages,
  accumulateStreamedMessage,
  type AnthropicStreamEvent,
} from '@/lib/anthropic-stream'
import {
  normalizeStopReason,
  repairToolUseBlock,
  normalizeMessageChain,
  stripEagerInputStreaming,
} from '@/lib/providers/normalize'
import { getContextWindow } from '@/lib/providers/model-context'

function getApiKey(): string {
  // 2026-05-03 (Ralph): API_KEY env var first; .api-key file as fallback
  // (legacy local-dev shim). claude-api-loop:75 already uses ANTHROPIC_API_KEY.
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const raw = readFileSync(path.join(process.cwd(), '.api-key'), 'utf-8').trim()
    return raw.split('=')[1] || ''
  } catch {
    return ''
  }
}

// 2026-05-04 (Ralph): there used to be a `toApiModel()` helper here that
// tried to translate CLI-form model identifiers (e.g. `claude-opus-4-7[1m]`)
// into API-form (`claude-opus-4-7`). It was removed. CLI and API use
// genuinely different model identifiers and the mapping isn't reliably
// expressible as "strip a suffix" — better to hardwire the API-mode
// model in the call sites and let session-config carry the CLI form
// only. If you need to change which model API mode uses, edit the
// `resolvedCdModel` constants in callAnthropicAPI's caller and
// handleStreamingPOST below.

// ──────────────────────────────────────────────────────────────────────────
// 2026-05-03 (Ralph): prompt-caching helpers.
//
// Anthropic prompt caching: mark blocks with `cache_control: { type:
// 'ephemeral' }` and Anthropic stores everything UP TO that point as a
// cached prefix. Subsequent requests with the SAME prefix bytes pay 0.1×
// input cost on the cached portion (cache write costs 1.25× / 2× depending
// on TTL).
//
// Strategy (3 of 4 max breakpoints used):
//   1. system prompt block — 1h TTL (stable across whole session)
//   2. tools array's last def — 1h TTL (stable across whole session)
//   3. last message block — 5min TTL (stable across one agentic loop)
//
// The 5min default TTL on (3) suffices because each agentic-loop iteration
// is sub-second-to-seconds — well within the 5-min cache window.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Tag the LAST tool definition with cache_control so all tools (which come
 * before it in the array) get cached together. Stable across the whole
 * session. 1h TTL — pays write cost once per session, reads thereafter.
 */
function cacheLastToolDef(tools: any[]): any[] {
  if (tools.length === 0) return tools
  return tools.map((t, i) =>
    i === tools.length - 1
      ? { ...t, cache_control: { type: 'ephemeral', ttl: '1h' } }
      : t,
  )
}

/**
 * Tag the LAST content block of the LAST message with cache_control. This
 * caches the full conversation history up to (but not including) the
 * current loop's mutating tail. Each agentic-loop iteration re-tags the
 * new tail; Anthropic does longest-prefix-match across all cached blocks
 * so prior iterations' caches still hit.
 *
 * 5min TTL is the default — `cache_control: { type: 'ephemeral' }` without
 * ttl means 5min. Plenty for the agentic loop window.
 */
function cacheLastMessageBlock(messages: any[]): any[] {
  if (messages.length === 0) return messages
  const last = messages[messages.length - 1]
  let content = last.content
  if (typeof content === 'string') {
    content = [{ type: 'text', text: content }]
  } else if (Array.isArray(content)) {
    content = [...content]
  } else {
    return messages // unknown shape, skip
  }
  if (content.length === 0) return messages
  content[content.length - 1] = {
    ...content[content.length - 1],
    cache_control: { type: 'ephemeral' },
  }
  return [...messages.slice(0, -1), { ...last, content }]
}

// ==========================================
// Tool Definitions for Claude
// ==========================================

// 2026-05-04 (Ralph): `generate_vibe` was a Phase-1 inline "build it all in
// one tool call" path. Superseded by the MCP `build_vibe` /
// `build_all_vibes` / `build_final` tools that delegate to runWebDev (CLI
// or API depending on session config). The inline tool's existence
// confused CD — sometimes she'd pick generate_vibe, get the placeholder
// "acknowledged but processed outside the conversation loop" string,
// and never reach the actual MCP build path. Deleted from TOOLS, the
// dispatcher in parseToolCalls, the post-loop dispatcher's "outside the
// loop" comment, and the page.tsx SSE `case 'tool_complete'` handler
// that pushed VibeData into collectedVibes.
// 2026-05-04 (Ralph): inline ask_discovery_questions + confirm_understanding
// definitions are RESTORED here as fallbacks. The MCP-promoted versions
// (mcp-server/tools-cd.ts) are now the live path — see the dedupe filter
// at the spread point below. The first attempt at this fix DELETED the
// inline definitions outright; Ralph (correctly) called that out as
// overstepping the "don't delete yet" directive. Filter > delete:
//   - Source archive stays on disk (revert is a one-line filter removal)
//   - Functional behavior is identical (one entry per name in the
//     final tool list passed to Anthropic)
//   - If MCP breaks tomorrow, removing the dedupe filter restores the
//     inline path immediately
// parseToolCalls also keeps the inline dispatcher cases (likewise restored)
// so a fallback-mode session reads the agent's args correctly.
const TOOLS = [
  {
    name: "ask_discovery_questions",
    description: "Ask the business owner questions to understand their business better. Use this during the discovery phase before generating vibes.",
    input_schema: {
      type: "object",
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          items: { type: "string" },
          description: "List of questions to ask the business owner"
        },
        context: {
          type: "string",
          description: "Optional context or explanation for why you're asking these questions"
        }
      }
    }
  },
  {
    name: "confirm_understanding",
    description: "Confirm your understanding of the business before generating vibes. Use this after discovery is complete.",
    input_schema: {
      type: "object",
      required: ["summary", "readyToGenerate"],
      properties: {
        summary: {
          type: "string",
          description: "Your summary of the business: one-sentence description, target customer, unique details, tone, enemy, promise"
        },
        readyToGenerate: {
          type: "boolean",
          description: "Whether you have enough information to generate vibes"
        }
      }
    }
  },
  {
    name: "read_file",
    description: "Read a file. Session files: IMAGES.md, CREATIVE-BRIEF.md, SESSION.md. Boot files (read-only): CD-MEMORY.md, CD-PROMPTING.md.",
    input_schema: {
      type: "object",
      required: ["filename"],
      properties: {
        filename: {
          type: "string",
          description: "Filename to read. Session files: 'IMAGES.md', 'CREATIVE-BRIEF.md', 'SESSION.md'. Boot files: 'CD-MEMORY.md', 'CD-PROMPTING.md'"
        }
      }
    }
  },
  {
    name: "write_file",
    description: "Write content to a file in the session folder. Use this to update IMAGES.md, CREATIVE-BRIEF.md, SESSION.md, or create new files.",
    input_schema: {
      type: "object",
      required: ["filename", "content"],
      properties: {
        filename: {
          type: "string",
          description: "Filename to write (e.g., 'IMAGES.md', 'CREATIVE-BRIEF.md')"
        },
        content: {
          type: "string",
          description: "Full content to write to the file"
        }
      }
    }
  },
  {
    name: "list_files",
    description: "List files in the session folder. Use this to see what files and images exist.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  // 2026-05-03 (Ralph): MCP tools — build_vibe, snackbar, hotswap,
  // ask_user, generate_image, screenshot, apply_patch, image_ops, vibe_diff,
  // lint_brand_compliance, list_assets, find_assets, session_meta,
  // notify_agent, agent_inbox, claim_orphan, thread_history, replay_events,
  // submit_proofread, submit_image_verdict, submit_upload_eval,
  // submit_image_prompt, submit_critique, report_build_*. ~30 tools total.
  // Spread directly — already in Anthropic shape via api-mcp-bridge.
  //
  // 2026-05-04 (Ralph): dedupe filter. ask_discovery_questions +
  // confirm_understanding exist in BOTH this inline TOOLS array AND the
  // MCP_TOOL_DEFINITIONS_FOR_ANTHROPIC list (Commit B promoted them to
  // MCP for CLI-mode parity). Anthropic rejects duplicate tool names
  // with a 400 ("tools: Tool names must be unique"). The filter skips
  // any MCP entry whose name already appears inline above — the inline
  // version wins, MCP is the silent fallback. Removing this filter
  // ships the MCP versions instead. Either source stays runnable.
  // Set is computed lazily below to avoid a TDZ since the .filter
  // callback runs DURING the array literal evaluation.
  ...((): Array<typeof MCP_TOOL_DEFINITIONS_FOR_ANTHROPIC[number]> => {
    // Inline names captured here, after the literal above is partially
    // built (we only need the names actually defined inline so far).
    // Hardcoded list is a single source of truth — easier to audit than
    // walking the inline TOOLS slice. Update this set when you add or
    // remove an inline tool that ALSO exists in MCP.
    const inlineNamesAlsoInMcp = new Set<string>([
      'ask_discovery_questions',
      'confirm_understanding',
    ])
    return MCP_TOOL_DEFINITIONS_FOR_ANTHROPIC.filter(
      (mcpTool) => !inlineNamesAlsoInMcp.has(mcpTool.name),
    )
  })(),
]

// Session log file path - follows MD spec: outputs/logs/session-[DATE]-[TIME].md
let currentLogFile: string | null = null
let sessionStartTime: string | null = null

async function getLogFile(): Promise<string> {
  const logDir = path.join(process.cwd(), '..', 'outputs', 'logs')
  await mkdir(logDir, { recursive: true })

  // Create session file on first call (session-YYYY-MM-DD-HHMMSS.md)
  if (!currentLogFile || !sessionStartTime) {
    const now = new Date()
    sessionStartTime = now.toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '-')
    const logPath = path.join(logDir, `session-${sessionStartTime}.md`)
    currentLogFile = logPath

    // Initialize with header per MD spec
    const header = `# Session Log
**Date:** ${now.toISOString().split('T')[0]}
**Business:** [To be discovered]
**Goal:** Discovery → Vibes → Selection → Final approval
**Agents:** Creative Director (webapp)

---

`
    await writeFile(logPath, header, 'utf-8')
  }

  return currentLogFile
}

// Log format follows MD spec EXACTLY:
// ---
// ## User → CD | [TIME]
// [EXACT content as given]
//
// ---
// ## CD → User | [TIME]
// [EXACT content as given]
async function logConversation(role: 'user' | 'assistant', content: string, sessionId?: string): Promise<void> {
  try {
    const logPath = await getLogFile()
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0] // HH:MM:SS

    // Format per MD spec - verbatim, no summaries
    const sender = role === 'user' ? 'User → CD' : 'CD → User'
    const logEntry = `
---
## ${sender} | ${timestamp}

${content}
`
    await appendFile(logPath, logEntry, 'utf-8')

  } catch (error) {
    console.error('Failed to log conversation:', error)
  }
}

interface UploadedFile {
  id: string
  name: string
  type: string
  data: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  images?: string[]
}

interface ImagePrompt {
  filename: string
  prompt: string
  purpose: string
  vibes: string[]
}

interface SourceImageInfo {
  path: string
  analysis?: {
    elements: string[]
    description: string
  }
}

// Make API call using standard fetch (no proxy)
// Now supports Tool Use for structured output
async function callAnthropicAPI(
  messages: any[],
  system: string,
  options: { useTools?: boolean; toolChoice?: 'auto' | 'any' | { type: 'tool', name: string }; model?: string } = {},
  // 2026-05-04 (Ralph): bumped 3→5 for 529 (overload) survivability.
  // With the corrected exponential backoff (5s, 10s, 20s, 40s) total
  // patience is ~75s before we hard-fail back to the user. 3 attempts
  // at 1s flat (the prior buggy state) gave up in 3s and surfaced the
  // raw "Overloaded" error too eagerly.
  retries = 5,
  apiKey?: string
): Promise<any> {
  if (!apiKey) apiKey = getApiKey()
  const { useTools = false, toolChoice = 'auto', model: requestModel } = options
  // Default to Opus-1M for parity with the bridge (CLI mode runs Opus-1M
  // for CD too). The session-config resolver upstream picks the actual
  // value; this default only matters if the caller didn't pass one.
  const effectiveModel = requestModel || 'claude-opus-4-7'

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`API attempt ${attempt}/${retries} starting...`)

      // 10 minute timeout for large generation tasks
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 600000) // 10 minutes

      const requestBody: any = {
        model: effectiveModel,
        max_tokens: 128000,
        // 2026-05-03 (Ralph): system prompt as cacheable block — 1h TTL.
        // Stable across the entire user session. ~10× input-cost reduction
        // on the system+boot-files chunk after the first call.
        system: [
          {
            type: 'text',
            text: system,
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
        ],
        messages: cacheLastMessageBlock(messages),
        output_config: {
          effort: 'max'
        }
      }

      // Add tools if requested
      if (useTools) {
        // Cache the tool definitions too — large, stable, reused every loop iter.
        requestBody.tools = cacheLastToolDef(TOOLS)
        // Format tool_choice correctly for Anthropic API
        if (typeof toolChoice === 'string') {
          requestBody.tool_choice = { type: toolChoice }
        } else {
          requestBody.tool_choice = toolChoice
        }
      }

      // Bug K (Ralph 2026-05-04): defensive request-shape normalizations.
      // - stripEagerInputStreaming: removes the flag if accidentally present
      //   when tools are non-empty. Anthropic doesn't recognize it, but
      //   keeping this in place future-proofs the path for Z.ai compat.
      // The message-chain normalization runs on `messages` BEFORE caching
      // (caching uses the canonical pre-normalized array references for
      // its `cache_control` markers; normalize the live copy that ships).
      const normalizedBody = stripEagerInputStreaming(requestBody as Record<string, unknown>)

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // 2026-04-17: 1M-context opt-in.
          // 2026-05-03 (Ralph): + extended-cache-ttl-2025-04-11 to enable
          // the 1h cache TTL on `cache_control` blocks. Combined with the
          // 1M context header — Anthropic accepts comma-separated betas.
          // 2026-05-04 (Ralph): dropped `context-1m-2025-08-07`. The 1M
          // context window is invoked via the model identifier now, not a
          // beta header. `extended-cache-ttl-2025-04-11` stays — that's
          // the 1h cache TTL we use on system + tool defs.
          'anthropic-beta': 'extended-cache-ttl-2025-04-11',
        },
        body: JSON.stringify(normalizedBody),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      console.log(`Response status: ${response.status}`)

      const data = await response.json() as any

      if (data.error) {
        console.error('Anthropic API error:', JSON.stringify(data.error, null, 2))
        // 2026-05-04 (Ralph): include HTTP status + error.type so the
        // retry classifier downstream (429 / 529 / overload) can route.
        // The previous "Anthropic API error: Overloaded" string carried
        // neither the 529 nor a lowercase 'overload' token, so the
        // classifier silently fell back to the 1s default delay.
        const errType = (data.error.type || '').toString()
        const errMsg = (data.error.message || JSON.stringify(data.error)).toString()
        throw new Error(`Anthropic API error [${response.status}${errType ? ' ' + errType : ''}]: ${errMsg}`)
      }

      console.log(`API attempt ${attempt} succeeded, stop_reason: ${data.stop_reason}`)
      return data

    } catch (error: any) {
      console.log(`API attempt ${attempt} failed:`, error.message)
      if (attempt === retries) throw error
      // 2026-05-03 (Ralph): retry/backoff. 429 → respect retry-after header.
      // 529 (overload) → exponential backoff. Other transient → 1s flat.
      // 2026-05-04 (Ralph): case-insensitive match on 'overload' so
      // Anthropic's "Overloaded" (capital O) hits the right branch.
      // Backoff multiplier bumped: overload events typically need
      // 5–30s of patience, not 2s + 4s.
      const errMsg = String(error.message || '')
      const errMsgLower = errMsg.toLowerCase()
      let delayMs = 1000
      if (errMsg.includes('429')) {
        // best-effort retry-after parse; default 5s
        const match = errMsg.match(/retry-after[:\s]+(\d+)/i)
        delayMs = match ? Math.min(60000, parseInt(match[1], 10) * 1000) : 5000
      } else if (errMsg.includes('529') || errMsgLower.includes('overload')) {
        // 5s, 10s, 20s, 40s — caps at 60s. Plus jitter so we don't
        // dogpile when many sessions retry simultaneously.
        const base = Math.min(60000, 5000 * Math.pow(2, attempt - 1))
        const jitter = Math.floor(Math.random() * 1000)
        delayMs = base + jitter
      }
      console.log(`Waiting ${delayMs}ms before retry (attempt ${attempt})... reason="${errMsg.slice(0, 100)}"`)
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
}

// ==========================================
// Execute File Tools
// ==========================================

// 2026-05-04 (Ralph): read_file return shape supports BOTH plain-text
// (existing) AND Anthropic multimodal content blocks (new). When the
// file is an image or PDF, we hand it to the model as a native content
// block — `image` for jpg/png/gif/webp, `document` for pdf. NO mixed
// captions, NO base64-as-text-string. Ralph's directive: content needs
// to be properly separated. The earlier band-aid (refuse binaries +
// 200KB cap) was the wrong shape — the right shape is to use the
// transport Anthropic actually supports for binaries.
//
// Other binary types (.mp4, .mp3, .zip, .woff, .psd, etc.) still error
// out — Anthropic doesn't accept those as content blocks, and reading
// them as utf-8 would re-create the 5.7M-token blowup.
type FileToolImageMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp'

type FileToolBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: FileToolImageMediaType; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }

// Anthropic's content-block API accepts these image media types directly.
// Other image formats (BMP, ICO, TIFF) get transcoded to PNG via sharp
// before transmission — they're images, just not in formats the API
// natively understands. Refusing them outright was wrong (Ralph 2026-05-04).
const IMAGE_MEDIA_TYPES: Record<string, FileToolImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

// Image formats that sharp can transcode to PNG. Anthropic doesn't take
// these directly; we convert on read. The output media type is always
// 'image/png' — lossless, universally supported.
const TRANSCODE_TO_PNG_EXTS = new Set([
  '.bmp',  // outdated but still an image
  '.ico',  // small but readable as image
  '.tif', '.tiff',
  '.heic', '.heif', // iOS camera defaults
  '.avif',
])

// Genuinely non-image binaries. Anthropic has no transport for these
// AND there's no useful transcode. Errored out with a typed message
// pointing CD to the right tool (image_ops, screenshot, list_assets).
const UNSUPPORTED_BINARY_EXTS = new Set([
  '.mp4', '.mov', '.webm', '.mp3', '.wav', '.m4a', // av — no native support
  '.zip', '.tar', '.gz', '.7z', '.rar', // archives
  '.woff', '.woff2', '.ttf', '.otf', // fonts
  '.psd', '.ai', '.sketch', '.xd', // design files
  '.exe', '.dll', '.so', '.dylib', // binaries
])

interface FileToolResult {
  success: boolean
  /** Plain-text result. Used by text/markdown/code reads, write_file, list_files. */
  result?: string
  /** Multimodal tool_result content blocks. Used by read_file on images + PDFs. */
  resultBlocks?: FileToolBlock[]
  error?: string
}

async function executeFileTool(
  toolName: string,
  toolInput: any,
  sessionId: string
): Promise<FileToolResult> {
  const sessionPath = path.join(process.cwd(), 'public', sessionId)

  try {
    switch (toolName) {
      case 'read_file': {
        const filename = toolInput.filename

        // Special case: boot files (read-only access to agents/ folder).
        // These are always markdown — no need to multimodal-route.
        const BOOT_FILES = ['CD-MEMORY.md', 'CD-PROMPTING.md']
        if (BOOT_FILES.includes(filename)) {
          const bootPath = path.join(process.cwd(), 'agents', filename)
          if (!existsSync(bootPath)) {
            return { success: false, error: `Boot file not found: ${filename}` }
          }
          const content = await readFile(bootPath, 'utf-8')
          return { success: true, result: content }
        }

        // Regular files: only allow reading from session folder
        const filePath = path.join(sessionPath, filename)
        if (!filePath.startsWith(sessionPath)) {
          return { success: false, error: 'Access denied: can only read from session folder' }
        }
        if (!existsSync(filePath)) {
          return { success: false, error: `File not found: ${filename}` }
        }

        // Extension routing. Lowercase + match the last `.ext` segment.
        const ext = filename.toLowerCase().match(/\.[^./\\]+$/)?.[0]

        // ── Image path (Anthropic multimodal content block) ─────────────
        if (ext && IMAGE_MEDIA_TYPES[ext]) {
          const buf = await readFile(filePath)
          return {
            success: true,
            resultBlocks: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: IMAGE_MEDIA_TYPES[ext],
                  data: buf.toString('base64'),
                },
              },
            ],
          }
        }

        // ── Transcode-to-PNG path (BMP, ICO, TIFF, HEIC, AVIF) ──────────
        // Anthropic doesn't accept these media types directly, but they're
        // still images. Ralph (2026-05-04): refusing them was wrong —
        // outdated ≠ unreadable, and ICO is universal (favicons).
        // Three decoders depending on format:
        //   1. .ico      → decode-ico (returns largest PNG frame directly)
        //   2. .bmp      → bmp-js (returns RGBA) → sharp .png() output
        //   3. tif/heic/avif → sharp directly (libvips supports them)
        if (ext && TRANSCODE_TO_PNG_EXTS.has(ext)) {
          const buf = await readFile(filePath)
          let pngBuffer: Buffer
          try {
            if (ext === '.ico') {
              const decodeIco = (await import('decode-ico')).default
              const frames = decodeIco(buf)
              if (!frames || frames.length === 0) {
                throw new Error('decode-ico returned zero frames')
              }
              // Pick the largest frame (most useful for the model). Each
              // frame from decode-ico is already a PNG buffer in `data`.
              const largest = frames.reduce((a, b) =>
                a.width * a.height >= b.width * b.height ? a : b,
              )
              // decode-ico types `data` as Uint8ClampedArray; convert via
              // unknown to satisfy TS's structural-subtype checker (TS
              // refuses Uint8ClampedArray → Uint8Array directly even though
              // both are ArrayBufferView).
              const frameBytes = Buffer.from(largest.data as unknown as Uint8Array)
              if (largest.type === 'png') {
                pngBuffer = frameBytes
              } else {
                // Some ICO frames are stored as raw BMP-DIB. decode-ico
                // surfaces them as type:'bmp' with raw RGBA pixel data.
                // Run them through sharp for PNG encoding.
                const sharp = (await import('sharp')).default
                pngBuffer = await sharp(frameBytes, {
                  raw: { width: largest.width, height: largest.height, channels: 4 },
                }).png().toBuffer()
              }
            } else if (ext === '.bmp') {
              const bmpJs = await import('bmp-js')
              const decoded = bmpJs.decode(buf) as { width: number; height: number; data: Buffer }
              const sharp = (await import('sharp')).default
              // bmp-js returns ABGR (4 channels). Sharp expects RGBA, so
              // we shuffle the bytes — A→R, B→G, G→B, R→A → wait, the
              // mapping is: bmp-js gives ABGR per pixel; we want RGBA.
              // Per-pixel swap of bytes [a,b,g,r] → [r,g,b,a].
              const rgba = Buffer.alloc(decoded.data.length)
              for (let i = 0; i < decoded.data.length; i += 4) {
                rgba[i]     = decoded.data[i + 3]  // R ← R (last)
                rgba[i + 1] = decoded.data[i + 2]  // G ← G
                rgba[i + 2] = decoded.data[i + 1]  // B ← B
                rgba[i + 3] = decoded.data[i]      // A ← A (first)
              }
              pngBuffer = await sharp(rgba, {
                raw: { width: decoded.width, height: decoded.height, channels: 4 },
              }).png().toBuffer()
            } else {
              // TIFF / HEIC / HEIF / AVIF — libvips handles directly.
              const sharp = (await import('sharp')).default
              pngBuffer = await sharp(buf).png().toBuffer()
            }
          } catch (err) {
            return {
              success: false,
              error:
                `read_file failed to transcode ${filename} (${ext}) to PNG: ` +
                `${err instanceof Error ? err.message : String(err)}. ` +
                `Convert it to .png/.jpg manually and try again.`,
            }
          }
          return {
            success: true,
            resultBlocks: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: pngBuffer.toString('base64'),
                },
              },
            ],
          }
        }

        // ── PDF path (Anthropic document content block) ─────────────────
        if (ext === '.pdf') {
          const buf = await readFile(filePath)
          return {
            success: true,
            resultBlocks: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: buf.toString('base64'),
                },
              },
            ],
          }
        }

        // ── Unsupported binary types ────────────────────────────────────
        if (ext && UNSUPPORTED_BINARY_EXTS.has(ext)) {
          return {
            success: false,
            error:
              `read_file cannot transmit ${filename} (${ext}) to the model. ` +
              `Anthropic's content-block protocol supports image (jpg/png/gif/webp) ` +
              `and document (pdf); ${ext} is none of these. ` +
              `If you need to inspect this file, use a tool that handles it ` +
              `(image_ops for raster manipulation, screenshot for vibe HTML rendering, ` +
              `or list_assets to see metadata).`,
          }
        }

        // ── Text/markdown/code path (existing behavior) ─────────────────
        const content = await readFile(filePath, 'utf-8')
        return { success: true, result: content }
      }

      case 'write_file': {
        const filename = toolInput.filename
        const content = toolInput.content
        // Security: only allow writing to session folder
        const filePath = path.join(sessionPath, filename)
        if (!filePath.startsWith(sessionPath)) {
          return { success: false, error: 'Access denied: can only write to session folder' }
        }
        await mkdir(sessionPath, { recursive: true })
        await writeFile(filePath, content, 'utf-8')
        return { success: true, result: `Successfully wrote ${filename}` }
      }

      case 'list_files': {
        if (!existsSync(sessionPath)) {
          return { success: true, result: 'Session folder does not exist yet. No files.' }
        }
        const files = await readdir(sessionPath)
        return { success: true, result: files.join('\n') }
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` }
    }
  } catch (error) {
    return { success: false, error: `Tool execution failed: ${error}` }
  }
}

// ==========================================
// Parse Tool Calls from Claude's Response
// ==========================================

interface ParsedVibeResult {
  vibes: {
    name: string
    html: string
    headline: string
    tagline: string
    colors: string[]
    typography: { heading: string; body: string }
    voiceSamples: string[]
  }[]
  imageManifests: ImageManifest[]
  textMessage: string
  discoveryQuestions?: string[]
  confirmSummary?: string
}

function parseToolCalls(response: any, requestId: number): ParsedVibeResult {
  const result: ParsedVibeResult = {
    vibes: [],
    imageManifests: [],
    textMessage: '',
  }

  // 2026-05-04 (Ralph): vibeIndex used to be incremented inside the
  // generate_vibe dispatcher; that tool is gone. result.vibes stays in
  // the shape (downstream reads .length to log "0 vibes") but the loop
  // never pushes any more — vibes always come back as an empty array
  // from this path.

  for (const block of response.content) {
    if (block.type === 'text') {
      result.textMessage += block.text
    } else if (block.type === 'tool_use') {
      console.log(`[${requestId}] Tool call: ${block.name}`)

      // 2026-05-04 (Ralph): inline dispatcher cases RESTORED. Discovery
      // tools normally flow through MCP (mcp-server/tools-cd.ts →
      // /api/mcp/{slug} → event-bus → ConversationPanel cards) thanks
      // to the dedupe filter at the TOOLS spread point. These inline
      // cases only fire if the dedupe filter is disabled and the inline
      // definitions win. Keeping them means the fallback path captures
      // args correctly; removing them would silently strand the inline
      // tools on rollback.
      if (block.name === 'ask_discovery_questions') {
        const input = block.input as { questions: string[]; context?: string }
        result.discoveryQuestions = input.questions
        if (input.context) {
          result.textMessage += '\n\n' + input.context
        }
      } else if (block.name === 'confirm_understanding') {
        const input = block.input as { summary: string; readyToGenerate: boolean }
        result.confirmSummary = input.summary
        result.textMessage += '\n\n' + input.summary
        if (input.readyToGenerate) {
          result.textMessage += '\n\n**Ready to generate vibes. Say "Yes" to proceed.**'
        }
      }
    }
  }

  console.log(`[${requestId}] Parsed ${result.vibes.length} vibes, ${result.imageManifests.length} manifests`)
  return result
}

// ──────────────────────────────────────────────────────────────────────────
// 2026-05-03 (Ralph): sanitize incoming message history to repair orphaned
// `tool_use` blocks BEFORE they hit Anthropic's API contract check.
//
// Anthropic 400s if any `tool_use` block in an assistant message lacks a
// matching `tool_result` (with same id) in the immediately-following user
// message. This is a hard constraint.
//
// Source of orphans: prior turns that the loop didn't fully clean up
// (pre-fix code that filtered to "dispatchable" tools and dropped results
// for the rest), client-side message-history mutations, model interruptions,
// stale localStorage. Once a session has an orphan in history, EVERY
// subsequent turn fails with the same error until the orphan is repaired.
//
// Strategy: walk messages. For each tool_use in an assistant message,
// look forward to the next user message. If a matching tool_result is
// missing, INSERT a synthetic placeholder result so the contract holds.
// Don't strip the tool_use (preserves conversation structure for the
// model's context); just satisfy the next-message-must-have-results rule.
// ──────────────────────────────────────────────────────────────────────────
function sanitizeMessagesForAnthropic(messages: any[]): { messages: any[]; repaired: number } {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, repaired: 0 }
  }
  const out: any[] = []
  let repaired = 0
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    out.push(m)
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue

    // Collect tool_use ids in this assistant message
    const toolUseIds: string[] = []
    for (const block of m.content) {
      if (block && block.type === 'tool_use' && typeof block.id === 'string') {
        toolUseIds.push(block.id)
      }
    }
    if (toolUseIds.length === 0) continue

    // Find or synthesize the next user message with tool_results
    const next = messages[i + 1]
    let nextResultIds = new Set<string>()
    if (next && next.role === 'user' && Array.isArray(next.content)) {
      for (const block of next.content) {
        if (block && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          nextResultIds.add(block.tool_use_id)
        }
      }
    }

    const missing = toolUseIds.filter((id) => !nextResultIds.has(id))
    if (missing.length === 0) continue

    repaired += missing.length

    if (next && next.role === 'user' && Array.isArray(next.content)) {
      // Append synthetic results to the existing next user message
      const synthetic = missing.map((id) => ({
        type: 'tool_result',
        tool_use_id: id,
        content: '[orphaned tool_use repaired by sanitizer — original result was lost]',
        is_error: true,
      }))
      messages[i + 1] = { ...next, content: [...next.content, ...synthetic] }
    } else {
      // Insert a fresh user message with synthetic results between i and i+1
      const synthetic = missing.map((id) => ({
        type: 'tool_result',
        tool_use_id: id,
        content: '[orphaned tool_use repaired by sanitizer — original result was lost]',
        is_error: true,
      }))
      out.push({ role: 'user', content: synthetic })
    }
  }
  return { messages: out, repaired }
}

export async function POST(req: NextRequest) {
  const requestId = Date.now()
  console.log(`=== Chat API called [${requestId}] ===`)

  const apiKey = getApiKey()
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 503 })
  }

  // 2026-05-03 (Ralph): streaming path. Client opts in via `?stream=1` (or
  // POST body `stream: true`). Returns SSE frames matching the WP-2.1
  // ChatSseEvent shape so the chat UI can render text deltas as they arrive
  // instead of waiting 30s-3min per turn for the JSON to come back.
  //
  // The non-streaming JSON path below remains the default for back-compat
  // with callers that haven't been updated to consume SSE.
  const url = new URL(req.url)
  const wantStream =
    url.searchParams.get('stream') === '1' ||
    req.headers.get('accept')?.includes('text/event-stream')
  if (wantStream) {
    return handleStreamingPOST(req, apiKey, requestId)
  }

  try {
    const body = await req.json()
    console.log(`[${requestId}] Request body keys:`, Object.keys(body))
    const { messages, uploadedFiles, triggerAssessment, sourceImages, sessionId, isResume, cdModel } = body as {
      messages: Message[]
      uploadedFiles: UploadedFile[]
      triggerAssessment?: boolean
      sourceImages?: SourceImageInfo[]
      sessionId?: string
      isResume?: boolean
      cdModel?: string
    }

    // Load memory system files for prompt context
    const effectiveSessionId = sessionId || 'default-session'

    // Phase 2 toggle wiring (Ralph 2026-05-04). Resolve cdModel once at the
    // top: per-request body > session config file > hardcoded default. The
    // value flows into every callAnthropicAPI invocation below.
    // 2026-05-04 (Ralph): API mode is HARDWIRED to `claude-opus-4-7`.
    // The session-config cdModel field uses Claude Code CLI strings
    // (e.g. `claude-opus-4-7[1m]`) that the Anthropic API doesn't
    // accept. CLI and API need genuinely different identifiers — they
    // are not derivable from each other by simple translation.
    // Originally hardwired here for that reason; Bug A's "make the
    // toggle work" tried to unify them and produced a 404 cascade.
    // The toggle now only meaningfully controls CLI mode; API mode
    // uses this fixed value. If you need Sonnet in API mode, change
    // this constant.
    const resolvedCdModel = 'claude-opus-4-7'
    const memorySessionFiles = await (async () => {
      try {
        const consolidatedSessionMd = await readFile(getSessionMdPath(effectiveSessionId), 'utf-8').catch(() => undefined)
        const userMd = await readFile(getUserMemoryPath(effectiveSessionId), 'utf-8').catch(() => undefined)
        const dreamLog = await readFile(getDreamLogPath(effectiveSessionId), 'utf-8').catch(() => '')
        const dreamTimestamp = dreamLog.match(/^# Dream Cycle — (.+)$/m)?.[1] || 'never'
        const clockBlock = (consolidatedSessionMd || userMd) ? `\n## MEMORY CLOCK\n- Dreamer last ran: ${dreamTimestamp}\n` : ''
        return { consolidatedSessionMd, userMd, clockBlock }
      } catch {
        return {}
      }
    })()

    // Build system prompt with source image info + memory context.
    // Route to Sage or CD based on MAIN_CHAT_AGENT flag at the top of this file.
    let systemPrompt = MAIN_CHAT_AGENT === 'sage'
      ? buildSagePrompt(effectiveSessionId, isResume || false, memorySessionFiles)
      : buildCDPrompt(sourceImages || [], effectiveSessionId, isResume || false, memorySessionFiles)

    // Pre-load CD-MEMORY.md into system prompt (boot file).
    // Only CD has institutional memory here; Sage reads user.md which the
    // session-files block already injects. Skip CD-MEMORY when Sage is active.
    const cdMemoryPath = path.join(process.cwd(), 'agents', 'CD-MEMORY.md')
    if (MAIN_CHAT_AGENT === 'cd' && existsSync(cdMemoryPath)) {
      try {
        const cdMemory = await readFile(cdMemoryPath, 'utf-8')
        systemPrompt = `## CD-MEMORY (Your Learnings)\n\n${cdMemory}\n\n---\n\n${systemPrompt}`
        console.log(`[${requestId}] CD-MEMORY.md pre-loaded into system prompt`)
      } catch (e) {
        console.error(`[${requestId}] Failed to load CD-MEMORY.md:`, e)
      }
    }

    // Build messages for Claude
    // Only include images in the LAST user message to avoid ballooning request size
    const claudeMessages: any[] = messages.map((msg, index) => {
      const isLastMessage = index === messages.length - 1

      if (msg.role === 'user' && msg.images && msg.images.length > 0 && isLastMessage) {
        const content: any[] = []
        for (const img of msg.images) {
          const base64Data = img.replace(/^data:image\/\w+;base64,/, '')
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: base64Data },
          })
        }
        if (msg.content) {
          content.push({ type: 'text', text: msg.content })
        }
        return { role: 'user', content }
      }

      // For older messages or messages without images, just send text
      return { role: msg.role, content: msg.content }
    })

    // If no messages, start conversation
    if (claudeMessages.length === 0) {
      claudeMessages.push({
        role: 'user',
        content: 'Hello! I want to create a booking page for my business. What do you need from me to get started?'
      })
    }

    // If assessment triggered, add context with Director Mode persona
    if (triggerAssessment && uploadedFiles.length > 0) {
      const fileList = uploadedFiles.map(f => `- ${f.name} (${f.type})`).join('\n')
      const assessmentPrompt = `

FILES PROVIDED:
${fileList}

Now do your job. Look at these images — really LOOK at them. React honestly.

For each image, tell me:
1. **The Lore** — What story is this image begging to tell? What's the cinematic potential?
2. **The Status Signal** — Does this read as premium? Authentic? Amateur? What's the Veblen factor?
3. **The Verdict** — Usable as-is, needs work, or trash it?

Then tell me what's MISSING. What shots would complete the visual narrative?

Don't be polite. Be brilliant. If something is stunning, say "holy shit." If something is mediocre, say so. I need your real creative instincts, not a sanitized assessment.`
      const lastMessage = claudeMessages[claudeMessages.length - 1]

      if (lastMessage.role === 'user') {
        // Handle both string content and array content (when images are present)
        if (typeof lastMessage.content === 'string') {
          claudeMessages[claudeMessages.length - 1] = {
            role: 'user',
            content: lastMessage.content + assessmentPrompt
          }
        } else if (Array.isArray(lastMessage.content)) {
          // Find the text block and append to it, or add a new text block
          const textBlock = lastMessage.content.find((b: any) => b.type === 'text')
          if (textBlock) {
            textBlock.text += assessmentPrompt
          } else {
            lastMessage.content.push({ type: 'text', text: assessmentPrompt })
          }
        }
      }
    }

    // Log the user's message
    const lastUserMessage = messages[messages.length - 1]
    if (lastUserMessage && lastUserMessage.role === 'user') {
      await logConversation('user', lastUserMessage.content, effectiveSessionId)
    }

    // Detect if this is a "generate vibes" request (user confirmed understanding)
    const lastMessageContent = claudeMessages[claudeMessages.length - 1]?.content
    const lastMessageText = typeof lastMessageContent === 'string'
      ? lastMessageContent
      : Array.isArray(lastMessageContent)
        ? lastMessageContent.find((b: any) => b.type === 'text')?.text || ''
        : ''
    const isGenerateRequest = /^(yes|generate|go|proceed|do it)/i.test(lastMessageText.trim())

    // 2026-05-03 (Ralph): repair orphaned tool_use blocks BEFORE the loop.
    // Once the loop starts, every iteration appends to currentMessages and
    // an orphan in the seed history would 400 every retry. Sanitize once
    // up-front; the loop's per-iteration logic keeps things consistent
    // from there.
    //
    // 2026-05-04 (Ralph, Bug K): normalize FIRST, sanitize AFTER. Normalize
    // collapses consecutive same-role messages and drops empty-content
    // messages (the wider class of message-chain integrity bugs that
    // sanitizeMessagesForAnthropic doesn't cover). Sanitize then handles
    // the orphan-tool-use case it was designed for, on a clean structural
    // chain.
    {
      const normalized = normalizeMessageChain(claudeMessages as any[])
      if (normalized.changes > 0) {
        console.warn(`[${requestId}] normalizeMessageChain made ${normalized.changes} fix(es) to incoming history`)
      }
      const sanitized = sanitizeMessagesForAnthropic(normalized.messages)
      if (sanitized.repaired > 0) {
        console.warn(`[${requestId}] Sanitizer repaired ${sanitized.repaired} orphaned tool_use block(s) in incoming history`)
      }
      claudeMessages.length = 0
      claudeMessages.push(...sanitized.messages)
    }

    console.log(`[${requestId}] Making API request with ${claudeMessages.length} messages, useTools: true, isGenerateRequest: ${isGenerateRequest}`)

    // Tool execution loop - keep calling API until no more tool_use
    let currentMessages = [...claudeMessages]
    let response: any
    let totalInputTokens = 0
    let totalOutputTokens = 0
    // 2026-05-03 (Ralph): cache token accumulation. Anthropic returns these
    // when cache_control blocks are in the request. We just record what
    // they hand back — no client-side cost math.
    let totalCacheCreationTokens = 0
    let totalCacheReadTokens = 0
    // 2026-05-04 (Ralph, Bug N): track LAST iteration's tokens separately
    // for context-fill calculation. totalInputTokens accumulates across
    // the tool-use loop and overcounts (e.g. 5 iters of 100K each =
    // 500K cumulative; context fill on each iter was actually 100K-300K).
    // The badge needs to know "how full IS the window right now" — the
    // last iter's request size — not "how many tokens did we send total."
    let lastIterInputTokens = 0
    let lastIterCacheRead = 0
    let lastIterCacheCreation = 0
    const MAX_TOOL_ITERATIONS = 10 // Safety limit

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      // Call API
      response = await callAnthropicAPI(
        currentMessages,
        systemPrompt,
        { useTools: true, toolChoice: 'auto', model: resolvedCdModel },
        // 2026-05-04 (Ralph): drop the explicit `3` — use the function's
        // default of 5 so the overload-tolerant backoff actually has
        // 5 attempts to work with.
        undefined,
        apiKey
      )

      if (response.error) {
        throw new Error(`API error: ${JSON.stringify(response.error)}`)
      }

      // Track tokens
      totalInputTokens += response.usage?.input_tokens || 0
      totalOutputTokens += response.usage?.output_tokens || 0
      totalCacheCreationTokens += response.usage?.cache_creation_input_tokens || 0
      totalCacheReadTokens += response.usage?.cache_read_input_tokens || 0
      // Last iter only — for the context-fill calculation post-loop.
      lastIterInputTokens = response.usage?.input_tokens || 0
      lastIterCacheRead = response.usage?.cache_read_input_tokens || 0
      lastIterCacheCreation = response.usage?.cache_creation_input_tokens || 0

      // 2026-05-04 (Ralph, Bug K): repair tool_use shapes + normalize
      // stop_reason on the non-streaming path. The streaming path does
      // this in `accumulateStreamedMessage`; the JSON path lacks an
      // equivalent so we do it here, before the strict checks below.
      if (Array.isArray(response.content)) {
        for (let i = 0; i < response.content.length; i++) {
          const blk = response.content[i]
          if (blk?.type === 'tool_use') {
            const repaired = repairToolUseBlock(blk)
            if (repaired) {
              response.content[i] = { ...blk, ...repaired }
            }
          }
        }
      }
      const normalizedStopReason = normalizeStopReason(response.stop_reason)

      // 2026-05-03 (Ralph): collect EVERY tool_use block in the response.
      // Anthropic API contract: every tool_use must get a matching tool_result
      // in the next user message OR Anthropic returns
      //   `tool_use ids were found without tool_result blocks immediately after`
      // and 400s the next call. Every tool_use gets a tool_result here —
      // unknown / non-dispatchable tools get an error result with a hint so
      // the model can adapt rather than re-call the same dead-end tool.
      // (2026-05-04: `generate_vibe` is no longer in TOOLS, so the
      // outside-the-loop placeholder branch is now ONLY for tools the model
      // hallucinated. The other inline tools — ask_discovery_questions,
      // confirm_understanding — are handled by parseToolCalls AFTER the loop
      // exits; their loop-time result is the placeholder string, which is
      // fine because they're idempotent metadata captures.)
      const allToolCalls = (response.content || []).filter((block: any) => block.type === 'tool_use')

      if (allToolCalls.length === 0 || normalizedStopReason !== 'tool_use') {
        // No tool calls or model stopped naturally — we're done.
        // 2026-05-04: comparing against `normalizedStopReason` so that
        // `pause_turn` / `refusal` / Z.ai-quirk values exit cleanly.
        console.log(`[${requestId}] Tool loop complete after ${iteration + 1} iterations (stop_reason: ${normalizedStopReason})`)
        break
      }

      // Execute tools and build tool_results — ONE result per tool_use
      console.log(`[${requestId}] Handling ${allToolCalls.length} tool_use block(s)...`)

      // Add assistant's response to messages
      currentMessages.push({
        role: 'assistant',
        content: response.content
      })

      // 2026-05-03 (Ralph): per-request MCP context for in-process dispatch.
      // Built once per loop iteration; sessionId is stable, instanceId is
      // ephemeral per request.
      const mcpCtx = makeApiToolContext(sessionId || 'default-session', 'cd')

      // Execute each tool and collect results — every tool_use gets a result.
      // 2026-05-04 (Ralph): toolContent is now `string | FileToolBlock[]`
      // — read_file on an image/PDF returns multimodal content blocks
      // (image source.base64 / document source.base64) so the model
      // SEES the binary natively. Anthropic's tool_result.content
      // accepts both shapes.
      const toolResults: any[] = []
      let dispatchedCount = 0
      for (const toolCall of allToolCalls) {
        let toolContent: string | FileToolBlock[]
        let isError = false
        if (isMcpTool(toolCall.name)) {
          console.log(`[${requestId}] Dispatching MCP tool: ${toolCall.name}`)
          const r = await dispatchMcpTool(toolCall.name, toolCall.input, mcpCtx)
          toolContent = r.content
          isError = r.isError
          dispatchedCount++
        } else if (['read_file', 'write_file', 'list_files'].includes(toolCall.name)) {
          console.log(`[${requestId}] Dispatching file tool: ${toolCall.name}`)
          const result = await executeFileTool(toolCall.name, toolCall.input, sessionId || 'default-session')
          if (result.resultBlocks && result.resultBlocks.length > 0) {
            // Multimodal: read_file on image/PDF. Hand the blocks to
            // Anthropic as-is — image goes through as native pixels,
            // PDF as a native document.
            toolContent = result.resultBlocks
            isError = !result.success
          } else if (result.success) {
            toolContent = result.result || ''
            isError = false
          } else {
            toolContent = `Error: ${result.error}`
            isError = true
          }
          dispatchedCount++
        } else {
          // Tool we know about but don't dispatch in the loop. Today this
          // is `ask_discovery_questions` + `confirm_understanding` (handled
          // by post-loop parseToolCalls until Commit E migrates them to
          // MCP-only) and any tool the model hallucinated. Either way we
          // MUST emit a tool_result so the next API call doesn't 400.
          // 2026-05-04: `generate_vibe` removed from this branch — tool
          // gone from TOOLS; if the model still calls it, this branch
          // catches it as a hallucination.
          console.log(`[${requestId}] Tool "${toolCall.name}" not dispatched in loop — returning placeholder result`)
          toolContent = `Tool "${toolCall.name}" was acknowledged but is processed outside the conversation loop. Continue with your response — do not re-call this tool.`
          isError = false
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: toolContent,
          ...(isError ? { is_error: true } : {}),
        })
      }

      // Add tool results as user message — count matches tool_use count
      currentMessages.push({
        role: 'user',
        content: toolResults
      })

      // If NONE of the tools were actually dispatched, break out so we
      // don't loop forever feeding the model the same placeholder. (Up
      // until 2026-05-04 this caught the generate_vibe case; now it
      // catches the inline discovery tools + any hallucinated names.)
      if (dispatchedCount === 0) {
        console.log(`[${requestId}] No dispatchable tools called this iteration — exiting loop`)
        break
      }
    }

    // Parse tool calls from final response
    const parsed = parseToolCalls(response, requestId)

    // Track token usage if sessionId provided.
    // 2026-05-04 (Ralph, Bug L): per-model context window. Hardcoding
    // 200K under-reported by 5x for Opus 4.7 + Sonnet 4.6 (both 1M
    // native per Anthropic's docs as of 2026-05-04). The lookup table
    // is in lib/providers/model-context.ts.
    const contextWindow = getContextWindow(resolvedCdModel)
    // 2026-05-04 (Ralph, Bug N): contextPct measures CURRENT FILL of the
    // window — i.e. the size of the last request we sent. Using
    // totalInputTokens (cumulative across the tool-use loop) was wrong:
    // it overcounted by Nx where N = iterations. The right value is the
    // last iter's input + cache_read + cache_creation (everything that
    // landed in that single API call's prompt). Bounded by the window
    // by definition.
    const lastIterTotalContext = lastIterInputTokens + lastIterCacheRead + lastIterCacheCreation
    const contextPct = lastIterTotalContext > 0
      ? Math.round((lastIterTotalContext / contextWindow) * 100)
      : 0
    if (sessionId && (totalInputTokens > 0 || totalOutputTokens > 0)) {
      try {
        const cost = calculateCost(totalInputTokens, totalOutputTokens)
        await appendUsage(
          sessionId,
          'CD',
          {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            cost,
            cacheCreationTokens: totalCacheCreationTokens,
            cacheReadTokens: totalCacheReadTokens,
          },
          'Chat API call',
          { contextPct, contextWindow, contextSize: lastIterTotalContext },
          undefined,  // no bridgeCumulativeCost — API path is per-turn
          'api',      // Bug N: tag entry as API mode
        )
        console.log(`[${requestId}] Usage tracked: ${totalInputTokens}in/${totalOutputTokens}out, cacheWrite=${totalCacheCreationTokens}, cacheRead=${totalCacheReadTokens} = $${cost.toFixed(4)} | Context: ${contextPct}%`)
      } catch (usageErr) {
        console.error(`[${requestId}] Failed to track usage:`, usageErr)
      }
    }

    // Lumberjack handles session cleanup on 10-minute timer — no per-turn consolidation

    // Build the text message to display. The MCP path renders discovery
    // questions as a card via the event-bus → ConversationPanel pipeline.
    // The inline-fallback path also populates parsed.discoveryQuestions
    // (when the dedupe filter is disabled and the inline tool wins);
    // surface them as a markdown numbered list so the fallback path
    // doesn't silently swallow them.
    let assistantMessage = parsed.textMessage
    if (parsed.discoveryQuestions && parsed.discoveryQuestions.length > 0) {
      assistantMessage += '\n\n**Questions:**\n' + parsed.discoveryQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
    }

    // Extract results
    const vibes = parsed.vibes
    const imageManifests = parsed.imageManifests
    const imagePrompts: ImagePrompt[] = [] // Legacy format, no longer used with Tool Use

    console.log(`[${requestId}] Returning response with ${vibes.length} vibes, ${imageManifests.length} manifests`)

    // Log the assistant's response - VERBATIM per MD spec
    await logConversation('assistant', assistantMessage, effectiveSessionId)

    // Lumberjack piggyback: fire-and-forget if 10+ minutes since last run
    maybeRunLumberjack(effectiveSessionId).catch(err =>
      console.error(`[${requestId}] Lumberjack failed:`, err)
    )

    // ==========================================
    // Bridge Script for Live Preview & Director Mode
    // ==========================================
    const BRIDGE_SCRIPT = `
<script>
  // OskarOS Bridge - enables live preview updates and Director Mode editing
  (function() {
    // Director Mode state
    var directorModeEnabled = false;

    // Inject Director Mode styles
    var directorStyle = document.createElement('style');
    directorStyle.id = 'oskar-director-styles';
    directorStyle.textContent = \`
      .oskar-director-active [data-editable],
      .oskar-director-active [data-usage] {
        outline: 2px dashed rgba(59, 130, 246, 0.4) !important;
        outline-offset: 2px;
        cursor: pointer !important;
        transition: outline 0.2s, background 0.2s;
      }
      .oskar-director-active [data-editable]:hover,
      .oskar-director-active [data-usage]:hover {
        outline: 2px solid rgba(59, 130, 246, 0.8) !important;
        background: rgba(59, 130, 246, 0.1) !important;
      }
      .oskar-selected {
        outline: 3px solid #3b82f6 !important;
        outline-offset: 2px;
        background: rgba(59, 130, 246, 0.15) !important;
      }
      .oskar-director-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #3b82f6, #8b5cf6);
        color: white;
        padding: 8px 16px;
        font-family: system-ui, sans-serif;
        font-size: 12px;
        font-weight: 600;
        text-align: center;
        z-index: 99999;
        display: none;
      }
      .oskar-director-banner.active { display: block; }
    \`;
    document.head.appendChild(directorStyle);

    // Add Director Mode banner
    var banner = document.createElement('div');
    banner.className = 'oskar-director-banner';
    banner.innerHTML = '🎬 DIRECTOR MODE — Click any element to select and edit';
    document.body.appendChild(banner);

    // Listen for messages from parent React app
    window.addEventListener('message', function(event) {
      var data = event.data;
      if (!data || !data.type) return;

      // SET_DIRECTOR_MODE: Toggle Director Mode
      if (data.type === 'SET_DIRECTOR_MODE') {
        directorModeEnabled = data.enabled;
        if (data.enabled) {
          document.body.classList.add('oskar-director-active');
          banner.classList.add('active');
        } else {
          document.body.classList.remove('oskar-director-active');
          banner.classList.remove('active');
          // Clear selection
          document.querySelectorAll('.oskar-selected').forEach(function(e) {
            e.classList.remove('oskar-selected');
          });
        }
      }

      // UPDATE_IMAGE: Replace image src when asset is generated
      if (data.type === 'UPDATE_IMAGE') {
        var images = document.querySelectorAll('[data-usage="' + data.usage + '"]');
        images.forEach(function(img) {
          img.src = data.url;
          img.style.opacity = '0';
          img.onload = function() { img.style.opacity = '1'; };
        });
      }

      // UPDATE_TEXT: Replace text content
      if (data.type === 'UPDATE_TEXT') {
        var el = document.querySelector('[data-editable="' + data.id + '"]');
        if (el) el.textContent = data.text;
      }

      // HIGHLIGHT_ELEMENT: Visual feedback for selection
      if (data.type === 'HIGHLIGHT_ELEMENT') {
        document.querySelectorAll('.oskar-selected').forEach(function(e) {
          e.classList.remove('oskar-selected');
        });
        if (data.id) {
          var target = document.querySelector('[data-editable="' + data.id + '"], [data-usage="' + data.id + '"]');
          if (target) target.classList.add('oskar-selected');
        }
      }
    });

    // Director Mode: Click-to-select elements (only when enabled)
    document.addEventListener('click', function(e) {
      if (!directorModeEnabled) return;

      var target = e.target;
      var editable = target.dataset ? target.dataset.editable : null;
      var usage = target.dataset ? target.dataset.usage : null;

      if (editable || usage) {
        e.preventDefault();
        e.stopPropagation();

        var rect = target.getBoundingClientRect();

        // Notify parent of selection
        window.parent.postMessage({
          type: 'ELEMENT_SELECTED',
          elementType: target.tagName === 'IMG' ? 'image' : 'text',
          id: editable || usage,
          currentValue: target.tagName === 'IMG' ? target.src : target.textContent,
          tagName: target.tagName,
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        }, '*');

        // Visual feedback
        document.querySelectorAll('.oskar-selected').forEach(function(e) {
          e.classList.remove('oskar-selected');
        });
        target.classList.add('oskar-selected');
      }
    });

    // Notify parent that bridge is ready
    window.parent.postMessage({ type: 'BRIDGE_READY' }, '*');
  })();
</script>
`;

    // Auto-save vibes to disk
    const savedPaths: string[] = []
    if (vibes.length > 0) {
      const outputDir = path.join(process.cwd(), 'public', 'generated-vibes')
      await mkdir(outputDir, { recursive: true })

      for (const vibe of vibes) {
        const filename = `${vibe.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.html`
        const filePath = path.join(outputDir, filename)

        // Fix image paths: convert /uploads/ to ../uploads/ for standalone HTML viewing
        let htmlContent = vibe.html
          .replace(/src="\/uploads\//g, 'src="../uploads/')
          .replace(/src='\/uploads\//g, "src='../uploads/")
          .replace(/src="\/images\//g, 'src="../images/')
          .replace(/src='\/images\//g, "src='../images/")
          .replace(/src="\/generated-images\//g, 'src="../generated-images/')
          .replace(/src='\/generated-images\//g, "src='../generated-images/")

        // Inject bridge script before </body> for live preview and Director Mode
        if (htmlContent.includes('</body>')) {
          htmlContent = htmlContent.replace('</body>', BRIDGE_SCRIPT + '</body>')
        } else {
          // If no </body> tag, append to end
          htmlContent += BRIDGE_SCRIPT
        }

        await writeFile(filePath, htmlContent, 'utf-8')
        const publicPath = `/generated-vibes/${filename}`
        savedPaths.push(publicPath)
        console.log(`[${requestId}] Saved vibe "${vibe.name}" to ${publicPath}`)
      }
    }

    return NextResponse.json({
      message: assistantMessage,
      vibes: vibes.length > 0 ? vibes : undefined,
      vibePaths: savedPaths.length > 0 ? savedPaths : undefined,
      imageManifests: imageManifests.length > 0 ? imageManifests : undefined,
      imagePrompts: imagePrompts.length > 0 ? imagePrompts : undefined,
      contextPct,
      inputTokens: totalInputTokens,
      contextWindow,
    })

  } catch (error) {
    console.error(`[${requestId}] Chat API error:`, error)
    // 2026-05-04 (Ralph): route overload errors to 503 + Retry-After
    // so the client can distinguish "Anthropic is melting" from real
    // app bugs. The CD chat surface can show a friendlier "API is
    // overloaded — switch to CLI?" hint instead of generic "500".
    const errStr = String(error)
    const isOverload =
      errStr.includes('529') ||
      errStr.toLowerCase().includes('overload') ||
      errStr.includes('503')
    if (isOverload) {
      return NextResponse.json(
        {
          error: 'Anthropic API is overloaded. Try again in a minute or switch to CLI mode.',
          code: 'upstream_overloaded',
          detail: errStr,
        },
        { status: 503, headers: { 'Retry-After': '30' } }
      )
    }
    return NextResponse.json(
      { error: `Failed: ${error}` },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Streaming POST handler (Ralph 2026-05-03)
// ──────────────────────────────────────────────────────────────────────────
// Returns a `text/event-stream` ReadableStream. Forwards each Anthropic
// streaming event as an SSE frame matching the WP-2.1 ChatSseEvent shape:
//
//   event: start            data: { runId, bin, model }
//   event: agent            data: { type: 'text_delta', delta: '...' }
//   event: agent            data: { type: 'thinking_delta', delta: '...' }
//   event: agent            data: { type: 'tool_use', id, name, input }
//   event: agent            data: { type: 'tool_result', toolUseId, content, isError }
//   event: agent            data: { type: 'usage', usage, ... }
//   event: end              data: { code, status, ... }
//
// Client-side: pair with `lib/providers/sse.ts:createSseFrameSplitter`
// (WP-2.2) to consume frames and `lib/types/chat-sse.ts` (WP-2.1) for
// type-safe narrowing.
//
// The streaming handler reuses everything else: caching helpers, MCP
// dispatch, sanitizer, retry. Only the response shape changes.
async function handleStreamingPOST(
  req: NextRequest,
  apiKey: string,
  requestId: number,
): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const messages = (body.messages || []) as any[]
  const sessionId = body.sessionId as string | undefined
  const cdModelOverride = body.cdModel as string | undefined
  const system = MAIN_CHAT_AGENT === 'cd' ? buildCDPrompt() : buildSagePrompt()

  // 2026-05-04 (Ralph): hardwired — see same-named constant in the JSON
  // path above. API and CLI use genuinely different model identifiers
  // (`claude-opus-4-7` vs `claude-opus-4-7[1m]`); session-config's
  // cdModel field carries the CLI form. The API path overrides with
  // this fixed value to avoid 404s.
  const resolvedCdModel = 'claude-opus-4-7'

  // 2026-05-04 (Ralph, Bug K): normalize → sanitize, same order as JSON path.
  // Normalize merges consecutive same-role + drops empty content; sanitize
  // then handles orphan tool_use blocks on a clean structural chain.
  const normalizedSeed = normalizeMessageChain(messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  })) as any[])
  if (normalizedSeed.changes > 0) {
    console.warn(`[${requestId}] Streaming: normalizeMessageChain made ${normalizedSeed.changes} fix(es) to incoming history`)
  }
  // Sanitize incoming history same as JSON path
  const sanitized = sanitizeMessagesForAnthropic(normalizedSeed.messages.map((m) => ({
    role: m.role,
    content: m.content,
  })))
  if (sanitized.repaired > 0) {
    console.warn(`[${requestId}] Streaming: sanitizer repaired ${sanitized.repaired} orphaned tool_use(s)`)
  }
  let currentMessages = sanitized.messages

  const encoder = new TextEncoder()
  let streamClosed = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (streamClosed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          streamClosed = true
        }
      }
      const close = () => {
        if (streamClosed) return
        streamClosed = true
        try { controller.close() } catch {}
      }

      send('start', {
        runId: String(requestId),
        bin: 'anthropic-api',
        model: resolvedCdModel,
        protocolVersion: 1,
      })

      let totalInputTokens = 0
      let totalOutputTokens = 0
      let totalCacheCreation = 0
      let totalCacheRead = 0
      // 2026-05-04 (Ralph, Bug N): track LAST iter for context-fill calc.
      // Cumulative totals overcount by Nx where N = loop iterations.
      let lastIterInputTokens = 0
      let lastIterCacheRead = 0
      let lastIterCacheCreation = 0

      try {
        const maxIters = 30
        for (let iter = 0; iter < maxIters; iter++) {
          const reqBody = stripEagerInputStreaming({
            model: resolvedCdModel,
            max_tokens: 16384,
            system: [
              { type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } },
            ],
            messages: cacheLastMessageBlock(currentMessages),
            tools: cacheLastToolDef(TOOLS),
            tool_choice: { type: 'auto' },
          })
          // Stream the API call; forward each event as our own SSE event
          const iterEvents = streamAnthropicMessages(apiKey, reqBody)
          const assembled = await accumulateStreamedMessage(iterEvents, (ev: AnthropicStreamEvent) => {
            // Per-event forwarding to client SSE
            if (ev.type === 'content_block_delta') {
              const e = ev as any
              if (e.delta?.type === 'text_delta') {
                send('agent', { type: 'text_delta', delta: e.delta.text || '' })
              } else if (e.delta?.type === 'thinking_delta') {
                send('agent', { type: 'thinking_delta', delta: e.delta.thinking || '' })
              }
            } else if (ev.type === 'content_block_start') {
              const e = ev as any
              if (e.content_block?.type === 'tool_use') {
                send('agent', {
                  type: 'tool_use',
                  id: e.content_block.id,
                  name: e.content_block.name,
                  input: {},
                })
              }
            }
          })

          // Accumulate usage
          totalInputTokens += assembled.usage.input_tokens || 0
          totalOutputTokens += assembled.usage.output_tokens || 0
          totalCacheCreation += assembled.usage.cache_creation_input_tokens || 0
          totalCacheRead += assembled.usage.cache_read_input_tokens || 0
          // Bug N: last-iter snapshot for context-fill.
          lastIterInputTokens = assembled.usage.input_tokens || 0
          lastIterCacheRead = assembled.usage.cache_read_input_tokens || 0
          lastIterCacheCreation = assembled.usage.cache_creation_input_tokens || 0
          send('agent', { type: 'usage', usage: assembled.usage })

          // Tool-use roundtrip — every tool_use needs a tool_result
          const toolUses = assembled.content.filter((b: any) => b?.type === 'tool_use')
          if (toolUses.length === 0 || assembled.stop_reason !== 'tool_use') {
            // Done
            break
          }

          // Push assistant message to history for next iteration
          currentMessages.push({ role: 'assistant', content: assembled.content })

          // Dispatch each tool_use, build tool_results
          const mcpCtx = makeApiToolContext(sessionId || 'default-session', 'cd')
          const toolResults: any[] = []
          for (const tu of toolUses) {
            // 2026-05-04 (Ralph): toolContent is `string | FileToolBlock[]`
            // — read_file on image/PDF returns multimodal blocks. Same
            // pattern as the JSON path; same Anthropic tool_result.content
            // shape. The SSE forward to the client uses a string
            // summary (the full base64 blob isn't useful in the live
            // feed); the messages array carries the proper blocks.
            let toolContent: string | FileToolBlock[]
            let toolContentForFeed: string
            let isError = false
            if (isMcpTool(tu.name)) {
              const r = await dispatchMcpTool(tu.name, tu.input, mcpCtx)
              toolContent = r.content
              toolContentForFeed = r.content
              isError = r.isError
            } else if (['read_file', 'write_file', 'list_files'].includes(tu.name)) {
              const r = await executeFileTool(tu.name, tu.input, sessionId || 'default-session')
              if (r.resultBlocks && r.resultBlocks.length > 0) {
                toolContent = r.resultBlocks
                isError = !r.success
                // Live-feed summary: don't dump base64 into the SSE.
                const kinds = r.resultBlocks.map((b) => b.type).join(',')
                toolContentForFeed = `[${kinds} content block(s) returned to model]`
              } else if (r.success) {
                toolContent = r.result || ''
                toolContentForFeed = r.result || ''
                isError = false
              } else {
                toolContent = `Error: ${r.error}`
                toolContentForFeed = toolContent
                isError = true
              }
            } else {
              toolContent = `Tool "${tu.name}" was acknowledged but is processed outside the streaming loop. Continue with your response.`
              toolContentForFeed = toolContent
              isError = false
            }
            send('agent', {
              type: 'tool_result',
              toolUseId: tu.id,
              content: toolContentForFeed,
              isError,
            })
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: toolContent,
              ...(isError ? { is_error: true } : {}),
            })
          }
          currentMessages.push({ role: 'user', content: toolResults })
        }

        // Track usage
        if (sessionId && (totalInputTokens > 0 || totalOutputTokens > 0)) {
          try {
            const cost = calculateCost(totalInputTokens, totalOutputTokens)
            // Bug N (Ralph 2026-05-04): contextPct from LAST iter, not
            // cumulative. Same fix as the JSON path. Without this the
            // streaming-API badge would either show 0 (the prior code
            // path) or wildly inflated cumulative numbers like 970%.
            const contextWindow = getContextWindow(resolvedCdModel)
            const lastIterTotal = lastIterInputTokens + lastIterCacheRead + lastIterCacheCreation
            const contextPct = lastIterTotal > 0
              ? Math.round((lastIterTotal / contextWindow) * 100)
              : 0
            await appendUsage(
              sessionId,
              'CD',
              {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                cost,
                cacheCreationTokens: totalCacheCreation,
                cacheReadTokens: totalCacheRead,
              },
              'Chat API call (streaming)',
              { contextPct, contextWindow, contextSize: lastIterTotal },
              undefined,  // no bridgeCumulativeCost — API path is per-turn
              'api',      // Bug N: tag entry as API mode
            )
          } catch (usageErr) {
            console.warn(`[${requestId}] streaming usage track failed:`, usageErr)
          }
        }

        send('end', { code: 0, status: 'succeeded' })
        close()
      } catch (error: any) {
        console.error(`[${requestId}] streaming error:`, error)
        send('error', { message: String(error?.message || error) })
        send('end', { code: 1, status: 'failed' })
        close()
      }
    },
    cancel() {
      streamClosed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Connection: 'keep-alive',
    },
  })
}
