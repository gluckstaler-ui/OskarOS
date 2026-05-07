# OskarOS API Agent Implementation Plan

> **Architecture: Next.js as Translation Layer — No SDK Subprocess**
> Created: 2026-04-04
> Updated: 2026-04-05 — Rewritten. No SDK subprocess. Raw API + tool execution loop in Node.js.
> Status block added: 2026-05-01

---

## STATUS UPDATE — 2026-05-01

Plan body below is preserved for context. Current status keyed by the plan's phases. Productization
items beyond plan scope (caching, rate-limit, BYOK, Docker, multi-tenant DB) live in
`docs/FEATURE-X.md` § WP-P2.

### STATUS PHASE 1 — Wire Into the App - FULLY IMPLMENTED

**SHIPPED:** TopBar `CLI|API` + `OPUS|SONNET|GEMINI` pills (`components/TopBar.tsx`); `page.tsx` state (`billingMode`, `webDevModel`, `webDevModelRef`); `/api/chat` route (~970 LOC, parallel to `/api/chat-stream`); `runWebDev()` router; foundational scaffolding (`tool-executor.ts` 9 tools, `claude-api-loop.ts`, `gemini-loop.ts`); token usage tracking via `appendUsage` + `calculateCost`.

**CHANGED:** `executionMode` → `billingMode` (more honest — toggle controls billing, not exec path); `claude-opus-4-6` → `claude-opus-4-7`; single-route plan → PARALLEL routes
(`/api/chat-stream` for CLI, `/api/chat` for API).

**DO NOT IMPLEMENT:** revert `billingMode` → `executionMode`; unify the parallel routes back.

### STATUS PHASE 2 — Agent Communication - ONE OPEN ISSUE

**SHIPPED:** Communication mechanism, end-to-end. SendMessage CLI plumbing (`lib/cd-bridge-call.ts` + `bridgeManager.sendMessage()`); SSE infrastructure (`lib/session-events.ts`, 8 consumers); MCP server at `/api/mcp/server` (in-process Node route, reachable directly from `/api/chat`); 22 MCP tools defined and exposed to CLI mode (`build_vibe`, `build_all_vibes`, `hotswap`, `snackbar`, `generate_image`, `screenshot`, `ask_user`, `session_meta`, `list_assets`, `find_assets`, `lint_brand_compliance`, `apply_patch`, `image_ops`, `vibe_diff`, `submit_*` family, `job_status`, `cancel_job`); `report_build_complete` + `report_build_failed` tool intercepts in `run-webdev.ts` (post-2026-04-30, net new).

**CHANGED:** Plan's magic-string triggers (`## BUILD:`, `## VIBES READY`, `## HOTSWAP:` etc.) RETIRED 2026-04-29. Replaced by typed MCP tool calls.

**OPEN:** Expose the 22 MCP tools to API-mode `/api/chat`. Currently the route has 6 inline tools (`generate_vibe`, `ask_discovery_questions`, `confirm_understanding`, `read_file`, `write_file`, `list_files`); the MCP tools aren't in its TOOLS array yet. Work: import tool definitions from `mcp-server/tools-orchestrator.ts` (and siblings), add to TOOLS array, dispatch in-process when `tool_use` blocks come back. Same pattern as existing `maybeRunLumberjack` import. Code-level only, no Anthropic-API-feature decision — `mcp_servers` param + Managed Agents paths are for REMOTE MCP servers across the Anthropic boundary; ours is local.

**DO NOT IMPLEMENT:**
- SendMessage as a custom CD → WebDev tool — superseded by MCP `build_vibe` / `build_all_vibes`.
- send-user-notification as a custom tool — superseded by MCP `snackbar`.

### STATUS PHASE 3 — Background + Monitoring - FULLY IMPLEMENTED

**SHIPPED:** SSE infrastructure (`lib/session-events.ts`); `report_build_progress` tool (`tool-executor.ts:455-464`) — WebDev calls it mid-build, progress flows to UI. THIS IS the plan's
Monitor tool, just named differently and scoped to builds.

**DO NOT IMPLEMENT:**
- Custom Monitor tool with `{status, progress, detail}` schema — already shipped as `report_build_progress` in `tool-executor.ts`. Use the existing one.
- WebSearch tool wrapping Brave/Serper/DuckDuckGo — Anthropic API now has native `web_search`   server tool. Use that.

### STATUS PHASE 4 — Dreamer + Memory FULLY IMPLMENTED

**SHIPPED:** Sage portrait subsystem (paints user portrait into `agents/CD-MEMORY.md` + per-session `user.md`); Lumberjack memory integration in `/api/chat` (`maybeRunLumberjack` on session events); Sage 240/40 cut + 24h pre-prune snapshot retention.

**CHANGED:** Architecture diverged from plan — "cheap-Haiku hourly background agent" shipped as Sage subsystem instead. Same goal (durable cross-session memory), different design.

**DO NOT IMPLEMENT:** "Dreamer hourly Haiku consolidation agent" as described — Sage already covers it with different architecture. `agents/dreamer-agent.md` IS Sage now, not Dreamer. Read that file + ORDER theme in `FEATURE-X.md` § 1, not this plan's Phase 4.

### STATUS OPEN QUESTIONS (from plan body)

1. **`ANTHROPIC_API_KEY` location** — PARTIAL: `claude-api-loop.ts:75` uses env var ✓; `/api/chat:19` reads `.api-key` file ✗. INCONSISTENT — converge to env var.
2. **Gemini output tokens** — OPEN: 65536 untested at HTML 30-50KB scale. Empirical.
3. **WebSearch provider** — DO NOT IMPLEMENT: use Anthropic native `web_search` server tool.
4. **Cost benchmarks** (Gemini 3.1 Pro vs Sonnet 4.6 vs Opus 4.7) — OPEN: empirical, run builds and measure.
5. **Bridge script injection timing** — SHIPPED as after-loop (`claude-api-loop.ts:142`). Per-FileWrite alternative for live preview decision-pending (~20 LOC if added).

---

## ARCHITECTURE DECISION

### The Rule

Models call tools. Next.js executes them. No CLI subprocess, no SDK spawning local processes. This works on Namecheap, Vercel, anywhere Node.js runs.

### Two Switches

**Switch 1: Mode** (CLI vs API) — determines the execution path.
**Switch 2: Model** — determines which AI model runs within that mode.

| Mode | Models Available | Translation Layer |
|------|-----------------|-------------------|
| **CLI** | Opus, Sonnet | Claude Code subprocess (existing) |
| **API** | Opus, Sonnet, Gemini | Next.js (`lib/tool-executor.ts`) |

In API mode, ALL models go through the Next.js server route. The model determines which API to call (Anthropic or Google), but the tool execution layer is always Next.js.

| Mode + Model | API Called | Tools | Loop |
|-------------|-----------|-------|------|
| API + Opus | Anthropic API | All 9 API tools | `lib/claude-api-loop.ts` |
| API + Sonnet | Anthropic API | All 9 API tools | `lib/claude-api-loop.ts` |
| API + Gemini | Google API | FileRead, FileWrite, FileEdit only | `lib/gemini-loop.ts` |
| CLI + Opus | Claude Code subprocess | 40+ (everything in SDK) | `lib/webdev.ts` (existing) |
| CLI + Sonnet | Claude Code subprocess | 40+ (everything in SDK) | `lib/webdev.ts` (existing) |
| CLI + Gemini | ❌ Not available | — | — |

---

## WHAT'S BUILT

### `lib/tool-executor.ts` — The Hands

Shared tool execution layer. Both Claude API and Gemini API route tool calls here. Node.js does the work.

**9 tools implemented:**

| Tool | Node.js Implementation | What it does |
|------|----------------------|--------------|
| `FileRead` | `fs.readFile` + base64 for images | Read text, images, PDFs |
| `FileWrite` | `fs.writeFile` | Write files to disk |
| `FileEdit` | read → find/replace → write | Surgical string replacement |
| `Glob` | `find` command via `exec` | File pattern matching |
| `Grep` | `grep` command via `exec` | Content search |
| `Bash` | `child_process.exec` (sandboxed) | Shell commands |
| `WebFetch` | `fetch()` | Fetch URLs |
| `WebSearch` | Stub — needs search API | Web search |
| `append_log` | `fs.appendFile` | Timestamped BUILD.md entries |

**Security:** All file operations validate paths stay inside session folder. Dangerous bash patterns blocked.

**Exports:** `executeTool()`, `CLAUDE_TOOL_DEFINITIONS` (Anthropic format), `GEMINI_TOOL_DEFINITIONS` (Google format).

### `lib/claude-api-loop.ts` — Claude's Agentic Loop

Raw Anthropic API. No SDK. The loop:

1. Send messages + tools to `https://api.anthropic.com/v1/messages`
2. Parse response for `text` blocks and `tool_use` blocks
3. Execute tool calls via `executeTool()`
4. Send `tool_result` blocks back as next user message
5. Repeat until model stops calling tools or max turns reached
6. Post-process: inject bridge script into HTML files

**Config:** max 30 turns, 16384 max_tokens, uses `ANTHROPIC_API_KEY` from env.

**Callbacks:** `onToolCall`, `onToolResult`, `onText` — for streaming progress to UI.

### `lib/gemini-loop.ts` — Gemini's Agentic Loop

Same pattern, Gemini API shape. Uses `functionDeclarations` + `functionResponse`.

**Only 3 tools:** FileRead, FileWrite, FileEdit. Gemini reads the brief, reads images, writes HTML. That's it.

**Config:** max 20 turns, 65536 max_tokens, uses `GOOGLE_API_KEY` from env, model `gemini-3.1-pro-preview`.

### `lib/run-webdev.ts` — The Router

Single entry point. Takes a `Provider` and a `ParsedVibe`, routes to the right backend:

- `cli` → `buildVibeHTML()` (existing, unchanged)
- `claude-sonnet-4-6` / `claude-opus-4-6` → `runClaudeAgentLoop()`
- `gemini-3.1-pro-preview` → `runGeminiAgentLoop()`

Returns `VibeBuildResult` regardless of path. After the loop completes, verifies the HTML file exists on disk.

---

## WHAT'S STILL NEEDED

### Phase 1: Wire Into the App (Next Sprint)

**TopBar selector** — two pill groups LEFT of BRIEF/STUDIO/GALLERY:

1. **Mode switch:** `CLI` | `API`
2. **Model switch** (changes based on mode):
   - CLI selected: `OPUS` | `SONNET`
   - API selected: `OPUS` | `SONNET` | `GEMINI`

Active pill: #10b981 (emerald green), same as existing pills.
~60 lines in `components/TopBar.tsx`

**page.tsx state** — `executionMode: 'cli' | 'api'` + `webDevModel: Model` state, passed to TopBar and API calls. ~20 lines.

**chat-stream/route.ts** — pass selected model to `runWebDev()` instead of `buildVibeHTML()`. ~20 lines changed.

**webdev/route.ts** — accept `model` parameter, route to `runWebDev()`. ~20 lines changed.

### Phase 2: Agent Communication

**`## BUILD: [vibe-name]`** trigger in chat-stream already works. Currently calls `buildVibeHTML()` — needs to route through `runWebDev()` with selected model.

**SendMessage** — CD agent sends messages to WebDev. In CLI mode this is a built-in tool. In API mode, implement as a custom tool that writes to a message queue file or emits via `session-events.ts`.

**send-user-notification** — custom tool. Input: `{ title, body, type }`. Emits via existing `session-events.ts` → Snackbar picks it up. ~30 lines.

### Phase 3: Background + Monitoring

**Monitor tool** — `{ status, progress, detail }` → SSE → UI progress bar. ~40 lines.

**WebSearch** — currently a stub in tool-executor.ts. Connect to Brave Search or Serper API when ready. ~20 lines.

### Phase 4: Dreamer + Memory

Background agent that consolidates session learnings into CD-MEMORY.md. Runs after session ends. Uses cheap model (Haiku). Config only — same agentic loop, different prompt and tools.

---

## AGENT PROMPT UPDATES (DONE)

Both agent prompts document two execution contexts:

**CLI Mode:** "You have 40+ tools, the CLI handles everything."

**API Mode:** Limited tool list in a table. "If it's not in the table, you don't have it."

### Triggers (in CD agent prompt)

| Trigger | What Happens |
|---------|-------------|
| `## VIBES READY` | WebDev builds all vibes |
| `## BUILD READY` | WebDev builds final page + booking flow |
| `## BUILD: [vibe-name]` | WebDev builds/rebuilds ONE vibe |
| `## HOTSWAP: [vibe-name] [slot]` | System swaps image into vibe |
| `## IMAGES NEEDED` | Per-vibe image prompts appear in Assets panel |
| `## UPDATE ASSETS` | App re-reads IMAGES.md, updates Assets panel |

### Website Import Pipeline (in CD agent prompt)

When user gives a URL as source material:
1. CD WebFetches the site → extracts text content
2. Images: CD tells user to upload manually (WebFetch can't download binary)
3. If app has "Import from URL" feature, CD directs user there
4. Text content → CREATIVE-BRIEF.md under `## Source Material`

---

## FILE MAP

```
lib/
├── tool-executor.ts      # NEW — 9 tool implementations + definitions (both formats)
├── claude-api-loop.ts    # NEW — Claude API agentic loop (raw API, no SDK)
├── gemini-loop.ts        # NEW — Gemini API agentic loop
├── run-webdev.ts         # NEW — Router: cli / claude / gemini → VibeBuildResult
├── webdev.ts             # EXISTING — CLI mode (buildVibeHTML, BRIDGE_SCRIPT)
├── gemini.ts             # EXISTING — Gemini image generation (Nano Banana)
├── session-events.ts     # EXISTING — SSE event emitter
├── types.ts              # EXISTING — shared types
└── ...
```

---

## OPEN QUESTIONS

1. **ANTHROPIC_API_KEY** — needs to be added to `.env.local`. Currently only has `CLAUDE_CODE_OAUTH_TOKEN` (for CLI) and `GOOGLE_API_KEY` (for Gemini image gen).
2. **Gemini output tokens** — HTML files are 30-50KB. Does `gemini-3.1-pro-preview` have enough output capacity at 65536 tokens?
3. **WebSearch provider** — tool-executor.ts has a stub. Need to pick: Brave Search API, Serper, or DuckDuckGo HTML scrape.
4. **Cost benchmarks** — Gemini 3.1 Pro vs Sonnet 4.6 vs Opus 4.6 for HTML generation quality + cost per vibe.
5. **Bridge script injection timing** — currently runs after the agentic loop completes (scans all HTML files). Should it run after each FileWrite of an `.html` file instead? Matters for live preview during builds.
