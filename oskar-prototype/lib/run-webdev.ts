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
import type { ParsedVibe } from './creative-brief-parser'

// ==========================================
// Types
// ==========================================

export type ExecutionMode = 'cli' | 'api'

export type Model = 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'gemini-3.1-pro-preview'

// Valid combinations:
// CLI:  opus, sonnet
// API:  opus, sonnet, gemini

export interface WebDevBuildRequest {
  mode: ExecutionMode
  model: Model
  sessionId: string
  sessionPath: string
  vibe: ParsedVibe
  sessionImages: string[]
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
// Build User Prompt (shared across API providers)
// ==========================================

function buildUserPrompt(request: WebDevBuildRequest): string {
  const { vibe, sessionPath, sessionImages } = request
  const filename = `vibe-${vibe.index}-${vibe.slug}.html`
  const filePath = join(sessionPath, filename)

  const imageList = sessionImages.length > 0
    ? `\n\n**Available images:** ${sessionImages.join(', ')}`
    : '\n\n(No images available yet)'

  return `## SESSION CONTEXT

**Session Path:** ${sessionPath}
**Target File:** ${filePath}
**Target Filename:** ${filename}

### Required Reading Files
- **VIBE-${vibe.index}.md:** ${join(sessionPath, `VIBE-${vibe.index}.md`)} ← Contains creative brief + image assignments for THIS vibe
- **BUILD.md:** ${join(sessionPath, 'BUILD.md')}

---

## YOUR TASK

Build the complete HTML landing page for **Vibe ${vibe.index}: ${vibe.name}**.

**Read VIBE-${vibe.index}.md first.** It contains the full creative brief, image map, and image assignments for this vibe. Then follow your process (Step 0 through Step 6).

Write the HTML file to: \`${filePath}\`

Do NOT output the HTML in chat. Use FileWrite to create the file directly.
After writing, confirm with exactly: "File written: ${filename}"

### Vibe Details (Quick Reference)

**One-liner:** ${vibe.oneLiner}
**Voice:** ${vibe.voice}
**Target Audience:** ${vibe.whoFor}

**Colors:**
- Primary: ${vibe.colors.primary}
- Secondary: ${vibe.colors.secondary}
- Accent: ${vibe.colors.accent}

**Fonts:**
- Headings: ${vibe.fonts.headings}
- Body: ${vibe.fonts.body}

## Full Vibe Content

${vibe.content}
${imageList}

NOW READ VIBE-${vibe.index}.md AND BUILD.`
}

// ==========================================
// Verify HTML was written
// ==========================================

function verifyResult(vibe: ParsedVibe, filename: string, sessionPath: string, loopError?: string): VibeBuildResult {
  const filePath = join(sessionPath, filename)

  if (existsSync(filePath)) {
    return {
      vibeIndex: vibe.index,
      vibeName: vibe.name,
      filename,
      status: 'complete'
    }
  }

  return {
    vibeIndex: vibe.index,
    vibeName: vibe.name,
    filename,
    status: 'error',
    error: loopError || `Agent completed but ${filename} was not found on disk`
  }
}

// ==========================================
// Router
// ==========================================

export async function runWebDev(request: WebDevBuildRequest): Promise<VibeBuildResult> {
  const { mode, model, vibe, sessionPath, sessionId, sessionImages } = request
  const filename = `vibe-${vibe.index}-${vibe.slug}.html`

  console.log(`[RunWebDev] Mode: ${mode}, Model: ${model}, Vibe: ${vibe.index} ${vibe.name}`)

  // ==========================================
  // CLI MODE — Claude Code or Gemini CLI subprocess
  // ==========================================
  if (mode === 'cli') {
    if (model === 'gemini-3.1-pro-preview') {
      return buildVibeHTMLGemini(sessionId, vibe, sessionPath, sessionImages)
    }

    return buildVibeHTML(sessionId, vibe, sessionPath, sessionImages, model)
  }

  // ==========================================
  // API MODE — Next.js is the translation layer
  // All models go through here. No subprocess.
  // ==========================================

  const agentPrompt = loadWebDevAgentPrompt()
  const userPrompt = buildUserPrompt(request)

  // Claude models (Opus, Sonnet) → Anthropic API
  if (model === 'claude-opus-4-6' || model === 'claude-sonnet-4-6') {
    const result = await runClaudeAgentLoop({
      model,
      systemPrompt: agentPrompt,
      userPrompt,
      sessionPath,
      maxTurns: 30,
      onToolCall: request.onToolCall,
      onToolResult: request.onToolResult,
      onText: request.onText
    })

    return verifyResult(vibe, filename, sessionPath, result.success ? undefined : result.error)
  }

  // Gemini → Google API
  if (model === 'gemini-3.1-pro-preview') {
    const result = await runGeminiAgentLoop({
      systemPrompt: agentPrompt,
      userPrompt,
      sessionPath,
      maxTurns: 20,
      onToolCall: request.onToolCall,
      onToolResult: request.onToolResult,
      onText: request.onText
    })

    return verifyResult(vibe, filename, sessionPath, result.success ? undefined : result.error)
  }

  return {
    vibeIndex: vibe.index,
    vibeName: vibe.name,
    filename,
    status: 'error',
    error: `Unknown model: ${model}`
  }
}
