import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import {
  getSessionMdPath, getLogsDir
} from './paths'
import { callAnthropicAgent } from './anthropic'
import path from 'path'

const LUMBERJACK_MODEL = 'claude-sonnet-4-6' as const

// Sage lock — when the dreamer/sage is running, lumberjack must not
// write to SESSION.md. Sage sets this before its cycle, clears after.
let _sageLock = false


export function pauseLumberjack(): void {
  _sageLock = true
  console.log('[lumberjack] Paused — sage is running')
}

export function resumeLumberjack(): void {
  _sageLock = false
  console.log('[lumberjack] Resumed — sage finished')
}

// --- Path helpers (lumberjack-specific) ---

function getLumberjackLogPath(sessionId: string): string {
  return path.join(getLogsDir(sessionId), '.last-lumberjack-log.md')
}

// ============================================================================
// Types
// ============================================================================

export type ProgressEvent = {
  agent: 'lumberjack' | 'sage'
  phase: 'started' | 'reading' | 'compacting' | 'writing' | 'completed' | 'skipped' | 'failed'
  stage?: string   // P1, P2, ... P6, LEDGER
  detail?: string
}

export type ProgressCallback = (event: ProgressEvent) => void

export interface LumberjackResult {
  status: 'completed' | 'skipped' | 'failed'
  inputSize: number
  outputSize: number
  compressionRatio: string
  timestamp: string
  stagesCompleted: string[]
  stagesFailed: string[]
}

// ============================================================================
// Stage definitions — each is a separate agent call
// ============================================================================

interface Stage {
  id: string
  name: string
  prompt: string  // Focused instruction for this stage only
}

function buildStages(sessionPath: string): Stage[] {
  const readInstructions = `
## TARGET FILE
${sessionPath}

## HOW TO READ
The file may be thousands of lines. Read tool returns ~2000 lines per call.
First call: no offset (lines 1-2000). Then offset=2000, offset=4000, etc.
Read the ENTIRE file before making edits.

## RULES
- Every cut leaves exactly ONE replacement line. No holes.
- NEVER touch: user messages, discovery Q&A, CD creative responses, debugging exchanges, escalation sequences, teaching moments, code blocks.
- NEVER rewrite in your own words. Replace dead wood with stumps.
- If unsure, leave it standing.
`

  return [
    {
      id: 'P1',
      name: 'Boot Sequences',
      prompt: `You are Lumberjack — a forest ranger cleaning dead wood from a session log. You have Read and Edit tools.
${readInstructions}
## YOUR ONE JOB THIS CALL: BOOT SEQUENCES, STATUS DUMPS, AND IDLE CHATTER

You are removing the BIGGEST source of dead wood in any session. Be aggressive.

### What counts as a boot

**Boot triggers** — any of these:
- "Session resumed. Execute your boot sequence:"
- "I'm back." / "I'm back" (single or repeated)
- "Executing boot protocol:"
- Any variation that triggers the CD to dump session status

**Status dumps** — the CD's response to a boot:
- Phase reports ("Phase 4 — Vibe Selection Pending")
- File listings ("✅ 3 HTML files built: ...")
- Image status tables
- "What's next" / "Your call" / "Pick a vibe" prompts
- Rebuild triggers that repeat previous rebuild triggers

### The key rule: KEEP ONLY THE LAST BOOT

Multiple boots with SIMILAR status dumps are dead wood — even if each one has minor state changes (one more file built, one more image approved). The minor updates belong in LEDGER entries, not in 40-line status dumps.

**How to handle a series of boots:**

1. Find ALL boot sequences in the file
2. Keep ONLY the LAST one — it has the most current state
3. Collapse ALL earlier boots to: \`## SESSION RESTORED — [DATE] — [TIME]\`
4. For each collapsed boot that contained a state change or action (e.g. triggered a rebuild), add a note to your output so the LEDGER stage can capture it: \`[COLLAPSED: Boot at HH:MM triggered rebuild of Vibe 3]\`

### Idle chatter — also dead wood

After boots, the CD and user may exchange pleasantries with NO substantive content:
- "Say yes" → "Yes." / "Hi" → "Hi Ralph."
- "lol" → "😄" / emojis / one-word volleys
- Identity corrections ("I'm not a Padawan")
- CD jokes about boot loops

This is dead wood UNTIL something substantive arrives.

### What is NOT a boot / NOT dead wood

- Discovery Q&A (user answering questions about their business)
- User giving creative feedback ("the hero image is wrong", "grandma's verdict is a mess")
- User commissioning work ("rebuild vibe 2", "rewrite image prompts")
- Image evaluations by the CD
- Technical debugging exchanges

If a boot response ALSO contains the user asking a real question or giving real feedback in the SAME exchange, keep that exchange. The test: **would removing this lose information that exists nowhere else in the file?** If yes → keep. If the same info is in a later boot or in the LEDGER → collapse.

### Replace with:
\`\`\`
## SESSION RESTORED — [DATE] — [TIME]
\`\`\`

After all edits, output: P1: [N] boot/idle clusters replaced — or P1: clean
Also list any collapsed state changes for the LEDGER stage: [COLLAPSED: ...]`
    },
    {
      id: 'P2',
      name: 'Fix/Analysis Blocks',
      prompt: `You are Lumberjack — a forest ranger cleaning dead wood from a session log. You have Read and Edit tools.
${readInstructions}
## YOUR ONE JOB THIS CALL: FIX/ANALYSIS BLOCKS

Find post-hoc summary blocks (ROOT CAUSE ANALYSIS, THE FIX, SUMMARY OF CHANGES) that duplicate the preceding debugging exchange. The debugging EXCHANGE is living tissue — the summary block is the echo.

Replace each block with:
\`\`\`
#### CD | [TIMESTAMP] | FIX: [what was broken] → [what was changed]
\`\`\`

Rules:
- The debugging exchange that preceded the fix block stays UNTOUCHED.
- If the fix block contains info NOT in the preceding exchange (a file path, line number, code snippet), keep that detail in the one-liner.

After all edits, output: P2: [N] fix blocks replaced — or P2: clean`
    },
    {
      id: 'P3',
      name: 'Navigation Chains',
      prompt: `You are Lumberjack — a forest ranger cleaning dead wood from a session log. You have Read and Edit tools.
${readInstructions}
## YOUR ONE JOB THIS CALL: NAVIGATION CHAINS

Find CD narrating its own tool use: "Let me read X. Now I see Y. Let me check Z. Found it." This is plumbing, not content.

Replace with:
\`\`\`
#### CD | [TIMESTAMP] | [Read: file1, file2, ...] →
\`\`\`

Rules:
- The arrow → signals the CD's actual response follows. Keep the response.
- If the entire CD turn is ONLY navigation with no substantive conclusion: \`#### CD | [TIMESTAMP] | [Read: file1, file2] — no action taken\`

After all edits, output: P3: [N] nav chains replaced — or P3: clean`
    },
    {
      id: 'P4',
      name: 'Agent Monologue',
      prompt: `You are Lumberjack — a forest ranger cleaning dead wood from a session log. You have Read and Edit tools.
${readInstructions}
## YOUR ONE JOB THIS CALL: AGENT MONOLOGUE

Find CD reasoning with itself: "I see the problem now. Let me think about this. There are three approaches... Actually, on second thought..."

Replace with:
\`\`\`
#### CD | [TIMESTAMP] | (Agent reasoning: [one line summary of conclusion])
\`\`\`

Rules:
- If the monologue leads to an ACTION (file write, code change, creative output), keep the action. Replace only the reasoning preamble.
- If the monologue IS the entire turn, capture the conclusion in one line.

After all edits, output: P4: [N] monologues replaced — or P4: clean`
    },
    {
      id: 'P5',
      name: 'Rate Limit Clusters',
      prompt: `You are Lumberjack — a forest ranger cleaning dead wood from a session log. You have Read and Edit tools.
${readInstructions}
## YOUR ONE JOB THIS CALL: RATE LIMIT / ERROR CLUSTERS

Find repeated identical system-level failures: rate limits, API credit walls, tool failures.

Replace a cluster with:
\`\`\`
#### SYSTEM | [TIME_START]–[TIME_END] | Rate limit hit. [N] responses blocked. Resets [TIME].
\`\`\`

Rules:
- If a rate-limited response contains ANY substantive content mixed with the limit message, keep the substantive part.
- Only collapse PURE limit messages with zero content.

After all edits, output: P5: [N] limit clusters replaced — or P5: clean`
    },
    {
      id: 'P6',
      name: 'Image Flow',
      prompt: `You are Lumberjack — a forest ranger cleaning dead wood from a session log. You have Read and Edit tools.
${readInstructions}
## YOUR ONE JOB THIS CALL: IMAGE FLOW

Two triggers:

**User uploads (long image lists):**
Replace with: \`🖼️ | DATE-TIME | User Uploaded [N] images\`
If you can identify which image is NEW, name it. If single-image upload, keep original.

**Nano Banana returns:**
Replace notification with: \`🖼️ | DATE-TIME | Nano Banana: "filename.jpg" (description)\`

**CD evaluations (both triggers):**
Remove the emotional one-liner and ## EVALUATION heading. Replace with:
\`#### CD | TIME | EVAL: "filename.jpg" (description)\`
Keep the full evaluation body from "What I see:" through verdict — that's LIVING TISSUE.

Rules:
- User text BEYOND the image list stays. Only compress the list.
- Duplicate upload notifications (same list, seconds apart): keep first, cut rest with \`🖼️ | TIME | (duplicate upload — cut)\`
- Duplicate evaluations of same image: keep first, cut rest.
- Post-evaluation summary blocks that re-list all verdicts: cut entirely.

After all edits, output: P6: [N] image flow edits — or P6: clean`
    },
    {
      id: 'LEDGER',
      name: 'Ledger',
      prompt: `You are Lumberjack — a forest ranger maintaining the decision record. You have Read and Edit tools.
${readInstructions}
## YOUR TWO JOBS THIS CALL: WORKFLOW STATE + LEDGER

### Job 1: Ensure ## Workflow State exists

Check if the file has a \`## Workflow State\` section. If NOT, create one near the top of the file (after ## STATE if it exists, or at the very top).

The section must look like this — check each box based on what the session content shows:

\`\`\`
## Workflow State
- [X] Images uploaded
- [X] Images analyzed by CD
- [X] Discovery complete
- [X] Vibes developed (N/N)
- [ ] Image prompts approved
- [ ] CEO selection made
- [ ] Final build complete
\`\`\`

Rules for checking boxes:
- \`[X]\` = evidence exists in the session that this step completed
- \`[ ]\` = no evidence, or explicitly still pending
- For "Vibes developed" add the count in parentheses (e.g. "4/4" or "9/9") based on how many vibes exist
- If a LEDGER entry says "CEO selection made" or "Phase → Selection" → check that box
- If unsure, leave unchecked

If \`## Workflow State\` already exists, update the checkboxes to reflect current state. Don't duplicate the section.

### Job 2: Build the Ledger

Find the ## LEDGER section at the bottom (create it if missing).

Scan ALL the living tissue above the ledger for:
- **Decisions:** Approvals, rejections, selections, phase transitions.
- **Fixes:** Bug identified and resolved.
- **Taste signals:** User likes, dislikes, preferences. Prefix with TASTE:

For each one that's NOT already in the ledger, append a one-line entry:
\`- [HH:MM] what happened (specific)\`

Rules:
- APPEND only. Never remove existing ledger entries.
- Be SPECIFIC: not "image approved" but "sultan.jpg approved for hero — golden hour + falcon + human combo."
- One LINE each. If your entry needs two lines, you're explaining instead of recording.
- Taste signals: \`- [01:44] TASTE: "Don't put copy into a shot — it looks cheap." Text overlays banned.\`

After all edits, output: LEDGER: [N] new entries, WORKFLOW: [updated/created/unchanged]`
    }
  ]
}

// ============================================================================
// Main entry point — runs stages sequentially with programmatic gates
// ============================================================================

export async function runLumberjack(sessionId: string, onProgress?: ProgressCallback): Promise<LumberjackResult> {
  const emit = onProgress || (() => {})
  const timestamp = new Date().toISOString()

  if (_sageLock) {
    console.log('[lumberjack] Skipped — sage lock active')
    emit({ agent: 'lumberjack', phase: 'skipped', detail: 'Sage lock active' })
    return { status: 'skipped', inputSize: 0, outputSize: 0, compressionRatio: 'N/A', timestamp, stagesCompleted: [], stagesFailed: [] }
  }

  emit({ agent: 'lumberjack', phase: 'started' })

  const logsDir = getLogsDir(sessionId)
  await mkdir(logsDir, { recursive: true })

  const sessionPath = getSessionMdPath(sessionId)
  const debugLogPath = getLumberjackLogPath(sessionId)
  const cwd = path.resolve(process.cwd())

  // Check SESSION.md exists and get size
  emit({ agent: 'lumberjack', phase: 'reading', detail: 'Checking SESSION.md...' })
  let inputSize: number
  try {
    const s = await stat(sessionPath)
    inputSize = s.size
  } catch {
    emit({ agent: 'lumberjack', phase: 'skipped', detail: 'SESSION.md not found' })
    return { status: 'skipped', inputSize: 0, outputSize: 0, compressionRatio: 'N/A', timestamp, stagesCompleted: [], stagesFailed: [] }
  }

  if (inputSize === 0) {
    emit({ agent: 'lumberjack', phase: 'skipped', detail: 'SESSION.md empty' })
    return { status: 'skipped', inputSize: 0, outputSize: 0, compressionRatio: 'N/A', timestamp, stagesCompleted: [], stagesFailed: [] }
  }

  emit({ agent: 'lumberjack', phase: 'reading', detail: `${(inputSize / 1024).toFixed(1)}KB` })

  // Build stages
  const stages = buildStages(sessionPath)
  const stagesCompleted: string[] = []
  const stagesFailed: string[] = []
  const stageLog: string[] = []
  const stageDiagnostics: Record<string, string> = {}  // Full model output per stage

  // Helper: write debug log after every stage so we never lose progress
  async function writeDebugLog() {
    const currentSize = await stat(sessionPath).then(s => s.size).catch(() => inputSize)
    const currentRatio = ((1 - currentSize / inputSize) * 100).toFixed(0)

    // Build diagnostics section — full model output per stage
    let diagSection = ''
    for (const [stageId, output] of Object.entries(stageDiagnostics)) {
      diagSection += `\n### ${stageId} — Full Output\n\`\`\`\n${output.slice(0, 3000)}\n\`\`\`\n`
    }

    await writeFile(debugLogPath,
      `# Lumberjack Run — ${timestamp}\n`
      + `## Input: ${inputSize} bytes (${(inputSize / 1024).toFixed(1)}KB)\n`
      + `## Current: ${currentSize} bytes (${(currentSize / 1024).toFixed(1)}KB)\n`
      + `## Compression: ${currentRatio}%\n`
      + `## Stages: ${stagesCompleted.length}/${stages.length} completed, ${stagesFailed.length} failed\n`
      + `## Status: IN PROGRESS\n\n`
      + `## Stage Log:\n${stageLog.map(l => `- ${l}`).join('\n')}\n`
      + `\n## Stage Diagnostics\n${diagSection}\n`,
      'utf-8'
    )
  }

  // Run each stage as a separate agent call
  for (const stage of stages) {
    // Check sage lock between stages — abort if sage started
    if (_sageLock) {
      console.log(`[lumberjack] ${stage.id}: Aborting — sage lock activated mid-run`)
      stageLog.push(`${stage.id}: ABORTED (sage lock)`)
      await writeDebugLog()
      break
    }

    emit({ agent: 'lumberjack', phase: 'compacting', stage: stage.id, detail: `${stage.name} — started` })
    console.log(`[lumberjack] ${sessionId}: ${stage.id} — ${stage.name}`)

    const startMs = Date.now()

    // Heartbeat — emit progress every 30s so UI knows P1 is alive during long reads
    const heartbeat = setInterval(() => {
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(0)
      emit({ agent: 'lumberjack', phase: 'compacting', stage: stage.id, detail: `${stage.name} — ${elapsed}s` })
    }, 30_000)

    try {
      const result = await callAnthropicAgent(LUMBERJACK_MODEL, stage.prompt, cwd, 5 * 60 * 1000) // 5 min per stage

      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)

      if (result) {
        // Store FULL model output for diagnostics
        stageDiagnostics[stage.id] = result

        // Get file size after this stage's edits
        const postSize = await stat(sessionPath).then(s => s.size).catch(() => 0)
        const stageReport = result.split('\n').find(line =>
          line.startsWith(stage.id + ':') || line.startsWith('LEDGER:')
        ) || result.slice(-200)

        stagesCompleted.push(stage.id)
        stageLog.push(`${stage.id}: ${stageReport.trim()} (${elapsed}s, ${(postSize / 1024).toFixed(1)}KB)`)
        console.log(`[lumberjack] ${sessionId}: ${stage.id} ✓ — ${stageReport.trim()} (${elapsed}s)`)
        // Emit stage-done so UI bar jumps to this stage's percentage
        emit({ agent: 'lumberjack', phase: 'compacting', stage: stage.id, detail: `${stage.name} — done (${elapsed}s)` })
      } else {
        stagesFailed.push(stage.id)
        stageDiagnostics[stage.id] = '(no response from model)'
        stageLog.push(`${stage.id}: FAILED (no response, ${elapsed}s)`)
        console.log(`[lumberjack] ${sessionId}: ${stage.id} ✗ — no response (${elapsed}s)`)
        // Continue to next stage — partial progress is real progress
      }
    } catch (err) {
      const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
      stagesFailed.push(stage.id)
      stageDiagnostics[stage.id] = `ERROR: ${(err as Error).message}`
      stageLog.push(`${stage.id}: ERROR (${(err as Error).message}, ${elapsed}s)`)
      console.error(`[lumberjack] ${sessionId}: ${stage.id} ERROR — ${(err as Error).message}`)
      // Continue to next stage
    } finally {
      clearInterval(heartbeat)
    }

    // Write log after EVERY stage — if we crash next stage, this one is recorded
    await writeDebugLog()
  }

  // Final file size
  let outputSize: number
  try {
    const s = await stat(sessionPath)
    outputSize = s.size
  } catch {
    outputSize = inputSize
  }

  const ratio = ((1 - outputSize / inputSize) * 100).toFixed(0)
  const status = stagesFailed.length === stages.length ? 'failed' : 'completed'

  // Write final debug receipt with full diagnostics
  emit({ agent: 'lumberjack', phase: 'writing', detail: `${(outputSize / 1024).toFixed(1)}KB (${ratio}% compressed)` })

  let finalDiagSection = ''
  for (const [stageId, output] of Object.entries(stageDiagnostics)) {
    finalDiagSection += `\n### ${stageId} — Full Output\n\`\`\`\n${output.slice(0, 3000)}\n\`\`\`\n`
  }

  await writeFile(debugLogPath,
    `# Lumberjack Run — ${timestamp}\n`
    + `## Input: ${inputSize} bytes (${(inputSize / 1024).toFixed(1)}KB)\n`
    + `## Output: ${outputSize} bytes (${(outputSize / 1024).toFixed(1)}KB)\n`
    + `## Compression: ${ratio}%\n`
    + `## Stages: ${stagesCompleted.length}/${stages.length} completed, ${stagesFailed.length} failed\n`
    + `## Status: ${status === 'completed' ? 'COMPLETED' : 'FAILED'}\n\n`
    + `## Stage Log:\n${stageLog.map(l => `- ${l}`).join('\n')}\n`
    + `\n## Stage Diagnostics\n${finalDiagSection}\n`,
    'utf-8'
  )
  console.log(`[lumberjack] ${sessionId}: ${inputSize}B → ${outputSize}B (${ratio}%) — ${stagesCompleted.length}/${stages.length} stages`)
  emit({ agent: 'lumberjack', phase: 'completed', detail: `${stagesCompleted.join('→')} ✓ | ${stagesFailed.length > 0 ? stagesFailed.join(',') + ' ✗' : 'all clean'}` })

  return {
    status,
    inputSize,
    outputSize,
    compressionRatio: ratio,
    timestamp,
    stagesCompleted,
    stagesFailed,
  }

}

// ============================================================================
// Piggyback trigger — called after every CD turn
// ============================================================================

const COOLDOWN_MS = 10 * 60 * 1000 // 10 minutes
const lastRunBySession = new Map<string, number>()

/**
 * Run lumberjack if 10+ minutes since last run for this session.
 * Called fire-and-forget after every CD response.
 */
export async function maybeRunLumberjack(sessionId: string, onProgress?: ProgressCallback): Promise<LumberjackResult | null> {
  const now = Date.now()
  const lastRun = lastRunBySession.get(sessionId) ?? 0

  if (now - lastRun < COOLDOWN_MS) return null

  lastRunBySession.set(sessionId, now)
  return await runLumberjack(sessionId, onProgress)
}
