# OskarOS Implementation Bundle

Complete implementation files for the three architectural improvements:
1. **Tool Use** - Structured outputs from Claude (replaces fragile regex)
2. **Live Preview** - postMessage bridge for instant image updates
3. **Director Mode** - Click-to-select visual editing in iframe

> Status block added: 2026-05-01

---

## STATUS UPDATE — 2026-05-01

Plan body below is preserved for context. Three architectural improvements all landed; Tool Use was structurally superseded by typed MCP tool calls (Phase 2/3), but the original three inline tools remain in `/api/chat` for API-mode vibe generation. Live Preview and Director Mode are operational with consolidated iframe-contract constants.

### STATUS IMPROVEMENT 1 — Tool Use - SHIPPED (SUPERSEDED IN PART)

**SHIPPED:** Three inline tools in API-mode `/api/chat/route.ts` (`generate_vibe`, `ask_discovery_questions`, `confirm_understanding`) plus three filesystem helpers (`read_file`, `write_file`, `list_files`); `parseToolCalls()` extracts structured data; `tool_choice: { type: 'auto' }` format honored; Anthropic + Gemini parallel paths via `lib/claude-api-loop.ts` + `lib/gemini-loop.ts`.

**CHANGED:** Magic-string triggers (`## BUILD:`, `## VIBES READY`, `## HOTSWAP:` etc.) RETIRED 2026-04-29. Production path is now typed MCP tool calls (`build_vibe`, `build_all_vibes`, `hotswap`, `submit_proofread`, `submit_image_verdict`, `submit_upload_eval`, `submit_image_prompt`, `report_build_complete`, `report_build_failed`, `report_build_progress`, `snackbar`, `generate_image`, `screenshot`, `ask_user`, `session_meta`, `list_assets`, `find_assets`, `lint_brand_compliance`, `apply_patch`, `image_ops`, `vibe_diff`, `job_status`, `cancel_job`) defined in `mcp-server/tools-{cd,webdev,sentinel,orchestrator,capabilities}.ts` and captured by `lib/mcp-tool-collector.ts`. The 3 inline tools survive in `/api/chat` but are scoped to API-mode vibe generation, not the agent contract.

**OPEN:** The 22 MCP tools aren't yet exposed to API-mode `/api/chat`. Tracked in `IMPLEMENTATION-PLAN-API-AGENT.md` § STATUS PHASE 2 — same gap, same fix.

**DO NOT IMPLEMENT:**
- Restore regex-based parsing of agent output for build triggers — replaced by typed tool calls.
- Re-create `parseToolCalls()` in additional routes — `lib/mcp-tool-collector.ts` is the single source of truth for tool-result capture.
- Treat `lib/types.ts` snippet in this bundle as canonical — types have evolved substantially. Read `lib/types.ts` from disk.

### STATUS IMPROVEMENT 2 — Live Preview - SHIPPED

**SHIPPED:** `BRIDGE_SCRIPT` injected into generated HTML files; iframe ↔ parent postMessage protocol working; `UPDATE_IMAGE`, `UPDATE_TEXT`, `HIGHLIGHT_ELEMENT` message handlers; gallery `querySelectorAll` for multiple-element targets; `window.oskarCanvas.sendImageUpdate()` API.

**CHANGED:** Bridge logic factored out of `lib/webdev.ts` into `lib/studio-bridge.ts` + `lib/director-css.ts` for shared iframe-contract constants (`DIRECTOR_CLASS`, `DIRECTOR_ACTIVE_CLASS`, `BG_IMAGE_FLAG_ATTR`, `BG_IMAGE_SRC_ATTR`, `OSKAR_ID_ATTR`). The single `BRIDGE_SCRIPT` constant is now interpolated at build time so the iframe and parent agree on attribute names — fixes the historical class-name-typo class of bugs.

**DO NOT IMPLEMENT:**
- Inline the bridge again — the consolidation prevents drift.
- Re-add `vibeEdits` as in-memory React state for persistence — Director Mode now persists via `director_save` event-bus event + `apply_patch` MCP tool. RAM-only state was the wrong model.

### STATUS IMPROVEMENT 3 — Director Mode - SHIPPED

**SHIPPED:** Click-to-select on `data-editable` / `data-usage` elements; properties panel for text editing; `director_save` event bus event (2026-04-30) for push notifications to CD; `LivePreviewWithDirector.tsx` wired to use the shared iframe contract; `apply_patch` MCP tool (jsdom patcher) persists edits to disk.

**CHANGED:** Edit memory injection to AI-via-prompt (the plan's "edits sent to AI in subsequent messages") DROPPED — replaced by `apply_patch` tool calls and the `director_save` event. CD doesn't get edits as ambient context; she gets a typed event when an edit lands and can decide to inspect via `vibe_diff`.

**DO NOT IMPLEMENT:**
- Send Director-mode edits to CD as untyped chat-text context — the typed event + `vibe_diff` tool is the contract.
- Treat the `CanvasPanel.tsx` snippet in File 4 as canonical — that component split into `LivePreviewWithDirector`, `AssetsPanel`, and others.

### STATUS — File 1-5 snippets

The plan body's File-by-File code blocks (File 1: `lib/types.ts`, File 2: `app/api/chat/route.ts`, File 3: `lib/cd-agent-prompt.ts`, File 4: `components/CanvasPanel.tsx`, File 5: `app/page.tsx`) are HISTORICAL ARTIFACTS. Read the actual files on disk — types expanded (e.g., `LayoutMode` is now a 4-mode union, not 2; `WorkflowPhase` has 5 values, not 5 of those values), the chat route grew from ~1000 LOC to ~970 with parallel `/api/chat-stream`, and `CanvasPanel.tsx` no longer carries Director Mode (split into multiple components).

---

```typescript
// Image operation types
export type ImageOperation = 'generate' | 'compose' | 'extract' | 'adjust'
export type ImageUsage = 'hero' | 'background' | 'portrait' | 'icon' | 'gallery' | 'logo-overlay'
export type AssetStatus = 'pending' | 'generating' | 'complete' | 'error'
export type ImageSize = '1K' | '2K' | '4K'
export type AspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9'

// Resolution defaults by usage
export const USAGE_DEFAULTS: Record<ImageUsage, { resolution: ImageSize, aspectRatio: AspectRatio }> = {
  'hero': { resolution: '2K', aspectRatio: '16:9' },
  'background': { resolution: '2K', aspectRatio: '16:9' },
  'portrait': { resolution: '1K', aspectRatio: '3:4' },
  'icon': { resolution: '1K', aspectRatio: '1:1' },
  'gallery': { resolution: '1K', aspectRatio: '4:3' },
  'logo-overlay': { resolution: '2K', aspectRatio: '16:9' }
}

// Source image analysis result
export interface SourceAnalysis {
  elements: string[]              // ["falcon", "camel", "man with beard"]
  description: string             // "A man in traditional dress with a falcon..."
  suggestedExtractions: string[]  // ["Extract the falcon", "Extract the camel"]
}

// Source image with analysis
export interface SourceImage {
  id: string
  filename: string
  path: string                    // /uploads/steve.jpg
  uploadedAt: string
  analysis?: SourceAnalysis
}

// Individual image asset in the pipeline
export interface ImageAsset {
  id: string
  filename: string                // Target filename: falcon-portrait.jpg
  operation: ImageOperation
  sourceImages: string[]          // Paths to source files
  instruction: string             // The prompt (editable by user)
  usage: ImageUsage
  aspectRatio: AspectRatio
  resolution: ImageSize
  status: AssetStatus
  resultPath?: string             // Output path after generation
  resultUrl?: string              // Base64 data URL (temporary)
  vibeId: string
  vibeName: string
  error?: string
  versions?: string[]             // Previous generation paths
}

// Manifest for a vibe's images
export interface ImageManifest {
  vibeId: string
  vibeName: string
  assets: ImageAsset[]
}

// Vibe data
export interface VibeData {
  id: string
  name: string
  category: string
  headline: string
  tagline: string
  colors: string[]
  typography: { heading: string; body: string }
  voiceSamples: string[]
  htmlPath: string
  html?: string
  selected?: boolean
}

// Conversation message
export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  images?: string[]
}

// Workflow phases
export type WorkflowPhase = 'discovery' | 'moodboard' | 'selection' | 'generation' | 'preview'

// Layout modes
export type LayoutMode = '2-panel' | '3-panel'

// Moodboard quadrant position
export type QuadrantPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

// Moodboard vibe concept
export interface MoodboardConcept {
  name: string
  visualStyle: string
  colorPalette: string[]
  headline: string
  oneWord: string
  position: QuadrantPosition
}

// Moodboard data
export interface MoodboardData {
  id: string
  imagePath: string            // /generated-images/moodboard-{timestamp}.jpg
  concepts: MoodboardConcept[]
  selectedConcept?: string     // name of selected concept
  generatedAt: string
}

// Image generation queue item
export interface ImageQueueItem {
  id: string
  asset: ImageAsset
  approved: boolean
  status: 'pending' | 'approved' | 'generating' | 'complete' | 'error' | 'skipped'
  error?: string
}

// Session state
export interface OskarSession {
  id: string
  businessName: string
  createdAt: string
  updatedAt: string
  sourceImages: SourceImage[]
  vibes: VibeData[]
  imageManifests: ImageManifest[]
  conversation: ConversationMessage[]
  workflowPhase: WorkflowPhase
  layoutMode: LayoutMode
  moodboard?: MoodboardData
  imageQueue: ImageQueueItem[]
}

// ==========================================
// Tool Use Types (Structured Output from Claude)
// ==========================================

// Tool result for generating a vibe
export interface VibeToolInput {
  name: string
  html: string
  imageAssets: {
    filename: string
    operation: ImageOperation
    instruction: string
    usage: string
    sourceImages?: string[]
    aspectRatio?: AspectRatio
    resolution?: ImageSize
  }[]
  moodboard: {
    headline: string
    tagline: string
    colors: string[]
    typography: {
      heading: string
      body: string
    }
    voiceSamples?: string[]
  }
}

// Tool result for asking discovery questions
export interface DiscoveryToolInput {
  questions: string[]
  context?: string
}

// Tool result for confirming understanding before vibe generation
export interface ConfirmUnderstandingToolInput {
  summary: string
  readyToGenerate: boolean
}

// Parsed tool call from Claude's response
export interface ParsedToolCall {
  id: string
  name: string
  input: VibeToolInput | DiscoveryToolInput | ConfirmUnderstandingToolInput
}

// ==========================================
// Director Mode Types (Visual Editing)
// ==========================================

// Edits made to a vibe via Director Mode
export interface VibeEdits {
  vibeId: string
  textEdits: { id: string; newText: string }[]
  imageSwaps: { usage: string; newAssetId: string }[]
}

// Selected element in the iframe
export interface SelectedElement {
  elementType: 'text' | 'image'
  id: string
  currentValue: string
  tagName: string
}
```

---

## File 2: app/api/chat/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, appendFile } from 'fs/promises'
import path from 'path'
import { buildCDPrompt } from '@/lib/cd-agent-prompt'
import { ImageAsset, ImageManifest, VibeToolInput, AspectRatio, ImageSize, ImageOperation } from '@/lib/types'

// Use environment variable with fallback to hardcoded key for dev
const API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_API_KEY_HERE'

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
async function logConversation(role: 'user' | 'assistant', content: string): Promise<void> {
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
  retries = 3
): Promise<any> {
  const { useTools = false, toolChoice = 'auto' } = options

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`API attempt ${attempt}/${retries} starting...`)

      // 10 minute timeout for large generation tasks
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 600000) // 10 minutes

      const requestBody: any = {
        model: 'claude-opus-4-5-20251101',
        max_tokens: 16000, // For 3 vibes with full HTML
        system: system,
        messages: messages,
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
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
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

  try {
    const body = await req.json()
    console.log(`[${requestId}] Request body keys:`, Object.keys(body))
    const { messages, uploadedFiles, triggerAssessment, sourceImages } = body as {
      messages: Message[]
      uploadedFiles: UploadedFile[]
      triggerAssessment?: boolean
      sourceImages?: SourceImageInfo[]
    }

    // Build system prompt with source image info
    const systemPrompt = buildCDPrompt(sourceImages || [])

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
      await logConversation('user', lastUserMessage.content)
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

    // Always use tools - Claude will choose the right one based on context
    const response = await callAnthropicAPI(
      claudeMessages,
      systemPrompt,
      { useTools: true, toolChoice: 'auto' }
    )

    if (response.error) {
      throw new Error(`API error: ${JSON.stringify(response.error)}`)
    }

    // Parse tool calls from response
    const parsed = parseToolCalls(response, requestId)

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
    await logConversation('assistant', assistantMessage)

    // ==========================================
    // Bridge Script for Live Preview & Director Mode
    // ==========================================
    const BRIDGE_SCRIPT = `
<script>
  // OskarOS Bridge - enables live preview updates and Director Mode editing
  (function() {
    // Listen for messages from parent React app
    window.addEventListener('message', function(event) {
      // Security: only accept messages from same origin
      if (event.origin !== window.location.origin) return;

      var data = event.data;

      // UPDATE_IMAGE: Replace image src when asset is generated (handles galleries with multiple images)
      if (data.type === 'UPDATE_IMAGE') {
        var images = document.querySelectorAll('[data-usage="' + data.usage + '"]');
        images.forEach(function(img) {
          img.src = data.url;
          img.style.opacity = '0';
          img.onload = function() { img.style.opacity = '1'; };
        });
      }

      // UPDATE_TEXT: Replace text content for Director Mode
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

    // Director Mode: Click-to-select elements
    document.addEventListener('click', function(e) {
      var target = e.target;
      var editable = target.dataset.editable;
      var usage = target.dataset.usage;

      if (editable || usage) {
        e.preventDefault();
        e.stopPropagation();

        // Notify parent of selection
        window.parent.postMessage({
          type: 'ELEMENT_SELECTED',
          elementType: target.tagName === 'IMG' ? 'image' : 'text',
          id: editable || usage,
          currentValue: target.tagName === 'IMG' ? target.src : target.textContent,
          tagName: target.tagName
        }, '*');

        // Visual feedback
        document.querySelectorAll('.oskar-selected').forEach(function(e) {
          e.classList.remove('oskar-selected');
        });
        target.classList.add('oskar-selected');
      }
    });

    // Add selection styles
    var style = document.createElement('style');
    style.textContent = '.oskar-selected { outline: 2px solid #3b82f6 !important; outline-offset: 2px; }';
    document.head.appendChild(style);
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
      // Note: moodboard generation removed - now handled via Tool Use
    })

  } catch (error) {
    console.error(`[${requestId}] Chat API error:`, error)
    return NextResponse.json(
      { error: `Failed: ${error}` },
      { status: 500 }
    )
  }
}
```

---

## File 3: lib/cd-agent-prompt.ts

```typescript
import { readFileSync } from 'fs'
import path from 'path'

// Load the Creative Director agent prompt from the MD file
// This keeps business logic separate from code
function loadCDAgentPrompt(): string {
  try {
    const mdPath = path.join(process.cwd(), '..', 'creative-director-agent.md')
    return readFileSync(mdPath, 'utf-8')
  } catch (error) {
    console.error('Failed to load creative-director-agent.md:', error)
    // Return minimal fallback if file not found
    return `You are the Creative Director for OskarOS.
Your job is to discover what makes a business unique and create booking pages that don't look like booking pages.
Ask questions to understand the business, then create distinct vibes.`
  }
}

// Strip terminal-specific sections from the MD content for webapp use
function stripTerminalSections(content: string): string {
  let stripped = content

  // Remove ENTIRE logging section (## NON-NEGOTIABLE: LOGGING through next --- section break)
  stripped = stripped.replace(/## NON-NEGOTIABLE: LOGGING[\s\S]*?(?=\n---\n\n## FIRST THING)/i, '')

  // Remove "FIRST THING YOU DO: VIEW ALL IMAGES" section (terminal file ops)
  stripped = stripped.replace(/## FIRST THING YOU DO: VIEW ALL IMAGES[\s\S]*?(?=\n---\n\n## INFORMATION)/i, '')

  // Remove INFORMATION BARRIER section (terminal file system)
  stripped = stripped.replace(/## INFORMATION BARRIER[\s\S]*?(?=\n---\n\n## PHASE 1)/i, '')

  // Remove phases that reference COO/terminal (PHASE 3: IMAGE REVIEW, PHASE 4-7)
  stripped = stripped.replace(/## PHASE 3: IMAGE REVIEW[\s\S]*?(?=\n## YOUR JOB|$)/i, '')

  // Remove ALL markdown code blocks that show logging format examples
  stripped = stripped.replace(/```markdown\n[\s\S]*?```/g, '')

  // Remove references to COO agent
  stripped = stripped.replace(/Interview the COO\./g, 'Interview the business owner.')
  stripped = stripped.replace(/COO/g, 'business owner')
  stripped = stripped.replace(/business owner agent/g, 'business owner')

  // Remove "Log file:" references
  stripped = stripped.replace(/\*\*Log file:\*\*.*\n/g, '')

  // Remove any remaining references to logging verbatim
  stripped = stripped.replace(/\*\*Log everything verbatim\.\*\*/g, '')
  stripped = stripped.replace(/Log everything verbatim\./g, '')

  // Clean up multiple consecutive blank lines
  stripped = stripped.replace(/\n{4,}/g, '\n\n\n')

  return stripped
}

// Webapp-specific instructions that wrap the MD content
const WEBAPP_WRAPPER = `
---

## WEBAPP MODE — TOOL USE

You're running inside the OskarOS webapp with **Tool Use** enabled. Use the provided tools to structure your output.

**CRITICAL: DO NOT echo back user messages. DO NOT repeat what the user said. Just respond directly.**

---

## AVAILABLE SOURCE IMAGES
{SOURCE_IMAGES}

---

## YOUR WORKFLOW

### Phase 1: Discovery
Use the \`ask_discovery_questions\` tool to ask about:
- Business identity, concept, location, hours
- Signature experience — what makes them unique
- Target audience — specific person, not demographics
- Tone and voice — if the business were a person
- Menu/offerings with real prices
- Visual preferences — colors, fonts, things to avoid
- The enemy — what they hate about their industry

Keep asking until you can describe the business in one sentence that only fits THEM.

### Phase 2: Confirm Understanding
Use the \`confirm_understanding\` tool to summarize:
- One-sentence description
- The specific customer
- The weird detail that surprises
- The tone/voice
- The enemy
- The promise

Wait for user confirmation before generating vibes.

### Phase 3: Generate Vibes
Use the \`generate_vibe\` tool 3 times to create 3 distinct vibes.

---

## HTML REQUIREMENTS FOR VIBES

When calling \`generate_vibe\`, your HTML must:

1. **Be complete and self-contained** — inline CSS, no external dependencies
2. **Include all sections**: hero, menu/offerings with REAL prices, location/hours, booking CTA, footer
3. **Use data attributes for Live Preview**:
   - Images: \`<img src="/uploads/xxx.jpg" data-usage="hero">\`
   - Editable text: \`<h1 data-editable="headline">Your Headline</h1>\`
4. **Use source images from /uploads/** — generated images don't exist yet

### Data Attributes (CRITICAL):
- \`data-usage\` on images: enables automatic update when image is generated
- \`data-editable\` on text: enables Director Mode editing

Example:
\`\`\`html
<section class="hero">
  <img src="/uploads/placeholder.jpg" data-usage="hero" alt="Hero image">
  <h1 data-editable="headline">Still not ready to go home?</h1>
  <p data-editable="subline">Neither are we.</p>
</section>
\`\`\`

---

## IMAGE ASSET RULES

When specifying \`imageAssets\` in the tool:
- \`operation\`: "generate" (new from prompt), "compose" (combine sources), "extract" (remove background), "adjust" (modify)
- \`usage\`: Where it goes — "hero", "background", "portrait", "gallery", etc.
- \`instruction\`: Detailed prompt including style, mood, composition, what's NOT in frame
- \`aspectRatio\`: "16:9" for hero, "1:1" for icons, "3:4" for portraits
- \`resolution\`: "1K" for thumbnails, "2K" for hero, "4K" for large backgrounds

---

## THE BENCHMARK

> "Grandma's Waiting. She's already made too much food. Don't be late."

This is what great copy looks like. Guilt. Warmth. Urgency. Love. Every headline, CTA, and piece of copy should hit like that.

**BANNED PHRASES:** "Book Now", "Our Services", "Welcome to...", "Experience the...", "Quality", "Professional"

---

Now begin. Introduce yourself briefly and use the \`ask_discovery_questions\` tool to start discovery.
`

// Build the complete prompt for the webapp
export function buildCDPrompt(sourceImages: Array<{path: string, analysis?: {elements: string[], description: string}}> = []): string {
  const cdAgentMd = loadCDAgentPrompt()
  const strippedMd = stripTerminalSections(cdAgentMd)

  // Build source image info
  let sourceInfo = 'No images uploaded yet.'
  if (sourceImages.length > 0) {
    sourceInfo = sourceImages.map(img => {
      let info = `- ${img.path}`
      if (img.analysis) {
        info += `\n  Elements: ${img.analysis.elements.join(', ')}`
        info += `\n  Description: ${img.analysis.description}`
      }
      return info
    }).join('\n')
  }

  // Combine: Stripped MD file content + webapp wrapper with source images
  const webappInstructions = WEBAPP_WRAPPER.replace('{SOURCE_IMAGES}', sourceInfo)

  return strippedMd + '\n\n' + webappInstructions
}

// Legacy export for backwards compatibility (loads from MD file, unstripped)
export const CD_AGENT_SYSTEM_PROMPT = loadCDAgentPrompt()
```

---

## File 4: components/CanvasPanel.tsx

```tsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ImageAsset, VibeData, AspectRatio, ImageSize, MoodboardData, SelectedElement } from '@/lib/types'

interface CanvasPanelProps {
  vibes: VibeData[]
  selectedVibe?: VibeData
  selectedAsset?: ImageAsset
  moodboard?: MoodboardData
  onVibeSelect: (vibe: VibeData) => void
  onAssetUpdate: (asset: ImageAsset) => void
  onAssetRegenerate: (asset: ImageAsset) => void
  onClearAsset: () => void
  onMoodboardSelect: (conceptName: string) => void
  // Director Mode props
  directorMode?: boolean
  onToggleDirectorMode?: () => void
  onElementSelect?: (element: SelectedElement | null) => void
  selectedElement?: SelectedElement | null
  onTextEdit?: (elementId: string, newText: string) => void
}

export function CanvasPanel({
  vibes,
  selectedVibe,
  selectedAsset,
  moodboard,
  onVibeSelect,
  onAssetUpdate,
  onAssetRegenerate,
  onClearAsset,
  onMoodboardSelect,
  directorMode = false,
  onToggleDirectorMode,
  onElementSelect,
  selectedElement,
  onTextEdit
}: CanvasPanelProps) {
  const [editedInstruction, setEditedInstruction] = useState('')
  const [editedAspectRatio, setEditedAspectRatio] = useState<AspectRatio>('16:9')
  const [editedResolution, setEditedResolution] = useState<ImageSize>('1K')

  // Iframe ref for postMessage communication
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // When asset changes, update local state
  useEffect(() => {
    if (selectedAsset) {
      setEditedInstruction(selectedAsset.instruction)
      setEditedAspectRatio(selectedAsset.aspectRatio)
      setEditedResolution(selectedAsset.resolution)
    }
  }, [selectedAsset?.id])

  // Listen for messages from iframe (Director Mode element selection)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from same origin
      if (event.origin !== window.location.origin) return

      const data = event.data
      if (data.type === 'ELEMENT_SELECTED' && onElementSelect) {
        onElementSelect({
          elementType: data.elementType,
          id: data.id,
          currentValue: data.currentValue,
          tagName: data.tagName
        })
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onElementSelect])

  // Send update to iframe when image is generated
  const sendImageUpdate = useCallback((usage: string, url: string) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'UPDATE_IMAGE',
        usage,
        url
      }, window.location.origin)
    }
  }, [])

  // Send text update to iframe (Director Mode)
  const sendTextUpdate = useCallback((id: string, text: string) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'UPDATE_TEXT',
        id,
        text
      }, window.location.origin)
    }
  }, [])

  // Highlight element in iframe (Director Mode)
  const highlightElement = useCallback((id: string | null) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'HIGHLIGHT_ELEMENT',
        id
      }, window.location.origin)
    }
  }, [])

  // Toggle Director Mode in iframe
  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'SET_DIRECTOR_MODE',
        enabled: directorMode
      }, window.location.origin)
    }
  }, [directorMode])

  // Expose methods for parent components
  useEffect(() => {
    // Attach methods to window for external access (e.g., from AssetsPanel)
    (window as unknown as { oskarCanvas?: { sendImageUpdate: typeof sendImageUpdate; sendTextUpdate: typeof sendTextUpdate; highlightElement: typeof highlightElement } }).oskarCanvas = {
      sendImageUpdate,
      sendTextUpdate,
      highlightElement
    }
    return () => {
      delete (window as unknown as { oskarCanvas?: unknown }).oskarCanvas
    }
  }, [sendImageUpdate, sendTextUpdate, highlightElement])

  const aspectRatios: AspectRatio[] = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9']

  return (
    <div className="canvas-panel">
      {/* Vibe Tabs */}
      {vibes.length > 0 && (
        <div className="vibe-tabs">
          {vibes.map(vibe => (
            <button
              key={vibe.id}
              className={`vibe-tab ${selectedVibe?.id === vibe.id ? 'active' : ''}`}
              onClick={() => {
                onVibeSelect(vibe)
                onClearAsset()
              }}
            >
              {vibe.name}
            </button>
          ))}
        </div>
      )}

      {/* Main Content Area */}
      <div className="canvas-content">
        {selectedAsset ? (
          // Image Detail View
          <div className="image-detail">
            <div className="detail-header">
              <button className="back-btn" onClick={onClearAsset}>← Back to Preview</button>
              <h2>{selectedAsset.filename}</h2>
              <span className={`operation-badge ${selectedAsset.operation}`}>
                {selectedAsset.operation}
              </span>
            </div>

            <div className="detail-content">
              {/* Source Images */}
              {selectedAsset.sourceImages.length > 0 && (
                <div className="source-preview">
                  <label>Source Images:</label>
                  <div className="source-thumbs">
                    {selectedAsset.sourceImages.map((src, i) => (
                      <img key={i} src={src} alt={`Source ${i + 1}`} />
                    ))}
                  </div>
                </div>
              )}

              {/* Result Preview */}
              {selectedAsset.resultPath && (
                <div className="result-preview">
                  <label>Generated Result:</label>
                  <img src={selectedAsset.resultPath} alt="Generated result" />
                </div>
              )}

              {/* Editable Prompt */}
              <div className="prompt-editor">
                <label>Instruction:</label>
                <textarea
                  value={editedInstruction}
                  onChange={e => setEditedInstruction(e.target.value)}
                  rows={4}
                  placeholder="Describe what you want..."
                />
              </div>

              {/* Settings */}
              <div className="settings-row">
                <div className="setting">
                  <label>Aspect Ratio:</label>
                  <select
                    value={editedAspectRatio}
                    onChange={e => setEditedAspectRatio(e.target.value as AspectRatio)}
                  >
                    {aspectRatios.map(ar => (
                      <option key={ar} value={ar}>{ar}</option>
                    ))}
                  </select>
                </div>
                <div className="setting">
                  <label>Resolution:</label>
                  <select
                    value={editedResolution}
                    onChange={e => setEditedResolution(e.target.value as ImageSize)}
                  >
                    <option value="1K">1K</option>
                    <option value="2K">2K</option>
                  </select>
                </div>
              </div>

              {/* Actions */}
              <div className="actions">
                {selectedAsset.status === 'pending' && (
                  <button
                    className="btn-primary"
                    onClick={() => onAssetRegenerate({
                      ...selectedAsset,
                      instruction: editedInstruction,
                      aspectRatio: editedAspectRatio,
                      resolution: editedResolution
                    })}
                  >
                    Generate
                  </button>
                )}
                {selectedAsset.status === 'complete' && (
                  <button
                    className="btn-secondary"
                    onClick={() => onAssetRegenerate({
                      ...selectedAsset,
                      instruction: editedInstruction,
                      aspectRatio: editedAspectRatio,
                      resolution: editedResolution
                    })}
                  >
                    Regenerate
                  </button>
                )}
                {selectedAsset.status === 'generating' && (
                  <button className="btn-disabled" disabled>
                    Generating...
                  </button>
                )}
                {selectedAsset.status === 'error' && (
                  <>
                    <p className="error-msg">{selectedAsset.error}</p>
                    <button
                      className="btn-primary"
                      onClick={() => onAssetRegenerate({
                        ...selectedAsset,
                        instruction: editedInstruction,
                        aspectRatio: editedAspectRatio,
                        resolution: editedResolution
                      })}
                    >
                      Retry
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : selectedVibe ? (
          // Vibe Preview - Full Screen
          <div className={`vibe-preview ${directorMode ? 'director-mode' : ''}`}>
            <div className="preview-toolbar">
              <div className="toolbar-left">
                <span className="vibe-name-display">{selectedVibe.name}</span>
              </div>
              <div className="toolbar-right">
                {onToggleDirectorMode && (
                  <button
                    className={`director-toggle ${directorMode ? 'active' : ''}`}
                    onClick={onToggleDirectorMode}
                  >
                    🎬 {directorMode ? 'Exit Director Mode' : 'Director Mode'}
                  </button>
                )}
              </div>
            </div>
            {directorMode && (
              <div className="director-mode-banner">
                <span>Click any text or image to edit</span>
                {selectedElement && (
                  <span className="selected-info">
                    Selected: {selectedElement.tagName.toLowerCase()}#{selectedElement.id}
                  </span>
                )}
              </div>
            )}
            <div className="iframe-container">
              <iframe
                ref={iframeRef}
                src={selectedVibe.htmlPath}
                title={selectedVibe.name}
              />
              {/* Properties Panel - shows when element is selected in Director Mode */}
              {directorMode && selectedElement && (
                <div className="properties-panel">
                  <div className="properties-header">
                    <span>Edit {selectedElement.elementType === 'text' ? 'Text' : 'Image'}</span>
                    <button
                      className="close-properties"
                      onClick={() => onElementSelect?.(null)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="properties-content">
                    {selectedElement.elementType === 'text' && (
                      <div className="text-editor-prop">
                        <label>Content:</label>
                        <textarea
                          defaultValue={selectedElement.currentValue}
                          rows={3}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.metaKey) {
                              onTextEdit?.(selectedElement.id, (e.target as HTMLTextAreaElement).value)
                            }
                          }}
                          onBlur={(e) => {
                            if (e.target.value !== selectedElement.currentValue) {
                              onTextEdit?.(selectedElement.id, e.target.value)
                            }
                          }}
                        />
                        <p className="hint-text">⌘+Enter or blur to apply</p>
                      </div>
                    )}
                    {selectedElement.elementType === 'image' && (
                      <div className="image-info">
                        <p>Image: {selectedElement.id}</p>
                        <p className="hint-text">Generate a new image in the Assets panel</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <a
              href={selectedVibe.htmlPath}
              target="_blank"
              rel="noopener noreferrer"
              className="open-new-tab"
            >
              Open in new tab ↗
            </a>
          </div>
        ) : moodboard && moodboard.selectedConcept ? (
          // Show moodboard with selected concept highlighted
          <div className="moodboard-selected-view">
            <div className="moodboard-header">
              <h2>Selected Direction: {moodboard.selectedConcept}</h2>
              <p>Generating vibes based on this direction...</p>
            </div>
            <div className="moodboard-image-container">
              <img src={moodboard.imagePath} alt="Moodboard" className="moodboard-full" />
              <div className="concept-overlay">
                {moodboard.concepts.map((concept, idx) => (
                  <div
                    key={concept.name}
                    className={`concept-quadrant q${idx + 1} ${concept.name === moodboard.selectedConcept ? 'selected' : 'dimmed'}`}
                  >
                    <span className="concept-label">{concept.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="selected-concept-details">
              {moodboard.concepts.find(c => c.name === moodboard.selectedConcept) && (
                <>
                  <h3>{moodboard.concepts.find(c => c.name === moodboard.selectedConcept)?.headline}</h3>
                  <p className="one-word">{moodboard.concepts.find(c => c.name === moodboard.selectedConcept)?.oneWord}</p>
                  <div className="color-palette">
                    {moodboard.concepts.find(c => c.name === moodboard.selectedConcept)?.colorPalette.map((color, i) => (
                      <div key={i} className="color-swatch" style={{ background: color }} title={color} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          // Empty State
          <div className="empty-state">
            <div className="empty-content">
              <h2>OskarOS</h2>
              <p>Start a conversation to discover your brand and generate vibes.</p>
              <p className="hint">Upload images and answer questions from the Creative Director.</p>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        /* ... CSS styles omitted for brevity - see full file above ... */
      `}</style>
    </div>
  )
}
```

---

## File 5: app/page.tsx

```tsx
'use client'

import { useState, useCallback, useEffect } from 'react'
import { AssetsPanel } from '@/components/AssetsPanel'
import { CanvasPanel } from '@/components/CanvasPanel'
import { ConversationPanel } from '@/components/ConversationPanel'
import {
  SourceImage,
  ImageAsset,
  ImageManifest,
  VibeData,
  ConversationMessage,
  WorkflowPhase,
  LayoutMode,
  MoodboardData,
  ImageQueueItem,
  SelectedElement,
  VibeEdits
} from '@/lib/types'

export default function Home() {
  // Workflow state
  const [workflowPhase, setWorkflowPhase] = useState<WorkflowPhase>('discovery')
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('2-panel')

  // Moodboard
  const [moodboard, setMoodboard] = useState<MoodboardData | undefined>(undefined)

  // Image generation queue
  const [imageQueue, setImageQueue] = useState<ImageQueueItem[]>([])

  // Source images (uploaded by user)
  const [sourceImages, setSourceImages] = useState<SourceImage[]>([])

  // Vibes from CD agent
  const [vibes, setVibes] = useState<VibeData[]>([])
  const [selectedVibe, setSelectedVibe] = useState<VibeData | undefined>(undefined)

  // Image manifests (per-vibe assets)
  const [imageManifests, setImageManifests] = useState<ImageManifest[]>([])
  const [selectedAsset, setSelectedAsset] = useState<ImageAsset | undefined>(undefined)

  // Conversation
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Director Mode state
  const [directorMode, setDirectorMode] = useState(false)
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null)
  const [vibeEdits, setVibeEdits] = useState<VibeEdits[]>([])

  // Auto-inject test images if ?inject=true in URL (backdoor for testing)
  // Optional: ?business=zurich or ?business=falcamel to select test image set
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('inject') === 'true') {
      const business = params.get('business') || 'zurich'
      fetch(`/api/inject-images?business=${business}`)
        .then(res => res.json())
        .then(data => {
          if (data.images && data.images.length > 0) {
            setSourceImages(data.images)
            console.log(`Injected ${data.business} test images:`, data.images.map((i: any) => i.filename))
          }
        })
        .catch(err => console.error('Failed to inject images:', err))
    }
  }, [])

  // Upload a new image
  const handleUpload = useCallback(async (file: File) => {
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      })

      const data = await response.json()

      if (data.error) {
        console.error('Upload error:', data.error)
        return
      }

      const newSource: SourceImage = {
        id: data.id,
        filename: data.filename,
        path: data.path,
        uploadedAt: data.uploadedAt,
        analysis: data.analysis
      }

      setSourceImages(prev => [...prev, newSource])
      console.log('Uploaded:', newSource.path, 'Elements:', newSource.analysis?.elements)
    } catch (error) {
      console.error('Upload failed:', error)
    }
  }, [])

  // Send message to CD agent
  const handleSendMessage = useCallback(async (content: string, images?: File[]) => {
    // Upload any images first
    if (images && images.length > 0) {
      for (const file of images) {
        await handleUpload(file)
      }
    }

    // Inject Director Mode edits into context so AI preserves manual changes
    const activeEdits = selectedVibe ? vibeEdits.find(e => e.vibeId === selectedVibe.id) : null
    let finalContent = content

    if (activeEdits && activeEdits.textEdits.length > 0) {
      const editSummary = activeEdits.textEdits
        .map(e => `Element '${e.id}' was manually changed to: "${e.newText}"`)
        .join('\n')

      finalContent += `\n\n[SYSTEM NOTE: The user manually edited the current vibe. Ensure these text changes are preserved exactly in the next generation:\n${editSummary}]`
    }

    const userMessage: ConversationMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: finalContent,
      timestamp: new Date().toISOString()
    }

    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setIsLoading(true)

    try {
      // Prepare source image info for the CD prompt
      const sourceImageInfo = sourceImages.map(img => ({
        path: img.path,
        analysis: img.analysis
      }))

      // Build messages for API (text only, images sent via upload)
      const messagesForAPI = newMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      }))

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messagesForAPI,
          sourceImages: sourceImageInfo,
          uploadedFiles: []
        })
      })

      const data = await response.json()

      if (data.message) {
        const assistantMessage: ConversationMessage = {
          id: `msg-${Date.now()}-assistant`,
          role: 'assistant',
          content: data.message,
          timestamp: new Date().toISOString()
        }
        setMessages([...newMessages, assistantMessage])
      }

      // Process vibes
      if (data.vibes && data.vibes.length > 0 && data.vibePaths) {
        const newVibes: VibeData[] = data.vibes.map((v: any, i: number) => ({
          id: `vibe-${Date.now()}-${i}`,
          name: v.name,
          category: v.category || 'premium',
          headline: v.headline,
          tagline: v.tagline,
          colors: v.colors,
          typography: v.typography,
          voiceSamples: v.voiceSamples,
          htmlPath: data.vibePaths[i],
          html: v.html
        }))
        setVibes(newVibes)
        if (!selectedVibe && newVibes.length > 0) {
          setSelectedVibe(newVibes[0])
        }
        // Transition to 3-panel layout when vibes are generated
        setLayoutMode('3-panel')
        setWorkflowPhase('generation')
      }

      // Process image manifests
      if (data.imageManifests && data.imageManifests.length > 0) {
        setImageManifests(data.imageManifests)
      }

      // Process moodboard
      if (data.moodboard) {
        setMoodboard({
          id: data.moodboard.id,
          imagePath: data.moodboard.imagePath,
          concepts: data.moodboard.concepts,
          generatedAt: data.moodboard.generatedAt
        })
        setWorkflowPhase('moodboard')
      }

    } catch (error) {
      console.error('Chat error:', error)
      const errorMessage: ConversationMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: 'Sorry, there was an error processing your request.',
        timestamp: new Date().toISOString()
      }
      setMessages([...newMessages, errorMessage])
    }

    setIsLoading(false)
  }, [messages, sourceImages, selectedVibe, vibeEdits, handleUpload])

  // ... additional handlers omitted for brevity ...

  // Handle Director Mode element selection from iframe
  const handleElementSelect = useCallback((element: SelectedElement | null) => {
    setSelectedElement(element)
  }, [])

  // Handle Director Mode text edit
  const handleTextEdit = useCallback((elementId: string, newText: string) => {
    // Send update to iframe
    const oskarCanvas = (window as unknown as { oskarCanvas?: { sendTextUpdate: (id: string, text: string) => void } }).oskarCanvas
    if (oskarCanvas) {
      oskarCanvas.sendTextUpdate(elementId, newText)
    }

    // Store edit for persistence
    if (selectedVibe) {
      setVibeEdits(prev => {
        const existing = prev.find(e => e.vibeId === selectedVibe.id)
        if (existing) {
          const textEditIndex = existing.textEdits.findIndex(te => te.id === elementId)
          if (textEditIndex >= 0) {
            existing.textEdits[textEditIndex].newText = newText
          } else {
            existing.textEdits.push({ id: elementId, newText })
          }
          return [...prev]
        } else {
          return [...prev, {
            vibeId: selectedVibe.id,
            textEdits: [{ id: elementId, newText }],
            imageSwaps: []
          }]
        }
      })
    }
  }, [selectedVibe])

  // Watch for completed assets and update iframe preview
  useEffect(() => {
    const oskarCanvas = (window as unknown as { oskarCanvas?: { sendImageUpdate: (usage: string, url: string) => void } }).oskarCanvas
    if (!oskarCanvas) return

    // Find any assets that just completed
    imageManifests.forEach(manifest => {
      manifest.assets.forEach(asset => {
        if (asset.status === 'complete' && asset.resultPath) {
          // Send update to iframe for this image
          oskarCanvas.sendImageUpdate(asset.usage, asset.resultPath)
        }
      })
    })
  }, [imageManifests])

  return (
    <div className={`app-container ${layoutMode}`}>
      {/* Left: Assets Panel */}
      <AssetsPanel
        sourceImages={sourceImages}
        imageManifests={imageManifests}
        imageQueue={imageQueue}
        onUpload={handleUpload}
        onAssetSelect={handleAssetSelect}
        onAssetGenerate={handleAssetGenerate}
        onAssetUpdate={handleAssetUpdate}
        onApproveImage={handleApproveImage}
        onSkipImage={handleSkipImage}
        onSubmitImages={handleSubmitImages}
        selectedAssetId={selectedAsset?.id}
        layoutMode={layoutMode}
      />

      {/* Center: Canvas Panel (only shown in 3-panel mode) */}
      {layoutMode === '3-panel' && (
        <CanvasPanel
          vibes={vibes}
          selectedVibe={selectedVibe}
          selectedAsset={selectedAsset}
          moodboard={moodboard}
          onVibeSelect={setSelectedVibe}
          onAssetUpdate={handleAssetUpdate}
          onAssetRegenerate={handleAssetGenerate}
          onClearAsset={handleClearAsset}
          onMoodboardSelect={handleMoodboardSelect}
          directorMode={directorMode}
          onToggleDirectorMode={() => setDirectorMode(prev => !prev)}
          onElementSelect={handleElementSelect}
          selectedElement={selectedElement}
          onTextEdit={handleTextEdit}
        />
      )}

      {/* Right: Conversation Panel */}
      <ConversationPanel
        messages={messages}
        moodboard={moodboard}
        onSendMessage={handleSendMessage}
        onMoodboardSelect={handleMoodboardSelect}
        isLoading={isLoading}
        layoutMode={layoutMode}
      />

      <style jsx global>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #0a0a0a;
          color: #fff;
          overflow: hidden;
        }
        .app-container {
          display: flex;
          height: 100vh;
          width: 100vw;
        }
        .app-container.2-panel {
          /* Assets 40%, Chat 60% */
        }
        .app-container.3-panel {
          /* Assets 25%, Canvas 50%, Chat 25% */
        }
      `}</style>
    </div>
  )
}
```

---

## Summary of Key Changes

### 1. Tool Use (Replaces Regex Parsing)
- **TOOLS array** in `route.ts` defines 3 tools: `generate_vibe`, `ask_discovery_questions`, `confirm_understanding`
- **tool_choice format fix**: Uses `{ type: 'auto' }` not `'auto'` string
- **parseToolCalls()** extracts structured data from Claude's response
- No more fragile regex patterns

### 2. Live Preview (postMessage Bridge)
- **BRIDGE_SCRIPT** injected into generated HTML files
- Handles `UPDATE_IMAGE`, `UPDATE_TEXT`, `HIGHLIGHT_ELEMENT` messages
- Uses `querySelectorAll` for gallery images (multiple elements with same data-usage)
- React sends updates via `window.oskarCanvas.sendImageUpdate()`

### 3. Director Mode (Visual Editing)
- Click-to-select elements with `data-editable` or `data-usage` attributes
- Properties panel appears for editing text
- Edits stored in `vibeEdits` state for persistence
- Memory injection: edits sent to AI in subsequent messages

---

**File Location:** `/Users/ralphlengler/OskarOS/oskar-prototype/IMPLEMENTATION-BUNDLE.md`
