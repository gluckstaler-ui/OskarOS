# Claude Code Memory Architecture — Decoded from Original TypeScript Source

> Source: `xorespesp/claude-code` (complete TS reconstruction from NPM sourcemap leak)
> Compiled for OskarOS Dreamer agent implementation
> Updated with full deep-dive from source code analysis (~30 files, ~4,000 lines of TypeScript)

---

## THE 5-LAYER MEMORY CASCADE

Think of it as a nervous system. Each layer has a different clock speed.

**Layer 1: CLAUDE.md** — the slowest. User-written, never auto-modified. It's identity.

**Layer 2: memdir (Auto Memory)** — persistent topic files on disk. This is where the real engineering starts.

**Layer 3: Session Memory** — structured notes within a single conversation. Dies when the session ends (unless consumed by layers above).

**Layer 4: Extract Memories** — a background agent that runs between turns, pulling signal from the conversation into Layer 2.

**Layer 5: autoDream** — a cross-session consolidator that wakes up periodically, reads old transcripts, and distills them into Layer 2.

Each layer feeds upward. Session Memory captures fast. Extract Memories promotes the good stuff to disk. autoDream does the deep clean across sessions. It's a funnel: lots of noisy signal → progressively refined permanent memory.

---

## LAYER 1: CLAUDE.md — STATIC IDENTITY

- User writes it, Claude reads it
- Discovered by walking UP the filesystem from cwd to root
- Checks `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` at each level
- Budget: 4,000 chars/file, 12,000 chars total
- Deduplicated by content hash
- **OskarOS equivalent:** CD-MEMORY.md (the JEDI identity file)

Not architecturally interesting. It's a config file.

---

## LAYER 2: MEMDIR — THE FILESYSTEM IS THE DATABASE

### Source Files
```
src/memdir/
├── memdir.ts                # Core: buildMemoryPrompt, truncateEntrypointContent, loadMemoryPrompt
├── findRelevantMemories.ts  # Query-time recall (calls Sonnet to select ≤5 relevant files)
├── memoryScan.ts            # Directory scanner (reads frontmatter, returns MemoryHeader[])
├── memoryTypes.ts           # 4-type taxonomy (user/feedback/project/reference)
├── memoryAge.ts             # Age calculations + staleness warnings
├── paths.ts                 # Path resolution (env → settings → default), security validation
├── teamMemPaths.ts          # Team memory directory paths
├── teamMemPrompts.ts        # Team memory prompt sections
```

### Path Resolution (paths.ts)

Three-way priority chain for where memory lives:

1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` env var (highest priority — Cowork mode uses this)
2. `autoMemoryDirectory` in user settings (`~/.claude/settings.json`)
3. Default: `~/.claude/projects/{sanitized-git-root}/memory/`

The sanitization is important. `sanitizeProjectPath()` takes your git root (e.g., `/Users/ralph/OskarOS`) and turns slashes into hyphens, strips leading dots. So the memory dir becomes something like `~/.claude/projects/-Users-ralph-OskarOS/memory/`.

**Security hardening in `validateMemoryPath()`**: rejects relative paths, root paths, UNC paths (Windows network shares), null-byte injection, and drive-root paths. Critical detail: the `projectSettings` file (`.claude/settings.json` inside the repo) is explicitly excluded from providing `autoMemoryDirectory`. Why? A malicious repo could set it to `~/.ssh` and have Claude write into your SSH keys. Only user-level settings can override the path.

**Worktree sharing**: `findCanonicalGitRoot()` resolves git worktrees back to their main repo, so all worktrees share one memory directory. No memory fragmentation across branches.

### The Index: MEMORY.md (memdir.ts)

`ENTRYPOINT_NAME = 'MEMORY.md'`. This is the table of contents. Hard limits: 200 lines, 25KB.

Each entry is one line: `- [Title](file.md) — one-line hook`

The truncation strategy in `truncateEntrypointContent()` is smart: tries line-truncation first (natural boundary at 200 lines), then byte-truncation at the last newline before 25KB. Never cuts mid-line.

The system prompt tells Claude: "This is an index, not a dump. Never write memory content directly into it." The index points to topic files. Topic files hold the actual memories.

### Topic Files — The 4-Type Taxonomy (memoryTypes.ts)

Every memory file has YAML frontmatter with three fields: `name`, `description`, `type`. Four types:

**`user`** — role, preferences, communication style. "Ralph prefers punchy over academic." Highest durability. Rarely changes. Always private.

**`feedback`** — corrections and confirmations. "Ralph said never use bullet points for explanations." These are behavioral adjustments. The prompt tells Claude to treat these as stronger signal than its own assumptions. Default private, can be team-scoped.

**`project`** — ongoing work, deadlines, current state. "OskarOS bridge mode is live. Next priority is Dreamer Agent." Most volatile. Gets stale fast. Biased toward team scope.

**`reference`** — pointers to external systems. "The booking API endpoint is at /api/bookings. Auth uses JWT." Facts about the world, not about the user. Usually team-scoped.

Each type has full XML-structured prompts in the source with `<description>`, `<when_to_save>`, `<how_to_use>`, `<body_structure>`, `<examples>`. Two variants exist: `TYPES_SECTION_INDIVIDUAL` for solo mode and `TYPES_SECTION_COMBINED` for team mode (adds private/team scope tags).

**`WHAT_NOT_TO_SAVE_SECTION`** is equally important — tells Claude what to keep OUT of memory: code patterns, conventions, architecture decisions, git history, debugging solutions, CLAUDE.md duplicates, ephemeral task details. The philosophy: memory is for things that cross session boundaries. If it's in the code, grep for it. If it's in CLAUDE.md, don't duplicate it.

**`TRUSTING_RECALL_SECTION`**: verify file paths exist, grep for functions/flags, "memory says X exists ≠ X exists now." Memory is a hint, not ground truth.

### Memory File Format
```markdown
---
description: Short description for the index
type: user|feedback|project|reference
---

Content here...
```

### Memory Scanning (memoryScan.ts)

`scanMemoryFiles()` does a recursive readdir of the memory directory, filters to `.md` files (excluding MEMORY.md itself), reads frontmatter from each in parallel, sorts newest-first, caps at 200 files.

Efficiency trick: `readFileInRange()` does the stat and read in one call, returning `mtimeMs` alongside content. This halves syscalls compared to separate stat + read.

Output format from `formatMemoryManifest()`: one line per file — `- [type] filename (ISO timestamp): description`. This manifest gets pre-injected into extraction agents so they don't waste a turn running `ls`.

### Query-Time Recall (findRelevantMemories.ts)

This is how Claude decides which memories to surface for a given query. Not every memory is relevant every time.

`findRelevantMemories()`: scan all files → filter out `alreadySurfaced` (dedup so you don't re-inject the same memory every turn) → call **Sonnet** via `sideQuery()` to pick ≤5 relevant files.

The selection prompt (`SELECT_MEMORIES_SYSTEM_PROMPT`) is deliberately conservative: "Be selective and discerning... If unsure, do NOT include." It uses structured JSON output via `json_schema` — returns an array of filenames.

Interesting detail: `recentTools` parameter. If you're actively using a tool (say, the GitHub API), it excludes general API docs from memory recall. But it KEEPS warnings and gotchas about that tool. Smart — you don't need the tutorial when you're already using it, but you still need the "watch out for X" notes.

Graceful fallback: returns empty array on any error. Memory recall failing should never break the main conversation.

**Model used: explicitly Sonnet.** This is the ONLY place in the memory system that deliberately downshifts to a cheaper model. It's a cost optimization — you don't need Opus to read frontmatter and pick filenames.

### Staleness System (memoryAge.ts)

`memoryAgeDays()`: floor-rounded days since file mtime. `memoryAge()`: human-readable ("today", "yesterday", "47 days ago").

`memoryFreshnessNote()`: for memories older than 1 day, wraps a warning in `<system-reminder>` tags: "Memories are point-in-time observations, not live state." This is the trust calibration — tells Claude to verify before assuming a memory is still accurate.

**Drift rule:** "If a recalled memory conflicts with current information, trust what you observe now — and update or remove the stale memory."

### KAIROS Mode (memdir.ts)

There's an alternative memory layout called KAIROS (daily-log mode). Instead of topic files only, it uses append-only daily logs at `logs/YYYY/MM/YYYY-MM-DD.md`. The nightly `/dream` then distills these logs into topic files.

`buildAssistantDailyLogPrompt()` teaches the model to append timestamped entries to today's log file. The consolidation prompt's Phase 2 then prioritizes these daily logs as the richest signal source.

This is the "journal + periodic review" pattern vs the "direct topic filing" pattern. KAIROS is behind a feature flag and may not be active for all users.

---

## LAYER 3: SESSION MEMORY — THE WITHIN-SESSION NOTE-TAKER

### Source Files
```
src/services/SessionMemory/
├── sessionMemory.ts       # Core: init, setup, shouldExtract, manual trigger
├── sessionMemoryUtils.ts  # Utility functions, thresholds, state tracking
├── prompts.ts             # Template + update prompt builders
```

### Trigger Conditions (sessionMemoryUtils.ts, sessionMemory.ts)

Three thresholds, all must be satisfied:

1. **Initialization threshold**: 10,000 tokens in the context window (`minimumMessageTokensToInit`). Below this, the conversation is too short to bother summarizing.

2. **Update threshold**: 5,000 tokens of context growth since last extraction (`minimumTokensBetweenUpdate`). Measures how much NEW stuff has accumulated.

3. **Tool calls threshold**: 3 tool calls since last extraction (`toolCallsBetweenUpdates`). Proxy for "work happened."

The trigger logic in `shouldExtractMemory()` combines them:
- Both token AND tool-call thresholds met → extract
- Token threshold met AND no active tool calls in last turn → extract (natural conversation break)

The token threshold is ALWAYS required. Even if you've made 100 tool calls, extraction won't fire until the context has grown by 5K tokens. Prevents rapid-fire extractions during heavy tool use.

Only runs on `repl_main_thread` query source — subagents, teammates, and other query sources are excluded.

### The Template (prompts.ts) — 10 Sections

1. **Session Title** — one-line summary
2. **Current State** — what's happening RIGHT NOW (always updated, highest priority)
3. **Task Specification** — what the user originally asked for
4. **Files and Functions** — code artifacts touched
5. **Workflow** — steps taken, decisions made
6. **Errors & Corrections** — what went wrong and how it was fixed (high priority retention)
7. **Codebase Documentation** — architecture notes discovered during work
8. **Learnings** — insights for future sessions
9. **Key Results** — deliverables produced
10. **Worklog** — chronological record

### Token Budgets

- **2,000 tokens per section** (`MAX_SECTION_LENGTH`)
- **12,000 tokens total** (`MAX_TOTAL_SESSION_MEMORY_TOKENS`)
- `analyzeSectionSizes()` checks each section against budget
- `generateSectionReminders()` produces warnings when sections are overweight
- `truncateSessionMemoryForCompact()` truncates oversized sections at line boundaries for compaction
- Token estimation: `chars / 4`

Custom templates supported: drop a file at `~/.claude/session-memory/config/template.md` and it replaces the default. Same for the update prompt at `config/prompt.md`.

### Execution (sessionMemory.ts)

Runs as a `postSamplingHook` — fires after every API response. Wrapped in `sequential()` so only one extraction runs at a time.

`setupSessionMemoryFile()`: creates the file if it doesn't exist (using `wx` flag for atomic create-if-absent), loads template into it, reads current content. Critical detail: it clears the `readFileState` cache for the memory file path before reading, so the FileReadTool's dedup doesn't return a stale "file_unchanged" stub.

The extraction runs via `runForkedAgent()` — a forked subagent that shares the parent's prompt cache (huge cost saving). The `createMemoryFileCanUseTool()` function is the tightest permission scope in the whole system: ONLY allows `FileEdit` on the EXACT memory file path. Nothing else. Can't read other files, can't write anywhere else, can't use Bash. Pure note-taking.

`manuallyExtractSessionMemory()` bypasses all thresholds — used by the `/summary` command for on-demand extraction.

### The Update Prompt

Strict rules:
- Never modify section headers or descriptions
- Issue parallel edits (performance)
- Be info-dense — no filler
- ALWAYS update "Current State" — this is the most important section
- Respect token budgets per section

### State Tracking (sessionMemoryUtils.ts)

- `tokensAtLastExtraction` — baseline for measuring growth
- `sessionMemoryInitialized` — has first extraction happened
- `lastSummarizedMessageId` — cursor for incremental updates
- `extractionStartedAt` — stale detection
- `waitForSessionMemoryExtraction()` — polls every 1s with 15s timeout, stale threshold 60s
- `hasMetUpdateThreshold()` — measures context window GROWTH since last extraction

### Compaction Integration

When context window compacts, session memory can replace the full conversation summary:
- Thresholds: 10K min tokens, 40K max, 5 text-block messages minimum
- Protects API invariants: never splits tool-use/tool-result pairs
- Preserves thinking blocks that span streaming messages

### Model Used

**Inherits parent model.** Whatever you're running — Opus, Sonnet — the forked agent gets the same model via `runForkedAgent()` + `createCacheSafeParams(context)`. No model override.

---

## LAYER 4: EXTRACT MEMORIES — THE BETWEEN-TURN PROMOTER

### Source Files
```
src/services/extractMemories/
├── extractMemories.ts  # Core engine (init + execute + drain)
├── prompts.ts          # Extraction prompt templates
```

### Core Mechanics (extractMemories.ts)

This is the bridge between session-level observations (Layer 3) and persistent disk memories (Layer 2). It runs after turns, scans recent messages, and decides what's worth persisting.

**Cursor-based processing**: `lastMemoryMessageUuid` tracks the last message that was processed. Only messages AFTER this UUID get analyzed. No redundant re-processing.

**Mutual exclusion with main agent**: `hasMemoryWritesSince()` checks if the main agent already wrote to the memory directory since the cursor. If it did, the extractor skips that range — the main agent's writes are authoritative, the background agent shouldn't overwrite them.

**Turn throttle**: `turnsSinceLastExtraction` vs configurable threshold (default 1, via GrowthBook feature flag `tengu_bramble_lintel`). Prevents extraction from firing every single turn.

### Coalesced Execution — The Clever Pattern

Problem: extraction takes time. While it's running, new turns complete. You don't want to queue up a backlog of extractions.

Solution: `inProgress` flag + `pendingContext` stash + trailing run in `finally` block.

1. Extraction starts. `inProgress = true`.
2. New turn completes while extraction is running. Instead of starting another extraction, it stashes the new context in `pendingContext`.
3. First extraction finishes. In the `finally` block, it checks: is there a `pendingContext`? If yes, grabs it, clears the stash, runs one more extraction with the latest context.
4. Result: at most 2 extractions in flight — the current one and one trailing run with the freshest state. No backlog, no starvation.

### Efficiency Instructions (extractMemories prompts.ts)

The prompt is explicit about turn efficiency:

**Turn 1**: Issue ALL FileRead calls in parallel. Read every memory file you need to check.
**Turn 2**: Issue ALL FileWrite/FileEdit calls in parallel. Write everything at once.
**Do not interleave reads and writes across multiple turns.**

`maxTurns: 5` hard cap prevents the agent from rabbit-holing. If it can't figure out what to write in 5 turns, it stops.

The prompt also pre-injects the memory manifest (from `scanMemoryFiles()`) so the agent doesn't waste Turn 1 on `ls`.

Key instruction from the opener: "You MUST only use content from the last ~N messages" — no grepping source files. Stays in its lane.

### Tool Permissions (createAutoMemCanUseTool)

Shared across Extract Memories and autoDream:
- **Read, Grep, Glob**: unrestricted (need to read memory files and search)
- **Bash**: read-only (can grep transcripts, can't modify anything)
- **Write, Edit**: ONLY within the memory directory (path-prefix checked via `isAutoMemPath()`)
- Everything else: denied

### Shutdown Handling

`drainPendingExtraction()`: awaits in-flight extractions before graceful shutdown with 60s timeout. Prevents data loss during process exit.

### Prompt Variants

- `buildExtractAutoOnlyPrompt()`: individual mode with 4-type taxonomy
- `buildExtractCombinedPrompt()`: team+auto mode with scope guidance (which memories are private vs team-visible)

### Model Used

**Inherits parent model.** Same `runForkedAgent()` path as Session Memory. Whatever model you're talking to is what writes your memories.

---

## LAYER 5: AUTODREAM — THE CROSS-SESSION CONSOLIDATOR

### Source Files
```
src/services/autoDream/
├── autoDream.ts           # Core engine (initAutoDream + executeAutoDream)
├── config.ts              # Feature flag gate (isAutoDreamEnabled)
├── consolidationLock.ts   # Lock file system (PID-based, mtime-as-timestamp)
├── consolidationPrompt.ts # The 4-phase prompt builder
```

### The Three-Gate Trigger System (autoDream.ts)

Every gate must pass. Checked per-turn via `executeAutoDream()` (called from stop hooks). Gates are ordered cheapest-first — if any gate fails, the whole thing short-circuits.

**Gate 1 — Time**: How long since the last dream? `readLastConsolidatedAt()` does a single `stat()` on the lock file to get its mtime. Default: 24 hours (`minHours` from config). If less than 24 hours have passed, stop. Cost: ONE syscall.

**Gate 2 — Sessions**: Enough new material? `listSessionsTouchedSince(lastConsolidatedAt)` scans transcript files whose mtime is after the last dream. Default: 5 sessions (`minSessions` from config). Excludes current session and `agent-*.jsonl` files. Uses mtime (touched since), not birthtime. If fewer than 5 sessions have been touched, stop. Cost: directory listing + stat per file.

**Scan throttle**: If Gate 1 passes but Gate 2 fails, there's a 10-minute cooldown before checking Gate 2 again. Without this, every turn would re-scan the transcript directory. The throttle variable lives in the closure created by `initAutoDream()`.

**Gate 3 — Lock**: `tryAcquireConsolidationLock()`. Can we actually run? This prevents concurrent dreams across multiple Claude processes.

All gate thresholds are configurable via GrowthBook feature flag `tengu_onyx_plover`. The remote config is cached — non-blocking reads, may be slightly stale.

### The Lock File System (consolidationLock.ts)

This is elegant. The lock file (`.consolidate-lock` in the memory directory) serves double duty:

1. **Its mtime IS `lastConsolidatedAt`**. No separate timestamp storage. One `stat()` gives you the time of the last dream.
2. **Its body is the holder's PID**. Tells you who's dreaming.

**Acquisition**: Write your PID → re-read → if the PID matches, you won. If someone else's PID is there, you lost the race. Returns `priorMtime` for rollback, or `null` if blocked.

**Stale detection**: `HOLDER_STALE_MS = 60 * 60 * 1000` (1 hour). Even if the PID is still alive, after an hour the lock is considered stale. Why? PID reuse. On Linux, PIDs wrap around. A process that crashed 3 weeks ago might have its PID reassigned to your text editor. The 1-hour cap prevents this ghost-lock scenario.

**Race resolution**: Two processes try to reclaim a stale lock simultaneously. Both write their PID. Last writer wins (filesystem semantics). Loser re-reads, sees the wrong PID, returns `null`. Simple, no file locking primitives needed.

**Rollback** (`rollbackConsolidationLock`): If the dream fails, rewind:
- `priorMtime === 0` → no lock existed before → `unlink()` the file
- Otherwise → write empty body (clears PID so our still-running process doesn't look like it's holding) + `utimes()` to set mtime back to the original timestamp

The empty-body detail is subtle. Without clearing the PID, our process would pass the `isProcessRunning(holderPid)` check and block future dreams until the 1-hour stale timeout.

Key functions:
- `readLastConsolidatedAt()` → `stat().mtimeMs` (0 if absent)
- `tryAcquireConsolidationLock()` → write PID, verify read-back, return prior mtime for rollback
- `rollbackConsolidationLock(priorMtime)` → rewind mtime or unlink if priorMtime was 0
- `listSessionsTouchedSince(sinceMs)` → session IDs with mtime after threshold
- `recordConsolidation()` → stamp from manual `/dream` command

### The Four-Phase Consolidation Prompt (consolidationPrompt.ts)

`buildConsolidationPrompt(memoryRoot, transcriptDir, extra)`:

**Phase 1 — Orient**: `ls` the memory directory. Read `MEMORY.md`. Skim existing topic files. Check for `logs/` or `sessions/` subdirectories (KAIROS layout). Purpose: Know what you already know before learning new things.

**Phase 2 — Gather recent signal**: Priority order:
1. Daily logs (`logs/YYYY/MM/YYYY-MM-DD.md`) if present
2. Existing memories that contradict current codebase state (drifted memories)
3. Transcript search — but ONLY with narrow grep: `grep -rn "<narrow term>" transcriptDir/ --include="*.jsonl" | tail -50`

The transcript instruction is critical: "Don't exhaustively read transcripts. Look only for things you already suspect matter." JSONL transcript files can be huge. Reading them whole would blow the context window.

**Phase 3 — Consolidate**: For each thing worth remembering:
- Merge into existing topic files (don't create near-duplicates)
- Convert relative dates to absolute ("yesterday" → "2026-04-06")
- Delete contradicted facts at the source
- Follow frontmatter conventions (description, type)

**Phase 4 — Prune and index**: Keep MEMORY.md under 200 lines / 25KB. Each index entry ≤150 chars. Remove stale pointers. Demote verbose entries — if a line is over ~200 chars, the detail belongs in the topic file, not the index. Resolve contradictions in the index itself.

### Execution and Progress Tracking (autoDream.ts)

Dream runs via `runForkedAgent()` with `createCacheSafeParams(context)` — shares the parent's prompt cache. This is a massive cost optimization. The system prompt, user context, and system context are identical to the parent agent. The API caches these prefixes, so the dream agent gets a near-free context setup.

`makeDreamProgressWatcher()`: tracks assistant turns, extracts text blocks and touched file paths. This feeds progress UI — you can show "Dreaming... consolidated 3 files" in the interface.

**Failure handling**: rollback the lock + scan throttle acts as natural backoff (10 minutes before trying again).

**User abort**: If the user interrupts (Ctrl+C), no rollback happens and no failure is logged. The lock stays with the current timestamp, which means the time gate resets. Clean — doesn't retry aggressively after interruption.

### Tool Restrictions for Dream Agent
- Read-only bash ONLY (ls, find, cat, stat, wc, head, tail, grep)
- NO writes via bash, NO redirects, NO state modifications
- File read/grep/glob allowed
- Write/edit restricted to memory directory paths via `createAutoMemCanUseTool()`

### Model Used

**Inherits parent model.** Same `runForkedAgent()` path. No model override in the source.

---

## THE CONNECTING TISSUE

### runForkedAgent — The Shared Infrastructure

Every background memory agent (Session Memory, Extract Memories, autoDream) uses `runForkedAgent()`. It:

1. Creates an isolated context (prevents mutation of parent state)
2. Shares `cacheSafeParams` — system prompt, user context, system context, conversation messages. The API's prompt cache means these shared prefixes are essentially free.
3. Accepts a `canUseTool` function for permission scoping
4. Accepts `overrides` like `readFileState` for file cache sharing
5. Returns when the agent completes

### The Permission Hierarchy

Tightest to loosest:

- **Session Memory**: can ONLY `FileEdit` one specific file path. Nothing else.
- **Extract Memories / autoDream**: can Read/Grep/Glob anywhere, read-only Bash, but Write/Edit ONLY inside the memory directory.
- **Main agent**: full tool access per user permissions.

### Model Inheritance Summary

| Component | Model Used |
|---|---|
| Session Memory (note-taking) | Inherits parent model |
| Extract Memories (between-turn promoter) | Inherits parent model |
| autoDream (cross-session consolidator) | Inherits parent model |
| Memory Recall (query-time file selection) | **Explicitly Sonnet** (only exception) |

The only place they deliberately downshift to a cheaper model is the recall selection step via `sideQuery()`. Everything that actually writes memory runs on the same model you're talking to.

### The Cascade in Action

Here's what happens during a typical session:

1. You start talking. Context grows.
2. At 10K tokens, **Session Memory** initializes. Every 5K tokens + 3 tool calls, it updates its 10-section note file.
3. After each turn, **Extract Memories** checks its cursor. If new messages exist and the turn threshold is met, it promotes important observations into persistent topic files in the memdir.
4. Meanwhile, `shouldExtractMemory()` detects natural conversation breaks (no active tool calls) as additional trigger points for Session Memory.
5. Session ends. Session Memory file persists on disk.
6. Next session starts. At prompt-build time, `findRelevantMemories()` uses Sonnet to pick ≤5 topic files relevant to the current query. These get injected into the system prompt.
7. After enough sessions (default 5) and enough time (default 24 hours), **autoDream** wakes up. It reads transcripts, merges signal into topic files, prunes the index, resolves contradictions.
8. The cycle continues. Memory gets progressively denser and more accurate.

---

## WHAT THIS MEANS FOR OSKAROS

### Gap Map

| Claude Code Layer | OskarOS Has | Status |
|---|---|---|
| CLAUDE.md (static identity) | CD-MEMORY.md | Done |
| Auto Memory (memdir/) | SESSION.md, CREATIVE-BRIEF.md, IMAGES.md | Has files, no consolidation |
| Session Memory | SESSION.md (manual) | No auto-extraction, no token budgets |
| Extract Memories | — | Missing entirely |
| autoDream | — | Missing entirely — THE #1 PRIORITY |

### The OskarOS Dreamer Should:

1. **Run as `/api/dream` route** — triggered by cron or manual call
2. **Three-gate system** with adapted thresholds (4-hour gate, 15-interaction gate — tighter than Claude Code's 24h/5-session defaults because OskarOS sessions are more frequent and shorter)
3. **Four-phase prompt** adapted for OskarOS file structure
4. **Sonnet for the dream agent** — cost/quality sweet spot ($0.33/dream estimated)
5. **FileEdit only, never FileWrite** — forces consolidation over creation
6. **Lock file = timestamp** — Claude Code's mtime trick, directly portable

### Key Design Decisions to Steal:

- **"grep narrowly, don't read wholesale"** — search transcripts for specific patterns, not read everything
- **Coalesced execution** — if dreaming is already running when new trigger arrives, stash and run trailing pass
- **Staleness warnings** — memories >1 day old get "point-in-time observation" caveat
- **Semantic organization** — topic files, not chronological dumps
- **Frontmatter on every memory file** — description + type enables the recall system
- **The recall system itself** — Sonnet selects ≤5 relevant memories per query, not dump everything into context
- **"What NOT to save"** — things derivable from project state don't belong in memory
- **Prompt cache sharing via runForkedAgent** — massive cost savings for background agents

### Second Priority After Dreamer: Extract Memories

The Dreamer handles cross-session consolidation, but between-turn promotion is what keeps memories fresh within a session. The coalesced execution pattern, cursor-based processing, and main-agent mutual exclusion are all directly portable to OskarOS.

---

*Compiled from original TypeScript source: xorespesp/claude-code on GitHub*
*Memory subsystem: ~30 files, ~4,000 lines of TypeScript*
*For OskarOS Dreamer agent implementation*
