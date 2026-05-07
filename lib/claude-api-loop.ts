// ==========================================
// Claude API Agentic Loop
// ==========================================
// Raw Anthropic API — no SDK subprocess, no CLI.
// Next.js calls the API, catches tool_use blocks,
// executes them via tool-executor.ts, sends results back.
// Loop until the model stops calling tools.
// ==========================================

import { executeTool, CLAUDE_TOOL_DEFINITIONS, type ToolResult } from './tool-executor'
import { BRIDGE_SCRIPT } from './webdev'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

// ==========================================
// Types
// ==========================================

type ClaudeModel = 'claude-sonnet-4-6' | 'claude-opus-4-7'

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: any
}

interface ClaudeToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, any>
}

interface ClaudeToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export interface AgentLoopOptions {
  model: ClaudeModel
  systemPrompt: string
  userPrompt: string
  sessionPath: string
  maxTurns?: number
  onToolCall?: (toolName: string, input: Record<string, any>) => void
  onToolResult?: (toolName: string, result: ToolResult) => void
  onText?: (text: string) => void
}

export interface AgentLoopResult {
  success: boolean
  finalText: string
  toolCalls: number
  turns: number
  error?: string
}

// ==========================================
// Caching helpers — Anthropic prompt caching (Ralph 2026-05-03)
// ==========================================
// Tag the LAST tool def + LAST message block with cache_control so:
//   - all tool definitions get cached (prefix up to the last def)
//   - all conversation history up to the latest message gets cached
// Anthropic does longest-prefix-match across all cached blocks, so each
// agentic-loop iteration's cache hits prior iterations' caches even when
// the cache_control marker moves along the array.

function cacheLastToolDef(tools: any[]): any[] {
  if (tools.length === 0) return tools
  return tools.map((t, i) =>
    i === tools.length - 1
      ? { ...t, cache_control: { type: 'ephemeral', ttl: '1h' } }
      : t,
  )
}

function cacheLastMessageBlock(messages: ClaudeMessage[]): ClaudeMessage[] {
  if (messages.length === 0) return messages
  const last = messages[messages.length - 1]
  let content: any = last.content
  if (typeof content === 'string') {
    content = [{ type: 'text', text: content }]
  } else if (Array.isArray(content)) {
    content = [...content]
  } else {
    return messages
  }
  if (content.length === 0) return messages
  content[content.length - 1] = {
    ...content[content.length - 1],
    cache_control: { type: 'ephemeral' }, // 5min default — fits agentic loop window
  }
  return [...messages.slice(0, -1), { ...last, content }]
}

// ==========================================
// fetchWithRetry — 429/529/5xx aware
// ==========================================
async function fetchWithRetry(
  apiKey: string,
  body: any,
  maxAttempts = 3,
): Promise<{ content: any[]; stop_reason: string; usage?: any } | { error: string }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Enable 1h cache TTL (default is 5min if not present)
        'anthropic-beta': 'extended-cache-ttl-2025-04-11',
      },
      body: JSON.stringify(body),
    })
    if (response.ok) {
      return (await response.json()) as { content: any[]; stop_reason: string; usage?: any }
    }
    const errorText = await response.text().catch(() => '<no-body>')
    if (attempt === maxAttempts) {
      return { error: `API error ${response.status}: ${errorText}` }
    }
    let delayMs = 1000
    if (response.status === 429) {
      const ra = response.headers.get('retry-after')
      delayMs = ra ? Math.min(60000, parseInt(ra, 10) * 1000) : 5000
    } else if (response.status === 529) {
      delayMs = Math.min(60000, 1000 * Math.pow(2, attempt))
    }
    console.warn(`[claude-api-loop] retry ${attempt}/${maxAttempts} after ${delayMs}ms (${response.status})`)
    await new Promise((r) => setTimeout(r, delayMs))
  }
  return { error: 'unreachable' }
}

// ==========================================
// The Loop
// ==========================================

export async function runClaudeAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const {
    model,
    systemPrompt,
    userPrompt,
    sessionPath,
    maxTurns = 30,
    onToolCall,
    onToolResult,
    onText
  } = options

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { success: false, finalText: '', toolCalls: 0, turns: 0, error: 'ANTHROPIC_API_KEY not set' }
  }

  const messages: ClaudeMessage[] = [
    { role: 'user', content: userPrompt }
  ]

  let totalToolCalls = 0
  let finalText = ''

  for (let turn = 0; turn < maxTurns; turn++) {
    // 2026-05-03 (Ralph): prompt caching + retry/backoff.
    // - system prompt + tools cached at 1h TTL (stable across whole loop run)
    // - last message block cached at 5min TTL (stable across iterations)
    // - 429 honors retry-after; 529 exponential; other 5xx flat 1s
    const result = await fetchWithRetry(apiKey, {
      model,
      max_tokens: 16384,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ],
      tools: cacheLastToolDef(CLAUDE_TOOL_DEFINITIONS),
      messages: cacheLastMessageBlock(messages),
    })
    if ('error' in result) {
      return {
        success: false,
        finalText,
        toolCalls: totalToolCalls,
        turns: turn + 1,
        error: result.error,
      }
    }

    // 2026-05-03 (Ralph): cache hit/write telemetry. Anthropic returns
    // cache_creation_input_tokens (1.25× / 2× write cost) and
    // cache_read_input_tokens (0.1× read cost) on every cached response.
    // Log them so we can verify caching is actually working in the wild.
    const u = result.usage
    if (u) {
      console.log(
        `[claude-api-loop turn ${turn + 1}] usage: in=${u.input_tokens || 0}, out=${u.output_tokens || 0}, cacheWrite=${u.cache_creation_input_tokens || 0}, cacheRead=${u.cache_read_input_tokens || 0}`,
      )
    }

    // Collect text blocks and tool_use blocks from the response
    const textBlocks: string[] = []
    const toolUseBlocks: ClaudeToolUseBlock[] = []

    for (const block of result.content) {
      if (block.type === 'text') {
        textBlocks.push(block.text)
        onText?.(block.text)
      } else if (block.type === 'tool_use') {
        toolUseBlocks.push(block)
      }
    }

    finalText = textBlocks.join('\n')

    // Add assistant message to conversation
    messages.push({ role: 'assistant', content: result.content })

    // If no tool calls, we're done
    if (toolUseBlocks.length === 0 || result.stop_reason === 'end_turn') {
      // Post-process: inject bridge script into any HTML files written
      await injectBridgeScripts(sessionPath)

      return {
        success: true,
        finalText,
        toolCalls: totalToolCalls,
        turns: turn + 1
      }
    }

    // Execute all tool calls
    const toolResults: ClaudeToolResultBlock[] = []

    for (const toolUse of toolUseBlocks) {
      onToolCall?.(toolUse.name, toolUse.input)

      const result = await executeTool(
        { name: toolUse.name, input: toolUse.input },
        sessionPath
      )

      onToolResult?.(toolUse.name, result)
      totalToolCalls++

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result.content,
        is_error: result.isError
      })
    }

    // Add tool results as user message
    messages.push({ role: 'user', content: toolResults })
  }

  // Max turns reached
  return {
    success: false,
    finalText,
    toolCalls: totalToolCalls,
    turns: maxTurns,
    error: `Max turns (${maxTurns}) reached`
  }
}

// ==========================================
// Post-Processing — inject bridge script
// ==========================================

async function injectBridgeScripts(sessionPath: string): Promise<void> {
  const { readdir } = await import('fs/promises')

  try {
    const files = await readdir(sessionPath)
    const htmlFiles = files.filter(f => f.endsWith('.html'))

    for (const file of htmlFiles) {
      const filePath = join(sessionPath, file)
      let html = await readFile(filePath, 'utf-8')

      if (!html.includes('oskar-selected')) {
        if (html.includes('</body>')) {
          html = html.replace('</body>', BRIDGE_SCRIPT + '</body>')
        } else {
          html += BRIDGE_SCRIPT
        }
        await writeFile(filePath, html, 'utf-8')
      }
    }
  } catch {
    // No HTML files to process
  }
}
