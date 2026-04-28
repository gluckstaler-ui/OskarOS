// ═══════════════════════════════════════════════════════════════════════
// SENTINEL TI — runner
// Spawns a `claude --print` subprocess with the Sentinel Ti agent prompt,
// streams text output to the caller via onText, and writes the final
// report to public/{sessionId}/critique/sentinel-ti-{subject}-{ISO}.md.
// ═══════════════════════════════════════════════════════════════════════

import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { spawn } from 'child_process'
import path from 'path'
import { findClaudeBinary } from './webdev'

export interface SentinelTiRequest {
  sessionId: string
  sessionPath: string
  /** 'brief' | 'vibe-N' | 'vibe-N-slug.html' | 'all' */
  target: string
  /** Streamed text chunks from the agent */
  onText?: (chunk: string) => void
  /** Stream JSON events (tool_use, tool_result, etc.) for debugging */
  onEvent?: (event: any) => void
}

export interface SentinelTiResult {
  status: 'complete' | 'error'
  reportPath?: string
  reportText?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Agent prompt loader
// ---------------------------------------------------------------------------

function loadAgentPrompt(): string {
  // Lives in the canonical agents directory at oskar-prototype/agents/,
  // alongside creative-director-agent.md, webdeveloper.md, sage-240-40.md,
  // sage-portrait.md, dreamer-agent.md, lumberjack-padawan.md.
  const candidates = [
    path.join(process.cwd(), 'agents', 'sentinel-ti.md'),
    path.join(process.cwd(), '..', 'oskar-prototype', 'agents', 'sentinel-ti.md'),
    '/Users/ralphlengler/OskarOS/oskar-prototype/agents/sentinel-ti.md',
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      return require('fs').readFileSync(p, 'utf-8')
    }
  }
  throw new Error(
    `Cannot find agents/sentinel-ti.md. Tried: ${candidates.join(', ')}`,
  )
}

// ---------------------------------------------------------------------------
// User prompt builder
// ---------------------------------------------------------------------------

function buildUserPrompt(req: SentinelTiRequest): string {
  return `## SESSION CONTEXT

**Session ID:** ${req.sessionId}
**Session folder:** ${req.sessionPath}
**Target:** "${req.target}"

You are running in CLI mode with full tools (Read, Bash, Grep, etc.).

## YOUR TASK

1. Execute your boot sequence (read the 8 huashu references + session files
   listed in your agent file). If a reference is missing, say so — do not
   fake-cite.

2. Identify the subject from the target string:
   - "brief"       → critique \`${req.sessionPath}/CREATIVE-BRIEF.md\`
   - "vibe-N"      → find the matching \`vibe-N-*.html\` in the session folder
   - "vibe-N-slug" → exact filename
   - "all"         → critique the brief + every \`vibe-*.html\` in the folder

3. Score using huashu's 5-dimension rubric. Write a complete report
   following the template in your agent file. Do not skip dimensions.

4. Recommend two design schools from \`skills/references/design-styles.md\`
   from DIFFERENT philosophical groups. Anchor each recommendation in the
   brief's voice/audience/output type.

## OUTPUT

Write your complete report to BOTH:
- stdout (it will stream to the chat)
- the file: \`${req.sessionPath}/critique/sentinel-ti-${req.target}-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.md\`

Create the \`critique/\` folder if it doesn't exist. Use your Bash tool.

End your response with the Force-ghost signature.

NOW BEGIN.`
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function runSentinelTi(
  req: SentinelTiRequest,
): Promise<SentinelTiResult> {
  console.log(
    `[SentinelTi] target="${req.target}" session="${req.sessionId}"`,
  )

  // Ensure the critique output dir exists ahead of time
  const critiqueDir = path.join(req.sessionPath, 'critique')
  try {
    await mkdir(critiqueDir, { recursive: true })
  } catch {
    /* ignore */
  }

  const agentPrompt = loadAgentPrompt()
  const userPrompt = buildUserPrompt(req)

  // Build the system prompt = agent file prepended with a short orchestrator note
  const systemPrompt = `${agentPrompt}

---

# Orchestrator note

You were spawned by the OskarOS chat-stream API on user request. Stream your
report inline (markdown is fine). Use your Bash tool to write the same report
to the file path the user prompt specifies. Do not invent file paths.`

  const claudePath = findClaudeBinary()
  console.log(`[SentinelTi] claude binary: ${claudePath}`)

  // Sentinel Ti runs on OPUS — critique requires deeper reasoning than
  // sonnet provides. The 1m context variant fits the full huashu reference
  // set + session files + every vibe HTML in one read pass.
  const args = [
    '--print',
    '--verbose',
    '--no-session-persistence',
    '--model',
    'claude-opus-4-7[1m]',
    '--output-format',
    'stream-json',
    '--permission-mode',
    'bypassPermissions',
    '--system-prompt',
    systemPrompt,
    userPrompt,
  ]

  return new Promise<SentinelTiResult>((resolve) => {
    let collectedText = ''
    let stderrBuf = ''
    let parseBuf = ''

    const child = spawn(claudePath, args, {
      cwd: req.sessionPath,
      env: process.env,
    })

    child.stdout.on('data', (data: Buffer) => {
      parseBuf += data.toString('utf-8')
      // stream-json emits one JSON object per line
      let nl: number
      while ((nl = parseBuf.indexOf('\n')) >= 0) {
        const line = parseBuf.slice(0, nl).trim()
        parseBuf = parseBuf.slice(nl + 1)
        if (!line) continue
        try {
          const event = JSON.parse(line)
          req.onEvent?.(event)
          // Extract text deltas from assistant messages
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                collectedText += block.text
                req.onText?.(block.text)
              }
            }
          }
        } catch {
          /* not JSON, ignore */
        }
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      stderrBuf += data.toString('utf-8')
    })

    child.on('error', (err) => {
      console.error('[SentinelTi] spawn error:', err)
      resolve({
        status: 'error',
        error: `Failed to spawn claude binary: ${err.message}`,
      })
    })

    child.on('close', async (code) => {
      console.log(
        `[SentinelTi] CLI exited code=${code}, output ${collectedText.length} chars`,
      )

      if (collectedText.length === 0) {
        const truncatedStderr = stderrBuf.slice(0, 500)
        resolve({
          status: 'error',
          error: `Sentinel Ti produced no output. CLI exit=${code}. stderr: ${truncatedStderr}`,
        })
        return
      }

      // Persist the report to disk (the agent itself was instructed to do
      // this via Bash, but we also write a fallback copy in case it didn't).
      const safeTarget = req.target.replace(/[^a-zA-Z0-9_-]/g, '_')
      const iso = new Date().toISOString().replace(/[:.]/g, '-')
      const reportPath = path.join(
        critiqueDir,
        `sentinel-ti-${safeTarget}-${iso}.md`,
      )
      try {
        await writeFile(reportPath, collectedText, 'utf-8')
      } catch (err) {
        console.error('[SentinelTi] failed to write report:', err)
      }

      resolve({
        status: 'complete',
        reportPath,
        reportText: collectedText,
      })
    })
  })
}
