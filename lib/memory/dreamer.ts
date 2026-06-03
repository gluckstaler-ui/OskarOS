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
 * IMPORTANT: The dreamer runs independently of Lumberjack (retired
 * WP-67, 2026-05-09). It writes to user.md and the dream log only.
 */

import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import {
  getSessionMdPath,
  getUserMemoryPath,
  getDreamLogPath,
  getLogsDir,
} from './paths'
import { loadDreamerAgentFile, loadSagePortrait, loadSage240_40 } from './prompts'
import { callAnthropic, callAnthropicAgent } from './anthropic'
import path from 'path'

// ============================================================================
// Types — relocated from lumberjack.ts (WP-67, Ralph 2026-05-09).
// Lumberjack runtime is deleted but order65/order66 still consume these.
// ============================================================================

export type ProgressEvent = {
  agent: 'lumberjack' | 'sage'
  phase: 'started' | 'reading' | 'compacting' | 'writing' | 'completed' | 'skipped' | 'failed' | 'stream'
  stage?: string
  detail?: string
  progress?: number
}

export type ProgressCallback = (event: ProgressEvent) => void

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
  return await _runDreamerInner(sessionId, onProgress)
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

// ============================================================================
// ─── 2026-04-21: Split Sage variants ────────────────────────────────────────
// Two file-editing sages that use the Edit tool (via callAnthropicAgent)
// instead of the old "emit the full new file as text" contract. The old
// contract hit the 5-min callAnthropic timeout every time on large files
// (84K-token rewrites can't finish in 5 min). These variants have the model
// Read + Edit the files in place; response is just a triage log.
//
// NO INLINING: neither runner appends SESSION.md or user.md to the prompt.
// The prompt is the agent file only. Model uses Read tool to fetch files.
// (The 25K-token Read-tool ceiling applies and forces paging on files > ~90KB,
// but that's bounded tool round-trips, not a timeout trap.)
//
// Partition of labor:
//   runSagePortrait  → user.md (Jobs 1-3 of old dreamer-agent-production.md)
//   runSage240_40    → SESSION.md 240/40 compression (Job 4)
//
// Parallel-safe: they write to different files and never contend.
// ============================================================================

const SAGE_TIMEOUT_MS = 15 * 60 * 1000  // 15 min — bounded by Edit-tool round-trips, not full-file generation

/**
 * Pre-prune snapshot retention window. After 2026-04-30 Ralph + CD
 * incident: previous behavior was "delete snapshot on successful cut",
 * which sounded sensible but eliminated the rollback path the moment
 * the cut went wrong. Sage cuts can ostensibly succeed (model returns,
 * splice runs, file is written) and still produce data loss — that
 * incident lost ~3,000 lines from SESSION.md across 16 runs because
 * each run's snapshot was deleted before the next one could detect the
 * cumulative damage. New rule: keep every snapshot for 24h, then sweep
 * old ones at the start of the next Sage run. Rollback window > disk
 * cost. Override via SAGE_SNAPSHOT_TTL_MS env var (e.g. tests, or to
 * extend during forensic investigations).
 */
const SAGE_SNAPSHOT_TTL_MS = parseInt(
  process.env.SAGE_SNAPSHOT_TTL_MS || String(24 * 60 * 60 * 1000),
  10,
)
// Tiered pass-count thresholds. SESSION.md tends to balloon when CD does
// long stretches of edit-and-explain work without any natural pauses for
// Order 65/66 to fire. Ralph 2026-05-18 — tier table with UPPER-bound
// semantics (each value is the upper end of the band, not the lower).
// Each tier sets N = pass-count applied uniformly across block-cuts,
// compact-folds, and ledger-folds (compact + ledger are gated by
// line-span thresholds — see schedule builder in `_runSage240_40Inner`).
//
//                size      N    band
//   tier 1:    = 240 KB    1    {240}
//   tier 2:    ≤ 320 KB    2    (240, 320]
//   tier 3:    ≤ 400 KB    3    (320, 400]   ← 349.5 KB lives here
//   tier 4:    ≤ 500 KB    4    (400, 500]
//   tier 5:    ≤ 600 KB    5    (500, 600]
//   tier 5:    > 600 KB    5    (600, ∞)     (capped)
//
// SAGE_240_TRIGGER_BYTES overrides the base (240 KB). Higher tiers scale
// proportionally so tests can fire the full table from small files.
const SAGE_240_40_TRIGGER_BYTES = parseInt(
  process.env.SAGE_240_TRIGGER_BYTES || String(240 * 1024),
  10,
)
const SAGE_KB_UNIT = SAGE_240_40_TRIGGER_BYTES / 240  // 1024 at default; scales for tests

function decidePassCount(inputSize: number): number {
  if (inputSize < 240 * SAGE_KB_UNIT) return 0
  if (inputSize <= 240 * SAGE_KB_UNIT) return 1
  if (inputSize <= 320 * SAGE_KB_UNIT) return 2
  if (inputSize <= 400 * SAGE_KB_UNIT) return 3
  if (inputSize <= 500 * SAGE_KB_UNIT) return 4
  return 5  // > 500 KB (i.e. tier 5 band or above) → capped at 5
}

// Line-span gate thresholds (Ralph 2026-05-18, replacing the older
// single 300-line block-span gate). Both measured by scanning the
// whole file in document order:
//   block_span   = (last `**Block` entry line)  - (first `**Block` line)
//   compact_span = (first `**Block` entry line) - (first `**Compact` line)
// Compact pass-type queued iff block_span ≥ SAGE_BLOCK_SPAN_GATE.
// Ledger  pass-type queued iff compact_span ≥ SAGE_COMPACT_SPAN_GATE.
const SAGE_BLOCK_SPAN_GATE = parseInt(
  process.env.SAGE_BLOCK_SPAN_GATE || '240', 10,
)
const SAGE_COMPACT_SPAN_GATE = parseInt(
  process.env.SAGE_COMPACT_SPAN_GATE || '120', 10,
)

// ============================================================================
// Section bootstrap + content-aware walker (Ralph 2026-05-18)
// ============================================================================

/**
 * Ensure the three Sage sections (`## LEDGER`, `## COMPACTS`, `## BLOCKS`)
 * exist, in that order, immediately before `## USER SESSION DATA`. Missing
 * sections are inserted as empty stubs; existing sections are left in place.
 * Content already inside the file (legacy Compacts under an older
 * `## LEDGER`, legacy Blocks under `## USER SESSION DATA`) is NOT moved —
 * the walker downstream is content-aware and finds entries wherever they
 * physically sit, while new entries always land in these dedicated
 * sections.
 *
 * Returns the new SESSION.md content. No-op if all three sections already
 * exist (or if there's no USD marker to anchor against).
 */
function ensureSagesSections(sessionMd: string): string {
  const lines = sessionMd.split('\n')
  const usdIdx = lines.findIndex((l) => /^##\s+USER\s+SESSION\s+DATA/i.test(l))
  if (usdIdx < 0) return sessionMd

  const has = (re: RegExp) => lines.some((l) => re.test(l))
  let hasLedger = has(/^##\s+LEDGER\b/i)
  let hasCompacts = has(/^##\s+COMPACTS\b/i)
  let hasBlocks = has(/^##\s+BLOCKS\b/i)

  if (hasLedger && hasCompacts && hasBlocks) return sessionMd

  // Insert in reverse-order so each new section lands just above USD
  // and produces the final order: LEDGER → COMPACTS → BLOCKS → USD.
  const findIdx = (re: RegExp) => lines.findIndex((l) => re.test(l))

  if (!hasBlocks) {
    const anchor = findIdx(/^##\s+USER\s+SESSION\s+DATA/i)
    lines.splice(anchor, 0, '', '## BLOCKS', '')
    hasBlocks = true
  }
  if (!hasCompacts) {
    const anchor = findIdx(/^##\s+BLOCKS\b/i)
    lines.splice(anchor, 0, '', '## COMPACTS', '')
    hasCompacts = true
  }
  if (!hasLedger) {
    const anchor = findIdx(/^##\s+COMPACTS\b/i)
    lines.splice(anchor, 0, '', '## LEDGER', '')
    hasLedger = true
  }

  return lines.join('\n')
}

/**
 * Content-aware walker — scans the WHOLE file in document order looking
 * for `**Compact …**` and `**Block …**` opening lines, regardless of
 * which section they sit in. Returns the line indices used by the gate
 * logic in Phase 2.
 *
 *   compact_start = first line matching `^**Compact …`  (or -1)
 *   block_start   = first line matching `^**Block …`    (or -1)
 *   block_end     = last  line matching `^**Block …`    (or -1)
 *
 * Spans (used by the schedule builder):
 *   compactSpan = block_start - compact_start  (0 if either missing or
 *                                                blocks come before compacts)
 *   blockSpan   = block_end   - block_start    (0 if <2 blocks)
 *
 * Why content-aware: legacy SESSION.md files have Compacts under an old
 * `## LEDGER` heading and Blocks under `## USER SESSION DATA`. The walker
 * counts them wherever they live so the gate logic works on day-one
 * without any disk migration.
 */
function measureSagesSpans(sessionMd: string): {
  compactStart: number
  blockStart: number
  blockEnd: number
  compactSpan: number
  blockSpan: number
} {
  const lines = sessionMd.split('\n')
  const compactRe = /^\*\*Compact\s+[A-Z0-9,\-\s]+\s+[—-]\s/i
  const blockRe = /^\*\*Block\s+[A-Z]+\s+[—-]\s/i
  let compactStart = -1
  let blockStart = -1
  let blockEnd = -1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (compactStart < 0 && compactRe.test(l)) compactStart = i
    if (blockRe.test(l)) {
      if (blockStart < 0) blockStart = i
      blockEnd = i
    }
  }
  const compactSpan =
    compactStart >= 0 && blockStart > compactStart ? blockStart - compactStart : 0
  const blockSpan =
    blockStart >= 0 && blockEnd >= blockStart ? blockEnd - blockStart : 0
  return { compactStart, blockStart, blockEnd, compactSpan, blockSpan }
}

// ============================================================================
// Date formatting (Ralph 2026-05-18 — Ledger header `DD.MMM.YY HH:MM → …`)
// ============================================================================

const MONTH_ABBREV = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Format a (date, time) pair as `DD.MMM.YY HH:MM` — e.g. 2026-05-18 14:32
 * → `18.May.26 14:32`. Used in Ledger entry headers; never bold, never
 * wrapped in a title.
 */
function formatLedgerStamp(date: string, time: string): string {
  // date: 'YYYY-MM-DD'; time: 'HH:MM' or 'HH:MM:SS'
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return `${date} ${time}`
  const year = m[1].slice(2)
  const month = MONTH_ABBREV[parseInt(m[2], 10) - 1] || m[2]
  const day = m[3]
  const hhmm = time.length > 5 ? time.slice(0, 5) : time
  return `${day}.${month}.${year} ${hhmm}`
}

/**
 * Format a date range as the Ledger header. Same-day collapses the right
 * side to just `HH:MM`. Cross-day shows both dates.
 *   same-day:  `18.May.26 14:32 → 16:45`
 *   cross-day: `17.May.26 23:11 → 18.May.26 02:39`
 */
function formatLedgerRange(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string,
): string {
  const left = formatLedgerStamp(startDate, startTime)
  const sameDay = startDate === endDate
  if (sameDay) {
    const hhmm = endTime.length > 5 ? endTime.slice(0, 5) : endTime
    return `${left} → ${hhmm}`
  }
  return `${left} → ${formatLedgerStamp(endDate, endTime)}`
}

// ============================================================================
// Unified triage log (Ralph 2026-05-18 — one file per Sage run)
// ============================================================================

/**
 * Build the triage log filename: `sage-240-MM-DD-HH.mm.log`.
 * Zero-padded, 24h clock, dot between HH and mm. Year omitted.
 */
function makeTriageLogPath(logsDir: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const MM = pad(now.getMonth() + 1)
  const DD = pad(now.getDate())
  const HH = pad(now.getHours())
  const mm = pad(now.getMinutes())
  return path.join(logsDir, `sage-240-${MM}-${DD}-${HH}.${mm}.log`)
}

/**
 * Sweep `SESSION.md.pre-prune-*` snapshots older than SAGE_SNAPSHOT_TTL_MS
 * from a session's directory. Called once at the start of each Sage 240/40
 * run (right before the new snapshot is written). Best-effort: failures
 * are logged but never throw — Sage's main job continues regardless.
 *
 * The expected snapshot filename shape is:
 *   `<SESSION.md path>.pre-prune-<14-digit-stamp>`
 * where the stamp is the first 14 characters of an ISO timestamp with
 * `[-:TZ.]` stripped (e.g. `20260430011313` for `2026-04-30T01:13:13.000Z`).
 * We use the file's actual mtime for age comparison rather than parsing
 * the stamp — the mtime is what disk operations care about and is
 * cheaper to read.
 */
async function sweepOldSnapshots(sessionMdPath: string): Promise<{ swept: string[]; kept: string[] }> {
  const swept: string[] = []
  const kept: string[] = []
  try {
    const { readdir, stat: fsStat } = await import('fs/promises')
    const dir = path.dirname(sessionMdPath)
    const baseName = path.basename(sessionMdPath)
    const prefix = `${baseName}.pre-prune-`
    const entries = await readdir(dir).catch(() => [] as string[])
    const now = Date.now()
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue
      const full = path.join(dir, entry)
      let mtimeMs = 0
      try {
        const st = await fsStat(full)
        mtimeMs = st.mtimeMs
      } catch {
        continue // can't stat → leave alone, safer than an aggressive delete
      }
      const ageMs = now - mtimeMs
      if (ageMs > SAGE_SNAPSHOT_TTL_MS) {
        try {
          await unlink(full)
          swept.push(entry)
        } catch (err) {
          console.warn(`[sage-240-40] failed to sweep stale snapshot ${entry}: ${err}`)
        }
      } else {
        kept.push(entry)
      }
    }
  } catch (err) {
    console.warn(`[sage-240-40] sweepOldSnapshots failed (ignored): ${err}`)
  }
  return { swept, kept }
}

export interface Sage240_40Stats {
  sessionMdSize: number
  sessionMdSizeAfter: number
  bytesCut: number
  triggered: boolean   // did SESSION.md exceed 240 kb?
  snapshotPath: string | null
  dreamTimestamp: string
  triageLog: string
}

export interface Sage240_40Result {
  stats: Sage240_40Stats
}

// ─── Runner: Sage-Portrait ──────────────────────────────────────────────────

/**
 * Paint/refine user.md via the Edit tool.
 *
 * Flow:
 *   1. Ensure user.md exists (create with initial template if missing or empty).
 *      Agent has Edit only, not Write — the file must exist for Edit to work.
 *   2. Load agents/sage-portrait.md as the system prompt.
 *   3. Call claude with Read + Edit tools. Model reads SESSION.md + user.md
 *      via Read, edits user.md via Edit, returns a triage log.
 *   4. Read user.md back to detect whether it was actually updated.
 *   5. Write the dream log (triage receipt) to logs/.last-dream-log.md.
 *
 * Result shape matches runDreamerOrder66 (`{ stats: DreamerStats }`) so
 * order65/order66 consumers don't need to change.
 */
export async function runSagePortrait(
  sessionId: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<DreamerResult> {
  const emit = onProgress || (() => {})
  const logsDir = getLogsDir(sessionId)
  await mkdir(logsDir, { recursive: true })

  const sessionMdPath = getSessionMdPath(sessionId)
  const userMemoryPath = getUserMemoryPath(sessionId)
  const dreamLogPath = getDreamLogPath(sessionId)
  const cwd = path.resolve(process.cwd())

  const dreamTimestamp = new Date().toISOString()
  emit({ agent: 'sage', phase: 'started', detail: 'portrait variant' })

  // Read sizes for the runner's own log (model reads the files itself).
  const sessionMd = await readFile(sessionMdPath, 'utf-8').catch(() => '')
  const userMemoryBefore = await readFile(userMemoryPath, 'utf-8').catch(() => '')

  if (!sessionMd.trim()) {
    emit({ agent: 'sage', phase: 'skipped', detail: 'SESSION.md empty' })
    await writeFile(
      dreamLogPath,
      `# Sage Portrait — ${dreamTimestamp}\n## SESSION.md Size: 0 bytes\nSESSION.md empty. Nothing to paint.\n`,
      'utf-8',
    )
    return {
      stats: {
        sessionMdSize: 0,
        userMemoryUpdated: false,
        dreamTimestamp,
        triageLog: 'SESSION.md empty. Nothing to paint.',
      },
    }
  }

  // Ensure user.md exists. Agent has only Edit (no Write), so we write the
  // template here if the file is missing or empty.
  if (!userMemoryBefore.trim()) {
    const template =
      `# User Memory\n_Last updated: ${dreamTimestamp} by Padawan Sage_\n\n` +
      `## Taste Profile\n(no signals yet)\n\n` +
      `## Quality Bar\n(no signals yet)\n\n` +
      `## Communication Patterns\n(no signals yet)\n\n` +
      `## Working Context\n(no signals yet)\n`
    await writeFile(userMemoryPath, template, 'utf-8')
    console.log(`[sage-portrait] wrote initial user.md template: ${userMemoryPath}`)
  }

  // Ralph 2026-04-25 architectural rewrite (same reason as Sage-240/40):
  // Agent paged the entire SESSION.md via Read+Edit and timed out at 15 min.
  // New design: JS extracts the UNCOMPACTED TISSUE (everything past the
  // `## USER SESSION DATA` marker — the same region Sage-240/40 would
  // compress) and passes that as the signal. Anything older has already
  // been folded into LEDGER blocks above the marker; the painter doesn't
  // need to re-read those.
  //
  // Self-heal: legacy sessions have no USD marker. Insert one before the
  // first `#### User | …` turn so subsequent runs (and Sage-240) have the
  // anchor they need. If there are no User turns either, fall back to the
  // whole file.
  let workingSessionMd = sessionMd
  const heal = ensureUserSessionDataMarker(sessionMd)
  if (heal.changed && heal.content) {
    workingSessionMd = heal.content
    await writeFile(sessionMdPath, workingSessionMd, 'utf-8')
    console.log(`[sage-portrait] self-healed: inserted ## USER SESSION DATA marker`)
  }
  const lines = workingSessionMd.split('\n')
  const usdIdx = lines.findIndex((l) => /^##\s+USER\s+SESSION\s+DATA/i.test(l))
  const rawTail =
    usdIdx >= 0
      ? lines.slice(usdIdx).join('\n')
      : workingSessionMd

  // Ralph 2026-04-25 noise filter: strip out connection/restart artifacts
  // before sending to the model. "I'm back." is a bridge-reconnect greeting
  // (the dev server restarts and Ralph re-connects), NOT a behavioral
  // pattern. Same for `## SESSION RESTORED — …` markers, `Executing boot
  // protocol:` sequences, and 🔄 swap notifications. Without filtering,
  // the agent invents personas like "He treats returning as a ritual" from
  // what is really `npm run dev` cycling.
  const recentSignal = rawTail
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (/^I'?m back\.?$/i.test(t)) return false
      if (/^Executing boot protocol:?$/i.test(t)) return false
      if (/^##\s*SESSION RESTORED/i.test(t)) return false
      if (/^🔄\s*Swapped\b/i.test(t)) return false
      if (/^\[BRIDGE\]/.test(t)) return false
      return true
    })
    .join('\n')

  emit({
    agent: 'sage',
    phase: 'reading',
    detail: `${(sessionMd.length / 1024).toFixed(1)}KB session, ${
      userMemoryBefore ? (userMemoryBefore.length / 1024).toFixed(1) + 'KB portrait' : 'new portrait'
    } — feeding ${(recentSignal.length / 1024).toFixed(0)}KB uncompacted tissue ${usdIdx >= 0 ? `(from line ${usdIdx + 1})` : '(no USD marker — full file)'}`,
  })

  // Agent file goes as SYSTEM PROMPT (sets identity + rules), task + signal
  // as USER MESSAGE. Without separating these, the model treated the
  // SESSION.md tail as the user's creative input and continued image
  // prompts instead of distilling user signals.
  const agentFile = loadSagePortrait()
  const mode = userMemoryBefore.trim()
    ? 'SUBSEQUENT PASS (portrait exists, refine conservatively — preserve existing observations unless directly contradicted by new signal)'
    : 'FIRST PASS (portrait has only the initial template — paint the full person from the signal below)'

  const userMessage =
    `## TASK\n\n` +
    `Refresh the user portrait based on recent session activity. Read the CURRENT user.md and the RECENT SIGNAL below; produce the complete updated user.md.\n\n` +
    `**Mode:** ${mode}\n\n` +
    `## CURRENT user.md\n\n` +
    '```markdown\n' +
    userMemoryBefore +
    '\n```\n\n' +
    `## RECENT SESSION SIGNAL (tail of SESSION.md)\n\n` +
    '```markdown\n' +
    recentSignal +
    '\n```\n\n' +
    `## OUTPUT — STRICTLY THIS FORMAT\n\n` +
    `First: the COMPLETE new user.md wrapped in a single fenced markdown block.\n` +
    `Then: a \`### TRIAGE_LOG\` section listing what was added / refined / preserved.\n` +
    `No preamble, no other text.\n\n` +
    `\`\`\`markdown\n# User Memory\n_Last updated: ${dreamTimestamp} by Padawan Sage_\n\n## Taste Profile\n... your refined content ...\n... (rest of file) ...\n\`\`\`\n\n` +
    `### TRIAGE_LOG\n- Added: …\n- Refined: …\n- Unchanged (preserved): …\n`

  emit({ agent: 'sage', phase: 'compacting', detail: 'Painting portrait...' })
  // Per-run debug log so a failed Portrait call leaves a trail in logs/.
  // Filename-safe ISO (colons → dashes) keeps fs happy on every platform.
  const portraitDebugLog = path.join(
    logsDir,
    `_debug-sage-portrait-${dreamTimestamp.replace(/[:.]/g, '-')}.log`,
  )
  const response = await callAnthropic(
    DREAMER_MODEL,
    userMessage,
    agentFile,
    portraitDebugLog,
    // Live-forward each stream-json event to the overlay as a ProgressEvent.
    // Phase 'stream' tells CompactionOverlay this is a live agent activity
    // line, not a state transition — it accumulates them in a scrolling feed.
    (evt) => emit({ agent: 'sage', phase: 'stream', stage: evt.type, detail: evt.detail }),
    signal,
  )

  if (!response) {
    console.error('[sage-portrait] Agent call returned null — skipping cycle')
    emit({ agent: 'sage', phase: 'failed', detail: 'Agent call failed' })
    await writeFile(
      dreamLogPath,
      `# Sage Portrait — ${dreamTimestamp}\n## SESSION.md Size: ${sessionMd.length} bytes\n## ERROR: Agent call failed.\n`,
      'utf-8',
    )
    return {
      stats: {
        sessionMdSize: sessionMd.length,
        userMemoryUpdated: false,
        dreamTimestamp,
        triageLog: 'ERROR: Agent call failed.',
      },
    }
  }

  // Parse the agent's response. The contract is strict: ONE fenced
  // markdown block holds the new user.md, then a `### TRIAGE_LOG`.
  //
  // Defensive parser (Ralph 2026-04-25): the agent file used to advertise
  // Read+Edit tools, and on legacy sessions the model would hallucinate
  // tool-call XML (`<tool_call>{"name":"Edit",...}</tool_call>` /
  // `<tool_response>...</tool_response>`) in plain text. Without filtering,
  // those got pasted into user.md verbatim, ruining the portrait. The
  // current agent file forbids tool-call XML, but we still REJECT any
  // candidate that contains it, as belt-and-braces.
  //
  // Strategy (most-specific to least):
  //   1. ALL fenced blocks → pick the LARGEST that (a) is substantial (≥
  //      1KB), (b) contains an H1/H2, (c) has NO tool-protocol XML.
  //   2. Otherwise look for `# User Memory` anywhere; take to TRIAGE_LOG
  //      or end. Reject if it contains tool-protocol XML.
  //   3. Otherwise fail loud, leave user.md untouched.

  const TOOL_XML_RE = /<\/?(?:tool_call|tool_use|tool_response|tool_replace|invoke|antml:invoke|antml:function_calls|antml:parameter)\b/i

  let newUserMd: string | null = null

  const allFences = [...response.matchAll(/```(?:markdown|md)?\s*\n([\s\S]+?)\n```/g)]
  const candidates = allFences
    .map((m) => m[1])
    .filter((b) => b.length >= 1000)
    .filter((b) => /(^|\n)#{1,2}\s/.test(b))
    .filter((b) => !TOOL_XML_RE.test(b))   // ← reject tool-protocol pollution
    .sort((a, b) => b.length - a.length)
  if (candidates.length > 0) {
    newUserMd = candidates[0].trim()
  } else {
    // Anchor search — same defensive filter.
    const anchorIdx = response.search(/(^|\n)#\s+User\s+Memory/i)
    if (anchorIdx >= 0) {
      const trailing = response.slice(anchorIdx)
      const triageIdx = trailing.search(/\n###\s+TRIAGE_LOG/i)
      const candidate = (triageIdx > 0 ? trailing.slice(0, triageIdx) : trailing).trim()
      if (!TOOL_XML_RE.test(candidate)) {
        newUserMd = candidate
      } else {
        // Try truncating at the first tool-XML occurrence — sometimes the
        // agent writes a clean header + sections then starts hallucinating.
        const xmlIdx = candidate.search(TOOL_XML_RE)
        const truncated = candidate.slice(0, xmlIdx).trim()
        if (truncated.length >= 400 && /\n##\s/.test(truncated)) {
          newUserMd = truncated
          console.warn(
            `[sage-portrait] response contained tool-XML — truncated at first occurrence (kept ${truncated.length} bytes, dropped ${candidate.length - truncated.length})`,
          )
        }
      }
    }
  }

  if (!newUserMd) {
    console.error('[sage-portrait] Could not extract clean user.md from response')
    console.error('[sage-portrait] Response had tool XML:', TOOL_XML_RE.test(response))
    console.error('[sage-portrait] Full response (first 800 chars):\n', response.slice(0, 800))
    emit({ agent: 'sage', phase: 'failed', detail: 'Could not parse new user.md from response' })
    await writeFile(
      dreamLogPath,
      `# Sage Portrait — ${dreamTimestamp}\n## ERROR: Response parse failed (tool-XML pollution or no anchor).\n\n## Raw Response (first 1500 chars)\n${response.slice(0, 1500)}\n`,
      'utf-8',
    )
    return {
      stats: {
        sessionMdSize: sessionMd.length,
        userMemoryUpdated: false,
        dreamTimestamp,
        triageLog: 'ERROR: Response parse failed (tool-XML pollution or no anchor).',
      },
    }
  }

  // Ensure header is present
  if (!/^#\s+User\s+Memory/i.test(newUserMd)) {
    newUserMd =
      `# User Memory\n_Last updated: ${dreamTimestamp} by Padawan Sage_\n\n` +
      newUserMd
  }

  // Sanity check: the content must contain at least one H2 section
  const hasH2 = /\n##\s/.test(newUserMd) || /^##\s/m.test(newUserMd)
  if (!hasH2 || newUserMd.length < 400) {
    console.error('[sage-portrait] Parsed content too thin (no H2 sections or < 400 bytes) — skipping write')
    emit({ agent: 'sage', phase: 'failed', detail: 'Parsed content too thin to be a portrait' })
    await writeFile(
      dreamLogPath,
      `# Sage Portrait — ${dreamTimestamp}\n## ERROR: Parsed content too thin.\n\n## Raw Response (first 1500 chars)\n${response.slice(0, 1500)}\n`,
      'utf-8',
    )
    return {
      stats: {
        sessionMdSize: sessionMd.length,
        userMemoryUpdated: false,
        dreamTimestamp,
        triageLog: 'ERROR: Parsed content too thin.',
      },
    }
  }

  // Ensure trailing newline
  if (!newUserMd.endsWith('\n')) newUserMd += '\n'

  await writeFile(userMemoryPath, newUserMd, 'utf-8')
  const userMemoryAfter = newUserMd
  const userMemoryUpdated = userMemoryAfter !== userMemoryBefore

  // Triage log is the entire agent response (just the ### TRIAGE_LOG block).
  const triageLog = parseSagePortraitTriageLog(response)

  emit({
    agent: 'sage',
    phase: 'writing',
    detail: userMemoryUpdated ? 'user.md updated' : 'user.md unchanged',
  })
  await writeFile(
    dreamLogPath,
    `# Sage Portrait — ${dreamTimestamp}\n` +
      `## SESSION.md Size: ${sessionMd.length} bytes\n` +
      `## User Memory Updated: ${userMemoryUpdated}\n\n` +
      `## Triage Log\n${triageLog}\n`,
    'utf-8',
  )

  console.log(
    `[sage-portrait] Cycle complete — session=${sessionMd.length}b, userMd=${userMemoryUpdated ? 'updated' : 'unchanged'}`,
  )
  emit({
    agent: 'sage',
    phase: 'completed',
    detail: userMemoryUpdated ? 'Portrait updated' : 'No changes needed',
  })

  return {
    stats: {
      sessionMdSize: sessionMd.length,
      userMemoryUpdated,
      dreamTimestamp,
      triageLog,
    },
  }
}

// ─── Runner: Sage-240/40 ────────────────────────────────────────────────────

/**
 * Compress SESSION.md via the Edit tool when it exceeds 240 kb.
 *
 * Flow:
 *   1. Check SESSION.md size. Under 240 kb → log skip and exit (fast path,
 *      ~30s total because the runner short-circuits without calling the model).
 *   2. Write a `.pre-prune-{TS}` snapshot before any cut (safety rail).
 *   3. Load agents/sage-240-40.md as the system prompt.
 *   4. Call claude with Read + Edit tools. Model reads SESSION.md via Read,
 *      makes targeted Edits to fold two ~20 kb blocks, returns a triage log.
 *   5. Read SESSION.md back to compute bytesCut.
 *   6. Write the compression log to logs/.last-sage-240-40-log.md.
 *
 * Parallel-safe with runSagePortrait — they write different files.
 * NOT parallel-safe with runLumberjack on >240KB files — both write SESSION.md.
 * order65/order66 should serialize 240/40 → Lumberjack (not run them in parallel).
 */
export async function runSage240_40(
  sessionId: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<Sage240_40Result> {
  // 2026-04-29: pauseLumberjack/resumeLumberjack wrapper removed — the
  // bracket logged misleadingly around only 240/40, making Order 66 look
  // sequential when both sages were genuinely in Promise.all parallel. The
  // legacy lumberjack 10-min cron was scrapped on 2026-04-21; the flag was
  // a leftover with no real consumer that mattered. Direct call from here.
  return await _runSage240_40Inner(sessionId, onProgress, signal)
}

/**
 * Trace logger for Sage 240/40 — ALWAYS ON, full observability.
 *
 * 2026-05-03 (Ralph): every Order-66 / Sage-240 run writes a structured
 * decision trace to `public/{session}/logs/_debug-sage-240-trace-{stamp}.log`.
 * No env flag. No opt-in. Hit Order 66, get the file. Inspect every decision.
 *
 * Output format: tab-separated structured lines:
 *
 *   <iso-timestamp>\t<phase>\t<event>\t<json-payload>
 *
 * Easy to grep, easy to read, easy to replay.
 */
type SageTrace = (event: string, payload?: Record<string, unknown>) => void

async function _runSage240_40Inner(
  sessionId: string,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<Sage240_40Result> {
  const emit = onProgress || (() => {})
  const logsDir = getLogsDir(sessionId)
  await mkdir(logsDir, { recursive: true })

  const sessionMdPath = getSessionMdPath(sessionId)

  const dreamTimestamp = new Date().toISOString()

  // ── Unified triage log (Ralph 2026-05-18) ────────────────────────────────
  // ONE log file per Sage run, name `sage-240-MM-DD-HH.mm.log`. All phases
  // append to it (replaces the older `.last-sage-240-40-log.md` summary and
  // every per-pass `_debug-sage-240-40-{stage}-{stamp}.log` audit file).
  // Created here with a header; helper `appendLog()` is used everywhere
  // downstream.
  const triageLogPath = makeTriageLogPath(logsDir)
  const { appendFile: appendFileAsync } = await import('fs/promises')
  await writeFile(
    triageLogPath,
    `# Sage 240/40 — ${dreamTimestamp}\n` +
      `# sessionId: ${sessionId}\n` +
      `# sessionMdPath: ${sessionMdPath}\n\n`,
    'utf-8',
  ).catch(() => {})
  const appendLog = async (text: string) => {
    try { await appendFileAsync(triageLogPath, text.endsWith('\n') ? text : text + '\n', 'utf-8') }
    catch {}
  }

  // ── Trace-to-disk: TURNED OFF (Ralph 2026-05-03) ─────────────────────────
  // The decision-trace file (`_debug-sage-240-trace-{stamp}.log`) was useful
  // for debugging the SESSION RESTORED / live-tissue trap. Now that the
  // algorithm is fixed and live, the file just churns disk on every run.
  // Flip SAGE_TRACE_TO_DISK to true to re-enable; trace() call sites are
  // untouched so this is a one-flag toggle.
  //
  // ⚠️  DO NOT touch the `emit(...)` calls anywhere in this file — those
  // are the LIVE FEED to the CompactionOverlay overlay (progress bar +
  // per-event stream pane). They go through the SSE pipe to the browser.
  // The trace and the emit are separate channels.
  const SAGE_TRACE_TO_DISK = false
  const traceStamp = dreamTimestamp.replace(/[-:TZ.]/g, '').slice(0, 14)
  const traceFile = path.join(logsDir, `_debug-sage-240-trace-${traceStamp}.log`)
  const traceLines: string[] = []
  const trace: SageTrace = SAGE_TRACE_TO_DISK
    ? (event, payload) => {
        traceLines.push(
          `${new Date().toISOString()}\trun\t${event}\t${payload ? JSON.stringify(payload) : ''}`,
        )
      }
    : () => {} // no-op when trace-to-disk is OFF
  /**
   * Flush trace to disk. No-op when SAGE_TRACE_TO_DISK is false.
   */
  const flushTrace = async () => {
    if (!SAGE_TRACE_TO_DISK) return
    if (traceLines.length === 0) return
    await writeFile(traceFile, traceLines.join('\n') + '\n', 'utf-8').catch(() => {})
  }

  trace('boot', { sessionId, sessionMdPath, dreamTimestamp, traceFile })
  // 2026-04-21: Sage-240/40 emits as 'lumberjack' because it took the
  // Lumberjack slot in order65/66 when the Lumberjack bridge was scrapped.
  // The overlay has two fixed bars ('lumberjack' + 'sage'); Portrait keeps
  // 'sage', 240/40 claims 'lumberjack'. Don't rename — the UI routes by name.
  emit({ agent: 'lumberjack', phase: 'started', detail: '240/40 variant' })

  // Read SESSION.md for the trigger check. The model will also Read it.
  const sessionMd = await readFile(sessionMdPath, 'utf-8').catch(() => '')
  const inputSize = sessionMd.length
  trace('file-read', { bytes: inputSize, lines: sessionMd.split('\n').length })

  if (!sessionMd.trim()) {
    trace('skip-empty-file', {})
    await flushTrace()
    emit({ agent: 'lumberjack', phase: 'skipped', detail: 'SESSION.md empty' })
    await appendLog(`## Result\nSESSION.md empty — nothing to compress.\n`)
    return {
      stats: {
        sessionMdSize: 0,
        sessionMdSizeAfter: 0,
        bytesCut: 0,
        triggered: false,
        snapshotPath: null,
        dreamTimestamp,
        triageLog: 'SessionMD empty. Nothing to compress.',
      },
    }
  }

  // ── Trigger check — fast path ────────────────────────────────────────────
  // Short-circuit BEFORE calling the model. Saves a token-expensive call for
  // the common no-op case (and fixes the "sage sits idle for many minutes
  // then says nothing to do" symptom — the runner now answers that in <1s).
  if (inputSize < SAGE_240_40_TRIGGER_BYTES) {
    trace('skip-under-trigger', { inputSize, trigger: SAGE_240_40_TRIGGER_BYTES })
    await flushTrace()
    emit({
      agent: 'lumberjack',
      phase: 'skipped',
      detail: `under trigger (${(inputSize / 1024).toFixed(1)}KB < 240KB)`,
    })
    const skipLog = `[240/40-SKIP] under trigger — file at ${inputSize} bytes (${(inputSize / 1024).toFixed(1)}KB), threshold ${SAGE_240_40_TRIGGER_BYTES} bytes (240KB)`
    await appendLog(
      `## Phase 0 · Trigger Check\n` +
        `inputSize: ${inputSize} bytes (${(inputSize / 1024).toFixed(1)} KB)\n` +
        `trigger:   ${SAGE_240_40_TRIGGER_BYTES} bytes (240 KB)\n` +
        `result:    UNDER TRIGGER — skipped\n\n` +
        `${skipLog}\n`,
    )
    return {
      stats: {
        sessionMdSize: inputSize,
        sessionMdSizeAfter: inputSize,
        bytesCut: 0,
        triggered: false,
        snapshotPath: null,
        dreamTimestamp,
        triageLog: skipLog,
      },
    }
  }

  emit({
    agent: 'lumberjack',
    phase: 'reading',
    detail: `${(inputSize / 1024).toFixed(1)}KB (≥ 240KB trigger) — compressing`,
  })

  // ── Safety rail — snapshot BEFORE cut ────────────────────────────────────
  // 2026-04-30 (Ralph + CD): sweep snapshots older than SAGE_SNAPSHOT_TTL_MS
  // (default 24h). Old policy was "delete snapshot on cut success", which
  // erased the rollback path the moment a cut went wrong. The 16-Sage-run
  // incident lost ~3,000 lines and we had only one snapshot left because
  // every other had been auto-deleted. New policy: keep all snapshots from
  // the last 24h, sweep older. Disk is cheap; rollback is priceless.
  const sweepResult = await sweepOldSnapshots(sessionMdPath)
  if (sweepResult.swept.length > 0 || sweepResult.kept.length > 0) {
    console.log(
      `[sage-240-40] snapshot sweep — swept ${sweepResult.swept.length} (>${(SAGE_SNAPSHOT_TTL_MS / 3600_000).toFixed(0)}h old), kept ${sweepResult.kept.length}`,
    )
  }

  const snapshotStamp = dreamTimestamp.replace(/[-:TZ.]/g, '').slice(0, 14)
  const snapshotPath = sessionMdPath + `.pre-prune-${snapshotStamp}`
  await writeFile(snapshotPath, sessionMd, 'utf-8')
  console.log(`[sage-240-40] snapshot written: ${snapshotPath}`)
  trace('snapshot-written', { path: snapshotPath, bytes: sessionMd.length })

  // ── Self-heal: insert `## USER SESSION DATA` marker on legacy sessions ───
  // Old sessions (created before Ralph 2026-04-25 architecture) have no USD
  // marker — Sage-240 was bailing instantly with `kind: 'no-tissue'` on a
  // 371KB file. Insert the marker before the first User turn so the rest
  // of the pipeline has something to anchor to.
  let workingSessionMd = sessionMd
  const heal = ensureUserSessionDataMarker(sessionMd)
  trace('heal-attempt', { changed: heal.changed, hasContent: !!heal.content })
  if (heal.changed && heal.content) {
    workingSessionMd = heal.content
    await writeFile(sessionMdPath, workingSessionMd, 'utf-8')
    console.log(`[sage-240-40] self-healed: inserted ## USER SESSION DATA marker`)
    trace('heal-applied', { newBytes: workingSessionMd.length })
    emit({
      agent: 'lumberjack',
      phase: 'reading',
      detail: 'inserted missing ## USER SESSION DATA marker (legacy session)',
    })
  } else if (!heal.content) {
    // No User turns at all — nothing to compress, refuse cleanly.
    console.warn(`[sage-240-40] no User turns in file — nothing to compress`)
    trace('skip-no-user-turns', {})
    await flushTrace()
    emit({ agent: 'lumberjack', phase: 'skipped', detail: 'no User turns to compress' })
    await appendLog(
      `## Phase 0 · Self-heal\n` +
        `no \`#### User | …\` turns found anywhere — cannot self-heal, refusing cut.\n\n` +
        `[240/40-SKIP] no User turns found — nothing to compress\n`,
    )
    return {
      stats: {
        sessionMdSize: inputSize,
        sessionMdSizeAfter: inputSize,
        bytesCut: 0,
        triggered: true,
        snapshotPath,
        dreamTimestamp,
        triageLog: '[240/40-SKIP] no User turns found — nothing to compress',
      },
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Ralph 2026-04-25 architectural rewrite:
  //
  // The previous design gave the agent the file path and Read+Edit tools and
  // told it to "compute protected zones, find the cut, write a block, edit
  // in place." The agent paged the entire 308KB file 200 lines at a time
  // (15+ Read calls + thinking turns each), blowing the 15-min timeout
  // every time. exit=143 killed=true.
  //
  // New design: JS does ALL mechanical work (find marker, find user-turn,
  // pick chunk, find Block letter, splice file). The agent's job collapses
  // to "compress this 200-line dialogue chunk into a Block entry narrative"
  // — pure text-in / text-out via callAnthropic (no tools). 30-60 seconds.
  //
  // The agent file is still used as system context so the BLOCK ENTRY SHAPE,
  // narrative voice, and Padawan Code stay consistent — but the agent
  // doesn't have to discover anything about the file itself.
  // ──────────────────────────────────────────────────────────────────────────

  // ── Ensure the three Sage sections exist (Ralph 2026-05-18) ─────────────
  // `## LEDGER` / `## COMPACTS` / `## BLOCKS` must be present before the
  // schedule fires so new entries always have a home. Legacy entries that
  // currently live in older locations stay put — the walker downstream is
  // content-aware and finds them wherever they physically sit.
  const sectionedMd = ensureSagesSections(workingSessionMd)
  if (sectionedMd !== workingSessionMd) {
    workingSessionMd = sectionedMd
    await writeFile(sessionMdPath, workingSessionMd, 'utf-8')
    console.log(`[sage-240-40] inserted missing ## LEDGER / ## COMPACTS / ## BLOCKS sections`)
    await appendLog(`## Phase 0 · Section Bootstrap\ninserted missing Sage sections (LEDGER / COMPACTS / BLOCKS) before USD\n`)
  }

  // ── Phase 1 · MEASURE ─────────────────────────────────────────────────────
  // Content-aware walker scans the WHOLE file for `**Compact …**` and
  // `**Block …**` openings. compact_span / block_span are the gates that
  // decide whether the compact and ledger pass-types are queued.
  const spans = measureSagesSpans(workingSessionMd)
  const passCount = decidePassCount(inputSize)
  const compactGateMet = spans.blockSpan >= SAGE_BLOCK_SPAN_GATE
  const ledgerGateMet = spans.compactSpan >= SAGE_COMPACT_SPAN_GATE
  trace('schedule.measure', { ...spans, passCount, compactGateMet, ledgerGateMet, inputSize })
  await appendLog(
    `## Phase 1 · Measure\n` +
      `inputSize:      ${inputSize} bytes (${(inputSize / 1024).toFixed(1)} KB)\n` +
      `compact_start:  line ${spans.compactStart}\n` +
      `block_start:    line ${spans.blockStart}\n` +
      `block_end:      line ${spans.blockEnd}\n` +
      `compact_span:   ${spans.compactSpan} (gate ≥ ${SAGE_COMPACT_SPAN_GATE})\n` +
      `block_span:     ${spans.blockSpan} (gate ≥ ${SAGE_BLOCK_SPAN_GATE})\n` +
      `pass-count N:   ${passCount}\n`,
  )

  // ── Phase 2 · SCHEDULE ────────────────────────────────────────────────────
  // Fixed up-front, no re-evaluation. Three pass-types stacked back-to-back:
  //   N cuts  (always, if N>0)
  //   N compacts  (only if block_span gate met)
  //   N ledgers   (only if compact_span gate met)
  // No early-break across types: a cut running out of tissue does NOT skip
  // compacts/ledgers; a compact running out of blocks does NOT skip ledgers.
  // Each pass-type drains its own material independently.
  type PassKind = 'cut' | 'compact' | 'ledger'
  const schedule: PassKind[] = []
  for (let i = 0; i < passCount; i++) schedule.push('cut')
  if (compactGateMet) for (let i = 0; i < passCount; i++) schedule.push('compact')
  if (ledgerGateMet) for (let i = 0; i < passCount; i++) schedule.push('ledger')
  trace('schedule.built', { schedule })
  await appendLog(
    `## Phase 2 · Schedule\n` +
      `[${schedule.join(', ')}]\n` +
      `cuts queued:    ${passCount}\n` +
      `compacts queued:${compactGateMet ? passCount : 0}${compactGateMet ? '' : ' (gate not met)'}\n` +
      `ledgers queued: ${ledgerGateMet ? passCount : 0}${ledgerGateMet ? '' : ' (gate not met)'}\n`,
  )
  emit({
    agent: 'lumberjack',
    phase: 'compacting',
    detail: `Schedule: ${schedule.length} pass${schedule.length === 1 ? '' : 'es'} (${schedule.join(' → ')}) — input ${(inputSize / 1024).toFixed(1)}KB`,
  })
  const streamFwd = (evt: { type: string; detail: string }) =>
    emit({ agent: 'lumberjack', phase: 'stream', stage: evt.type, detail: evt.detail })

  let triageLog = ''

  // ── Phase 3 · EXECUTE ────────────────────────────────────────────────────
  // No early-break across pass types. Each pass attempts independently.
  for (let i = 0; i < schedule.length; i++) {
    // Abort check (Ralph 2026-05-13). Client disconnected (Order 66 Continue)
    // → don't start another pass. Each pass spawns a fresh child and
    // overwrites SESSION.md; starting a new one after abort is exactly the
    // stale-overwrite that butchered the file. The in-flight pass already got
    // SIGTERM'd via the signal threaded into callAnthropic and returned
    // agent-fail (no write).
    if (signal?.aborted) {
      trace('aborted-mid-schedule', { atPass: i + 1, total: schedule.length })
      await appendLog(`\n## ABORTED — client disconnected before pass ${i + 1}/${schedule.length}\n`)
      break
    }
    const passNum = i + 1
    const kind: PassKind = schedule[i]

    // Re-read working content before every pass so we pick chunks /
    // Blocks / Compacts against the freshest disk state (each pass mutates
    // SESSION.md in place).
    const currentMd = await readFile(sessionMdPath, 'utf-8').catch(() => workingSessionMd)
    const passStartProgress = 25 + ((passNum - 1) / schedule.length) * 60
    emit({
      agent: 'lumberjack',
      phase: 'compacting',
      detail: `Pass ${passNum}/${schedule.length}: ${kind === 'cut' ? 'Block cut' : kind === 'compact' ? 'Compact fold' : 'Ledger fold'}…`,
      progress: passStartProgress,
    })

    trace(`pass-${passNum}-start`, { kind, passNum, total: schedule.length, currentBytes: currentMd.length })
    await appendLog(`\n## Phase 3 · Pass ${passNum}/${schedule.length} · ${kind}\n`)

    let result: SageCutResult | SageCompactResult | SageLedgerResult
    if (kind === 'cut') {
      result = await performOneSageCut(sessionMdPath, currentMd, logsDir, `cut${passNum}`, streamFwd, trace, triageLogPath, signal)
    } else if (kind === 'compact') {
      result = await performOneSageCompact(sessionMdPath, currentMd, logsDir, `compact${passNum}`, streamFwd, trace, triageLogPath, signal)
    } else {
      result = await performOneSageLedger(sessionMdPath, currentMd, logsDir, `ledger${passNum}`, streamFwd, trace, triageLogPath, signal)
    }
    trace(`pass-${passNum}-result`, { kind: result.kind, passKind: kind })

    if (result.kind === 'ok') {
      let logLine = ''
      if (kind === 'cut') {
        const r = result as Extract<SageCutResult, { kind: 'ok' }>
        logLine = `[240/40-CUT] Block ${r.blockLetter} — ${r.title} (${r.timeRange}), tissue lines ${r.startLine}–${r.endLine} deleted (~${(r.bytesCut / 1024).toFixed(1)}KB)`
      } else if (kind === 'compact') {
        const r = result as Extract<SageCompactResult, { kind: 'ok' }>
        logLine = `[240/40-COMPACT] Compact ${r.compactLabel} — ${r.title} (${r.timeRange}), folded Blocks ${r.foldedLetters.join(', ')} (~${(r.bytesCut / 1024).toFixed(1)}KB saved)`
      } else {
        const r = result as Extract<SageLedgerResult, { kind: 'ok' }>
        logLine = `[240/40-LEDGER] Ledger entry (${r.timeRange}), folded ${r.foldedCount} Compacts (~${(r.bytesCut / 1024).toFixed(1)}KB saved)`
      }
      triageLog += (triageLog ? '\n' : '') + logLine
      await appendLog(`result: OK\n${logLine}\n`)

      const progress = 25 + (passNum / schedule.length) * 60
      trace(`pass-${passNum}-progress`, { progress, passNum, total: schedule.length })
      emit({
        agent: 'lumberjack',
        phase: 'compacting',
        detail: `Pass ${passNum}/${schedule.length} done (${kind})`,
        progress,
      })
    } else if (result.kind === 'no-tissue') {
      const reason =
        kind === 'cut'    ? 'no eligible tissue past USER SESSION DATA marker' :
        kind === 'compact'? 'fewer than 3 Blocks available to fold' :
                            'fewer than 3 Compacts available to fold'
      const logLine = `[240/40-SKIP] pass ${passNum} (${kind}): ${reason}`
      triageLog += (triageLog ? '\n' : '') + logLine
      trace(`pass-${passNum}-no-tissue-continue`, { reason, kind })
      await appendLog(`result: NO-TISSUE\n${logLine}\n(continuing — does not block other pass types)\n`)
      emit({ agent: 'lumberjack', phase: 'skipped', detail: `Pass ${passNum} (${kind}) skipped: ${reason}` })
      // CONTINUE — do not break. Other pass types may still have material.
    } else {
      // agent-fail — log it, continue (other pass types may still succeed).
      const logLine = `[240/40-ERROR] pass ${passNum} (${kind}): agent call failed`
      triageLog += (triageLog ? '\n' : '') + logLine
      trace(`pass-${passNum}-agent-fail-continue`, { kind })
      await appendLog(`result: AGENT-FAIL\n${logLine}\n(continuing — does not block other passes)\n`)
      emit({ agent: 'lumberjack', phase: 'failed', detail: `Pass ${passNum} (${kind}) agent call failed` })
    }
  }

  if (passCount === 0) {
    triageLog = '[240/40-SKIP] under trigger — no passes scheduled'
  }

  // Recompute final size after both cuts
  const afterContent = await readFile(sessionMdPath, 'utf-8').catch(() => workingSessionMd)
  const outputSize = Buffer.byteLength(afterContent, 'utf-8')
  const bytesCut = Math.max(0, inputSize - outputSize)
  const applied = bytesCut > 0

  emit({
    agent: 'lumberjack',
    phase: 'writing',
    detail: applied
      ? `${(outputSize / 1024).toFixed(1)}KB after cut (-${(bytesCut / 1024).toFixed(1)}KB)`
      : 'no cut applied',
  })

  await appendLog(
    `\n## Phase 4 · Final\n` +
      `inputSize:   ${inputSize} bytes (${(inputSize / 1024).toFixed(1)} KB)\n` +
      `outputSize:  ${outputSize} bytes (${(outputSize / 1024).toFixed(1)} KB)\n` +
      `bytesCut:    ${bytesCut}\n` +
      `applied:     ${applied}\n` +
      `snapshot:    ${snapshotPath} (swept on success path)\n\n` +
      `## Triage Log\n${triageLog}\n`,
  )

  // 2026-05-16 (Ralph reversal of 2026-04-30 doctrine): on successful
  // completion, sweep ALL pre-prune snapshots for this session. The
  // earlier "never delete on success — keep 24h for rollback" was
  // adopted because a destructive cut bug (2026-04-30, 433KB→67KB)
  // had silently passed as "success" and the snapshot was the only
  // path back. Since then the safety net is stronger:
  //   - seam-anchor fix (2026-05-12) eliminates mid-turn cuts
  //   - header-validation gates refuse splice on letter/timestamp drift
  //   - validation gates on cut window + post-write byte ranges
  // If those passed, the snapshot is dead weight. Operator can re-run
  // from git history if needed. Snapshots only persist on failure paths
  // (those throw or return early before reaching this code).
  try {
    const { readdir, unlink } = await import('fs/promises')
    const dir = path.dirname(sessionMdPath)
    const baseName = path.basename(sessionMdPath)
    const prefix = `${baseName}.pre-prune-`
    const entries = await readdir(dir)
    const swept: string[] = []
    for (const name of entries) {
      if (!name.startsWith(prefix)) continue
      await unlink(path.join(dir, name)).catch(() => {})
      swept.push(name)
    }
    if (swept.length > 0) {
      console.log(
        `[sage-240-40] swept ${swept.length} pre-prune snapshot(s) on successful completion: ${swept.join(', ')}`,
      )
      trace('snapshots-swept-on-success', { count: swept.length, files: swept })
    }
  } catch (err) {
    console.warn(`[sage-240-40] snapshot cleanup failed (ignored): ${err}`)
  }

  console.log(
    `[sage-240-40] Cycle complete — ${inputSize}B → ${outputSize}B (cut ${bytesCut}B, applied=${applied})`,
  )
  trace('cycle-complete', { inputSize, outputSize, bytesCut, applied, triageLog })
  await flushTrace()
  emit({
    agent: 'lumberjack',
    phase: 'completed',
    detail: applied ? `cut ${(bytesCut / 1024).toFixed(1)}KB` : 'no cut',
  })

  return {
    stats: {
      sessionMdSize: inputSize,
      sessionMdSizeAfter: outputSize,
      bytesCut,
      triggered: true,
      snapshotPath,
      dreamTimestamp,
      triageLog,
    },
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Sage-240/40 — single-cut helper (Ralph 2026-04-25)
//
// JS-driven version of one cut cycle. Mechanics handled here:
//   - locate USER SESSION DATA marker
//   - find first eligible `#### User | …` turn after it
//   - take ~200 lines, snap end after a `#### CD | …` reply boundary
//   - identify next Block letter (highest existing + 1, A→Z then AA, AB…)
//   - identify start-date of the chunk for the LEDGER sub-header
//
// Then the agent is asked ONE thing: compress this chunk into a Block
// narrative. No tools, no file Reads, no thinking-loops on a 308KB file.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Self-heal old sessions that have no `## USER SESSION DATA` marker.
 *
 * Background (Ralph 2026-04-25): the new Sage architecture requires this
 * marker to separate "compacted block region" from "raw tissue." Sessions
 * created before this design have raw `#### User | …` turns at top-level
 * with no marker. Sage-240 was bailing immediately with `kind: 'no-tissue'`
 * on these files, so a 371KB file would "complete" in <1s with zero work.
 *
 * Strategy: if the marker is missing, find the first `#### User | …` turn
 * and insert `## USER SESSION DATA` on the line above. Returns:
 *   - { changed: true, content }  → marker inserted, caller writes the file
 *   - { changed: false, content } → marker already present, no-op
 *   - { changed: false, content: null } → no User turns at all, can't heal
 */
export function ensureUserSessionDataMarker(
  sessionMd: string,
): { changed: boolean; content: string | null } {
  const lines = sessionMd.split('\n')
  const usdIdx = lines.findIndex((l) => /^##\s+USER\s+SESSION\s+DATA/i.test(l))
  if (usdIdx >= 0) return { changed: false, content: sessionMd }

  // No marker. Find first `#### User | …` turn — that's where tissue begins.
  const userTurnIdx = lines.findIndex((l) => /^####\s+User\s*\|/i.test(l))
  if (userTurnIdx < 0) {
    // No User turns either — file has no tissue. Nothing to heal.
    return { changed: false, content: null }
  }

  // Walk backward from the User turn through any `---` separators / blank
  // lines so the marker sits cleanly above the dialog (not stranded on top
  // of a `---`).
  let insertAt = userTurnIdx
  while (insertAt > 0) {
    const prev = lines[insertAt - 1].trim()
    if (prev === '' || prev === '---') {
      insertAt--
      continue
    }
    break
  }

  // Insert: blank line + `## USER SESSION DATA` + blank line, then the
  // User turn (with whatever blank/--- preceded it preserved below the marker)
  const before = lines.slice(0, insertAt)
  const after = lines.slice(insertAt)
  // Strip leading blanks from `after` so we don't double-blank above the marker
  const newLines = [
    ...before,
    '',
    '## USER SESSION DATA',
    '',
    ...after,
  ]
  return { changed: true, content: newLines.join('\n') }
}

type SageCutResult =
  | { kind: 'no-tissue' }
  | { kind: 'agent-fail' }
  | {
      kind: 'ok'
      blockText: string
      blockLetter: string
      title: string
      timeRange: string
      startLine: number
      endLine: number
      bytesCut: number
    }

async function performOneSageCut(
  sessionMdPath: string,
  sessionMd: string,
  logsDir?: string,
  stageLabel?: string,
  onStreamEvent?: (e: { type: string; detail: string }) => void,
  trace?: SageTrace,
  triageLogPath?: string,
  signal?: AbortSignal,
): Promise<SageCutResult> {
  // Always-trace helper — degrades to no-op when caller didn't pass one.
  const tr: SageTrace = trace || (() => {})
  tr(`cut.${stageLabel || 'cut'}.start`, { inputBytes: sessionMd.length })
  // Synthesized stream-event helper — same purpose as in performOneSageCompact.
  // Without this, early-return paths are invisible in the live feed and the
  // user can't tell whether a pass was skipped or running.
  const note = (detail: string) => {
    if (onStreamEvent) {
      try { onStreamEvent({ type: 'cut', detail }) } catch {}
    }
  }
  note(`cut ${stageLabel || ''}: scanning past USER SESSION DATA marker for living tissue…`)

  const lines = sessionMd.split('\n')

  // Find USER SESSION DATA marker (case-insensitive, leading ##)
  const usdIdx = lines.findIndex((l) => /^##\s+USER\s+SESSION\s+DATA/i.test(l))
  tr(`cut.${stageLabel || 'cut'}.usd-marker`, { usdIdx, totalLines: lines.length })
  if (usdIdx < 0) {
    tr(`cut.${stageLabel || 'cut'}.no-usd-marker`, {})
    console.warn('[sage-240-40] No USER SESSION DATA marker — refusing cut')
    note('cut: no USER SESSION DATA marker — refusing cut')
    return { kind: 'no-tissue' }
  }

  // ── Cut anchor (Ralph 2026-05-02 — bug fix: living-tissue eaten from wrong end)
  //
  // Pre-fix history (`findFirstLivingTissue`): walked past Blocks, treated
  // `---` and orphan loose prose as Block-paragraph content, eventually
  // landed on the FIRST raw `#### User | …` turn — which on a healthy file
  // is RECENT live conversation. Cut took 200 lines forward and ate today's
  // tissue (proven on 2026-05-01-22:43 run: cut lines 768–991, both User
  // turns dated 2026-05-01 21:12 — newer than the last Block DD's 20:37).
  //
  // The instruction (Ralph 2026-05-02): "cut from the END of the LAST
  // block. From the end." Anchor on END of LAST Block by FILE POSITION
  // (not letter — old SESSION-RESTORED zones may have stale duplicate
  // letters). Walk forward through ONLY that Block's narrative; `---` is
  // a hard boundary so loose prose between Blocks is NOT swallowed. Then
  // time-protect the end: cap cutEnd at the first `#### User | YYYY-MM-DD
  // HH:MM` turn newer than the most-recent Block's end-time.
  //
  // Fresh-session fallback: if there are NO Blocks below USD, fall back
  // to the original "first non-structural line past USD" walk so brand-new
  // sessions still get cuts.
  // ──────────────────────────────────────────────────────────────────────
  const sectionEnd = lines.length - 200

  // ── FULL TRACE: scan every `**Block X — ` line in the eligible range so
  // the trace log shows exactly what findCutAnchorAfterLastBlock had to
  // choose from, INCLUDING which lines fell inside `## SESSION RESTORED`
  // zones (legacy stubs the loop should be skipping). This is the data
  // that exposes the 2026-05-03 trap-state where the loop anchored on a
  // legacy stub at line 358 because it was the highest line number, not
  // because it was a real Block. ──────────────────────────────────────────
  if (trace) {
    const blockOpeningRe = /^\*\*Block\s+([A-Z]+)\s+[—-]\s+(.+?)\*\*\s*\(([^)]+)\)/
    const sessionRestoredHdrRe = /^##\s+SESSION RESTORED/i
    let inRestoredZone = false
    const allBlockHits: Array<{
      line: number
      letter: string
      title: string
      range: string
      inRestoredZone: boolean
    }> = []
    const restoredZones: Array<{ start: number; line: string }> = []
    for (let i = usdIdx + 1; i < sectionEnd; i++) {
      const line = lines[i]
      if (sessionRestoredHdrRe.test(line)) {
        inRestoredZone = true
        restoredZones.push({ start: i, line })
        continue
      }
      if (/^##\s/.test(line) && !sessionRestoredHdrRe.test(line)) {
        inRestoredZone = false
      }
      const m = line.match(blockOpeningRe)
      if (m) {
        allBlockHits.push({
          line: i,
          letter: m[1],
          title: m[2].trim().slice(0, 80),
          range: m[3].trim(),
          inRestoredZone,
        })
      }
    }
    tr(`cut.${stageLabel || 'cut'}.scan-blocks`, {
      total: allBlockHits.length,
      restoredZones: restoredZones.length,
      hits: allBlockHits,
    })
    tr(`cut.${stageLabel || 'cut'}.scan-restored-zones`, { zones: restoredZones })
  }

  const anchor = findCutAnchorAfterLastBlock(lines, usdIdx, sectionEnd)
  tr(`cut.${stageLabel || 'cut'}.anchor`, {
    sectionEnd,
    anchor: anchor ? { cutStart: anchor.cutStart, reason: anchor.reason } : null,
    anchorLine: anchor ? lines[anchor.cutStart] : null,
  })
  if (!anchor || anchor.cutStart >= sectionEnd) {
    tr(`cut.${stageLabel || 'cut'}.no-anchor`, { anchorOrPastSection: !!anchor })
    console.warn(
      '[sage-240-40] No cuttable region past last Block — file is fully compressed or under-sized',
    )
    note('cut: no cuttable region past last Block — file is fully compressed')
    return { kind: 'no-tissue' }
  }
  let cutStart = anchor.cutStart
  note(`cut: anchored at line ${cutStart + 1} (${anchor.reason})`)

  // Compute the end-time of the most recent Block ACROSS THE WHOLE SESSION
  // (highest end-time by date+time, regardless of letter or position). Used
  // below to cap cutEnd: any User turn timestamped LATER than this is live
  // tissue and must be protected.
  // Ralph 2026-05-03 — simple cut-window per spec:
  //   1. cutStart is already at a real `#### User|CD` turn header (handled
  //      by findCutAnchorAfterLastBlock — no cruft anchoring).
  //   2. Take 200 lines forward.
  //   3. If we land mid-conversation, walk forward up to +100 lines until
  //      we find a `---\n#### User|CD` boundary (clean turn seam). Set
  //      cutEnd to the line BEFORE the `---` so the cut ends right after
  //      the previous CD reply (never mid-sentence).
  //   4. Cap at sectionEnd (last 200 lines protection).
  //
  // Removed (Ralph 2026-05-03):
  //   - findMostRecentBlockEndTime / findLiveTissueLine — time-based
  //     protectAfter trapped Sage when the most-recent dated Block was
  //     stale. Geometric sectionEnd (last-200-lines) is the only
  //     protection now.
  //   - 30-line floor — small windows are fine. The file converges
  //     naturally when there's nothing more to cut.
  // Walk forward from cutStart+200 until we hit a clean `---\n#### User|CD`
  // seam. The seam IS cutEnd. No mid-turn fallback — if no seam exists in
  // the cuttable region (cutStart+200 → sectionEnd), the file has converged
  // or is corrupt; abort rather than cut mid-conversation.
  //
  // Ralph 2026-05-12: previous code capped the snap-search at +100 lines
  // and fell through to `cutEnd = cutStart + 200` when no seam was found,
  // producing mid-turn cuts whenever a User→CD exchange ran longer than
  // ~100 lines (common for long audit/critique replies). The mid-turn
  // chunks dribbled half-turns back into the file, polluting subsequent
  // passes.
  const turnHeaderRe = /^####\s+(?:User|CD)\s*\|/i
  let cutEnd: number | null = null
  for (let i = cutStart + 200; i < sectionEnd; i++) {
    if (lines[i].trim() === '---' && turnHeaderRe.test(lines[i + 1])) {
      cutEnd = i
      break
    }
  }
  tr(`cut.${stageLabel || 'cut'}.snap-forward`, {
    cutStart,
    minCutEnd: cutStart + 200,
    sectionEnd,
    foundAt: cutEnd,
  })
  if (cutEnd === null) {
    tr(`cut.${stageLabel || 'cut'}.no-seam`, { cutStart, sectionEnd })
    note('cut: no clean turn seam past cutStart+200 — file converged or corrupt')
    return { kind: 'no-tissue' }
  }

  tr(`cut.${stageLabel || 'cut'}.window-final`, {
    cutStart,
    cutEnd,
    windowLines: cutEnd - cutStart,
  })
  if (cutEnd - cutStart < 1) {
    tr(`cut.${stageLabel || 'cut'}.empty-window`, {})
    note(`cut: empty window — nothing to cut`)
    return { kind: 'no-tissue' }
  }
  note(`cut: window lines ${cutStart + 1}–${cutEnd} (${cutEnd - cutStart} lines) → calling agent`)

  const chunkLines = lines.slice(cutStart, cutEnd)
  const chunk = chunkLines.join('\n')
  const chunkBytes = Buffer.byteLength(chunk, 'utf-8')

  // Determine the next Block letter: scan all `**Block X — ` headers.
  const blockLetterRe = /\*\*Block\s+([A-Z]+)\s+—/g
  const seenLetters: string[] = []
  let lm: RegExpExecArray | null
  while ((lm = blockLetterRe.exec(sessionMd)) !== null) seenLetters.push(lm[1])
  const nextLetter = nextBlockLetter(seenLetters)

  // Determine the start-date and time-range for the chunk.
  //
  // Ralph 2026-04-25 BUG FIX: turn lines come in TWO formats in the wild:
  //   `#### User | 2026-04-20 23:52:52`  (full date + time + seconds)
  //   `#### User | 19:21:13`             (time only — no date, the bridge
  //                                       writes this for in-day sessions)
  //   `#### User | 23:50`                (older format, time only no seconds)
  // The OLD regex required `YYYY-MM-DD HH:MM` and silently fell back to
  // `00:00` on the time-only format → every Block ended up with
  // `(00:00 → 00:00)`. The new helper handles all three formats,
  // and derives the chunk date from the sessionId when the turn line
  // doesn't carry one (sessionId looks like `2026-02-15-1` → `2026-02-15`).
  const { chunkStartDate, chunkEndDate, chunkStartTime, chunkEndTime } =
    extractTimestampsFromChunk(chunkLines, sessionMdPath)
  // 2026-04-30 (Ralph): Block titles now carry full dates so the live feed
  // and downstream Compact passes don't lose temporal anchoring. Same-day
  // chunks render as `(YYYY-MM-DD HH:MM → HH:MM)`; cross-day chunks
  // render as `(YYYY-MM-DD HH:MM → YYYY-MM-DD HH:MM)`.
  const timeRange = formatDatedTimeRange(
    chunkStartDate,
    chunkStartTime,
    chunkEndDate,
    chunkEndTime,
  )
  // chunkDate = the date the Block lives under (start date)
  const chunkDate = chunkStartDate

  // ── Call agent: agent file as SYSTEM PROMPT (identity + format spec),
  // task + chunk as USER MESSAGE. Without --system-prompt-file the CLI's
  // default ambient context dominates and the agent reads the chunk as
  // creative input ("more image prompts to write") rather than as
  // material to compress. Setting agent-file as system-prompt fixes that.
  const agentFile = loadSage240_40()
  const userMessage =
    `## TASK\n\n` +
    `Below is a ${chunkLines.length}-line dialogue chunk from SESSION.md (lines ${cutStart + 1}–${cutEnd}). Compress it into ONE Block entry following the BLOCK ENTRY SHAPE in your system prompt.\n\n` +
    `**Block letter:** ${nextLetter}\n` +
    `**Date (LEDGER sub-header):** ${chunkDate}\n` +
    `**Time range (Block title parens — VERBATIM, dated):** ${timeRange}\n\n` +
    `## OUTPUT — strictly this format, nothing else\n\n` +
    `Line 1: \`### ${chunkDate}\`\n` +
    `Line 2 onward: One Block entry. Opening line MUST be:\n` +
    `\`**Block ${nextLetter} — <a 4-8 word title YOU INVENT that captures what happened>** (${timeRange})\`\n` +
    `(Replace \`<a 4-8 word title YOU INVENT…>\` with an actual title. Do NOT output the angle-bracket placeholder text literally. The parens content MUST be \`${timeRange}\` exactly — do NOT strip the date.)\n\n` +
    `Then a blank line, then ONE prose paragraph (or up to two short paragraphs) per BLOCK ENTRY SHAPE. User quotes inline in italics. Timestamps woven in. NO bullet lists. NO preamble. NO closing remarks. NO explanation.\n\n` +
    `Example first line shape (with a real title): \`**Block ${nextLetter} — Director text-edit clobbering all paragraphs** (${timeRange})\`\n\n` +
    `## CHUNK TO COMPRESS\n\n` +
    chunk

  // Ralph 2026-05-18: per-pass debug log deleted; the unified triage log
  // (one per Sage run, `sage-240-MM-DD-HH.mm.log`) receives the prompt /
  // response / result via dreamer.ts's appendLog after the call returns.
  // callAnthropic's logPath stays undefined here so it doesn't open its
  // own stream-json audit file. Live stream events still flow through
  // onStreamEvent → CompactionOverlay (unchanged).
  // Sage 240/40 emits as 'lumberjack' agent (took the slot when legacy
  // Lumberjack was scrapped) so the overlay routes its stream to the
  // Lumberjack-track feed.
  tr(`cut.${stageLabel || 'cut'}.agent-call`, {
    nextLetter,
    chunkDate,
    timeRange,
    chunkLines: chunkLines.length,
    chunkBytes,
    cutStart,
    cutEnd,
  })
  // Append the prompt to the unified triage log BEFORE calling, so a
  // hang/timeout leaves the prompt visible in disk state.
  if (triageLogPath) {
    try {
      const { appendFile } = await import('fs/promises')
      await appendFile(
        triageLogPath,
        `### CUT prompt — ${stageLabel || 'cut'}\n` +
          `nextLetter=${nextLetter} chunkDate=${chunkDate} timeRange="${timeRange}" ` +
          `chunkLines=${chunkLines.length} chunkBytes=${chunkBytes} window=${cutStart + 1}–${cutEnd}\n` +
          '```\n' + userMessage + '\n```\n',
        'utf-8',
      )
    } catch {}
  }
  const response = await callAnthropic(
    DREAMER_MODEL,
    userMessage,
    agentFile,
    undefined,
    onStreamEvent,
    signal,
  )
  if (triageLogPath) {
    try {
      const { appendFile } = await import('fs/promises')
      await appendFile(
        triageLogPath,
        `### CUT response — ${stageLabel || 'cut'}\n` +
          '```\n' + (response || '<null>') + '\n```\n',
        'utf-8',
      )
    } catch {}
  }
  if (!response) {
    tr(`cut.${stageLabel || 'cut'}.agent-null`, {})
    console.error('[sage-240-40] Agent call returned null on cut')
    return { kind: 'agent-fail' }
  }
  tr(`cut.${stageLabel || 'cut'}.agent-response`, { responseLength: response.length })

  // Extract the Block entry from the response (lenient — the model might
  // wrap it in fences or add stray text). Strip code fences first.
  const cleaned = response.replace(/```(?:markdown|md)?\s*\n?/g, '').replace(/```\s*$/g, '').trim()
  // Tolerate em-dash (—) OR ASCII hyphen-minus (-) since the agent
  // sometimes normalizes the punctuation in the title separator.
  const blockMatch = cleaned.match(/(\*\*Block\s+[A-Z]+\s+[—-]\s+[^*]+\*\*[\s\S]+?)(?=\n###\s|\n##\s|$)/)
  if (!blockMatch) {
    console.error('[sage-240-40] Could not parse Block entry from agent response')
    console.error('[sage-240-40] Full response:', response)
    return { kind: 'agent-fail' }
  }
  const blockEntry = blockMatch[1].trim()

  // ── Ralph 2026-05-03: validate the agent didn't hallucinate the Block
  // header. The previous code accepted ANY [A-Z]+ letter and ANY parens
  // content, so the agent could (and did) return:
  //   - A SHORT letter like "Block G" when we sent nextLetter="DG"
  //     (date-stripping or letter-stripping by the model). Result: duplicate
  //     letters in the file → findCutAnchorAfterLastBlock anchors on the
  //     wrong Block by file position → next run thinks all 5/2 tissue is
  //     live (because protectAfter falls back to an older dated Block) →
  //     "no living tissue" trap that locks Sage out of further cuts.
  //   - A bare time-range like "(23:50 → 00:26)" when we sent the dated
  //     "2026-05-02 23:50 → 2026-05-02 00:26". findMostRecentBlockEndTime
  //     ignores undated Blocks, so the protection threshold rolls
  //     backwards on every successful cut.
  //
  // Both failure modes were observed in public/2026-01-27-debug/SESSION.md
  // after the 2026-05-03 03:50 successful Sage cut wrote three undated
  // single-letter Block G/H/I entries. The next Sage run could not cut
  // anything because of the trap.
  //
  // Fix: parse the letter and time-range out of the matched header. If
  // either differs from what JS computed, REFUSE the response (return
  // agent-fail). The fallback chain in _runSage240_40Inner logs the skip
  // and the file stays untouched until the agent obeys the contract.
  // ────────────────────────────────────────────────────────────────────
  const headerCheck = blockEntry.match(
    /^\*\*Block\s+([A-Z]+)\s+[—-]\s+[^*(]+?\*\*\s*\(([^)]+)\)/,
  )
  if (!headerCheck) {
    tr(`cut.${stageLabel || 'cut'}.header-malformed`, { entryStart: blockEntry.slice(0, 200) })
    console.error('[sage-240-40] Block header missing or malformed in response')
    console.error('[sage-240-40] First 500 chars of blockEntry:', blockEntry.slice(0, 500))
    return { kind: 'agent-fail' }
  }
  const emittedLetter = headerCheck[1]
  const emittedTimeRange = headerCheck[2].trim()
  tr(`cut.${stageLabel || 'cut'}.header-validate`, {
    expected: { letter: nextLetter, timeRange: timeRange.trim() },
    got: { letter: emittedLetter, timeRange: emittedTimeRange },
    letterMatch: emittedLetter === nextLetter,
    timeRangeMatch: emittedTimeRange === timeRange.trim(),
  })
  if (emittedLetter !== nextLetter) {
    console.error(
      `[sage-240-40] Letter mismatch: agent emitted "${emittedLetter}", JS sent "${nextLetter}". Refusing splice.`,
    )
    return { kind: 'agent-fail' }
  }
  if (emittedTimeRange !== timeRange.trim()) {
    console.error(
      `[sage-240-40] Time-range mismatch: agent emitted "(${emittedTimeRange})", JS sent "(${timeRange})". Refusing splice.`,
    )
    return { kind: 'agent-fail' }
  }

  const titleMatch = blockEntry.match(/\*\*Block\s+[A-Z]+\s+—\s+([^*(]+?)(?:\*\*|\()/)
  const title = (titleMatch ? titleMatch[1] : 'untitled').trim()

  // ── JS does the actual edit (Ralph 2026-05-18 architecture):
  //   1. Splice the chunk out of USD (tissue zone)
  //   2. Insert the Block entry under `## BLOCKS` with a `### ${chunkDate}`
  //      sub-header (create one if missing, chronologically sorted).
  //      `## USER SESSION DATA` now holds tissue ONLY; Blocks live in their
  //      own dedicated section above USD.
  // ────────────────────────────────────────────────────────────────────────

  // Step 1: remove the chunk
  const after = [...lines]
  after.splice(cutStart, cutEnd - cutStart)
  tr(`cut.${stageLabel || 'cut'}.splice-out`, {
    cutStart,
    removedLines: cutEnd - cutStart,
    afterLineCount: after.length,
  })

  // Step 2: locate `## BLOCKS` section bounds in `after`.
  // ensureSagesSections in _runSage240_40Inner created it if missing.
  //
  // Ralph 2026-05-19: lastMatch:true defensive parity with the COMPACT and
  // LEDGER passes — guards against a legacy template that leaves an empty
  // `## BLOCKS` placeholder near the top of the file. The active section is
  // always the last `## BLOCKS` header in document order.
  const blocksSection = findSectionBounds(after, /^##\s+BLOCKS\b/i, { lastMatch: true })
  if (!blocksSection) {
    console.error('[sage-240-40] No ## BLOCKS section — refusing edit')
    return { kind: 'agent-fail' }
  }

  const dateHeader = `### ${chunkDate}`
  let dateHeaderIdx = -1
  for (let i = blocksSection.start + 1; i < blocksSection.end; i++) {
    if (after[i].trim() === dateHeader) { dateHeaderIdx = i; break }
  }

  if (dateHeaderIdx < 0) {
    // Insert in chronological order among existing date sub-headers in
    // the BLOCKS section.
    let insertAt = blocksSection.end
    for (let i = blocksSection.start + 1; i < blocksSection.end; i++) {
      const m = after[i].match(/^###\s+(\d{4}-\d{2}-\d{2})/)
      if (m && m[1] > chunkDate) { insertAt = i; break }
    }
    after.splice(insertAt, 0, '', dateHeader, '', blockEntry, '')
  } else {
    // Ralph 2026-05-19: insert chronologically by START TIME within the
    // existing date sub-header. The previous behaviour was a blind append
    // at the date sub-header's end, which produced doc-order ≠ time-order
    // when the agent walked tissue out of chronological sequence (e.g.
    // cut the 13:00 chunk before the 02:00 chunk that day). The downstream
    // Compact fold then took the first-by-doc-order and last-by-doc-order
    // blocks and emitted a `(13:00 → 02:00)` temporal-inversion title.
    //
    // Algorithm: walk every Block opening under this date sub-header until
    // the next `### ` / `## ` boundary. Parse each existing Block's start
    // time. Insert THIS Block immediately before the first existing Block
    // whose start time is greater than this one's start time. If none is
    // greater, insert at the sub-header's natural end.
    const blockHeaderRe = /^\*\*Block\s+[A-Z]+\s+[—-]\s+/
    // Parse the new Block's own start time so we know where to land.
    const newTimeMatch = blockEntry.match(/^\*\*Block\s+[A-Z]+\s+[—-]\s+[^*]+\*\*\s*\(([^)]+)\)/)
    const newStart = newTimeMatch ? parseBlockTimeRange(newTimeMatch[1]) : null
    const newKey = newStart
      ? `${newStart.startDate || chunkDate} ${newStart.startTime || '00:00'}`
      : `${chunkDate} 00:00`

    let subHeaderEnd = blocksSection.end
    for (let i = dateHeaderIdx + 1; i < blocksSection.end; i++) {
      if (/^###\s/.test(after[i]) || /^##\s/.test(after[i])) {
        subHeaderEnd = i
        break
      }
    }

    let insertAt = subHeaderEnd
    for (let i = dateHeaderIdx + 1; i < subHeaderEnd; i++) {
      if (!blockHeaderRe.test(after[i])) continue
      const m = after[i].match(/^\*\*Block\s+[A-Z]+\s+[—-]\s+[^*]+\*\*\s*\(([^)]+)\)/)
      if (!m) continue
      const existing = parseBlockTimeRange(m[1])
      const existingKey = `${existing.startDate || chunkDate} ${existing.startTime || '00:00'}`
      if (existingKey > newKey) {
        insertAt = i
        break
      }
    }
    after.splice(insertAt, 0, '', blockEntry, '')
  }

  const finalContent = after.join('\n')
  await writeFile(sessionMdPath, finalContent, 'utf-8')
  tr(`cut.${stageLabel || 'cut'}.file-written`, {
    finalLines: after.length,
    finalBytes: Buffer.byteLength(finalContent, 'utf-8'),
    blockLetter: nextLetter,
    title,
    timeRange,
    bytesCut: chunkBytes,
  })

  return {
    kind: 'ok',
    blockText: blockEntry,
    blockLetter: nextLetter,
    title,
    timeRange,
    startLine: cutStart + 1,
    endLine: cutEnd,
    bytesCut: chunkBytes,
  }
}

/**
 * Find a top-level `## ` section's bounds. Returns the start index (the
 * `## ` header line) and the end index (the line index of the NEXT `## `
 * top-level header, or the end-of-file). Returns `null` if not found.
 *
 * `opts.lastMatch: true` walks BACKWARDS to find the rightmost section.
 * Use this when the file may legitimately or accidentally have duplicate
 * headers — e.g., `## LEDGER` appears twice in some session templates
 * (a legacy `(empty)` placeholder near the top + the active LEDGER near
 * USD). Compacts must land in the LATER LEDGER (the active one); the
 * first-match default would dump them in the empty placeholder where
 * they'd be invisible. Ralph 2026-05-16.
 */
function findSectionBounds(
  lines: string[],
  headerRe: RegExp,
  opts: { lastMatch?: boolean } = {},
): { start: number; end: number } | null {
  let start: number
  if (opts.lastMatch) {
    start = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      if (headerRe.test(lines[i])) { start = i; break }
    }
  } else {
    start = lines.findIndex((l) => headerRe.test(l))
  }
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break }
  }
  return { start, end }
}

// `countBlockLinesInUserSection` removed Ralph 2026-05-18 — superseded by
// `measureSagesSpans` (content-aware whole-file walker) for the new
// triple-tier schedule.

// ───────────────────────────────────────────────────────────────────────────
// Sage-240/40 — COMPACT pass (Ralph 2026-04-25)
//
// When the LEDGER section grows past 400 lines (Ralph 2026-05-12, lowered
// from 1000), Order 66 switches the second-half passes from "cut tissue →
// write Block" to "fold first 3 Blocks → write 1 Compact." The Compact
// replaces the 3 Blocks in-place and is
// the same length as a single Block — so 3-to-1 size reduction (~30%
// of the original three combined).
//
// "First 3 Blocks" SKIPS any existing Compacts. So the chronologically
// oldest material gets folded first, second-oldest next time, etc.
// Existing Compacts are not re-rolled (no second-tier compaction yet).
// ───────────────────────────────────────────────────────────────────────────

interface BlockEntry {
  letter: string
  title: string
  timeRange: string
  startLine: number   // index of `**Block X — …** (…)` line
  endLine: number     // index just AFTER the entry (exclusive)
  text: string        // full text including blank-line gutter
}

type SageCompactResult =
  | { kind: 'no-tissue' }
  | { kind: 'agent-fail' }
  | {
      kind: 'ok'
      compactLabel: string      // e.g. "A-C" or "A,B,C"
      title: string
      timeRange: string
      foldedLetters: string[]
      bytesCut: number
    }

// ─── Ledger pass (Ralph 2026-05-18) ────────────────────────────────────────
// 3 OLDEST Compact entries → 1 Ledger entry. Ledger entry has NO title —
// header is just `- DD.MMM.YY HH:MM → DD.MMM.YY HH:MM` followed by prose.
interface CompactEntry {
  label: string          // e.g. "A-C" or "BT-BX"
  title: string
  timeRange: string      // raw parens content from the **Compact …** opening
  startLine: number      // index of the `**Compact …**` opening line
  endLine: number        // index just AFTER the entry (exclusive)
  text: string           // full entry text including blank-line gutter
}

type SageLedgerResult =
  | { kind: 'no-tissue' }
  | { kind: 'agent-fail' }
  | {
      kind: 'ok'
      timeRange: string          // formatted as `DD.MMM.YY HH:MM → …`
      foldedCount: number        // always 3 for current spec
      foldedLabels: string[]     // the Compact labels we folded
      bytesCut: number
    }

/** Find every `**Block X — title** (HH:MM → HH:MM)` entry within a section
 *  range [sectionStart, sectionEnd). Skips Compact entries. The end of each
 *  entry is just before the next opening (Block / Compact / date / section). */
function findBlockEntries(
  lines: string[],
  sectionStart: number,
  sectionEnd: number,
): BlockEntry[] {
  const openings: { idx: number; letter: string; title: string; timeRange: string }[] = []
  const headerRe = /^\*\*Block\s+([A-Z]+)\s+[—-]\s+(.+?)\*\*\s*\(([^)]+)\)\s*$/i
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const m = lines[i].match(headerRe)
    if (m) openings.push({ idx: i, letter: m[1], title: m[2].trim(), timeRange: m[3].trim() })
  }

  // Each entry runs from its opening line until the next stop boundary.
  // Raw tissue (`#### User | …` / `#### CD | …`) also stops the entry —
  // important now that Blocks live above raw tissue inside USD.
  const stopRe = /^(?:\*\*Block\s+[A-Z]+\s+[—-]|\*\*Compact\s+|###\s|##\s|####\s+(?:User|CD)\s*\|)/i
  return openings.map((op) => {
    let end = sectionEnd
    for (let j = op.idx + 1; j < sectionEnd; j++) {
      if (stopRe.test(lines[j])) { end = j; break }
    }
    // Trim trailing blank lines
    while (end > op.idx + 1 && lines[end - 1].trim() === '') end--
    return {
      letter: op.letter,
      title: op.title,
      timeRange: op.timeRange,
      startLine: op.idx,
      endLine: end,
      text: lines.slice(op.idx, end).join('\n'),
    }
  })
}

async function performOneSageCompact(
  sessionMdPath: string,
  sessionMd: string,
  logsDir?: string,
  stageLabel?: string,
  onStreamEvent?: (e: { type: string; detail: string }) => void,
  trace?: SageTrace,
  triageLogPath?: string,
  signal?: AbortSignal,
): Promise<SageCompactResult> {
  const tr: SageTrace = trace || (() => {})
  tr(`compact.${stageLabel || 'compact'}.start`, { inputBytes: sessionMd.length })
  const note = (detail: string) => {
    if (onStreamEvent) {
      try { onStreamEvent({ type: 'compact', detail }) } catch {}
    }
  }
  note(`compact ${stageLabel || ''}: scanning whole file for Block entries…`)

  // Ralph 2026-05-18: content-aware Block finder. Scan the WHOLE file for
  // `**Block X — …**` openings — finds Blocks wherever they physically
  // live (the new `## BLOCKS` section, or legacy locations under
  // `## USER SESSION DATA`).
  //
  // Ralph 2026-05-19 (chronological-fold fix): the OLD logic picked the 3
  // OLDEST Blocks by DOCUMENT ORDER. That sounds right but breaks when
  // Block insertion under an existing `### YYYY-MM-DD` sub-header appends
  // multiple Blocks in cut-order rather than tissue-time-order — e.g.
  // the agent cuts the 13:00 tissue chunk before the 02:00 tissue chunk,
  // and both land under the same date with [13:00, 02:00] in doc order.
  // The Compact fold then took those 3 and produced a title with the
  // first Block's START and the last Block's END — `(13:00 → 02:00)` —
  // a temporal inversion. Downstream Ledger folds inherited the inversion.
  //
  // Fix: sort by parsed start-date+time BEFORE slicing the oldest 3.
  // Doc order is no longer a load-bearing assumption.
  const lines = sessionMd.split('\n')
  const allBlocks = findBlockEntries(lines, 0, lines.length)
  if (allBlocks.length < 3) {
    console.warn(`[sage-240-40] compact: only ${allBlocks.length} Block entries found — need 3, skipping`)
    note(`compact: only ${allBlocks.length} Block entries available — need 3 to fold, skipping`)
    return { kind: 'no-tissue' }
  }
  const blocks = [...allBlocks].sort((a, b) => {
    const ap = parseBlockTimeRange(a.timeRange)
    const bp = parseBlockTimeRange(b.timeRange)
    const aKey = `${ap.startDate || '0000-00-00'} ${ap.startTime || '00:00'}`
    const bKey = `${bp.startDate || '0000-00-00'} ${bp.startTime || '00:00'}`
    return aKey.localeCompare(bKey)
  })
  note(`compact: folding Blocks ${blocks.slice(0, 3).map(b => b.letter).join(', ')} → 1 Compact entry`)

  const toFold = blocks.slice(0, 3)
  const foldedLetters = toFold.map((b) => b.letter)
  const compactLabel = `${foldedLetters[0]}-${foldedLetters[foldedLetters.length - 1]}`

  // Time range = first Block's start through last Block's end. Parse the
  // dated parens content of each Block title into structured fields, then
  // re-format with date(s). Falls back to legacy `(HH:MM → HH:MM)` if the
  // Blocks pre-date the dated-title format.
  const firstParsed = parseBlockTimeRange(toFold[0].timeRange)
  const lastParsed = parseBlockTimeRange(toFold[toFold.length - 1].timeRange)
  const timeRange =
    firstParsed.startDate && lastParsed.endDate
      ? formatDatedTimeRange(
          firstParsed.startDate,
          firstParsed.startTime,
          lastParsed.endDate,
          lastParsed.endTime,
        )
      : `${firstParsed.startTime} → ${lastParsed.endTime}`

  const combinedText = toFold.map((b) => b.text).join('\n\n')
  const combinedBytes = Buffer.byteLength(combinedText, 'utf-8')

  // Send to agent: agent file (system prompt) + 3 Blocks + format spec.
  const agentFile = loadSage240_40()
  const userMessage =
    `## TASK — COMPACT PASS (3 BLOCKS → 1 COMPACT)\n\n` +
    `Below are the three OLDEST Block entries from LEDGER. Fold them into a SINGLE Compact entry of the SAME length as one Block (one prose paragraph, two short paragraphs max). The Compact preserves the arc across all three Blocks but at higher compression. Per BLOCK ENTRY SHAPE — narrative prose, user quotes inline in italics, timestamps woven in.\n\n` +
    `**Compact label:** ${compactLabel} (covers Blocks ${foldedLetters.join(', ')})\n` +
    `**Time range (Compact title parens — VERBATIM, dated):** ${timeRange}\n\n` +
    `## OUTPUT — strictly this format, nothing else\n\n` +
    `One Compact entry. Opening line MUST be:\n` +
    `\`**Compact ${compactLabel} — <a 4-8 word arc title YOU INVENT>** (${timeRange})\`\n` +
    `(The parens content MUST be \`${timeRange}\` exactly — do NOT strip the date(s).)\n` +
    `Then a blank line, then ONE paragraph (or up to two short paragraphs) per BLOCK ENTRY SHAPE. Same length budget as a single Block — do NOT triple it. Aim for ~30% the byte count of the three Blocks combined. NO bullet lists. NO preamble. NO closing remarks. NO explanation.\n\n` +
    `Example first line shape: \`**Compact ${compactLabel} — Vibe-1 build, image queue, hero verdicts** (${timeRange})\`\n\n` +
    `## THREE BLOCKS TO FOLD\n\n` +
    combinedText

  // Ralph 2026-05-18: per-pass debug log deleted. Prompt + response are
  // appended to the unified triage log (see triageLogPath).
  if (triageLogPath) {
    try {
      const { appendFile } = await import('fs/promises')
      await appendFile(
        triageLogPath,
        `### COMPACT prompt — ${stageLabel || 'compact'}\n` +
          `compactLabel=${compactLabel} timeRange="${timeRange}" combinedBytes=${combinedBytes}\n` +
          '```\n' + userMessage + '\n```\n',
        'utf-8',
      )
    } catch {}
  }
  const response = await callAnthropic(
    DREAMER_MODEL,
    userMessage,
    agentFile,
    undefined,
    onStreamEvent,
    signal,
  )
  if (triageLogPath) {
    try {
      const { appendFile } = await import('fs/promises')
      await appendFile(
        triageLogPath,
        `### COMPACT response — ${stageLabel || 'compact'}\n` +
          '```\n' + (response || '<null>') + '\n```\n',
        'utf-8',
      )
    } catch {}
  }
  if (!response) {
    console.error('[sage-240-40] compact: agent returned null')
    return { kind: 'agent-fail' }
  }

  const cleaned = response.replace(/```(?:markdown|md)?\s*\n?/g, '').replace(/```\s*$/g, '').trim()
  const compactRe = /(\*\*Compact\s+[A-Z0-9,\-\s]+\s+[—-]\s+[^*]+\*\*[\s\S]+?)(?=\n###\s|\n##\s|\n\*\*Block\s|\n\*\*Compact\s|$)/
  const match = cleaned.match(compactRe)
  if (!match) {
    console.error('[sage-240-40] compact: could not parse Compact entry from agent response')
    console.error('[sage-240-40] First 400 chars:', cleaned.slice(0, 400))
    return { kind: 'agent-fail' }
  }
  const compactEntry = match[1].trim()
  const titleMatch = compactEntry.match(/\*\*Compact\s+[A-Z0-9,\-\s]+\s+[—-]\s+([^*(]+?)(?:\*\*|\()/)
  const title = (titleMatch ? titleMatch[1] : 'untitled').trim()

  // ── Two-stage edit (Ralph 2026-05-18):
  //   1. Remove the 3 Block entries wherever they sit (new `## BLOCKS`
  //      section or legacy under `## USER SESSION DATA`).
  //   2. Insert the Compact under `## COMPACTS` with a `### date` sub-header
  //      derived from the first folded Block's start date.

  const after = [...lines]
  const removeFrom = toFold[0].startLine
  let removeTo = toFold[toFold.length - 1].endLine
  // Eat trailing blank lines so we don't leave a yawning gap
  while (removeTo < after.length && after[removeTo].trim() === '') removeTo++
  after.splice(removeFrom, removeTo - removeFrom)

  const compactDate = (() => {
    if (firstParsed.startDate) return firstParsed.startDate
    // Legacy fallback: try to mine a `YYYY-MM-DD HH:MM` from the Block's prose
    const tsMatch = toFold[0].text.match(/(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}/)
    if (tsMatch) return tsMatch[1]
    return new Date().toISOString().slice(0, 10)
  })()

  // Find `## COMPACTS` bounds in `after`. ensureSagesSections upstream
  // guarantees this exists. Use lastMatch in case a legacy template has
  // an empty-placeholder `## COMPACTS` near the top.
  const compactsSection = findSectionBounds(after, /^##\s+COMPACTS\b/i, { lastMatch: true })
  if (!compactsSection) {
    console.error('[sage-240-40] compact: no ## COMPACTS section to insert Compact into')
    return { kind: 'agent-fail' }
  }

  // Find or create `### YYYY-MM-DD` date sub-header inside COMPACTS
  const dateHeader = `### ${compactDate}`
  let dateHeaderIdx = -1
  for (let i = compactsSection.start + 1; i < compactsSection.end; i++) {
    if (after[i].trim() === dateHeader) { dateHeaderIdx = i; break }
  }
  if (dateHeaderIdx < 0) {
    let insertAt = compactsSection.end
    for (let i = compactsSection.start + 1; i < compactsSection.end; i++) {
      const m = after[i].match(/^###\s+(\d{4}-\d{2}-\d{2})/)
      if (m && m[1] > compactDate) { insertAt = i; break }
    }
    after.splice(insertAt, 0, '', dateHeader, '', compactEntry, '')
  } else {
    let insertAt = compactsSection.end
    for (let i = dateHeaderIdx + 1; i < compactsSection.end; i++) {
      if (/^###\s/.test(after[i]) || /^##\s/.test(after[i])) { insertAt = i; break }
    }
    after.splice(insertAt, 0, '', compactEntry, '')
  }

  await writeFile(sessionMdPath, after.join('\n'), 'utf-8')

  const compactBytes = Buffer.byteLength(compactEntry, 'utf-8')
  return {
    kind: 'ok',
    compactLabel,
    title,
    timeRange,
    foldedLetters,
    bytesCut: combinedBytes - compactBytes,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Sage-240/40 — LEDGER pass (Ralph 2026-05-18)
//
// Triggered when compact_span ≥ SAGE_COMPACT_SPAN_GATE (120 lines by
// default). Folds the THREE OLDEST `**Compact …**` entries (anywhere in
// the file, content-aware) into ONE dash-bullet Ledger entry with NO
// title — header is just `- DD.MMM.YY HH:MM → DD.MMM.YY HH:MM` (same-day
// collapses the right side). Result is inserted at the end of `## LEDGER`.
// ───────────────────────────────────────────────────────────────────────────

/** Find every `**Compact X-Y — title** (HH:MM → HH:MM)` entry within a section
 *  range [sectionStart, sectionEnd). The end of each entry is just before
 *  the next opening (Compact / Block / `### date` / `## section`). */
function findCompactEntries(
  lines: string[],
  sectionStart: number,
  sectionEnd: number,
): CompactEntry[] {
  const openings: { idx: number; label: string; title: string; timeRange: string }[] = []
  const headerRe = /^\*\*Compact\s+([A-Z0-9,\-\s]+?)\s+[—-]\s+(.+?)\*\*\s*\(([^)]+)\)\s*$/i
  for (let i = sectionStart; i < sectionEnd; i++) {
    const m = lines[i].match(headerRe)
    if (m) openings.push({ idx: i, label: m[1].trim(), title: m[2].trim(), timeRange: m[3].trim() })
  }
  const stopRe = /^(?:\*\*Compact\s+|\*\*Block\s+[A-Z]+\s+[—-]|###\s|##\s|####\s+(?:User|CD)\s*\|)/i
  return openings.map((op) => {
    let end = sectionEnd
    for (let j = op.idx + 1; j < sectionEnd; j++) {
      if (stopRe.test(lines[j])) { end = j; break }
    }
    while (end > op.idx + 1 && lines[end - 1].trim() === '') end--
    return {
      label: op.label,
      title: op.title,
      timeRange: op.timeRange,
      startLine: op.idx,
      endLine: end,
      text: lines.slice(op.idx, end).join('\n'),
    }
  })
}

async function performOneSageLedger(
  sessionMdPath: string,
  sessionMd: string,
  logsDir?: string,
  stageLabel?: string,
  onStreamEvent?: (e: { type: string; detail: string }) => void,
  trace?: SageTrace,
  triageLogPath?: string,
  signal?: AbortSignal,
): Promise<SageLedgerResult> {
  const tr: SageTrace = trace || (() => {})
  tr(`ledger.${stageLabel || 'ledger'}.start`, { inputBytes: sessionMd.length })
  const note = (detail: string) => {
    if (onStreamEvent) {
      try { onStreamEvent({ type: 'ledger', detail }) } catch {}
    }
  }
  note(`ledger ${stageLabel || ''}: scanning whole file for Compact entries…`)

  // Ralph 2026-05-19 (chronological-fold fix): same rationale as the
  // Compact pass above — sort Compacts by parsed start-date+time BEFORE
  // slicing the oldest 3. Doc order can be wrong if an upstream insertion
  // landed Compacts out of order; this defensive sort keeps the fold
  // chronologically coherent even on a file with prior pathology.
  const lines = sessionMd.split('\n')
  const allCompacts = findCompactEntries(lines, 0, lines.length)
  if (allCompacts.length < 3) {
    console.warn(`[sage-240-40] ledger: only ${allCompacts.length} Compact entries found — need 3, skipping`)
    note(`ledger: only ${allCompacts.length} Compact entries available — need 3 to fold, skipping`)
    return { kind: 'no-tissue' }
  }
  const compacts = [...allCompacts].sort((a, b) => {
    const ap = parseBlockTimeRange(a.timeRange)
    const bp = parseBlockTimeRange(b.timeRange)
    const aKey = `${ap.startDate || '0000-00-00'} ${ap.startTime || '00:00'}`
    const bKey = `${bp.startDate || '0000-00-00'} ${bp.startTime || '00:00'}`
    return aKey.localeCompare(bKey)
  })
  note(`ledger: folding Compacts ${compacts.slice(0, 3).map(c => c.label).join(', ')} → 1 Ledger entry`)

  const toFold = compacts.slice(0, 3)
  const foldedLabels = toFold.map((c) => c.label)

  // Time range — parse each Compact's parens content. Compact title parens
  // can carry dates in two shapes: `YYYY-MM-DD HH:MM → YYYY-MM-DD HH:MM` or
  // `YYYY-MM-DD HH:MM → HH:MM` (same-day). Fall back to today if undated.
  const firstParsed = parseBlockTimeRange(toFold[0].timeRange)
  const lastParsed = parseBlockTimeRange(toFold[toFold.length - 1].timeRange)
  const startDate = firstParsed.startDate || new Date().toISOString().slice(0, 10)
  const startTime = firstParsed.startTime || '00:00'
  const endDate = lastParsed.endDate || lastParsed.startDate || startDate
  const endTime = lastParsed.endTime || '00:00'
  const ledgerHeaderRange = formatLedgerRange(startDate, startTime, endDate, endTime)

  const combinedText = toFold.map((c) => c.text).join('\n\n')
  const combinedBytes = Buffer.byteLength(combinedText, 'utf-8')

  // Build agent prompt — no title, dash-prefix header, prose body only.
  const agentFile = loadSage240_40()
  const userMessage =
    `## TASK — LEDGER PASS (3 COMPACTS → 1 LEDGER ENTRY)\n\n` +
    `Below are the three OLDEST Compact entries from the file. Fold them ` +
    `into a SINGLE Ledger entry. A Ledger entry has NO title — header is ` +
    `just a dash-prefixed date/time line, followed by ONE or TWO prose ` +
    `paragraphs (~30% the byte count of the three Compacts combined). ` +
    `Preserve the arc across all three Compacts. User quotes inline in ` +
    `italics. Timestamps woven into prose. No bullet lists. No bold. No ` +
    `block-letter range. No title.\n\n` +
    `**Ledger header (VERBATIM, dash-prefix included):** \`- ${ledgerHeaderRange}\`\n\n` +
    `## OUTPUT — strictly this format, nothing else\n\n` +
    `Line 1 MUST be exactly: \`- ${ledgerHeaderRange}\`\n` +
    `Line 2: blank.\n` +
    `Line 3 onward: ONE or TWO prose paragraphs synthesizing the three ` +
    `Compacts. NO preamble. NO closing remarks. NO explanation. NO bold. ` +
    `NO bullet lists.\n\n` +
    `## THREE COMPACTS TO FOLD\n\n` +
    combinedText

  if (triageLogPath) {
    try {
      const { appendFile } = await import('fs/promises')
      await appendFile(
        triageLogPath,
        `### LEDGER prompt — ${stageLabel || 'ledger'}\n` +
          `foldedLabels=${foldedLabels.join(',')} headerRange="${ledgerHeaderRange}" combinedBytes=${combinedBytes}\n` +
          '```\n' + userMessage + '\n```\n',
        'utf-8',
      )
    } catch {}
  }
  const response = await callAnthropic(
    DREAMER_MODEL,
    userMessage,
    agentFile,
    undefined,
    onStreamEvent,
    signal,
  )
  if (triageLogPath) {
    try {
      const { appendFile } = await import('fs/promises')
      await appendFile(
        triageLogPath,
        `### LEDGER response — ${stageLabel || 'ledger'}\n` +
          '```\n' + (response || '<null>') + '\n```\n',
        'utf-8',
      )
    } catch {}
  }
  if (!response) {
    console.error('[sage-240-40] ledger: agent returned null')
    return { kind: 'agent-fail' }
  }

  // Extract Ledger entry — Ralph 2026-05-18 bugfix:
  //   Old regex used /m flag with `$` in the lookahead alternation. /m
  //   makes `$` match end-of-LINE (not end-of-STRING), so the lazy
  //   [\s\S]+? exited immediately after the dash-header — the prose
  //   body was silently stripped. Result: file had header lines only,
  //   zero real Ledger entries written.
  //
  //   New approach: find the FIRST dash-date header anywhere in the
  //   response, then take the entire remainder as the ledger entry.
  //   No lazy quantifier, no /m+$ interaction.
  const cleaned = response.replace(/```(?:markdown|md)?\s*\n?/g, '').replace(/```\s*$/g, '').trim()
  const ledgerStartRe = /^-\s+\d{2}\.[A-Z][a-z]{2}\.\d{2}\s+\d{2}:\d{2}\s+→/m
  const startMatch = cleaned.match(ledgerStartRe)
  if (!startMatch || startMatch.index === undefined) {
    console.error('[sage-240-40] ledger: no dash-date header in agent response')
    console.error('[sage-240-40] First 400 chars:', cleaned.slice(0, 400))
    return { kind: 'agent-fail' }
  }
  const ledgerEntry = cleaned.slice(startMatch.index).trim()

  // Verify header line matches what we sent — defensive against the agent
  // editing the date/time.
  const headerLine = ledgerEntry.split('\n')[0].trim()
  const expectedHeader = `- ${ledgerHeaderRange}`
  if (headerLine !== expectedHeader) {
    console.error(
      `[sage-240-40] ledger: header mismatch — agent emitted "${headerLine}", JS sent "${expectedHeader}". Refusing splice.`,
    )
    return { kind: 'agent-fail' }
  }

  // ── Two-stage edit:
  //   1. Remove the 3 Compact entries wherever they sit
  //   2. Insert the Ledger entry at the END of `## LEDGER` (flat list,
  //      no date sub-headers in LEDGER).
  const after = [...lines]
  const removeFrom = toFold[0].startLine
  let removeTo = toFold[toFold.length - 1].endLine
  while (removeTo < after.length && after[removeTo].trim() === '') removeTo++
  after.splice(removeFrom, removeTo - removeFrom)

  // Sweep up an orphaned `### YYYY-MM-DD` sub-header directly above the
  // removal point if it has no other entries left under it.
  if (removeFrom > 0) {
    const above = after[removeFrom - 1]
    if (above && /^###\s+\d{4}-\d{2}-\d{2}/.test(above.trim())) {
      // Check if anything else follows the sub-header before next sub/section
      let onlyBlanks = true
      for (let i = removeFrom; i < after.length; i++) {
        const l = after[i].trim()
        if (l === '') continue
        if (/^###\s|^##\s/.test(l)) break
        onlyBlanks = false
        break
      }
      if (onlyBlanks) {
        after.splice(removeFrom - 1, 1)
      }
    }
  }

  const ledgerSection = findSectionBounds(after, /^##\s+LEDGER\b/i, { lastMatch: true })
  if (!ledgerSection) {
    console.error('[sage-240-40] ledger: no ## LEDGER section to insert into')
    return { kind: 'agent-fail' }
  }

  // Insert at END of LEDGER section (before the next `## ` boundary,
  // chronological order maintained by oldest-first fold ordering).
  const insertAt = ledgerSection.end
  after.splice(insertAt, 0, '', ledgerEntry, '')

  await writeFile(sessionMdPath, after.join('\n'), 'utf-8')

  const ledgerBytes = Buffer.byteLength(ledgerEntry, 'utf-8')
  return {
    kind: 'ok',
    timeRange: ledgerHeaderRange,
    foldedCount: toFold.length,
    foldedLabels,
    bytesCut: combinedBytes - ledgerBytes,
  }
}

/**
 * Extract `(chunkDate, chunkStartTime, chunkEndTime)` from a chunk of dialogue lines.
 *
 * Ralph 2026-04-25 — handles every turn-line format the bridge writes:
 *   `#### User | 2026-04-20 23:52:52`  (full date + time + seconds)
 *   `#### User | 2026-04-20 23:52`     (date + time, no seconds)
 *   `#### User | 19:21:13`             (time only with seconds — common!)
 *   `#### User | 23:50`                (time only no seconds)
 *
 * Algorithm:
 *   1. Walk forward → first `#### User|CD | …` line gives start time
 *      (and date, if present)
 *   2. Walk backward → last `#### User|CD | …` line gives end time
 *      (and date, if present)
 *   3. If no date found in any turn line, derive from `sessionMdPath`
 *      (which always contains `…/{YYYY-MM-DD-N}/SESSION.md`)
 *   4. As last resort, fall back to today.
 *
 * Output times are normalized to `HH:MM` (drop seconds) so block headers
 * stay short — `(15:28 → 15:47)` not `(15:28:07 → 15:47:23)`.
 */
function extractTimestampsFromChunk(
  chunkLines: string[],
  sessionMdPath: string,
): {
  chunkDate: string             // start date (back-compat alias for `chunkStartDate`)
  chunkStartDate: string
  chunkEndDate: string
  chunkStartTime: string
  chunkEndTime: string
} {
  // Match a turn line and capture optional date + time (with optional seconds).
  // Examples it matches:
  //   `#### User | 2026-04-20 23:52:52`  → date=2026-04-20 time=23:52
  //   `#### User | 19:21:13`             → date=undefined time=19:21
  //   `#### CD | 23:50`                  → date=undefined time=23:50
  const turnRe =
    /^####\s+(?:User|CD)\s*\|\s*(?:(\d{4}-\d{2}-\d{2})\s+)?(\d{2}:\d{2})(?::\d{2})?\b/i

  let startTime: string | null = null
  let endTime: string | null = null
  let firstDate: string | null = null
  let lastDate: string | null = null

  // Walk forward for start
  for (const ln of chunkLines) {
    const m = ln.match(turnRe)
    if (m) {
      startTime = m[2]
      if (m[1]) firstDate = m[1]
      break
    }
  }
  // Walk backward for end
  for (let i = chunkLines.length - 1; i >= 0; i--) {
    const m = chunkLines[i].match(turnRe)
    if (m) {
      endTime = m[2]
      if (m[1]) lastDate = m[1]
      break
    }
  }

  // Derive dates — start prefers first-turn date, end prefers last-turn date.
  // Fallbacks: sessionId date → today. End date falls back to start date.
  const sidMatch = sessionMdPath.match(/(\d{4}-\d{2}-\d{2})(?:-\d+)?\/SESSION\.md$/i)
  const sidDate = sidMatch ? sidMatch[1] : new Date().toISOString().slice(0, 10)

  const chunkStartDate = firstDate || lastDate || sidDate
  const chunkEndDate = lastDate || firstDate || chunkStartDate

  return {
    chunkDate: chunkStartDate,
    chunkStartDate,
    chunkEndDate,
    chunkStartTime: startTime || '00:00',
    chunkEndTime: endTime || startTime || '00:00',
  }
}

/**
 * Find the first line of "living tissue" — the first line past the
 * compressed/protected zones that should be cut.
 *
 * 2026-04-30 (Ralph): the previous "first `#### User |` after USER SESSION
 * DATA" anchor was a positive-pattern match. It silently skipped past
 * 2,000+ lines of legacy tissue using older schemas (`## SESSION RESTORED`,
 * `### YYYY-MM-DDTHH:MM:SSZ — cd-rewrite`, raw markdown) and started
 * cutting from the freshest dialogue — eating today's lunch while leaving
 * stale legacy floor untouched. New algorithm anchors on a NEGATIVE
 * pattern: walk forward, classify each line as compressed/structural/
 * tissue, and stop at the first tissue line. Schema-agnostic.
 *
 * Compressed = a paragraph belonging to a `**Block X — …**` or
 *              `**Compact …**` entry.
 * Structural = blank, `---`, `### YYYY-MM-DD` date sub-header,
 *              `## SESSION RESTORED — …` boot marker.
 * Tissue     = anything else.
 *
 * Zero-Block fallback: if no Blocks/Compacts exist anywhere, the walk
 * still works — it returns the first non-structural line past the marker.
 *
 * Returns -1 when the section contains no living tissue.
 */
/**
 * Find the cut anchor — the line where the LAST Block in [usdIdx, sectionEnd)
 * has its narrative END.
 *
 * Ralph 2026-05-02: "cut from the END of the LAST block. From the end."
 *
 * "Last Block" = highest line number that opens with `**Block X — title** (...)`.
 * Using FILE POSITION (not alphabetic letter) handles the case where stale
 * duplicate letters live in old `## SESSION RESTORED — …` zones below the
 * most-recent real Block — the agent should still cut the cruft AFTER the
 * top-of-file Block (the most recent real one), not chase the duplicate letter.
 *
 * The "end" of a Block's narrative = the line of the next strong boundary
 * encountered while walking forward from the Block opening. Boundaries:
 *   - Another `**Block X —` or `**Compact X —` opening
 *   - Any `###` or `##` header
 *   - A raw `#### User|CD |` turn header
 *   - A `---` separator line  ← KEY DIFFERENCE from old findFirstLivingTissue,
 *                                 which silently consumed `---` as part of the
 *                                 Block paragraph and ate orphan prose with it
 *
 * Returns null when no Blocks exist below the marker (fresh-session case —
 * caller should fall back to findFirstLivingTissue).
 */
export function findCutAnchorAfterLastBlock(
  lines: string[],
  usdIdx: number,
  sectionEnd: number,
): { cutStart: number; reason: string } | null {
  // Ralph 2026-05-03 — simple, single-pass logic per spec:
  //
  //   1. Find the LAST `**Block X — ` line in scan range (any letter,
  //      stub or real, dated or undated — file position wins).
  //   2. Walk forward from that line until the FIRST real tissue turn
  //      header — `#### User | …` or `#### CD | …`. EVERYTHING ELSE
  //      (SESSION RESTORED markers, `---` separators, stub Block
  //      openings, blank lines, prose continuations, date sub-headers)
  //      is just content to step past. Real tissue starts at a turn
  //      header and only at a turn header.
  //   3. cutStart = that turn header's line.
  //
  // Fresh-session fallback: if there are no Blocks at all in scan range,
  // cutStart = the first `#### User | …` line after USD.
  //
  // This drops every previous knob: no SESSION RESTORED zone-skip
  // bookkeeping, no `---` hard-boundary handling, no `^##\s` walk-stop.
  // The walk has ONE stop condition: a real turn header.
  const blockOpeningRe = /^\*\*Block\s+[A-Z]+\s+[—-]\s+/
  const turnHeaderRe = /^####\s+(?:User|CD)\s*\|/i

  let lastBlockLine = -1
  for (let i = usdIdx + 1; i < sectionEnd; i++) {
    if (blockOpeningRe.test(lines[i])) lastBlockLine = i
  }

  const walkFrom = lastBlockLine === -1 ? usdIdx + 1 : lastBlockLine + 1
  for (let i = walkFrom; i < sectionEnd; i++) {
    if (turnHeaderRe.test(lines[i])) {
      return {
        cutStart: i,
        reason:
          lastBlockLine === -1
            ? 'fresh-session-no-blocks'
            : `after-block-at-line-${lastBlockLine + 1}`,
      }
    }
  }

  // No turn header found between the last Block and sectionEnd — the
  // file is fully compressed (or empty of real conversation).
  return null
}

/**
 * Find the most recent Block's end-time across the whole tissue section.
 * Returns the highest "YYYY-MM-DD HH:MM" string found in the parens of
 * any Block title — or null if no Blocks have parseable dated titles.
 *
 * This is used by `findLiveTissueLine` to protect raw User turns whose
 * timestamps are NEWER than this — those are unbloked live conversation
 * and must NOT be eaten by a cut.
 */
export function findMostRecentBlockEndTime(
  lines: string[],
  usdIdx: number,
  sectionEnd: number,
): string | null {
  const headerRe = /^\*\*Block\s+[A-Z]+\s+[—-]\s+.+?\*\*\s*\(([^)]+)\)\s*$/i
  let latestEnd = ''
  for (let i = usdIdx + 1; i < sectionEnd; i++) {
    const m = lines[i].match(headerRe)
    if (!m) continue
    const parsed = parseBlockTimeRange(m[1].trim())
    if (parsed.endDate && parsed.endTime) {
      const endStr = `${parsed.endDate} ${parsed.endTime}`
      if (endStr > latestEnd) latestEnd = endStr
    }
  }
  return latestEnd || null
}

/**
 * Walk [cutStart, cutEnd) looking for the first `#### User | YYYY-MM-DD HH:MM[:SS]`
 * turn whose timestamp is STRICTLY LATER than `protectAfter`. Returns its
 * line index. Returns -1 when no live tissue is found in the window.
 *
 * Caller uses this to cap cutEnd so the cut does NOT reach into live
 * conversation. If `protectAfter` is null (no Blocks have dated titles
 * yet), no protection applies and cutEnd stays at the requested boundary.
 */
export function findLiveTissueLine(
  lines: string[],
  cutStart: number,
  cutEnd: number,
  protectAfter: string | null,
): number {
  if (!protectAfter) return -1
  const userTurnDateRe = /^####\s+User\s*\|\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/i
  for (let i = cutStart; i < cutEnd; i++) {
    const m = lines[i].match(userTurnDateRe)
    if (m && m[1] > protectAfter) return i
  }
  return -1
}

function findFirstLivingTissue(
  lines: string[],
  sectionStart: number,
  sectionEnd: number,
): number {
  const isBlockOpening = (l: string) =>
    /^\*\*Block\s+[A-Z]+\s+[—-]\s+/.test(l) || /^\*\*Compact\s+/.test(l)
  const isStructural = (l: string) => {
    const s = l.trim()
    return (
      s === '' ||
      s === '---' ||
      /^###\s+\d{4}-\d{2}-\d{2}/.test(l) ||
      /^##\s+SESSION RESTORED/i.test(l)
    )
  }

  let i = sectionStart + 1
  while (i < sectionEnd) {
    const line = lines[i]

    if (isBlockOpening(line)) {
      // Skip the entry's paragraph: walk forward until we hit a boundary.
      // Boundaries: another Block/Compact opening, any `###`/`##` heading,
      // a `#### User|CD |` turn header (modern tissue), or a legacy
      // `### YYYY-MM-DDTHH:MM:SSZ —` event header. Anything else inside
      // the Block paragraph (prose lines, internal blank lines for
      // multi-paragraph Blocks, internal `---` separators in CD prose) is
      // consumed as part of the entry.
      i++
      while (i < sectionEnd) {
        const ln = lines[i]
        if (
          isBlockOpening(ln) ||
          /^###\s/.test(ln) ||
          /^##\s/.test(ln) ||
          /^####\s+(?:User|CD)\s*\|/i.test(ln)
        ) break
        i++
      }
      continue
    }

    if (isStructural(line)) {
      i++
      continue
    }

    // First non-structural, non-compressed line = living tissue.
    return i
  }
  return -1
}

/**
 * Parse a Block/Compact title's parenthesized time range into structured
 * fields. Handles three formats in the wild:
 *
 *   `2026-04-29 22:17 → 2026-04-30 01:34`  (cross-day, full)
 *   `2026-04-30 11:42 → 12:05`             (same-day, dated start only)
 *   `01:53 → 02:41`                        (legacy, undated)
 *
 * `endDate` falls back to `startDate`. Both dates may be null on legacy.
 */
function parseBlockTimeRange(
  range: string,
): { startDate: string | null; startTime: string; endDate: string | null; endTime: string } {
  const dated = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/g
  const dates: string[] = []
  const times: string[] = []
  let m: RegExpExecArray | null
  while ((m = dated.exec(range)) !== null) {
    dates.push(m[1])
    times.push(m[2])
  }
  if (dates.length >= 2) {
    return { startDate: dates[0], startTime: times[0], endDate: dates[1], endTime: times[1] }
  }
  if (dates.length === 1) {
    // Dated start only — find the second time without a date prefix.
    const undatedTime = range.match(/→\s*(\d{2}:\d{2})\s*$/)?.[1] || times[0]
    return { startDate: dates[0], startTime: times[0], endDate: dates[0], endTime: undatedTime }
  }
  // Legacy `(HH:MM → HH:MM)`
  const tt = range.match(/(\d{2}:\d{2})\s*→\s*(\d{2}:\d{2})/)
  if (tt) return { startDate: null, startTime: tt[1], endDate: null, endTime: tt[2] }
  return { startDate: null, startTime: '00:00', endDate: null, endTime: '00:00' }
}

/** Format a dated time range for Block/Compact titles.
 *  Same-day → `YYYY-MM-DD HH:MM → HH:MM`
 *  Cross-day → `YYYY-MM-DD HH:MM → YYYY-MM-DD HH:MM` */
function formatDatedTimeRange(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string,
): string {
  if (startDate === endDate) return `${startDate} ${startTime} → ${endTime}`
  return `${startDate} ${startTime} → ${endDate} ${endTime}`
}

/** Increment a Block letter alphabetically: A→B, Z→AA, AZ→BA, ZZ→AAA. */
function nextBlockLetter(seen: string[]): string {
  if (seen.length === 0) return 'A'
  // Find highest letter by length first, then alphabetic order
  const highest = seen.reduce((a, b) => {
    if (a.length !== b.length) return a.length > b.length ? a : b
    return a > b ? a : b
  })
  // Increment like a base-26 counter
  const chars = highest.split('')
  let carry = 1
  for (let i = chars.length - 1; i >= 0 && carry; i--) {
    const code = chars[i].charCodeAt(0) - 65 + carry
    if (code >= 26) {
      chars[i] = 'A'
      carry = 1
    } else {
      chars[i] = String.fromCharCode(65 + code)
      carry = 0
    }
  }
  if (carry) chars.unshift('A')
  return chars.join('')
}

// ─── Triage-log parsers (lean — the response is SHORT, just the tagged log) ──

function parseSagePortraitTriageLog(response: string): string {
  // Grab the ### TRIAGE_LOG section; fall back to the whole response if the
  // model didn't wrap it (tolerate slight format drift).
  const m = response.match(/### TRIAGE_LOG\s*\n([\s\S]*?)$/)
  return (m ? m[1] : response).trim() || '(no triage log produced)'
}

function parseSage240_40TriageLog(response: string): string {
  const m = response.match(/### TRIAGE_LOG\s*\n([\s\S]*?)$/)
  return (m ? m[1] : response).trim() || '(no triage log produced)'
}
