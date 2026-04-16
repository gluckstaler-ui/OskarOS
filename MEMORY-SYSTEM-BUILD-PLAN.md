# OskarOS Memory System — Build Plan

> What to steal from Claude Code, what to adapt, what to skip.
> Goal: maximum capability from minimum code. No bloat.

---

## INVENTORY: WHAT WE'RE WORKING WITH

### OskarOS (exists today)
```
lib/bridge-process-manager.ts   278 lines  — persistent CLI process, stream-json I/O
lib/cd-agent-prompt.ts          164 lines  — prompt builder + session restore context
lib/tool-executor.ts            ~400 lines — FileRead/Write/Edit, Glob, Grep, Bash
lib/session.ts                  ~800 lines — session lifecycle, metadata, file I/O
public/{session-id}/            flat files — SESSION.md, IMAGES.md, BUILD.md, CREATIVE-BRIEF.md
agents/CD-MEMORY.md             ~600 lines — identity file (Layer 1 equivalent)
```

### Claude Code Source (available to steal)
```
STEAL VERBATIM (pure fs/strings, no runtime dependencies):
  memdir/memoryScan.ts            95 lines  — recursive dir scan + frontmatter read
  memdir/memoryAge.ts             54 lines  — staleness utils
  services/autoDream/
    consolidationLock.ts         141 lines  — lock file = timestamp trick
    consolidationPrompt.ts        65 lines  — 4-phase prompt template
  services/extractMemories/
    prompts.ts                   155 lines  — extraction efficiency prompts

EXTRACT STRINGS ONLY (big files, but we only need the prompt text):
  memdir/memoryTypes.ts          272 lines  → ~80 lines of prompt strings
  memdir/memdir.ts               508 lines  → ~60 lines of truncation logic
  memdir/findRelevantMemories.ts 142 lines  → ~40 lines of selection prompt

ADAPT LOGIC (right patterns, wrong plumbing):
  services/autoDream/autoDream.ts     325 lines → ~150 lines (gates + execution)
  services/extractMemories/
    extractMemories.ts                616 lines → ~120 lines (coalesced execution)

DROP ENTIRELY:
  services/SessionMemory/*           — bridge process gets this free from CLI
  memdir/paths.ts                    — OskarOS controls its own paths
  memdir/teamMemPaths.ts             — single-user app
  memdir/teamMemPrompts.ts           — single-user app
  All runForkedAgent/cacheSafeParams  — CLI subprocess infra, we call API directly
```

**Estimated total new code: ~1,000 lines across 5 phases**
**Estimated stolen/adapted: ~500 lines from Claude Code source**

---

## THE BUILD: 5 PHASES

---

### PHASE 1: Memory Directory (`lib/memory/`)

**What it is:** The filesystem layer. MEMORY.md index + topic files with frontmatter.

**New files:**
```
lib/memory/
├── paths.ts          — memory dir resolution (trivial: hardcode to public/{sessionId}/memory/)
├── scan.ts           — STOLEN from memoryScan.ts (read dir, parse frontmatter, sort)
├── age.ts            — STOLEN from memoryAge.ts (staleness math + human-readable strings)
├── types.ts          — memory types + prompt strings EXTRACTED from memoryTypes.ts
├── truncate.ts       — MEMORY.md truncation EXTRACTED from memdir.ts (200 lines / 25KB cap)
└── index.ts          — barrel export
```

**What gets stolen verbatim:**
- `scanMemoryFiles()` from `memoryScan.ts` — recursive readdir, filter `.md`, read frontmatter, sort newest-first, cap 200
- `formatMemoryManifest()` — one-line-per-file manifest for agent injection
- `memoryAgeDays()`, `memoryAge()`, `memoryFreshnessNote()` from `memoryAge.ts`
- `truncateEntrypointContent()` from `memdir.ts` — line-first then byte truncation
- The 4-type taxonomy prompt strings from `memoryTypes.ts` (INDIVIDUAL variant only, drop COMBINED)
- `WHAT_NOT_TO_SAVE_SECTION` and `TRUSTING_RECALL_SECTION` prompt strings

**What gets adapted:**
- Path resolution: no security validation needed, just `public/{sessionId}/memory/`
- No team memory paths
- No KAIROS daily-log mode (not yet)

**Key decision:** Memory lives INSIDE each session folder (`public/{sessionId}/memory/`), not in a global `~/.claude/` directory. OskarOS is session-centric, not project-centric. Cross-session dreaming reads from multiple session memory dirs.

**Estimated size:** ~200 lines new + ~150 stolen = ~350 lines total

**Test:** Create a memory dir for an existing session, write a test topic file with frontmatter, verify scan picks it up.

---

### PHASE 2: Dreamer Agent (`/api/dream` route)

**What it is:** The cross-session consolidator. Reads transcripts + memory files across sessions, merges signal, prunes index.

**New files:**
```
lib/memory/
├── consolidation-lock.ts  — STOLEN from consolidationLock.ts (mtime trick, PID lock, rollback)
├── consolidation-prompt.ts — STOLEN from consolidationPrompt.ts (4-phase template)
├── dream-engine.ts        — ADAPTED from autoDream.ts (3-gate trigger, execution)
app/api/dream/route.ts     — Next.js API route (trigger endpoint)
```

**What gets stolen verbatim:**
- `readLastConsolidatedAt()` — stat lock file, return mtime
- `tryAcquireConsolidationLock()` — write PID, verify, return priorMtime
- `rollbackConsolidationLock()` — rewind mtime or unlink
- `buildConsolidationPrompt()` — the 4-phase prompt template (adapt paths for OskarOS session structure)
- `HOLDER_STALE_MS = 60 * 60 * 1000`

**What gets adapted:**
- **Gate 1 (time):** 4 hours, not 24. OskarOS sessions are frequent.
- **Gate 2 (sessions):** Count interactions in session files (message count from bridge logs), not separate transcript files. Threshold: 15 interactions.
- **Gate 3 (lock):** Same logic, different lock file location (`public/{sessionId}/memory/.consolidate-lock`)
- **Execution:** Instead of `runForkedAgent()`, make a direct Anthropic API call with Sonnet. Build messages array with the consolidation prompt as system, inject memory manifest as user message.
- **Tool execution:** The dream agent needs to read/edit files. Reuse `tool-executor.ts` with a restricted permission scope (read anywhere in session, write only in memory dir).
- **No scan throttle needed initially** — dreams are triggered manually or by cron, not per-turn.

**The API route (`/api/dream`):**
```
POST /api/dream
Body: { sessionId: string, force?: boolean }
Response: SSE stream of dream progress events

1. If !force → check gates (time, interactions, lock)
2. Acquire lock
3. Build consolidation prompt (inject memory manifest + session file paths)
4. Call Anthropic API (Sonnet) with tool_use enabled
5. Execute tool calls via tool-executor (restricted to memory dir writes)
6. Loop until agent says done or maxTurns (5) hit
7. Release lock (update mtime to now)
8. Return summary of what changed
```

**Prompt adaptation for OskarOS:**
The consolidation prompt needs to know about OskarOS's file structure, not Claude Code's transcript dir:
- Phase 2 reads `SESSION.md`, `IMAGES.md`, `BUILD.md`, `CREATIVE-BRIEF.md` instead of grepping JSONL transcripts
- This is actually SIMPLER — structured markdown beats raw transcript grep
- Phase 3 writes to `memory/` topic files within the session
- Phase 4 prunes `memory/MEMORY.md` index

**Estimated size:** ~300 lines new + ~200 stolen = ~500 lines total

**Test:** Create `/api/dream` route, call it with an existing session that has SESSION.md + IMAGES.md. Verify it creates memory/MEMORY.md + topic files.

---

### PHASE 3: Memory Recall (inject into CD prompt)

**What it is:** At session start (or resume), Sonnet picks ≤5 relevant memory files and injects them into the CD agent's system prompt.

**New files:**
```
lib/memory/
├── recall.ts  — ADAPTED from findRelevantMemories.ts (Sonnet selection)
```

**Modified files:**
```
lib/cd-agent-prompt.ts  — add memory injection to buildCDPrompt()
```

**What gets stolen:**
- `SELECT_MEMORIES_SYSTEM_PROMPT` — the selection prompt ("be selective and discerning")
- The structured JSON output schema (array of filenames)
- The `alreadySurfaced` dedup pattern

**What gets adapted:**
- Replace `sideQuery()` with a direct Anthropic API call to Sonnet
- Input: memory manifest (from scan.ts) + current user message + session context
- Output: array of filenames to inject
- Read selected files, append their content to the CD prompt in `buildCDPrompt()`

**Integration point in `cd-agent-prompt.ts`:**
```typescript
// In buildSessionContext(), after the session restore block:
const memories = await recallRelevantMemories(sessionId, userMessage)
if (memories.length > 0) {
  context += `\n## RECALLED MEMORIES\n${memories.map(m => m.content).join('\n---\n')}\n`
}
```

**Estimated size:** ~150 lines new + ~80 stolen = ~230 lines total

**Test:** Create 10 memory files, call recall with a query, verify Sonnet picks ≤5 relevant ones.

---

### PHASE 4: Extract Memories (post-turn promoter)

**What it is:** After each bridge message exchange, a background process scans the conversation for memory-worthy observations and writes them to topic files.

**New files:**
```
lib/memory/
├── extract.ts         — ADAPTED from extractMemories.ts (coalesced execution)
├── extract-prompt.ts  — STOLEN from extractMemories/prompts.ts (efficiency instructions)
```

**Modified files:**
```
app/api/chat-stream/route.ts  — hook extraction after bridge response completes
```

**What gets stolen:**
- The coalesced execution pattern (inProgress + pendingContext + trailing run)
- The extraction prompt: "Turn 1 parallel reads, Turn 2 parallel writes, maxTurns 5"
- The `INDIVIDUAL` variant of the extraction prompt with 4-type taxonomy
- The memory manifest pre-injection pattern

**What gets adapted:**
- **Trigger:** After each bridge `result` event (not a postSamplingHook). Fire-and-forget — don't block the response stream.
- **Cursor:** Track `lastExtractedMessageIndex` per session (in-memory Map, reset on server restart). Only process new messages.
- **Mutual exclusion:** Check if the CD agent's last response included memory file writes (grep tool results for memory/ paths). Skip if yes.
- **Execution:** Direct Anthropic API call to Sonnet with extraction prompt + recent messages + memory manifest.
- **Tool execution:** Reuse tool-executor.ts, restricted to memory dir writes.
- **No turn throttle initially** — extract after every bridge exchange. Can add throttling later if costs are too high.

**Integration point:**
```typescript
// In chat-stream route, after yielding the 'result' event:
extractMemoriesIfNeeded(sessionId, recentMessages).catch(err => {
  console.error('[Extract] Failed:', err.message)
})
// Fire-and-forget — don't await, don't block response
```

**Estimated size:** ~250 lines new + ~100 stolen = ~350 lines total

**Test:** Send a message through bridge that includes a user preference ("I hate blue backgrounds"). Verify extraction creates a `feedback` type memory file.

---

### PHASE 5: UI Integration

**What it is:** Dream status, memory browser, manual trigger.

**New/modified files:**
```
components/MemoryIndicator.tsx  — shows dream status + memory count in TopBar
components/MemoryBrowser.tsx    — slide-out panel showing memory files
```

**Features:**
- 🧠 icon in TopBar showing memory file count for current session
- Click → slide-out panel listing all memory files with type badges
- "Dream Now" button → calls POST /api/dream with force=true
- Dream progress indicator (SSE events from dream route)
- Memory file viewer (read-only, shows frontmatter + content)

**Estimated size:** ~100 lines

---

## TOTAL BUDGET

| Phase | New Code | Stolen Code | Total | Priority |
|-------|----------|-------------|-------|----------|
| 1. Memory Directory | ~200 | ~150 | ~350 | Must-have |
| 2. Dreamer Agent | ~300 | ~200 | ~500 | Must-have |
| 3. Memory Recall | ~150 | ~80 | ~230 | Must-have |
| 4. Extract Memories | ~250 | ~100 | ~350 | Should-have |
| 5. UI Integration | ~100 | ~0 | ~100 | Nice-to-have |
| **TOTAL** | **~1,000** | **~530** | **~1,530** |  |

For reference: Claude Code's memory system is ~4,000 lines across ~30 files. We're getting ~80% of the capability in ~38% of the code by dropping team memory, KAIROS mode, session memory (free from CLI), and all the CLI subprocess infrastructure.

---

## BUILD ORDER FOR CLAUDE CODE (the CD agent)

Hand this to the CD agent in sequence:

### Step 1: Create `lib/memory/` scaffold
```
mkdir -p lib/memory
```
Create paths.ts, types.ts, scan.ts, age.ts, truncate.ts, index.ts

### Step 2: Create consolidation infrastructure
consolidation-lock.ts, consolidation-prompt.ts

### Step 3: Create dream engine + API route
dream-engine.ts, app/api/dream/route.ts

### Step 4: Wire memory recall into CD prompt
recall.ts, modify cd-agent-prompt.ts

### Step 5: Create extraction system
extract.ts, extract-prompt.ts, hook into chat-stream route

### Step 6: UI
MemoryIndicator.tsx, MemoryBrowser.tsx

---

## WHAT NOT TO BUILD (anti-bloat list)

- ❌ Session Memory system — CLI already has it via bridge mode
- ❌ Team memory — single-user app
- ❌ KAIROS daily-log mode — premature complexity
- ❌ Security path validation — OskarOS controls its own paths
- ❌ GrowthBook feature flags — hardcode thresholds, adjust later
- ❌ runForkedAgent infrastructure — call Anthropic API directly
- ❌ Custom template support — one template, hardcoded
- ❌ Scan throttle — dreams are manual/cron, not per-turn
- ❌ cacheSafeParams — no CLI subprocess to share cache with

---

## SOURCE FILE MAPPING

For each new file, where the code comes from:

| OskarOS File | Primary Source | Lines Stolen | Lines New |
|---|---|---|---|
| `lib/memory/paths.ts` | — (trivial) | 0 | 20 |
| `lib/memory/types.ts` | `memdir/memoryTypes.ts` | 80 | 20 |
| `lib/memory/scan.ts` | `memdir/memoryScan.ts` | 90 | 10 |
| `lib/memory/age.ts` | `memdir/memoryAge.ts` | 50 | 5 |
| `lib/memory/truncate.ts` | `memdir/memdir.ts` | 60 | 10 |
| `lib/memory/consolidation-lock.ts` | `autoDream/consolidationLock.ts` | 130 | 10 |
| `lib/memory/consolidation-prompt.ts` | `autoDream/consolidationPrompt.ts` | 60 | 40 |
| `lib/memory/dream-engine.ts` | `autoDream/autoDream.ts` | 80 | 150 |
| `lib/memory/recall.ts` | `memdir/findRelevantMemories.ts` | 40 | 80 |
| `lib/memory/extract.ts` | `extractMemories/extractMemories.ts` | 60 | 120 |
| `lib/memory/extract-prompt.ts` | `extractMemories/prompts.ts` | 100 | 20 |
| `app/api/dream/route.ts` | — | 0 | 150 |
| `cd-agent-prompt.ts` (mod) | — | 0 | 30 |
| `chat-stream` (mod) | — | 0 | 20 |

---

*This plan steals Claude Code's best ideas — the prompts, the lock file trick, the 4-type taxonomy, the coalesced execution, the "grep narrowly" philosophy — without importing its CLI runtime baggage.*

*Built for the CD agent to execute in sequence. Each phase is self-contained and testable.*
