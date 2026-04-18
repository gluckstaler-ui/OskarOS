# OskarOS Dreamer — Exhaustive Implementation Spec

> This spec is a 1:1 mapping of Claude Code's memory system onto OskarOS.
> Every concept, every function, every prompt, every integration point.
> A builder agent should be able to execute this without making judgment calls.

---

## THE MAPPING: Claude Code → OskarOS

| Claude Code Concept | Claude Code Implementation | OskarOS Equivalent |
|---|---|---|
| Memory directory | `~/.claude/projects/{sanitized-git-root}/memory/` | `oskar-prototype/memory/` (global, not per-session) |
| Path resolution | `getAutoMemPath()` with 3-way priority chain + security validation | Hardcoded: `join(process.cwd(), 'memory')` |
| MEMORY.md index | `ENTRYPOINT_NAME = 'MEMORY.md'`, max 200 lines / 25KB | Identical. Same file, same limits. |
| Topic files | `.md` files with YAML frontmatter (name, description, type) | Identical format. |
| Lock file | `.consolidate-lock` in memory dir, PID body, mtime = timestamp | Identical. `memory/.consolidate-lock` |
| Memory types | 4 types: user, feedback, project, reference | Same 4 types, same prompt strings (INDIVIDUAL variant) |
| Memory scan | `scanMemoryFiles()` — recursive readdir, parse frontmatter, sort | Port directly. Replace `readFileInRange` with `readFile` + manual stat |
| Memory manifest | `formatMemoryManifest()` — one line per file | Port verbatim |
| Memory age | `memoryAgeDays()`, `memoryAge()`, `memoryFreshnessNote()` | Port verbatim |
| Truncation | `truncateEntrypointContent()` — line-first then byte | Port verbatim |
| Query-time recall | `findRelevantMemories()` → Sonnet `sideQuery()` → ≤5 files | Port logic, replace `sideQuery()` with direct Anthropic API call |
| Selection prompt | `SELECT_MEMORIES_SYSTEM_PROMPT` | Port verbatim |
| autoDream trigger | `executeAutoDream()` — 3-gate system in stop hooks | Port gate logic into `checkGates()` function, call from API route |
| Gate 1 (time) | `readLastConsolidatedAt()` — stat lock mtime, compare to `minHours` | Port verbatim. Threshold: 4 hours (not 24) |
| Gate 2 (sessions) | `listSessionsTouchedSince()` — scan transcript files by mtime | Adapt: scan `public/*/SESSION.md` files by mtime instead of JSONL transcripts |
| Gate 3 (lock) | `tryAcquireConsolidationLock()` — PID write, verify read-back | Port verbatim |
| Scan throttle | 10-min cooldown between session scans when gate 2 fails | Drop. Dreams are API-triggered, not per-turn. |
| Lock rollback | `rollbackConsolidationLock(priorMtime)` — rewind mtime or unlink | Port verbatim |
| Consolidation prompt | `buildConsolidationPrompt()` — 4-phase template | Adapt: replace transcript grep instructions with session-file read instructions |
| Dream execution | `runForkedAgent()` with `createCacheSafeParams()` | Replace with `runClaudeAgentLoop()` from `claude-api-loop.ts` |
| Tool permissions | `createAutoMemCanUseTool()` — read anywhere, write only in memory dir | Implement as `executeDreamerTool()` wrapper around `executeTool()` |
| Progress tracking | `makeDreamProgressWatcher()` — track turns, text, touched files | Port as return data from the agent loop |
| Extract Memories | `initExtractMemories()` — post-turn cursor-based extraction | Adapt: hook into bridge response flow, use direct API call |
| Coalesced execution | `inProgress` + `pendingContext` + trailing run in `finally` | Port the pattern directly |
| Extraction prompt | `buildExtractAutoOnlyPrompt()` — opener + types + how-to-save | Port verbatim (INDIVIDUAL variant) |
| Session Memory | `sessionMemory.ts` — postSamplingHook, 10-section template | **DROP.** Bridge mode runs Claude CLI which has its own session memory. |
| Team memory | `teamMemPaths.ts`, `teamMemPrompts.ts` | **DROP.** Single-user app. |
| KAIROS daily-log | `buildAssistantDailyLogPrompt()` | **DROP.** Premature complexity. |
| Feature flags | GrowthBook `tengu_onyx_plover`, `tengu_bramble_lintel`, etc. | **DROP.** Hardcode all thresholds. |
| `runForkedAgent()` | Fork subprocess sharing prompt cache via `cacheSafeParams` | **DROP.** Use `runClaudeAgentLoop()` with Sonnet. |

---

## FILE-BY-FILE SPEC

### File 1: `lib/memory/paths.ts` (~20 lines)

```typescript
import { join } from 'path'
import { mkdir } from 'fs/promises'

// Global memory directory — shared across all sessions.
// Lives at oskar-prototype/memory/ (same level as public/, lib/, app/)
export const MEMORY_DIR = join(process.cwd(), 'memory')
export const ENTRYPOINT_NAME = 'MEMORY.md'
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000
export const LOCK_FILE = '.consolidate-lock'

export function memoryDir(): string {
  return MEMORY_DIR
}

export function lockPath(): string {
  return join(MEMORY_DIR, LOCK_FILE)
}

export function entrypointPath(): string {
  return join(MEMORY_DIR, ENTRYPOINT_NAME)
}

export async function ensureMemoryDir(): Promise<void> {
  await mkdir(MEMORY_DIR, { recursive: true })
}

// Check if a path is inside the memory directory
export function isMemoryPath(filePath: string): boolean {
  const { resolve } = require('path')
  return resolve(filePath).startsWith(resolve(MEMORY_DIR))
}
```

---

### File 2: `lib/memory/types.ts` (~200 lines)

This file contains the prompt strings from Claude Code's `memoryTypes.ts`. These are stolen VERBATIM — they are the product of extensive prompt engineering and eval-validated iterations.

```typescript
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== 'string') return undefined
  return MEMORY_TYPES.find(t => t === raw)
}

// --- Prompt strings (from Claude Code memoryTypes.ts, INDIVIDUAL variant) ---

export const TYPES_SECTION: readonly string[] = [
  '## Types of memory',
  '',
  'There are several discrete types of memory that you can store in your memory system:',
  '',
  '<types>',
  '<type>',
  '    <name>user</name>',
  "    <description>Contain information about the user's role, goals, responsibilities, and knowledge. Great user memories help you tailor your future behavior to the user's preferences and perspective. Your goal in reading and writing these memories is to build up an understanding of who the user is and how you can be most helpful to them specifically. Keep in mind, that the aim here is to be helpful to the user. Avoid writing memories about the user that could be viewed as a negative judgement or that are not relevant to the work you're trying to accomplish together.</description>",
  "    <when_to_save>When you learn any details about the user's role, preferences, responsibilities, or knowledge</when_to_save>",
  "    <how_to_use>When your work should be informed by the user's profile or perspective.</how_to_use>",
  '    <examples>',
  '    user: I run a café in Zurich and I need a booking page',
  '    assistant: [saves user memory: owner of Zurich café, needs booking page — Swiss German context, local business]',
  '',
  '    user: I hate minimalist designs, I want something bold and colorful',
  '    assistant: [saves user memory: strong preference for bold/colorful over minimalist — frame vibe options accordingly]',
  '    </examples>',
  '</type>',
  '<type>',
  '    <name>feedback</name>',
  "    <description>Guidance the user has given about how to approach work — both what to avoid and what to keep doing. These are a very important type of memory as they allow you to remain coherent and responsive to the way you should approach work. Record from failure AND success: if you only save corrections, you will avoid past mistakes but drift away from approaches the user has already validated.</description>",
  '    <when_to_save>Any time the user corrects your approach ("no not that", "don\'t", "stop doing X") OR confirms a non-obvious approach worked ("yes exactly", "perfect, keep doing that"). Corrections are easy to notice; confirmations are quieter — watch for them. Include *why* so you can judge edge cases later.</when_to_save>',
  '    <how_to_use>Let these memories guide your behavior so that the user does not need to offer the same guidance twice.</how_to_use>',
  '    <body_structure>Lead with the rule itself, then a **Why:** line and a **How to apply:** line.</body_structure>',
  '    <examples>',
  '    user: stop putting the hero image in a fixed container, it needs to scroll with the page',
  '    assistant: [saves feedback memory: hero images must scroll with page, not fixed. Applies to all vibe builds.]',
  '',
  '    user: yeah the parallax on the food images was the right call, keep doing that',
  '    assistant: [saves feedback memory: parallax on food/product images validated — use this pattern for visual-heavy sections]',
  '    </examples>',
  '</type>',
  '<type>',
  '    <name>project</name>',
  '    <description>Information about ongoing work, goals, or decisions within the project that is not otherwise derivable from the session files. Project memories help you understand the broader context and motivation behind the work.</description>',
  '    <when_to_save>When you learn what the user is trying to achieve, why, or by when. Always convert relative dates to absolute dates when saving.</when_to_save>',
  "    <how_to_use>Use these memories to understand the details and nuance behind the user's request and make better informed suggestions.</how_to_use>",
  '    <body_structure>Lead with the fact or decision, then **Why:** and **How to apply:** lines.</body_structure>',
  '    <examples>',
  '    user: the café has a special event space in the back room that we rent out for private parties',
  '    assistant: [saves project memory: café has rentable event space (back room) — booking page should include event booking, not just table reservations]',
  '',
  "    user: we're rebranding next month, the new colors are teal and coral",
  '    assistant: [saves project memory: rebrand coming (teal + coral) by 2026-05-08 — future vibe builds should use new palette]',
  '    </examples>',
  '</type>',
  '<type>',
  '    <name>reference</name>',
  '    <description>Stores pointers to where information can be found. These memories allow you to remember where to look to find up-to-date information.</description>',
  '    <when_to_save>When you learn about external resources and their purpose.</when_to_save>',
  '    <how_to_use>When the user references an external system or information that may be stored externally.</how_to_use>',
  '    <examples>',
  '    user: all our food photos are in the Google Drive folder called "Menu Shots 2026"',
  '    assistant: [saves reference memory: food photography source is Google Drive "Menu Shots 2026"]',
  '    </examples>',
  '</type>',
  '</types>',
  '',
]

export const WHAT_NOT_TO_SAVE: readonly string[] = [
  '## What NOT to save in memory',
  '',
  '- HTML/CSS patterns, vibe structures, or build conventions — these are derivable from the session files.',
  '- Image analysis results — already stored in IMAGES.md.',
  '- Creative brief content — already in CREATIVE-BRIEF.md.',
  '- Build progress or checkpoint state — already in BUILD.md.',
  '- Anything already documented in CD-MEMORY.md.',
  '- Ephemeral task details: current vibe being built, temporary state.',
  '',
  'These exclusions apply even when the user explicitly asks. If they ask to save something derivable from session files, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.',
]

export const TRUSTING_RECALL: readonly string[] = [
  '## Before recommending from memory',
  '',
  'A memory that names a specific file, image, or vibe is a claim that it existed *when the memory was written*. It may have been renamed, removed, or rebuilt since then.',
  '',
  '- If the memory names a file path: check the file exists.',
  '- If the memory names a vibe or image: verify it is still in the session.',
  '',
  '"The memory says X exists" is not the same as "X exists now."',
]

export const MEMORY_FRONTMATTER_EXAMPLE: readonly string[] = [
  '```markdown',
  '---',
  'name: {{memory name}}',
  'description: {{one-line description — used to decide relevance in future sessions, so be specific}}',
  `type: {{${MEMORY_TYPES.join(', ')}}}`,
  '---',
  '',
  '{{memory content — for feedback/project types, structure as: rule/fact, then **Why:** and **How to apply:** lines}}',
  '```',
]
```

**NOTE:** The examples above are adapted for OskarOS's domain (cafés, vibes, booking pages) instead of Claude Code's domain (code, git, PRs). The structure and philosophy are identical. The `WHAT_NOT_TO_SAVE` section is adapted because OskarOS's derivable-from-project-state is different from a code repo's.

---

### File 3: `lib/memory/scan.ts` (~90 lines)

Ported from `memoryScan.ts`. Replaces `readFileInRange` with standard `readFile` + `stat`.

```typescript
import { readdir, readFile, stat } from 'fs/promises'
import { basename, join } from 'path'
import { ENTRYPOINT_NAME, memoryDir } from './paths'
import { type MemoryType, parseMemoryType } from './types'

export type MemoryHeader = {
  filename: string
  filePath: string
  mtimeMs: number
  description: string | null
  type: MemoryType | undefined
}

const MAX_MEMORY_FILES = 200

// Simple YAML frontmatter parser — no external dependency needed.
// Reads --- delimited block, extracts key: value pairs.
function parseFrontmatter(content: string): Record<string, string> {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') return {}
  const result: Record<string, string> = {}
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') break
    const match = lines[i]?.match(/^(\w+):\s*(.+)/)
    if (match) result[match[1]] = match[2]
  }
  return result
}

/**
 * Scan memory directory for .md files, read frontmatter, return sorted headers.
 * Ported from Claude Code memoryScan.ts.
 */
export async function scanMemoryFiles(): Promise<MemoryHeader[]> {
  try {
    const dir = memoryDir()
    const entries = await readdir(dir, { recursive: true })
    const mdFiles = entries.filter(
      f => typeof f === 'string' && f.endsWith('.md') && basename(f) !== ENTRYPOINT_NAME
    )

    const results = await Promise.allSettled(
      mdFiles.map(async (relativePath): Promise<MemoryHeader> => {
        const filePath = join(dir, relativePath as string)
        const [content, stats] = await Promise.all([
          readFile(filePath, 'utf-8'),
          stat(filePath)
        ])
        // Only parse first 30 lines for frontmatter
        const head = content.split('\n').slice(0, 30).join('\n')
        const fm = parseFrontmatter(head)
        return {
          filename: relativePath as string,
          filePath,
          mtimeMs: stats.mtimeMs,
          description: fm.description || null,
          type: parseMemoryType(fm.type),
        }
      })
    )

    return results
      .filter((r): r is PromiseFulfilledResult<MemoryHeader> => r.status === 'fulfilled')
      .map(r => r.value)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_MEMORY_FILES)
  } catch {
    return []
  }
}

/**
 * Format headers as text manifest for agent injection.
 * Ported verbatim from Claude Code memoryScan.ts.
 */
export function formatMemoryManifest(memories: MemoryHeader[]): string {
  return memories
    .map(m => {
      const tag = m.type ? `[${m.type}] ` : ''
      const ts = new Date(m.mtimeMs).toISOString()
      return m.description
        ? `- ${tag}${m.filename} (${ts}): ${m.description}`
        : `- ${tag}${m.filename} (${ts})`
    })
    .join('\n')
}
```

---

### File 4: `lib/memory/age.ts` (~30 lines)

Ported VERBATIM from `memoryAge.ts`. Pure math, no dependencies.

```typescript
export function memoryAgeDays(mtimeMs: number): number {
  return Math.max(0, Math.floor((Date.now() - mtimeMs) / 86_400_000))
}

export function memoryAge(mtimeMs: number): string {
  const d = memoryAgeDays(mtimeMs)
  if (d === 0) return 'today'
  if (d === 1) return 'yesterday'
  return `${d} days ago`
}

export function memoryFreshnessText(mtimeMs: number): string {
  const d = memoryAgeDays(mtimeMs)
  if (d <= 1) return ''
  return (
    `This memory is ${d} days old. ` +
    `Memories are point-in-time observations, not live state — ` +
    `claims about session content, image assignments, or vibe structures may be outdated. ` +
    `Verify against current session files before asserting as fact.`
  )
}
```

---

### File 5: `lib/memory/truncate.ts` (~30 lines)

Extracted from `memdir.ts` truncateEntrypointContent().

```typescript
import { MAX_ENTRYPOINT_LINES, MAX_ENTRYPOINT_BYTES } from './paths'

/**
 * Truncate MEMORY.md content to fit within limits.
 * Line-truncate first (natural boundary), then byte-truncate at last newline.
 * Ported from Claude Code memdir.ts.
 */
export function truncateEntrypointContent(content: string): string {
  const lines = content.split('\n')

  // Line truncation first
  let truncated = lines.length > MAX_ENTRYPOINT_LINES
    ? lines.slice(0, MAX_ENTRYPOINT_LINES).join('\n')
    : content

  // Byte truncation at last newline
  const bytes = Buffer.byteLength(truncated, 'utf-8')
  if (bytes > MAX_ENTRYPOINT_BYTES) {
    const buf = Buffer.from(truncated, 'utf-8').subarray(0, MAX_ENTRYPOINT_BYTES)
    truncated = buf.toString('utf-8')
    const lastNewline = truncated.lastIndexOf('\n')
    if (lastNewline > 0) {
      truncated = truncated.substring(0, lastNewline)
    }
  }

  return truncated
}
```

---

### File 6: `lib/memory/consolidation-lock.ts` (~100 lines)

Ported from `consolidationLock.ts`. Removes Claude Code's dependency chain (`getAutoMemPath`, `getOriginalCwd`, `logForDebugging`, `isProcessRunning`, `listCandidates`, `getProjectDir`). Replaces with direct fs operations.

```typescript
import { mkdir, readFile, stat, unlink, utimes, writeFile, readdir } from 'fs/promises'
import { join } from 'path'
import { memoryDir, lockPath, ensureMemoryDir } from './paths'

const HOLDER_STALE_MS = 60 * 60 * 1000  // 1 hour

/**
 * Check if a PID is alive. Cross-platform.
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)  // signal 0 = check existence without killing
    return true
  } catch {
    return false
  }
}

/**
 * mtime of lock file = lastConsolidatedAt. 0 if absent.
 * Per-call cost: one stat.
 */
export async function readLastConsolidatedAt(): Promise<number> {
  try {
    const s = await stat(lockPath())
    return s.mtimeMs
  } catch {
    return 0
  }
}

/**
 * Acquire lock: write PID → verify read-back → return priorMtime.
 * Returns null if blocked (another process holds the lock).
 */
export async function tryAcquireConsolidationLock(): Promise<number | null> {
  const path = lockPath()

  let mtimeMs: number | undefined
  let holderPid: number | undefined
  try {
    const [s, raw] = await Promise.all([stat(path), readFile(path, 'utf8')])
    mtimeMs = s.mtimeMs
    const parsed = parseInt(raw.trim(), 10)
    holderPid = Number.isFinite(parsed) ? parsed : undefined
  } catch {
    // ENOENT — no prior lock
  }

  // Check if lock is held and not stale
  if (mtimeMs !== undefined && Date.now() - mtimeMs < HOLDER_STALE_MS) {
    if (holderPid !== undefined && isProcessRunning(holderPid)) {
      console.log(`[Dreamer] lock held by live PID ${holderPid}`)
      return null
    }
  }

  // Write our PID
  await ensureMemoryDir()
  await writeFile(path, String(process.pid))

  // Verify — two reclaimers both write, last PID wins, loser bails
  let verify: string
  try {
    verify = await readFile(path, 'utf8')
  } catch {
    return null
  }
  if (parseInt(verify.trim(), 10) !== process.pid) return null

  return mtimeMs ?? 0
}

/**
 * Rollback: rewind mtime on failure, or unlink if no prior lock existed.
 * Clears PID body so our process doesn't look like it's holding.
 */
export async function rollbackConsolidationLock(priorMtime: number): Promise<void> {
  const path = lockPath()
  try {
    if (priorMtime === 0) {
      await unlink(path)
      return
    }
    await writeFile(path, '')  // clear PID
    const t = priorMtime / 1000  // utimes wants seconds
    await utimes(path, t, t)
  } catch (e: unknown) {
    console.error(`[Dreamer] rollback failed: ${(e as Error).message}`)
  }
}

/**
 * Scan public/ for session folders with SESSION.md modified since sinceMs.
 * Adapted from Claude Code's listSessionsTouchedSince — scans session folders
 * instead of JSONL transcript files.
 */
export async function listSessionsTouchedSince(sinceMs: number): Promise<string[]> {
  const publicDir = join(process.cwd(), 'public')
  try {
    const entries = await readdir(publicDir, { withFileTypes: true })
    const sessionDirs = entries.filter(e => e.isDirectory() && e.name.startsWith('2'))

    const results = await Promise.allSettled(
      sessionDirs.map(async (dir) => {
        const sessionMd = join(publicDir, dir.name, 'SESSION.md')
        const s = await stat(sessionMd)
        return { sessionId: dir.name, mtime: s.mtimeMs }
      })
    )

    return results
      .filter((r): r is PromiseFulfilledResult<{ sessionId: string; mtime: number }> =>
        r.status === 'fulfilled' && r.value.mtime > sinceMs
      )
      .map(r => r.value.sessionId)
  } catch {
    return []
  }
}
```

**Key adaptation:** `listSessionsTouchedSince` scans `public/*/SESSION.md` by mtime instead of JSONL transcript files. Session folders start with `2` (year prefix like `2026-01-26-aperol-bar-ready`).

---

### File 7: `lib/memory/consolidation-prompt.ts` (~80 lines)

Adapted from `consolidationPrompt.ts`. The 4-phase structure is identical. Phase 2 is rewritten for OskarOS's session file structure.

```typescript
import { ENTRYPOINT_NAME, MAX_ENTRYPOINT_LINES } from './paths'

/**
 * Build the 4-phase consolidation prompt.
 * Adapted from Claude Code's buildConsolidationPrompt().
 *
 * Key difference: OskarOS sessions are structured markdown (SESSION.md,
 * IMAGES.md, BUILD.md, CREATIVE-BRIEF.md), not raw JSONL transcripts.
 * This is simpler — structured files beat transcript grep.
 */
export function buildConsolidationPrompt(
  memoryRoot: string,
  sessionsDir: string,
  sessionIds: string[],
): string {
  const sessionList = sessionIds.map(id => `- ${id}`).join('\n')

  return `# Dream: Memory Consolidation

You are performing a dream — a reflective pass over session files and your memory directory. Synthesize what you've learned across sessions into durable, well-organized memories so that future sessions can orient quickly.

Memory directory: \`${memoryRoot}\`
This directory already exists — write to it directly with the FileWrite tool (do not run mkdir or check for its existence).

Session files: \`${sessionsDir}\` (each subfolder contains SESSION.md, IMAGES.md, BUILD.md, CREATIVE-BRIEF.md)

---

## Phase 1 — Orient

- Read \`${memoryRoot}/${ENTRYPOINT_NAME}\` to see your current memory index
- Read any existing topic files in \`${memoryRoot}/\` to know what you already know
- Understand the current state before gathering new signal

## Phase 2 — Gather recent signal

Sessions to review (${sessionIds.length}):
${sessionList}

For each session, read the key files to extract signal:

1. **SESSION.md** — conversation flow, user preferences revealed during discovery, decisions made, what phase the session reached, what worked and what didn't
2. **CREATIVE-BRIEF.md** — customer profile, brand voice, color/typography specs, image assignments. Look for PATTERNS across sessions, not individual briefs.
3. **IMAGES.md** — image analysis results, status tags (HERO, B-ROLL, TRASH), what images were selected and why. Look for patterns in what makes a good hero image.
4. **BUILD.md** — build progress, hot-swap log, checkpoint history. Look for recurring build issues or successful patterns.

Read these files directly — they are structured markdown, not raw transcripts. Read each file with FileRead. Do NOT attempt to grep them.

Focus on signal that crosses session boundaries:
- User preferences that apply to ALL sessions (not just one customer)
- Patterns in what vibe styles work for which customer types
- Recurring build issues or successful workarounds
- Image selection patterns (what makes a good hero vs B-roll?)
- Discovery patterns (what questions produce the best creative briefs?)

## Phase 3 — Consolidate

For each thing worth remembering, write or update a memory file in \`${memoryRoot}/\`. Follow the memory type conventions from your instructions — it's the source of truth for what to save, how to structure it, and what NOT to save.

Focus on:
- Merging new signal into existing topic files rather than creating near-duplicates
- Converting relative dates ("yesterday", "last week") to absolute dates
- Deleting contradicted facts — if a newer session disproves an old memory, fix it at the source
- Use FileEdit to update existing files. Use FileWrite only for genuinely new topic files.

## Phase 4 — Prune and index

Update \`${ENTRYPOINT_NAME}\` so it stays under ${MAX_ENTRYPOINT_LINES} lines AND under ~25KB. It's an **index**, not a dump — each entry should be one line under ~150 characters: \`- [Title](file.md) — one-line hook\`. Never write memory content directly into it.

- Remove pointers to memories that are now stale or superseded
- Add pointers to newly important memories
- Resolve contradictions — if two files disagree, fix the wrong one

---

**Tool constraints for this run:** You can READ files anywhere in \`${sessionsDir}\` (all session folders). You can WRITE and EDIT files only in \`${memoryRoot}/\`. Bash is restricted to read-only commands. WebFetch and WebSearch are not available.

Return a brief summary of what you consolidated, updated, or pruned. If nothing changed (memories are already tight), say so.`
}
```

---

### File 8: `lib/memory/dream-engine.ts` (~180 lines)

The core. Adapted from `autoDream.ts`. Replaces `runForkedAgent()` with `runClaudeAgentLoop()`. Replaces feature flags with hardcoded thresholds.

```typescript
import { join } from 'path'
import { readLastConsolidatedAt, tryAcquireConsolidationLock, rollbackConsolidationLock, listSessionsTouchedSince } from './consolidation-lock'
import { buildConsolidationPrompt } from './consolidation-prompt'
import { scanMemoryFiles, formatMemoryManifest } from './scan'
import { memoryDir, ensureMemoryDir } from './paths'
import { TYPES_SECTION, WHAT_NOT_TO_SAVE, TRUSTING_RECALL, MEMORY_FRONTMATTER_EXAMPLE } from './types'
import { executeTool, type ToolResult } from '../tool-executor'
import { isMemoryPath } from './paths'

// --- Gate thresholds (hardcoded, no feature flags) ---
const MIN_HOURS = 4       // 4 hours between dreams (not 24 — OskarOS sessions are frequent)
const MIN_SESSIONS = 3    // 3 sessions modified since last dream

// --- Tool definitions for the Dreamer (subset of CLAUDE_TOOL_DEFINITIONS) ---
const DREAMER_TOOLS = [
  {
    name: 'FileRead',
    description: 'Read a file. Returns text content with line numbers.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file' },
        offset: { type: 'number', description: 'Line to start from (0-based)' },
        limit: { type: 'number', description: 'Max lines to return' }
      },
      required: ['file_path']
    }
  },
  {
    name: 'FileWrite',
    description: 'Write content to a file in the memory directory. Creates if absent, overwrites if exists.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path inside memory/ directory' },
        content: { type: 'string', description: 'Full content to write' }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'FileEdit',
    description: 'Find-and-replace in a memory file. Only works on files inside memory/ directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path inside memory/ directory' },
        old_string: { type: 'string', description: 'Text to find' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: { type: 'boolean', description: 'Replace all occurrences' }
      },
      required: ['file_path', 'old_string', 'new_string']
    }
  },
  {
    name: 'Glob',
    description: 'Find files by name pattern.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Glob pattern' },
        path: { type: 'string', description: 'Directory to search' }
      },
      required: ['pattern']
    }
  },
  {
    name: 'Grep',
    description: 'Search file contents by regex.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Regex pattern' },
        path: { type: 'string', description: 'File or directory to search' },
        '-i': { type: 'boolean', description: 'Case insensitive' }
      },
      required: ['pattern']
    }
  }
]

// --- Split-permission tool executor ---

async function executeDreamerTool(
  toolCall: { name: string; input: Record<string, any> },
): Promise<ToolResult> {
  const { name, input } = toolCall
  const publicDir = join(process.cwd(), 'public')
  const memDir = memoryDir()

  // WRITE/EDIT: only in memory directory
  if (name === 'FileWrite' || name === 'FileEdit') {
    const filePath = input.file_path
    if (!filePath || !isMemoryPath(filePath)) {
      return { name, content: `Error: ${name} only allowed in memory directory (${memDir}). Got: ${filePath}`, isError: true }
    }
    return executeTool(toolCall, memDir)
  }

  // READ: allowed in public/ and memory/
  if (name === 'FileRead') {
    const { resolve } = require('path')
    const resolved = resolve(input.file_path)
    if (!resolved.startsWith(resolve(publicDir)) && !resolved.startsWith(resolve(memDir))) {
      return { name, content: `Error: FileRead only allowed in public/ or memory/. Got: ${input.file_path}`, isError: true }
    }
    // Use the resolved path's parent as sessionPath for tool-executor
    return executeTool(toolCall, resolve(input.file_path, '..'))
  }

  // GLOB/GREP: allowed in public/ and memory/
  if (name === 'Glob' || name === 'Grep') {
    const searchPath = input.path || publicDir
    const { resolve } = require('path')
    const resolved = resolve(searchPath)
    if (!resolved.startsWith(resolve(publicDir)) && !resolved.startsWith(resolve(memDir))) {
      return { name, content: `Error: ${name} only allowed in public/ or memory/. Got: ${searchPath}`, isError: true }
    }
    return executeTool(toolCall, resolved)
  }

  // Everything else: denied
  return { name, content: `Error: Tool ${name} is not available to the Dreamer agent.`, isError: true }
}

// --- Types ---

export interface DreamResult {
  dreamed: boolean
  reason?: string
  sessionIds?: string[]
  filesWritten?: string[]
  turns?: number
  finalText?: string
}

// --- Gate check ---

export async function checkGates(): Promise<{ pass: boolean; reason: string; sessionIds?: string[] }> {
  // Gate 1: Time
  const lastAt = await readLastConsolidatedAt()
  const hoursSince = (Date.now() - lastAt) / 3_600_000
  if (hoursSince < MIN_HOURS) {
    return { pass: false, reason: `Only ${hoursSince.toFixed(1)}h since last dream (need ${MIN_HOURS}h)` }
  }

  // Gate 2: Sessions
  const sessionIds = await listSessionsTouchedSince(lastAt)
  if (sessionIds.length < MIN_SESSIONS) {
    return { pass: false, reason: `Only ${sessionIds.length} sessions since last dream (need ${MIN_SESSIONS})` }
  }

  // Gate 3: Lock
  const priorMtime = await tryAcquireConsolidationLock()
  if (priorMtime === null) {
    return { pass: false, reason: 'Another dream process is running' }
  }

  // Release lock immediately — we'll re-acquire in the dream function
  await rollbackConsolidationLock(priorMtime)

  return { pass: true, reason: 'All gates passed', sessionIds }
}

// --- Dream execution ---

async function executeDream(sessionIds: string[]): Promise<DreamResult> {
  await ensureMemoryDir()

  // Acquire lock
  const priorMtime = await tryAcquireConsolidationLock()
  if (priorMtime === null) {
    return { dreamed: false, reason: 'Lock acquisition failed' }
  }

  try {
    const memDir = memoryDir()
    const publicDir = join(process.cwd(), 'public')

    // Pre-scan existing memories for the manifest
    const existingMemories = formatMemoryManifest(await scanMemoryFiles())

    // Build the system prompt with memory type instructions
    const typeInstructions = [
      ...TYPES_SECTION,
      ...WHAT_NOT_TO_SAVE,
      '',
      '## How to save memories',
      '',
      'Write each memory to its own file using this frontmatter format:',
      '',
      ...MEMORY_FRONTMATTER_EXAMPLE,
      '',
      '- Organize memory semantically by topic, not chronologically',
      '- Update or remove memories that are wrong or outdated',
      '- Check existing files before creating duplicates',
      '',
      ...TRUSTING_RECALL,
    ].join('\n')

    // Build the consolidation prompt
    const consolidationPrompt = buildConsolidationPrompt(memDir, publicDir, sessionIds)

    // Inject existing memory manifest
    const userPrompt = existingMemories.length > 0
      ? `${consolidationPrompt}\n\n## Existing memory files\n\n${existingMemories}\n\nCheck this list before writing — update existing files rather than creating duplicates.`
      : consolidationPrompt

    // Run the agent loop
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      await rollbackConsolidationLock(priorMtime)
      return { dreamed: false, reason: 'ANTHROPIC_API_KEY not set' }
    }

    // Direct Anthropic API call with Sonnet (cost-optimized for consolidation)
    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
      { role: 'user', content: userPrompt }
    ]

    const filesWritten: string[] = []
    let finalText = ''
    let turns = 0
    const maxTurns = 10

    for (let turn = 0; turn < maxTurns; turn++) {
      turns++

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 16384,
          system: typeInstructions,
          tools: DREAMER_TOOLS,
          messages
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        await rollbackConsolidationLock(priorMtime)
        return { dreamed: false, reason: `API error ${response.status}: ${errorText}` }
      }

      const result = await response.json() as { content: any[]; stop_reason: string }

      // Collect text and tool_use blocks
      const toolUseBlocks: Array<{ type: 'tool_use'; id: string; name: string; input: any }> = []
      for (const block of result.content) {
        if (block.type === 'text') finalText = block.text
        if (block.type === 'tool_use') toolUseBlocks.push(block)
      }

      messages.push({ role: 'assistant', content: result.content })

      // No tool calls = done
      if (toolUseBlocks.length === 0 || result.stop_reason === 'end_turn') break

      // Execute tool calls with split permissions
      const toolResults = []
      for (const toolUse of toolUseBlocks) {
        const toolResult = await executeDreamerTool({ name: toolUse.name, input: toolUse.input })

        // Track written files
        if ((toolUse.name === 'FileWrite' || toolUse.name === 'FileEdit') && !toolResult.isError) {
          filesWritten.push(toolUse.input.file_path)
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: toolResult.content,
          is_error: toolResult.isError
        })
      }

      messages.push({ role: 'user', content: toolResults })
    }

    // Success — lock mtime stays at now (marks completion time)
    console.log(`[Dreamer] completed — ${filesWritten.length} files written in ${turns} turns`)

    return {
      dreamed: true,
      sessionIds,
      filesWritten: [...new Set(filesWritten)],
      turns,
      finalText
    }
  } catch (e: unknown) {
    console.error(`[Dreamer] failed: ${(e as Error).message}`)
    await rollbackConsolidationLock(priorMtime)
    return { dreamed: false, reason: (e as Error).message }
  }
}

/**
 * Check gates and dream if all pass.
 */
export async function checkAndDream(): Promise<DreamResult> {
  const gates = await checkGates()
  if (!gates.pass) return { dreamed: false, reason: gates.reason }
  return executeDream(gates.sessionIds!)
}

/**
 * Force dream — bypass gates, for manual trigger and testing.
 */
export async function forceDream(): Promise<DreamResult> {
  const lastAt = await readLastConsolidatedAt()
  const sessionIds = await listSessionsTouchedSince(lastAt)
  if (sessionIds.length === 0) {
    // If no sessions since last dream, scan ALL sessions
    const allSessions = await listSessionsTouchedSince(0)
    return executeDream(allSessions)
  }
  return executeDream(sessionIds)
}
```

---

### File 9: `lib/memory/recall.ts` (~100 lines)

Query-time memory recall. Adapted from `findRelevantMemories.ts`. Replaces `sideQuery()` with direct Anthropic API call.

```typescript
import { readFile } from 'fs/promises'
import { scanMemoryFiles, formatMemoryManifest, type MemoryHeader } from './scan'
import { memoryFreshnessText } from './age'

const SELECT_MEMORIES_SYSTEM_PROMPT = `You are selecting memories that will be useful to a Creative Director AI agent as it works on a booking page session. You will be given context about the session and a list of available memory files with their filenames and descriptions.

Return a JSON object with a "selected_memories" array of filenames for the memories that will clearly be useful (up to 5). Only include memories you are certain will be helpful based on their name and description.
- If you are unsure if a memory will be useful, do not include it. Be selective and discerning.
- If no memories would clearly be useful, return an empty array.`

/**
 * Find memory files relevant to a session context.
 * Calls Sonnet to select ≤5 relevant files from the memory manifest.
 * Returns file contents with staleness warnings.
 *
 * Adapted from Claude Code's findRelevantMemories + selectRelevantMemories.
 */
export async function recallRelevantMemories(
  sessionContext: string,
  alreadySurfaced: Set<string> = new Set()
): Promise<Array<{ filename: string; content: string; freshnessNote: string }>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return []

  try {
    // Scan available memories
    const allMemories = await scanMemoryFiles()
    const memories = allMemories.filter(m => !alreadySurfaced.has(m.filePath))
    if (memories.length === 0) return []

    // Ask Sonnet to select relevant files
    const manifest = formatMemoryManifest(memories)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        system: SELECT_MEMORIES_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Session context: ${sessionContext}\n\nAvailable memories:\n${manifest}`
        }]
      })
    })

    if (!response.ok) return []

    const result = await response.json() as { content: Array<{ type: string; text?: string }> }
    const textBlock = result.content.find(b => b.type === 'text')
    if (!textBlock?.text) return []

    // Parse selected filenames
    const parsed = JSON.parse(textBlock.text) as { selected_memories: string[] }
    const validFilenames = new Set(memories.map(m => m.filename))
    const selectedFilenames = parsed.selected_memories.filter(f => validFilenames.has(f))

    // Read selected files and attach staleness warnings
    const byFilename = new Map(memories.map(m => [m.filename, m]))
    const results = await Promise.allSettled(
      selectedFilenames.map(async (filename) => {
        const header = byFilename.get(filename)!
        const content = await readFile(header.filePath, 'utf-8')
        return {
          filename,
          content,
          freshnessNote: memoryFreshnessText(header.mtimeMs)
        }
      })
    )

    return results
      .filter((r): r is PromiseFulfilledResult<{ filename: string; content: string; freshnessNote: string }> =>
        r.status === 'fulfilled'
      )
      .map(r => r.value)
  } catch (e) {
    console.error(`[Memory Recall] failed: ${(e as Error).message}`)
    return []
  }
}
```

---

### File 10: `lib/memory/extract.ts` (~150 lines)

Post-turn memory extractor. Adapted from `extractMemories.ts`. Implements the coalesced execution pattern.

```typescript
import { scanMemoryFiles, formatMemoryManifest } from './scan'
import { memoryDir, isMemoryPath } from './paths'
import { TYPES_SECTION, WHAT_NOT_TO_SAVE, MEMORY_FRONTMATTER_EXAMPLE } from './types'
import { executeTool, type ToolResult } from '../tool-executor'

// --- Closure-scoped state ---
let inProgress = false
let pendingContext: { recentMessages: string } | undefined
let lastExtractedMessageCount = 0

// --- Tool executor with memory-only writes ---
async function executeExtractTool(
  toolCall: { name: string; input: Record<string, any> }
): Promise<ToolResult> {
  const { name, input } = toolCall
  const memDir = memoryDir()

  if (name === 'FileWrite' || name === 'FileEdit') {
    if (!input.file_path || !isMemoryPath(input.file_path)) {
      return { name, content: `Error: writes only allowed in ${memDir}`, isError: true }
    }
    return executeTool(toolCall, memDir)
  }

  if (name === 'FileRead') {
    return executeTool(toolCall, memDir)
  }

  return { name, content: `Error: Tool ${name} not available`, isError: true }
}

// --- Build extraction prompt ---
// Adapted from Claude Code extractMemories/prompts.ts buildExtractAutoOnlyPrompt

function buildExtractionPrompt(messageCount: number, existingMemories: string): string {
  const manifest = existingMemories.length > 0
    ? `\n\n## Existing memory files\n\n${existingMemories}\n\nCheck this list before writing — update an existing file rather than creating a duplicate.`
    : ''

  const opener = [
    `You are the memory extraction subagent. Analyze the recent messages below and use them to update persistent memory.`,
    '',
    `Available tools: FileRead, FileEdit, FileWrite (memory directory only).`,
    '',
    `You have a limited turn budget. Efficient strategy: turn 1 — issue all FileRead calls in parallel for every file you might update; turn 2 — issue all FileWrite/FileEdit calls in parallel. Do not interleave reads and writes across multiple turns.`,
    '',
    `You MUST only use content from the messages provided. Do not attempt to investigate or verify further.` + manifest,
  ].join('\n')

  const howToSave = [
    '## How to save memories',
    '',
    'Saving a memory is a two-step process:',
    '',
    '**Step 1** — write the memory to its own file (e.g., `user_preferences.md`, `feedback_vibe_patterns.md`) using this frontmatter format:',
    '',
    ...MEMORY_FRONTMATTER_EXAMPLE,
    '',
    '**Step 2** — add a pointer in `MEMORY.md`. Each entry: one line, under ~150 characters: `- [Title](file.md) — one-line hook`. Never write memory content into `MEMORY.md`.',
    '',
    '- Organize by topic, not chronologically',
    '- Update or remove wrong/outdated memories',
    '- Check existing files before creating duplicates',
  ]

  return [
    opener,
    '',
    'If the user explicitly asked to remember something, save it immediately. If they asked to forget, find and remove the entry.',
    '',
    ...TYPES_SECTION,
    ...WHAT_NOT_TO_SAVE,
    '',
    ...howToSave,
  ].join('\n')
}

// --- Extraction tools (subset) ---
const EXTRACT_TOOLS = [
  {
    name: 'FileRead',
    description: 'Read a file from the memory directory.',
    input_schema: {
      type: 'object' as const,
      properties: { file_path: { type: 'string', description: 'Path to read' } },
      required: ['file_path']
    }
  },
  {
    name: 'FileWrite',
    description: 'Write a file in the memory directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path in memory/' },
        content: { type: 'string', description: 'Content to write' }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'FileEdit',
    description: 'Edit a file in the memory directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path in memory/' },
        old_string: { type: 'string', description: 'Text to find' },
        new_string: { type: 'string', description: 'Replacement' },
        replace_all: { type: 'boolean' }
      },
      required: ['file_path', 'old_string', 'new_string']
    }
  }
]

// --- Core extraction logic ---

async function runExtraction(recentMessages: string): Promise<void> {
  inProgress = true
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return

    const existingMemories = formatMemoryManifest(await scanMemoryFiles())
    const systemPrompt = buildExtractionPrompt(10, existingMemories)

    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
      { role: 'user', content: `Here are the recent messages to analyze:\n\n${recentMessages}` }
    ]

    for (let turn = 0; turn < 5; turn++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: systemPrompt,
          tools: EXTRACT_TOOLS,
          messages
        })
      })

      if (!response.ok) break
      const result = await response.json() as { content: any[]; stop_reason: string }

      const toolUses = result.content.filter((b: any) => b.type === 'tool_use')
      messages.push({ role: 'assistant', content: result.content })

      if (toolUses.length === 0 || result.stop_reason === 'end_turn') break

      const toolResults = []
      for (const tu of toolUses) {
        const tr = await executeExtractTool({ name: tu.name, input: tu.input })
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: tr.content, is_error: tr.isError })
      }
      messages.push({ role: 'user', content: toolResults })
    }

    console.log('[Extract] extraction complete')
  } catch (e) {
    console.error(`[Extract] error: ${(e as Error).message}`)
  } finally {
    inProgress = false

    // Coalesced execution: if a call arrived while we were running,
    // run one trailing extraction with the latest stashed context.
    const trailing = pendingContext
    pendingContext = undefined
    if (trailing) {
      console.log('[Extract] running trailing extraction for stashed context')
      await runExtraction(trailing.recentMessages)
    }
  }
}

/**
 * Extract memories from recent messages. Fire-and-forget.
 * Implements Claude Code's coalesced execution pattern.
 */
export async function extractMemoriesIfNeeded(recentMessages: string): Promise<void> {
  if (inProgress) {
    // Stash for trailing run — only latest matters
    pendingContext = { recentMessages }
    return
  }
  await runExtraction(recentMessages)
}
```

---

### File 11: `app/api/dream/route.ts` (~50 lines)

The API route. Trigger point for the Dreamer.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { checkAndDream, forceDream, checkGates } from '@/lib/memory/dream-engine'

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const force = searchParams.get('force') === 'true'
  const dryRun = searchParams.get('dry-run') === 'true'

  try {
    // Dry run: just check gates, don't dream
    if (dryRun) {
      const gates = await checkGates()
      return NextResponse.json(gates)
    }

    const result = force ? await forceDream() : await checkAndDream()
    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      { dreamed: false, reason: error.message },
      { status: 500 }
    )
  }
}

// GET for status check
export async function GET() {
  try {
    const gates = await checkGates()
    return NextResponse.json(gates)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
```

---

### File 12: MODIFY `lib/cd-agent-prompt.ts`

Add memory recall to the CD agent's prompt at session start/resume.

**Add import at top:**
```typescript
import { recallRelevantMemories } from './memory/recall'
import { readFile } from 'fs/promises'
import { entrypointPath } from './memory/paths'
```

**Add new function:**
```typescript
/**
 * Build memory context for the CD agent.
 * Reads MEMORY.md index + recalls ≤5 relevant files via Sonnet.
 */
async function buildMemoryContext(sessionContext: string): Promise<string> {
  try {
    // Always include the memory index
    let memoryBlock = ''
    try {
      const index = await readFile(entrypointPath(), 'utf-8')
      if (index.trim()) {
        memoryBlock += `## Memory Index\n\n${index}\n\n`
      }
    } catch {
      // No memory index yet — first run
    }

    // Recall relevant memories
    const memories = await recallRelevantMemories(sessionContext)
    if (memories.length > 0) {
      memoryBlock += '## Recalled Memories\n\n'
      for (const m of memories) {
        memoryBlock += `### ${m.filename}\n`
        if (m.freshnessNote) memoryBlock += `> ${m.freshnessNote}\n\n`
        memoryBlock += m.content + '\n\n---\n\n'
      }
    }

    return memoryBlock
  } catch (e) {
    console.error('[Memory] recall failed:', (e as Error).message)
    return ''
  }
}
```

**Modify `buildCDPrompt()` to call it:**
```typescript
export async function buildCDPrompt(
  sourceImages: Array<{ path: string; analysis?: object }> = [],
  sessionId: string = 'default-session',
  isResume: boolean = false,
  sessionFiles?: SessionFiles
): Promise<string> {  // Changed to async
  const agentPrompt = loadCDAgentPrompt()
  const sessionContext = buildSessionContext(sourceImages, sessionId, isResume, sessionFiles)

  // Recall relevant memories
  const memoryContext = await buildMemoryContext(
    `Session: ${sessionId}, Resume: ${isResume}, Images: ${sourceImages.length}`
  )

  return memoryContext + sessionContext + agentPrompt
}
```

**NOTE:** This changes `buildCDPrompt` from sync to async. All callers must be updated to `await` it. Check: `app/api/chat/route.ts`, `app/api/chat-stream/route.ts`, and any other files that call `buildCDPrompt`.

---

### File 13: MODIFY `app/api/chat-stream/route.ts` (or equivalent bridge chat route)

Hook extraction after bridge response completes.

**Add import:**
```typescript
import { extractMemoriesIfNeeded } from '@/lib/memory/extract'
```

**After yielding the final 'result' event from bridge, add:**
```typescript
// Fire-and-forget memory extraction after each complete response
// Collects recent user+assistant messages from this exchange
const recentMessages = `User: ${userMessage}\n\nAssistant: ${assistantResponse}`
extractMemoriesIfNeeded(recentMessages).catch(err => {
  console.error('[Extract] background extraction failed:', err.message)
})
```

The exact integration point depends on how the chat-stream route yields events. The key constraint: call AFTER the response is fully sent to the user, not during streaming. Fire-and-forget — don't await.

---

### Seed Files

**Create `oskar-prototype/memory/MEMORY.md`:**
```markdown
# OskarOS Memory

(Dreamer will populate this index after first consolidation run)
```

**Create `oskar-prototype/memory/.consolidate-lock`:**
Empty file. Its mtime (creation time) will be epoch-recent, so the time gate won't block the first dream.

---

## BUILD ORDER

| Step | Files | Depends On | Test |
|---|---|---|---|
| 1 | paths.ts, types.ts, scan.ts, age.ts, truncate.ts | nothing | Create test memory file, verify scan picks it up |
| 2 | consolidation-lock.ts | paths.ts | Acquire lock, verify PID in file, rollback, verify mtime rewound |
| 3 | consolidation-prompt.ts | paths.ts | Generate prompt, verify session IDs appear in output |
| 4 | dream-engine.ts | steps 1-3, tool-executor.ts | POST /api/dream?force=true with existing sessions |
| 5 | app/api/dream/route.ts | dream-engine.ts | curl -X POST localhost:3000/api/dream?force=true |
| 6 | recall.ts | scan.ts, age.ts | Create 10 memory files, call recall, verify Sonnet picks ≤5 |
| 7 | Modify cd-agent-prompt.ts | recall.ts | Start session, verify memory context in prompt |
| 8 | extract.ts | scan.ts, types.ts, tool-executor.ts | Send message through bridge, verify extraction creates memory file |
| 9 | Modify chat-stream route | extract.ts | End-to-end: chat → extract → memory file appears |

Each step is self-contained and testable. The builder agent should execute them in order.

---

## WHAT DOES NOT CHANGE

- `lib/tool-executor.ts` — not modified, just imported
- `lib/session.ts` — not modified
- `lib/bridge-process-manager.ts` — not modified
- WebDev build pipeline — not modified
- Frontend components — not modified (UI integration is Phase 5, not in this spec)
- Any existing API routes — not modified

---

*Every function signature, every prompt string, every integration point.*
*A builder agent reads this and writes code. No judgment calls needed.*
