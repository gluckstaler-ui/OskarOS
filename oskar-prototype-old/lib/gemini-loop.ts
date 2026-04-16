// ==========================================
// Gemini API Agentic Loop
// ==========================================
// Gemini only gets 3 tools: FileRead, FileWrite, FileEdit.
// It reads the brief, reads images, writes HTML. That's it.
// Same loop pattern as Claude: call API → catch function calls →
// execute via tool-executor → send results back → repeat.
// ==========================================

import { executeTool, type ToolResult } from './tool-executor'
import { BRIDGE_SCRIPT } from './webdev'
import { readFile, writeFile, readdir } from 'fs/promises'
import { join } from 'path'

// ==========================================
// Types
// ==========================================

export interface GeminiLoopOptions {
  systemPrompt: string
  userPrompt: string
  sessionPath: string
  maxTurns?: number
  onToolCall?: (toolName: string, input: Record<string, any>) => void
  onToolResult?: (toolName: string, result: ToolResult) => void
  onText?: (text: string) => void
}

export interface GeminiLoopResult {
  success: boolean
  finalText: string
  toolCalls: number
  turns: number
  error?: string
}

// ==========================================
// Gemini Tool Definitions (3 tools only)
// ==========================================

const GEMINI_TOOLS = {
  functionDeclarations: [
    {
      name: 'FileRead',
      description: 'Read a file from disk. Returns text content with line numbers, or base64 for images.',
      parameters: {
        type: 'OBJECT' as const,
        properties: {
          file_path: { type: 'STRING' as const, description: 'Path to the file to read' },
          offset: { type: 'NUMBER' as const, description: 'Line number to start from (0-based). Optional.' },
          limit: { type: 'NUMBER' as const, description: 'Max lines to return. Optional.' }
        },
        required: ['file_path']
      }
    },
    {
      name: 'FileWrite',
      description: 'Write content to a file. Creates the file if it does not exist. Overwrites if it does.',
      parameters: {
        type: 'OBJECT' as const,
        properties: {
          file_path: { type: 'STRING' as const, description: 'Path to write to' },
          content: { type: 'STRING' as const, description: 'The full content to write' }
        },
        required: ['file_path', 'content']
      }
    },
    {
      name: 'FileEdit',
      description: 'Find-and-replace in a file. Fails if old_string is not found or not unique.',
      parameters: {
        type: 'OBJECT' as const,
        properties: {
          file_path: { type: 'STRING' as const, description: 'Path to the file to edit' },
          old_string: { type: 'STRING' as const, description: 'The exact text to find and replace' },
          new_string: { type: 'STRING' as const, description: 'The replacement text' },
          replace_all: { type: 'BOOLEAN' as const, description: 'Replace all occurrences (default: false)' }
        },
        required: ['file_path', 'old_string', 'new_string']
      }
    }
  ]
}

// ==========================================
// The Loop
// ==========================================

export async function runGeminiAgentLoop(options: GeminiLoopOptions): Promise<GeminiLoopResult> {
  const {
    systemPrompt,
    userPrompt,
    sessionPath,
    maxTurns = 20,
    onToolCall,
    onToolResult,
    onText
  } = options

  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) {
    return { success: false, finalText: '', toolCalls: 0, turns: 0, error: 'GOOGLE_API_KEY not set' }
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${apiKey}`

  // Build initial contents — Gemini uses system instruction separately
  const contents: any[] = [
    { role: 'user', parts: [{ text: userPrompt }] }
  ]

  let totalToolCalls = 0
  let finalText = ''

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: [GEMINI_TOOLS],
        generationConfig: {
          maxOutputTokens: 65536
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        finalText,
        toolCalls: totalToolCalls,
        turns: turn + 1,
        error: `Gemini API error ${response.status}: ${errorText}`
      }
    }

    const result = await response.json()
    const candidate = result.candidates?.[0]

    if (!candidate?.content?.parts) {
      return {
        success: false,
        finalText,
        toolCalls: totalToolCalls,
        turns: turn + 1,
        error: 'No content in Gemini response'
      }
    }

    const parts = candidate.content.parts

    // Collect text and function calls
    const textParts: string[] = []
    const functionCalls: Array<{ name: string; args: Record<string, any> }> = []

    for (const part of parts) {
      if (part.text) {
        textParts.push(part.text)
        onText?.(part.text)
      }
      if (part.functionCall) {
        functionCalls.push({
          name: part.functionCall.name,
          args: part.functionCall.args || {}
        })
      }
    }

    finalText = textParts.join('\n')

    // Add model response to conversation
    contents.push({ role: 'model', parts })

    // If no function calls, we're done
    if (functionCalls.length === 0) {
      await injectBridgeScripts(sessionPath)
      return {
        success: true,
        finalText,
        toolCalls: totalToolCalls,
        turns: turn + 1
      }
    }

    // Execute function calls and build response parts
    const responseParts: any[] = []

    for (const fc of functionCalls) {
      onToolCall?.(fc.name, fc.args)

      const toolResult = await executeTool(
        { name: fc.name, input: fc.args },
        sessionPath
      )

      onToolResult?.(fc.name, toolResult)
      totalToolCalls++

      responseParts.push({
        functionResponse: {
          name: fc.name,
          response: {
            content: toolResult.content,
            isError: toolResult.isError || false
          }
        }
      })
    }

    // Add function responses as user turn
    contents.push({ role: 'user', parts: responseParts })
  }

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
