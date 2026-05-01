/**
 * Lumberjack — single-call compaction agent.
 *
 * 2026-04-21: scrapped the 7-stage multi-CLI design. One invocation, one
 * agent file (`agents/lumberjack-padawan.md`). The padawan spec IS the
 * prompt — patterns P1–P6 + LEDGER all live in it, and the model runs them
 * in sequence within a single conversation.
 *
 * The multi-stage approach tried to shard across 7 separate CLI subprocesses.
 * Each stage ran ~5 min, cost ~$1, and produced a 3 MB log (each Edit
 * tool_result carries the entire pre-edit SESSION.md as a sidecar field).
 * Running one agent across all patterns re-uses the model's context instead
 * of paying for it 7 times, and it's the pattern `debug-lumberjack.sh`
 * already uses in `--single` mode with proven reliability.
 *
 * Public surface (unchanged so order65/order66/chat don't need to edit):
 *   runLumberjack(sessionId, onProgress) → LumberjackResult
 *   maybeRunLumberjack(sessionId, onProgress) → 10-min-cooldown variant
 *   pauseLumberjack() / resumeLumberjack() → sage lock
 *   type ProgressEvent, ProgressCallback, LumberjackResult
 */

import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { getSessionMdPath, getLogsDir } from './paths'
import { callAnthropicAgent } from './anthropic'
import { loadLumberjackPadawan } from './prompts'
import path from 'path'

const LUMBERJACK_MODEL = 'claude-sonnet-4-6' as const

// 15 min — a full padawan run through all 7 patterns + ledger can genuinely
// take 8–12 min on a large SESSION.md. Stages used to time out at 5 min each
// and that killed the system. We give the single run enough rope.
const LUMBERJACK_TIMEOUT_MS = 15 * 60 * 1000

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
// Types — kept identical to the old multi-stage shape so callers keep working.
// The `stage` field is now used for high-level phase naming only ("padawan").
// ============================================================================

export type ProgressEvent = {
  agent: 'lumberjack' | 'sage'
  // 2026-04-29: 'stream' phase added so callAnthropic can forward each parsed
  // claude --print stream-json event to the CompactionOverlay live, instead
  // of only the coarse start/reading/compacting/done states. `detail` holds
  // the one-line preview (e.g. "thinking (1284 chars)" or "text: I'll …").
  phase: 'started' | 'reading' | 'compacting' | 'writing' | 'completed' | 'skipped' | 'failed' | 'stream'
  stage?: string
  detail?: string
}

export type ProgressCallback = (event: ProgressEvent) => void

export interface LumberjackResult {
  status: 'completed' | 'skipped' | 'failed'
  inputSize: number
  outputSize: number
  compressionRatio: string
  timestamp: string
  /** Single-stage now — kept as an array so the SSE payload shape in
   *  order65/order66 doesn't change. Populated with ['padawan'] on success. */
  stagesCompleted: string[]
  stagesFailed: string[]
}

// ============================================================================
// Main entry point — one CLI call with lumberjack-padawan.md as system prompt
// ============================================================================

export async function runLumberjack(
  sessionId: string,
  onProgress?: ProgressCallback,
): Promise<LumberjackResult> {
  const emit = onProgress || (() => {})
  const timestamp = new Date().toISOString()

  if (_sageLock) {
    console.log('[lumberjack] Skipped — sage lock active')
    emit({ agent: 'lumberjack', phase: 'skipped', detail: 'Sage lock active' })
    return emptyResult('skipped', timestamp)
  }

  emit({ agent: 'lumberjack', phase: 'started' })

  const logsDir = getLogsDir(sessionId)
  await mkdir(logsDir, { recursive: true })

  const sessionPath = getSessionMdPath(sessionId)
  const debugLogPath = getLumberjackLogPath(sessionId)
  const cwd = path.resolve(process.cwd())

  // ── Preflight: SESSION.md exists and isn't empty ──────────────────────────
  emit({ agent: 'lumberjack', phase: 'reading', detail: 'Checking SESSION.md...' })
  let inputSize: number
  try {
    const s = await stat(sessionPath)
    inputSize = s.size
  } catch {
    emit({ agent: 'lumberjack', phase: 'skipped', detail: 'SESSION.md not found' })
    return emptyResult('skipped', timestamp)
  }
  if (inputSize === 0) {
    emit({ agent: 'lumberjack', phase: 'skipped', detail: 'SESSION.md empty' })
    return emptyResult('skipped', timestamp)
  }
  emit({ agent: 'lumberjack', phase: 'reading', detail: `${(inputSize / 1024).toFixed(1)}KB` })

  // ── Build the single prompt: padawan agent file + inlined SESSION.md ──────
  // Inlining avoids the 25K-token Read-tool ceiling on large files (the old
  // blocker that forced the multi-round paging dance). Model sees the live
  // content in context from turn 1 and only needs Edit to write back.
  const padawan = loadLumberjackPadawan()
  const currentFile = await readFile(sessionPath, 'utf-8')
  const fileSizeKb = (currentFile.length / 1024).toFixed(1)

  const enrichedPrompt =
    padawan +
    '\n\n## CURRENT SESSION.md CONTENT\n\n' +
    `File: ${sessionPath}\n` +
    `Size: ${currentFile.length} bytes (${fileSizeKb}KB)\n\n` +
    'The complete live content is below. Do NOT call the Read tool — ' +
    'the content here IS the current state. Use ONLY the Edit tool to ' +
    'write changes back to the file path above.\n\n' +
    '```markdown\n' +
    currentFile +
    '\n```\n'

  emit({
    agent: 'lumberjack',
    phase: 'compacting',
    stage: 'padawan',
    detail: `padawan — started (input ${fileSizeKb}KB)`,
  })
  console.log(
    `[lumberjack] ${sessionId}: running padawan on ${fileSizeKb}KB of SESSION.md`,
  )

  const startMs = Date.now()

  // Heartbeat — emit progress every 30s so the UI knows the run is alive
  // during long CLI work. Matches the old multi-stage UX.
  const heartbeat = setInterval(() => {
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(0)
    emit({
      agent: 'lumberjack',
      phase: 'compacting',
      stage: 'padawan',
      detail: `padawan — ${elapsed}s`,
    })
  }, 30_000)

  let result: string | null = null
  let runError: string | null = null
  try {
    result = await callAnthropicAgent(
      LUMBERJACK_MODEL,
      enrichedPrompt,
      cwd,
      LUMBERJACK_TIMEOUT_MS,
    )
  } catch (err) {
    runError = (err as Error).message
    console.error(`[lumberjack] ${sessionId}: ERROR — ${runError}`)
  } finally {
    clearInterval(heartbeat)
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)

  // ── Gather outcome ────────────────────────────────────────────────────────
  let outputSize: number
  try {
    const s = await stat(sessionPath)
    outputSize = s.size
  } catch {
    outputSize = inputSize
  }
  const ratio = ((1 - outputSize / inputSize) * 100).toFixed(0)

  const succeeded = !!result && !runError
  const status: LumberjackResult['status'] = succeeded ? 'completed' : 'failed'
  const stagesCompleted = succeeded ? ['padawan'] : []
  const stagesFailed = succeeded ? [] : ['padawan']

  const report = result || (runError ? `ERROR: ${runError}` : '(no response from model)')

  // Per-stage summary line — picked up by the UI + written to the debug log
  if (succeeded) {
    console.log(
      `[lumberjack] ${sessionId}: padawan ✓ — ${elapsed}s, ${(outputSize / 1024).toFixed(1)}KB → ${ratio}% compressed`,
    )
    emit({
      agent: 'lumberjack',
      phase: 'compacting',
      stage: 'padawan',
      detail: `padawan — done (${elapsed}s)`,
    })
  } else {
    console.log(`[lumberjack] ${sessionId}: padawan ✗ — ${elapsed}s`)
    emit({
      agent: 'lumberjack',
      phase: 'failed',
      stage: 'padawan',
      detail: runError || '(no response from model)',
    })
  }

  emit({
    agent: 'lumberjack',
    phase: 'writing',
    detail: `${(outputSize / 1024).toFixed(1)}KB (${ratio}% compressed)`,
  })

  // ── Write the debug receipt ──────────────────────────────────────────────
  // First 3000 chars of the agent's report — enough to see its stage-by-stage
  // "P1: N edits / P2: N edits / ..." lines without drowning the log in the
  // ledger dump that the padawan also prints.
  const debugLog =
    `# Lumberjack Run — ${timestamp}\n` +
    `## Input: ${inputSize} bytes (${(inputSize / 1024).toFixed(1)}KB)\n` +
    `## Output: ${outputSize} bytes (${(outputSize / 1024).toFixed(1)}KB)\n` +
    `## Compression: ${ratio}%\n` +
    `## Status: ${status === 'completed' ? 'COMPLETED' : 'FAILED'}\n` +
    `## Duration: ${elapsed}s\n\n` +
    `## Agent Report\n\`\`\`\n${report.slice(0, 3000)}\n\`\`\`\n`
  await writeFile(debugLogPath, debugLog, 'utf-8')

  console.log(
    `[lumberjack] ${sessionId}: ${inputSize}B → ${outputSize}B (${ratio}%) — ${status}`,
  )
  emit({
    agent: 'lumberjack',
    phase: 'completed',
    detail: succeeded ? 'padawan ✓' : 'padawan ✗',
  })

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

function emptyResult(
  status: LumberjackResult['status'],
  timestamp: string,
): LumberjackResult {
  return {
    status,
    inputSize: 0,
    outputSize: 0,
    compressionRatio: 'N/A',
    timestamp,
    stagesCompleted: [],
    stagesFailed: [],
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
export async function maybeRunLumberjack(
  sessionId: string,
  onProgress?: ProgressCallback,
): Promise<LumberjackResult | null> {
  const now = Date.now()
  const lastRun = lastRunBySession.get(sessionId) ?? 0
  if (now - lastRun < COOLDOWN_MS) return null
  lastRunBySession.set(sessionId, now)
  return await runLumberjack(sessionId, onProgress)
}
