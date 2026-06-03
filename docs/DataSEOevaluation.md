# SEO/GEO Ecosystem Evaluation for OskarOS

**Evaluated:** 2026-05-13 (Ralph + Jedi)
**Repos cloned to:** `OskarOS/external/{_eval-tier1,_eval-tier2,_eval-tier3,_eval-tier4}/`
**Scope:** 18 repos across Tier 1-4 of the Claude-Code SEO ecosystem
**Question:** What do OskarOS clients actually need from this stack, and from which "vendor" do we lift it?

---

## TL;DR — what OskarOS needs vs what's available

OskarOS makes brand sites for small businesses. For our clients, success = "more customers find us." That breaks down into four concrete needs. The ecosystem is over-supplied for everything else.

| OskarOS need | Best source | Integration shape |
|---|---|---|
| **Schema markup at build time** (JSON-LD for Organization, LocalBusiness, Article+Author, Product, etc.) | `zubair-trabzada/geo-seo-claude` (6 templates) + `AgriciDaniel/claude-seo` (more types) | **LIFT** the `.json` files; WebDev embeds in `<script type="application/ld+json">` per generated page |
| **llms.txt + robots.txt with AI crawler allowlist** at build time | `zubair-trabzada/geo-seo-claude` (generator + 14-crawler list) | **PORT** the generator logic to TS (~80 LOC); auto-emit from `CREATIVE-BRIEF.md` |
| **Citability scoring as a CD copy-review pass** | `zubair-trabzada/geo-seo-claude` (`scripts/citability_scorer.py`) + `aaron-he-zhu/seo-geo-claude-skills` (CORE-EEAT 80-item checklist) | **PORT** scorer to TS + lift the checklist as CD doctrine |
| **Post-launch GSC connection for the client** (track what queries surface the site) | `AminForou/mcp-gsc` (official MCP, 823 stars, active) | **INSTALL** as MCP server; client OAuth's their own GSC |
| **Brand-context snapshot during Discovery** (if client has existing URL) | `dataforseo/mcp-server-typescript` (official DataForSEO MCP, 196 stars) | **INSTALL** as MCP server; CD calls 2-3 endpoints |
| **Old-site crawl on migration** (preserve existing URLs/rankings) | `houtini-ai/seo-crawler-mcp` (Crawlee-based, self-contained) | **INSTALL** as MCP server; one-shot when replacing an existing site |

Everything else (content-production engines, marketing orchestrators, backlink databases, paid-ads cross-channel tools) is out of OskarOS's product scope. **Don't install. Don't port. Don't even read past the README.**

---

## How to read this doc

Each repo gets a single block: what it is (verified by reading source, not parroting Gemini's summary), stars+activity (the real numbers, not Gemini's rounded ones), and the OskarOS verdict (LIFT / INSTALL / IGNORE).

**LIFT** = take specific primitives (files, algorithms) into the OskarOS codebase. Doesn't run as a dependency.
**INSTALL** = wire as an MCP server in OskarOS's spawn config. Runs as a separate process.
**IGNORE** = skip entirely.

---

## Tier 1 — Big-community orchestrators

### `AgriciDaniel/claude-seo` · 6,481 ⭐ · last push 2026-05-11

**What it is:** Enterprise SEO orchestrator. 25 sub-skills + 18 sub-agents. Python-backed. Covers technical SEO, on-page, E-E-A-T, schema, GEO, local SEO, international, GSC + PageSpeed + CrUX + GA4 integrations. Strict architecture (5K-token skill limit, SSRF protection, parallel sub-agent fan-out).

**Verified:** Tools-package shape is real. The README claim of "9 distinct technical categories" maps to actual skill files. Schema templates are comprehensive (more JSON-LD types than `geo-seo-claude`).

**OskarOS verdict: LIFT (schema templates only). IGNORE everything else.**

Why: It's a tool for SEO consultancies running client audits. Our clients aren't consultancies. The orchestration framework, 18 sub-agents, GA4 integrations, PDF reports — irrelevant. BUT: their schema-markup library is broader than `geo-seo-claude`'s 6 templates. If we want LocalBusiness + Restaurant + Hotel + Dentist + LegalService variants pre-built, lift from here. Skim `skills/schema-*` for templates.

---

### `zubair-trabzada/geo-seo-claude` · 7,181 ⭐ · last push 2026-04-29

**What it is:** AI-search-first SEO pack. 13 slash commands + 5 sub-agents. Citability scoring, AI crawler audit (14+ bots), llms.txt generation, brand-mention scanning (YouTube/Reddit/Wikipedia/LinkedIn), schema templates. Cites Ahrefs Dec 2025 study (75K brands, YouTube correlation 0.737, brand-mentions 3× backlinks for AI visibility — directionally credible single-source).

**Verified:** Citability scorer is real Python (5-dimension scoring: answer block, self-containment, structural readability, statistical density, uniqueness). llms.txt generator works against any URL. Schema JSON-LD templates (6 types). AI crawler list real.

**OskarOS verdict: LIFT (primary GEO reference). The single most useful repo in the lot.**

What to lift:
- `scripts/citability_scorer.py` → port to TS as a CD copy-review tool (~150 LOC TS)
- `scripts/llmstxt_generator.py` → port to TS, fed by CREATIVE-BRIEF.md (~80 LOC)
- `scripts/brand_scanner.py` → port the platform-list + check logic (~120 LOC). Optional CD tool: "where does my brand show up across AI-cited platforms?"
- `schema/*.json` → 6 templates, lift as-is
- The AI crawler allowlist (GPTBot, ClaudeBot, PerplexityBot, etc.) → bake into the robots.txt every OskarOS site emits

Pre-cloned at `external/geo-seo-claude/` (you asked for `dataforseo-claude` originally but `geo-seo-claude` is what Gemini analyzed; both cloned).

---

### `TheCraigHewitt/seomachine` · 6,942 ⭐ · last push 2026-04-10

**What it is:** Programmatic content-production engine. 26 skills + 10 agents. Python-backed (NLTK, textstat, scikit-learn). Authors 2,000-3,000-word blog articles, publishes to WordPress with Yoast metadata, links internally, runs Flesch-Kincaid readability + keyword-density checks. Built for content-marketing teams scaling article output.

**Verified:** Yes — it really is a long-form-article factory.

**OskarOS verdict: IGNORE.**

Why: OskarOS doesn't make 2000-word blog articles. We make brand vibes (hero, identity, signature experience, ~5-10 sections). The seomachine pipeline is the opposite product. If a client wants ongoing blog content, they'd use this — not OskarOS. Different product, different surface.

---

## Tier 2 — Specialized diagnostics

### `aaron-he-zhu/seo-geo-claude-skills` · 1,592 ⭐ · last push 2026-04-28

**What it is:** Zero-dependency markdown skill pack. 20 skills + 16 commands. Implements two quantitative frameworks: **CORE-EEAT** (80-item checklist, 8 dimensions) for content quality, **CITE** (40-item checklist, 4 dimensions) for domain trust. Inter-skill handoff via "hot cache" passed in the central instruction file. Works across Claude Code, Cursor, Windsurf, Copilot, Kimi Code, Gemini CLI.

**Verified:** Zero Python/TS — pure markdown. The framework checklists are concrete, mathematical, opinionated.

**OskarOS verdict: LIFT (the checklists only).**

What to lift:
- The 80-item CORE-EEAT checklist → distill to a 10-20-item version specifically for OskarOS hero copy + body. Add to CD doctrine as a copy-review pass.
- The 40-item CITE checklist → less directly useful (domain trust signals = backlinks, age, authority — things OskarOS can't manufacture).

The "inter-skill handoff" architecture isn't relevant — OskarOS's MCP orchestrator already handles state.

---

### `houtini-ai/seo-crawler-mcp` · 13 ⭐ · last push 2026-04-16

**What it is:** MCP server. Self-contained crawler using Crawlee (5 parallel workers) + Better-SQLite3. Streams HTML/headers/links into local SQLite, then 25+ predefined SQL queries identify broken links, orphan pages, canonical mismatches, security header gaps, duplicate titles/descriptions/H1s, thin content. **No external API; everything local.**

**Verified:** Source confirms — TypeScript MCP server, Crawlee + better-sqlite3 deps, real SQL queries.

**OskarOS verdict: INSTALL (single-purpose: site migrations).**

Why: When a client comes to OskarOS to REPLACE an existing site, we need to know what URLs the old site has so we can preserve them via 301 redirects. Without this, switching from `oldsite.ch` to the OskarOS-built site nukes existing rankings. This crawler runs ONCE per migration, produces a URL inventory + content inventory, feeds into a redirect-map generation step.

Stars are low (13) but the scope is tight and the implementation is solid (Crawlee + SQLite is a sane choice). Single-maintainer risk; might want to fork if we depend on it.

---

### `AndreasH96/seo-geo-consultant` · 3 ⭐ · last push 2026-03-10

**What it is:** Plugin for Next.js + react-helmet-async stacks. Generates Metadata API code, Open Graph tags, schema markup with the "120-180 word per section" rule for AI extraction.

**Verified:** Yes — narrow scope, modern-JS-framework focus.

**OskarOS verdict: IGNORE today, MARGINAL future.**

Why: OskarOS-generated sites today are vanilla HTML/CSS, not Next.js. If we ever pivot to Next.js for premium clients, this is reference material. Not now.

---

### `ivankuznetsov/claude-seo` · 5 ⭐ · last push 2026-03-11

**What it is:** Ruby-backed content pipeline. "AI Humanization" module that scrubs detectable AI writing patterns (em-dash overuse, copula avoidance, sycophantic tone, inflated vocabulary — "pivotal," "testament," "delve") based on Wikipedia's AI Cleanup guidelines.

**Verified:** Yes — Ruby scrubber is real.

**OskarOS verdict: LIFT (the banned-phrase list only).**

The Ruby engine itself is overhead for a single feature. But the banned-phrase list IS valuable — fold into CD-PROMPTING.md's "voice doctrine" as a hard-no-words list ("pivotal," "testament," "leverage," "unlock," "seamless," "delve," "spearhead," "robust," "navigate the landscape," etc.). 5-minute lift. OskarOS already has anti-slop discipline in CD's prompting; this is a concrete word-list to add.

---

## Tier 3 — MCP servers + data providers

### `AminForou/mcp-gsc` · 823 ⭐ · last push 2026-04-30

**What it is:** Official-grade MCP server for Google Search Console. OAuth-based, secure, exposes 12+ GSC endpoints: impressions/clicks/CTR per query, URL inspection, indexing errors, sitemap submission, performance trends.

**Verified:** Python, real OAuth flow. The README also pushes a hosted paid version ($12/mo) but the open-source repo is fully functional.

**OskarOS verdict: INSTALL (post-launch client feedback loop).**

This is the missing piece for OskarOS's value prop. Today: we ship a site, the client never knows if it's working. With this: the client OAuth's their GSC, OskarOS surfaces "your site got 1,200 impressions for 'Coffee Neubau' last week, 80 clicks, position 4 average." Real numbers, ongoing visibility into whether the brand vibes are actually catching search traffic.

Per-client setup: client visits the OskarOS dashboard, clicks "Connect Google Search Console", OAuth's. Done.

823 stars + 120 forks + active April 2026 = healthy enough to depend on.

---

### `dataforseo/mcp-server-typescript` · 196 ⭐ · last push 2026-05-12

**What it is:** Official DataForSEO MCP server (TypeScript, native, by the DataForSEO team). Exposes their REST API: SERP data, keyword volume/CPC/competition, backlinks, on-page audit, domain analytics. Pay-as-you-go (~$0.001-0.30/call).

**Verified:** Yes — official, well-structured. Better than the community `dataforseo-claude` slash-command pack (also cloned at `external/dataforseo-claude/`).

**OskarOS verdict: INSTALL (Discovery anchoring) — if/when we want it.**

Same conclusion as my earlier evaluation: useful for Discovery context (snapshot of brand's current SERP presence, top SERP-competitors, content gap). Cost per real Discovery session: $0.05-0.15.

Trade-off vs the slash-command pack: this is the OFFICIAL TypeScript MCP server. We'd skip the Python pack and use this directly. Cleaner integration, type-safe, maintained by DataForSEO.

If we want DataForSEO at all → use THIS, not the community pack.

---

### `houtini-ai/seo-crawler-mcp` — covered above in Tier 2

---

### `jae-jae/g-search-mcp` · 263 ⭐ · last push 2025-06-14

**What it is:** Playwright-based Google search scraper. Runs N parallel headless browser searches, returns structured SERP data. Avoids DataForSEO costs by scraping directly.

**Verified:** TypeScript, Playwright dep, real. **Last push June 2025 — 11 months stale.**

**OskarOS verdict: IGNORE.**

Why: Scraping Google directly is unreliable (CAPTCHAs, IP blocks, ToS violations). Stale repo (no updates since June 2025). For OskarOS production use, pay DataForSEO instead — they handle the scraping legally + reliably + at scale, for ~$0.01-0.05 per call. Cheap enough to not bother building a hack.

---

### `SEO-Review-Tools/SEO-API-MCP` · 4 ⭐ · last push 2025-06-11

**What it is:** Bridge to SEO Review Tools' backlink database (claims 3.1T backlinks, 7B keywords).

**Verified:** Tiny stars (4), 12 months stale. Their data lake is real (commercial product); the MCP wrapper is incidental.

**OskarOS verdict: IGNORE.**

Backlink data isn't OskarOS's problem. Our clients are NEW brand sites — they won't have backlinks day one, and backlink-building isn't part of our value prop. If a client later wants enterprise SEO consulting, they'd use Ahrefs or this; not us.

---

### `Archie0125/a7seo-mcp` · 0 ⭐ · last push 2026-04-14

**What it is:** "Keyword discovery → article generation → CMS publishing" pipeline. Connects to Google Trends, Keyword Planner, optional paid sources.

**Verified:** 0 stars (Gemini ranked this #7 — clearly Gemini's ranking is not stars-weighted, but the project is unproven). Last push April 2026; single maintainer; tiny user base.

**OskarOS verdict: IGNORE.**

Different product (content production). Zero community = high abandonment risk. Skip.

---

### `SerpstatGlobal/serpstat-mcp-server-js` · 4 ⭐ · last push 2026-02-07

**What it is:** Official Serpstat MCP. Serpstat is a competitor to DataForSEO/Ahrefs in the SEO data SaaS space.

**Verified:** Yes, official from Serpstat. 4 stars = barely-used.

**OskarOS verdict: IGNORE (unless a client already uses Serpstat).**

DataForSEO is the more common provider. No reason to add a second one unless a specific client demands Serpstat.

---

### `OpenAnalystInc/10x-MM-Skill` · 5 ⭐ · last push 2026-03-15

**What it is:** Full marketing-team plugin (25+ skills, 7 agents, 37 MCP tools) wired to OpenAnalyst's hosted platform `10x.in`. Deploys HTML directly via JWT, manages tracking URLs via PATs.

**Verified:** Yes — but **requires their commercial hosted server** to function. 5 stars = solo project.

**OskarOS verdict: IGNORE.**

Requires lock-in to a third-party platform. We have our own deployment pipeline. Not relevant.

---

### `nowork-studio/toprank` · 2,054 ⭐ · last push 2026-05-10

**What it is:** GSC + Google Ads + Meta Ads MCPs in one bundle. Analyzes paid + organic together; finds wasted ad spend; suggests page-level fixes. Has a companion web app at `notfair.co` (sign-in, browser UI).

**Verified:** Yes — 2,054 stars is real. Active. Includes Python tooling for the analysis side. But: heavy commercial layer.

**OskarOS verdict: IGNORE for direct integration, REFERENCE for productization patterns.**

The cross-channel paid + organic analysis is outside OskarOS's scope (we don't run paid campaigns). But the productization pattern — "open-source CLI + companion web app + sign-in once + run audits in browser" — is exactly the shape OskarOS could grow toward for a self-serve tier. Reference material for product strategy, not integration.

---

## Tier 4 — Lightweight wrappers

### `boraoztunc/skills` · 35 ⭐ · last push 2026-05-13

**What it is:** Grab-bag of markdown skills: copywriting (Ogilvy-style), advertising, content strategy, competitor-analysis, animejs, analytics tracking, app-store screenshots, etc. ~20 unrelated skills, no orchestration.

**Verified:** Yes — bag of standalone skill files.

**OskarOS verdict: LIFT (copywriting + competitor-alternatives only, as reference).**

The `copywriting` and `competitor-alternatives` skills might have useful angles for CD prompting. Skim them for stylistic guidance. Don't depend on the repo.

---

### `aevans-eng/seo-skill` · 3 ⭐ · last push 2026-03-14

**What it is:** Lightweight SEO skill for static portfolio sites. 9-point HTML audit, no external deps.

**Verified:** Yes — single SKILL.md + assets. Very small scope.

**OskarOS verdict: IGNORE.**

Too small to bother with; what it does, OskarOS sites should already do at build time via the lifted schema/llms.txt/robots.txt logic.

---

## Pre-cloned (covered in detail in earlier evaluation)

### `zubair-trabzada/dataforseo-claude` · 64 ⭐

Slash-command pack wrapping the DataForSEO API. Same author as `geo-seo-claude`. **Verdict: skip in favor of the OFFICIAL `dataforseo/mcp-server-typescript` server above** — same data, cleaner integration, type-safe.

### `zubair-trabzada/geo-seo-claude` · 7,181 ⭐

Covered above. **Primary GEO reference for lifting primitives.**

---

## What we actually need — concrete WP shape

Three workpackages, each independently shippable, ordered by leverage:

### WP-XX1 — Build-time GEO craft + OskarOS Quality Score (lift from `geo-seo-claude` + `AgriciDaniel/claude-seo`)

Every OskarOS-generated site gets GEO-correct structure AND a measurable composite quality score that gates the build.

#### Part 1: Build-time craft

1. **JSON-LD schema** embedded in `<script type="application/ld+json">` based on business type. Templates lifted from `external/geo-seo-claude/schema/*.json` (Organization, LocalBusiness, Article+Author, SoftwareApplication, Product, WebSite) + `external/_eval-tier1/claude-seo-AgriciDaniel/` schema variants (Restaurant, Dentist, LegalService, etc.).
2. **`/llms.txt`** generated from CREATIVE-BRIEF.md (brand name, one-liner, key offerings, location, founder). Port `scripts/llmstxt_generator.py` to TS.
3. **`/robots.txt`** with AI crawler allowlist (14+ bots: GPTBot, ClaudeBot, PerplexityBot, etc.). Lift the bot list as a const.
4. **Citability-scored hero copy** as a CD copy-review pass. Port `scripts/citability_scorer.py` to TS as a CD-callable tool. Score = 0-100 across 5 dimensions; CD self-checks before committing copy.

#### Part 2: OskarOS Quality Score — the composite

Compute one number per built site. Persist to `.meta/quality-score.json` alongside the vibe HTML. Acts as build-time quality gate AND pre/post-launch delta metric for clients.

**Why we are not using the community pack's formula.** The SEO-consultancy composite from `zubair-trabzada/dataforseo-claude` (and similar tools) reads:

```
// SEO-consultancy composite — NOT what OskarOS uses
composite = 0.25 × keyword_score        // volume × difficulty opportunities
          + 0.25 × technical_score      // site-crawl issues found / total checks
          + 0.20 × competitive_score    // target_traffic / sum_top_10_traffic
          + 0.15 × content_score        // topical-cluster strength
          + 0.15 × authority_score      // referring-domain count, backlink quality
```

Four of its five inputs are wrong for OskarOS:
- **keyword_score** assumes per-page keyword optimization — we write brand copy, not keyword-targeted pages
- **competitive_score** measures a comparative position we don't directly improve at build time
- **content_score** rewards topical-cluster depth — that's content-marketing scope, not brand-site scope
- **authority_score** is backlinks — we cannot manufacture these at build time

We cannot gate-keep on metrics we don't influence.

**The OskarOS Quality Score, calibrated for what we actually deliver:**

```
// OskarOS Quality Score — calibrated for what we deliver
oskar_score = 0.30 × citability             // avg citability score of all hero/section copy
            + 0.20 × schema_completeness    // % of recommended JSON-LD types present + valid
            + 0.15 × crawler_readiness      // llms.txt valid + robots.txt allowlist + sitemap.xml
            + 0.15 × core_web_vitals        // LCP/CLS/INP via PageSpeed Insights → green/yellow/red 100/60/20
            + 0.10 × brand_distinctiveness  // Sentinel Ti verdict on voice-match to brief
            + 0.10 × accessibility          // alt-text coverage, contrast ratios, semantic HTML
```

Per-weight rationale:
- **30% citability** — THE GEO discipline; highest leverage single dimension
- **20% schema completeness** — entity-identification layer; binary (present/absent), smaller weight than graded citability
- **15% crawler readiness** — llms.txt + robots.txt + sitemap valid; binary signals
- **15% Core Web Vitals** — measurable at build via PageSpeed Insights API. LCP green (< 2.5s) = 100, yellow = 60, red = 20. Same for CLS + INP; average the three
- **10% brand distinctiveness** — reuses Sentinel Ti's existing critique radar (Philosophy / Hierarchy / Craft / Function / Originality, 0-10 each); averaged + scaled
- **10% accessibility** — axe-core or pa11y violation count; 0 = 100, scaled. WCAG AA is the floor

#### Output format — dashboard tile

Single tile in WP-XX3's dashboard. Composite at top; six dimension bars below. Score persists to `.meta/quality-score.json` for downstream reuse.

```
OskarOS Quality Score: 87 / 100
  Citability             94    ████████████████████░
  Schema completeness   100    █████████████████████
  Crawler readiness     100    █████████████████████
  Core Web Vitals       —      (v2: PageSpeed Insights API)
  Brand distinctiveness  80    ████████████████░░░░░
  Accessibility         —      (v2: axe-core wrapper)
```

**v1 ships with 4 measured dimensions + 2 stubbed.** CWV (PageSpeed Insights) and Accessibility (axe-core) add external infrastructure — both stubbed as "not yet measured" in the rubric, weights re-balanced so the 4 measured dimensions sum to 1.0. Honest UI: tile clearly labels the two stubs. Adding them later is a ~250 LOC follow-up, not WP-XX1 scope.

Re-weighted formula for v1 (4 dimensions actually computed):

```
// v1 — 4 measured dimensions, sum to 1.0
oskar_score_v1 = 0.40 × citability             // was 0.30 — boosted to cover dropped weights
               + 0.25 × schema_completeness    // was 0.20
               + 0.20 × crawler_readiness      // was 0.15
               + 0.15 × brand_distinctiveness  // was 0.10
```

v2 re-introduces CWV (0.15) and accessibility (0.10), rebalancing back to the original 6-dimension weights.

#### LOC budget breakdown

| Piece | LOC |
|---|---|
| Citability scorer (TS port from `geo-seo-claude`) | ~150 |
| llms.txt generator (TS port) | ~80 |
| robots.txt + AI crawler allowlist | ~50 |
| JSON-LD schema embedding logic | ~120 |
| WebDev build-step wiring | ~150 |
| **Part 1 subtotal — build-time GEO craft** | **~550** |
| Schema-completeness checker | ~30 |
| Crawler-readiness validator (3 boolean checks) | ~40 |
| Brand-distinctiveness average (reuses Sentinel Ti scores) | ~10 |
| Composite calculator + output structure | ~40 |
| Dashboard tile render component | ~80 |
| **Part 2 subtotal — score + dashboard tile** | **~200** |
| **WP-XX1 total** | **~750** |

#### Doctrine updates

- Add §"Build-time GEO craft" to `agents/webdev-agent.md` — WebDev's 4-step build-time check
- Add §"OskarOS Quality Score" to `agents/sentinel-ti.md` — Sentinel Ti's existing radar feeds the brand_distinctiveness dimension

**Client value:** every site is born AI-citable AND has a measurable quality score in the client dashboard. For clients replacing an existing site, score the OLD site for baseline; show pre/post-launch delta ("Your old site: 28/100 · OskarOS site at launch: 87/100"). Tangible, defensible, repeatable. No build-time gate in v1 — the score is informational/marketing-facing, not a deployment blocker.

### WP-XX2 — Discovery anchoring (install `dataforseo/mcp-server-typescript`)

When a brand URL appears in Discovery, CD fires 1-3 calls:

- `seo_quick(url)` — domain overview, top keywords, traffic estimate. ~$0.01-0.03.
- `seo_competitors(url)` — top 10 search-overlap competitors. ~$0.05-0.08.
- `seo_content_gap(url, competitor)` — what competitors rank for that this brand doesn't. ~$0.02/comparison.

**Effort:** ~150 LOC total — MCP-server wiring + 3 CD tool stubs + doctrine update. Install the MCP server in OskarOS's spawn config; add 3 tools to CD allowlist (BOTH gates: `mcp-server/tools.ts` + `lib/mcp-config.ts`, per INSTITUTIONAL-MEMORY's drift entry). Doctrine update: "auto-fire `seo_quick` only; the heavier two are CD-judgment calls."

**Cost:** $0.05-0.15 per real Discovery session. Free trial $1 = ~50 quick snapshots.

**Client value:** sharper first Discovery questions. CD walks in with category + competitor context.

### WP-XX3 — Post-launch GSC connection (install `AminForou/mcp-gsc`)

After site goes live, client connects their GSC. OskarOS surfaces:

- Impressions, clicks, CTR by query
- Which queries surfaced the brand
- Indexing errors / sitemap status
- Position trends over time

**Effort:** ~700 LOC total — ~300 MCP server wiring + ~400 dashboard UI + OAuth flow. The OAuth + UI is most of the work; MCP wiring is mechanical.

**Client value:** closes the loop. The site we built isn't a black box — they SEE traffic from day one of indexing. This converts a one-shot ship into an ongoing relationship anchor.

### WP-XX4 — Site-migration redirect map (install `houtini-ai/seo-crawler-mcp`)

When a client replaces an existing site:

1. Crawl the old domain → URL inventory + content fingerprints
2. Map each old URL to its closest match in the new OskarOS site
3. Generate `redirects.conf` (Nginx/Apache) or `_redirects` (Netlify/Vercel) file
4. Deploy with the new site

**Effort:** ~200 LOC total — MCP wrap + redirect-map generator + sitemap regen. Fork `houtini-ai/seo-crawler-mcp` to control upgrades; add `migrate_existing_site(oldUrl, newUrl)` CD tool.

**Client value:** clients with existing sites + existing rankings don't lose them on migration. Today: 30-90 day Google-ranking dip after redesign is the norm. With this: zero dip.

---

## What we IGNORE (and why)

| Repo | Why not |
|---|---|
| `TheCraigHewitt/seomachine` | Long-form-article factory. Different product. |
| `ivankuznetsov/claude-seo` | Content humanizer with Ruby dep. Lift the banned-phrase list only. |
| `OpenAnalystInc/10x-MM-Skill` | Requires their commercial hosted platform. Lock-in. |
| `nowork-studio/toprank` | Paid-ads cross-channel — outside scope. |
| `SEO-Review-Tools/SEO-API-MCP` | Backlink data, not our problem. |
| `Archie0125/a7seo-mcp` | 0 stars, content engine, abandoned-risk. |
| `SerpstatGlobal/serpstat-mcp-server-js` | Alternative SEO provider; redundant with DataForSEO. |
| `AndreasH96/seo-geo-consultant` | Next.js stack; we're not on it yet. |
| `aevans-eng/seo-skill` | Static-site portfolio scope; too small. |
| `boraoztunc/skills` | Mostly unrelated skill bag. Skim copywriting only. |
| `jae-jae/g-search-mcp` | Google scraping = unreliable + 11 months stale. Use DataForSEO instead. |

---

## Total integration scope, if we did everything

| WP | What lands | Effort (LOC) | Cost (per client) |
|---|---|---|---|
| WP-XX1 — Build-time GEO craft + Quality Score | Every site ships with schema + llms.txt + AI-crawler robots.txt + citability-scored copy + composite OskarOS Quality Score rendered as dashboard tile | ~750 | $0 (pure code) |
| WP-XX2 — Discovery anchoring | CD fires DataForSEO calls during Discovery | ~150 | $0.05-0.15/session |
| WP-XX3 — GSC client feedback | Client OAuth's GSC, sees traffic dashboard (also renders WP-XX1's quality tile) | ~700 | $0 (their OAuth, our hosting) |
| WP-XX4 — Migration redirect map | Old site crawled, redirects auto-generated | ~200 | $0 (local) |
| **Total** | **End-to-end SEO/GEO discipline baked into OskarOS** | **~1,800** | **~$0.05-0.15 per session (DataForSEO only)** |

---

## What's load-bearing for the OskarOS product story

**Without these integrations:** OskarOS = "beautiful brand sites."
**With these integrations:** OskarOS = "beautiful brand sites that get found in AI search + Google + analytics close the loop."

That's a different price point — possibly 2-3× — because the client gets *measurable customer acquisition*, not just an artifact.

The single biggest lever in the stack: **WP-XX1 (build-time GEO craft)**. Pure code, zero per-client cost, ships with every site. The other three are conditional add-ons (Discovery anchoring is optional; GSC is post-launch; migration is only when replacing an existing site).

WP-XX1 should land before any "we do SEO" claim is made in OskarOS sales pitch. Once it's in, the claim is justified, every client benefits automatically, and there's no per-session cost to manage.

---

## Risks + caveats

1. **Gemini's correlation numbers are single-source.** "YouTube correlation 0.737 with AI visibility" comes from the Ahrefs Dec 2025 study cited in `geo-seo-claude`'s docs. Directionally credible, but treat as best-available-data, not proven causation. Don't put exact percentages in client-facing copy.

2. **AI search is moving fast.** llms.txt is a proposed standard (Sept 2024, Jeremy Howard). It MAY become canonical (Anthropic, OpenAI already support it informally). It MAY get superseded by a different standard. Build the generator simple enough to regenerate to a different format if needed.

3. **Solo-maintainer repos.** `houtini-ai` (13 stars), `aevans-eng` (3 stars), `AndreasH96` (3 stars), `ivankuznetsov` (5 stars) — all single-maintainer. If we install any, fork it first to control upgrade path. Of the install candidates, `mcp-gsc` (823 stars) and `mcp-server-typescript-dfs` (196 stars, official) are safer.

4. **DataForSEO costs scale linearly.** $0.05-0.15 per Discovery session is fine at hundreds of sessions/month. At thousands, it adds up. Cache aggressively (snapshot data doesn't change daily; per-domain results can cache 24-48h).

5. **GSC OAuth has friction.** Client has to grant Google Search Console access to OskarOS. Some clients won't. The hosted version (`advancedgsc.com/mcp` at $12/mo) handles this; the open-source `mcp-gsc` makes the client do their own setup. UX trade-off.

6. **Don't merge GEO discipline with brand discipline at the wrong layer.** OskarOS's brand voice + the GEO format-suggestions should COEXIST, not COMPETE. CD's citability score is one input; brand voice is the other. If the two ever conflict (e.g., "your hero copy is too clever to be citable"), brand wins — we're not making AI-bait, we're making brand sites that happen to be AI-citable.

---

## Decision summary

| Action | Source | Output |
|---|---|---|
| **LIFT** | `zubair-trabzada/geo-seo-claude` | Citability scorer (TS port), llms.txt generator (TS port), AI crawler allowlist, schema templates |
| **LIFT** | `AgriciDaniel/claude-seo` | Additional schema templates (LocalBusiness variants, Restaurant, Dentist, etc.) |
| **LIFT** | `aaron-he-zhu/seo-geo-claude-skills` | CORE-EEAT 80-item checklist (distill to 10-20 for OskarOS copy review) |
| **LIFT** | `ivankuznetsov/claude-seo` | Banned-AI-phrase list for CD voice doctrine |
| **INSTALL** (MCP) | `AminForou/mcp-gsc` | Client GSC dashboard post-launch |
| **INSTALL** (MCP) | `dataforseo/mcp-server-typescript` | Discovery anchoring data |
| **INSTALL** (MCP, conditional) | `houtini-ai/seo-crawler-mcp` | Site-migration redirect map |
| **IGNORE** | Everything else | — |

Total scope: 4 LIFT operations + 3 MCP INSTALL operations + 1 conditional MCP for migrations + 1 composite quality-scoring tile. ~1,800 LOC of integration work. Result: OskarOS clients get the brand-site value they already pay for, PLUS measurable organic discovery from day one of launch, PLUS a single quality score visible in their dashboard.
