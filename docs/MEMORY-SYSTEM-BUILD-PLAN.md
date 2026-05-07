# OskarOS Memory System — Build Plan

> What to steal from Claude Code, what to adapt, what to skip.
> Goal: maximum capability from minimum code. No bloat.
> Status block added: 2026-05-01

---

## STATUS UPDATE — 2026-05-01

Plan body below is preserved for context. This is the earlier, higher-level "what to steal from Anthropic's source" plan that preceded the more detailed `DREAMER-IMPLEMENTATION-SPEC.md`. Same fate: **wholly superseded by Sage**. Phase 1 partially shipped with different scope; Phases 2-5 were never built as designed. Sage replaced the entire dreaming/extraction/recall apparatus.

The interesting question this plan raises and the others don't: **of the Anthropic source code this plan flagged as steal-worthy, what's actually still worth porting?** Answered in the new "NICE-TO-HAVE FROM ANTHROPIC'S SOURCE" section below.

### STATUS PHASE 1 — Memory Directory - PARTIALLY SHIPPED (different scope)

**SHIPPED:** `lib/memory/paths.ts` exists; per-session `public/{sessionId}/user.md` is the durable memory artifact (analogous to the planned `public/{sessionId}/memory/` dir but flatter — one file, not a directory of topic files with frontmatter).

**CHANGED:**
- The plan's `lib/memory/{scan,age,types,truncate}.ts` modules were **never built**.
- The 4-type taxonomy (user/feedback/project/reference) was **dropped** — Sage uses an unstructured markdown portrait.
- `memory/MEMORY.md` index with frontmatter topic files — **dropped**. Sage writes ONE file per session (`user.md`) plus the global `agents/CD-MEMORY.md`.
- The plan's `formatMemoryManifest()` for agent injection — **dropped**. Sage's portrait IS the manifest; no separate index pass.

**DO NOT IMPLEMENT:**
- `lib/memory/scan.ts` recursive readdir scanner.
- `lib/memory/types.ts` 4-type taxonomy.
- `lib/memory/age.ts` staleness math (deferred — see NICE-TO-HAVE).
- `lib/memory/truncate.ts` (deferred — see NICE-TO-HAVE).
- Per-session `memory/` subdirectory with topic files. Use `user.md` as the single durable artifact.

### STATUS PHASE 2 — Dreamer Agent - NOT SHIPPED AS DESIGNED

**SHIPPED INSTEAD:** Sage subsystem.
- `app/api/dream/route.ts` exists but invokes `runDreamer()` which is the Sage portrait painter, not the planned dream-engine.
- `lib/memory/dreamer.ts` is Sage runtime (file is named for legacy reasons; identity is Sage).

**CHANGED — every gate, every primitive:**
- **Gate 1 (4-hour time):** dropped. Sage runs on session-end, not auto-trigger.
- **Gate 2 (15-interaction count):** dropped. Same reason.
- **Gate 3 (lock file with mtime trick):** dropped. In-process `pauseLumberjack()/resumeLumberjack()` is the lock.
- **`consolidation-lock.ts` / `consolidation-prompt.ts`** — never built.
- **`dream-engine.ts`** — never built.
- **`HOLDER_STALE_MS = 60 * 60 * 1000`** — irrelevant.

**DO NOT IMPLEMENT:**
- 3-gate auto-trigger system.
- `consolidation-lock.ts` PID file with mtime semantics — replaced by in-process pause flag.
- `consolidation-prompt.ts` 4-phase template — Sage has its own portrait painter prompt.
- `dream-engine.ts` as a separate module — runtime lives in `lib/memory/dreamer.ts`.
- Cron-driven dream cycles. Session-end is the trigger.

### STATUS PHASE 3 — Memory Recall - NOT SHIPPED

**SHIPPED INSTEAD:** Sage's portrait is loaded into CD's boot prompt unconditionally — there is no per-query selection.

**DO NOT IMPLEMENT:**
- `lib/memory/recall.ts` with Sonnet-driven selection of ≤5 relevant files.
- `SELECT_MEMORIES_SYSTEM_PROMPT` and the JSON output schema for memory selection.
- The `alreadySurfaced` dedup pattern.
- Memory injection block in `buildCDPrompt()` of the plan's shape (`## RECALLED MEMORIES`). The portrait is injected as portrait, not as recalled-shortlist.

### STATUS PHASE 4 — Extract Memories - NOT SHIPPED

**SHIPPED INSTEAD:** Sage extracts at session-end via the portrait pass. There is no post-turn coalesced extractor.

**DO NOT IMPLEMENT:**
- `lib/memory/extract.ts` post-turn extractor.
- `lib/memory/extract-prompt.ts` with Turn-1-reads / Turn-2-writes / maxTurns-5 efficiency instructions (deferred — see NICE-TO-HAVE).
- The coalesced execution pattern (deferred — see NICE-TO-HAVE).
- `lastExtractedMessageIndex` per-session in-memory cursor.
- Hook in `chat-stream` route that fires extraction after each `result` event.

### STATUS PHASE 5 — UI Integration - NOT SHIPPED

**SHIPPED:** A different memory UI surface — Director Mode's editing panel + the Sentinel Ti audit panel + the chat side-panel showing `agent_inbox` events. None of those are the planned MemoryIndicator/MemoryBrowser.

**DO NOT IMPLEMENT:**
- 🧠 icon + memory file count badge in TopBar (no per-session memory file list to count).
- `MemoryBrowser.tsx` slide-out panel.
- "Dream Now" button (use `POST /api/dream` directly during development; not a user-facing feature).
- SSE dream-progress UI (Sage runs at session-end, no real-time UI needed).

---

## NICE-TO-HAVE FROM ANTHROPIC'S SOURCE (rewritten 2026-05-01 against actual codebase)

The plan flagged ~10 Anthropic primitives as steal-worthy. **Most are now structurally incompatible with how Sage actually works.** Sage Portrait is a strict no-tools text-in/text-out function (the agent file forbids tool calls); Sage 240/40 has the JS runner do all mechanical work and uses the model only for one-shot narrative compression per pass. The "agentic loop" assumptions in Anthropic's `extractMemories.ts` and `findRelevantMemories.ts` don't apply.

This section is rewritten against the **actual** state of `lib/memory/dreamer.ts` (1948 LOC), `lib/memory/anthropic.ts`, `agents/sage-portrait.md`, and `agents/sage-240-40.md`.

### What's worth porting, in priority order:

### 1. Prompt caching on the system-prompt block — HIGH VALUE (not in the original plan)

**Source:** Anthropic SDK `cache_control: { type: 'ephemeral' }` on message blocks.
**The hole in current Sage:** `lib/memory/anthropic.ts` calls Sage via `claude --print` subprocess with `--system-prompt-file`. **No caching configured anywhere in lib/memory/.** Each Sage 240/40 pass re-sends the full agent file (`sage-240-40.md` ≈ 8KB system prompt). At the highest tier, Sage 240/40 runs **6 passes per cycle** (`decidePassCount()`, `lib/memory/dreamer.ts:338`). That's 6× system-prompt re-transmission per cycle, plus Sage Portrait's own 8KB system prompt. Order 66 fires both in parallel — every Order 66 spends prompt-token budget that prompt caching would eliminate.
**Why it matters:** at scale this is the biggest single cost line for Sage. The agent files are stable across passes; they're a textbook caching candidate.
**Where it would land:** CLI-mode (which Sage uses) inherits caching from the CLI's own settings, but our `--system-prompt-file` path isn't necessarily configured for it. Either (a) verify the CLI caches `--system-prompt-file` content, (b) switch the Sage call path to the Anthropic SDK with explicit `cache_control`, or (c) move sage system prompts to `~/.claude/CLAUDE.md`-style canonical locations the CLI auto-caches.
**When to port:** before billing scales, OR before Order 66 starts firing more than ~10×/day. Today it's measurable but not painful.
**Effort:** depends on path. (a) one-day investigation. (b) ~80 LOC migrating `callAnthropic()` from CLI to SDK. (c) prompt-loading reorg, ~40 LOC.


### Explicitly NOT worth porting (carried forward, validated)

| Anthropic primitive | Why not |
|---|---|
| `consolidationLock.ts` mtime trick | Single-process Next.js. In-process Map (item #3) is the right shape. |
| 4-type memory taxonomy (user/feedback/project/reference) | Sage's portrait is unstructured by design. The four buckets in `sage-portrait.md` (Taste / Quality Bar / Communication / Working Context) ARE the taxonomy and they're domain-fit, not Anthropic-generic. |
| `runForkedAgent` + `cacheSafeParams` | CLI subprocess infra. `lib/memory/anthropic.ts` calls `claude --print` directly. |
| `findRelevantMemories.ts` Sonnet selection | Useless — OskarOS has one memory file per session (`user.md`) and one global (`CD-MEMORY.md`). Selection prompt assumes ≥10 candidate files. |
| 3-gate auto-trigger | Order 65/66 are explicit triggers driven by user action. Cleaner than time/count/lock heuristics. |
| KAIROS daily-log | Already marked "not yet" in the plan; status unchanged. |
| Team memory | Single-user. |
| `scanMemoryFiles()` recursive readdir + frontmatter | One memory file per session. No directory to scan. |

### How to actually port one of these

If a need arises:
1. Read the Anthropic source from `external/claude-code/` (or wherever the reference is currently mounted — paths shift).
2. Verbatim copy to `lib/memory/` with attribution comment.
3. Adapt to Sage's actual shape (text-in/text-out, JS-driven mechanics, per-session paths) — verbatim port is rarely the right move because the runtime model differs from Anthropic's CLI agent.
4. Wire into Sage's runtime (`lib/memory/dreamer.ts`) — never as a parallel system.
5. Add a 3-turn rule entry to `docs/INSTITUTIONAL-MEMORY.md` if the port takes 3+ debugging cycles.

**Hard rule:** do not port "for completeness." Port only when there's a measurable problem the primitive solves AND the primitive's runtime model matches Sage's. If you find yourself recommending an "agentic loop" primitive for Sage, stop — Sage is not an agent loop, it's a JS-orchestrated text-transformation pipeline with a model in the middle.

### STATUS — What IS the source of truth

For memory work today, read these (not this plan):
- `agents/sage-portrait.md` + `agents/sage-240-40.md` — Sage agent specs
- `lib/memory/dreamer.ts` — runtime (filename is legacy; identity is Sage)
- `lib/memory/anthropic.ts` — call layer
- `lib/memory/paths.ts` — current path layout
- `app/api/dream/route.ts` — current API shape
- `agents/CD-MEMORY.md` — institutional memory CD reads on boot
- `docs/MEMORY-SYSTEM-IMPLEMENTATION-PLAN.md` (its 2026-05-01 status block) — sibling plan with more detail
- `docs/DREAMER-IMPLEMENTATION-SPEC.md` (its 2026-05-01 status block) — exhaustive spec, also superseded

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
