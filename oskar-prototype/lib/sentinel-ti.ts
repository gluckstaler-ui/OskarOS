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
import { ensureMcpConfig, SENTINEL_ALLOWED_TOOLS } from './mcp-config'
import { makeToolCollector } from './mcp-tool-collector'

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

/** Phase 2: structured critique args from submit_critique tool call. */
export interface SentinelTiCritiqueScores {
  target: string
  scores: Array<{ dimension: string; score: number; note: string }>
  summary: string
  recommendations: string[]
}

export interface SentinelTiResult {
  status: 'complete' | 'error'
  reportPath?: string
  /** Narrative critique text streamed from the agent. */
  reportText?: string
  /** Phase 2 (2026-04-30): structured args from submit_critique tool call.
   *  Populated when the agent called the tool; null if it forgot. UI
   *  renders score badges from these args (no re-parsing the narrative). */
  scores?: SentinelTiCritiqueScores | null
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

## OUTPUT — Phase 2 (2026-04-30)

Two outputs, in order:

1. **Narrative critique (text).** Stream the long-form report to stdout —
   it surfaces live in the Compaction Live Feed. Write the same report to
   the file: \`${req.sessionPath}/critique/sentinel-ti-${req.target}-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.md\`. Create the \`critique/\` folder if needed.

2. **Structured scores (tool call).** AFTER the narrative is written, call
   the \`submit_critique\` MCP tool with:

   \`\`\`
   submit_critique({
     target: "${req.target}",
     scores: [
       { dimension: "philosophy_alignment", score: 7.5, note: "..." },
       { dimension: "visual_hierarchy",     score: 6.0, note: "..." },
       { dimension: "craft",                score: 8.5, note: "..." },
       { dimension: "functionality",        score: 7.0, note: "..." },
       { dimension: "originality",          score: 6.5, note: "..." }
     ],
     summary: "<one paragraph headline>",
     recommendations: ["<one sentence each>", ...]
   })
   \`\`\`

   The UI renders score badges from this tool call — do NOT embed the
   scores in the narrative as parseable text. The header-format parser
   was retired 2026-04-30. Tool call IS the structured contract.

End your narrative with the Force-ghost signature, THEN call submit_critique.

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

  // Phase 2 (2026-04-30): Ti gets the same MCP wiring as CD/WebDev. Its
  // only allowed MCP tool is `submit_critique` — structured scores. The
  // narrative text still streams via stdout as before.
  const mcpConfigFile = ensureMcpConfig({ sessionId: req.sessionId, cwd: process.cwd(), agentRole: 'sentinel' })

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
    '--mcp-config',
    mcpConfigFile,
    '--allowed-tools',
    SENTINEL_ALLOWED_TOOLS,
    '--system-prompt',
    systemPrompt,
    userPrompt,
  ]

  return new Promise<SentinelTiResult>((resolve) => {
    let collectedText = ''
    let stderrBuf = ''
    let parseBuf = ''

    // Phase 2 — parallel jobs from one stream:
    //   Job A — forward text chunks to req.onText (live feed; existing)
    //   Job B — capture submit_critique tool_use args via the collector
    // Both read from the same stream-json events; they write to different
    // sinks. Order is enforced by the agent prompt (narrative first, tool
    // call last), not by buffering.
    const toolCollector = makeToolCollector(['submit_critique'])

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
          // Job B: capture submit_critique tool_use args (last-write-wins
          // if Ti calls it twice, which it shouldn't).
          toolCollector.consume(event)
          // Job A: forward narrative text deltas to onText.
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

      // Phase 2: surface structured critique scores from the captured
      // submit_critique tool call. Null if Ti didn't call the tool —
      // UI shows narrative only, no badges.
      const submitArgs = toolCollector.getToolCalls().submit_critique as
        | SentinelTiCritiqueScores
        | undefined

      resolve({
        status: 'complete',
        reportPath,
        reportText: collectedText,
        scores: submitArgs || null,
      })
    })
  })
}
