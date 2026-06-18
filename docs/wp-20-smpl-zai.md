# WP-20 — SMPL-API + Z.AI MCP servers (full plan)

> The backlog entry in `feature-xx.md` carries the headline; this file holds the full spec lifted from the prior `feature-xx.md` §13 / WP-89 (lines 981-1196).

## Background — SMPL is the workaround for a Z.AI compat-layer bug

SMPL is not generic "Z.AI routing" — SMPL is the **specific workaround** for a Z.AI compatibility-layer bug. Both CLI mode and SMPL mode can be pointed at Z.AI (via `ANTHROPIC_BASE_URL` in user settings), but they hit the compat layer differently:

- **CLI mode** passes the explicit model string `claude-opus-4-7` to Z.AI. Z.AI's compat layer maps that incoming model name to **glm-4.7** — NOT their best model. The init event reports `claude-opus-4-7`; the assistant message's `model` field reports `glm-4.7`. `lib/bridge-process-manager.ts:346-349` exists specifically to capture the actual served model from the assistant event because the init event lies.
- **SMPL mode** passes the **tier alias `'opus'`** instead of an explicit model string (`MODE_DEFAULTS.smpl = 'opus'` in `lib/session-config.ts:48-52`). Claude Code resolves the alias locally via `ANTHROPIC_DEFAULT_OPUS_MODEL` from the user's `~/.claude/settings.json`. **Default mapping per Z.AI docs:** `ANTHROPIC_DEFAULT_OPUS_MODEL` → `glm-4.7` (same degraded model as CLI). To land on **glm-5.1** (the premium model), the user MUST explicitly set `ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.1` in settings.json.

SMPL exists to bypass Z.AI's compat-layer model-mapping bug by NOT giving the layer an explicit model name to mangle. The user's settings.json then chooses the actual GLM model.

### Z.AI's official tier table (`https://docs.z.ai/devpack/tool/claude`)

| Internal Variable | Default GLM | Premium |
|---|---|---|
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | GLM-4.5-Air | glm-4.5-air |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | GLM-4.7 | glm-5-turbo |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | GLM-4.7 | **glm-5.1** |

Premium pricing: 3× during peak (14:00-18:00 UTC+8), 2× off-peak.

**Anthropic-compatible endpoint:** `https://api.z.ai/api/anthropic`
**Auth env var:** `ANTHROPIC_AUTH_TOKEN` (NOT `ANTHROPIC_API_KEY`)
**Recommended timeout:** `API_TIMEOUT_MS=3000000` (50 min — Z.AI guidance)

### Substrate today

| Mode | Provider | Transport | Resolves to | Cost telemetry | Status |
|---|---|---|---|---|---|
| **CLI** | Anthropic (default) or Z.AI (if `ANTHROPIC_BASE_URL` set) | Claude binary subprocess | `claude-opus-4-7` literal — on Z.AI the compat bug maps this to glm-4.7 | ✓ from stream-json | ✓ working but degraded under Z.AI base-URL |
| **API** | Anthropic | Direct API loop (`lib/claude-api-loop.ts`) | `claude-opus-4-7` direct | ✓ from messages response | ✓ working |
| **SMPL-CLI** | Z.AI | Claude binary subprocess (alias `'opus'` → local resolution) | `glm-4.7` by default; **`glm-5.1`** when user has `ANTHROPIC_DEFAULT_OPUS_MODEL=glm-5.1` set | ✓ from stream-json (`total_cost_usd` in $) | ✓ working — canonical Z.AI path today |
| **SMPL-API** | Z.AI | Direct API loop | **glm-5.1** explicit (no compat layer in path) | needs Z.AI usage-shape parser | **MISSING** |

The reason to add SMPL-API: bypassing the subprocess altogether is cleaner than going through the compat-layer-with-a-workaround. With SMPL-API we pass `glm-5.1` directly as the model name, get the response shape Z.AI emits natively, and skip the Claude binary entirely.

## Part 1 — SMPL-API path (Z.AI direct, no subprocess, no compat-layer)

Today every Z.AI-bound build goes through the Claude binary subprocess + Z.AI's compat layer. SMPL specifically exists to dodge the compat-layer's model-mapping bug via the tier-alias trick. SMPL-API removes BOTH layers.

**Why this should work better than SMPL-CLI:**

- **No compat-layer at all.** With direct API we pass `glm-5.1` as the model name. No `claude-opus-4-7` → `glm-4.7` mapping bug to dodge; no tier-alias dance.
- **Lower per-call overhead.** No subprocess fork; no shell; no stream-json parser sitting between us and the wire.
- **Cleaner usage telemetry.** Z.AI returns `total_cost_usd` + `input_tokens` + `output_tokens` natively in the messages response.
- **Tool-call reliability under load.** API mode lets us retry individual turns without a full subprocess respawn.
- **Future-proof.** SMPL-CLI's tier-alias workaround depends on Claude Code's local resolution behavior. A Claude Code release that changes alias resolution semantics breaks SMPL-CLI silently. SMPL-API has no such coupling.

### Scope

1. **`lib/zai-api-loop.ts`** (NEW) — direct fetch loop against Z.AI's Anthropic-compatible messages endpoint. Same `runClaudeAgentLoop`-style signature so callers can swap providers without rewiring. Reads `ZAI_API_KEY` and `ZAI_BASE_URL` from env. Hardcoded model: `glm-5.1` (or whatever the current best is — surface as a config, not a magic string). The agent loop emits the same `BridgeEvent`-ish shape so downstream parsers work unchanged. The usage tracker MUST read `total_cost_usd` from Z.AI's response (already what it does for SMPL-CLI).

2. **Routing fork in `lib/run-webdev.ts:runWebDev()`** — today the router is binary (`mode !== 'api'` → CLI; else API). Make it explicit four-way:
   - `mode === 'cli' && model is claude-*` → existing CLI Anthropic path.
   - `mode === 'cli' && model is gemini-*` → existing Gemini CLI path.
   - `mode === 'api' && provider === 'anthropic'` → `runClaudeAgentLoop`.
   - `mode === 'api' && provider === 'zai'` → `runZaiAgentLoop` (NEW).
   - `mode === 'smpl' && transport === 'cli'` → existing bridge subprocess + Z.AI base URL.
   - `mode === 'smpl' && transport === 'api'` → `runZaiAgentLoop` (NEW).

   The `mode` enum stays `'smpl' | 'cli' | 'api'`; SMPL-API is selected by an additional `transport: 'cli' | 'api'` field on the SMPL branch (or by collapsing into a single `'smpl-api'` value — TBD at spike).

3. **`lib/bridge-process-manager.ts` for CD on SMPL-API.** Today the bridge spawns the Claude binary unconditionally. SMPL-API for CD means the bridge is replaced by a direct API agent loop — no subprocess at all. Two implementation paths:
   - **A.** Add a `transport` field to `BridgeOptions`. When `transport === 'api'`, the bridge "process" is actually an in-memory async generator wrapping `runZaiAgentLoop`. Keep the same `sendMessage()` / `BridgeEvent` interface.
   - **B.** Keep `bridge-process-manager.ts` for subprocess transports only; add `lib/api-cd-runner.ts` as the parallel implementation for SMPL-API. Two transport managers; chat-stream picks at the top of the request.

   A is cleaner; B is easier to ship.

4. **TopBar UX.** Today SMPL is one pill. Decision needed: does SMPL-API surface as a separate pill, or as a sub-toggle under SMPL? Recommendation: sub-toggle (CLI/API) when SMPL is selected — same as the CLI/API choice for Anthropic mode. Three pills horizontally (CLI · API · SMPL); when SMPL active, a secondary CLI/API pill appears beneath.

5. **Per-agent applicability.** SMPL-API affects all four agents differently:
   - **CD** — biggest win. CD's bridge subprocess is the heaviest spawn in the system. Direct API removes the subprocess + the resume/replay machinery that exists to mitigate subprocess fragility.
   - **WebDev** — `runWebDev` already has a clean API path. Adding `runZaiAgentLoop` is a sibling — one new file, ~150 LOC.
   - **Sentinel Ti** — same shape as WebDev. One new agent loop call.
   - **Jedi Code** — runs in the user's local Claude Code session; no spawned subprocess to replace. Out of scope for Part 1.

## Part 2 — Integrate Z.AI's three MCP servers into our spawned agents

Z.AI publishes three official MCP servers, all gated to **GLM Coding Plan users** with monthly quotas (Lite: 100, Pro: 1,000, Max: 4,000 web searches+readers; vision uses a separate 5-hour pool). Today our spawned agents only see `oskar-orchestrator`. Adding Z.AI's three servers gives them the missing capabilities — visual regression, web search, web reading.

### Server 1 — Vision MCP (LOCAL, npm)

Source: `https://docs.z.ai/devpack/mcp/vision-mcp-server`. NOT a hosted HTTP server — it's an NPM package (`@z_ai/mcp-server`) running locally over stdio. Powered by GLM-4.6V.

**Spawn config:**
```json
{
  "mcpServers": {
    "zai-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@z_ai/mcp-server"],
      "env": { "Z_AI_API_KEY": "...", "Z_AI_MODE": "ZAI" }
    }
  }
}
```

**Tools exposed:**

| Tool | Purpose | Best consumer |
|---|---|---|
| `ui_diff_check` | Visual regression — compare two UI screenshots, surface diffs | **Sentinel Ti** primary; WebDev secondary |
| `analyze_image` | General image understanding | All three |
| `ui_to_artifact` | Convert a UI screenshot to code/spec | WebDev; CD (image-to-vibe) |
| `extract_text_from_screenshot` | OCR extraction | CD; WebDev |
| `diagnose_error_screenshot` | Analyze error screenshots, suggest fixes | Sentinel Ti; WebDev (self-debug) |
| `understand_technical_diagram` | Read flowcharts/architecture/UML | Sage / docs work |
| `analyze_data_visualization` | Read charts/dashboards | CD |
| `analyze_video` | Local/remote video (≤8 MB; MP4/MOV/M4V) | Niche |

### Server 2 — Web Search MCP (HOSTED HTTP)

Source: `https://docs.z.ai/devpack/mcp/search-mcp-server`. Endpoint: `https://api.z.ai/api/mcp/web_search_prime/mcp` (Bearer auth).

**Spawn config:**
```json
{
  "mcpServers": {
    "web-search-prime": {
      "type": "http",
      "url": "https://api.z.ai/api/mcp/web_search_prime/mcp",
      "headers": { "Authorization": "Bearer ${Z_AI_API_KEY}" }
    }
  }
}
```

**Tool exposed:** `web_search_prime` — search results with titles, URLs, summaries, site names, favicons.

**Best consumer:** **CD primary** (research for unfamiliar verticals, locale-specific competitor scans, brand discovery). WebDev secondary (CSS/font research). Sentinel Ti rarely.

### Server 3 — Web Reader MCP (HOSTED HTTP)

Source: `https://docs.z.ai/devpack/mcp/reader-mcp-server`. Endpoint: `https://api.z.ai/api/mcp/web_reader/mcp` (Bearer auth).

**Tool exposed:** `webReader` — fetch a URL, return title + main content + metadata + link list.

**Best consumer:** All three. Replaces today's `WebFetch` built-in with a structured-output equivalent.

### Implementation

1. **Extend `lib/mcp-config.ts:ensureMcpConfig`** — today it writes a single-server `.mcp.json` with `oskar-orchestrator`. Make it conditionally write a multi-server config based on agent role + execution mode:
   ```ts
   ensureMcpConfig({ sessionId, cwd, agentRole, executionMode })
   ```
   When `executionMode === 'smpl'` (or `agentRole === 'jedi-code'` for the user's own session), append the three Z.AI server blocks.

2. **Per-agent allowlist additions** (`lib/mcp-config.ts:CD_ALLOWED_TOOLS / WEBDEV_ALLOWED_TOOLS / SENTINEL_ALLOWED_TOOLS`):

   | Agent | Add (vision) | Add (web) |
   |---|---|---|
   | **CD** | `mcp__zai-mcp-server__analyze_image`, `__extract_text_from_screenshot`, `__ui_to_artifact`, `__analyze_data_visualization` | `mcp__web-search-prime__web_search_prime`, `mcp__web-reader__webReader` |
   | **WebDev** | `__ui_diff_check`, `__ui_to_artifact`, `__extract_text_from_screenshot`, `__diagnose_error_screenshot`, `__analyze_image` | `mcp__web-reader__webReader` (font/CSS reference fetches) |
   | **Sentinel Ti** | `__ui_diff_check` (primary), `__diagnose_error_screenshot`, `__analyze_image`, `__understand_technical_diagram` | (none — Ti audits, doesn't browse) |
   | **Jedi Code** | already covered by user's settings.json | same |

3. **Doctrine.** Each agent's `.md` file gets a new "Z.AI MCP tools" section under "Your Tools". WebDev's section names `ui_diff_check` as the canonical visual-regression call. Sentinel Ti's prompt gets explicit doctrine: "before writing a critique, run `ui_diff_check` on the rendered vibe vs the reference if one exists."

4. **Quota awareness.** The three servers share the GLM plan's monthly cap. Add a quota tracker (`lib/zai-quota-tracker.ts`) that counts `web_search_prime` + `webReader` calls per session and surfaces a snackbar warning at 80% of the user's plan limit. Vision is on a separate 5-hour pool — track that independently.

5. **Provider-mode gate.** Z.AI's MCP servers should register **whenever the user has GLM Coding Plan credentials** — not strictly only on SMPL mode. A user on CLI-mode-pointed-at-Anthropic should still benefit from `web_search_prime` and the vision tools if they pay for GLM. Decision rule: register Z.AI servers whenever `process.env.Z_AI_API_KEY` is set, regardless of execution mode.

6. **Caveat — `Z_AI_API_KEY` vs `ANTHROPIC_AUTH_TOKEN`.** The Anthropic-compatible endpoint uses `ANTHROPIC_AUTH_TOKEN`. The vision MCP server (npm) uses `Z_AI_API_KEY`. They may be the same string or different. Document the env-var requirements in `.env.example` clearly.

## Sequencing

| Sub-WP | Scope | LOC est. | Order |
|---|---|---|---|
| **20a** | `lib/zai-api-loop.ts` skeleton + WebDev SMPL-API smoke test | ~150 | 1st — validates the API path works |
| **20b** | TopBar UX for SMPL-CLI/SMPL-API toggle + session-config schema + router fork | ~80 | 2nd |
| **20c** | CD on SMPL-API — replace bridge subprocess with direct API loop (option A or B) | ~200 | 3rd — biggest payoff, highest risk |
| **20d** | Z.AI three-MCP-server integration: vision (npm/stdio), search (HTTP), reader (HTTP). `ensureMcpConfig` extension + allowlist additions + quota tracker + per-agent doctrine. Independent track | ~150 | 4th |
| **20e** | Sentinel Ti on SMPL-API + `ui_diff_check` integrated into Ti's audit pipeline | ~100 | 5th |

Total: ~630 LOC across five sub-WPs. Each is independently testable.

## Acceptance

- **20a:** `runWebDev({mode: 'smpl', transport: 'api', model: 'glm-5.1', ...})` builds a vibe successfully against `https://api.z.ai/api/anthropic`. Stream of tool calls matches CLI mode. `report_build_complete` lands. Build manifest verified on disk. `total_cost_usd` flows through `lib/usage-tracker.ts` correctly under the direct-API shape.
- **20b:** TopBar offers SMPL-CLI vs. SMPL-API; toggle persists to session-config; both paths exercise their respective code paths verifiably.
- **20c:** Selecting SMPL-API + sending a chat message to CD spawns NO subprocess; the chat-stream still emits the same SSE events; tool calls (snackbar, build_vibe, etc.) work end-to-end.
- **20d:** All three Z.AI MCP servers register at agent spawn. CD fires `web_search_prime` successfully; WebDev fires `ui_diff_check` successfully; Sentinel Ti fires `ui_diff_check` during an audit. Quota tracker surfaces a snackbar at 80% plan cap.
- **20e:** Sentinel Ti audit runs end-to-end on SMPL-API; critique persists to disk.
- **Smoke test (orthogonal):** same vibe built under CLI (Anthropic), API (Anthropic), SMPL-CLI (Z.AI via tier-alias), SMPL-API (Z.AI direct). All four produce comparable HTML; tool fidelity matches; cost reflects provider pricing.

## Risk

- **Z.AI's tool-use shape under direct API vs. behind the compat layer.** Direct API may surface raw differences (different field names, different tool-result shape, missing `cache_creation_input_tokens` etc.) that our parser doesn't handle. 20a's first job is to confirm shape parity with Anthropic's messages API or document the diffs and patch `lib/mcp-tool-collector.ts` accordingly.
- **Cost-shape parity.** Direct API needs us to read it from Z.AI's messages response — likely under `usage.total_cost_usd` or similar. Confirm field name + units at spike.
- **Z.AI's prompt-cache behavior.** Z.AI may not implement Anthropic's prompt-cache TTL the same way. Capture cache-hit rate during 20a smoke test.
- **MCP-tool registration race under multiple servers.** When both `oskar-orchestrator` and Z.AI's MCP server are registered, name collisions need explicit namespacing. The `mcp__<server>__<tool>` prefix protects us, but the agent's prompt must reference the right one.
- **Mixed-provider sessions.** CD on SMPL-API + WebDev on CLI. Cross-agent comms via `notify_agent` should still work — verify the message format doesn't drift between providers.
- **Bridge subprocess removal regressions (20c).** The bridge has machinery for `--resume`, Order 66, mid-session model swaps. Replacing it with a direct API loop loses subprocess-side state. Document what API mode trades for subprocess mode.
