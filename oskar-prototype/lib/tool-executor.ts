// ==========================================
// Tool Executor — Next.js as the translation layer
// ==========================================
// Both Claude API and Gemini API route tool calls here.
// This is what executes when the model says "call FileWrite".
// Node.js does the work. No SDK subprocess. No CLI.
// ==========================================

import { readFile, writeFile, appendFile, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { exec } from 'child_process'
import { join, relative, resolve } from 'path'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ==========================================
// Types
// ==========================================

export interface ToolCall {
  name: string
  input: Record<string, any>
}

export interface ToolResult {
  name: string
  content: string
  isError?: boolean
}

// ==========================================
// Path Security
// ==========================================

function isPathSafe(filePath: string, sessionPath: string): boolean {
  const resolved = resolve(filePath)
  const resolvedSession = resolve(sessionPath)
  return resolved.startsWith(resolvedSession)
}

function resolvePath(filePath: string, sessionPath: string): string {
  // If already absolute and inside session, use as-is
  if (filePath.startsWith('/')) {
    return filePath
  }
  // Otherwise resolve relative to session path
  return join(sessionPath, filePath)
}

// ==========================================
// Tool Implementations
// ==========================================

async function executeFileRead(input: Record<string, any>, sessionPath: string): Promise<string> {
  const filePath = resolvePath(input.file_path || input.path, sessionPath)

  if (!isPathSafe(filePath, sessionPath)) {
    throw new Error(`Access denied: path outside session folder`)
  }

  // Check if it's an image — return base64 for multimodal
  const ext = filePath.toLowerCase().split('.').pop()
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext || '')) {
    const buffer = await readFile(filePath)
    const base64 = buffer.toString('base64')
    const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'png' ? 'image/png'
      : ext === 'webp' ? 'image/webp'
      : 'image/gif'
    return `[Image: ${filePath}] (${buffer.length} bytes, ${mimeType})\nBase64: ${base64.substring(0, 200)}... [truncated for tool result — full image available]`
  }

  // Text file — respect offset/limit if provided
  const content = await readFile(filePath, 'utf-8')
  const lines = content.split('\n')

  const offset = input.offset || 0
  const limit = input.limit || lines.length

  return lines.slice(offset, offset + limit).map((line, i) => `${offset + i + 1}\t${line}`).join('\n')
}

async function executeFileWrite(input: Record<string, any>, sessionPath: string): Promise<string> {
  const filePath = resolvePath(input.file_path || input.path, sessionPath)

  if (!isPathSafe(filePath, sessionPath)) {
    throw new Error(`Access denied: path outside session folder`)
  }

  await writeFile(filePath, input.content, 'utf-8')
  const stats = await stat(filePath)
  return `File written: ${filePath} (${stats.size} bytes)`
}

async function executeFileEdit(input: Record<string, any>, sessionPath: string): Promise<string> {
  const filePath = resolvePath(input.file_path || input.path, sessionPath)

  if (!isPathSafe(filePath, sessionPath)) {
    throw new Error(`Access denied: path outside session folder`)
  }

  const content = await readFile(filePath, 'utf-8')
  const oldString = input.old_string
  const newString = input.new_string

  if (!content.includes(oldString)) {
    throw new Error(`old_string not found in ${filePath}. Make sure the string matches exactly.`)
  }

  // Check uniqueness unless replace_all is set
  if (!input.replace_all) {
    const occurrences = content.split(oldString).length - 1
    if (occurrences > 1) {
      throw new Error(`old_string found ${occurrences} times in ${filePath}. Provide more context to make it unique, or set replace_all: true.`)
    }
  }

  const updated = input.replace_all
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString)

  await writeFile(filePath, updated, 'utf-8')
  return `File edited: ${filePath} (replaced ${input.replace_all ? 'all occurrences' : '1 occurrence'})`
}

async function executeGlob(input: Record<string, any>, sessionPath: string): Promise<string> {
  const pattern = input.pattern
  const searchPath = input.path ? resolvePath(input.path, sessionPath) : sessionPath

  if (!isPathSafe(searchPath, sessionPath)) {
    throw new Error(`Access denied: path outside session folder`)
  }

  // Use find command for glob matching within session
  try {
    const { stdout } = await execAsync(
      `find "${searchPath}" -name "${pattern}" -type f 2>/dev/null | head -100`,
      { timeout: 10000 }
    )
    const files = stdout.trim().split('\n').filter(Boolean)
    if (files.length === 0) return `No files matching "${pattern}" in ${searchPath}`
    return files.map(f => relative(sessionPath, f)).join('\n')
  } catch {
    return `No files matching "${pattern}"`
  }
}

async function executeGrep(input: Record<string, any>, sessionPath: string): Promise<string> {
  const pattern = input.pattern
  const searchPath = input.path ? resolvePath(input.path, sessionPath) : sessionPath

  if (!isPathSafe(searchPath, sessionPath)) {
    throw new Error(`Access denied: path outside session folder`)
  }

  try {
    const flags = input['-i'] ? '-rni' : '-rn'
    const { stdout } = await execAsync(
      `grep ${flags} "${pattern.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -50`,
      { timeout: 10000 }
    )
    return stdout.trim() || `No matches for "${pattern}"`
  } catch {
    return `No matches for "${pattern}"`
  }
}

async function executeBash(input: Record<string, any>, sessionPath: string): Promise<string> {
  const command = input.command

  // Block dangerous patterns
  const dangerous = /rm\s+-rf\s+\/|chmod\s+777|curl.*\|\s*sh|wget.*\|\s*sh|mkfs|dd\s+if=/
  if (dangerous.test(command)) {
    throw new Error('Dangerous command blocked')
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: sessionPath,
      timeout: input.timeout || 30000,
      maxBuffer: 1024 * 1024 // 1MB
    })
    let result = ''
    if (stdout.trim()) result += stdout.trim()
    if (stderr.trim()) result += (result ? '\n' : '') + `stderr: ${stderr.trim()}`
    return result || '(no output)'
  } catch (error: any) {
    return `Command failed (exit ${error.code || 'unknown'}): ${error.stderr || error.message}`
  }
}

async function executeWebFetch(input: Record<string, any>): Promise<string> {
  const url = input.url
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'OskarOS-Agent/1.0' },
      signal: AbortSignal.timeout(15000)
    })

    const contentType = response.headers.get('content-type') || ''

    if (contentType.includes('text/html') || contentType.includes('text/plain') || contentType.includes('application/json')) {
      const text = await response.text()
      // Truncate to avoid blowing context
      const maxLen = 50000
      return text.length > maxLen
        ? text.substring(0, maxLen) + `\n\n[Truncated — ${text.length} total characters]`
        : text
    }

    return `Fetched ${url} — content-type: ${contentType}, status: ${response.status}, size: ${response.headers.get('content-length') || 'unknown'}`
  } catch (error: any) {
    throw new Error(`WebFetch failed: ${error.message}`)
  }
}

async function executeWebSearch(input: Record<string, any>): Promise<string> {
  // Stub — needs a search API (Brave, Serper, etc.)
  // For now, return a message telling the agent to use WebFetch with a search URL
  const query = input.query
  return `WebSearch not yet connected to a search provider. Use WebFetch with a search engine URL instead, e.g.: https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
}

async function executeAppendLog(input: Record<string, any>, sessionPath: string): Promise<string> {
  const buildMdPath = join(sessionPath, 'BUILD.md')
  const timestamp = new Date().toISOString().substring(11, 19)
  const line = `| ${timestamp} | ${input.message} |\n`
  await appendFile(buildMdPath, line)
  return `Logged: ${input.message}`
}

// ==========================================
// Main Executor — routes tool calls to implementations
// ==========================================

export async function executeTool(toolCall: ToolCall, sessionPath: string): Promise<ToolResult> {
  const { name, input } = toolCall

  try {
    let content: string

    switch (name) {
      case 'FileRead':
      case 'Read':
        content = await executeFileRead(input, sessionPath)
        break

      case 'FileWrite':
      case 'Write':
        content = await executeFileWrite(input, sessionPath)
        break

      case 'FileEdit':
      case 'Edit':
        content = await executeFileEdit(input, sessionPath)
        break

      case 'Glob':
        content = await executeGlob(input, sessionPath)
        break

      case 'Grep':
        content = await executeGrep(input, sessionPath)
        break

      case 'Bash':
        content = await executeBash(input, sessionPath)
        break

      case 'WebFetch':
        content = await executeWebFetch(input)
        break

      case 'WebSearch':
        content = await executeWebSearch(input)
        break

      case 'append_log':
        content = await executeAppendLog(input, sessionPath)
        break

      // Phase 2 (2026-04-30): API-mode report_* tools. Pure ack — runWebDev
      // reads the args via the onToolCall callback and uses them as the
      // primary manifest source.
      case 'report_build_complete':
        content = `report_build_complete acked: ${input.filename}`
        break
      case 'report_build_failed':
        content = `report_build_failed acked: ${input.error}`
        break
      case 'report_build_progress':
        content = `report_build_progress acked: ${input.milestone}`
        break

      default:
        content = `Unknown tool: ${name}. Available tools: FileRead, FileWrite, FileEdit, Glob, Grep, Bash, WebFetch, WebSearch, append_log, report_build_complete, report_build_failed, report_build_progress`
    }

    return { name, content }
  } catch (error: any) {
    return { name, content: `Error: ${error.message}`, isError: true }
  }
}

// ==========================================
// Tool Definitions — for API function calling
// ==========================================

// Anthropic format (Claude API)
export const CLAUDE_TOOL_DEFINITIONS = [
  {
    name: 'FileRead',
    description: 'Read a file from disk. Returns text content with line numbers, or base64 for images. Supports text, images (jpg, png, webp), and PDFs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path to the file to read (relative to session or absolute)' },
        offset: { type: 'number', description: 'Line number to start from (0-based). Optional.' },
        limit: { type: 'number', description: 'Max lines to return. Optional.' }
      },
      required: ['file_path']
    }
  },
  {
    name: 'FileWrite',
    description: 'Write content to a file. Creates the file if it does not exist. Overwrites if it does.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path to write to (relative to session or absolute)' },
        content: { type: 'string', description: 'The full content to write' }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'FileEdit',
    description: 'Find-and-replace in a file. Surgical editing — only changes what you specify. Fails if old_string is not found or not unique (unless replace_all is true).',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path to the file to edit' },
        old_string: { type: 'string', description: 'The exact text to find and replace' },
        new_string: { type: 'string', description: 'The replacement text' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' }
      },
      required: ['file_path', 'old_string', 'new_string']
    }
  },
  {
    name: 'Glob',
    description: 'Find files by name pattern. Returns matching file paths relative to session folder.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Glob pattern, e.g. "*.html", "*.jpg"' },
        path: { type: 'string', description: 'Directory to search in. Optional, defaults to session folder.' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'Grep',
    description: 'Search file contents by regex pattern. Returns matching lines with line numbers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'File or directory to search in. Optional, defaults to session folder.' },
        '-i': { type: 'boolean', description: 'Case insensitive search' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'Bash',
    description: 'Execute a shell command. Runs inside the session folder. Dangerous commands are blocked.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' }
      },
      required: ['command']
    }
  },
  {
    name: 'WebFetch',
    description: 'Fetch a URL and return its content. Returns HTML/text for web pages, metadata for binary files.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The URL to fetch' }
      },
      required: ['url']
    }
  },
  {
    name: 'WebSearch',
    description: 'Search the web for information.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' }
      },
      required: ['query']
    }
  },
  {
    name: 'append_log',
    description: 'Append a timestamped line to BUILD.md for build progress tracking.',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: 'Log message to append' }
      },
      required: ['message']
    }
  },
  // ── Phase 2 (2026-04-30): API-mode report_* tools ───────────────────────
  // CLI mode calls these via the MCP server; API mode runs the agent loop
  // in-process, so we register the same contract directly. Executor just
  // ACKs — runWebDev reads the args via the `onToolCall` callback.
  {
    name: 'report_build_complete',
    description:
      'Call AFTER writing the vibe HTML to disk. Reports the structured manifest ' +
      '(filename, vibeIndex, vibeName, sections built, images used). Replaces the ' +
      'old "end your response with a JSON manifest line" contract.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filename: { type: 'string', description: 'The .html file you wrote.' },
        vibeIndex: { type: 'number', description: 'Numeric vibe index from VIBE-N.md.' },
        vibeName: { type: 'string', description: 'Human-readable vibe name.' },
        sectionsBuilt: { type: 'array', items: { type: 'string' }, description: 'Sections present in the HTML.' },
        imagesUsed: { type: 'array', items: { type: 'string' }, description: 'Image filenames referenced in the HTML.' },
      },
      required: ['filename', 'vibeIndex', 'vibeName', 'sectionsBuilt', 'imagesUsed']
    }
  },
  {
    name: 'report_build_failed',
    description: 'Call when the build cannot complete. Stops the build cleanly.',
    input_schema: {
      type: 'object' as const,
      properties: {
        error: { type: 'string', description: 'One-to-three-sentence explanation.' }
      },
      required: ['error']
    }
  },
  {
    name: 'report_build_progress',
    description: 'Optional. Emit a progress milestone mid-build.',
    input_schema: {
      type: 'object' as const,
      properties: {
        milestone: { type: 'string' }
      },
      required: ['milestone']
    }
  }
]

// Gemini format (function declarations)
export const GEMINI_TOOL_DEFINITIONS = {
  functionDeclarations: CLAUDE_TOOL_DEFINITIONS.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'OBJECT' as const,
      properties: Object.fromEntries(
        Object.entries(tool.input_schema.properties).map(([key, val]: [string, any]) => [
          key,
          { type: val.type.toUpperCase(), description: val.description }
        ])
      ),
      required: tool.input_schema.required
    }
  }))
}
