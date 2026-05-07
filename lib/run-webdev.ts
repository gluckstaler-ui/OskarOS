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
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { verifyVibeHtml, parseTrailingJson } from './vibe-verify'
import { publish } from './event-bus'

// ==========================================
// Types
// ==========================================

export type ExecutionMode = 'smpl' | 'cli' | 'api'

export type Model = 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'gemini-3.1-pro-preview'

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
  const { target, sessionPath } = request
  return `## SESSION CONTEXT (per-build, runtime-injected)

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
(\`report_build_complete\`, \`report_build_progress\`, \`notify_agent\`,
inbox drain).`
}

// ==========================================
// Build a VibeBuildResult from API-mode agent output (manifest + verify)
// ==========================================

/** Phase 2: report_build_complete tool args. Must match
 *  mcp-server/tools-webdev.ts:report_build_complete schema. */
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
  // Phase 2 PRIMARY: structured args from report_build_complete tool call
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
      console.warn(`[runWebDev/api] ⚠️ report_build_complete missing; recovered via parseTrailingJson`)
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
      error: loopError || `Agent finished but did not call report_build_complete or emit a JSON manifest line`,
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

export async function runWebDev(request: WebDevBuildRequest): Promise<VibeBuildResult> {
  const { mode, model, target, sessionPath, sessionId } = request

  console.log(`[RunWebDev] Mode: ${mode}, Model: ${model}, Target: "${target}"`)

  // ==========================================
  // CLI MODE — Claude Code or Gemini CLI subprocess
  // (Both buildVibeHTML[*] handle their own prompt + manifest parsing + verify)
  // ==========================================
  if (mode !== 'api') {
    if (model === 'gemini-3.1-pro-preview') {
      return buildVibeHTMLGemini(sessionId, target, sessionPath, request.abortSignal)
    }
    return buildVibeHTML(sessionId, target, sessionPath, model, request.abortSignal)
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

  // Phase 2 (2026-04-30): intercept report_build_complete from the agent's
  // tool calls. This is the API-mode equivalent of CLI mode's stream-json
  // tool_use parse — same contract, different transport.
  let capturedReportArgs: ReportBuildCompleteArgs | null = null
  const captureToolCall = (toolName: string, input: Record<string, unknown>) => {
    if (toolName === 'report_build_complete') {
      capturedReportArgs = input as unknown as ReportBuildCompleteArgs
    }
    request.onToolCall?.(toolName, input)
  }

  if (model === 'claude-opus-4-7' || model === 'claude-sonnet-4-6') {
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
