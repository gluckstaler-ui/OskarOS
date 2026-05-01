# FEATURE-X — WebDev Evolution + Productization

**Status:** Planning (post-matrix-landing 2026-04-30)
**Owner:** Ralph + Jedi Claude
**Scope:** Multi-session — Junior Designer Workflow + 2-page showcase, motion-vibe support, portability for non-Mac x86, productization (programmatic SEO + AI-Overview optimization + static shadow layer)
**Supersedes (in part):** sections of `IMPLEMENTATION-PLAN-API-AGENT.md`, `ARCHITECTURE-REDESIGN.md`, leftover items from `ADVANCED-MODE-PLAN.md` and `BRANDING-PLAN.md`
**Companion doc:** `HUASHU-INTEGRATION-PROPOSAL.md` v4 owns the huashu-skill / agent-doctrine integration backlog (matrix landing + animation gates + audio integration + per-format production guidance + BRANDING tab UI). FEATURE-X owns the WebDev infrastructure, portability, and productization tracks. The two docs should be read together.

---

## 0. Why this document exists

Four forces converged across these weeks:

1. The **huashu-design** repo gave us 21 reference files for design quality. **Status (2026-04-30):** vendoring landed differently than originally planned — refs live at `skills/references/` not `agents/refs/`, and the "skip slide-decks/audio/etc." list was wrong; slide-decks is now primary doctrine. See Section 1 for the corrected state and `HUASHU-INTEGRATION-PROPOSAL.md` v4 for the active backlog of skill-integration work.
2. The **Junior Designer Workflow** changes how WebDev approaches a build — show assumptions early, halt for feedback, don't charge head-down. **Status (2026-04-30):** the doctrine layer landed via the **2-page showcase universal rule** (workflow.md After-Phase-1-GATED). The chat-UI checkpoint mechanism (sentinel + Continue/Discuss card + agent pause/resume) is still pending. See Section 2.
3. **Portability** — OskarOS shipping outside Ralph's MacBook needs to land on Linux x86 (Swiss hosters, customer servers, eventual reseller deployments). Hardcoded `/opt/homebrew` and `/Users/ralphlengler` paths must die. See Section 3 — unchanged by matrix landing.
4. **Productization** — turning OskarOS into a service that ships law-firm websites needs three new product modules: programmatic SEO engine, AI-Overview/SGE optimization, static-shadow layer. These are A-TIER features and they need their own implementation tracks. See Section 4 — unchanged by matrix landing.

This document is the consolidated build plan for all four. Older plans (`IMPLEMENTATION-PLAN-API-AGENT.md`, `ARCHITECTURE-REDESIGN.md`, dangling items in `ADVANCED-MODE-PLAN.md`) are **inventoried** at the bottom — leftover tasks pulled into one queue.

---

## 0.5. Matrix landing 2026-04-30 (what changed)

The presentation matrix landing on 2026-04-30 affects three sections of this document:

- **Section 1 (Huashu vendoring) — substantially superseded.** The vendor-into-agents/refs plan didn't ship; refs landed at `skills/references/` and the skip list was inverted. See revised Section 1 below. Active huashu-integration backlog now lives in `HUASHU-INTEGRATION-PROPOSAL.md` v4.
- **Section 2 (Junior Designer Workflow) — partially shipped via 2-page showcase rule.** The doctrine layer landed (universal across 8 presentation formats); the chat-UI checkpoint mechanism is still pending and remains in scope here. See revised Section 2.
- **Section 6 (Implementation Sequence) — Track A status reset.** Vendoring is essentially done (different path, different scope); animation refs vendoring is pending per HUASHU-INTEGRATION-PROPOSAL.md v4 carry-forward.

Sections 3 (Portability), 4 (Productization), 5 (Leftover tasks) are unchanged — matrix landing is doctrine-layer work, doesn't intersect with infrastructure or product features.

---

## 1. Huashu Reference Vendoring (REVISED 2026-04-30)

### 1.1 Status — what actually shipped vs. what was planned

The original plan (above this revision) was: vendor 11 huashu refs to `agents/refs/` with a "complete rewrite" pass; skip slide-decks / scene-templates / editable-pptx / audio / video. That plan was wrong on path AND on scope.

**What actually shipped (2026-04-29 → 2026-04-30):**

- Refs live at `skills/references/`, not `agents/refs/`. The `skills/` directory pattern matches huashu's own structure and is the path Sage / Sentinel Ti / WebDev / CD all read from.
- The "skip" list is inverted: `slide-decks.md` is now PRIMARY presentation doctrine (the 20-category × 9-format matrix lives there — Gallery promoted to Format 9 on 2026-04-30 per HUASHU-INTEGRATION-PROPOSAL.md v4 §C11); `editable-pptx.md` is referenced as the PowerPoint-export sub-branch; `scene-templates.md` is being redistributed (per v4 §A2); audio refs (`audio-design-rules.md`, `sfx-library.md`) are integrated for video deliverables and animation-paired vibes.
- Animation refs (5 files, ~1,576 lines) ARE present at `skills/references/` but their integration into agent doctrine is still pending. Per HUASHU-INTEGRATION-PROPOSAL.md v4 carry-forward items C1-C4: Sentinel Ti animation audit gate + WebDev animation discipline + per-vibe Animation Direction block + (REVISED 2026-04-30) project-wide `docs/INSTITUTIONAL-MEMORY.md`. The original C4 spec was for an animation-only per-session ANIMATION-MEMORY.md owned by Sentinel Ti. Ralph 2026-04-30 generalized it: animation isn't the only domain where bugs eat 3+ turns. Any bug that takes 3 or more iterations to fix gets logged in INSTITUTIONAL-MEMORY.md by whichever agent (or human) burned the turns. Animation gets a sub-section but isn't special. See HUASHU-INTEGRATION-PROPOSAL.md §C4 for the rewritten spec.

**What's genuinely complete:**

- `skills/references/workflow.md` — Phase 1 standard discovery + Phase 1-GATED presentation workflow (Steps A-D). Updated 2026-04-30 with TWO-vibes rule + 2-page showcase universal rule.
- `skills/references/slide-decks.md` — 20×8 matrix, format vocabulary, Classical/Interactive school columns, CANVAS UNLOCK, content approach templates pending (HUASHU-INTEGRATION-PROPOSAL.md v4 §B1).
- `skills/references/design-styles.md` — 20 schools / 5 clusters / Style × Medium quick reference. Stable.
- `skills/references/cta-manual.md` — Moved from docs/ on 2026-04-30, broadened to all narrative artifacts.
- `skills/references/animation-best-practices.md` / `animations.md` / `animation-pitfalls.md` / `cinematic-patterns.md` / `hero-animation-case-study.md` — present but unintegrated (see C1-C4 carry-forward).
- `skills/references/audio-design-rules.md` / `sfx-library.md` — present but unintegrated (see C5 carry-forward).
- `skills/references/critique-guide.md` / `content-guidelines.md` / `verification.md` — referenced in TIER 2/3 of `creative-director-agent.md`.
- `skills/references/export-formats.md` — renamed from `editable-pptx.md` on 2026-04-30 per HUASHU-INTEGRATION-PROPOSAL.md v4 §A3 (DONE). Now also houses the architecture / Path A / Path B / slide labels / speaker notes / PDF export / common pitfalls content moved out of `slide-decks.md`. Cross-refs throughout `skills/` and `agents/` point to the new filename.

**What's still pending (now lives in HUASHU-INTEGRATION-PROPOSAL.md v4):**

- Animation gate integration (C1-C4 carry-forward)
- Audio decision gate + construction (C5)
- Cross-vibe coherence rule for landing pages (C6)
- Quality bar 5-10-2-8 checklist (C7)
- CD-MEMORY ↔ skills/ promotion path (C8)
- Cull list for `design-context.md` / `apple-gallery-showcase.md` / `tweaks-system.md` (C9)
- Legacy vibe inventory triage (C10)
- BRANDING tab UI (A1) + scene-templates redistribution (A2) + export-formats rename (A3) + image-slot vocabulary (A4)
- Content approach templates (B1) + per-format production guidance (B2)

### 1.2 Agent-file references — current state (2026-04-30)

**`agents/creative-director-agent.md`** — already has a TIER 1/2/3 reference structure pointing to `skills/references/`. Updated 2026-04-30 with:
- TIER 2 Presentations block (workflow.md + slide-decks.md pointers)
- TIER 2 cta-manual.md reference (Critique / Copy section)
- Animation TRIO trigger (animation-best-practices.md / animations.md / animation-pitfalls.md) — fires on ANIMATION + SLIDE DECKS work
- Audio trigger (audio-design-rules.md + sfx-library.md) — fires when vibe specifies Audio paired: YES

**`agents/webdev-agent.md`** — read-on-demand reference table NOT YET inserted. Pending per HUASHU-INTEGRATION-PROPOSAL.md v4 §C3 (Animation Discipline section adds the table; matrix work didn't touch webdev-agent).

### 1.3 What this section now owns (vs. what HUASHU-INTEGRATION-PROPOSAL.md v4 owns)

Two-doc split:

- **FEATURE-X.md (this doc) §1** — historical record of what shipped, current state of agent-file references, infrastructure needed for huashu-skill use (none; the refs are plain markdown, no vendoring tooling required).
- **HUASHU-INTEGRATION-PROPOSAL.md v4** — active backlog of skill-integration work. All "what to ship next" decisions for huashu-related work happen there.

If you're looking for the next animation/audio/decks integration task, read v4. If you're looking for "what's the state of the refs" for portability or productization context, read this section.

---

## 2. Junior Designer Workflow Integration (REVISED 2026-04-30)

### 2.0 What's already shipped vs. still pending

The matrix landing on 2026-04-30 took the **doctrine layer** of Junior Designer Workflow forward via the **2-page showcase universal rule** (workflow.md After-Phase-1-GATED). That rule applies the same "show 2 samples, get user confirmation, then batch the rest" discipline across all 8 presentation formats — Slides cover+mid, Canvas hero+mid-section, Scrollytelling opening+transition, etc.

The 2-page showcase IS the Junior Pass for presentations. The original 4-pass workflow described below (Sections 2.2-2.4) carries forward for **landing-page and multi-page-site** builds where the showcase pattern doesn't apply directly. For presentations, the 2-page showcase is the canonical gate.

**Still pending (the chat-UI checkpoint mechanism):**

- The sentinel-detection in `lib/chat-parser.ts`
- The "Pass 1 ready — review?" card with Continue / Discuss buttons (`components/ChatStream.tsx`)
- The agent pause/resume support (`lib/agent-runner.ts`)
- The Junior Mode toggle (per-session flag, default OFF)

These remain in scope for FEATURE-X. The matrix landing only handled doctrine; the UI / runner work is unchanged from the original plan below.

### 2.1 Insertion point

**WebDev page-build phase only**, for now. CD discovery batch-asking is a small win and goes in the same workpackage. Advanced Mode integration deferred until Advanced Mode itself ships.

For presentation builds, the checkpoint sentinel fires after the 2-page showcase batch (when both showcase pieces are written), not after every individual slide. This matches the doctrine in workflow.md.

### 2.2 The 4 passes — OskarOS-specific

**Pass 1 — Assumptions + Placeholders** (5–15 min budget)

WebDev opens the new vibe HTML file. **First thing written is a comment block** at the top:

```html
<!--
JUNIOR DESIGNER — PASS 1 (assumptions + placeholders)
Vibe: vibe-1-qahwa-landing.html

What I'm building (per CREATIVE-BRIEF.md § Vibe 1):
- Hero with sultan-falcon shot
- 3-column service grid
- Testimonial carousel
- CTA strip + footer

Assumptions:
- Audience: Swiss high-net-worth, German-first
- Tone: editorial / restrained ("quiet luxury", not "gold-plated")
- Hero image is sultan.jpg as placeholder until you confirm
- Service grid: placeholder Lorem until CD provides strings

Open questions:
- Hero CTA: scroll to services OR open booking modal?
- Testimonials: 3 quotes OR carousel?
- Footer: full sitemap OR minimal?

If this is wrong, this is the cheapest moment to fix it.
-->

<section class="hero">
  <h1>[HERO HEADLINE — waiting on you]</h1>
  <p>[HERO SUBHEAD]</p>
  <div class="cta">[BUTTON LABEL]</div>
</section>
... (wireframe with grey boxes)
```

WebDev then emits a sentinel:
```
--- PASS-1-CHECKPOINT vibe-1-qahwa-landing ---
```

**Pass 2 — Real components + Variations**

After user gives green light, WebDev fills the placeholders with copy from CREATIVE-BRIEF.md, real images, real CSS. For multi-page vibes: emit `--- PASS-2-CHECKPOINT ---` after page 2 of N (when N≥4).

**Pass 3 — Polish**

Micro-adjustments only after user signals overall direction is right.

**Pass 4 — Verification**

WebDev reads `skills/references/verification.md`, runs through the eyeball checklist, takes Playwright screenshots if available, summarizes ONLY caveats + next steps (no praise, no padding).

### 2.3 The checkpoint mechanism

| Layer | Change | Lines |
|-------|--------|-------|
| `agents/webdeveloper.md` | Add 4-pass rules + sentinel format | ~80 added |
| `lib/chat-parser.ts` | Detect `--- PASS-N-CHECKPOINT ---` lines, emit checkpoint event | ~40 |
| `components/ChatStream.tsx` (or equiv) | Render "Pass 1 ready — review?" card with **Continue** / **Discuss** buttons | ~60 |
| `app/api/chat-stream/route.ts` | When checkpoint detected: hold stream chunk, wait for `continue` signal from client | ~30 |
| `lib/agent-runner.ts` (CLI subprocess wrapper) | Support pause/resume — send "continue" or "stop+restart-with-feedback" to running agent | ~50 |

Total: **~260 lines new code + 80 lines agent-file**.

### 2.4 Junior Mode toggle

Per-session flag, **default OFF**, lives in the studio sidebar:

- **OFF** → current behavior (charge through, show finished deck) — preserves all current flows for users who don't want the slow-careful path
- **ON** → 4-pass workflow with checkpoints

Persisted in session state (the same place vibe selections live). Single boolean.

### 2.5 CD discovery batch-asking

Light-touch addition to `creative-director-agent.md`:

```markdown
## Discovery — ask 10 in one batch, not ping-pong

When starting a new project, write all 10+ discovery questions
as a single markdown checklist. The user answers them all in one
reply. This is how huashu-design's Junior Designer Workflow opens
every project.

Read skills/references/workflow.md § "art of asking" for the full template.
```

No code changes for this. Pure agent-file rule.

---

## 3. Portability — Non-Mac x86

### 3.1 Target platforms

- **Primary new target:** Linux x86 (Ubuntu 22.04 / 24.04, Debian 12) — what Swiss VPS / Managed Cloud Server boxes run
- **Secondary:** Linux ARM (some hosters, eventual edge deployments)
- **Existing:** macOS Apple Silicon (Ralph's dev box) + macOS Intel (best effort)

Windows is **out of scope**. If a customer needs Windows, they run WSL2.

### 3.2 Hardcoded paths — current state

Found by grep across `lib/`, `scripts/`, `app/`, `components/`, plus `start.sh` / `start.command`. Five files have macOS-specific assumptions. One file has Ralph's home directory baked in.

| File:line | Current | Problem | Fix |
|-----------|---------|---------|-----|
| `lib/sentinel-ti.ts:43` | `/Users/ralphlengler/OskarOS/oskar-prototype/agents/sentinel-ti.md` | Ralph's home dir hardcoded | `path.resolve(process.cwd(), 'agents/sentinel-ti.md')` or `path.resolve(__dirname, '../agents/sentinel-ti.md')` |
| `lib/webdev.ts:37` | `/opt/homebrew/bin/claude` | Apple Silicon Homebrew only | Add Linux candidates: `/usr/local/bin/claude`, `/usr/bin/claude`, `/snap/bin/claude` (already partially done — extend the array) |
| `lib/webdev.ts:55` | `/opt/homebrew/bin/gemini` | Same | Same — extend candidate list |
| `lib/webdev.ts:476` | `PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + ...` | macOS-specific PATH prefix | Use `process.env.PATH \|\| '/usr/local/bin:/usr/bin:/bin'` — drop the `/opt/homebrew` prefix; let the parent shell carry the right PATH on Linux |
| `lib/webdev.ts:773` | Same | Same | Same |
| `lib/bridge-process-manager.ts:97` | `/opt/homebrew/bin/claude` | Same | Same fix as webdev.ts |
| `lib/bridge-process-manager.ts:177` | Hardcoded PATH | Same | Same fix |
| `lib/thumbnail-generator.ts:25-27` | `/opt/homebrew/bin/chromium` | macOS-specific | Add: `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`, `/snap/bin/chromium`, `/usr/bin/firefox` |
| `app/api/claude-code/route.ts:19` | Mac-only paths | Same | Extend candidate list |
| `app/api/claude-code/route.ts:204` | Hardcoded PATH | Same | Same fix |
| `app/api/webdev/route.ts:282` | Hardcoded PATH | Same | Same fix |
| `start.sh:43` / `start.command:35` | `paradiso.local` Bonjour hostname | mDNS not on by default in Linux | Print `0.0.0.0` and `<hostname>.local` (Linux + avahi resolves it; falls back gracefully) |

### 3.3 The `cliPaths.ts` consolidation

All scattered binary-finding logic gets pulled into one file:

```typescript
// lib/cli-paths.ts
import { existsSync } from 'fs'
import { join } from 'path'

const HOME = process.env.HOME || ''

const CANDIDATE_PATHS: Record<string, string[]> = {
  claude: [
    process.env.CLAUDE_BIN,                       // explicit override wins
    '/opt/homebrew/bin/claude',                   // macOS ARM Homebrew
    '/usr/local/bin/claude',                      // macOS Intel + Linux user-installs
    '/usr/bin/claude',                            // Linux package
    '/snap/bin/claude',                           // Ubuntu snap
    join(HOME, '.npm-global/bin/claude'),         // npm global
    join(HOME, 'node_modules/.bin/claude'),       // local install
    'claude',                                     // PATH-resolved
  ].filter(Boolean) as string[],

  gemini: [/* same shape */],
  chromium: [
    process.env.CHROMIUM_BIN,
    '/opt/homebrew/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/snap/bin/chromium',
    'chromium',
  ].filter(Boolean) as string[],
}

export function findBinary(name: keyof typeof CANDIDATE_PATHS): string {
  for (const p of CANDIDATE_PATHS[name]) {
    if (p === name || existsSync(p)) return p
  }
  return name
}

export function safePath(extra?: string): string {
  // Use system PATH as primary; only prepend extras if explicitly given.
  const base = process.env.PATH || '/usr/local/bin:/usr/bin:/bin'
  return extra ? `${extra}:${base}` : base
}
```

Then `webdev.ts`, `bridge-process-manager.ts`, `claude-code/route.ts`, `webdev/route.ts`, `thumbnail-generator.ts` all import from this one place.

**Bonus:** environment-variable overrides (`CLAUDE_BIN=/some/path`, `CHROMIUM_BIN=/some/path`) — lets the user point at custom locations without code changes. Critical for hosted deployments.

### 3.4 Other portability items

- **`start.sh` `sudo node scripts/port-forward.js`** — works on Linux but assumes the user can sudo. For server deployments, document the systemd unit file pattern instead. Add `start.systemd.example` showing how to run as a service.
- **`paradiso.local` mDNS** — replace banner with: detect actual hostname via `os.hostname()` and print both `http://<hostname>.local` (when avahi present) and `http://<actual-IP>` (always works).
- **File watchers** — Next.js dev uses `chokidar` which is fine cross-platform. Verify that any custom `fs.watch` calls (sentinel-ti, lumberjack-watch) have polling fallback for network filesystems.
- **Process killing** — `pkill -f` works on both macOS and Linux. Confirmed.

### 3.5 Portability test — one-day plan

After fixes land:

1. Spin up a fresh Ubuntu 24.04 LXC container or VPS
2. `apt install nodejs npm chromium` (or run claude/gemini install scripts)
3. `git clone` OskarOS, `npm install`, `npm run dev`
4. Open in browser, run end-to-end: discovery → vibe build → image generation → CEO selection
5. Anything that breaks → file under "portability bugs" and fix
6. Lock the test as a CI job (GitHub Actions Linux runner) so regressions are caught

---

## 4. Productization — The Gating Product Cut

### 4.0 Position

OskarOS as a brand-vibe tool is a hobby. OskarOS as a service that ships law-firm-grade websites is a business. **Three features stand between hobby and business** — these are the gating cut. Everything else (forms, deploy pipeline, analytics, hosting) is plumbing: solve in a day, or punt to somebody else's product. **The three below are the ones nobody else gives the customer if we don't build them ourselves.**

After they ship, the customer-facing offer reads like this:

> *Brief discovery → 8–12 designed pages with publish-grade SEO → DE primary + IT/FR/EN auto-translated and partner-reviewed → blog they can post into in 20 minutes → static HTML on Cloudflare's edge → no plugin updates, no Borlabs banner, no RankMath license.*
> *CHF 25–40k year one, CHF 18–30k years after.*

That's the FF-league offer. Six weeks of code stands between us and selling it.

### 4.1 Gating Feature #1 — SEO Optimization Layer (~1.5 weeks)

This is a **layer**, not a feature. Five subcomponents:

#### 4.1.1 Per-page SEO panel in Director Mode
Title, meta description, OG image, canonical, robots, schema type. Override anything per page; sane auto-generated defaults if not touched.

#### 4.1.2 Schema designer
Pick a type (`LegalService` / `Article` / `FAQPage` / `HowTo` / `Person` / `LocalBusiness`), get a form for the fields, output a clean unified `@graph` JSON-LD block. **This is what RankMath sells as a Pro feature; we ship it native.**

#### 4.1.3 Sitemap + robots + redirects auto-generation
Including a redirects panel for migrating customers off WP (301 from `/anwalt/strafrecht` → new URL).

#### 4.1.4 Validation at publish time
Single H1, schema validates against schema.org, hreflang reciprocity, no orphan pages, no broken internal links. **Block publish on hard errors, warn on soft.**

#### 4.1.5 Programmatic-SEO bulk generate
CSV (practice area × city × intent) → N pages, all with the SEO panel auto-filled per row. **This is the unfair-advantage piece versus WordPress.**

**The math for FF:** 7 practice areas × ~80 ZH/AG/SH cities × ~6 user-intent variants = **~3,400 unique landing pages.** Each fully indexed, each ranking for one specific local-intent long-tail query (e.g. "Strafanzeige erhalten in Wädenswil — was tun?", "EtG-Haartest Winterthur — Beweiswert anfechten").

Google's local pack rewards these aggressively because the intent is geographic + transactional. Zapier, AirBnB, TripAdvisor are built on this playbook. **No Swiss law firm is doing it.**

**Pipeline:**
- Template engine: row → HTML page with locally-targeted copy, FAQ block, schema (`LocalBusiness` + `LegalService` + `FAQPage`), internal links to nearest practice-area page + attorney bios
- Content generation: Opus / Sonnet writes the body, partner reviews 50–100/month for legal accuracy, the rest auto-publish
- Static HTML output to `/orte/`, `/themen/`, or a subdomain — bypasses Elementor entirely, pure server-rendered, fast LCP
- Monthly drift detection: Google Search Console API → climbing pages get refreshed, stagnant pages get regenerated

**Projected impact for FF:** 5–8× organic traffic in 12 months. At ~2% inbound→consultation conversion, that's a meaningful lead-volume multiplier.

**For Aequitas:** same engine tuned to authority-building rather than volume — 100–200 high-density pages on niche economic-law topics (FINMA-Verfahren, internationale Rechtshilfe, Trust-Recht CH-IT) — fewer pages, each peer-reviewed-depth.

### 4.2 Gating Feature #2 — Multilingual, Done Right (~2.5 weeks)

OskarOS already has multi-language vibes — FalCaMel ships IT / DE / FR / EN. What's missing is the **structural** layer that turns parallel vibes into an actually-multilingual *site*.

This is the piece **WPML charges CHF 100/year for and gets wrong half the time.** Doing it native and *right* is a real moat for the CH market specifically — every Swiss professional-services site needs at least DE/FR or DE/IT, often all four.

#### 4.2.1 Language family model
Pages know they're variants of one canonical post. `/de/strafbefehl` ↔ `/it/decreto-d-accusa` ↔ `/fr/ordonnance-penale` ↔ `/en/criminal-order` are linked **at the data level**, not just by URL parallelism.

#### 4.2.2 Hreflang generation
`<link rel="alternate" hreflang="de-CH" href="…">` for every variant on every page, including `x-default`. Generated from the family graph at build time, not by a plugin.

#### 4.2.3 Translation pipeline
Author writes in DE → OskarOS auto-drafts IT/FR/EN → partner reviews each → publish all together OR independently. **When the DE source changes, prompt to refresh the others (with a diff preview).**

#### 4.2.4 Language switcher widget
Drop-in, pulls variant URLs from the family graph. Falls back gracefully when a variant doesn't exist.

#### 4.2.5 Per-language sitemap + canonical handling
So Google doesn't penalize duplicate content across language paths.

### 4.3 Gating Feature #3 — Blog (Multilingual) (~2 weeks)

Two parts. Cleanest if built together — they share infrastructure.

#### 4.3.1 Authoring loop
- "+ New Post" UI in Director Mode
- Markdown editor (block-style is nicer; markdown is faster to ship)
- Cover image (uses the existing image pipeline), slug, excerpt, tags, category, author, publish date, status (draft/published)
- Inherits design from a chosen blog template vibe
- Saves to disk, regenerates `/blog/index`, regenerates tag/category pages, regenerates RSS feed, redeploys

#### 4.3.2 Multi-language sync (rides on Feature #2)
- Author writes the DE post → OskarOS auto-drafts IT/FR/EN versions
- Partner reviews each in side-by-side mode → approves or edits
- Hreflang on each post wires them together
- Index page is per-language; tags are per-language; RSS feed is per-language

**Schema integration:** Author schema (`Person` linked to attorney bio) and Article schema (with `author`, `datePublished`, `dateModified`, `keywords`) drop in **automatically** because the SEO layer (#1) already supports per-template schema.

### 4.4 Gating Sequence

**Serial (one-engineer):** #1 → #2 → #3 = ~6 weeks focused dev. SEO first because it's a prerequisite for the schema in #3 to be right, and because #2's hreflang lives inside #1's metadata layer.

**Parallel (one engineer splitting work):** ~4 weeks because #1 and #3 share the per-page metadata model, and #2 sits on top of both.

After 6 weeks: shippable to FF. Demo-able to Aequitas. Pitch-able to other Swiss law firms.

### 4.5 Supporting Layers — Build After Gating

These complement the gating features but aren't gating themselves. **Build when customer-funded** — meaning don't sink dev hours until a customer is paying for the gating package.

#### 4.5.1 AI-Overview / SGE optimization layer (~2–3 weeks)

**The thesis.** Increasingly users don't click through to law-firm websites — they ask Claude / ChatGPT / Gemini / Google AI Overview. **The new SEO is getting cited by AI, not ranked by Google.**

A panic-googler asking "Was tun bei Strafbefehl in der Schweiz?" gets an AI Overview answer at the top of Google. Whether that AI cites the firm depends on:

- Strong factual content (LLM-friendly: explicit dates, statutes, procedure steps)
- Schema markup the AI can parse cleanly (gating feature #1 already delivers this)
- Authority signals (E-E-A-T): named-author bylines, attorney credentials in schema, Wikipedia/Wikidata presence
- Question-answer structured content (FAQPage schema, gating feature #1 supports this)
- Citations to primary sources (BGE, ZGB, SR-numbers — gives AI confidence to cite back)

**What OskarOS builds on top of the gating package:**

- **Audit tool:** scan FF's existing posts + practice areas, score each on AI-citability, output prioritized fix list
- **Remediation engine:** rewrite each piece into AI-overview-ready format (TL;DR at top, explicit Q&A, BGE-number citations, author byline schema, FAQ schema)
- **Wikidata + Knowledge Graph push:** get partners onto Wikidata as Q[id] entities with `instance of: human`, `occupation: lawyer`, `member of: Swiss Bar Association`. **This is what makes AI confident enough to cite a person.**
- **Monthly tracking:** query the major LLMs with target queries → measure how often the firm is cited → iterate

**Pricing:** CHF 12k–20k initial audit + remediation, CHF 800–1,500/month for ongoing tracking.

**For Aequitas this is more important than for FF** — peer-reviewed publications are gold for AI citation if they're properly structured + open-access. Right now they're behind login walls or PDFs LLMs ignore. Convert them to AI-readable HTML and Aequitas becomes Switzerland's authority on cross-border economic crime.

#### 4.5.2 Static-site shadow layer for crawl-budget + CWV (~2 weeks)

Mostly relevant when migrating an Elementor-tax customer onto OskarOS-output but the customer wants to keep WP for editing.

**Pattern:** dynamic rendering — Cloudflare Workers / BunnyCDN / Vercel Edge intercepts Googlebot, serves pre-rendered static HTML (~30 KB) instead of Elementor's 258 KB / 1,268-node monstrosity. Real users still get the WP frontend; Googlebot gets clean static.

TTFB 1.6s → 150ms. LCP 3.5s → 0.8s. DOM 1,268 → 200.

Google-approved pattern. Used legitimately by every major SaaS that needs WP for CMS but can't afford the SEO weight.

**Pricing:** CHF 8k–12k initial + CHF 100/month edge hosting.

**Note:** for greenfield customers (where OskarOS ships the whole site), this layer is *unnecessary* — gating feature #1 already outputs static HTML. The shadow layer is a migration tool for hybrid setups.

### 4.6 The Customer Offer (when all gating + supporting features ship)

**Deliverables:**
- Brief discovery → 8–12 designed pages
- Publish-grade SEO (per-page panel, schema, sitemap, validation)
- DE primary + IT/FR/EN auto-translated and partner-reviewed
- Blog they can post into in 20 minutes
- Static HTML on Cloudflare's edge
- No WP plugin updates, no Borlabs banner, no RankMath license

**Pricing:** CHF 25–40k year one, CHF 18–30k years after (covers content generation, ongoing publishing cadence, partner-review workflow).

**Add-ons (priced separately):**
- AI-Overview audit + remediation: CHF 12k–20k + CHF 800–1,500/mo
- Programmatic SEO bulk run (e.g. 3,400-page FF buildout): part of the year-one fee, scaled by row count
- Static-shadow migration layer (only for hybrid WP customers): CHF 8k–12k + CHF 100/mo edge

### 4.7 Future sub-docs

When each track starts, it gets its own implementation doc:
- `FEATURE-X-SEO.md` (gating #1)
- `FEATURE-X-MULTILINGUAL.md` (gating #2)
- `FEATURE-X-BLOG.md` (gating #3)
- `FEATURE-X-AIOVERVIEW.md` (supporting)
- `FEATURE-X-SHADOW.md` (supporting)

---

## 5. Leftover Tasks Pulled From Older Plans

Inventory of unfinished items in earlier docs. Not duplicating prose — just naming what's still open so it doesn't get lost.

### 5.1 From `IMPLEMENTATION-PLAN-API-AGENT.md`

The CLI vs API mode split was partially built but **never wired into the UI**. Open items:

| Item | Status | Effort |
|------|--------|--------|
| TopBar `CLI \| API` mode pill group | Not built | ~60 lines |
| TopBar model pill group (OPUS / SONNET / GEMINI) | Not built | ~60 lines |
| `executionMode: 'cli' \| 'api'` state in `page.tsx` | Not built | ~20 lines |
| Route `chat-stream` and `webdev` through selected mode | Not built | ~40 lines |
| `SendMessage` custom tool for CD→WebDev in API mode | Not built | ~30 lines |
| `send-user-notification` custom tool | Not built | ~30 lines |
| `Monitor` tool with progress SSE | Not built | ~40 lines |
| `WebSearch` tool — connect to Brave/Serper | Stubbed | ~20 lines |

Total roughly **300 lines of work**. Decision needed: do we ship this, or has API mode been deprioritized in favor of CLI-only? Flag for Ralph.

### 5.2 From `ADVANCED-MODE-PLAN.md`

23 stages defined, several explicitly marked `(added 2026-04-17)` indicating they were tacked on later and may not be fully implemented:

- Stage 10: Director Mode Coverage
- Stage 11: Generation Management
- Stage 12: Studio Tab Overflow
- Stage 13: Image Mode UX Refinements
- Stage 14: CD Workflow Wiring (REVISED)
- Stage 15: Image Mode CD Contract (NORMATIVE)
- Stage 16: Brand Tab (supersedes WP-B1..B5)

**Action:** before starting Advanced Mode work, audit which of Stages 1–16 are actually shipped vs. skeleton-only. One pass through the codebase mapping plan→reality. Estimate: half a session.

### 5.3 From `BRANDING-PLAN.md`

7-deliverable MVP (Logo, Guideline, Card, Pitch Slide, Hero, Post, Story) has Phase 1–4 phasing:

- **Phase 1** — single-generate per deliverable (status unclear, audit needed)
- **Phase 2** — Batch Mode ("GENERATE ALL") — deferred
- **Phase 3** — Extended Catalog (more deliverable types) — deferred, zero framework changes needed
- **Phase 4** — Brand Library View — deferred

**Action:** confirm Phase 1 ship status before deciding on Phase 2+.

### 5.4 From `ARCHITECTURE-REDESIGN.md`

Older redesign proposal, ~7 KB. Need to determine: superseded by current architecture, or still pending? Will read in next session and either close out or migrate live items here.

### 5.5 From `MEMORY-SYSTEM-IMPLEMENTATION-PLAN.md`

5-phase build:
- Phase 1 — Paths + dual-write — **shipped**
- Phase 2 — Consolidator (Lumberjack) — **scrapped multi-stage, single-call padawan now lives**
- Phase 3 — CD Agent integration — **shipped**
- Phase 4 — Dreamer (hourly agent) — **partial?** — need to verify status
- Phase 5 — Migration + cleanup — **status unknown**

**Action:** Sage-Portrait + Sage-240/40 are the new memory hygiene layer. Need to mark this plan as superseded and write a one-page "memory system as built" doc.

---

## 6. Implementation Sequence

The work in this document doesn't need to happen serially. Three independent tracks, plus a clean-up pass.

### Track A — WebDev Foundations (REVISED 2026-04-30)

The original Sessions A1-A2 (vendor refs) are essentially DONE — refs live at `skills/references/`, doctrine integration is partially shipped via the matrix landing, remaining doctrine work is owned by HUASHU-INTEGRATION-PROPOSAL.md v4. What remains in FEATURE-X scope is the chat-UI checkpoint mechanism (originally Session A4):

1. **A1 (DONE)** — Refs vendored to `skills/references/`. Animation / audio refs present but unintegrated (carry-forward to v4 §C1-C5).
2. **A2 (DONE in part)** — `creative-director-agent.md` updated with TIER 2 Presentations block + cta-manual.md reference + Animation TRIO trigger + Audio trigger. `agents/webdev-agent.md` reference table NOT YET inserted (carry-forward to v4 §C3 Animation Discipline section).
3. **A3 (PARTIAL)** — Junior Designer Workflow doctrine landed for presentations via 2-page showcase universal rule (workflow.md After-Phase-1-GATED). Standard 4-pass workflow doctrine for landing pages NOT YET inserted into webdev-agent.md.
4. **A4 (PENDING — primary remaining FEATURE-X work in this track)** — Build the chat-parser checkpoint sentinel + UI card + agent pause/resume. ~260 lines new code per Section 2.3 manifest. Independent of huashu doctrine work; can ship anytime.

### Track B — Portability (1 session)

1. Create `lib/cli-paths.ts` with `findBinary()` + `safePath()` + env-var overrides
2. Replace all 11 hardcoded path/PATH references to import from this module
3. Update `start.sh` banner to use `os.hostname()` + IP
4. Spin up Ubuntu 24.04 test VM, run end-to-end, fix anything that breaks
5. Add `CLAUDE_BIN` / `GEMINI_BIN` / `CHROMIUM_BIN` to `.env.example`

### Track C — Gating Productization (gated on first paying customer)

The 6-week (serial) or 4-week (parallel) gating cut. Build when a customer is committed.

1. **C1 — SEO Optimization Layer** (~1.5 weeks) — Per-page SEO panel, schema designer, sitemap/robots/redirects, publish-time validation, programmatic-SEO bulk generate. Spec: `FEATURE-X-SEO.md` (TBD when work starts).
2. **C2 — Multilingual Layer** (~2.5 weeks) — Language family model, hreflang generation, translation pipeline, language switcher, per-language sitemap. Spec: `FEATURE-X-MULTILINGUAL.md` (TBD).
3. **C3 — Blog (multilingual)** (~2 weeks) — Authoring loop + multi-language sync, both leveraging C1's per-page metadata and C2's family graph. Spec: `FEATURE-X-BLOG.md` (TBD).

### Track E — Supporting Productization (after Track C ships, customer-funded)

1. **E1 — AI-Overview audit tool** (~2–3 weeks) — Audit + remediation engine + Wikidata push + monthly LLM-citation tracking. Spec: `FEATURE-X-AIOVERVIEW.md` (TBD).
2. **E2 — Static-shadow layer** (~2 weeks) — Cloudflare Worker + dynamic rendering for hybrid-WP customers. Spec: `FEATURE-X-SHADOW.md` (TBD). Skip for greenfield OskarOS sites — Track C already outputs static HTML.

### Track D — Plan Cleanup (1 session)

1. Mark `MEMORY-SYSTEM-IMPLEMENTATION-PLAN.md` as superseded
2. Audit `ADVANCED-MODE-PLAN.md` Stages 1–16 against reality, write a brief "what's shipped" addendum
3. Audit `BRANDING-PLAN.md` Phase 1 status
4. Decide on `IMPLEMENTATION-PLAN-API-AGENT.md` — finish or formally drop API mode
5. Close out or migrate `ARCHITECTURE-REDESIGN.md`

---

## 7. Open Decisions for Ralph

Before any code touches:

1. **Track ordering** — do we run Track A and Track B in parallel (different sessions, independent files), or serialize?
2. **Junior Mode default** — confirmed OFF as default? Or ON for all new sessions, OFF for sessions that opt out?
3. **Productization gating** — Track C (the 3 gating features: SEO + Multilingual + Blog) is gated on first paying customer. Confirm that's the right gate, or do you want a v0 of any single piece (e.g. SEO panel only) ready to demo on spec?
6. **Productization sequence** — serial (~6 weeks) or parallel (~4 weeks) for Track C? Parallel needs more context-juggling; serial is cleaner if one engineer.
4. **Plan cleanup** — am I authorized to mark older plans as `[SUPERSEDED]` in their headers, or do you want to review each one first?
5. **Animation refs** — vendor all 5 in one session (~4–6 hours) or one at a time as motion vibes ship?

Pick and we move.

---

## 8. Files To Be Created / Modified (manifest, REVISED 2026-04-30)

### Already shipped on 2026-04-30 (no longer pending)
- `oskar-prototype/skills/references/cta-manual.md` — created (moved/broadened from `docs/CTA-MANUAL.md`)
- `oskar-prototype/skills/references/slide-decks.md` — matrix + format details + CANVAS UNLOCK + Classical/Interactive columns added
- `oskar-prototype/skills/references/workflow.md` — Phase 1-GATED rewritten; TWO-vibes rule + 2-page showcase universal rule added
- `oskar-prototype/agents/creative-director-agent.md` — TIER 2 Presentations block + cta-manual reference; SCRIPTS / ASSETS sections deck-related bullets consolidated
- `oskar-prototype/docs/CTA-MANUAL.md` — redirect-stubbed to live version

### Already exists, NOT requiring vendoring (originally planned at `agents/refs/`)
- `oskar-prototype/skills/references/workflow.md`
- `oskar-prototype/skills/references/verification.md`
- `oskar-prototype/skills/references/design-styles.md`
- `oskar-prototype/skills/references/tweaks-system.md`
- `oskar-prototype/skills/references/content-guidelines.md`
- `oskar-prototype/skills/references/design-context.md`
- `oskar-prototype/skills/references/animations.md`
- `oskar-prototype/skills/references/animation-best-practices.md`
- `oskar-prototype/skills/references/animation-pitfalls.md`
- `oskar-prototype/skills/references/cinematic-patterns.md`
- `oskar-prototype/skills/references/hero-animation-case-study.md`
- `oskar-prototype/skills/references/audio-design-rules.md`
- `oskar-prototype/skills/references/sfx-library.md`
- `oskar-prototype/skills/references/critique-guide.md`

### Pending in HUASHU-INTEGRATION-PROPOSAL.md v4 (NOT in FEATURE-X scope)
- Animation gate / discipline / direction / memory (v4 §C1-C4)
- Audio gate (v4 §C5)
- Cross-vibe coherence rule (v4 §C6)
- Quality bar 5-10-2-8 checklist (v4 §C7)
- Sage promotion path (v4 §C8)
- Cull list execution (v4 §C9-C10)
- BRANDING tab UI (v4 §A1)
- Scene-templates redistribution (v4 §A2)
- export-formats.md rename + content move (v4 §A3)
- Image slot vocabulary (v4 §A4)
- Content approach templates (v4 §B1)
- Per-format production guidance (v4 §B2)
- Interactive column rename (v4 §B3)

### Still pending in FEATURE-X scope

**New files**
- `oskar-prototype/lib/cli-paths.ts` — portability binary discovery
- `oskar-prototype/.env.example` — env-var overrides (or extend existing)
- `oskar-prototype/docs/FEATURE-X-SEO.md` (when Track C1 starts)
- `oskar-prototype/docs/FEATURE-X-MULTILINGUAL.md` (when Track C2 starts)
- `oskar-prototype/docs/FEATURE-X-BLOG.md` (when Track C3 starts)
- `oskar-prototype/docs/FEATURE-X-AIOVERVIEW.md` (when Track E1 starts)
- `oskar-prototype/docs/FEATURE-X-SHADOW.md` (when Track E2 starts)

**Modified files (portability — Track B)**
- `oskar-prototype/lib/webdev.ts` — import from `cli-paths.ts`
- `oskar-prototype/lib/bridge-process-manager.ts` — import from `cli-paths.ts`
- `oskar-prototype/lib/thumbnail-generator.ts` — import from `cli-paths.ts`
- `oskar-prototype/lib/sentinel-ti.ts` — drop `/Users/ralphlengler/...` for `process.cwd()`-relative path
- `oskar-prototype/app/api/claude-code/route.ts` — import from `cli-paths.ts`
- `oskar-prototype/app/api/webdev/route.ts` — import from `cli-paths.ts`
- `oskar-prototype/start.sh` — hostname/IP banner
- `oskar-prototype/start.command` — same

**Modified files (Junior Mode UI — Track A4)**
- `oskar-prototype/lib/chat-parser.ts` — checkpoint sentinel detection
- `oskar-prototype/components/ChatStream.tsx` (or equivalent) — checkpoint card UI
- `oskar-prototype/app/api/chat-stream/route.ts` — pause/resume on checkpoint
- `oskar-prototype/lib/agent-runner.ts` — pause/resume CLI subprocess support
- `oskar-prototype/agents/webdev-agent.md` — Junior Designer Workflow rules + sentinel format (still pending)

---

## 9. Testing Checklist

When work in each track lands:

**Track A (WebDev Foundations) — REVISED 2026-04-30**
- [x] Refs live at `skills/references/` (DONE — see Section 1 revision)
- [x] CD agent's Reference Library structure is in `creative-director-agent.md` (DONE — TIER 1/2/3 in place)
- [x] Matrix doctrine landed (DONE — `slide-decks.md` + `workflow.md` Phase 1-GATED)
- [ ] WebDev agent's Reference Library table is in `webdev-agent.md` (PENDING — carry-forward to v4 §C3 Animation Discipline)
- [ ] Build a fresh vibe with Junior Mode ON — does Pass 1 sentinel fire? Does the checkpoint card render? Does Continue resume the agent? Does Discuss pause it?
- [ ] Build a fresh vibe with Junior Mode OFF — current flow unchanged
- [ ] Build a presentation with the 2-page showcase rule — does WebDev produce 2 samples first, halt for confirmation, then batch?

**Track B (Portability)**
- [ ] `grep -r "/Users/ralphlengler" oskar-prototype/lib/ oskar-prototype/app/ oskar-prototype/components/` returns zero hits
- [ ] `grep -r "/opt/homebrew" oskar-prototype/lib/ oskar-prototype/app/ oskar-prototype/components/` returns zero hits (only `cli-paths.ts` allowed)
- [ ] Fresh Ubuntu 24.04 install boots OskarOS end-to-end, runs full discovery → vibe build → image gen → CEO selection
- [ ] `CLAUDE_BIN=/custom/path` env var is honored

**Track C (Productization) — when each module ships**
- [ ] Per-module test plan in the dedicated `FEATURE-X-*.md` sub-doc

**Track D (Plan Cleanup)**
- [ ] Each older plan has a clear status header (SHIPPED / SUPERSEDED / OPEN)
- [ ] Open items from older plans are pulled into Section 5 of this doc
- [ ] No plan in `docs/` is "live" without a clear owner

---

_End of FEATURE-X.md_
