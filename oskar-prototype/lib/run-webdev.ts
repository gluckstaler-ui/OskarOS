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

// ==========================================
// Types
// ==========================================

export type ExecutionMode = 'cli' | 'api'

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
}

// ==========================================
// Load Agent Prompt
// ==========================================

function loadWebDevAgentPrompt(): string {
  try {
    const mdPath = join(process.cwd(), '..', 'webdev-agent.md')
    return readFileSync(mdPath, 'utf-8')
  } catch {
    console.error('Failed to load webdev-agent.md')
    return ''
  }
}

// ==========================================
// Build User Prompt for API mode (CLI mode builds its own internally)
// ==========================================

function buildUserPrompt(request: WebDevBuildRequest): string {
  const { target, sessionPath } = request
  return `## SESSION CONTEXT

**Session folder:** ${sessionPath}
**Target the user asked for:** "${target}"

The session folder contains one or more vibe spec files (typically named
\`VIBE-N.md\` or \`vibe-N.md\` where N is a number). Find the one that matches
"${target}" by:
- File name (e.g. target "vibe-5" matches VIBE-5.md or vibe-5.md)
- The \`#\` heading inside the file (e.g. "# Vibe 5: Oskar Home Staging")
- The vibe slug or display name in the heading

If no file matches, list the vibe files you DID find and ask the user to
clarify — don't guess.

There may also be a BUILD.md in the folder with cross-vibe context.

---

## YOUR TASK

Build the complete HTML landing page for the vibe matching "${target}".

Write the HTML to a file in the session folder named \`vibe-{N}-{slug}.html\`
where {N} is the vibe number and {slug} is a kebab-case version of the vibe
name. (Example: \`vibe-5-oskar-home-staging.html\`.)

Do NOT output the HTML in chat. Use your file writing tool.

---

## REQUIRED OUTPUT FORMAT

After writing the file, end your response with EXACTLY this — a single JSON
line, on its own line, as the last thing in your response:

\`\`\`
{"filename": "vibe-N-slug.html", "vibeIndex": N, "vibeName": "The Vibe Name"}
\`\`\`

The orchestrator parses this line to know what file you produced. Don't skip
it. Don't wrap it in extra text after.`
}

// ==========================================
// Build a VibeBuildResult from API-mode agent output (manifest + verify)
// ==========================================

async function buildResultFromApiOutput(
  target: string,
  sessionPath: string,
  agentOutput: string,
  loopError?: string,
): Promise<VibeBuildResult> {
  const manifest = parseTrailingJson(agentOutput)
  if (!manifest) {
    return {
      vibeIndex: 0,
      vibeName: target,
      filename: '',
      status: 'error',
      error: loopError || `Agent finished but did not emit a JSON manifest line`,
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
  if (mode === 'cli') {
    if (model === 'gemini-3.1-pro-preview') {
      return buildVibeHTMLGemini(sessionId, target, sessionPath)
    }
    return buildVibeHTML(sessionId, target, sessionPath, model)
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

  if (model === 'claude-opus-4-7' || model === 'claude-sonnet-4-6') {
    const result = await runClaudeAgentLoop({
      model,
      systemPrompt: agentPrompt,
      userPrompt,
      sessionPath,
      maxTurns: 30,
      onToolCall: request.onToolCall,
      onToolResult: request.onToolResult,
      onText: captureText,
    })
    return buildResultFromApiOutput(target, sessionPath, collectedOutput, result.success ? undefined : result.error)
  }

  if (model === 'gemini-3.1-pro-preview') {
    const result = await runGeminiAgentLoop({
      systemPrompt: agentPrompt,
      userPrompt,
      sessionPath,
      maxTurns: 20,
      onToolCall: request.onToolCall,
      onToolResult: request.onToolResult,
      onText: captureText,
    })
    return buildResultFromApiOutput(target, sessionPath, collectedOutput, result.success ? undefined : result.error)
  }

  return {
    vibeIndex: 0,
    vibeName: target,
    filename: '',
    status: 'error',
    error: `Unknown model: ${model}`,
  }
}
