/**
 * Padawan Sage — Portrait Painter
 *
 * Runs once per session (at session end). Reads Lumberjack's cleaned
 * SESSION.md (with LEDGER) and the current user.md portrait. Paints
 * or refines the portrait, logs triage decisions, optionally appends
 * to CD-MEMORY.md.
 *
 * The full agent file (agents/dreamer-agent-production.md) is sent as the
 * prompt — identity, dark side, philosophy, instructions. The model needs
 * its full soul to paint portraits, not an extracted subsection.
 *
 * IMPORTANT: The dreamer pauses the lumberjack before running and
 * resumes it after. Both write to session files — they can't run simultaneously.
 */

import { readFile, writeFile, mkdir } from 'fs/promises'
import {
  getSessionMdPath,
  getUserMemoryPath,
  getDreamLogPath,
  getLogsDir,
} from './paths'
import { loadDreamerAgentFile } from './prompts'
import { callAnthropic } from './anthropic'
import { pauseLumberjack, resumeLumberjack } from './lumberjack'
import type { ProgressCallback } from './lumberjack'

// ============================================================================
// Config
// ============================================================================

const DREAMER_MODEL = 'claude-sonnet-4-6' as const

// ============================================================================
// Types
// ============================================================================

export interface DreamerStats {
  sessionMdSize: number
  userMemoryUpdated: boolean
  dreamTimestamp: string
  triageLog: string
}

export interface DreamerResult {
  stats: DreamerStats
}

interface DreamerOutput {
  userMemoryUpdate: string
  triageLog: string
}

// ============================================================================
// Core
// ============================================================================

/**
 * Run one dream cycle for the given session.
 *
 * Reads: SESSION.md (Lumberjack's output), user.md
 * Writes: user.md, dream log
 */
export async function runDreamer(sessionId: string, onProgress?: ProgressCallback): Promise<DreamerResult> {
  // Stop the lumberjack — both write to session files, can't run simultaneously
  pauseLumberjack()

  try {
    return await _runDreamerInner(sessionId, onProgress)
  } finally {
    // Always resume, even if the dream cycle fails
    resumeLumberjack()
  }
}

/**
 * Order 66 variant — updates user.md in PARALLEL with lumberjack.
 * Lumberjack cleans SESSION.md, Sage updates user.md — different files, no lock needed.
 */
export async function runDreamerOrder66(sessionId: string, onProgress?: ProgressCallback): Promise<DreamerResult> {
  console.log(`[dreamer] Order 66 mode — parallel with lumberjack for ${sessionId}`)
  return await _runDreamerInner(sessionId, onProgress)
}

async function _runDreamerInner(sessionId: string, onProgress?: ProgressCallback): Promise<DreamerResult> {
  const emit = onProgress || (() => {})
  const logsDir = getLogsDir(sessionId)
  await mkdir(logsDir, { recursive: true })

  const sessionMdPath = getSessionMdPath(sessionId)
  const userMemoryPath = getUserMemoryPath(sessionId)
  const dreamLogPath = getDreamLogPath(sessionId)

  const dreamTimestamp = new Date().toISOString()

  emit({ agent: 'sage', phase: 'started' })

  // Read both inputs in parallel
  emit({ agent: 'sage', phase: 'reading', detail: 'Reading session + user portrait...' })
  const [sessionMd, userMemory] = await Promise.all([
    readFile(sessionMdPath, 'utf-8').catch(() => ''),
    readFile(userMemoryPath, 'utf-8').catch(() => ''),
  ])

  // Nothing to process — write minimal log and exit
  if (!sessionMd.trim()) {
    emit({ agent: 'sage', phase: 'skipped', detail: 'SESSION.md empty' })
    await writeFile(dreamLogPath,
      `# Dream Cycle — ${dreamTimestamp}\n`
      + `## SESSION.md Size: 0 bytes\n`
      + `SESSION.md empty. Nothing to process.\n`,
      'utf-8'
    )
    return {
      stats: {
        sessionMdSize: 0,
        userMemoryUpdated: false,
        dreamTimestamp,
        triageLog: 'SESSION.md empty. Nothing to process.',
      },
    }
  }

  emit({ agent: 'sage', phase: 'reading', detail: `${(sessionMd.length / 1024).toFixed(1)}KB session, ${userMemory ? (userMemory.length / 1024).toFixed(1) + 'KB portrait' : 'no portrait yet'}` })

  // Build prompt: full agent file + appended inputs
  const agentFile = loadDreamerAgentFile()
  const prompt = buildDreamerPrompt(agentFile, sessionMd, userMemory)

  // Call the model
  emit({ agent: 'sage', phase: 'compacting', detail: 'Updating user portrait...' })
  const response = await callAnthropic(DREAMER_MODEL, prompt)

  if (!response) {
    console.error('[dreamer] Anthropic call returned null — skipping cycle')
    emit({ agent: 'sage', phase: 'failed', detail: 'Model call failed' })
    await writeFile(dreamLogPath,
      `# Dream Cycle — ${dreamTimestamp}\n`
      + `## SESSION.md Size: ${sessionMd.length} bytes\n`
      + `## ERROR: Anthropic call failed.\n`,
      'utf-8'
    )
    return {
      stats: {
        sessionMdSize: sessionMd.length,
        userMemoryUpdated: false,
        dreamTimestamp,
        triageLog: 'ERROR: Anthropic call failed.',
      },
    }
  }

  // Parse structured output
  const output = parseDreamerOutput(response)

  const userMemoryUpdated = output.userMemoryUpdate !== 'NO_CHANGE'

  // Write outputs in parallel
  emit({ agent: 'sage', phase: 'writing', detail: userMemoryUpdated ? 'Writing updated user.md...' : 'No changes to user.md' })
  await Promise.all([
    // Update user.md if changed
    userMemoryUpdated
      ? writeFile(userMemoryPath, output.userMemoryUpdate, 'utf-8')
      : Promise.resolve(),

    // Write dream log with triage receipt
    writeFile(dreamLogPath,
      `# Dream Cycle — ${dreamTimestamp}\n`
      + `## SESSION.md Size: ${sessionMd.length} bytes\n`
      + `## User Memory Updated: ${userMemoryUpdated}\n\n`
      + `## Triage Log\n${output.triageLog}\n`,
      'utf-8'
    ),
  ])

  console.log(
    `[dreamer] Cycle complete — session=${sessionMd.length}b, `
    + `userMd=${userMemoryUpdated ? 'updated' : 'unchanged'}`
  )

  emit({ agent: 'sage', phase: 'completed', detail: userMemoryUpdated ? 'Portrait updated' : 'No changes needed' })

  return {
    stats: {
      sessionMdSize: sessionMd.length,
      userMemoryUpdated,
      dreamTimestamp,
      triageLog: output.triageLog,
    },
  }
}

// ============================================================================
// Prompt construction
// ============================================================================

/**
 * Build the dreamer prompt: full agent file + appended inputs.
 *
 * Send the complete agent identity, then append the session data.
 * The model needs its full soul — identity, dark side, philosophy —
 * not just an extracted runtime snippet.
 */
function buildDreamerPrompt(
  agentFile: string,
  sessionMd: string,
  userMemory: string
): string {
  const mode = userMemory.trim()
    ? 'SUBSEQUENT PASS — a portrait exists. Be conservative. Only update what genuinely changes WHO this person is.'
    : 'FIRST PASS — no portrait yet. Paint the full person from the inputs below.'

  return agentFile + `

---

## INPUTS — THIS SESSION

**Mode:** ${mode}

### SESSION.MD (Lumberjack's cleaned output — living exchanges + LEDGER)
${sessionMd || '(empty — no session data)'}

### CURRENT USER.MD
${userMemory || '(empty — first session, paint the full portrait)'}

---

Now produce your output in the exact format defined in OUTPUT FORMAT above.
`
}

// ============================================================================
// Output parser
// ============================================================================

/**
 * Parse the dreamer's structured output into two sections.
 *
 * Expected format:
 *   ### USER.MD
 *   {content or NO_CHANGE}
 *   ### TRIAGE_LOG
 *   {log entries}
 */
function parseDreamerOutput(output: string): DreamerOutput {
  // USER.MD: from ### USER.MD to ### TRIAGE_LOG
  const userMatch = output.match(
    /### USER\.MD\n([\s\S]*?)(?=### TRIAGE_LOG)/
  )

  // TRIAGE_LOG: from ### TRIAGE_LOG to end
  const triageMatch = output.match(
    /### TRIAGE_LOG\n([\s\S]*?)$/
  )

  // The dreamer often outputs "NO_CHANGE" followed by an explanation paragraph.
  // Detect NO_CHANGE by checking if the first non-empty line starts with it.
  const extractOrNoChange = (raw: string | undefined): string => {
    if (!raw) return 'NO_CHANGE'
    const trimmed = raw.trim()
    const firstLine = trimmed.split('\n').find(l => l.trim())?.trim() || ''
    if (/^NO_CHANGE/i.test(firstLine)) return 'NO_CHANGE'
    // Strip markdown code fences the model sometimes wraps output in
    return trimmed.replace(/^```(?:markdown)?\n/gm, '').replace(/^```$/gm, '')
  }

  return {
    userMemoryUpdate: extractOrNoChange(userMatch?.[1]),
    triageLog: triageMatch ? triageMatch[1].trim() : '(no triage log produced)',
  }
}
