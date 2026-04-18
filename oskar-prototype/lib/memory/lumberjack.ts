import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import {
  getSessionMdPath, getLogsDir
} from './paths'
import { callAnthropicAgent } from './anthropic'
import { loadLumberjackStage, type LumberjackStageId } from './prompts'
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

/**
 * Build the 7 stage definitions. Prompts are LOADED FROM DISK (per-stage
 * .md files in `agents/lumberjack-stages/`) — same pattern as Dreamer + CD.
 * Edit the .md to iterate on prompts; no rebuild needed.
 *
 * Was previously ~250 lines of inline strings here. The agents/lumberjack-padawan.md
 * file was decorative — editing it didn't change behavior. Now stage prompts live
 * in their files (P1-boot-sequences.md … LEDGER-ledger.md) and the loader does
 * `{{readInstructions}}` + `{{sessionPath}}` substitution.
 */
function buildStages(sessionPath: string): Stage[] {
  const stageDefs: { id: LumberjackStageId; name: string }[] = [
    { id: 'P1', name: 'Boot Sequences' },
    { id: 'P2', name: 'Fix/Analysis Blocks' },
    { id: 'P3', name: 'Navigation Chains' },
    { id: 'P4', name: 'Agent Monologue' },
    { id: 'P5', name: 'Rate Limit Clusters' },
    { id: 'P6', name: 'Image Flow' },
    { id: 'LEDGER', name: 'Ledger' },
  ]
  return stageDefs.map(({ id, name }) => ({
    id,
    name,
    prompt: loadLumberjackStage(id, sessionPath),
  }))
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
