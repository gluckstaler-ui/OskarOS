import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, appendFile, readFile, readdir } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { buildCDPrompt } from '@/lib/cd-agent-prompt'
import { ImageAsset, ImageManifest, VibeToolInput, AspectRatio, ImageSize, ImageOperation } from '@/lib/types'
import { appendUsage, calculateCost } from '@/lib/usage-tracker'
import {
  getSessionMdPath, getUserMemoryPath, getDreamLogPath,
  getLogsDir
} from '@/lib/memory/paths'
import { maybeRunLumberjack } from '@/lib/memory/lumberjack'

function getApiKey(): string {
  try {
    const raw = readFileSync(path.join(process.cwd(), '.api-key'), 'utf-8').trim()
    return raw.split('=')[1] || ''
  } catch {
    return ''
  }
}

// ==========================================
// Tool Definitions for Claude
// ==========================================

const TOOLS = [
  {
    name: "generate_vibe",
    description: "Generate a complete landing page vibe with HTML, image assets, and styling metadata. Call this tool once per vibe you want to create. For 3 vibes, call this tool 3 times.",
    input_schema: {
      type: "object",
      required: ["name", "html", "imageAssets", "moodboard"],
      properties: {
        name: {
          type: "string",
          description: "Unique name for this vibe (e.g., 'The Kitchen Person', 'Vienna at 2AM')"
        },
        html: {
          type: "string",
          description: "Complete, self-contained HTML with inline CSS. Must include: hero, menu/offerings with prices, location/hours, booking CTA, footer. Use data-usage attributes on images and data-editable on text elements."
        },
        imageAssets: {
          type: "array",
          description: "Images needed for this vibe",
          items: {
            type: "object",
            required: ["filename", "operation", "instruction", "usage"],
            properties: {
              filename: { type: "string", description: "Target filename (e.g., 'hero.jpg')" },
              operation: {
                type: "string",
                enum: ["generate", "compose", "extract", "adjust"],
                description: "generate=create from prompt, compose=combine sources, extract=pull element to clean background, adjust=modify existing"
              },
              instruction: { type: "string", description: "Detailed prompt for image generation" },
              usage: { type: "string", description: "Where this image goes (hero, background, portrait, gallery, etc.)" },
              sourceImages: {
                type: "array",
                items: { type: "string" },
                description: "Paths to source images (for compose/extract/adjust operations)"
              },
              aspectRatio: {
                type: "string",
                enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
                description: "Aspect ratio for the image"
              },
              resolution: {
                type: "string",
                enum: ["1K", "2K", "4K"],
                description: "Resolution (1K for icons, 2K for hero, 4K for large backgrounds)"
              }
            }
          }
        },
        moodboard: {
          type: "object",
          required: ["headline", "tagline", "colors", "typography"],
          properties: {
            headline: { type: "string", description: "The hero headline that makes people FEEL something" },
            tagline: { type: "string", description: "Supporting subline" },
            colors: {
              type: "array",
              items: { type: "string" },
              description: "Hex color codes used in this vibe"
            },
            typography: {
              type: "object",
              properties: {
                heading: { type: "string", description: "Heading font family" },
                body: { type: "string", description: "Body font family" }
              }
            },
            voiceSamples: {
              type: "array",
              items: { type: "string" },
              description: "Example copy snippets that show this vibe's voice"
            }
          }
        }
      }
    }
  },
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
  }
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
  options: { useTools?: boolean; toolChoice?: 'auto' | 'any' | { type: 'tool', name: string } } = {},
  retries = 3,
  apiKey?: string
): Promise<any> {
  if (!apiKey) apiKey = getApiKey()
  const { useTools = false, toolChoice = 'auto' } = options

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`API attempt ${attempt}/${retries} starting...`)

      // 10 minute timeout for large generation tasks
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 600000) // 10 minutes

      const requestBody: any = {
        model: 'claude-opus-4-6',
        max_tokens: 128000,
        system: system,
        messages: messages,
        output_config: {
          effort: 'max'
        }
      }

      // Add tools if requested
      if (useTools) {
        requestBody.tools = TOOLS
        // Format tool_choice correctly for Anthropic API
        if (typeof toolChoice === 'string') {
          requestBody.tool_choice = { type: toolChoice }
        } else {
          requestBody.tool_choice = toolChoice
        }
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'context-1m-2025-08-07',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      console.log(`Response status: ${response.status}`)

      const data = await response.json() as any

      if (data.error) {
        console.error('Anthropic API error:', JSON.stringify(data.error, null, 2))
        throw new Error(`Anthropic API error: ${data.error.message || JSON.stringify(data.error)}`)
      }

      console.log(`API attempt ${attempt} succeeded, stop_reason: ${data.stop_reason}`)
      return data

    } catch (error: any) {
      console.log(`API attempt ${attempt} failed:`, error.message)
      if (attempt === retries) throw error
      console.log(`Waiting 1s before retry...`)
      await new Promise(r => setTimeout(r, 1000))
    }
  }
}

// ==========================================
// Execute File Tools
// ==========================================

async function executeFileTool(
  toolName: string,
  toolInput: any,
  sessionId: string
): Promise<{ success: boolean; result?: string; error?: string }> {
  const sessionPath = path.join(process.cwd(), 'public', sessionId)

  try {
    switch (toolName) {
      case 'read_file': {
        const filename = toolInput.filename

        // Special case: boot files (read-only access to agents/ folder)
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

  let vibeIndex = 0

  for (const block of response.content) {
    if (block.type === 'text') {
      result.textMessage += block.text
    } else if (block.type === 'tool_use') {
      console.log(`[${requestId}] Tool call: ${block.name}`)

      if (block.name === 'generate_vibe') {
        const input = block.input as VibeToolInput
        const vibeId = `vibe-${requestId}-${vibeIndex}`

        // Extract vibe data
        result.vibes.push({
          name: input.name,
          html: input.html,
          headline: input.moodboard.headline,
          tagline: input.moodboard.tagline,
          colors: input.moodboard.colors,
          typography: input.moodboard.typography,
          voiceSamples: input.moodboard.voiceSamples || []
        })

        // Extract image assets
        if (input.imageAssets && input.imageAssets.length > 0) {
          const assets: ImageAsset[] = input.imageAssets.map((asset, j) => ({
            id: `asset-${requestId}-${vibeIndex}-${j}`,
            filename: asset.filename,
            operation: asset.operation as ImageOperation,
            sourceImages: asset.sourceImages || [],
            instruction: asset.instruction,
            usage: asset.usage as any,
            aspectRatio: (asset.aspectRatio || '16:9') as AspectRatio,
            resolution: (asset.resolution || '1K') as ImageSize,
            status: 'pending' as const,
            vibeId,
            vibeName: input.name
          }))

          result.imageManifests.push({
            vibeId,
            vibeName: input.name,
            assets
          })
        }

        vibeIndex++
      } else if (block.name === 'ask_discovery_questions') {
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

export async function POST(req: NextRequest) {
  const requestId = Date.now()
  console.log(`=== Chat API called [${requestId}] ===`)

  const apiKey = getApiKey()
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 503 })
  }

  try {
    const body = await req.json()
    console.log(`[${requestId}] Request body keys:`, Object.keys(body))
    const { messages, uploadedFiles, triggerAssessment, sourceImages, sessionId, isResume } = body as {
      messages: Message[]
      uploadedFiles: UploadedFile[]
      triggerAssessment?: boolean
      sourceImages?: SourceImageInfo[]
      sessionId?: string
      isResume?: boolean
    }

    // Load memory system files for prompt context
    const effectiveSessionId = sessionId || 'default-session'
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

    // Build system prompt with source image info + memory context
    let systemPrompt = buildCDPrompt(sourceImages || [], effectiveSessionId, isResume || false, memorySessionFiles)

    // Pre-load CD-MEMORY.md into system prompt (boot file)
    const cdMemoryPath = path.join(process.cwd(), 'agents', 'CD-MEMORY.md')
    if (existsSync(cdMemoryPath)) {
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

    console.log(`[${requestId}] Making API request with ${claudeMessages.length} messages, useTools: true, isGenerateRequest: ${isGenerateRequest}`)

    // Tool execution loop - keep calling API until no more tool_use
    let currentMessages = [...claudeMessages]
    let response: any
    let totalInputTokens = 0
    let totalOutputTokens = 0
    const MAX_TOOL_ITERATIONS = 10 // Safety limit

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      // Call API
      response = await callAnthropicAPI(
        currentMessages,
        systemPrompt,
        { useTools: true, toolChoice: 'auto' },
        3,
        apiKey
      )

      if (response.error) {
        throw new Error(`API error: ${JSON.stringify(response.error)}`)
      }

      // Track tokens
      totalInputTokens += response.usage?.input_tokens || 0
      totalOutputTokens += response.usage?.output_tokens || 0

      // Check if we need to execute file tools
      const fileToolCalls = response.content?.filter((block: any) =>
        block.type === 'tool_use' &&
        ['read_file', 'write_file', 'list_files'].includes(block.name)
      ) || []

      if (fileToolCalls.length === 0 || response.stop_reason !== 'tool_use') {
        // No file tools to execute, we're done
        console.log(`[${requestId}] Tool loop complete after ${iteration + 1} iterations`)
        break
      }

      // Execute file tools and build tool_results
      console.log(`[${requestId}] Executing ${fileToolCalls.length} file tool(s)...`)

      // Add assistant's response to messages
      currentMessages.push({
        role: 'assistant',
        content: response.content
      })

      // Execute each tool and collect results
      const toolResults: any[] = []
      for (const toolCall of fileToolCalls) {
        console.log(`[${requestId}] Executing tool: ${toolCall.name}`)
        const result = await executeFileTool(toolCall.name, toolCall.input, sessionId || 'default-session')

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: result.success ? result.result : `Error: ${result.error}`
        })
      }

      // Add tool results as user message
      currentMessages.push({
        role: 'user',
        content: toolResults
      })
    }

    // Parse tool calls from final response
    const parsed = parseToolCalls(response, requestId)

    // Track token usage if sessionId provided
    const contextWindow = 200000
    const contextPct = totalInputTokens > 0 ? Math.round((totalInputTokens / contextWindow) * 100) : 0
    if (sessionId && (totalInputTokens > 0 || totalOutputTokens > 0)) {
      try {
        const cost = calculateCost(totalInputTokens, totalOutputTokens)
        await appendUsage(sessionId, 'CD', { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost }, 'Chat API call', { contextPct, contextWindow })
        console.log(`[${requestId}] Usage tracked: ${totalInputTokens}in/${totalOutputTokens}out = $${cost.toFixed(4)} | Context: ${contextPct}%`)
      } catch (usageErr) {
        console.error(`[${requestId}] Failed to track usage:`, usageErr)
      }
    }

    // Lumberjack handles session cleanup on 10-minute timer — no per-turn consolidation

    // Build the text message to display
    let assistantMessage = parsed.textMessage

    // If there are discovery questions, format them nicely
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
    return NextResponse.json(
      { error: `Failed: ${error}` },
      { status: 500 }
    )
  }
}
