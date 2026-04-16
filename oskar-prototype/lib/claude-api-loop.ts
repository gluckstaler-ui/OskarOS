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

type ClaudeModel = 'claude-sonnet-4-6' | 'claude-opus-4-6'

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
    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 16384,
        system: systemPrompt,
        tools: CLAUDE_TOOL_DEFINITIONS,
        messages
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        finalText,
        toolCalls: totalToolCalls,
        turns: turn + 1,
        error: `API error ${response.status}: ${errorText}`
      }
    }

    const result = await response.json() as {
      content: any[]
      stop_reason: string
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
