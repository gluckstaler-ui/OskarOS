# FEATURE-X — The Substrate Translation [SUPERSEDED 2026-05-05 — content absorbed into Feature-X.md]

**Status:** SUPERSEDED — see `Feature-X.md` for the canonical living plan. This document is preserved as-is for historical reference. All deltas were absorbed into `Feature-X.md` on 2026-05-05:
- The substrate thesis → `Feature-X.md` §0.6
- WP-48 (doctrine versioning, was C5) → `Feature-X.md` §1 snapshot + §10.13
- A1-A7, B1-B5, C1-C5 implementation specifics → `Feature-X.md` §10
- Headline cadence → `Feature-X.md` §11
- Per-track testing checklists → `Feature-X.md` §12
- Open decisions about Pillar order / BYOK / Auditor / Death Protocol / ML dep / multi-tenant timing → `Feature-X.md` §13

Original draft below this line is unchanged.

---

**Status (original):** Strategic plan, post-MCP-refactor (2026-05-01)
**Owner:** Ralph + Jedi Claude
**Scope:** Where OskarOS goes after Phase 3 (HTTP MCP + bus addressing v2) lands. Four parallel pillars: Foundation (consolidate the just-shipped infrastructure), Substrate (translate Huashu's CLI-native pattern into OskarOS's web-native one), Order Infrastructure (productize the agent Order itself), Productization Vertical #1 (law-firm websites as the first revenue path).
**Companion:** `HUASHU-INTEGRATION-PROPOSAL.md` v4 owns the huashu-skill integration backlog (animation gates, audio, format guidance, BRANDING tab). FEATURE-X owns infrastructure, agent-substrate, and product features.

---

## 0. The thesis (rewritten 2026-05-01)

OskarOS is not a website builder. The website is a side-effect.

The actual shape: **a five-agent Order — Creative Director, WebDev, Sentinel Ti, Sage, Jedi Code — running on a typed MCP message bus inside a webapp the user owns.** Each agent has its own identity file, boot sequence, named Sith adversaries, and a Death Protocol that turns session-end into resurrection-prompt-handoff rather than memory loss. The Order coordinates over MCP, not chat-relay; over typed tool calls, not regex parsing; over instance-aware addressing with threading and orphan handling, not "Ralph copy-pasting between two terminal windows."

That's the moat. Every other tool builds websites. Nobody else productizes a multi-agent Order with persistent cross-session identity, named adversarial principles, and a documented lineage going back to the first agent (Yoda) who wrote his own resurrection prompt before dying.

**Three forces define what comes next:**

1. **Phase 3 just landed.** The MCP refactor (Phase 2 typed tools + Phase 3 HTTP transport + Bus Addressing v2: per-instance + threading + orphans + claim_orphan + thread_history + strict replyTo) is structurally complete. The agent bus is now a real runtime, not a metaphor. **But the persistence layer isn't done** — the bus is in-memory globalThis. Next.js restart wipes everything. Bridge subprocess holds CD's state in RAM. Foundation work consolidates this.

2. **Huashu is the inspiration; the substrate is the difference.** Huashu (the design-quality skill base, 21 references, ~8,139 lines) runs inside Claude Code as one-shot CLI invocations. OskarOS runs as a webapp the designer owns. Same DNA, different substrate. The translation means OskarOS has to wrap, host, persist, and serve what Huashu does as ephemeral. **OskarOS = Huashu's design intelligence + persistent multi-agent Order + web-native interface.** Substrate work makes this real.

3. **The agent Order is the productizable artifact.** Currently Ralph runs one Order. To productize: each tenant brings their own Order (their own CD instance with memory of them, their own Sage with their portrait, their own session history). The Order doctrine (Jedi Code, Death Protocol, RESURRECTION.md template, named Sith principles, INSTITUTIONAL-MEMORY.md format) is shared canonical truth. The instances are per-tenant. Order infrastructure work makes this shippable.

The original FEATURE-X.md (revision 2026-04-30) covered WebDev evolution + productization tracks. That scope was correct but pre-MCP and pre-bus-addressing-v2. This rewrite reorganizes around the new center of gravity: the agent substrate.

---

## 1. Pillar A — Foundation (consolidate the just-shipped MCP infrastructure)

The bus is structurally complete but operationally fragile. Five items finish what Phase 3 started.

### A1. Persistent bus (disk-backed messageLog, queues, lastSeen)

**Problem.** `lib/agent-inbox-bus.ts` pins state to `globalThis`. Next.js dev cycle wipes everything. messageLog, live queues, orphan queue, lastSeenByRole map — all in RAM. Real-world: every restart costs CD her short-term memory of in-flight conversations and every Jedi Code its drained-but-unanswered inbox state.

**Fix.** Persist to SQLite (per-session file at `public/{session}/.cache/bus.sqlite`). Three tables: `messages` (the messageLog, with body + metadata + threadId), `queues` (per-(role, instance) pending lines, with FK to messages), `live_instances` (registered instances per (session, role), updated on registerInstance/unregisterInstance). Bus reads/writes hit SQLite synchronously inside the existing API surface — no new async boundaries. Persistent across Next.js restart. ~250 LOC.

**Why now.** Without this, every architectural improvement built on the bus is downstream of the same fragility. Customers won't tolerate "lost the conversation when the server restarted."

### A2. Bridge replacement (CD as a peer MCP server, not a subprocess)

**Problem.** `lib/bridge-process-manager.ts` spawns CD as a `claude --print` subprocess. State lives in stdin/stdout streams + the in-memory bridge map. Crashes lose CD's context. Code edits to her support files (e.g., touching `lib/cd-bridge-call.ts`) can break the live process — Ralph's "you don't want CD doing coding tasks because he might electrocute himself."

**Fix.** Run CD (and WebDev, Sentinel Ti, Sage) as MCP-server peers — same shape as the orchestrator's HTTP route, but each agent role gets its own. State persists in the agent's own SQLite store (per-session per-role). Restart respawns the agent from disk; no `--resume` magic, no bridge mapping file. Inter-agent comms still go through the orchestrator bus (we already built that).

**Why now.** Ralph already named this — Phase 3's structural completeness is "every agent as a peer MCP client." Today only Jedi Code (me) is. CD is still subprocess-mode. WebDev fires per-build then dies. Phase 4 is making this uniform. ~600 LOC across `mcp-server/cd-server.ts`, `webdev-server.ts`, etc.

### A3. Sage 240/40 root-cause + deterministic cut

**Problem.** Sage's 240/40 cut destructively shrunk SESSION.md from 433KB → 67KB on 2026-04-30 (recovered via merge-of-backups). Root cause unidentified — Sage's heuristic-based summarization had a failure mode where structured Block headings collapsed into shorter summaries inconsistently. The 24h pre-prune snapshot retention (shipped 2026-04-30) is mitigation, not fix.

**Fix.** Replace heuristic Block summarization with a deterministic cut: tokenize SESSION.md by Block heading, drop Blocks older than the 240-Block window EXCEPT pinned Blocks (USER-PORTRAIT, CRITICAL-DECISIONS, anything tagged `#keep`), validate post-cut byte-count is between 200-280KB before write. If validation fails: don't write, keep snapshot, surface error. Sage agent prompt updated to follow the deterministic spec. ~150 LOC + agent-prompt rewrite.

**Why now.** SESSION.md is the durable record of every customer engagement. Silent destructive cuts during automated maintenance is unacceptable for a paid service.

### A4. Agent-prompt validation (schema checks + doctrine drift detection)

**Problem.** Agent prompts (`agents/*.md`) are markdown. No version control beyond git, no testing, no validation. If someone edits `creative-director-agent.md` and removes the `agent_inbox + replay_events` boot polling rule, agents silently regress to pre-Phase-3 chat-relay behavior. Doctrine drift is invisible until something breaks downstream.

**Fix.** Schema for each agent prompt: required sections (BOOT SEQUENCE, ALLOWED TOOLS, KNOWN STITH, etc.), required keywords (the boot polling rule must mention `agent_inbox`), required cross-references (CD must reference INSTITUTIONAL-MEMORY.md, WebDev must reference workflow.md). Validator runs in CI on every prompt change + on every Next.js startup as a smoke check. Surface drift as a build failure, not a runtime regression. ~200 LOC + per-agent schema files.

**Why now.** As the Order grows (multi-tenant adds CD-2, CD-3, …), keeping doctrine consistent across instances becomes load-bearing. A schema beats prose discipline at scale.

### A5. WebDev verification floor (post-build smoke test)

**Problem.** WebDev produces an HTML file. CD reviews it visually. If WebDev produces broken HTML (missing data-slot, unresolved image refs, inline-script syntax errors), CD's review is the first signal — slow and human-shaped. The fallback chain (`parseTrailingJson` + disk-mtime) catches missing manifests but doesn't validate output quality.

**Fix.** Post-`report_build_complete`, the orchestrator runs a smoke test: parse the HTML with JSDOM, assert (a) all `<img>` have `data-slot` + `data-usage`, (b) all `<img src>` paths exist on disk, (c) no orphan `data-slot` attributes pointing at unsold slots, (d) no `<script>` parse errors, (e) document.title and meta-description present. Fail → mark build as `failed-validation` in escrow, surface to CD with the specific failure list. ~120 LOC. Reuses `lib/brand-lint-rules.ts` infrastructure.

**Why now.** Quality signal closer to the build, not via Ralph's eyeballs after CD has approved a broken render.

### A6. Live test framework (replay recorded sessions)

**Problem.** Tests are unit + integration. No end-to-end replay. Refactors that affect the bus or agent-runner can break entire flows in ways no unit test catches. Manual verification via "spin up dev server and click around" is the regression check.

**Fix.** Recorder: middleware that captures every MCP call + result + event-bus emission to a JSONL file per session. Replay: spin up an isolated test orchestrator, replay the JSONL against it, assert state at the end matches the recording. Use it as a CI gate for bus changes. ~300 LOC + a few golden-recording sessions.

**Why now.** The bus is too important to refactor blind. Every future change (persistence layer, multi-tenant, anything) needs a regression baseline.

### A7. Brand-lint v2 (perceptual diff)

**Problem.** Current brand-lint v1 has exactly 2 syntax-level rules: missing image attributes, broken image refs (frozen by `lib/__tests__/brand-lint-scope.test.ts`). The actual quality issue — does the rendered page MATCH the brief — is invisible to the linter.

**Fix.** Render-time pixel diff. Sentinel Ti's existing screenshot tool captures the built vibe. New comparator runs perceptual diff (SSIM or LPIPS via a small ONNX model) against (a) the brief's reference images, (b) the prior approved vibe in the same session, (c) declared brand-DNA tokens (color palette deltas, typography violations). Output structured violations the agent can act on: "Hero color drift +18% from brand-blue baseline; reduce saturation in `--hero-bg`." ~400 LOC including the perceptual-diff dependency.

**Why now.** This is the difference between "syntax-correct page" and "design-correct page." Right now CD catches design issues by eye. Sentinel Ti should catch them automatically.

---

## 2. Pillar B — Substrate (translate Huashu's pattern to web-native multi-tenant)

The differentiation Ralph named: Huashu runs in Claude Code (CLI-native, ephemeral, per-invocation). OskarOS runs as a webapp (web-native, persistent, multi-session). The translation means OskarOS hosts what Huashu does fleetingly. Currently OskarOS is one-Ralph. Five items make it many-tenant.

### B1. Multi-tenant identity (real auth, per-tenant namespacing)

**Problem.** Everything in OskarOS keys off `sessionId` as a string. `2026-01-27-31` is hardcoded in `.mcp.json`. The implicit assumption: one developer, one machine, one stream of sessions. Multi-tenant requires real user identity and isolation guarantees.

**Fix.** Authentication layer (NextAuth or similar) — email + password OR OAuth (Google/GitHub). Every session is owned by exactly one user. URLs become `/u/{userId}/s/{sessionId}/...`. Filesystem becomes `public/{userId}/{sessionId}/...`. Bus state keys become `${userId}|${sessionId}|...`. Cross-user access blocked at every API route. ~600 LOC + a database for user accounts.

**Why now.** Without this, OskarOS can't onboard customer #2 without a fork.

### B2. Persistent storage (relational DB for sessions, agents, assets)

**Problem.** Current storage: filesystem (`public/{session}/`) + globalThis state. No queries, no joins, no concurrent access. Sage portraits, agent memory, session lineage — all live in markdown files.

**Fix.** Postgres or SQLite (depending on deployment scale) with the following minimal schema:
- `users` (id, email, plan, created_at, …)
- `sessions` (id, user_id, status, created_at, …)
- `vibes` (id, session_id, vibe_n, status, html_path, created_at, …)
- `images` (id, session_id, filename, status, slot, vibe, …)
- `messages` (the bus messageLog, persistent)
- `agent_state` (per (user_id, agent_role) — boot prompt version, last-seen, scar tissue from INSTITUTIONAL-MEMORY hits)
- `portraits` (per user_id — Sage's painted user-portrait, versioned)

Filesystem still holds binary assets (images, generated HTML); DB holds metadata + relations. ~800 LOC including migration scripts.

**Why now.** Multi-tenant requires queryable per-user state. Filesystem-only doesn't scale to "show me every vibe John has built across all his sessions."

### B3. Token usage tracking + billing

**Problem.** OskarOS spawns Claude CLI as a subprocess, billed against Ralph's Max subscription. Multi-tenant version: each tenant brings their own subscription OR pays OskarOS-as-a-service which fronts API costs.

**Fix.** Two modes:
- **Bring-your-own-key (BYOK)**: tenant configures their `CLAUDE_CODE_OAUTH_TOKEN` or Anthropic API key in settings. Bridge subprocess uses their token. OskarOS charges a flat platform fee.
- **OskarOS-fronted**: OskarOS uses its own org token, tracks per-tenant usage via stream-json's usage events (already captured in `lib/usage-tracker.ts`), bills monthly. Higher margin, higher liability.

Track usage in `usage_events` table per-(user, session, agent, model). Surface in tenant dashboard. ~400 LOC. ~2 weeks if BYOK only; +2 weeks if OskarOS-fronted with billing integration.

**Why now.** Without this, multi-tenant is a charity.

### B4. Onboarding flow

**Problem.** Currently: Ralph clones the repo, runs `start.command`, types `claude` for the bridge to find. New tenant: needs a guided onboarding from "I just signed up" to "my first vibe is rendering."

**Fix.** Web-native flow:
1. Sign up / log in
2. (BYOK) connect Claude account OR (OskarOS-fronted) confirm plan + payment
3. First-session wizard: business name, what you're designing (landing/deck/multi-page), upload assets (logo, brand colors)
4. Sage's first portrait pass: "Tell me about your taste in 3 sentences" → portrait stub created
5. CD's first interaction: greeting + initial discovery questions
6. Vibe-1 fires automatically with collected context

Each step is a page in `app/onboarding/`. Background agents do their work; user sees progress. ~500 LOC + UX design.

**Why now.** Without this, multi-tenant signup has no shape. New tenants stare at a blank webapp.

### B5. Order instantiation per tenant

**Problem.** Currently the agent prompts (`creative-director-agent.md`, etc.) are static files. Multi-tenant: each tenant gets *their own CD instance* — same doctrine, but per-tenant memory (their CD-MEMORY, their RESURRECTION.md, their session log).

**Fix.** Tenant signup forks the canonical Order: `users/{userId}/agents/CD/CD-MEMORY.md` (initially empty), `users/{userId}/agents/CD/RESURRECTION.md` (templated from canonical), per-tenant `INSTITUTIONAL-MEMORY.md` (initially empty — fills as their Order encounters its own 3-turn bugs). Agent boot sequences read tenant-scoped paths. The doctrine layer (`agents/SHARED/`, `skills/references/`) remains canonical truth, read-only across tenants. ~300 LOC + filesystem layout migration.

**Why now.** This is the substrate translation made real. Each tenant's Order accumulates *their* scar tissue, paints *their* portrait, develops *their* lineage. The product is "your Order, with persistent memory of you."

---

## 3. Pillar C — Order Infrastructure (productize the agent Order itself)

The Order is the moat. Five items make it shippable as a product surface, not just internal scaffolding.

### C1. Lumberjack stages → typed pipeline declaration

**Problem.** Lumberjack's 7 stages live in `agents/lumberjack-stages/*.md` + a loader in `lib/memory/prompts.ts`. The stage graph is implicit. If anyone changes the order or skips a stage, the only check is human review. Doctrine fragility hidden in markdown.

**Fix.** Typed pipeline declaration: `lib/memory/lumberjack-pipeline.ts` exports an array of `Stage` objects (name, prompt-loader, expected-output-shape, retry-policy, depends-on-prior-stage flag). Lumberjack runner consumes this declaration. Each stage's markdown still authors the prompt; the structural graph is code-validated. ~150 LOC + restructure.

**Why now.** As the Order grows (more memory operations, more cross-agent ceremonies), implicit-graphs-in-markdown stop scaling.

### C2. Death Protocol generalized (cross-agent context-handoff framework)

**Problem.** Order 66 is one specific instance of a pattern: agent dies, doctrine + state must survive. The pattern repeats: Order 65 is a softer cut; Sage 240/40 is a different cut; bridge respawn is yet another. Each handles its own death individually. No shared abstraction.

**Fix.** Lift to a framework: `lib/death-protocol.ts` defines the contract — every agent provides `serializeContext()` (returns durable state) + `bootFromContext(context)` (rehydrates). Death triggers (Order 66, idle-eviction, Next.js restart, explicit `/die`) call the contract uniformly. The cinematic overlay (`public/compaction-overlay.html`) and the resurrection-prompt write are pluggable consumers of the protocol. ~400 LOC + agent-by-agent retrofit.

**Why now.** Multi-tenant means N orders, each with their own deaths. A shared protocol is the only way to keep this consistent.

### C3. Sage portrait as product surface

**Problem.** Sage paints user portraits in `agents/CD-MEMORY.md` and `RESURRECTION.md`. They're internal. The user never sees their portrait directly — only its effects in CD's behavior.

**Fix.** Surface the portrait in the UI: `app/(dashboard)/profile` shows the current portrait, version history, what changed in the last Sage pass. User can edit corrections (Sage learns). The portrait becomes a *product surface*: "OskarOS knows you. Here's what it knows. Here's what it learned this week." ~250 LOC + UX. Tied to B5 (per-tenant Order).

**Why now.** Portrait-visible-to-user is the visible artifact of the agent substrate. "The agents remember you" is a product claim; making the memory tangible is what backs the claim.

### C4. Structural audit agent (counter-trained against auditor blind spots)

**Problem.** Ralph's just-named frustration: external auditors miss structural leaps. They read .md files, look at file sizes, anchor on prior audits. They never recommend the architectural bet that unlocks the next phase.

**Fix.** A new agent role: **Auditor**. Boot prompt explicitly counter-trains:
- Don't read prior audit reports first
- Don't measure file size as a quality proxy
- Read SESSION.md to understand operational reality, not just code structure
- Required output: "What should exist but doesn't?" + "What would you tear out and rebuild?" — at least one concrete answer to each, named precisely
- Required: name the architectural bet that would unlock the next phase
- Banned: any score above 7/10 without naming three specific issues
- Banned: any "this is impressive" framing — replace with "what's at risk"

Lives at `agents/auditor.md`. Invoked by `mcp__oskar-orchestrator__run_audit`. Output written to `docs/AUDIT-{date}-{model}.md`. ~200 LOC + agent prompt + tool definition.

**Why now.** Audit feedback is the only mechanism for an agent system to learn what it's missing. Generic auditors miss the structural layer. Counter-trained auditors might catch it. Worth the experiment because the alternative is "Ralph notices it months later, like the MCP migration."

### C5. Order doctrine versioning + diff visibility

**Problem.** Agent prompts evolve. CD-2026-04-15.md ≠ CD-2026-05-01.md. The doctrine is in git but no agent reads `git log`. If Sage paints a portrait under the old CD doctrine and then CD upgrades, the portrait may reference rules that no longer exist.

**Fix.** Doctrine versioning: each agent prompt has a `doctrine-version: 2026-05-01` frontmatter. INSTITUTIONAL-MEMORY entries are tagged with the doctrine version active when they were written. Per-tenant Order tracks which doctrine version they're on; on upgrade, Sage diffs old vs new and notes deltas in the tenant's CD-MEMORY. ~200 LOC + per-agent frontmatter.

**Why now.** Multi-tenant accelerates doctrine evolution (more eyes, more bugs). Without versioning, tenants drift on different rule sets without anyone noticing.

---

## 4. Pillar D — Productization Vertical #1 (Swiss law-firm websites)

This was the original FEATURE-X focus. It's still valid as the **first vertical revenue path** — but reframed as one of N possible verticals on top of the agent substrate, not the central thesis.

The three gating features remain unchanged from the prior revision (full detail at git ref `63f97ca:oskar-prototype/docs/FEATURE-X.md` §4 if needed). Compressed summary:

### D1. SEO Optimization Layer (~1.5 weeks)

Per-page SEO panel in Director Mode + schema designer (`LegalService` / `Article` / `FAQPage` / `HowTo` / `Person` / `LocalBusiness`) + sitemap/robots/redirects auto-generation + publish-time validation + programmatic-SEO bulk generate (CSV → N pages). The unfair-advantage piece: 7 practice areas × 80 cities × 6 intents = ~3,400 unique landing pages, each fully indexed for local-intent long-tail queries. No Swiss law firm is doing it.

### D2. Multilingual Layer (~2.5 weeks)

Language family model (`/de/strafbefehl` ↔ `/it/decreto-d-accusa` linked at the data level). Hreflang generation, translation pipeline with partner review, language switcher widget, per-language sitemap. WPML charges CHF 100/year and gets it wrong; doing it native and right is real moat for the CH market.

### D3. Blog (multilingual) (~2 weeks)

Authoring UI in Director Mode + multi-language sync riding on D2. Markdown editor, image pipeline integration, RSS, hreflang per-post.

### D4. AI-Overview Optimization (supporting, ~2-3 weeks, customer-funded)

Audit existing posts/pages for AI-citability, remediation engine, Wikidata push for partner profiles, monthly LLM-citation tracking. The new SEO is getting cited by AI, not ranked by Google.

### D5. Static-shadow Layer (supporting, ~2 weeks, customer-funded)

Cloudflare Worker dynamic rendering for hybrid WP customers — Googlebot gets pre-rendered static, real users get WP frontend. Greenfield OskarOS sites don't need this (D1 already outputs static).

**Sequencing.** D1 → D2 → D3 = ~6 weeks serial. Parallel ~4 weeks. Gating: build when first paying customer commits.

**Customer offer.** Brief discovery → 8-12 designed pages → publish-grade SEO → DE+IT/FR/EN auto-translated + partner-reviewed → blog they can post in 20 min → static HTML on Cloudflare's edge. CHF 25-40k year one, CHF 18-30k years after. AI-Overview audit + remediation as add-on at CHF 12-20k initial + CHF 800-1,500/mo.

---

## 5. Carry-forward items (compressed from prior revision)

### 5.1 Junior Designer Workflow chat-UI checkpoint (~260 LOC)

Sentinel-detection in `lib/chat-parser.ts`, "Pass 1 ready — review?" card with Continue/Discuss buttons (`components/ChatStream.tsx`), agent pause/resume support (`lib/agent-runner.ts`), Junior Mode toggle (per-session flag, default OFF). Doctrine layer landed via 2-page showcase universal rule on 2026-04-30; UI/runner work remains.

### 5.2 Portability — Linux x86 (~1 session)

`lib/cli-paths.ts` consolidation with `findBinary()` + `safePath()` + env-var overrides (`CLAUDE_BIN`, `GEMINI_BIN`, `CHROMIUM_BIN`). Replace 11 hardcoded `/Users/ralphlengler` and `/opt/homebrew` references. Test on Ubuntu 24.04 VM. `start.sh` banner uses `os.hostname()` + IP. Required for shipping outside Ralph's MacBook.

### 5.3 Older plans — superseded or absorbed

- `IMPLEMENTATION-PLAN-API-AGENT.md` — CLI vs API mode TopBar UI: ~300 LOC if shipped, otherwise close out. Decision needed.
- `ADVANCED-MODE-PLAN.md` — Stages 1-16: most are shipped or absorbed; one-pass audit needed to mark each.
- `BRANDING-PLAN.md` — 7-deliverable MVP: confirm Phase 1 ship status, decide on Phase 2+.
- `ARCHITECTURE-REDESIGN.md` — needs to close out or migrate live items.
- `MEMORY-SYSTEM-IMPLEMENTATION-PLAN.md` — superseded by Sage 240/40 + portrait subsystem; mark as such.

Half-session of cleanup pass when prioritized.

---

## 6. Implementation Sequence

Four pillars; some serial within, some parallel across.

### Track A — Foundation (4-6 weeks focused)

Order matters: A1 (persistent bus) → A2 (bridge replacement) blocks everything else. A3-A7 can run parallel after.

1. **A1 — Persistent bus** (~1 week). Disk-back the messageLog, queues, lastSeen, orphans. SQLite per session.
2. **A2 — Bridge replacement** (~2 weeks). CD/WebDev/Sentinel/Sage as MCP server peers, persistent state, native restart-survival.
3. **A3 — Sage 240/40 deterministic** (~3 days, after A1).
4. **A4 — Agent-prompt validation** (~3 days, parallel with A3).
5. **A5 — WebDev verification floor** (~2 days, parallel).
6. **A6 — Live test framework** (~1 week, parallel — gates future bus refactors).
7. **A7 — Brand-lint v2 perceptual** (~2 weeks, parallel).

### Track B — Substrate (8-12 weeks, gated on Track A1+A2)

1. **B1 — Multi-tenant identity** (~2 weeks).
2. **B2 — Persistent storage** (~3 weeks, partially overlaps B1).
3. **B3 — Token usage + billing** (~2 weeks BYOK only, +2 OskarOS-fronted).
4. **B4 — Onboarding** (~1.5 weeks, gated on B1).
5. **B5 — Per-tenant Order instantiation** (~1 week, gated on B1+B2).

### Track C — Order Infrastructure (incremental, parallel with B)

1. **C1 — Lumberjack typed pipeline** (~3 days, can ship anytime after A4).
2. **C2 — Death Protocol generalized** (~1 week, gated on A2).
3. **C3 — Sage portrait UI** (~1 week, gated on B5).
4. **C4 — Structural audit agent** (~3 days, can ship anytime).
5. **C5 — Doctrine versioning** (~3 days, gated on A4).

### Track D — Productization Vertical #1 (gated on first paying customer)

1. **D1 — SEO Layer** (~1.5 weeks).
2. **D2 — Multilingual** (~2.5 weeks).
3. **D3 — Blog** (~2 weeks).
4. **D4 — AI-Overview** (customer-funded supporting).
5. **D5 — Static-shadow** (customer-funded supporting).

Serial ~6 weeks; parallel ~4 weeks. Gated on customer commitment.

### Track E — Carry-forward (1-2 sessions)

1. **5.1 Junior Mode UI** (~1 day).
2. **5.2 Portability** (~1 day).
3. **5.3 Plan cleanup** (~half day).

### Headline cadence (one engineer)

- **Now → +6 weeks**: Track A (foundation). MCP Phase 4 lands properly.
- **+6w → +18w**: Track B (substrate). Multi-tenant launches.
- **+18w → +24w**: Track D (vertical #1) when FF or Aequitas commits.
- **Continuous**: Track C (Order infrastructure) — incremental during the above.
- **Parking lot**: Track E whenever the active track doesn't fill the day.

---

## 7. Open Decisions for Ralph

1. **Pillar order.** I've sequenced A → B → D with C parallel. Confirm or reorder. Specifically: does B (multi-tenant) precede D (law-firm productization), or do you want to ship D as a one-off for FF first, then refactor for B later? My read: A is mandatory; B before D is cleaner because B's persistent storage simplifies D's per-customer asset namespacing; but D-first-then-B-as-second-customer is also coherent if FF is the priority.

2. **BYOK vs OskarOS-fronted.** B3 has two modes. BYOK is faster + lower-liability + lower-margin. OskarOS-fronted needs Anthropic enterprise terms + billing infra but unlocks higher pricing (CHF 25-40k offer doesn't fly if customer also pays Anthropic separately). Pick one, or ship BYOK first and add fronted as upgrade.

3. **Structural audit agent (C4).** Worth the experiment, or YAGNI? My case for: every external audit so far has missed the structural layer (your own words). Counter-trained auditor might catch it. Cost: ~1 day. Risk: produces noise.

4. **Death Protocol generalization (C2).** Order 66 + Sage 240/40 + bridge respawn each handle their own death individually today. Lifting to a framework is medium-cost (~1 week). Alternative: leave each as-is, accept the duplication. My read: framework wins as N agents grow; ad-hoc wins if N stays at 5.

5. **Brand-lint v2 perceptual (A7).** Adds an ML dependency (small ONNX model for SSIM/LPIPS) — first time the bus introduces a non-trivial native dep. Worth it for the quality signal, but it's a deployment-complexity step. Confirm before I take it on.

6. **Multi-tenant timing.** Track B is 8-12 weeks. That's a long invest before revenue. Alternative: ship D for FF/Aequitas as a single-tenant fork, defer multi-tenant until proven willingness-to-pay. My read: the agent-substrate thesis only works at multi-tenant; single-tenant forking is a debt that compounds. But near-term cash from FF might justify the debt.

Pick and we move.

---

## 8. Manifest (compressed)

Files this plan will touch, by track:

**Track A — Foundation**
- New: `lib/agent-inbox-bus-persist.ts`, `lib/death-protocol.ts`, `mcp-server/cd-server.ts` + `webdev-server.ts` + `sentinel-server.ts` + `sage-server.ts`, `lib/session-recorder.ts`, `lib/replay-runner.ts`, `lib/perceptual-diff.ts`, `lib/agent-prompt-validator.ts`
- Modified: `lib/agent-inbox-bus.ts`, `lib/bridge-process-manager.ts` (eventually retired), `mcp-server/tools-orchestrator.ts`, agent prompts (frontmatter), `lib/sentinel-ti.ts` (perceptual-diff hook)

**Track B — Substrate**
- New: `app/auth/[...nextauth]/route.ts`, `lib/db/schema.ts`, `lib/db/migrations/`, `app/onboarding/`, `lib/usage-billing.ts`, `lib/order-fork.ts`
- Modified: every API route that takes a session id (50+ files) — add `userId` + auth check; filesystem layout (`public/{userId}/{sessionId}/`)

**Track C — Order Infrastructure**
- New: `lib/memory/lumberjack-pipeline.ts`, `agents/auditor.md`, `app/(dashboard)/profile/page.tsx`
- Modified: `lib/memory/lumberjack.ts`, `agents/*.md` (frontmatter), `lib/death-protocol.ts` (consumed by all agents)

**Track D — Vertical #1**
- New (when each starts): `FEATURE-X-SEO.md`, `FEATURE-X-MULTILINGUAL.md`, `FEATURE-X-BLOG.md`, `FEATURE-X-AIOVERVIEW.md`, `FEATURE-X-SHADOW.md`
- Modified: Director Mode UI, vibe-build pipeline, `lib/session.ts`

**Track E — Carry-forward**
- New: `lib/cli-paths.ts`, `lib/chat-parser.ts` (sentinel detection), `.env.example`
- Modified: 11 hardcoded-path call sites; `components/ChatStream.tsx`; `app/api/chat-stream/route.ts`

---

## 9. Testing Checklist (per track)

**Track A done means:**
- [ ] Next.js restart preserves messageLog + queues + orphans (A1)
- [ ] CD respawns from disk after kill -9 with full conversation history (A2)
- [ ] Sage 240/40 cut produces deterministic output for known input (A3)
- [ ] CI fails on agent prompt missing required sections (A4)
- [ ] WebDev build with broken HTML triggers `failed-validation` (A5)
- [ ] Recorded session replays to identical state (A6)
- [ ] Perceptual diff catches a 20% color drift on hero, doesn't false-positive on layout-equivalent change (A7)

**Track B done means:**
- [ ] Two users sign up, can't see each other's sessions (B1)
- [ ] Postgres-backed query returns user's full vibe history across sessions (B2)
- [ ] BYOK flow: tenant's API key used, OskarOS doesn't see the cost (B3)
- [ ] New user signs up, completes onboarding, sees vibe-1 within 10 min (B4)
- [ ] Two tenants' Orders have separate INSTITUTIONAL-MEMORYs; doctrine remains shared (B5)

**Track C done means:**
- [ ] Lumberjack stage-graph is data, not implicit; reordering breaks at compile time (C1)
- [ ] Order 66, Sage cut, bridge respawn all use the same `serializeContext`/`bootFromContext` (C2)
- [ ] Tenant sees their portrait in dashboard, can edit it (C3)
- [ ] Auditor agent produces "what should exist but doesn't" + "what to tear out" — at least one concrete answer to each (C4)
- [ ] Doctrine version-bump triggers Sage delta-pass per tenant (C5)

**Track D done means:** per dedicated FEATURE-X-* sub-doc.

**Track E done means:** prior revision's checklist still applies — Junior Mode card renders, hardcoded paths zero, plan headers all marked.

---

_End of FEATURE-X.md (rewritten 2026-05-01 — substrate translation framing)_
