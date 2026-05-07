# Claude Code Memory Architecture — Decoded from Original TypeScript Source

> Source: `xorespesp/claude-code` (complete TS reconstruction from NPM sourcemap leak)
> Compiled for OskarOS Dreamer agent implementation

---

## THE 5-LAYER MEMORY STACK

Claude Code runs five distinct memory systems, each with different triggers, lifetimes, and write permissions.

### Layer 1: CLAUDE.md (User-Written, Static)
- User writes it, Claude reads it
- Discovered by walking UP the filesystem from cwd to root
- Checks `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` at each level
- Budget: 4,000 chars/file, 12,000 chars total
- Deduplicated by content hash
- **OskarOS equivalent:** CD-MEMORY.md (the JEDI identity file)

### Layer 2: Auto Memory (memdir/) — Claude-Written, Persistent
- Claude writes to `~/.claude/projects/{sanitized-git-root}/memory/`
- Entry point: `MEMORY.md` (index file, max 200 lines / 25KB)
- Topic files: individual `.md` files organized semantically, not chronologically
- 4-type taxonomy: `user`, `feedback`, `project`, `reference`
- Frontmatter with `description` and `type` fields
- Max 200 memory files scanned
- **OskarOS equivalent:** The session-level files (SESSION.md, CREATIVE-BRIEF.md, IMAGES.md) — but WITHOUT the consolidation layer

### Layer 3: Session Memory — Real-Time Within-Session Notes
- Structured markdown with 10 sections: Session Title, Current State, Task Specification, Files and Functions, Workflow, Errors & Corrections, Codebase Documentation, Learnings, Key Results, Worklog
- Token budget: 2,000 tokens per section, 12,000 total
- Triggers: token threshold + tool call count + "safe point" (no active tool calls)
- Runs as forked subagent with restricted tool access (edit only on memory file)
- Custom template support: `~/.claude/session-memory/config/template.md`
- Custom prompt support: `~/.claude/session-memory/config/prompt.md`
- **OskarOS equivalent:** This IS what SESSION.md tries to be — but OskarOS has no automatic extraction or token budgets

### Layer 4: Extract Memories — Post-Turn Background Agent
- Fire-and-forget after each query loop completes
- "Perfect fork" of main conversation (shares prompt cache)
- Turn-based throttling (configurable via feature flag)
- Coalesces overlapping requests (stashes new context, runs trailing pass)
- Detects when main agent already wrote to memory → skips that range
- Restricted to: read-only bash + write/edit ONLY in memory directory
- **OskarOS equivalent:** Missing entirely. This is the "between turns" consolidator.

### Layer 5: autoDream — Background Cross-Session Consolidation
- THE DREAMER. Runs across sessions, not within them.
- Three-gate trigger system
- Four-phase consolidation
- Read-only bash access (no writes, no redirects)
- Forked agent process
- **OskarOS equivalent:** Missing entirely. THIS IS WHAT RALPH NEEDS.

---

## autoDream — FULL ARCHITECTURE

### Source Files
```
src/services/autoDream/
├── autoDream.ts           # Core engine (initAutoDream + executeAutoDream)
├── config.ts              # Feature flag gate (isAutoDreamEnabled)
├── consolidationLock.ts   # Lock file system (PID-based, mtime-as-timestamp)
├── consolidationPrompt.ts # The 4-phase prompt builder
```

### Three-Gate Trigger System

Every gate must pass before dreaming begins. Checked per-turn via `executeAutoDream()` (called from stop hooks):

**Gate 1 — Time:** `hours since lastConsolidatedAt >= minHours`
- Default: 24 hours
- `lastConsolidatedAt` = mtime of `.consolidate-lock` file
- Per-turn cost: ONE stat() call

**Gate 2 — Sessions:** `transcript count with mtime > lastConsolidatedAt >= minSessions`
- Default: 5 sessions
- Scans per-cwd transcripts using `listCandidates()`
- Excludes current session and agent-*.jsonl files
- Uses mtime (touched since), not birthtime

**Gate 3 — Lock:** No other process mid-consolidation
- Lock file: `.consolidate-lock` in memory directory
- Body = holder's PID
- Stale after 60 minutes even if PID is live (PID reuse guard)
- Race resolution: last writer wins PID, loser bails on re-read
- Failed fork → rollback mtime to pre-acquire value

**Scan throttle:** When time passes but sessions don't accumulate, waits 10 minutes before re-scanning.

### The Lock File System (consolidationLock.ts)

This is elegant. The lock file serves triple duty:

1. **Lock** — PID in body, checked with `isProcessRunning()`
2. **Timestamp** — mtime IS `lastConsolidatedAt` (no separate state file)
3. **Rollback** — on failed fork, rewind mtime to pre-acquire value; on crash, dead PID detected by next process

Key functions:
- `readLastConsolidatedAt()` → stat().mtimeMs (0 if absent)
- `tryAcquireConsolidationLock()` → write PID, verify read-back, return prior mtime for rollback
- `rollbackConsolidationLock(priorMtime)` → rewind mtime or unlink if priorMtime was 0
- `listSessionsTouchedSince(sinceMs)` → session IDs with mtime after threshold
- `recordConsolidation()` → stamp from manual `/dream` command

### Four-Phase Consolidation Prompt

Built by `buildConsolidationPrompt()` with templated paths (`${memoryRoot}`, `${transcriptDir}`):

**Phase 1 — Orient:**
- `ls` the memory directory
- Read MEMORY.md (the index)
- Skim existing topic files
- Purpose: Know what you already know before learning new things

**Phase 2 — Gather Signal:**
- Priority order: daily logs → drifted/contradicted memories → targeted transcript grep
- "grep narrowly" — NOT wholesale file reading
- Find information worth persisting
- Skip things derivable from project state (code patterns, file paths, architecture)

**Phase 3 — Consolidate:**
- Write new topic files OR update existing ones
- MERGE new data into existing files (don't duplicate)
- Convert relative dates to absolute ("yesterday" → "2026-04-02")
- Delete contradictions
- Merge redundant entries
- Follow frontmatter conventions (description, type)

**Phase 4 — Prune & Index:**
- Keep MEMORY.md under 200 lines / ~25KB
- ~150 chars per entry in the index
- Remove stale pointers
- Shorten verbose lines
- Resolve contradictions in the index itself

### Tool Restrictions for Dream Agent
- Read-only bash ONLY (ls, find, cat, stat, wc, head, tail, grep)
- NO writes via bash
- NO redirects
- NO state modifications
- File read/grep/glob allowed
- Write/edit restricted to memory directory paths

---

## memdir/ — THE MEMORY FILESYSTEM

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

### Memory File Format
```markdown
---
description: Short description for the index
type: user|feedback|project|reference
---

Content here...
```

### memoryScan.ts — How Files Are Discovered
- Reads memory directory recursively
- Filters to `.md` files, excludes `MEMORY.md`
- Reads first 30 lines of each file for frontmatter
- Returns `MemoryHeader[]` sorted newest-first
- Capped at 200 files
- Single-pass: stat + read together (halves syscalls vs separate rounds)

### findRelevantMemories.ts — Query-Time Recall
- Scans available memory files
- Filters out previously surfaced memories (avoid redundancy)
- Calls Claude Sonnet to select up to 5 most relevant files based on user query
- Includes "recently used tools" to avoid selecting docs for actively-used tools
- Selection bias: "If unsure, do NOT include"
- Graceful fallback to empty selection on error

### memoryAge.ts — Staleness System
- `memoryAgeDays(mtimeMs)` → days since modified (floor-rounded)
- `memoryAge(mtimeMs)` → human-readable ("today", "yesterday", "47 days ago")
- `memoryFreshnessText(mtimeMs)` → staleness warning for memories >1 day old
- Key insight: "Memories are point-in-time observations, not live state — claims about code behavior or file:line citations may be outdated."

### paths.ts — Security-Hardened Path Resolution
Resolution order:
1. `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` env var (used by Cowork/SDK)
2. `autoMemoryDirectory` in settings.json (user/local/policy only — NOT projectSettings to prevent malicious repo exploits)
3. `~/.claude/projects/{sanitized-git-root}/memory/`

Security validations: rejects relative paths, root paths, UNC paths, null bytes, paths that normalize to home directory.

### Memory Type Taxonomy (memoryTypes.ts)

| Type | What | Scope |
|------|------|-------|
| `user` | Role, expertise, preferences | Always private |
| `feedback` | Work approach guidance (what to avoid/validate) | Default private, can be team |
| `project` | Ongoing work, goals, incidents, deadlines | Bias toward team |
| `reference` | Pointers to external systems (Linear, Grafana, Slack) | Usually team |

**What NOT to save:** Code patterns, conventions, architecture, file paths, project structure — derivable from current project state.

**Drift rule:** "If a recalled memory conflicts with current information, trust what you observe now — and update or remove the stale memory."

---

## extractMemories — THE POST-TURN CONSOLIDATOR

### Source Files
```
src/services/extractMemories/
├── extractMemories.ts  # Core engine (init + execute + drain)
├── prompts.ts          # Extraction prompt templates
```

### How It Works
1. Runs after each query loop completes (fire-and-forget)
2. Creates "perfect fork" of main conversation (shares prompt cache for efficiency)
3. Closure-scoped state: cursor position (`lastMemoryMessageUuid`), extraction flags, pending contexts
4. Turn-based throttling (configurable)
5. Coalesces overlapping requests — if extraction running when new call arrives, stashes context for trailing run
6. Detects main agent memory writes → skips that range (no double-work)

### Tool Permissions
- File reads, grep, glob: allowed
- Read-only bash (ls, find, cat, stat, wc, head, tail): allowed
- Write/edit: ONLY in auto-memory directory paths
- Write-capable bash, MCP, agent tools: DENIED

### Extraction Strategy
- Two-phase: parallel reads FIRST, then parallel writes
- Cannot interleave reads and writes across turns
- Checks for existing memories before creating duplicates
- Follows 4-type taxonomy
- Updates MEMORY.md index

---

## Session Memory — THE WITHIN-SESSION NOTE-TAKER

### Source Files
```
src/services/SessionMemory/
├── sessionMemory.ts       # Core: init, setup, shouldExtract, manual trigger
├── sessionMemoryUtils.ts  # Utility functions
├── prompts.ts             # Template + update prompt builders
```

### Default Template (10 Sections)
1. Session Title
2. Current State
3. Task Specification
4. Files and Functions
5. Workflow
6. Errors & Corrections
7. Codebase Documentation
8. Learnings
9. Key Results
10. Worklog

### Trigger Conditions (ALL must be true)
- Token threshold met (minimum tokens since last update)
- Tool call threshold met (minimum tool invocations)
- Safe extraction point (no active tool calls in last assistant turn)
- Session memory gate enabled

### Token Budgets
- 2,000 tokens per section
- 12,000 tokens total
- Oversized sections trigger automatic warnings
- Priority retention: "Current State" and "Errors & Corrections"
- Token estimation: `chars / 4`

### Compaction Integration (sessionMemoryCompact.ts)
When context window compacts, session memory can replace the full conversation summary:
- Thresholds: 10K min tokens, 40K max, 5 text-block messages minimum
- Protects API invariants: never splits tool-use/tool-result pairs
- Preserves thinking blocks that span streaming messages

---

## WHAT OSKAROS NEEDS: THE DREAMER AGENT

Based on this entire analysis, here's the gap map:

| Claude Code Layer | OskarOS Has | Status |
|---|---|---|
| CLAUDE.md (static identity) | CD-MEMORY.md | ✅ Done |
| Auto Memory (memdir/) | SESSION.md, CREATIVE-BRIEF.md, IMAGES.md | ⚠️ Has files, no consolidation |
| Session Memory | SESSION.md (manual) | ⚠️ No auto-extraction, no token budgets |
| Extract Memories | — | ❌ Missing entirely |
| autoDream | — | ❌ Missing entirely — THE #1 PRIORITY |

### The OskarOS Dreamer Should:

1. **Run as `/api/dream` route** — triggered by cron or manual call
2. **Three-gate system:**
   - Time since last dream (check lock file mtime)
   - Session count since last dream
   - Cross-process lock (PID in lock file body)
3. **Four-phase prompt:**
   - Orient: Read all memory files, understand current state
   - Gather: Grep session transcripts for new signal
   - Consolidate: Merge into existing files, convert relative dates, delete contradictions
   - Prune: Keep index files under size limits
4. **Target files:** SESSION.md (grows fastest), CREATIVE-BRIEF.md, IMAGES.md
5. **CD-MEMORY.md is READ-ONLY** — identity file, never compacted
6. **Tool restrictions:** Read-only access to everything, write access ONLY to memory files
7. **Lock file = timestamp** — Claude Code's trick of using mtime as lastConsolidatedAt is worth stealing

### Key Design Decisions to Steal:

- **"grep narrowly, don't read wholesale"** — the Dreamer should search transcripts for specific patterns, not try to read everything
- **Coalesced execution** — if dreaming is already running when new trigger arrives, stash and run trailing pass
- **Staleness warnings** — memories >1 day old get "point-in-time observation" caveat
- **Semantic organization** — topic files, not chronological dumps
- **Frontmatter on every memory file** — description + type enables the recall system
- **The recall system itself** — use a fast model (Sonnet/Haiku) to select ≤5 relevant memories per query, not dump everything into context
- **"What NOT to save"** — things derivable from project state don't belong in memory

---

*Compiled from original TypeScript source: xorespesp/claude-code on GitHub*
*Memory subsystem: ~30 files, ~4,000 lines of TypeScript*
*For OskarOS Dreamer agent implementation*
