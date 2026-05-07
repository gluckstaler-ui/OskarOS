import { NextRequest, NextResponse } from 'next/server'
import { spawn, execSync } from 'child_process'
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { readFile, appendFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildCDPrompt } from '@/lib/cd-agent-prompt'
import {
  getSessionMdPath, getUserMemoryPath, getDreamLogPath,
  getLogsDir
} from '@/lib/memory/paths'
import { maybeRunLumberjack } from '@/lib/memory/lumberjack'

export const maxDuration = 300 // 5 minutes

// Find claude binary - check common locations
function findClaudeBinary(): string {
  const commonPaths = [
    '/opt/homebrew/bin/claude',      // Mac ARM (Homebrew)
    '/usr/local/bin/claude',          // Mac Intel / Linux
    '/usr/bin/claude',                // System install
  ]

  for (const p of commonPaths) {
    if (existsSync(p)) {
      console.log('Found claude at:', p)
      return p
    }
  }

  // Try to find via which command
  try {
    const which = execSync('which claude', { encoding: 'utf-8' }).trim()
    if (which) {
      console.log('Found claude via which:', which)
      return which
    }
  } catch (e) {
    // which failed
  }

  throw new Error('Claude CLI not found. Please install it with: npm install -g @anthropic-ai/claude-code')
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(req: NextRequest) {
  const requestId = Date.now()
  console.log(`=== Claude Code CLI called [${requestId}] ===`)

  try {
    const body = await req.json()
    const {
      messages,
      uploadedFiles,
      imageManifest,
      vibeCount = 5,
      sourceImages = [],
      sessionId = 'default-session',
      isResume = false
    } = body

    console.log(`[${requestId}] Session: ${sessionId}${isResume ? ' (RESUME)' : ''}`)

    // Load memory system files for prompt context
    const memorySessionFiles = await (async () => {
      try {
        const consolidatedSessionMd = await readFile(getSessionMdPath(sessionId), 'utf-8').catch(() => undefined)
        const userMd = await readFile(getUserMemoryPath(sessionId), 'utf-8').catch(() => undefined)
        const dreamLog = await readFile(getDreamLogPath(sessionId), 'utf-8').catch(() => '')
        const dreamTimestamp = dreamLog.match(/^# Dream Cycle — (.+)$/m)?.[1] || 'never'
        const currentHour = new Date().getHours()
        const currentMinute = String(new Date().getMinutes()).padStart(2, '0')
        const clockBlock = (consolidatedSessionMd || userMd) ? `\n## MEMORY CLOCK\n- Current time: ${currentHour}:${currentMinute}\n- Dreamer last ran: ${dreamTimestamp}\n` : ''
        return { consolidatedSessionMd, userMd, clockBlock }
      } catch {
        return {}
      }
    })()

    // Build the system prompt with session context + memory
    const systemPrompt = buildCDPrompt(sourceImages, sessionId, isResume, memorySessionFiles)

    // Build the prompt from conversation history
    const conversationContext = messages
      .map((m: Message) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')

    // Build image list
    const imageList = imageManifest?.length > 0
      ? `\n\nAVAILABLE IMAGES: ${imageManifest.map((i: any) => i.filename).join(', ')}`
      : ''

    // For resume, just ask for boot sequence - don't ask for vibe generation
    let fullPrompt: string
    if (isResume) {
      // Use relative path from oskar-prototype directory
      fullPrompt = `${conversationContext}

You are resuming a session. Read the session files in public/${sessionId}/ and report:
1. What phase this session is in (check SESSION.md)
2. What vibes/HTML files exist - use: ls public/${sessionId}/*.html
3. What images are available
4. What's the next step

IMPORTANT: Use relative paths from the current directory, e.g., public/${sessionId}/SESSION.md

Do NOT generate new vibes unless explicitly asked. Just assess and report the current state.`
    } else {
      fullPrompt = `${conversationContext}${imageList}

NOW GENERATE EXACTLY ${vibeCount} COMPLETE VIBES WITH FULL HTML FOR EACH.
Use ONLY the image filenames listed above. Do not invent new filenames.`
    }

    console.log(`[${requestId}] Running Claude Code CLI...`)
    const result = await runClaudeCode(fullPrompt, systemPrompt)
    console.log(`[${requestId}] Claude Code returned ${result.length} chars`)

    // Parse vibes from the result (same logic as chat route)
    const vibes = parseVibes(result)
    console.log(`[${requestId}] Parsed ${vibes.length} vibes`)

    // Auto-save vibes to disk
    const savedPaths: string[] = []
    if (vibes.length > 0) {
      const outputDir = join(process.cwd(), 'public', 'generated-vibes')
      mkdirSync(outputDir, { recursive: true })

      for (const vibe of vibes) {
        const filename = `${vibe.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.html`
        const filePath = join(outputDir, filename)
        writeFileSync(filePath, vibe.html, 'utf-8')
        const publicPath = `/generated-vibes/${filename}`
        savedPaths.push(publicPath)
        console.log(`[${requestId}] Saved vibe "${vibe.name}" to ${publicPath}`)
      }
    }

    // Lumberjack piggyback — 10-minute cooldown per session
    if (sessionId !== 'default-session') {
      maybeRunLumberjack(sessionId).catch(err =>
        console.error(`[${requestId}] Lumberjack failed:`, err)
      )
    }

    return NextResponse.json({
      message: result,
      vibes: vibes.length > 0 ? vibes : undefined,
      vibePaths: savedPaths.length > 0 ? savedPaths : undefined
    })

  } catch (error: any) {
    console.error(`[${requestId}] Claude Code error:`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

function runClaudeCode(prompt: string, systemPrompt?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Write prompt and system prompt to temp files to avoid argument length issues
    const tempDir = tmpdir()
    const promptFile = join(tempDir, `claude-prompt-${Date.now()}.txt`)
    const systemFile = join(tempDir, `claude-system-${Date.now()}.txt`)

    writeFileSync(promptFile, prompt, 'utf-8')

    const cleanup = () => {
      try { unlinkSync(promptFile) } catch (e) {}
      try { unlinkSync(systemFile) } catch (e) {}
    }

    // Build args - read prompt from file using shell
    const claudePath = findClaudeBinary()

    // Build the command - prompt is positional argument at the end
    // --print flag enables non-interactive mode (print and exit)
    // --permission-mode bypassPermissions allows CLI full access without prompts
    let command: string

    if (systemPrompt) {
      writeFileSync(systemFile, systemPrompt, 'utf-8')
      command = `"${claudePath}" --print --output-format text --no-session-persistence --permission-mode bypassPermissions --system-prompt "$(cat '${systemFile}')" "$(cat '${promptFile}')"`
    } else {
      command = `"${claudePath}" --print --output-format text --no-session-persistence --permission-mode bypassPermissions "$(cat '${promptFile}')"`
    }

    console.log('Running claude CLI via shell...')
    console.log('Prompt length:', prompt.length)
    console.log('System prompt length:', systemPrompt?.length || 0)

    let stdout = ''
    let stderr = ''

    const child = spawn('sh', ['-c', command], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],  // Close stdin, pipe stdout/stderr
      env: {
        ...process.env,
        HOME: process.env.HOME,
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || ''),
        // Ensure Claude auth token is passed if available
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || ''
      }
    })

    // stdin is already closed via stdio: ['ignore', ...]

    // Set timeout to 8 minutes
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      cleanup()
      reject(new Error('Claude Code timed out after 8 minutes'))
    }, 480000)

    child.stdout.on('data', (data) => {
      stdout += data.toString()
      // Log progress
      if (stdout.length % 5000 < 100) {
        console.log(`Received ${stdout.length} bytes so far...`)
      }
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      cleanup()
      console.error('Claude CLI spawn error:', error.message)
      reject(new Error(`CLI spawn failed: ${error.message}`))
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      cleanup()

      if (code !== 0) {
        console.error('Claude CLI exited with code:', code)
        console.error('stderr:', stderr)
        reject(new Error(`CLI exited with code ${code}: ${stderr}`))
        return
      }

      console.log('Claude CLI completed, output length:', stdout.length)
      resolve(stdout)
    })
  })
}

function parseVibes(text: string) {
  const vibes: {
    name: string
    html: string
    headline: string
    tagline: string
    colors: string[]
    typography: { heading: string; body: string }
    voiceSamples: string[]
  }[] = []

  // Split by vibe sections
  const vibeSections = text.split(/## VIBE \d+:/i).slice(1)

  for (const section of vibeSections) {
    // Extract vibe name
    const nameMatch = section.match(/^([^\n]+)/)
    const name = nameMatch ? nameMatch[1].trim() : `Vibe ${vibes.length + 1}`

    // Extract moodboard data
    const moodboardMatch = section.match(/```moodboard\n([\s\S]*?)\n```/)
    let moodboardData = {
      headline: '',
      tagline: '',
      colors: [] as string[],
      typography: { heading: 'Georgia, serif', body: 'system-ui, sans-serif' },
      voiceSamples: [] as string[]
    }

    if (moodboardMatch) {
      try {
        const parsed = JSON.parse(moodboardMatch[1])
        moodboardData = {
          headline: parsed.headline || '',
          tagline: parsed.tagline || '',
          colors: parsed.colors || [],
          typography: parsed.typography || { heading: 'Georgia, serif', body: 'system-ui, sans-serif' },
          voiceSamples: parsed.voiceSamples || []
        }
      } catch (e) {
        console.error('Error parsing moodboard:', e)
      }
    }

    // Extract HTML
    const htmlMatch = section.match(/```html\n([\s\S]*?)\n```/)
    const html = htmlMatch ? htmlMatch[1].trim() : ''

    if (html) {
      vibes.push({
        name,
        html,
        ...moodboardData
      })
    }
  }

  // Fallback: just extract HTML blocks
  if (vibes.length === 0) {
    const htmlBlocks = text.matchAll(/```html\n([\s\S]*?)\n```/gi)
    let i = 1
    for (const match of htmlBlocks) {
      vibes.push({
        name: `Vibe ${i++}`,
        html: match[1].trim(),
        headline: '',
        tagline: '',
        colors: [],
        typography: { heading: 'Georgia, serif', body: 'system-ui, sans-serif' },
        voiceSamples: []
      })
    }
  }

  return vibes
}
