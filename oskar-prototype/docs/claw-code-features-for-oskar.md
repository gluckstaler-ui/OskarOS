# Features OskarOS Should Steal from the Claude Code Leak

> **REWRITE v2** — Now based on actual TypeScript source code from `xorespesp/claude-code` (complete NPM sourcemap reconstruction, 1,900+ files, 512K lines).
> Previous version was based on the Rust/Python port (`ultraworkers/claw-code`) which only had ~30% of the architecture.
> Changes from v1 marked with **⚡ SOURCE UPDATE**
> Status block added: 2026-05-01

---

## STATUS UPDATE — 2026-05-01

Plan body below preserved for context. Of the 20 items, **6 SHIPPED** (sometimes differently than spec'd), **5 PARTIAL** (worth completing), **5 NOT IMPLEMENTED but still worth stealing**, and **4 DELIBERATE NON-PORTS** (we chose a different shape and it's working — don't revert).

The biggest single shift since v2 (Apr 3): the entire memory/dream stack (#12) was **replaced by Sage**, not built as planned. See `MEMORY-SYSTEM-BUILD-PLAN.md` and `DREAMER-IMPLEMENTATION-SPEC.md` 2026-05-01 status blocks for the full trace. After re-audit + CD review, **only prompt caching survives** as a steal-worthy item from the memory-related sections.

### STATUS TIER 1 — Steal Immediately

#### 1. Agentic Loop Pattern - PARTIAL

**SHIPPED:** `lib/claude-api-loop.ts`, `lib/gemini-loop.ts`, `lib/tool-executor.ts`, HTTP MCP transport at `app/api/mcp/server/route.ts`, SSE via `lib/session-events.ts`, stream-json output for live UI updates in `lib/memory/anthropic.ts`.

**MISSING (worth stealing):** AsyncGenerator pattern, ToolUseContext god object, **self-healing recovery cascade** (`max_output_tokens` retry up to 3x, `prompt_too_long` → auto-compact → reactive compact → context collapse). Without the cascade, OskarOS dies hard at context limits. Effort: ~150–200 LOC in `claude-api-loop.ts`.

#### 2. Permission System - NOT IMPLEMENTED (worth stealing for productization)

**HAVE:** Agent-file constraints (Sage Portrait "YOU HAVE NO TOOLS"), `--tools ''` CLI flag, BashTool sandbox classifier. No `PermissionMode` rule engine, no `alwaysAllowRules`/`alwaysDenyRules`, no **deny-rules-strip-tools-before-model-sees-them**.

**WHEN TO STEAL:** Required for productization (FEATURE-X Track C). Customers shouldn't have full tool access. Effort: ~400 LOC adapted from `utils/permissions/` (5,400 LOC source).

#### 3. Pre/Post Tool Hooks - DIFFERENT MODEL SHIPPED

**SHIPPED INSTEAD:** Event-bus (`lib/event-bus.ts`) + agent inbox bus (`lib/agent-inbox-bus.ts`) + `replay_events` ring buffer + `notify_agent` peer-to-peer. **Observation, not interception.** Hooks can BLOCK/MODIFY tool calls; our bus only OBSERVES.

**PARTIAL STEAL:** `PostSampling` hook semantics specifically — fires after every API response — would be a clean place for things like "after each CD turn, validate output against the brief" without polluting CD's prompt. Effort: ~80 LOC if we want it.

**DO NOT IMPLEMENT:** The full 12-file / 8,000-LOC hook infrastructure. Our event-bus model is already solving most of what hooks solve, just with different mechanics.

#### 4. Context Compaction - PARTIAL (Sage replaces some)

**SHIPPED:** Sage 240/40 (block-narrative compression) + Sage Portrait (`lib/memory/dreamer.ts`, 1948 LOC) + 24h pre-prune snapshot retention + tiered pass schedule (2/4/6 passes by file size).

**MISSING (worth stealing):** `microCompact` for old tool results inline (replace with `[Old tool result content cleared]`) — different problem from Sage's SESSION.md compaction. **CD's 2026-05-01 correction:** prompt caching reduces the urgency of microCompact significantly; the cost model is `~1.1× size with caching`, not `N× size`.

**MISSING (lower priority):** `autoCompact` (live conversation token-limit) was Lumberjack — RETIRED 2026-05-01 per Ralph. `reactiveCompact` (fire on `prompt_too_long`) is part of the recovery cascade in #1. The 9-section BASE_COMPACT_PROMPT structure is good if we ever need conversation summaries.

#### 5. Session Persistence (JSONL) - DELIBERATE NON-PORT

**SHIPPED INSTEAD:** Markdown SESSION.md, CREATIVE-BRIEF.md, IMAGES.md, BUILD.md, user.md. Single-file-per-concern, append-only-ish, human-reviewable. CD reads these directly as part of cold-boot; Sage operates on them as text.

**DO NOT IMPLEMENT:** JSONL would break human-readability — that's the whole point of markdown. The content-replacement pattern (large bodies stored separately) could apply to the bus `messageLog`, but per CD's 2026-05-01 correction, that's storage not API conversation — not a high-leverage problem.

#### 6. Usage Tracking & Cost Estimation - PARTIAL

**SHIPPED:** `lib/usage-tracker.ts` with `appendUsage` + `calculateCost`.

**MISSING:** `cache_creation_input_tokens` / `cache_read_input_tokens` separate tracking. **STEAL when prompt caching lands** (FEATURE-X) — without it we'd misreport costs by ~10×. Effort: ~50 LOC.

### STATUS TIER 2 — Steal Soon

#### 7. Tool Registry Pattern - PARTIAL (different shape)

**SHIPPED:** `mcp-server/tools-{cd,webdev,sentinel,orchestrator,capabilities}.ts` define typed tool schemas + dispatch. 22+ MCP tools wired through the HTTP MCP server.

**MISSING:** `isEnabled()` per-tool gating, `filterToolsByDenyRules()` strip-before-model-sees pattern (essential for permission system #2). Switch dispatch instead of typed `Tool<Input, Output>` objects. The deny-strip pattern is the most useful piece — pairs with #2.

#### 8. Structured File Operations - SUFFICIENT

**SHIPPED:** `apply_patch` MCP tool (jsdom HTML patcher) handles our domain — HTML edits, not arbitrary code edits. FileEditTool's 625 LOC of unique-old-string + indentation-preservation isn't needed at our scope.

**DO NOT IMPLEMENT:** Wholesale port. Our narrower domain doesn't justify it.

#### 9. Multi-Provider API Client - PARTIAL

**SHIPPED:** CLI + API mode + Anthropic + Gemini, both streaming via stream-json.

**MISSING:** Sophisticated error categorization, fallback model on persistent failures. Covered by #19 below — see status there.

#### 10. SSE Streaming - SHIPPED

`lib/session-events.ts`. Done.

#### 11. System Prompt Builder - SUFFICIENT

**SHIPPED:** `lib/cd-agent-prompt.ts` + `lib/sage-agent-prompt.ts`. Loads from agent files; injects user.md + CD-MEMORY + clock block.

**DO NOT IMPLEMENT:** Anthropic's "memory rules" injection (the 4-type taxonomy + how-to-use-memories instructions). Sage's portrait painter handles this implicitly via portrait painting; explicit rules would clash with Sage doctrine.

### STATUS TIER 2.5 — Memory/Dream System

#### 12. Agent Memory System - WHOLLY REPLACED BY SAGE (deliberate)

**REPLACED BY:** Sage Portrait + Sage 240/40 (`agents/sage-portrait.md`, `agents/sage-240-40.md`, `lib/memory/dreamer.ts`). Different architecture on every axis: trigger (session-end vs. cron), scope (per-session `user.md` vs. global memdir), recall (unconditional inject vs. Sonnet selection), extraction (session-end portrait vs. post-turn cursor).

**ONLY SURVIVOR FROM THE FULL AUDIT:** **Per-tool prompt caching** (`cache_control: { type: 'ephemeral' }` on tool definitions). Sage 240/40 fires up to 6 passes per cycle, re-sending its 8KB system prompt every pass. Zero caching today. **This belongs in FEATURE-X**, not in this plan's structure. See `MEMORY-SYSTEM-BUILD-PLAN.md` § "NICE-TO-HAVE FROM ANTHROPIC'S SOURCE" 2026-05-01.

**DO NOT IMPLEMENT:** All 13 specific primitives in DREAMER-IMPLEMENTATION-SPEC.md's status block (memdir scan/age/truncate/recall/extract, 3-gate auto-trigger, 4-type taxonomy, runForkedAgent cache-share, KAIROS daily-log, team memory, etc.).

### STATUS TIER 3 — Steal When Ready

#### 13. MCP Server Manager - DIFFERENT SHAPE; STEAL ONLY THE SMALL PART

**Naming correction:** `services/mcp/client.ts` (3,348 LOC) is an MCP **CLIENT** that connects to and consumes external MCP servers. We shipped the MIRROR IMAGE — an MCP **SERVER** at `app/api/mcp/server/route.ts` that exposes our own tools to our own agents.

**Different concerns:**
- Their client: transport polymorphism (stdio/SSE/HTTP/WebSocket), OAuth, untrusted-output sanitization, connection pooling, OAuth refresh, image resizing, persistent storage of large external results
- Our server: typed in-process tool schemas, single-process Next.js, multi-agent routing, per-`(session, role, instance)` bus addressing

**WORTH STEALING (per CD review 2026-05-01):**
1. **`inferCompactSchema()`** (~30 LOC, `services/mcp/client.ts:2644`) — turns `{assets: [{filename, size, ...}, ...148 more]}` into a 5-line structural summary. Single highest-value function in the entire 3,348 LOC. Pairs with our existing `truncated: true` flag. Apply across ALL list-returning tools, not only oversized ones.
2. **Truncation discipline as a contract** — formalize what we already half-do. Standard response shape `{data, truncated, total?, schema?, hint?}` where `hint` is a canned "use X to narrow" string. Apply across `list_assets` / `find_assets` / `vibe_diff` / `thread_history` / `replay_events`.
3. **Hard caps on the 3 actually-unbounded tools:** `vibe_diff` (cap by hunks), `thread_history` (cap by message count + paginate), `find_assets` (require query OR limit).

Total: ~150 LOC + 3 tool edits. **One-day workpackage.**

**DO NOT IMPLEMENT (CD's correction 2026-05-01):**
- **Disk-persist + path-reference flow** for large tool results. The "biggest blind spot" framing was wrong on three counts: (a) bus `messageLog` and `replay_events` are storage, not API conversation; (b) prompt caching changes cost from `N×size` to `~1.1×size`; (c) the "8 risky tools" list was half wrong (`list_assets` is paginated, `screenshot` returns a path not bytes, `replay_events` has `sinceTs`, `image_ops` writes a file — only 3 are actually unbounded). The disk-persist approach also adds mandatory second tool calls and cache-directory lifecycle complexity. Solving a problem we don't have at the magnitude claimed.
- **Generic MCP client (3,348 LOC port).** Today: zero outbound MCP needs. CLI-mode CD inherits Claude Code's GitHub/Figma client transitively; API-mode has no external MCP needs in any current WP. When the trigger lands (productized SaaS with tenant-deployed MCP servers per FEATURE-X), build on `@modelcontextprotocol/sdk` directly — stdio + HTTP transports only, API-key auth only, ~250 LOC of glue. Don't preemptively design.

**Trigger condition for the WP:** a concrete external MCP server we want to consume from API mode that the CLI subprocess can't transit. Until then, one paragraph in the productization backlog and move on.

#### 14. Plugin Architecture - N/A

Different UX surface (chat, not CLI plugins). **DO NOT IMPLEMENT.**

#### 15. Slash Commands - N/A

Different UX surface (chat, not CLI). **DO NOT IMPLEMENT.**

#### 16. Sandbox & Isolation - PARTIAL

**SHIPPED:** BashTool sandbox classifier in mcp-server tools.

**MISSING:** Broader filesystem isolation framework. Not needed unless customers run untrusted agents — defer to productization.

#### 17. OAuth & Authentication - N/A

Single-user app today. **REVISIT for productization** (FEATURE-X Track C: multi-tenant requires auth). Defer.

#### 18. Git Operations - N/A

Chat-driven workflow, not git-driven. **DO NOT IMPLEMENT** unless Director Mode needs vibe-version git checkpoints (no current evidence of need).

#### 19. Retry & Backoff (`withRetry`) - MINIMAL — WORTH STEALING

**SHIPPED:** Basic retry in `lib/memory/anthropic.ts`.

**MISSING (worth stealing):**
- AsyncGenerator pattern that yields `SystemAPIErrorMessage` during waits (UI shows "retrying..." instead of silent block)
- Foreground/background distinction (`MAX_529_RETRIES = 3` for background, `DEFAULT_MAX_RETRIES = 10` for foreground)
- OAuth 401 → token-refresh
- ECONNRESET / EPIPE → no-backoff retry
- `FallbackTriggeredError` → switch to cheaper model on persistent failures

Effort: ~200 LOC adapted from `services/api/withRetry.ts` (822 LOC source).

#### 20. Subagent Forking - DIFFERENT PROBLEM

**Their fork:** byte-identical request-prefix bytes for prompt-cache hits across child agents. Used for autoDream, classifiers, microcompact summarizer. THE WHOLE POINT is cache stability.

**Our agent_inbox bus:** peer-to-peer coordination between agents with DIFFERENT identities, system prompts, and tool pools. Cache-share doesn't apply because our agents' prompts differ.

**DO NOT IMPLEMENT.** They solve different problems. Forking would only become useful if we add a "cheap secondary computation within a single agent's session" — none planned.

### Cross-cutting DO NOT IMPLEMENT (carried forward, validated)

- **memdir 4-type taxonomy** — rejected by Sage doctrine.
- **Generic MCP client** — build only when external MCP need arises (see #13).
- **Disk-persist + path-reference for tool results** — cost math doesn't justify with prompt caching (CD correction).
- **Markdown → JSONL conversion for session files** — deliberate divergence.
- **Hourly clock-aligned auto-trigger for memory consolidation** — Sage runs on session-end, no cron needed.

### What IS the source of truth for "what to steal"

- **This document's tier list** — preserved as planning history; status above for current state
- **`docs/MEMORY-SYSTEM-BUILD-PLAN.md` § NICE-TO-HAVE** — definitive on memory/Sage primitives
- **`docs/FEATURE-X.md`** — owns prompt caching + productization tracks
- **CD's 2026-05-01 review** — ground truth on the MCP client steal scope (see this turn's exchange)

---

## TIER 1: STEAL IMMEDIATELY — These solve problems you have right now

### 1. The Agentic Loop Pattern

**Source files:** `query.ts` (1,729 lines), `QueryEngine.ts` (1,295 lines), `services/tools/toolExecution.ts` (1,745 lines), `services/tools/toolOrchestration.ts` (188 lines)

**What it is:** ⚡ SOURCE UPDATE — It's not a single `run_turn()` function. It's an `async function* query()` that yields `StreamEvent | Message` as an AsyncGenerator. The actual loop is `queryLoop()` which carries mutable `State` across iterations:

```typescript
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  transition: Continue | undefined  // why previous iteration continued
}
```

The loop sends messages → streams response → extracts `tool_use` blocks → runs permissions + hooks → executes tools via `runTools()` → yields results → continues until terminal. **⚡ KEY DETAIL:** It's a generator, not a promise. Every tool result, every stream chunk, every progress event gets `yield`ed back to the caller. This is how the UI stays live during long agentic turns.

**⚡ SOURCE UPDATE — The ToolUseContext is massive.** It's not just "here are the tools." It carries: AbortController, file state cache, app state getter/setter, thinking config, MCP clients, agent definitions, query chain tracking (depth + chain ID), file reading limits, glob limits, content replacement state, and denial tracking state. This is the God Object that flows through the entire system.

**⚡ SOURCE UPDATE — Self-healing recovery cascade.** When `max_output_tokens` fires, the loop tries up to 3 recovery attempts before giving up. When context is too long, it tries auto-compact → reactive compact → context collapse (all behind feature flags). The `FallbackTriggeredError` class handles model fallback (e.g., Sonnet → Haiku on repeated failures).

**Why OskarOS needs it:** Your `/api/chat` route is a single async function that returns when done. No streaming during tool execution, no recovery cascade, no yielding intermediate state. The generator pattern is the unlock.

**Implementation:** Refactor `/api/chat/route.ts` into:
- `queryLoop()` — AsyncGenerator that yields events, carries State
- `ToolUseContext` — the context bag (start simple: tools, abort controller, file state, permissions)
- `runTools()` — parallel tool execution with permission checks + hooks

---

### 2. Permission System

**Source files:** `utils/permissions/permissions.ts` (1,486 lines), `utils/permissions/PermissionMode.ts` (141 lines), `utils/permissions/PermissionResult.ts`, `utils/permissions/PermissionRule.ts`, `utils/permissions/filesystem.ts` (1,777 lines), `utils/permissions/permissionsLoader.ts` (296 lines), `utils/permissions/bashClassifier.ts`, `utils/permissions/dangerousPatterns.ts`

**What it is:** ⚡ SOURCE UPDATE — It's way more sophisticated than 5 permission modes. The actual modes are:

```typescript
// From types/permissions.ts (via PermissionMode.ts)
type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk' | 'auto' | 'bubble'
```

**`default`** — ask for permission on writes/dangerous ops. **`plan`** — read-only, no execution. **`acceptEdits`** — auto-approve file edits, still ask for bash. **`bypassPermissions`** — YOLO mode, approve everything. **`dontAsk`** — auto-deny what would normally be asked. **`auto`** — ML classifier decides (ant-only, behind `TRANSCRIPT_CLASSIFIER` feature flag). **`bubble`** — ant-only internal.

**⚡ SOURCE UPDATE — The ToolPermissionContext is not just a mode.** It's a full rule engine:
```typescript
type ToolPermissionContext = {
  mode: PermissionMode
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>
  alwaysAllowRules: ToolPermissionRulesBySource
  alwaysDenyRules: ToolPermissionRulesBySource
  alwaysAskRules: ToolPermissionRulesBySource
  isBypassPermissionsModeAvailable: boolean
  shouldAvoidPermissionPrompts?: boolean  // background agents
}
```

Rules come from multiple sources (user settings, project settings, policy settings) and are merged. `filterToolsByDenyRules()` strips denied tools BEFORE the model even sees them — they're removed from the tools array in the API call.

**⚡ SOURCE UPDATE — filesystem.ts is 1,777 lines** of path validation alone. It handles: dangerous directory detection, workspace-only enforcement, auto-memory path carve-outs (memory dir gets write access even in restricted modes), symlink resolution, and path traversal prevention.

**Implementation for cPanel:** Three tiers still works, but steal the rule engine pattern:
- `ReadOnly` — read files, list dirs
- `WorkspaceWrite` — edit within `/home/aweseybn/webbuilder/public/` + auto-memory carve-out for session files
- `ServerAdmin` — cPanel UAPI calls

Plus: `alwaysDenyRules` for paths like `.htaccess`, `node_modules/`, `.env`. Deny rules strip tools from the API call so the model never even tries.

---

### 3. Pre/Post Tool Hooks

**Source files:** `utils/hooks.ts` (5,022 lines — the biggest single file), `utils/hooks/hookEvents.ts`, `utils/hooks/hookHelpers.ts`, `utils/hooks/hooksConfigManager.ts` (400 lines), `utils/hooks/hooksSettings.ts` (271 lines), `utils/hooks/AsyncHookRegistry.ts` (309 lines), `utils/hooks/execAgentHook.ts`, `utils/hooks/execHttpHook.ts`, `utils/hooks/execPromptHook.ts`, `utils/hooks/postSamplingHooks.ts`, `utils/hooks/sessionHooks.ts` (447 lines), `services/tools/toolHooks.ts` (650 lines)

**What it is:** ⚡ SOURCE UPDATE — This is not a simple Allow/Deny system. It's a **12-file, 8,000+ line hook infrastructure** that supports three execution modes:

1. **Command hooks** — run a shell command, check exit code
2. **Agent hooks** — spawn a subagent that evaluates the tool call
3. **HTTP hooks** — POST to a webhook URL
4. **Prompt hooks** — ask the user interactively

**⚡ SOURCE UPDATE — Hook events are typed and specific:**
- `PreToolUse` — fires before tool execution, can Allow/Deny/Warn
- `PostToolUse` — fires after, can inspect output, modify MCP tool output
- `PostSampling` — fires after each API response (for extractMemories, autoDream, session memory)
- `PreCompact` / `PostCompact` — fires around context compaction
- `SessionStart` / `SessionStop` — session lifecycle
- `PermissionRequest` / `PermissionDenied` — fires when permissions are checked
- `StopFailure` — fires when the stop condition fails

**⚡ SOURCE UPDATE — The AsyncHookRegistry** manages concurrent hook execution with proper abort signal propagation. Hooks can be registered per-tool (matching by name or glob pattern) or globally. The `hooksConfigManager.ts` handles hot-reloading of hook configs from `.claude/settings.json`.

**⚡ SOURCE UPDATE — PostSampling hooks are the critical ones for memory.** `executePostSamplingHooks()` is where `extractMemories`, `autoDream`, and `sessionMemory` get triggered — after every API response, not after every tool call.

**Implementation:** Start with just PreToolUse and PostToolUse as command hooks. The session lifecycle hooks (PostSampling) are what you need for the Dreamer agent trigger.

---

### 4. Context Compaction

**Source files:** `services/compact/compact.ts` (1,705 lines), `services/compact/autoCompact.ts` (351 lines), `services/compact/microCompact.ts` (530 lines), `services/compact/sessionMemoryCompact.ts` (630 lines), `services/compact/prompt.ts` (374 lines), `services/compact/grouping.ts` (63 lines), `services/compact/snipCompact.ts`, `services/compact/reactiveCompact.ts`

**What it is:** ⚡ SOURCE UPDATE — It's not one compaction strategy. It's **six**, each behind feature flags:

1. **Auto-compact** (`autoCompact.ts`) — threshold-based, fires when token count exceeds limit. Tracks state via `AutoCompactTrackingState` including token warning levels.
2. **Micro-compact** (`microCompact.ts`, 530 lines) — lightweight, runs mid-turn when individual tool results are too large. Summarizes tool output inline without touching the conversation.
3. **Session Memory compact** (`sessionMemoryCompact.ts`, 630 lines) — uses pre-extracted session notes to replace the full summary. Protects API invariants: never splits `tool_use`/`tool_result` pairs, preserves thinking blocks.
4. **Snip compact** (`snipCompact.ts`) — behind `HISTORY_SNIP` feature flag, user-triggered via `/snip` command
5. **Reactive compact** (`reactiveCompact.ts`) — behind `REACTIVE_COMPACT` feature flag, fires when `prompt_too_long` error comes back from API
6. **Context collapse** — behind `CONTEXT_COLLAPSE` feature flag, nuclear option

**⚡ SOURCE UPDATE — The compaction prompt** (`prompt.ts`, 374 lines) has three variants:
- `BASE_COMPACT_PROMPT` — full conversation summary across 9 sections (primary request, technical concepts, files/code, errors, problem-solving, user messages, pending tasks, current work, next steps)
- `PARTIAL_COMPACT_PROMPT` — only recent messages, assumes earlier context retained
- `PARTIAL_COMPACT_UP_TO_PROMPT` — for session continuations

All start with `NO_TOOLS_PREAMBLE` — an explicit instruction to not use tools during summarization, preventing wasted API calls.

**⚡ SOURCE UPDATE — compact.ts uses `runForkedAgent()`** — compaction runs as a forked subagent that shares the parent's prompt cache (via `CacheSafeParams`). This means compaction doesn't cost a full new context load.

**⚡ SOURCE UPDATE — `buildPostCompactMessages()`** reconstructs the conversation after compaction, re-attaching: MCP instruction deltas, deferred tool deltas, agent listing deltas, and file state attachments. The model doesn't lose awareness of available tools/agents after compaction.

**Implementation:** Start with auto-compact only. Token estimation via `chars / 4`. When over 80K threshold: fork a summarization call using the BASE_COMPACT_PROMPT's 9-section structure. The session memory compact is the stretch goal — it's what makes compaction actually good instead of lossy.

---

### 5. Session Persistence

**Source files:** `utils/sessionStorage.ts` (5,105 lines), `utils/sessionStoragePortable.ts` (793 lines), `utils/sessionRestore.ts` (551 lines), `utils/sessionStart.ts` (232 lines), `utils/sessionState.ts` (150 lines), `utils/sessionActivity.ts` (133 lines)

**What it is:** ⚡ SOURCE UPDATE — `sessionStorage.ts` is 5,105 lines. It's not just save/load. It handles:

- **Transcript recording** — `recordTranscript()` writes each message to a `.jsonl` file (one JSON object per line, not a JSON array — so partial writes don't corrupt the file)
- **Content replacement** — tool results that exceed a budget get replaced with stubs, originals stored separately. `recordContentReplacement()` tracks what was replaced so it can be restored on resume.
- **Flush management** — `flushSessionStorage()` ensures writes are durable before session ends
- **Portable format** — `sessionStoragePortable.ts` (793 lines) handles cross-platform session transfer

**⚡ SOURCE UPDATE — `sessionRestore.ts` (551 lines)** handles resuming sessions. It's not just "load the JSON." It rebuilds: file state cache, thinking config, tool decisions map, content replacement state, and revalidates that referenced files still exist.

**⚡ SOURCE UPDATE — The session file is `.jsonl`, not `.json`.** Each line is a self-contained message. This means: append-only writes (no read-modify-write cycle), crash-safe (partial last line = skip it), and streamable (don't need to parse the whole file to read recent messages).

**Implementation:** Switch from JSON to JSONL for session files. Append-only writes. On resume, stream-parse line by line and rebuild state. The content replacement pattern is worth stealing too — store large tool results (like full HTML pages) separately so they don't bloat the session file.

---

### 6. Usage Tracking & Cost Estimation

**Source files:** `cost-tracker.ts` (323 lines), `costHook.ts` (22 lines), `services/api/usage.ts` (63 lines), `services/api/emptyUsage.ts` (22 lines), `services/api/logging.ts` (788 lines)

**What it is:** ⚡ SOURCE UPDATE — From `cost-tracker.ts`:
- `getModelUsage()` — returns per-model breakdown
- `getTotalAPIDuration()` — wall clock time spent in API calls
- `getTotalCost()` — cumulative dollar cost

From `services/api/logging.ts` (788 lines) — the `NonNullableUsage` type tracks:
```typescript
{
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}
```
`accumulateUsage()` and `updateUsage()` in `services/api/claude.ts` handle per-turn accumulation.

**⚡ SOURCE UPDATE — `costHook.ts` is just 22 lines** — it's a React hook (`useCostDisplay`) that formats cost for the UI. The real work is in `cost-tracker.ts` which is imported from `QueryEngine.ts` at the top level.

**⚡ SOURCE UPDATE — Cache token tracking is a first-class concern.** The bootstrap state tracks `getTotalCacheCreationInputTokens()` and `getTotalCacheReadInputTokens()` separately. This matters because cache reads are 90% cheaper than fresh input tokens — if you're not tracking cache hits, you're overestimating your costs.

**Implementation:** Extend your existing `usage-tracker.ts`:
- Add `cache_creation_input_tokens` and `cache_read_input_tokens` fields
- Track per-model (Sonnet vs Opus pricing differs)
- Store in session JSONL alongside messages
- Show running cost in UI (steal the `useCostDisplay` hook pattern)

---

## TIER 2: STEAL SOON — These make the architecture proper

### 7. Tool Registry Pattern

**Source files:** `Tool.ts` (792 lines), `tools.ts` (389 lines), `types/tools.ts`

**What it is:** ⚡ SOURCE UPDATE — It's not a class-based registry. Tools are objects conforming to the `Tool<Input, Output>` interface:

```typescript
// From Tool.ts — the actual interface (simplified)
type Tool<Input, Output> = {
  name: string
  description: string
  inputSchema: ToolInputJSONSchema
  isEnabled: () => boolean
  call: (input: Input, context: ToolUseContext) => AsyncGenerator<ToolProgress, Output>
  // ... validation, permission helpers, MCP info
}
```

`tools.ts` exports `getAllBaseTools(): Tools` which returns an array of ~40 tool instances. The array is built with feature-flag gating — tools behind flags like `KAIROS`, `COORDINATOR_MODE`, `HISTORY_SNIP` are conditionally included via `feature()` checks at build time (Bun's dead code elimination).

**⚡ SOURCE UPDATE — `getTools()` applies deny rules BEFORE returning.** `filterToolsByDenyRules()` checks the permission context and removes tools the model shouldn't even know about. Then `assembleToolPool()` merges built-in tools with MCP tools, sorted for prompt-cache stability (built-ins first, alphabetical within each group — so adding an MCP tool doesn't invalidate the cache for built-in tool definitions).

**⚡ SOURCE UPDATE — Tool execution is also a generator.** Each tool's `call()` returns `AsyncGenerator<ToolProgress, Output>` — it yields progress events (spinner states, partial results) and returns the final output. This is how BashTool shows streaming command output.

**Implementation:**
```typescript
// lib/tools/types.ts
type Tool<Input = any, Output = any> = {
  name: string
  description: string
  inputSchema: ToolInputJSONSchema
  permission: 'ReadOnly' | 'WorkspaceWrite' | 'ServerAdmin'
  isEnabled: () => boolean
  call: (input: Input, context: ToolUseContext) => Promise<Output>
}

// lib/tools/registry.ts — just an array, not a class
const tools: Tool[] = []
export const register = (tool: Tool) => tools.push(tool)
export const getToolDefinitions = () => tools.filter(t => t.isEnabled())
export const execute = (name: string, input: any, ctx: ToolUseContext) =>
  tools.find(t => t.name === name)?.call(input, ctx)
```

---

### 8. Structured File Operations

**Source files:** `tools/FileReadTool/FileReadTool.ts` (1,183 lines), `tools/FileEditTool/FileEditTool.ts` (625 lines), `tools/FileEditTool/utils.ts` (775 lines), `tools/FileWriteTool/FileWriteTool.ts` (434 lines), `tools/GlobTool/GlobTool.ts` (198 lines), `tools/GrepTool/GrepTool.ts` (577 lines), `tools/BashTool/` (8 files, 7,800+ lines)

**What it is:** ⚡ SOURCE UPDATE — These are massive. FileReadTool alone is 1,183 lines because it handles:
- PDF reading (page ranges)
- Image reading (sends as base64 content block)
- Jupyter notebook parsing
- Offset/limit for large files
- Line number formatting (`cat -n` style)
- File state caching (tracks which files were read and at what offset)

**⚡ SOURCE UPDATE — FileEditTool's `utils.ts` (775 lines)** contains the actual old→new string replacement algorithm. It handles: uniqueness checking (rejects if old_string appears multiple times), indentation preservation, replace_all mode, and generates structured diffs showing exactly what changed.

**⚡ SOURCE UPDATE — BashTool is 8 files / 7,800+ lines.** `bashSecurity.ts` (2,592 lines) alone handles: command injection detection, dangerous pattern matching, output redirect validation, and sandbox enforcement. `bashPermissions.ts` (2,621 lines) handles the permission classification — it speculatively pre-checks the next likely command while the current one runs.

**⚡ SOURCE UPDATE — GrepTool (577 lines)** supports: regex patterns, glob filtering, type filtering, output modes (content/files_with_matches/count), context lines (-A/-B/-C), multiline mode, head_limit + offset for pagination. Returns structured results, not raw ripgrep output.

**Implementation:** Start with simplified versions — your agent writes HTML, not arbitrary code. But steal: the old→new edit pattern (critical for modifying HTML without rewriting), the structured output format, and the file state cache (so the agent knows what it already read).

---

### 9. Multi-Provider API Client

**Source files:** `services/api/client.ts` (389 lines), `services/api/claude.ts` (3,419 lines — the biggest service file), `services/api/errors.ts` (1,207 lines), `services/api/errorUtils.ts` (260 lines), `services/api/withRetry.ts` (822 lines), `services/api/bootstrap.ts` (141 lines)

**What it is:** ⚡ SOURCE UPDATE — `claude.ts` is 3,419 lines. It's not just a client wrapper. It handles:
- Streaming with `AsyncGenerator` (yields `StreamEvent` types)
- Task budget tracking (`output_config.task_budget` — limits total output tokens across an agentic turn)
- Tool choice configuration (`auto`, `any`, `none`, or specific tool)
- Thinking/extended thinking configuration
- Prompt cache management (cache breakpoint detection, prompt cache miss tracking)
- Model-specific parameter tuning

**⚡ SOURCE UPDATE — The error system (`errors.ts`, 1,207 lines)** classifies every API error type: prompt too long, max output tokens, invalid request, rate limit, overloaded, authentication, billing, content moderation. Each has specific recovery strategies. `categorizeRetryableAPIError()` determines which errors trigger retry vs fallback vs terminal failure.

**Implementation:** Not urgent, but design your API client to return `AsyncGenerator<StreamEvent>` from day one. The generator pattern is what makes everything else composable.

---

### 10. SSE Streaming

**Source files:** `cli/transports/SSETransport.ts` (711 lines)

**What it is:** ⚡ SOURCE UPDATE — `SSETransport.ts` is 711 lines, not a simple parser. It's a full bidirectional transport layer that handles: connection establishment, reconnection with backoff, event parsing, abort signal propagation, and keep-alive detection. Used for remote sessions and SDK integration.

**Implementation:** Use the Anthropic SDK's built-in streaming for now. Steal this pattern only if you build a remote session feature.

---

### 11. System Prompt Builder

**Source files:** `QueryEngine.ts` → `fetchSystemPromptParts()` from `utils/queryContext.ts`, `memdir/memdir.ts` → `loadMemoryPrompt()`, `context.ts` (189 lines)

**What it is:** ⚡ SOURCE UPDATE — The system prompt isn't built by a builder class. It's assembled by `fetchSystemPromptParts()` which returns typed parts:

1. **Base identity** — the core system prompt (claude_code's is generated server-side, not in the TS code)
2. **Memory prompt** — from `loadMemoryPrompt()` in `memdir.ts`, which routes based on mode:
   - KAIROS mode → append-only daily logs
   - TEAMMEM mode → combined auto + team memory
   - Default → single auto memory directory
3. **Instruction files** — discovered by walking UP the filesystem (CLAUDE.md at each level)
4. **Tool descriptions** — generated from the tool registry
5. **MCP context** — instructions from connected MCP servers
6. **Session context** — file state, recent errors, git status

**⚡ SOURCE UPDATE — The memory prompt section includes behavioral rules baked in.** `buildMemoryLines()` in `memdir.ts` generates instructions about the 4-type taxonomy (user/feedback/project/reference), the two-step indexing protocol (write file + update MEMORY.md), and the "what NOT to save" guidance. The model doesn't just get memories — it gets rules for how to use them.

**Implementation:**
```typescript
const systemPrompt = [
  cdAgentIdentity,              // who the agent is (CD-MEMORY.md behavioral DNA)
  buildMemorySection(session),   // session files + instructions for using them
  buildToolDescriptions(tools),  // available tools
  buildRuntimeContext(server),   // cPanel state, disk space, etc.
].join('\n\n')
```

---

## TIER 2.5: THE MEMORY/DREAM SYSTEM — Priority #1 per Ralph

### 12. Agent Memory System (autoDream + memdir + extractMemories + SessionMemory)

**Source files:** See `claude-code-memory-architecture.md` for the full breakdown. 30+ files, 4,000+ lines.

**This was #19 in v1. It's actually #1.**

The 5-layer stack: CLAUDE.md (static) → memdir/ (persistent topics) → Session Memory (within-session notes) → Extract Memories (post-turn consolidator) → autoDream (cross-session Dreamer).

**What OskarOS has:** CD-MEMORY.md (identity, ✅), SESSION.md / CREATIVE-BRIEF.md / IMAGES.md (growing unchecked, ⚠️), no consolidation (❌), no dreamer (❌).

**What OskarOS needs:** The Dreamer. See `claude-code-memory-architecture.md` for the complete implementation spec.

---

## TIER 3: STEAL WHEN READY — Advanced architecture for later

### 13. MCP Server Manager

**Source files:** `services/mcp/client.ts` (3,348 lines), `services/mcp/config.ts` (1,578 lines), `services/mcp/auth.ts` (2,465 lines), `services/mcp/types.ts` (258 lines), `services/mcp/normalization.ts`

**What it is:** ⚡ SOURCE UPDATE — `client.ts` is 3,348 lines. Full MCP client managing: multiple server connections, JSON-RPC over stdio/SSE/WebSocket/HTTP, tool discovery with pagination, tool call routing by server name prefix (`mcp__serverName__toolName`), connection health monitoring, graceful shutdown. `auth.ts` (2,465 lines) handles OAuth flows for authenticated MCP servers. `config.ts` (1,578 lines) handles MCP configuration merging from multiple sources.

---

### 14. Plugin Architecture

**What it is:** Same as v1 — manifest-based, subprocess execution, tool/hook registration.

---

### 15. Slash Commands

**What it is:** Same as v1 — fuzzy matching, categories, aliases.

---

### 16. Sandbox & Isolation

**What it is:** Same as v1 — container detection, filesystem isolation modes.

---

### 17. OAuth & Authentication

**Source files:** `services/oauth/client.ts` (577 lines), `services/oauth/crypto.ts`, `services/oauth/types.ts`, `services/oauth/index.ts` (198 lines)

**What it is:** Same as v1 — OAuth 2.0 + PKCE. ⚡ SOURCE UPDATE: `crypto.ts` handles PKCE code verifier/challenge generation. Total ~800 lines, smaller than expected.

---

### 18. Git Operations

**Source files:** `utils/git.ts` (926 lines), `utils/gitDiff.ts` (532 lines), `utils/git/gitFilesystem.ts` (699 lines), `utils/git/gitignore.ts` (99 lines)

**What it is:** ⚡ SOURCE UPDATE — `git.ts` (926 lines) handles: canonical git root discovery (follows worktrees back to main repo), branch operations, status parsing, merge conflict detection. `gitFilesystem.ts` (699 lines) handles file operations through git (staging, diffing). `gitDiff.ts` (532 lines) handles diff generation and formatting. Total: ~2,250 lines of git integration.

---

### 19. Retry & Backoff

**Source files:** `services/api/withRetry.ts` (822 lines)

**What it is:** ⚡ SOURCE UPDATE — Way more than simple exponential backoff. `withRetry()` is itself an AsyncGenerator that yields `SystemAPIErrorMessage` during waits (so the UI shows "retrying..."):

```typescript
async function* withRetry<T>(
  getClient: () => Promise<Anthropic>,
  operation: (client: Anthropic, attempt: number, context: RetryContext) => Promise<T>,
  options: RetryOptions,
): AsyncGenerator<SystemAPIErrorMessage, T>
```

**⚡ SOURCE UPDATE — Key details from source:**
- `DEFAULT_MAX_RETRIES = 10` (not 2 as the Rust port suggested)
- `BASE_DELAY_MS = 500` (not 200ms)
- `MAX_529_RETRIES = 3` — specific cap for overload (529) errors
- 529 errors only retry for foreground query sources (user-facing). Background tasks (summaries, classifiers) bail immediately to reduce cascade amplification.
- `PERSISTENT_MAX_BACKOFF_MS = 5 * 60 * 1000` — unattended mode retries 429/529 indefinitely with 5-minute max backoff and 30-second heartbeat yields
- `FallbackTriggeredError` — after max retries, switches to fallback model (e.g., Sonnet → Haiku)
- Stale connection detection: ECONNRESET and EPIPE trigger immediate retry without backoff
- OAuth 401 errors trigger token refresh before retry
- AWS/GCP credential errors trigger credential cache clearing

**Implementation:** Steal the generator pattern — retry yields status messages to the UI instead of silently blocking. Add the foreground/background distinction (don't retry indefinitely for background tasks like memory extraction).

---

### 20. Subagent Forking

**Source files:** `tools/AgentTool/forkSubagent.ts` (210 lines), `tools/AgentTool/runAgent.ts` (973 lines), `tools/AgentTool/agentMemory.ts` (177 lines), `tools/AgentTool/agentMemorySnapshot.ts` (197 lines), `tools/AgentTool/builtInAgents.ts` (72 lines), `tools/AgentTool/prompt.ts` (287 lines)

**What it is:** ⚡ NEW IN v2 — The agent forking system. `forkSubagent.ts` creates a "perfect fork" of the current conversation state for parallel agent execution. The fork inherits: the parent's rendered system prompt (frozen, for cache sharing), file state cache, permission context, and query chain tracking.

`runAgent.ts` (973 lines) manages the full subagent lifecycle: spawns with restricted tool access, tracks file changes, handles abort propagation, and writes agent memory on completion.

`builtInAgents.ts` defines 6 built-in agent types: general-purpose, explore (fast codebase search), plan (architecture), verification, claude-code-guide, and statusline-setup.

**Why OskarOS needs it (later):** When you build the Dreamer agent, it runs as a forked subagent. The fork pattern means it shares the prompt cache (saves money) but has restricted tool access (safety).

---

## SOURCE STATISTICS

| Subsystem | Files Downloaded | Lines of TypeScript |
|---|---|---|
| Agentic loop (query + QueryEngine) | 3 | 3,213 |
| Tool system (Tool.ts + tools.ts + services/tools/) | 6 | 3,644 |
| Permissions | 10 | 5,448 |
| Hooks | 12 | 8,586 |
| Compaction | 8 | 3,666 |
| Memory/Dream | 20 | 4,000+ |
| API client + retry | 8 | 7,111 |
| Session persistence | 6 | 6,964 |
| File operation tools | 16 | 13,077 |
| MCP | 5 | 7,672 |
| OAuth | 4 | 811 |
| Git | 4 | 2,256 |
| **TOTAL** | **137** | **72,144** |

---

## PRIORITY ORDER FOR IMPLEMENTATION (Updated)

1. **Dreamer Agent** (#12) — the #1 problem. SESSION.md grows unchecked.
2. **Agentic Loop** (#1) — AsyncGenerator pattern, generator-based query loop
3. **Permission System** (#2) — rule engine with deny-before-model-sees-it
4. **Tool Registry** (#7) — tools as typed objects, not hardcoded arrays
5. **Pre/Post Hooks** (#3) — PostSampling hooks trigger memory extraction
6. **Context Compaction** (#4) — at minimum auto-compact with 9-section summary
7. **Session Persistence** (#5) — JSONL format, append-only, content replacement
8. **Retry & Backoff** (#19) — generator-based, yields UI updates during wait
9. **Usage Tracking** (#6) — cache tokens are a first-class concern
10. **System Prompt Builder** (#11) — multi-source assembly with memory rules
11. Everything else as architecture matures

---

*Analysis based on full TypeScript source code review: 137 files, 72,144 lines from `xorespesp/claude-code` repository (NPM sourcemap reconstruction of Claude Code v1.0.x). All file sizes, line counts, and code patterns verified against actual source.*
