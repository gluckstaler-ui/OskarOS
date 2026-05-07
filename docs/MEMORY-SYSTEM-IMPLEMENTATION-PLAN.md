# OskarOS Memory System — Implementation Plan

> Status block added: 2026-05-01

---

## STATUS UPDATE — 2026-05-01

Plan body below is preserved for context. Of the five packages, P1/P3 shipped largely as planned with name changes; P2 (Consolidator) shipped as Lumberjack and is now **RETIRED** per Ralph 2026-05-01; P4 (Dreamer) shipped as **Sage** with a fundamentally different architecture; P5 (Migration) is partially shipped via `lib/memory/migrate.ts`.

The companion spec `DREAMER-IMPLEMENTATION-SPEC.md` is wholly superseded — see its 2026-05-01 status block.

### STATUS PACKAGE 1 — Foundation - SHIPPED

**SHIPPED:** `lib/memory/paths.ts` (path layout, getSessionMdPath, getUserMemoryPath, getDreamLogPath, getLogsDir); `logs/` directory creation in session bootstrap; per-session `session.md` + `user.md` seeded; raw monthly log + active memory buffer pattern operational.

**CHANGED:**
- The plan's `getConsolidatedSessionPath()` is now `getSessionMdPath()` — naming convention change.
- Double-buffer A/B with clock-based `activeBuffer()` swap — the path helpers exist but Sage's session-end + 24h pre-prune snapshot model made the hourly A/B swap moot. Treat the buffer functions as legacy.
- `appendToSessionLog()` dual-write evolved — now also writes to event-bus ring buffer for `replay_events`.

**DO NOT IMPLEMENT:**
- Reset path naming back to `getConsolidatedSessionPath()`. The `getSessionMdPath()` shape is correct.
- Add new code paths that depend on the A/B buffer swap. Sage doesn't use it.

### STATUS PACKAGE 2 — Consolidator - RETIRED 2026-05-01

**SHIPPED, THEN RENAMED, NOW RETIRED:** The plan's "Consolidator" agent shipped as **Lumberjack** (`agents/lumberjack-padawan.md`, `lib/memory/lumberjack.ts`). Single-call padawan replaced an earlier 7-stage CLI pipeline (2026-04-21). `runLumberjack()` + `maybeRunLumberjack()` (10-min cooldown) wired into `app/api/{chat,claude-code,order65,order66}` routes; `pauseLumberjack()` / `resumeLumberjack()` lock used by Sage to prevent concurrent SESSION.md writes.

**RETIRED 2026-05-01 (per Ralph):** Lumberjack the agent is retired. The code module `lib/memory/lumberjack.ts` and its hooks remain in tree (4 callers) for graceful removal, but **do not extend it, do not depend on it for new work, do not resurrect it under another name.** Sage 240/40 (`agents/sage-240-40.md` + `runSage240_40()` in `lib/memory/dreamer.ts`) is the production compaction path.

**CHANGED:**
- Three-zone STATE/ACTIVE/LEDGER consolidation prompt (the plan's spec) — partially superseded. Sage's 240/40 is byte-budget driven, not zone driven.
- `runConsolidation()` between-turn fire-and-forget pattern — kept structurally; the function is named `runLumberjack()` / `maybeRunLumberjack()` and lives in `lib/memory/lumberjack.ts`.

**OPEN:** Graceful removal of `lib/memory/lumberjack.ts` and its 4 caller hooks. Order matters — Sage 240/40 needs to be the verified path before the Lumberjack hooks come out. Until then: file stays in tree, do not edit it.

**DO NOT IMPLEMENT:**
- Re-create the "Consolidator" as a new module — it shipped as Lumberjack which is now retired.
- Add new triggers for Lumberjack (more API routes, more cooldown variants).
- Resurrect the 7-stage multi-CLI architecture Lumberjack scrapped on 2026-04-21.

### STATUS PACKAGE 3 — CD Agent Integration - SHIPPED

**SHIPPED:** `lib/cd-agent-prompt.ts` accepts the consolidated `session.md` + `user.md` + clock block; `app/api/chat/route.ts` and `app/api/chat-stream/route.ts` import path helpers from `lib/memory/paths.ts` and load the files before calling `buildCDPrompt()`. CD reads consolidated context, not raw `SESSION.md` tail.

**CHANGED:** The "clock block" with active-buffer metadata is much smaller now — Sage's session-end model means the clock matters less. The block reduced to a timestamp + recent-Sage-run marker.

**DO NOT IMPLEMENT:**
- Restore raw-`SESSION.md`-tail injection into CD's prompt as primary path — consolidated `session.md` is the contract.
- Treat the plan's `SessionFiles` interface snippet as canonical — the type has expanded.

### STATUS PACKAGE 4 — Dreamer - SHIPPED AS SAGE (different architecture)

**SHIPPED INSTEAD:** Sage subsystem replaced the planned Dreamer.
- `agents/sage-portrait.md` — paints user portrait (Jobs 1-3 of original dreamer-agent-production).
- `agents/sage-240-40.md` — 240/40 compression (Job 4).
- `lib/memory/dreamer.ts` — Sage runtime (file is named `dreamer.ts` for legacy reasons; agent identity is Sage).
- `app/api/dream/route.ts` — POST triggers `runDreamer()` which is the Sage portrait painter.

**CHANGED:** Architecture diverged on every axis from the plan.
- **Trigger:** plan was `setInterval` aligned to top-of-hour; Sage runs at session-end + explicit POST. No hourly cron.
- **Buffer model:** plan was process inactive A/B buffer; Sage processes the live `SESSION.md` directly with the 24h pre-prune snapshot for recovery.
- **Output:** plan was `### USER_MEMORY_UPDATE` / `### CONSOLIDATED_UPDATE` / `### TRIAGE_LOG` parser; Sage uses typed Edit/Write at known paths.
- **Model:** plan was Haiku (cheap); Sage uses Sonnet via `callAnthropicAgent()` because portrait quality matters.
- **`dreamer-timer.ts`** — DOES NOT EXIST. The plan's `startDreamerTimer()` / `triggerDream()` / `setInterval` were never built. Sage runs on session-end events instead.

**DO NOT IMPLEMENT:**
- `lib/memory/dreamer-timer.ts` — was never built and isn't needed. Sage runs on session-end events.
- Hourly clock-aligned auto-trigger for Sage. Session-end is the trigger.
- The `### USER_MEMORY_UPDATE` / `### CONSOLIDATED_UPDATE` / `### TRIAGE_LOG` structured-output parser. Sage uses Edit/Write tools.
- `parseDreamerOutput()` splitter. Doesn't exist.
- Multi-session dreamer support as it was framed — the plan said "later problem"; the answer turned out to be "session-end per session, no central clock."

### STATUS PACKAGE 5 — Migration + Cleanup - PARTIALLY SHIPPED

**SHIPPED:** `lib/memory/migrate.ts` exists. `loadCDAgentPrompt()` reads from `agents/creative-director-agent.md` per current path conventions.

**SHIPPED, then promoted:** The plan's "extract shared `callAnthropic()` to `lib/memory/anthropic.ts`" landed and became substantial — `lib/memory/anthropic.ts` is now 20KB and exposes `callAnthropic()` + `callAnthropicAgent()`. Used by Sage runtime + (the now-retired) Lumberjack.

**CHANGED:** Migration scope expanded to cover the Lumberjack→Sage transition (different from this plan's planned cleanup).

**DO NOT IMPLEMENT:**
- Re-migrate sessions that already have `logs/` directories. The migration is one-way idempotent and existing sessions are migrated.

### STATUS — What IS the source of truth for memory work today

Read these (not this plan):
- `agents/sage-portrait.md` + `agents/sage-240-40.md` — Sage agent specs
- `lib/memory/dreamer.ts` — runtime (filename is legacy; identity is Sage)
- `lib/memory/anthropic.ts` — Anthropic call layer
- `lib/memory/paths.ts` — current path layout
- `lib/memory/lumberjack.ts` — RETIRED, do not extend
- `app/api/dream/route.ts` — current API shape
- `agents/CD-MEMORY.md` — institutional memory CD reads on boot
- `docs/INSTITUTIONAL-MEMORY.md` — project-wide bug log + Don't-Do list

---

## Codebase Reality Check

Before building, here's what exists and what the spec assumes:

| Spec assumes | Codebase reality | Reconciliation |
|---|---|---|
| `{cafeSlug}` in paths | `sessionId` everywhere (e.g. `2026-01-26-falcamel-cafe`) | Use `sessionId`. Agent files updated. |
| lowercase `session.md` | Uppercase `SESSION.md` at `public/{sessionId}/SESSION.md` | New file: lowercase `session.md` = consolidated desk. Existing `SESSION.md` becomes the raw log (moves to `logs/`). |
| `new Anthropic()` SDK | Raw `fetch()` to Anthropic API throughout codebase | Use `fetch()` pattern from `claude-api-loop.ts` |
| `buildCDPrompt` async with file reads | Sync function: `buildCDPrompt(sourceImages, sessionId, isResume, sessionFiles)` | Keep sync signature. Add `userMd` and `clockBlock` to `SessionFiles` interface. Load them in the caller. |
| Generic `appendToSession()` | `appendToSessionLog(sessionId, agent, content)` at `session.ts:842` | Wrap existing function. Add second write for memory buffer. |
| Fire-and-forget hook | `chat-stream/route.ts` lines 514-521, after `event.type === 'result'` | Confirmed. Add consolidator call here. |
| Agent prompts in code | CD agent prompt loaded from `creative-director-agent.md` via `loadCDAgentPrompt()` | Same pattern: load consolidator + dreamer prompts from `agents/` directory. |

---

## File Layout (final)

```
OskarOS/
├── oskar-prototype/
│   ├── agents/                       # Agent prompt files (loaded at runtime)
│   │   ├── creative-director-agent.md  # CD agent (exists, already moved here)
│   │   ├── consolidator-agent.md       # Padawan Archivist (already moved here)
│   │   └── dreamer-agent.md            # Padawan Sage (already moved here)
│   │
│   ├── lib/
│   │   ├── memory/                   # NEW — all memory system code
│   │   │   ├── paths.ts              # File paths, buffer swap logic
│   │   │   ├── consolidator.ts       # Between-turn consolidator
│   │   │   ├── dreamer.ts            # Hourly dreamer
│   │   │   ├── dreamer-timer.ts      # Hourly timer aligned to top of hour
│   │   │   └── prompts.ts            # Prompt builders (load agent .md, interpolate)
│   │   ├── session.ts                # MODIFY — add dual-write to appendToSessionLog
│   │   └── cd-agent-prompt.ts        # MODIFY — inject user.md + clock block
│   │
│   ├── app/api/
│   │   ├── chat-stream/route.ts      # MODIFY — hook consolidator after result event
│   │   └── dream/route.ts            # NEW — POST/GET for dreamer
│   │
│   └── public/{sessionId}/
│       ├── session.md                # NEW — consolidated clean desk
│       ├── user.md                   # NEW — long-term memory
│       ├── CREATIVE-BRIEF.md         # EXISTS
│       ├── IMAGES.md                 # EXISTS
│       └── logs/                     # NEW directory
│           ├── SESSION-2026-04.md    # Raw append-only log (replaces current SESSION.md)
│           ├── MEMORY-SESSION-A.md   # Double-buffer A
│           ├── MEMORY-SESSION-B.md   # Double-buffer B
│           ├── .session-backup.md    # One-deep backup
│           ├── .last-dream-log.md    # Dreamer debug receipt
│           └── .last-consolidation-log.md  # Consolidator debug receipt
```

---

## Package 1: Foundation — Paths + File Layout + Dual-Write

**Goal:** The plumbing. No agents yet — just the file infrastructure that both agents depend on.

**Files to create/modify:**

### 1a. `lib/memory/paths.ts` (~40 lines) — NEW

```typescript
import path from 'path'

// Session base path — matches existing getSessionPath() in session.ts
export function getSessionDir(sessionId: string): string {
  return path.join(process.cwd(), 'public', sessionId)
}

export function getLogsDir(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'logs')
}

// The clean desk — consolidator writes, CD agent reads
export function getConsolidatedSessionPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'session.md')
}

// Long-term memory — dreamer writes, CD agent reads
export function getUserMemoryPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'user.md')
}

// Raw monthly log — app writes, consolidator tails
export function getRawLogPath(sessionId: string): string {
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return path.join(getLogsDir(sessionId), `SESSION-${month}.md`)
}

// Double-buffer: clock-based swap, no locks
export function activeBuffer(): 'A' | 'B' {
  return new Date().getHours() % 2 === 0 ? 'A' : 'B'
}

export function inactiveBuffer(): 'A' | 'B' {
  return activeBuffer() === 'A' ? 'B' : 'A'
}

export function getActiveBufferPath(sessionId: string): string {
  return path.join(getLogsDir(sessionId), `MEMORY-SESSION-${activeBuffer()}.md`)
}

export function getInactiveBufferPath(sessionId: string): string {
  return path.join(getLogsDir(sessionId), `MEMORY-SESSION-${inactiveBuffer()}.md`)
}

export function getSessionBackupPath(sessionId: string): string {
  return path.join(getLogsDir(sessionId), '.session-backup.md')
}

export function getDreamLogPath(sessionId: string): string {
  return path.join(getLogsDir(sessionId), '.last-dream-log.md')
}

export function getConsolidationLogPath(sessionId: string): string {
  return path.join(getLogsDir(sessionId), '.last-consolidation-log.md')
}
```

### 1b. Modify `lib/session.ts` — Dual-write + logs directory

Wrap the existing `appendToSessionLog()` to also write to the active memory buffer:

```typescript
// At the top of appendToSessionLog, after writing to SESSION.md:

// Also write to the active memory buffer for the dreamer
import { getActiveBufferPath, getLogsDir, getRawLogPath } from './memory/paths'
import { mkdir } from 'fs/promises'

export async function appendToSessionLog(
  sessionId: string,
  agent: string,
  content: string
): Promise<void> {
  const sessionPath = getSessionPath(sessionId)
  const logsDir = getLogsDir(sessionId)
  
  // Ensure logs directory exists
  await mkdir(logsDir, { recursive: true })
  
  const timestamp = new Date().toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  })

  const entry = `\n---\n#### ${agent} | ${timestamp}\n\n${content}\n`

  // Dual-write: raw monthly log + active memory buffer
  const rawLogPath = getRawLogPath(sessionId)
  const bufferPath = getActiveBufferPath(sessionId)

  const results = await Promise.allSettled([
    appendFile(rawLogPath, entry),
    appendFile(bufferPath, entry),
  ])

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[dual-write] Failed ${i === 0 ? 'raw log' : 'buffer'}:`, r.reason)
    }
  })
}
```

**Decision:** The existing `SESSION.md` path (`public/{sessionId}/SESSION.md`) currently serves as both the raw log AND the CD agent's context. After Package 1:
- The raw log moves to `logs/SESSION-{YYYY-MM}.md` (monthly, append-only)
- The active memory buffer writes to `logs/MEMORY-SESSION-{A|B}.md`
- The old `SESSION.md` continues to exist temporarily — the CD agent still reads it until Package 3 switches it to `session.md`

### 1c. Session bootstrapping

Add to session creation (wherever `createSession()` lives in `session.ts`):

```typescript
import { getConsolidatedSessionPath, getUserMemoryPath, getLogsDir } from './memory/paths'

// Inside createSession(), after creating the session directory:
await mkdir(getLogsDir(sessionId), { recursive: true })

// Seed session.md
await writeFile(getConsolidatedSessionPath(sessionId),
  `## STATE\n- Phase: Discovery\n- First session\n\n## ACTIVE\n(no exchanges yet)\n\n## LEDGER\n(empty)\n`
)

// Seed user.md from template
await writeFile(getUserMemoryPath(sessionId), USER_MD_TEMPLATE)
```

The `USER_MD_TEMPLATE` constant lives in `lib/memory/paths.ts` or a separate `lib/memory/templates.ts`.

### 1d. Test

- Create a session. Verify `logs/` directory created, `session.md` and `user.md` seeded.
- Send a message. Verify `logs/SESSION-{YYYY-MM}.md` AND `logs/MEMORY-SESSION-{A|B}.md` both receive the entry.
- Check which buffer is active based on current hour.

---

## Package 2: Consolidator — Between-Turn Agent

**Goal:** After every CD turn, compress the raw log tail into a clean three-zone `session.md`.

**Depends on:** Package 1 (paths, dual-write, logs directory)

**Files to create/modify:**

### 2a. `lib/memory/prompts.ts` (~30 lines) — NEW

Loads agent prompts from markdown files (same pattern as `loadCDAgentPrompt()`):

```typescript
import { readFileSync } from 'fs'
import path from 'path'

function loadAgentPrompt(filename: string): string {
  try {
    // agents/ lives inside oskar-prototype/ (same as process.cwd())
    const mdPath = path.join(process.cwd(), 'agents', filename)
    return readFileSync(mdPath, 'utf-8')
  } catch (error) {
    console.error(`Failed to load ${filename}:`, error)
    throw new Error(`Agent prompt ${filename} not found`)
  }
}

// Extract just the runtime prompt from the full agent file
// The actual prompt lives between ```...``` in "THE ACTUAL PROMPT" section
function extractRuntimePrompt(agentFile: string): string {
  const match = agentFile.match(/## THE ACTUAL PROMPT[\s\S]*?```\n([\s\S]*?)```/)
  if (!match) throw new Error('Could not extract runtime prompt from agent file')
  return match[1].trim()
}

export const CONSOLIDATOR_PROMPT_TEMPLATE = extractRuntimePrompt(loadAgentPrompt('consolidator-agent.md'))
export const DREAMER_PROMPT_TEMPLATE = extractRuntimePrompt(loadAgentPrompt('dreamer-agent.md'))
```

### 2b. `lib/memory/consolidator.ts` (~100 lines) — NEW

```typescript
import { readFile, writeFile, open, stat, mkdir } from 'fs/promises'
import {
  getConsolidatedSessionPath, getRawLogPath, getSessionBackupPath,
  getConsolidationLogPath, getLogsDir
} from './paths'
import { CONSOLIDATOR_PROMPT_TEMPLATE } from './prompts'

const CONSOLIDATOR_MODEL = 'claude-sonnet-4-20250514'
const TAIL_BYTES = 32_000  // ~32KB = last 20-30 exchanges

export async function runConsolidation(sessionId: string): Promise<void> {
  const logsDir = getLogsDir(sessionId)
  await mkdir(logsDir, { recursive: true })

  const sessionPath = getConsolidatedSessionPath(sessionId)
  const rawLogPath = getRawLogPath(sessionId)
  const backupPath = getSessionBackupPath(sessionId)
  const debugLogPath = getConsolidationLogPath(sessionId)

  // Read current consolidated state (our previous output)
  const currentSession = await readFile(sessionPath, 'utf-8').catch(() => '')

  // Tail-read: only last ~32KB of the raw log
  const rawTail = await readTail(rawLogPath, TAIL_BYTES)
  if (!rawTail.trim()) return

  // Build prompt from template
  const prompt = CONSOLIDATOR_PROMPT_TEMPLATE
    .replace('${currentSession || \'(first consolidation — create from scratch)\'}',
      currentSession || '(first consolidation — create from scratch)')
    .replace('${rawTail}', rawTail)

  // Call Sonnet via raw fetch (matches codebase pattern)
  const response = await callAnthropic(CONSOLIDATOR_MODEL, prompt, 4096)
  if (!response) return

  // One-deep backup before overwrite
  if (currentSession.trim()) {
    await writeFile(backupPath, currentSession, 'utf-8')
  }

  await Promise.all([
    writeFile(sessionPath, response, 'utf-8'),
    writeFile(debugLogPath,
      `# Consolidation — ${new Date().toISOString()}\n`
      + `## Tail size read: ${rawTail.length} bytes\n`
      + `## Previous session.md size: ${currentSession.length} bytes\n`
      + `## Output size: ${response.length} bytes\n`
      + `## Compression ratio: ${currentSession.length > 0 ? ((1 - response.length / Math.max(currentSession.length, rawTail.length)) * 100).toFixed(0) : 'N/A'}%\n`,
      'utf-8'
    ),
  ])
}

async function readTail(filePath: string, bytes: number): Promise<string> {
  try {
    const s = await stat(filePath)
    if (s.size <= bytes) {
      return await readFile(filePath, 'utf-8')
    }
    const fh = await open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(bytes)
      await fh.read(buffer, 0, bytes, s.size - bytes)
      const content = buffer.toString('utf-8')
      // Find first complete message boundary
      const firstBoundary = content.indexOf('\n#### ')
      return firstBoundary > 0 ? content.slice(firstBoundary + 1) : content
    } finally {
      await fh.close()
    }
  } catch {
    return ''
  }
}

async function callAnthropic(model: string, userMessage: string, maxTokens: number): Promise<string | null> {
  // Match codebase pattern: raw fetch to Anthropic API
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })
    const data = await res.json()
    const textBlock = data.content?.find((b: any) => b.type === 'text')
    return textBlock?.text || null
  } catch (err) {
    console.error('[consolidator] Anthropic call failed:', err)
    return null
  }
}
```

### 2c. Modify `app/api/chat-stream/route.ts` — Hook consolidator

At line ~521, after the `result` event handling:

```typescript
import { runConsolidation } from '@/lib/memory/consolidator'

// Inside the result event handler, after sendEvent({ type: 'done', ... }):
// Fire-and-forget — don't block the response
runConsolidation(effectiveSessionId).catch(err =>
  console.error(`[${requestId}] Consolidation failed:`, err)
)
```

### 2d. Test

- Send a few messages in a session.
- Check that `session.md` gets created with STATE / ACTIVE / LEDGER zones.
- Check that `logs/.session-backup.md` contains the previous version.
- Check that `logs/.last-consolidation-log.md` shows sane compression ratios.
- Check that the consolidator completes in <10 seconds.
- Verify the CD agent isn't blocked — the response arrives before consolidation finishes.

---

## Package 3: CD Agent Integration — Switch to Consolidated Context

**Goal:** The CD agent reads `session.md` (consolidated) + `user.md` instead of raw `SESSION.md`.

**Depends on:** Package 2 (consolidator producing `session.md`)

**Files to modify:**

### 3a. Modify `lib/cd-agent-prompt.ts`

Add `userMd` and `clockBlock` to the `SessionFiles` interface. Keep the function sync — the caller loads the files.

```typescript
export interface SessionFiles {
  sessionMd?: string
  creativeBriefMd?: string
  imagesMd?: string
  htmlFiles?: string[]
  // NEW fields:
  consolidatedSessionMd?: string  // from session.md (the clean desk)
  userMd?: string                 // from user.md (long-term memory)
  clockBlock?: string             // memory clock context
}
```

In `buildSessionContext()`, when `isResume` is true and `sessionFiles` is present:

```typescript
// Replace the SESSION.md injection with consolidated session + user memory
const sessionContext = sessionFiles.consolidatedSessionMd || sessionFiles.sessionMd || 'Not available'
const userMemoryBlock = sessionFiles.userMd
  ? `\n### USER MEMORY (cross-session, durable):\n${sessionFiles.userMd}\n`
  : ''
const clockBlock = sessionFiles.clockBlock || ''

// In the template:
// Replace:  ### SESSION.md Contents: ...${sessionFiles.sessionMd}...
// With:     ### Session Context: ...${sessionContext}...
//           ${userMemoryBlock}
//           ${clockBlock}
```

### 3b. Modify the caller that loads `SessionFiles`

Wherever `SessionFiles` is populated before calling `buildCDPrompt()` (likely in `chat-stream/route.ts` or `session.ts`), add:

```typescript
import { getConsolidatedSessionPath, getUserMemoryPath, activeBuffer, getDreamLogPath } from '@/lib/memory/paths'
import { readFile } from 'fs/promises'

// Load consolidated session + user memory
const consolidatedSessionMd = await readFile(getConsolidatedSessionPath(sessionId), 'utf-8').catch(() => undefined)
const userMd = await readFile(getUserMemoryPath(sessionId), 'utf-8').catch(() => undefined)

// Build clock block
const dreamLog = await readFile(getDreamLogPath(sessionId), 'utf-8').catch(() => '')
const dreamTimestamp = dreamLog.match(/^# Dream Cycle — (.+)$/m)?.[1] || 'never'
const clockBlock = consolidatedSessionMd || userMd ? `
## MEMORY CLOCK
- Current time: ${new Date().getHours()}:${String(new Date().getMinutes()).padStart(2, '0')}
- Active buffer: MEMORY-SESSION-${activeBuffer()}.md
- Dreamer last ran: ${dreamTimestamp}
` : ''

sessionFiles = {
  ...sessionFiles,
  consolidatedSessionMd,
  userMd,
  clockBlock,
}
```

### 3c. Test

- Resume a session. Verify the CD agent receives the three-zone `session.md` content (not raw SESSION.md).
- Verify `user.md` content appears in the prompt.
- Verify the clock block shows correct active buffer and dreamer timestamp.
- Verify a brand-new session (empty `session.md` seed) works — CD agent gets the seed, not confused empty blocks.

---

## Package 4: Dreamer — Hourly Agent

**Goal:** Every hour, triage the inactive memory buffer. Promote durable signals to `user.md`. Reinstate over-pruned context. Compress stale stubs. Flush the buffer.

**Depends on:** Package 1 (paths, buffers), Package 2 (consolidated session.md exists)

**Files to create:**

### 4a. `lib/memory/dreamer.ts` (~120 lines) — NEW

Core dreamer logic. Reads three files, calls Sonnet with dreamer prompt, parses structured output, writes results, flushes buffer.

Key implementation details:
- Uses the same `callAnthropic()` pattern from `consolidator.ts` (extract to shared util)
- `parseDreamerOutput()` splits response on `### USER_MEMORY_UPDATE`, `### CONSOLIDATED_UPDATE`, `### TRIAGE_LOG` headers
- Writes `user.md`, `session.md`, flushes inactive buffer, writes dream log — all in `Promise.all`
- Dream log includes ISO timestamp that `buildCDPrompt` reads for clock-awareness

### 4b. `lib/memory/dreamer-timer.ts` (~25 lines) — NEW

```typescript
let dreamerInterval: NodeJS.Timeout | null = null

export function startDreamerTimer(sessionId: string, baseUrl: string) {
  if (dreamerInterval) return

  const msUntilNextHour = ((60 - new Date().getMinutes()) * 60 - new Date().getSeconds()) * 1000

  setTimeout(() => {
    triggerDream(sessionId, baseUrl)
    dreamerInterval = setInterval(() => triggerDream(sessionId, baseUrl), 60 * 60 * 1000)
  }, msUntilNextHour)

  console.log(`[dreamer-timer] First dream in ${Math.round(msUntilNextHour / 60000)}m, then every hour`)
}

export function stopDreamerTimer() {
  if (dreamerInterval) {
    clearInterval(dreamerInterval)
    dreamerInterval = null
  }
}

async function triggerDream(sessionId: string, baseUrl: string) {
  try {
    const res = await fetch(`${baseUrl}/api/dream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    const data = await res.json()
    console.log(`[dreamer-timer] Dream complete:`, data)
  } catch (err) {
    console.error('[dreamer-timer] Dream failed:', err)
  }
}
```

### 4c. `app/api/dream/route.ts` (~40 lines) — NEW

```typescript
import { runDreamer } from '@/lib/memory/dreamer'
import { activeBuffer, inactiveBuffer } from '@/lib/memory/paths'

export async function POST(req: Request) {
  const { sessionId } = await req.json()
  if (!sessionId) return Response.json({ error: 'sessionId required' }, { status: 400 })

  const result = await runDreamer(sessionId)
  return Response.json({
    status: 'complete',
    timestamp: new Date().toISOString(),
    processedBuffer: `MEMORY-SESSION-${inactiveBuffer()}.md`,
    ...result.stats,
  })
}

export async function GET() {
  return Response.json({
    activeBuffer: activeBuffer(),
    inactiveBuffer: inactiveBuffer(),
    currentHour: new Date().getHours(),
  })
}
```

### 4d. Start the timer

In the app's startup code (likely `layout.tsx` server component or a custom server setup), after the app initializes:

```typescript
import { startDreamerTimer } from '@/lib/memory/dreamer-timer'
// Start dreamer for the active session
startDreamerTimer(activeSessionId, process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000')
```

### 4e. Test

- Run the dreamer manually: `POST /api/dream { sessionId: "2026-01-26-falcamel-cafe" }`
- Verify `user.md` gets populated with taste signals from the buffer.
- Verify the inactive buffer gets flushed to empty.
- Verify `session.md` is refined (stale LEDGER entries compressed).
- Verify `logs/.last-dream-log.md` shows the triage receipt with every buffer item tagged.
- Verify the timer fires at the top of the next hour.
- Verify an empty buffer produces `Buffer empty. Nothing to process.`

---

## Package 5: Migration + Cleanup

**Goal:** Handle the transition from the old `SESSION.md` to the new system. Clean up temporary scaffolding.

**Depends on:** Packages 1-4 all working

### 5a. Migrate existing sessions

For existing sessions that have a `SESSION.md` but no `logs/` directory:

```typescript
async function migrateSession(sessionId: string): Promise<void> {
  const sessionDir = getSessionDir(sessionId)
  const logsDir = getLogsDir(sessionId)
  const oldSessionMd = path.join(sessionDir, 'SESSION.md')

  // Skip if already migrated
  if (existsSync(path.join(logsDir, `SESSION-${currentMonth()}.md`))) return

  await mkdir(logsDir, { recursive: true })

  // Move existing SESSION.md content to the monthly raw log
  const content = await readFile(oldSessionMd, 'utf-8').catch(() => '')
  if (content) {
    await writeFile(getRawLogPath(sessionId), content, 'utf-8')
  }

  // Run the consolidator once to produce the initial session.md
  await runConsolidation(sessionId)

  // Seed user.md
  if (!existsSync(getUserMemoryPath(sessionId))) {
    await writeFile(getUserMemoryPath(sessionId), USER_MD_TEMPLATE, 'utf-8')
  }

  // Run the dreamer once to bootstrap user.md from existing conversation
  await runDreamer(sessionId)
}
```

### 5b. Update CD agent prompt loader

Agent files are already in `oskar-prototype/agents/`. Update `loadCDAgentPrompt()` in `cd-agent-prompt.ts` to read from `agents/` directory instead of `../creative-director-agent.md`:

```typescript
const mdPath = path.join(process.cwd(), 'agents', 'creative-director-agent.md')
```

### 5c. Extract shared Anthropic call utility

Both `consolidator.ts` and `dreamer.ts` need `callAnthropic()`. Extract to `lib/memory/anthropic.ts`:

```typescript
export async function callAnthropic(
  model: string, 
  userMessage: string, 
  maxTokens: number
): Promise<string | null> {
  // ... shared fetch logic
}
```

### 5d. Test

- Migrate an existing session with 100+ turns in SESSION.md. Verify the new `session.md` is <200 lines and correct.
- Verify `user.md` gets populated from the existing conversation history.
- Verify the old `SESSION.md` is preserved (we don't delete it).
- Run a full conversation: new session → 10 turns → verify consolidator runs after each → wait for dreamer → check all files.

---

## Build Sequence Summary

| Package | What | New files | Modified files | Depends on | Est. effort |
|---|---|---|---|---|---|
| **P1** | Foundation | `lib/memory/paths.ts` | `lib/session.ts` (dual-write + bootstrap) | Nothing | Half day |
| **P2** | Consolidator | `lib/memory/consolidator.ts`, `lib/memory/prompts.ts` | `app/api/chat-stream/route.ts` (hook) | P1 | One day |
| **P3** | CD Integration | — | `lib/cd-agent-prompt.ts`, caller that loads SessionFiles | P2 | Half day |
| **P4** | Dreamer | `lib/memory/dreamer.ts`, `lib/memory/dreamer-timer.ts`, `app/api/dream/route.ts` | App startup (timer init) | P1, P2 | One day |
| **P5** | Migration | `lib/memory/migrate.ts`, `lib/memory/anthropic.ts` | `cd-agent-prompt.ts` (path update) | P1-P4 | Half day |

**Total: ~3.5 days of focused work.**

P1 and P2 are sequential (P2 needs paths). P3 and P4 can run in parallel after P2. P5 is cleanup after everything works.

```
Day 1:  P1 (foundation) → P2 (consolidator)
Day 2:  P2 (finish + test) → P3 (CD integration, half day)
Day 3:  P4 (dreamer, parallel with P3 polish)
Day 4:  P5 (migration + cleanup) → end-to-end verification
```

---

## What's NOT in this plan

- **No admin UI** for viewing dream logs or user.md. Ralph reads the files directly for now.
- **No multi-session dreamer.** One session, one dreamer timer. Multi-session support is a later problem.
- **No user.md editor.** Ralph can edit user.md by hand if the dreamer gets something wrong.
- **No consolidator rollback logic.** The backup file exists but automatic rollback (detect garbage, restore backup) is not implemented. Manual recovery only.
- **No rate limiting** on the consolidator. If a user sends 50 messages in a minute, the consolidator fires 50 times. The tail-read optimization keeps each call cheap, but the API cost scales linearly. Throttling is a v2 concern.

---

## Reference Files

| File | Purpose | Location |
|---|---|---|
| `consolidator-agent.md` | Padawan Archivist identity + runtime prompt | `agents/` |
| `dreamer-agent.md` | Padawan Sage identity + runtime prompt | `agents/` |
| `user-md-spec.md` | Full user.md format specification | `OskarOS/` (from CD agent) |
| This file | Implementation plan | `OskarOS/MEMORY-SYSTEM-IMPLEMENTATION-PLAN.md` |
