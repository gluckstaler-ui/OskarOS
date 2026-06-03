// ==========================================
// WebDev Router — routes by MODE then by MODEL
// ==========================================
//
// Two switches:
//   MODE:  cli | api
//   MODEL: opus | sonnet | gemini
//
// CLI mode:  Opus, Sonnet only → Claude Code subprocess (existing)
// API mode:  Opus, Sonnet, Gemini → Next.js tool execution loop
//
// In API mode, ALL models go through the Next.js server route.
// The model determines which API to call, but the execution
// layer (tool-executor.ts) is always Next.js.
// ==========================================

import { buildVibeHTML, buildVibeHTMLGemini, type VibeBuildResult } from './webdev'
import { runClaudeAgentLoop } from './claude-api-loop'
import { runGeminiAgentLoop } from './gemini-loop'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { verifyVibeHtml, parseTrailingJson } from './vibe-verify'
import { publish } from './event-bus'
import { buildModeBanner } from './webdev-mode-banner'

// ==========================================
// Types
// ==========================================

export type ExecutionMode = 'smpl' | 'cli' | 'api'

export type Model = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'gemini-3.1-pro-preview'

// Valid combinations:
// CLI:  opus, sonnet
// API:  opus, sonnet, gemini

/**
 * Ralph 2026-04-26: WebDev now takes a raw `target` string (whatever CD wrote
 * after `## BUILD:`), NOT a pre-parsed ParsedVibe struct. The agent finds the
 * matching VIBE file itself by reading the session folder. This eliminates the
 * silent-failure surface of pre-parsing — case-sensitive header regexes, etc.
 *
 * The agent ends its response with a JSON manifest line that tells us what
 * filename + index it produced. See lib/vibe-verify.ts for the parser.
 */
export interface WebDevBuildRequest {
  mode: ExecutionMode
  model: Model
  sessionId: string
  sessionPath: string
  /** Raw target string (e.g. "vibe-5", "Oskar Home Staging", "5"). The agent figures out which file to read. */
  target: string
  onToolCall?: (toolName: string, input: Record<string, any>) => void
  onToolResult?: (toolName: string, result: any) => void
  onText?: (text: string) => void
  /**
   * Phase 2.5 (Ralph 2026-04-30): build escrow propagates cancel_job
   * down to runWebDev via this signal. When aborted, the spawned
   * Claude/Gemini child receives SIGTERM and exits. The result returned
   * to the caller is `{ status: 'error', error: 'cancelled' }`.
   */
  abortSignal?: AbortSignal
  /**
   * Ralph 2026-05-18 (Job-Card Ladder Fix — phase-flag plumb-through):
   * true when spawned by `build_wireframes`, false (or omitted) when
   * spawned by `build_vibe`. Decides the 5-stage vs 4-stage ladder on
   * the BuildJobCard side (`buildRows[].hasCritique`) AND is injected
   * verbatim into the per-build user prompt so the agent knows whether
   * Phase 7 (critique surfaces + `build_progress({stage:"critique"})`)
   * is required or skipped. Without this, the agent had to infer mode
   * from spec content — observed in E2E to silently short-circuit Phase
   * 2/6/7 when an existing HTML was found on disk.
   */
  hasCritique?: boolean
}

// ==========================================
// Load Agent Prompt
// ==========================================

function loadWebDevAgentPrompt(): string {
  try {
    const mdPath = join(process.cwd(), 'agents', 'webdev-agent.md')
    return readFileSync(mdPath, 'utf-8')
  } catch (error) {
    console.error('Failed to load webdev-agent.md:', error)
    console.error('Expected location:', join(process.cwd(), 'agents', 'webdev-agent.md'))
    return ''
  }
}

// ==========================================
// Build User Prompt for API mode (CLI mode builds its own internally)
// ==========================================

/**
 * Per-build user message (API mode). Pure dynamic context — session folder,
 * target string. The static operational contract (which tools to call when)
 * lives in agents/webdev-agent.md "## Orchestration Contract" and is loaded
 * separately as `systemPrompt`. Don't add tool-contract instructions here —
 * edit the agent file instead. Ralph + Jedi Code 2026-05-06.
 */
function buildUserPrompt(request: WebDevBuildRequest): string {
  const { target, sessionPath, hasCritique } = request
  return `${buildModeBanner(hasCritique)}

## SESSION CONTEXT (per-build, runtime-injected)

**Session folder:** ${sessionPath}
**Target the user asked for:** "${target}"

The session folder contains one or more vibe spec files (\`VIBE-N.md\` or
\`vibe-N.md\` where N is a number). Find the one that matches "${target}" by:
- File name (target "vibe-5" matches VIBE-5.md or vibe-5.md)
- The \`#\` heading inside the file ("# Vibe 5: Oskar Home Staging")
- The vibe slug or display name in the heading

If no file matches, list the vibe files you DID find and ask the user to
clarify — don't guess. There may also be a BUILD.md in the folder with
cross-vibe context.

## YOUR TASK

Build the complete HTML landing page for the vibe matching "${target}".
Write to \`vibe-{N}-{slug}.html\` (e.g. \`vibe-5-oskar-home-staging.html\`).
Do NOT output the HTML in chat. Use your file writing tool.

Follow the Orchestration Contract from your system prompt for tool calls
(\`build_done\`, \`build_progress\`, \`notify_agent\`,
inbox drain).`
}

// Ralph 2026-05-18 (Job-Card Ladder Fix — phase-flag plumb-through):
// buildModeBanner lives in `./webdev-mode-banner` to avoid a circular
// import (lib/webdev.ts imports buildVibeHTML/Gemini from here and the
// banner from there).
//
// The banner is injected at the TOP of every per-build user prompt
// (API + Claude CLI + Gemini CLI). Without this, the agent inferred
// wireframe-vs-vibe from spec content and was observed in E2E to skip
// Phase 2/6/7 entirely when an existing HTML was found on disk.

// ==========================================
// Build a VibeBuildResult from API-mode agent output (manifest + verify)
// ==========================================

/** Phase 2: build_done tool args. Must match
 *  mcp-server/tools-webdev.ts:build_done schema. */
interface ReportBuildCompleteArgs {
  filename?: unknown
  vibeIndex?: unknown
  vibeName?: unknown
  sectionsBuilt?: unknown
  imagesUsed?: unknown
}

async function buildResultFromApiOutput(
  sessionId: string,
  target: string,
  sessionPath: string,
  agentOutput: string,
  loopError?: string,
  capturedReportArgs?: ReportBuildCompleteArgs | null,
): Promise<VibeBuildResult> {
  // Phase 2 PRIMARY: structured args from build_done tool call
  // (captured by run-webdev's onToolCall interceptor in API mode).
  let manifest: { filename: string; vibeIndex: number; vibeName: string } | null = null
  if (
    capturedReportArgs &&
    typeof capturedReportArgs.filename === 'string' &&
    typeof capturedReportArgs.vibeIndex === 'number' &&
    typeof capturedReportArgs.vibeName === 'string'
  ) {
    manifest = {
      filename: capturedReportArgs.filename,
      vibeIndex: capturedReportArgs.vibeIndex,
      vibeName: capturedReportArgs.vibeName,
    }
  }

  // FALLBACK: parseTrailingJson — defensive last resort, matches CLI mode.
  if (!manifest) {
    manifest = parseTrailingJson(agentOutput)
    if (manifest) {
      console.warn(`[runWebDev/api] ⚠️ build_done missing; recovered via parseTrailingJson`)
      try {
        const { appendFileSync } = await import('fs')
        const { join } = await import('path')
        appendFileSync(
          join(sessionPath, 'logs', '_debug-webdev-fallback.log'),
          `${new Date().toISOString()}\ttarget="${target}"\tfallback=parseTrailingJson (api-mode)\n`,
          'utf-8',
        )
      } catch { /* logs/ may not exist; non-fatal */ }
    }
  }

  if (!manifest) {
    return {
      vibeIndex: 0,
      vibeName: target,
      filename: '',
      status: 'error',
      error: loopError || `Agent finished but did not call build_done or emit a JSON manifest line`,
    }
  }
  const filePath = join(sessionPath, manifest.filename)
  if (!existsSync(filePath)) {
    return {
      vibeIndex: manifest.vibeIndex,
      vibeName: manifest.vibeName,
      filename: manifest.filename,
      status: 'error',
      error: `Manifest claims ${manifest.filename} was written, but file isn't on disk`,
    }
  }
  // Stage transition html → verify (Ralph 2026-05-06): API mode equivalent
  // of the publishes inside lib/webdev.ts CLI close handlers. The file is
  // confirmed on disk; verifyVibeHtml is about to run. Live BuildJobCard
  // timeline flips to 'verify' here.
  console.log(`[runWebDev/api] verify stage starting for target="${target}"`)
  publish(sessionId, { type: 'build_progress', target, stage: 'verify' })

  const issues = await verifyVibeHtml(manifest.filename, sessionPath)
  const fatalKinds = new Set(['parse', 'no-body'])
  const fatalCount = issues.filter((i) => fatalKinds.has(i.kind)).length
  if (fatalCount > 0) {
    const summary = issues.slice(0, 5).map((i) => `${i.kind}: ${i.detail}`).join('; ')
    return {
      vibeIndex: manifest.vibeIndex,
      vibeName: manifest.vibeName,
      filename: manifest.filename,
      status: 'error',
      error: `Build wrote file but failed verification: ${summary}`,
    }
  }
  return {
    vibeIndex: manifest.vibeIndex,
    vibeName: manifest.vibeName,
    filename: manifest.filename,
    status: 'complete',
  }
}

// ==========================================
// Router
// ==========================================

/**
 * Ralph 2026-05-19 (Sonnet→Opus fallback): single-attempt runner.
 * `runWebDev` (below) wraps this with the model-fallback layer. Keep
 * this function returning whatever the underlying CLI/API runner
 * produces — including failure results — without retrying. The retry
 * decision lives in `runWebDev`.
 *
 * Why the split: the existing function has many internal return
 * paths (CLI Claude, CLI Gemini, API Claude, API Gemini, error). The
 * fallback wrapper only needs to inspect the final result once, so
 * wrapping the whole function in a thin outer caller keeps the
 * retry logic readable instead of threading it through every branch.
 */
async function runWebDevAttempt(request: WebDevBuildRequest): Promise<VibeBuildResult> {
  const { mode, model, target, sessionPath, sessionId } = request

  console.log(`[RunWebDev] Mode: ${mode}, Model: ${model}, Target: "${target}"`)

  // ==========================================
  // CLI MODE — Claude Code or Gemini CLI subprocess
  // (Both buildVibeHTML[*] handle their own prompt + manifest parsing + verify)
  // ==========================================
  if (mode !== 'api') {
    // Ralph 2026-05-19 (Job-Card Ladder Fix — CLI onToolCall hookup):
    // forward `request.onToolCall` into the CLI runners so the route's
    // closure-bound per-slug forwarder (build-wireframes/route.ts:251)
    // sees the agent's mid-build `build_progress({stage:...})` and
    // `submit_critique` fires in real time. Before this, CLI mode
    // dropped the hook and the stage-transition events never reached
    // the SSE bus, so the job-card UI ladder hung at `html` or
    // `verify`. API mode wired it correctly (line 287 below).
    if (model === 'gemini-3.1-pro-preview') {
      return buildVibeHTMLGemini(sessionId, target, sessionPath, request.abortSignal, request.hasCritique, request.onToolCall)
    }
    return buildVibeHTML(sessionId, target, sessionPath, model, request.abortSignal, request.hasCritique, request.onToolCall)
  }

  // ==========================================
  // API MODE — Next.js is the translation layer (no subprocess)
  // ==========================================

  const agentPrompt = loadWebDevAgentPrompt()
  const userPrompt = buildUserPrompt(request)

  let collectedOutput = ''
  const captureText = (text: string) => {
    collectedOutput += text
    request.onText?.(text)
  }

  // Phase 2 (2026-04-30): intercept build_done from the agent's
  // tool calls. This is the API-mode equivalent of CLI mode's stream-json
  // tool_use parse — same contract, different transport.
  let capturedReportArgs: ReportBuildCompleteArgs | null = null
  const captureToolCall = (toolName: string, input: Record<string, unknown>) => {
    if (toolName === 'build_done') {
      capturedReportArgs = input as unknown as ReportBuildCompleteArgs
    }
    request.onToolCall?.(toolName, input)
  }

  if (model === 'claude-opus-4-8' || model === 'claude-sonnet-4-6') {
    const result = await runClaudeAgentLoop({
      model,
      systemPrompt: agentPrompt,
      userPrompt,
      sessionPath,
      maxTurns: 30,
      onToolCall: captureToolCall,
      onToolResult: request.onToolResult,
      onText: captureText,
    })
    return buildResultFromApiOutput(
      sessionId, target, sessionPath, collectedOutput,
      result.success ? undefined : result.error, capturedReportArgs,
    )
  }

  if (model === 'gemini-3.1-pro-preview') {
    const result = await runGeminiAgentLoop({
      systemPrompt: agentPrompt,
      userPrompt,
      sessionPath,
      maxTurns: 20,
      onToolCall: captureToolCall,
      onToolResult: request.onToolResult,
      onText: captureText,
    })
    return buildResultFromApiOutput(
      sessionId, target, sessionPath, collectedOutput,
      result.success ? undefined : result.error, capturedReportArgs,
    )
  }

  return {
    vibeIndex: 0,
    vibeName: target,
    filename: '',
    status: 'error',
    error: `Unknown model: ${model}`,
  }
}

/**
 * Ralph 2026-05-19 (Sonnet→Opus fallback): the public runner.
 *
 * Calls `runWebDevAttempt` once. If the result is a failure AND the
 * requested model was `claude-sonnet-4-6`, retries the same build
 * once with `claude-opus-4-8` and returns that result instead.
 *
 * **Rationale.** Sonnet 4.6's default `effort: high` ships dialed-in
 * for the rumination cliff that ate session 2026-05-16-1 (vibe-1,
 * vibe-2, vibe-3 across multiple attempts). With our prompt
 * prescriptions in place, Sonnet succeeds ~2/3 of the time on
 * wireframe-class workloads; Opus succeeds reliably on the same
 * spec set at ~2× the cost-per-attempt. Trying Sonnet first keeps
 * the cheap-fast path active for the cases that work; the Opus
 * fallback rescues the cases that don't. Net cost vs always-Opus:
 * lower on average. Net wall time vs single-attempt Sonnet: worse
 * on the rescue path (~12 min wasted on Sonnet's SIGTERM + ~7 min
 * for Opus to rebuild from scratch), better than a hard failure.
 *
 * **Direction is one-way.** Sonnet → Opus only. Opus failures and
 * Gemini failures pass through unchanged — Opus is the highest tier
 * we trust for this workload; Gemini was never asked to fall back
 * per the user's spec ("switch to Opus when Sonnet fails").
 *
 * **Cancellation honoured.** If `request.abortSignal` is already
 * aborted after the first attempt (user clicked cancel mid-Sonnet),
 * don't retry. The user's cancel-job intent overrides the fallback.
 *
 * **Same `onToolCall` closure on the retry.** The route's
 * (build-wireframes/route.ts:251) closure-bound forwarder is
 * passed through unchanged. The Opus retry's build_progress /
 * submit_critique fires reach the same SSE bus and the same
 * job-card row.
 *
 * Observability: a `build_progress` milestone is published before
 * the retry so the user sees "Sonnet failed (reason), retrying with
 * Opus..." in the live job card. BUILD.md gets the Opus result's
 * COMPLETE/FAIL entry from the route layer; the Sonnet partial is
 * captured in the milestone history but not separately logged to
 * BUILD.md to avoid pollution.
 */
export async function runWebDev(request: WebDevBuildRequest): Promise<VibeBuildResult> {
  const firstResult = await runWebDevAttempt(request)

  if (firstResult.status === 'complete') return firstResult
  if (request.model !== 'claude-sonnet-4-6') return firstResult
  if (request.abortSignal?.aborted) return firstResult

  // Sonnet failed. Trigger one Opus fallback attempt.
  const errMsg = (firstResult.error ?? 'unknown error').slice(0, 120)
  console.log(`[RunWebDev] Sonnet failed for "${request.target}" (${errMsg}). Retrying with Opus.`)
  // Ralph 2026-05-19: distinctive emoji prefix on the rescue milestones
  // so the user can scan a long row list and immediately see which
  // builds went to Opus. The fallback bullet appears mid-build; the
  // success/fail bullet appears post-Opus. Both surface in the
  // BuildJobCard's per-row milestone list.
  publish(request.sessionId, {
    type: 'build_progress',
    target: request.target,
    milestone: `🟣 Sonnet failed (${errMsg}) — escalating to Opus`,
  })

  const opusResult = await runWebDevAttempt({
    ...request,
    model: 'claude-opus-4-8',
  })

  if (opusResult.status === 'complete') {
    console.log(`[RunWebDev] Opus fallback rescued "${request.target}".`)
    // Ralph 2026-05-19: stamp the output HTML so the user can see in
    // the rendered file (and in source) that this was an Opus rescue.
    // Injects a fixed-position chip top-right via `body::before` so it
    // overlays whatever wireframe layout the agent produced without
    // mutating the build's own DOM. Also adds an HTML comment marker
    // at the very top of the file for source-view scanning.
    if (opusResult.filename) {
      try {
        const htmlPath = join(request.sessionPath, opusResult.filename)
        if (existsSync(htmlPath)) {
          let html = readFileSync(htmlPath, 'utf-8')
          const sourceMarker =
            `<!-- ===== BUILT BY OPUS (Sonnet failed on first attempt) ===== -->\n`
          const chipStyle = `<style data-oskar-opus-chip>
  body::before {
    content: "🟣 BUILT BY OPUS";
    position: fixed;
    top: 8px;
    right: 8px;
    z-index: 99999;
    background: rgba(125, 60, 152, 0.96);
    color: #fff;
    padding: 5px 12px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border-radius: 3px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    pointer-events: none;
  }
</style>
`
          // Prepend source marker; inject chip styles into <head> if
          // present, otherwise into <html> top. The chip survives even
          // if the agent's CSS resets pseudo-elements because nothing
          // selects `body::before` in normal builds.
          html = sourceMarker + html
          if (html.includes('</head>')) {
            html = html.replace('</head>', chipStyle + '</head>')
          } else {
            // Defensive — no </head> means malformed HTML; prepend
            // the style to the start of <body> instead.
            html = html.replace(/<body([^>]*)>/i, `<body$1>\n${chipStyle}`)
          }
          writeFileSync(htmlPath, html)
          console.log(`[RunWebDev] Stamped OPUS chip onto ${opusResult.filename}.`)
        }
      } catch (stampErr) {
        // Non-fatal — the build itself succeeded, we just couldn't
        // mark it. Log and continue.
        console.error(`[RunWebDev] Failed to stamp OPUS chip:`, stampErr)
      }
    }
    publish(request.sessionId, {
      type: 'build_progress',
      target: request.target,
      milestone: `🟣 RESCUED BY OPUS — ${request.target}`,
    })
  } else {
    console.log(`[RunWebDev] Opus fallback ALSO failed for "${request.target}": ${opusResult.error}`)
    publish(request.sessionId, {
      type: 'build_progress',
      target: request.target,
      milestone: `🔴 OPUS ALSO FAILED — real fail (${(opusResult.error ?? '').slice(0, 100)})`,
    })
  }
  return opusResult
}
