# OskarOS Dreamer Agent — Implementation Spec

> For Claude Code to build. Not a design doc — a build spec.

---

## THE PROBLEM

Four files grow every session and never shrink:

| File | Current Size | What's In It |
|------|-------------|--------------|
| SESSION.md | 16.6KB (290 lines) | Workflow state, decisions, forensics, build logs |
| IMAGES.md | 53.3KB (682 lines) | 42 image evaluations with full descriptions |
| BUILD.md | 9.4KB (195 lines) | Build progress, hot-swaps, version history |
| CREATIVE-BRIEF.md | 8.6KB (189 lines) | Vibe definitions, audience specs |
| **Total** | **88KB** | Every byte goes into the CD agent's context window |

88KB = ~22,000 tokens of context the CD agent reads on EVERY turn. And it only grows. By the time you have 3 sessions for one client, you're burning 60K+ tokens of stale context per message.

CD-MEMORY.md (the identity file) is NOT the problem. It's stable, handwritten, read-only. The Dreamer never touches it.

---

## WHAT THE DREAMER DOES

The Dreamer is a background agent that runs BETWEEN sessions. It reads what happened, extracts what matters, and compresses the growing files back down to fighting weight.

It is NOT a summarizer. It is a consolidator. The difference:

- **Summarizer:** "Sessions 1-5 involved building vibes for FalCaMel Café."
- **Consolidator:** Merges overlapping entries, kills contradictions, converts "yesterday" to "2026-04-06", removes decisions that were reversed, and keeps the specific details that still matter.

---

## WHERE IT LIVES

```
lib/
├── dreamer/
│   ├── dreamer.ts              # Core: triggerDream(), executeDream()
│   ├── dreamer-prompt.ts       # Four-phase consolidation prompt builder
│   ├── dreamer-lock.ts         # Lock file system (PID + mtime)
│   └── dreamer-tools.ts        # Restricted tool definitions (read-heavy, write-limited)

app/api/dream/
│   └── route.ts                # POST /api/dream — trigger endpoint
```

---

## TRIGGER SYSTEM — Three Gates

All three must pass. Checked when a session ends OR when manually triggered from the admin panel.

### Gate 1: Time
`hoursSinceLastDream >= 4`

- `lastDreamTime` = mtime of `.dream-lock` file in the session folder
- If no lock file exists, Gate 1 always passes (never dreamed before)
- Cost: one `stat()` call

Why 4 hours, not 24? OskarOS sessions are shorter and more intense than coding sessions. A user might do 3 sessions in an afternoon. Claude Code's 24-hour gate assumes daily work; OskarOS needs tighter cycles.

### Gate 2: Interactions
`chatMessagesSinceLastDream >= 15`

- Count CD agent messages (the `YOU` messages in the chat panel) with timestamps after `lastDreamTime`
- Source: the session's chat-history file or the `## CD |` entries in SESSION.md
- If count < 15, not enough new signal to justify a dream pass

Why 15? That's roughly 2-3 meaningful exchanges (question + forensic + follow-up × 3). Below that, the Dreamer would be consolidating noise.

### Gate 3: Lock
No other dream process running.

- Lock file: `.dream-lock` in the session folder
- Body: `{ "pid": 12345, "startedAt": "2026-04-07T19:30:00Z" }`
- Stale after 10 minutes (Dreamer should never take that long)
- On completion: update mtime to NOW (this IS the `lastDreamTime` for Gate 1)
- On failure: restore previous mtime (rollback)

---

## EXECUTION PATH

### Entry Point

```
POST /api/dream
Body: { sessionId: "2026-01-27-31" }
Response: SSE stream of progress events
```

Also triggerable from:
- Admin panel button (manual)
- End-of-session hook (automatic — when the user closes the chat or navigates away)
- Scheduled task (if using the schedule skill)

### The Engine

The Dreamer uses the SAME agentic loop as the API mode agents (`claude-api-loop.ts` or bridge mode). It's just a different prompt and restricted tools.

```typescript
// lib/dreamer/dreamer.ts

export async function executeDream(sessionId: string): Promise<DreamResult> {
  // 1. Check three gates
  const canDream = await checkGates(sessionId)
  if (!canDream.pass) return { skipped: true, reason: canDream.reason }

  // 2. Acquire lock
  const lock = await acquireLock(sessionId)
  if (!lock.acquired) return { skipped: true, reason: 'locked' }

  try {
    // 3. Build the four-phase prompt
    const prompt = buildDreamerPrompt(sessionId)

    // 4. Run the agentic loop with restricted tools
    const result = await runClaudeAgentLoop({
      model: 'claude-sonnet-4-6',  // Not Opus. Sonnet is good enough and cheaper.
      systemPrompt: prompt,
      tools: DREAMER_TOOL_DEFINITIONS,  // Restricted set
      maxTurns: 15,
      initialMessage: `Dream for session ${sessionId}. Begin Phase 1: Orient.`,
      callbacks: {
        onToolCall: (name, input) => emitDreamProgress(sessionId, 'tool', { name }),
        onText: (text) => emitDreamProgress(sessionId, 'thinking', { text }),
      }
    })

    // 5. Release lock (mtime = now)
    await releaseLock(sessionId)

    return { completed: true, turnsUsed: result.turns, filesModified: result.filesChanged }
  } catch (err) {
    // 6. Rollback lock mtime on failure
    await rollbackLock(sessionId, lock.priorMtime)
    throw err
  }
}
```

### Model Choice

**Sonnet 4.6**, not Opus, not Haiku.

- Haiku is too dumb for consolidation decisions (what to keep, what to kill, what contradicts what)
- Opus is overkill and expensive for a background task
- Sonnet hits the sweet spot: smart enough to merge, cheap enough to run often

---

## THE FOUR-PHASE PROMPT

Built by `buildDreamerPrompt()`. The prompt tells the agent exactly what to do in order.

### Phase 1: Orient (READ ONLY)

```
Read the session folder. Understand what exists before changing anything.

1. ls the session folder to see all files
2. Read SESSION.md — understand the workflow state, current phase, decisions made
3. Read IMAGES.md — understand image inventory and evaluations
4. Read BUILD.md — understand build history
5. Read CREATIVE-BRIEF.md — understand vibe definitions

After reading, report:
- Session phase (discovery / vibes / build / polish)
- How many vibes exist and their status
- Key decisions that were made
- Any contradictions you notice (e.g., SESSION.md says vibe-4 is CEO's pick but BUILD.md says vibe-8)
```

### Phase 2: Gather Signal (READ ONLY)

```
Now find what's NEW since the last dream. Grep narrowly — don't read wholesale.

1. In SESSION.md, find entries timestamped after [lastDreamTime]
2. In BUILD.md, find builds completed after [lastDreamTime]
3. In IMAGES.md, find images that were re-evaluated or re-tagged after [lastDreamTime]
4. In the chat history, grep for:
   - CEO decisions ("ship", "pick", "go with", "winner")
   - Feedback that reverses previous decisions ("actually", "no wait", "scratch that")
   - New creative direction ("instead of", "new approach", "pivot")
   - Bug reports and fixes applied

Collect the signal. Don't act on it yet.
```

### Phase 3: Consolidate (WRITE PHASE)

```
Now update the files. Rules:

SESSION.md:
- Keep: current phase, active decisions, unresolved questions, pending tasks
- Kill: decisions that were reversed (keep only the final decision)
- Kill: build attempts that failed and were superseded
- Kill: forensic reports on issues that were fixed (keep only "Fix applied: [what]")
- Convert: relative dates ("yesterday", "earlier today") → absolute ("2026-04-06")
- Merge: duplicate entries about the same topic

IMAGES.md:
- Keep: current evaluation status for each image (READY, HERO, B-ROLL, REDO)
- Kill: previous evaluation rounds that were superseded
- Kill: verbose descriptions of images whose status hasn't changed
- Compress: multi-paragraph evaluations → 1-2 sentences + status tag

BUILD.md:
- Keep: latest build per vibe with size/date/status
- Kill: intermediate builds that were superseded
- Kill: build logs for builds that no longer exist on disk
- Compress: multi-line build narratives → one-line summaries

CREATIVE-BRIEF.md:
- Keep: current vibe definitions, audience specs, mood boards
- Kill: vibe concepts that were abandoned
- Update: any specs that evolved during the session

CRITICAL RULES:
- Never delete information about the CURRENT state — only historical cruft
- When in doubt, keep it. Better to over-retain than lose signal
- Every edit must be a FileEdit (old_string → new_string), never a full rewrite
- After each file edit, re-read the file to verify the edit didn't break structure
```

### Phase 4: Prune & Verify

```
Final pass. Check your work.

1. Re-read each modified file
2. Verify: Does SESSION.md still accurately describe the current project state?
3. Verify: Does IMAGES.md still have an entry for every image on disk?
4. Verify: Does BUILD.md still have an entry for every HTML file on disk?
5. Verify: Are there any markdown formatting breaks (unclosed headers, broken tables)?

Target sizes after consolidation:
- SESSION.md: ≤ 150 lines / 8KB
- IMAGES.md: ≤ 300 lines / 20KB (this is the big one — 42 images × ~7 lines each)
- BUILD.md: ≤ 100 lines / 5KB
- CREATIVE-BRIEF.md: ≤ 150 lines / 8KB

If a file is still over target after consolidation, that's OK — it means the content is genuinely needed. Don't force-compress below the quality floor.

Report what you changed, what you kept, and why.
```

---

## TOOL RESTRICTIONS

The Dreamer gets a SUBSET of the tools. Heavy on reads, surgical on writes.

| Tool | Access | Notes |
|------|--------|-------|
| FileRead | ✅ Full | Read any file in the session folder |
| FileEdit | ✅ Limited | ONLY on SESSION.md, IMAGES.md, BUILD.md, CREATIVE-BRIEF.md |
| Glob | ✅ Full | List files to verify builds/images exist |
| Grep | ✅ Full | Search for patterns across files |
| Bash | ✅ Read-only | `ls`, `wc`, `stat`, `head`, `tail`, `cat` — no writes, no redirects |
| FileWrite | ❌ Denied | Never full-rewrites. Always FileEdit. |
| WebFetch | ❌ Denied | No reason to fetch URLs during dreaming |
| WebSearch | ❌ Denied | No reason to search during dreaming |
| append_log | ❌ Denied | Dreamer doesn't log to BUILD.md via tool — it edits it |

The tool definitions are built in `dreamer-tools.ts` — same format as `tool-executor.ts` but filtered.

**Path enforcement:** FileEdit validates that the target path is one of the four consolidation targets. Any attempt to edit CD-MEMORY.md, HTML files, or app source is rejected with an error message.

---

## THE LOCK FILE

Stealing Claude Code's trick: the lock file IS the timestamp.

```
// .dream-lock in the session folder
{
  "pid": 12345,
  "startedAt": "2026-04-07T19:30:00Z"
}
```

- **mtime of the file** = when the last dream COMPLETED (not started)
- Gate 1 reads this mtime to calculate hours since last dream
- On dream start: write PID + timestamp, save previous mtime for rollback
- On dream success: `touch` the file (updates mtime to now)
- On dream failure: restore the previous mtime with `utimes()`
- Stale detection: if `now - startedAt > 10 minutes`, lock is stale regardless of PID

---

## UI INTEGRATION

### Admin Panel
Add a "Dream" button to `/admin.html`:
- Shows last dream time and files modified
- Manual trigger button → POST `/api/dream`
- Progress stream (SSE) shows which phase the Dreamer is in

### TopBar Indicator
Subtle indicator when dreaming is active:
- Small pulsing dot next to the cost display
- Tooltip: "Dreamer: consolidating session memory..."
- Disappears when dream completes

### Post-Dream Notification
When dream completes, emit a session event that the Snackbar picks up:
```
"Dream complete: SESSION.md 290→142 lines, IMAGES.md 682→298 lines"
```

---

## COST ESTIMATE

Per dream cycle, Sonnet 4.6:
- Phase 1 (read 4 files): ~22K input tokens, ~500 output tokens
- Phase 2 (grep + targeted reads): ~5K input, ~1K output
- Phase 3 (15-20 FileEdits): ~30K input, ~5K output (each edit re-reads the file)
- Phase 4 (verify): ~15K input, ~1K output
- **Total: ~72K input, ~7.5K output ≈ $0.33 per dream**

At 4-hour gates with 3 sessions/day, that's ~2 dreams/day = **$0.66/day** for memory hygiene. Compared to the token waste of 22K stale context per CD turn, this pays for itself in about 3 CD interactions.

---

## WHAT THIS DOES NOT INCLUDE (YET)

1. **Extract Memories (within-session)** — the real-time note-taker that runs after each CD turn. That's Phase 2. The Dreamer works without it — it just consolidates more aggressively.

2. **Topic files / memdir** — the Claude Code pattern of splitting memories into semantic topic files with frontmatter. For now, the Dreamer consolidates the EXISTING files in place. Topic files come later when you have multiple clients/sessions.

3. **Recall system** — the Sonnet-powered "pick 5 relevant memories" per query. Overkill for single-client. Becomes essential at multi-client scale.

4. **Cross-session dreaming** — this spec is per-session. Cross-session consolidation (learning from FalCaMel that applies to all café clients) is a Tier 3 feature.

---

## BUILD ORDER FOR CLAUDE CODE

Tell Claude Code to build in this order:

1. `lib/dreamer/dreamer-lock.ts` — the lock file system (smallest, self-contained, testable)
2. `lib/dreamer/dreamer-tools.ts` — restricted tool definitions (filter from existing tool-executor.ts)
3. `lib/dreamer/dreamer-prompt.ts` — the four-phase prompt builder (takes sessionId, returns string)
4. `lib/dreamer/dreamer.ts` — the engine (checkGates → acquireLock → runLoop → releaseLock)
5. `app/api/dream/route.ts` — the API endpoint (POST trigger, SSE progress stream)
6. Admin panel button + Snackbar notification wiring

Each step is testable independently. Step 1-3 are pure functions with no side effects. Step 4 integrates them. Step 5 exposes it. Step 6 is UI sugar.
