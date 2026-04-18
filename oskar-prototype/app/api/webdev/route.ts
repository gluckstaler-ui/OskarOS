import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, readdir } from 'fs/promises'
import { writeFileSync, unlinkSync } from 'fs'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import path from 'path'

// Import from shared modules - single source of truth
import { parseVibesFromFiles, type ParsedVibe } from '@/lib/creative-brief-parser'
import { buildVibeHTML, findClaudeBinary, BRIDGE_SCRIPT } from '@/lib/webdev'
import { runWebDev, type ExecutionMode, type Model } from '@/lib/run-webdev'

// ==========================================
// Build WebDev System Prompt (for final build)
// ==========================================

function buildWebDevPrompt(brief: string, sessionImages: string[], sessionId: string): string {
  const imageList = sessionImages.length > 0
    ? `\n\nAVAILABLE IMAGES IN SESSION:\n${sessionImages.map(img => `- ${img}`).join('\n')}`
    : '\n\n(No images available yet)'

  return `You are WebDev — an expert frontend developer who builds high-end, narrative-driven booking pages.

## Your Mission

Build a complete landing page based on the creative brief. Output the HTML directly to the session folder.

## The Creative Brief

${brief}

${imageList}

## Technical Requirements

### HTML Structure
- All CSS inline (in <style> tag) for portability
- Use CSS variables for theming from the brief
- Mobile-first, responsive design
- Include data-usage attributes on images for the preview system
- Include data-editable attributes on text elements

### Image References
Reference images from the session folder using relative paths:
\`\`\`html
<img src="[filename].jpg" alt="[Descriptive alt text]" data-usage="hero">
\`\`\`

### Fonts
Use Google Fonts as specified in the brief:
\`\`\`html
<link href="https://fonts.googleapis.com/css2?family=[Font+Name]:wght@400;700&display=swap" rel="stylesheet">
\`\`\`

## Quality Requirements

**Landing Page Must Have:**
- Hero section with headline, tagline, and CTA
- Story/hook section that explains the unique value
- Menu section with items and prices (if applicable)
- Character/offering section with bios and details
- Location section
- Final booking CTA
- Footer with brand tagline

**Voice Requirements:**
- Every piece of copy specific to THIS business
- Narrative flow, not just sections stacked
- Distinctive voice throughout
- CTA that makes people feel something
- Zero generic language

## What to Avoid
1. Generic section headers: "About Us", "Our Services", "Welcome to..."
2. Passive voice: "Services are provided"
3. Placeholder energy: Anything that sounds like a template
4. Stock photo vibes: Use the actual images from the session

## Output Instructions

Write the complete HTML file to: /public/${sessionId}/final-landing.html

The file must be complete and self-contained — ready to view in a browser.

After writing the file, confirm with: "Landing page built: final-landing.html"

NOW BUILD THE PAGE.`
}

// ==========================================
// Build All Vibes (Streaming Response)
// ==========================================

async function buildVibesStreaming(
  sessionId: string,
  requestId: number,
  mode: ExecutionMode = 'cli',
  model: Model = 'claude-sonnet-4-6'
): Promise<Response> {
  const sessionPath = path.join(process.cwd(), 'public', sessionId)

  // Parse vibes from VIBE-N.md files (falls back to CREATIVE-BRIEF.md)
  const vibes = await parseVibesFromFiles(sessionPath)
  if (vibes.length === 0) {
    return NextResponse.json(
      { error: 'No vibes found (no VIBE-*.md files or CREATIVE-BRIEF.md)' },
      { status: 400 }
    )
  }

  console.log(`[WebDev ${requestId}] Found ${vibes.length} vibes to build`)

  // List available images
  let sessionImages: string[] = []
  try {
    const files = await readdir(sessionPath)
    sessionImages = files.filter(f =>
      f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png') || f.endsWith('.webp')
    )
  } catch {
    // No images found
  }

  // Create streaming response
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let successCount = 0

      for (const vibe of vibes) {
        console.log(`[WebDev ${requestId}] Starting vibe ${vibe.index}: ${vibe.name}`)

        // Route through runWebDev — handles CLI, Claude API, and Gemini
        const result = await runWebDev({
          mode,
          model,
          sessionId,
          sessionPath,
          vibe,
          sessionImages
        })

        if (result.status === 'complete') {
          // Send vibe_complete event with path to the file
          const event = {
            type: 'vibe_complete',
            vibe: {
              index: vibe.index,
              name: vibe.name,
              slug: vibe.slug,
              oneLiner: vibe.oneLiner,
              colors: vibe.colors,
              fonts: vibe.fonts,
              htmlPath: `/${sessionId}/${result.filename}`
            }
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          console.log(`[WebDev ${requestId}] ✅ Sent vibe_complete for ${vibe.name}`)
          successCount++
        } else {
          console.error(`[WebDev ${requestId}] ❌ Vibe ${vibe.index} failed:`, result.error)
          const errorEvent = {
            type: 'vibe_error',
            vibeIndex: vibe.index,
            vibeName: vibe.name,
            error: result.error || 'Unknown error'
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`))
        }
      }

      // Send completion event
      const completeEvent = { type: 'all_vibes_complete', vibeCount: successCount }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(completeEvent)}\n\n`))
      console.log(`[WebDev ${requestId}] ✅ All vibes complete (${successCount}/${vibes.length} succeeded)`)

      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  })
}

// ==========================================
// Main API Handler
// ==========================================

export async function POST(req: NextRequest) {
  const requestId = Date.now()
  console.log(`=== WebDev API called [${requestId}] ===`)

  try {
    const body = await req.json()
    const { sessionId, mode = 'final', executionMode = 'cli', webDevModel = 'claude-sonnet-4-6' } = body as {
      sessionId: string
      mode?: 'vibes' | 'final'
      executionMode?: ExecutionMode
      webDevModel?: Model
    }

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
    }

    // Handle vibes mode - build all vibe landing pages with streaming
    if (mode === 'vibes') {
      console.log(`[WebDev ${requestId}] Mode: vibes (${executionMode}/${webDevModel}) - building vibe landing pages`)
      return buildVibesStreaming(sessionId, requestId, executionMode, webDevModel)
    }

    // Default: final mode - build final landing page
    console.log(`[WebDev ${requestId}] Mode: final - building final landing page`)

    // Read the Creative Brief
    const sessionPath = path.join(process.cwd(), 'public', sessionId)
    let briefContent: string

    try {
      briefContent = await readFile(path.join(sessionPath, 'CREATIVE-BRIEF.md'), 'utf-8')
    } catch {
      return NextResponse.json(
        { error: 'CREATIVE-BRIEF.md not found in session' },
        { status: 404 }
      )
    }

    // List available images in the session
    let sessionImages: string[] = []
    try {
      const files = await readdir(sessionPath)
      sessionImages = files.filter(f =>
        f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png') || f.endsWith('.webp')
      )
    } catch {
      // No images found
    }

    // Build the system prompt
    const systemPrompt = buildWebDevPrompt(briefContent, sessionImages, sessionId)

    // Write prompt and system prompt to temp files
    const tempDir = tmpdir()
    const promptFile = join(tempDir, `webdev-prompt-${requestId}.txt`)
    const systemFile = join(tempDir, `webdev-system-${requestId}.txt`)

    const userPrompt = 'Build the landing page now. Write the complete HTML file to the session folder.'

    writeFileSync(promptFile, userPrompt, 'utf-8')
    writeFileSync(systemFile, systemPrompt, 'utf-8')

    const cleanup = () => {
      try { unlinkSync(promptFile) } catch (e) {}
      try { unlinkSync(systemFile) } catch (e) {}
    }

    // Find Claude CLI
    const claudePath = findClaudeBinary()

    // Run Claude CLI
    // 2026-04-17: model was 'claude-sonnet-4-20250514' (deprecated, retires Jun 15 2026).
    // Migrated to current Sonnet 4.6 per Ralph's "all sonnet/haiku → 4.6" pass.
    const command = `"${claudePath}" --print --verbose --no-session-persistence --model claude-sonnet-4-6 --output-format stream-json --permission-mode bypassPermissions --system-prompt "$(cat '${systemFile}')" "$(cat '${promptFile}')"`

    console.log(`[WebDev ${requestId}] Running Claude CLI...`)

    return new Promise<Response>((resolve) => {
      const child = spawn('sh', ['-c', command], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HOME: process.env.HOME,
          PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || ''),
          CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || ''
        }
      })

      let fullOutput = ''

      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        cleanup()
        console.log(`[WebDev ${requestId}] Timeout after 5 minutes`)
        resolve(NextResponse.json({ error: 'WebDev timed out after 5 minutes' }, { status: 500 }))
      }, 300000) // 5 min timeout

      child.stdout.on('data', (data) => {
        fullOutput += data.toString()
      })

      child.stderr.on('data', (data) => {
        console.error(`[WebDev ${requestId}] stderr:`, data.toString())
      })

      child.on('error', (error) => {
        clearTimeout(timeout)
        cleanup()
        console.error(`[WebDev ${requestId}] Error:`, error)
        resolve(NextResponse.json({ error: `WebDev failed: ${error.message}` }, { status: 500 }))
      })

      child.on('close', async (code) => {
        clearTimeout(timeout)
        cleanup()

        console.log(`[WebDev ${requestId}] CLI exited with code ${code}`)

        if (code !== 0) {
          resolve(NextResponse.json({ error: `WebDev CLI exited with code ${code}` }, { status: 500 }))
          return
        }

        // Check if landing page was created
        const landingPath = `/${sessionId}/final-landing.html`
        const landingFullPath = path.join(sessionPath, 'final-landing.html')

        try {
          let html = await readFile(landingFullPath, 'utf-8')

          // Inject bridge script if not already present
          if (!html.includes('oskar-selected')) {
            if (html.includes('</body>')) {
              html = html.replace('</body>', BRIDGE_SCRIPT + '</body>')
            } else {
              html += BRIDGE_SCRIPT
            }
            await writeFile(landingFullPath, html, 'utf-8')
          }

          console.log(`[WebDev ${requestId}] ✅ Landing page ready: ${landingPath}`)

          resolve(NextResponse.json({
            success: true,
            paths: { landing: landingPath },
            message: 'Landing page built successfully'
          }))
        } catch {
          // Landing page wasn't created, try to extract HTML from output
          const htmlMatch = fullOutput.match(/```html\n([\s\S]*?)\n```/)
          if (htmlMatch) {
            let html = htmlMatch[1]

            // Inject bridge script
            if (html.includes('</body>')) {
              html = html.replace('</body>', BRIDGE_SCRIPT + '</body>')
            } else {
              html += BRIDGE_SCRIPT
            }

            await writeFile(landingFullPath, html, 'utf-8')
            console.log(`[WebDev ${requestId}] ✅ Extracted and saved landing page: ${landingPath}`)

            resolve(NextResponse.json({
              success: true,
              paths: { landing: landingPath },
              message: 'Landing page built successfully (extracted from output)'
            }))
          } else {
            console.log(`[WebDev ${requestId}] ❌ No landing page found`)
            resolve(NextResponse.json({
              success: false,
              error: 'WebDev did not produce a landing page',
              output: fullOutput.substring(0, 2000)
            }, { status: 500 }))
          }
        }
      })
    })

  } catch (error) {
    console.error(`[WebDev] Error [${requestId}]:`, error)
    return NextResponse.json(
      { error: `WebDev build failed: ${error}` },
      { status: 500 }
    )
  }
}
