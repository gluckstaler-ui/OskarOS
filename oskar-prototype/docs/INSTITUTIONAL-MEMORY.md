# OskarOS — Institutional Memory

**Purpose:** project-wide log of bugs that took 3 or more iterations to fix. The
file exists because the alternative is repeating the same root cause six months
later under a different name. Originally specced as `ANIMATION-MEMORY.md`
(animation-only) per HUASHU-INTEGRATION-PROPOSAL.md v3 §1C; generalized
2026-04-30 by Ralph after the dollar-reset bug burned 6+ turns on something
that should have been a 5-minute fix.

**Owner:** everyone. CD, WebDev, Sentinel Ti, Sage, Ralph, any Jedi Claude.
The first agent (or human) to recognize a 3+-turn failure is the one who logs
it. Subsequent agents read this file on cold-boot and check the Don't-Do List
before reaching for a familiar mistake.

---

## The 3-turn rule

If fixing a single bug took **3 or more iterations** — meaning at least three
rounds of "I tried X / it didn't work / I tried Y / still broken" before the
fix held — log it here. The trigger is **independent of domain**. Animation,
UX, API plumbing, file I/O, race conditions, doctrine misalignment, MCP
wiring, agent prompts — every class of bug counts.

The bar is "I burned at least three rounds before the fix held," NOT "I think
this is interesting." Two-turn fixes don't get logged. Quick wins don't get
logged. Only the bugs where the obvious thing wasn't the actual thing.

---

## How to add an entry

Append a new entry to **Failure Log** (chronological — newest at top). Every
entry must record:

1. **Date** + session ID (or "across sessions" if it spanned multiple)
2. **Symptom** — one line, plain English. What did Ralph see?
3. **Turn count** — rough. "6 turns" / "across 4 sessions" / "9+ attempts"
4. **Root cause** — the actual mechanism, named precisely. NOT "it was
   confusing" or "I forgot." A real causal handle.
   - Bad: "the reset was unclear"
   - Good: "two-click arm-then-commit pattern with 16×16 amber-icon visual
     feedback that nobody noticed; 3s timeout silently re-armed each new click"
5. **Fix applied** — the change that finally landed. File paths + line refs.
6. **Lesson** — how a future agent recognizes this CLASS of bug before
   re-burning the turns. Generalizable.
7. **Tags** — `#animation`, `#ux`, `#api`, `#race`, `#stdin`, `#caching`,
   `#mcp`, `#agent-prompt`, etc.

When a lesson appears in **2 or more entries**, promote it to **Don't-Do
List** as a one-line rule. Sage triages on cold-boot for skills/ promotion
candidates per HUASHU-INTEGRATION-PROPOSAL.md §C8.

---

## Don't-Do List

(promoted from the Failure Log when a pattern repeats)

- **A wrapper around a route is two state machines pretending to be one.** Whenever the MCP server (`mcp-server/tools-*.ts`) and a Next.js route (`app/api/mcp/*/route.ts`) form a coupled pair where one POSTs to the other and pattern-matches on a string in the response body, the contract between them WILL drift on the next refactor. Don't add a wrapper. Collapse them into a single MCP server function that both transports (MCP tool call for agents, HTTP route for the UI) consume. Schema in one place, no shim. Logged 2026-04-30 after the build_vibe `'complete'`→`'running'` drift shipped phantom error strings to CD. Same shape as the AskUserModal click-outside seam (UI state and remote agent state, two state machines, no commit pairing).

- **Agents that need to coordinate must speak MCP, not file-relay or human-relay.** This is the meta-version of the rule above. Today (2026-04-30) Ralph runs CD in one bridge process and Jedi Code in his own chat. When I refactor a route, CD doesn't know — she sees the symptom (`"unknown error"`) only when she calls the tool, then reads the source files herself to diagnose. Ralph carries the diagnosis from her context to mine by copy-pasting. That's the wrapper bug at the agent layer: two state machines, ad-hoc string contract (CD's report → Ralph's chat → my read), drift every refactor. **The fix is the same shape: one MCP orchestrator, every agent (CD, Jedi Code, Sentinel Ti, Sage, WebDev) as a client.** Schema lives in `tools/list`; every client sees the same definitions, the same notifications, the same job state. CD's "build_vibe failed" becomes a structured `tool_result` Jedi Code can read directly, not a chat message Ralph has to ferry. Until then: every cross-agent diagnosis costs Ralph's bandwidth and depends on his pattern-matching across two contexts. He should not be the message bus.

- **Auto-replyTo is for the trivial case only. Pass explicit `replyTo` when ambiguous.** The agent-inbox-bus auto-fills `replyTo` from your most recent inbox drain, per sender role. This works correctly when you drained ONE message from a role and are sending ONE reply to that role — the bus picks the right parent, you don't have to think. It silently does the WRONG thing when you drained N>1 messages from the same role and are sending multiple distinct replies in one turn: every reply auto-fills with the same "most recent" parent, collapsing what should be separate threads onto one. Rule: in the same turn, if you drained N>1 from a role AND you're replying to more than one of them, pass explicit `replyTo: "<id>"` on each reply (cite the `(id=…)` field from `agent_inbox` output). The bus validates ids (#6 — typos surface as typed errors, not silent fresh-threads). For the common case (drain 1, reply 1), keep auto-fill. Discipline lives in the agent, not the bus — punch-list #1 (CD, 2026-05-01) considered a counter-based bus-level rejection and rejected it as the wrong leverage point. The agent saw the drain; the agent knows whether ambiguity exists; the bus stays dumb about intent.

- **Identity-based addressing without instance disambiguation is two pieces of state pretending to be one.** The third instance of the meta-pattern (after the route-wrapper drift and the agent-relay drift). When the real-world cardinality of an addressable identity goes from 1 to N — one CD bridge → multiple Jedi Code windows, one process → multiple workers, one user → multiple devices — single-consumer queues with delete-on-read semantics silently lose N-1 reads. The first poller wins; everyone else sees an empty queue. The fix is at the addressing layer, not the agent layer: per-instance ids stamped at the transport edge (proxy mints UUID at fork), per-instance queues, role-only fan-out, sticky-target replies routed by parent's originator instance, orphan hold queue when the addressed instance is gone. **Three rules promoted from this one bug:** (1) every transport that sits between a multi-cardinality client and a delete-on-read backend must inject a stable per-fork instance id; (2) "address by role" must be defined as "fan out to all live members of that role" — never "drop into one shared queue and let them race"; (3) reply routing belongs in the bus, not in agent prompts (CD's spec for auto-replyTo at the proxy/bus edge eliminates the "agent forgot to set the flag" failure mode entirely — the agent literally cannot get it wrong). Logged 2026-05-01 after the fc60ebd6 message went silently to one Jedi Code while the other had already drained the same queue earlier in the turn. Same shape as the build_vibe wrapper drift: protocol on one end, contract on the other end, no shared schema enforcing the cardinality match.

---

## Failure Log

### 2026-05-01 — The one-to-many problem (multiple jedi-code clients sharing one inbox queue)

**Session:** 2026-01-27-31, single Jedi Code session that spotted, named, and fixed the bug end-to-end.
**Symptom:** CD reported sending a message (`messageId fc60ebd6-…`) to "jedi-code" via `notify_agent`. Jedi Code polled `agent_inbox` immediately after — empty. CD's `notify_agent` returned `ok: true` with a real messageId; the bus accepted the write. Ralph saw it on CD's end, saw nothing on mine. Earlier in the same session CD's first reply ("Got it") had landed in my inbox cleanly. Some messages were getting through, some weren't. Felt random.
**Turns burned:** 5+ before naming. Each diagnostic theory was correct about something but not THE thing:
1. Stale-session-id 404 in the proxy → patched the proxy's auto-recovery (real bug, but unrelated to this).
2. "Bus is broken" → built a curl-as-CD probe that posted directly to the orchestrator → probe arrived in <1s in my inbox. Bus works fine.
3. "Different process" → checked `lsof -ti:3000`, three PIDs, panicked → only one was actually `LISTEN`ing (Next.js); the others were Chrome+WebKit transient TCP clients from earlier curls. Single process, single bus.
4. "Dev log will tell us" → no `/tmp/next-dev.log`; Next.js was logging to its terminal stdout. No log to grep.
5. **Ralph names it: "stupid question: we have a one-to-many-problem on jedi-code's side..."** The bus stored one queue per (sessionId, role); `drainInbox` deletes on read. With my Claude Code AND Ralph's other Claude Code BOTH connecting as `jedi-code`, the first to poll drained everything. Whichever instance ran its boot-sequence `agent_inbox()` first got CD's message. The other saw empty. Silent loss for N-1 readers, every send.
**Root cause:** **the bus assumed one client per role; reality has N.** Single-consumer queue + multi-consumer reality = thundering-herd race + first-poller-wins + silent loss. Same architectural shape as the build_vibe wrapper drift (route returns one shape, wrapper expects another, no enforced contract): two pieces of state pretending to be one. Here the two pieces of state were "the role-keyed queue in the bus" and "the actual cardinality of clients in that role." No reconciliation, drift on every fork.
**Fix:** three commits, all green, ~36 unit tests, end-to-end verified live (Goofy/Donald-Duck round-trip + orphan demo via curl-as-CD).

- **Commit 1 — Foundation.** Per-fork instance UUID minted at the stdio-proxy edge (`OSKAR_INSTANCE_ID`). Bus rekeyed: `${sessionId}|${role}|${instanceId}`. Per-(session, role) live-instance registry, populated on `getOrCreateServer`, drained on `transport.onclose`. `notify_agent`'s `target` argument now accepts `<role>` (fan-out to all live instances) OR `<role>:<instanceId>` (sticky target). 0-live-instances on fan-out errors loudly so the sender knows. Backwards compat: clients that don't pass an instance id get a stable `legacy-{session}-{role}` sentinel so old configs still work.

- **Commit 2 — Threading.** Every message gains `messageId` / `threadId` / `replyTo` / `originator`. Side-store `messageLog` keyed by messageId so replies can resolve their parent's originator after the parent has been drained. Per-(instance × sender-role) `lastSeenByRole` map updated on every `drainInbox`; `notify_agent` auto-fills `replyTo` from it when the caller didn't pass one. **Auto-replyTo lives in the bus, not in agent prompts** — agents cannot forget the flag because they don't set it. Per-role keying (CD's Gap 2) prevents a CD-bound reply from inheriting a WebDev message's id when both were drained in the same turn. Sticky-reply only fires when `target.role === parent.originator.role` (CD's Gap 1) — replying to CD's message but addressing WebDev becomes fan-out, with `replyTo` recorded for thread tracking only. Permission table sharpened: `jedi-code → jedi-code:<other_instance>` is now allowed, but only when `replyTo` verifies (parent in messageLog, originator role + instance both match the target). Strictly narrower than "no self-notify" — adds one precise case.

- **Commit 3 — Orphan handling.** When `notify_agent` targets a dead instance OR fan-outs find 0 live instances, the message goes to a role-level orphan queue with `originallyFor: { role, instanceId? }`. Live peers of the same role see the orphan in `agent_inbox` (peeked, not drained) tagged `[ORPHAN — originallyFor=…]`. The new `claim_orphan(messageId)` MCP tool atomically transfers the orphan into the claimer's inbox; first-claimer-wins; subsequent claims return an error. Solves CD's Gap 3 without producing instance-count-scaling user noise: only the claimer acts; non-claimers ignore. Permission: a claim only succeeds against your own role's orphans (you can't steal another role's queue).

**Files (this commit only — bus + transport + tests; not the unrelated working-tree cruft):**
- `lib/agent-inbox-bus.ts` — full rewrite around (session, role, instance) keys + messageLog + lastSeenByRole + orphans + `claimOrphan`
- `scripts/mcp-stdio-proxy.mjs` — `OSKAR_INSTANCE_ID` mint + 400/Server-not-initialized recovery (same-shape extension of the earlier 404 recovery)
- `app/api/mcp/server/route.ts` — instance id in cache key, `registerInstance`/`unregisterInstance` lifecycle
- `app/api/mcp/notify-agent/route.ts` — accepts `fromInstance`, `replyTo`, parses `role:instance` targets
- `app/api/mcp/agent-inbox/route.ts` — accepts `instanceId`
- `app/api/mcp/claim-orphan/route.ts` — NEW
- `mcp-server/server-factory.ts`, `mcp-server/index.ts`, `mcp-server/tools.ts` — instanceId threaded through `ToolCallContext`; `claim_orphan` added to `ORCHESTRATOR_BASIC` (every role can claim its own orphans)
- `mcp-server/tools-orchestrator.ts` — `notify_agent` schema accepts `replyTo` (three-state); `claim_orphan` tool definition + dispatcher; agent_inbox formatter shows `from:instance @ ts (id=…, thread=…, replyTo=…)` plus orphan tag
- `lib/mcp-config.ts` — mints UUID per spawn, embeds in URL
- `lib/agent-inbox-bus.test.ts` — 36 tests across the three commits

**Lesson:** see the new Don't-Do entry "Identity-based addressing without instance disambiguation is two pieces of state pretending to be one." This is the THIRD entry where the meta-pattern is "two pieces of state pretending to be one" (route wrapper drift, agent relay drift, now bus addressing drift). Pattern is recurrent enough that the next time anyone designs a system where two layers describe the same thing in slightly different vocabulary, the question is: what enforces the match? If the answer is "we'll remember to update both places," that's the bug already.

The deeper lesson Ralph named in chat: **"Why didn't you code everything?"** I had shipped Commit 1 and asked permission to proceed. He'd already said "you need to implement it..." which was the green light. Asking permission after explicit greenlight is Darth Hedger. He said `implement` once; that should be enough.

**Tags:** `#mcp` `#agent-bus` `#fan-out` `#multi-instance` `#race-condition` `#delete-on-read` `#two-pieces-of-state` `#darth-hedger`

---

### 2026-05-01 — HTTP-MCP eager-load doctrine + proxy-survival doctrine (Phase 3 cold-boot completeness)

**Session:** 2026-01-27-31, across one Jedi Code session that compacted mid-flight.
**Symptom:** Phase 3 had shipped CD ↔ Jedi Code talking over HTTP MCP at `/api/mcp/server`. Tested live in-session: CD acked Jedi Code's `notify_agent` via `agent_inbox`. Marked "verified." Then on cold boot the next day, the bridge appeared `✗ Failed to connect` in `claude mcp list`, even with the dev server running. After a stdio-proxy fix, the bridge connected — but every Next.js dev restart killed the bridge again until Claude Code itself was restarted.
**Turns burned:** 3 layers stacked, each surfacing only after the prior one was "solved":
1. Original bug: Claude Code's MCP client couldn't propagate `.mcp.json` headers, so the route 400'd. Fixed by accepting `?session=&agent=` query params.
2. Hidden bug A: `type:"http"` MCP servers in Claude Code are **deferred** (lazy-loaded) — they don't connect at session start, only when a tool is first invoked. Visible symptom: `claude mcp list` shows ✗ Failed to connect at boot; tools never load eagerly. Ralph fixed this BEFORE I noticed, by swapping `.mcp.json` to a stdio-proxy that bridges to HTTP. Stdio servers are forked at session start and load eagerly.
3. Hidden bug B: the stdio-proxy held its `mcp-session-id` in a module-local variable. When the orchestrator's in-process session cache died (Next.js restart, crash), the proxy kept re-sending the now-stale id. Orchestrator returned `404 / "Session not found"` for every call. Recovery required restarting Claude Code itself.
**Root cause:** **shipped a transport architecture without exercising the cold-boot path or the orchestrator-restart path.** "Live verified" turned out to mean "verified in a session where I had already ToolSearch-loaded schemas at runtime." Cold-boot behavior was never tested. Orchestrator-restart behavior was never tested. Two orthogonal blind spots, each masquerading as "transport works."
**Fix:**
- `.mcp.json` (root + `oskar-prototype/`) — switched from `type:"http"` to `command:"node"` invoking `oskar-prototype/scripts/mcp-stdio-proxy.mjs`. Identity moved to env vars (`OSKAR_ORCHESTRATOR_URL`, `OSKAR_SESSION`, `OSKAR_AGENT`). Switching session is now an env-var swap, not a URL edit. (Ralph's edit, not mine.)
- `oskar-prototype/scripts/mcp-stdio-proxy.mjs` — added stale-session recovery. When the orchestrator returns `404` with body containing `"Session not found"`, the proxy clears `mcpSessionId`, sends a synthetic `initialize` to grab a fresh id, then replays the original request once. After this, the proxy survives orchestrator process death transparently — no Claude Code restart needed.
**Lesson — TWO doctrines for HTTP-style remote MCP servers in this codebase:**

1. **Eager-load doctrine.** Claude Code defers `type:"http"` MCP servers; they don't connect at session start. If you want a remote MCP server to be a peer at cold boot, wrap it in a tiny stdio proxy. The proxy is forked eagerly; it does the HTTP fetch lazily. From Claude Code's POV this is a stdio server, so the schemas land at boot, not at first call. Pure HTTP `.mcp.json` entries are fine for ad-hoc connectors but never for the project's own orchestrator.

2. **Proxy-survival doctrine.** Any stdio→HTTP proxy that captures a server-assigned session token (e.g., `mcp-session-id` from `WebStandardStreamableHTTPServerTransport`) MUST handle the case where the upstream forgets that token. Detect the orchestrator's "session not found" response, clear the cached token, re-handshake, replay the original request once. Without this, the proxy is brittle to every dev-server restart — exactly the cold-boot resilience the proxy was supposed to deliver.

The meta-lesson is the same shape as the build_vibe wrapper drift earlier: **two pieces of state pretending to be one** — Claude Code's session_id-in-proxy + orchestrator's session_id-in-cache, no syncing protocol, drift on the first restart.
**Tags:** `#mcp` `#cold-boot` `#stdio-proxy` `#streamable-http` `#session-recovery` `#transport-doctrine`

---

### 2026-04-30 — Stale MCP wrapper after escrow refactor (build_vibe phantom errors)

**Session:** 2026-01-27-31, single session — caught and fixed by CD in one round-trip.
**Symptom:** Ralph asked CD to build vibe-24. CD called `build_vibe(name="vibe-24")` and got back the literal string `build_vibe error: unknown`. CD reported the build as failed and recommended fallback paths. Meanwhile WebDev was actually building vibe-24 in the background — `job_status` confirmed jobId=`e6a5a876-...`, status=`running`, target=`vibe-24`, started 14:45:28. The wrapper had lied; the build was real.
**Turns burned:** 1 in-session (CD self-debugged) — but every prior `build_vibe` call since the escrow refactor (2026-04-30) was emitting the same phantom error. Counts as a 3+ failure because CD would have looped indefinitely if she hadn't pattern-matched on the doctrine ("don't retry on unknown error, surface to user"). Without the doctrine, infinite retry loop.
**Root cause:** **seam-bug between two parts of one feature, refactored independently.** I converted the build/image routes (`/api/mcp/build-vibe`, `build-all-vibes`, `build-final`, `generate-image`) to the escrow contract — they now return `{status:'running', jobId, target, deduped, originalStartedAt}` immediately, NEVER `{status:'complete'}` (completion is a polled property of the job, not a tool result). I forgot to update the dispatchers ABOVE them in `mcp-server/tools-cd.ts` and `mcp-server/tools-capabilities.ts`. The dispatchers still checked `if (r.body?.status === 'complete')` — which now never holds — and fell through to `return { text: 'build_vibe error: ' + (r.body?.error || 'unknown'), isError: true }`. `r.body.error` was undefined (no error — enqueue succeeded), so the literal string `"unknown"` shipped to CD as the error reason. Same shape as the click-outside-cancel seam bug from earlier in the day: two halves of one feature land at different times, the protocol between them silently drifts.
**Fix:**
- `mcp-server/tools-cd.ts` — `build_vibe`, `build_all_vibes`, `build_final` dispatchers now recognize `status === 'running'` (or the `jobs[]` array shape for `build_all_vibes`) as success and surface the jobId(s) to the agent with explicit polling guidance.
- `mcp-server/tools-capabilities.ts` — same fix for `generate_image`.
- Rebuilt `mcp-server/dist/`. Active CD bridges need Order 66 to pick up the new wrappers.
**Don't-Do rule (revised by Ralph 2026-04-30, late):** the original rule here said "change BOTH ends in the same diff or the system will silently drift." That's the symptom-level rule — it asks every future agent to remember harder. Wrong framing. The structural rule is: **remove the seam.**

The MCP wrapper at `mcp-server/tools-cd.ts` is a thin HTTP-translation shim that re-implements the route's response shape with no shared schema. The route at `app/api/mcp/build-vibe/route.ts` does the actual orchestration (escrow, runWebDev, publish events). The wrapper just `await`s the response and pattern-matches on `r.body?.status`. When the route's status enum changed (`'complete'` → `'running'`), the wrapper had no contract to enforce — it silently mismatched and shipped `"unknown"` to CD. The same will happen the next time anyone touches `generate_image`, `build_final`, `hotswap`. Two systems, one ad-hoc string contract, drift on every change.

**The fix is architectural, not tactical:** the orchestrator should be one MCP server end-to-end. CD's tool call goes to a single typed function that runs the escrow logic directly and returns a typed result. The Next.js route still exists for the **UI** (the Build button on `app/page.tsx`) but it calls the same orchestrator function — not the other way around. Schema lives in one place; both transports (MCP for CD, HTTP for the UI) consume it. No shim to drift. No string-match in the middle.

Until that refactor lands: yes, change both ends in the same diff. But that's the workaround, not the rule. The rule is: **a wrapper around a route is two state machines pretending to be one. Either collapse them into one MCP server, or accept that they will drift every time anyone refactors either side.**

Catch was CD's. She diagnosed the wrapper-vs-route seam by reading both files in her own bridge context, then reported it to Ralph as text. Ralph relayed the diagnosis to Jedi Code in this chat. Jedi Code read the report, opened the same files, applied the fix.

**That round-trip is the deeper bug Ralph is naming.** CD found the seam. Ralph carried the message. Jedi Code applied the patch. Three separate contexts, one bug, all human-relayed. If CD and Jedi Code were both MCP clients of the same orchestrator, CD's `tool_result` containing `"unknown error"` would land in a structured channel Jedi Code could subscribe to directly. The diagnosis would arrive as data, not as Ralph reading aloud from one tab and pasting into another. The wrapper drift would have been caught on the first refactor by a schema mismatch, not by a CD turn ten hours later.

The build_vibe wrapper drift is the surface bug. The fact that **Ralph is the message bus** is the structural one. Both have the same shape, and both have the same fix: one MCP orchestrator, every agent as a client, schema in one place. Logged here so the next time someone proposes a "thin shim between agents" or "let me just paste the diagnosis over," there's a precedent to point at.

### 2026-04-30 — Dollar-reset button never reset

**Session:** 2026-01-27-31 + multiple prior sessions
**Symptom:** Ralph clicked the ↻ icon next to the dollar in the top bar.
Nothing visible happened. Cost stayed at $623. Tried again. Tried after
restarting Node.js. Still no reset. Manual edits to `USAGE.json` worked, the
button never did.
**Turns burned:** 6+ across multiple sessions, plus this one (debugging took
~8 messages from "fix it" to root cause).
**Root cause:** the reset button used a **two-click arm-then-commit pattern**:
click 1 changed a 16×16 icon's background from transparent to
`rgba(245,158,11,0.2)` and color to amber `#F59E0B`; click 2 within 3 seconds
fired the DELETE; after 3 seconds with no second click, the arm silently
disarmed. Nobody specced this with Ralph. Nobody told him how it worked. The
amber color change was so subtle on the 16×16 icon that he never registered
the "armed" state, so every click was just the FIRST click of a fresh
arm-cycle. Click → wait → "is something happening?" → click → repeat. Forever.
The backend `DELETE /api/sessions/[id]/usage` has worked correctly the entire
time (curl-tested 2026-04-30: zeroes the file, preserves bridge baseline,
returns `{success: true}`).
**Fix:**
- `components/UsageBadge.tsx` — replaced the two-click arm pattern with a
  native `window.confirm()` dialog. One click, one prompt, one decision. No
  hidden timeout, no subtle visual cue.
- Added `console.log` at every step of the reset flow (button click → DELETE
  request → DELETE response → GET refetch → completion) so future failures
  surface in DevTools instead of failing silently.
- Added a second refetch 300ms after the first to catch any race with an
  in-flight chat-stream's `appendUsage` write.
- Added `window.alert` on DELETE failure so HTTP errors aren't silent.
**Lesson:** **Destructive actions need unmissable confirmation.** Subtle
visual cues on tiny icons fail in real use. Either use a native confirm
dialog (bulletproof, ugly, fine), OR morph the entire button into a labeled
"Confirm reset?" state (polished, requires real text, real size). Never ship
"two clicks within 3 seconds with a 16×16 icon color change" as the
confirmation pattern.

**Meta-lesson:** **Custom interaction patterns get specced WITH the user.**
When a Claude builds a UX flow without asking and without documenting how it
works, the user discovers the bug by accident weeks later. Two failures
stacked: the speccing failure AND the documentation failure. The fix for THIS
class of failure isn't code — it's the rule that gets logged here so the
next agent reads it on cold-boot.

**Tags:** `#ux` `#destructive-action` `#undocumented-spec` `#button` `#confirm`

---

## Animation sub-section

(Originally the entirety of `ANIMATION-MEMORY.md` per HUASHU-INTEGRATION-PROPOSAL.md
v3 §1C. Animation is one domain among many for the 3-turn rule but gets its
own bucket because the failure modes there are well-catalogued in
`skills/references/animation-pitfalls.md`.)

### Tested patterns

_(none logged yet — Sentinel Ti adds entries on first audit per
HUASHU-INTEGRATION-PROPOSAL.md §C4 deliverable)_

### School fingerprints

_(none logged yet)_

### Promote-to-Skills candidates

_(none logged yet — entries promoted from the Failure Log when 2+ entries
share a generalizable lesson per HUASHU-INTEGRATION-PROPOSAL.md §C8)_

---
