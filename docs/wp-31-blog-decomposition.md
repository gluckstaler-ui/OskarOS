# WP-31 — Blog (multilingual) — sub-decomposition

> The backlog entry in `feature-xx.md` carries the headline; this file holds the WP-31 sub-decomposition + cross-WP decisions, lifted from the prior `feature-xx.md` §14 (lines 692-748).

## Two distinct modes of blog work

1. **Template-design (one-time, per client)** — CD produces ONE blog master template as part of the **existing webpage Phase 4 build**. Not a separate track; not a separate set of vibes; not 4 templates. The master is a single HTML file with structural placeholders (`<div data-blog-post-list>`, JSON-LD slots, hreflang block, RSS link).
2. **Post-authoring (ongoing)** — adds individual posts against the locked template.

## Cross-WP decisions (Ralph 2026-05-13)

These were the [DECIDE-A..J] open questions in the prior plan; now answered:

- **[A] Filesystem layout** → `public/{sessionId}/blog/{lang}/post-{slug}.html` + `post-{slug}.md` sidecar at session-root-relative path. Subfolder-per-language scope. Plays well with WP-78's recursive readdir + Tier 0 sidecar hunt.
- **[B] Sidecar shape** → existing OskarOS `## Post Card` block. Reuses `matchField` parser. No YAML, no second parser path.
- **[C] Permalink rule** → slug-only, with uniqueness check at write time. `POST /api/blog/new` returns 409 on collision; auto-suffix `-2`/`-3` is opt-in.
- **[D] Index regen trigger** → hybrid: listing endpoint is dynamic (gallery endpoint extension reads sidecars at request time, no rebuild step); static export rebuilds the bundle on `POST /api/blog/publish`. Drafts never appear in either surface.
- **[E] Authoring surface** → Director Mode UI only. **API routes, not MCP tools** (blog actions are user-clicked buttons, not agent-callable).
- **[F]** N/A — there are NO 4 templates to choose between. ONE master template; index/tag/RSS are runtime-rendered.
- **[G]** N/A — blog inherits from the webpage track by definition; no separate blog discovery, no separate `start_blog_track` tool.
- **[J] Scheduled publish** → specced as future sub-WP, build when a client asks. `Status: scheduled` enum value reserved.

## Architectural baseline

Posts are HTML files (Option 1 of three architectures considered — markdown source and block-composition both rejected per the design-ceiling and editor-reuse constraints). Editor is the existing Director Mode. Listing reuses the gallery endpoint with a `parentDir` filter. AI augmentation goes through Next.js API routes that call CD/Sentinel Ti bridges, NOT through MCP tools (blog actions are user-initiated, not agent-callable). Deploy is single-server stage→deploy via local rsync to the webserver's document root — no external CDN, no GitHub Pages, no S3.

## WP-31a — Blog as a track: template-design lifecycle

**Architectural decision.** Blog is **NOT a separate track**. There are NO blog vibes, NO blog wireframes, NO blog descent-selection, NO blog design-system toolcards. CD produces **ONE** blog master template file (`public/{sessionId}/blog/_templates/post.html`) as part of the same Phase 4 build that produces the homepage. The blog inherits the website's locked design system entirely; the master template carries the page-level structural placeholders the runtime fills (`<div data-blog-post-list>`, JSON-LD slots, hreflang block, RSS link, language switcher, author block, social share row).

**Why no separate track.** The prior scope proposed 4 templates × 5 vibes through a full blog-specific Phase 1-5 cycle (~400 LOC of new schemas + build routes + toolcard validators). That's overkill for a deliverable that conceptually is "another page in the website." A blog visually matches the site; the master template falls out of the webpage track naturally. The index, tag, category, and RSS surfaces are NOT separate template files — they're rendered at request time by WP-31b's listing endpoint.

### Scope

- **CREATE `skills/references/blog-master-template.md`** (~60 LOC, doctrine artifact) — sibling of `skills/references/cd-design-system-and-multipage.md`. Defines the locked placeholder set: `<div data-blog-post-list>`, JSON-LD slots for Article + Person + ItemList + CollectionPage + BreadcrumbList, hreflang block placeholder, `<link rel="alternate" type="application/rss+xml">` in `<head>`, language switcher chrome, post-metadata zone, author block, social share row, reading-time `<span data-reading-time>`.
- **CD doctrine update** (`agents/creative-director-agent.md`, ~30 LOC delta) — TIER 2 pointer + Phase 4 trigger: when discovery surfaces "the customer wants a blog," CD's Phase 4 brief explicitly includes `_templates/post.html` as a deliverable alongside the homepage HTML, **with an explicit `READ skills/references/blog-master-template.md` instruction**.
- **WebDev doctrine update** (`agents/webdev-agent.md`, ~20 LOC delta) — TIER 2 pointer + build instruction.
- **No track enum change.** No additions to `present_design_directions`, `present_descent_selection`, `present_design_system`, `present_image_strategy`.
- **No new build route.** Existing webpage routes handle it.
- **No new types or validators.** The file is just another HTML output of the webpage Phase 5 build.

**Files affected.**
- `skills/references/blog-master-template.md` (NEW, ~60 LOC)
- `agents/creative-director-agent.md` (~30 LOC delta)
- `agents/webdev-agent.md` (~20 LOC delta)

**Dependencies.** Existing webpage track Phase 4 / Phase 5 build infrastructure (already shipped).

**Risk.** Low. Doctrine-only update; no code changes.

**LOC estimate.** ~110 LOC.

## WP-31b..31g — Sub-WPs (overview)

The full authoring + listing + AI + multilingual + deploy chain breaks into:
- **31b** — `+ New Post` UI in Director Mode + markdown editor
- **31c** — Listing endpoint (extends gallery with `parentDir` filter)
- **31d** — AI augmentation: cover-image gen, slug suggest, excerpt draft (via Next.js routes calling CD/Sentinel Ti bridges)
- **31e** — Multilingual sync (rides on WP-30 multilingual layer)
- **31f** — Publish + deploy (local rsync to webserver document root)
- **31g** — RSS + tag/category pages (runtime rendering)

Total estimate: ~2 weeks across the umbrella. Each sub-WP is independently revertable; together they deliver the customer offer line "blog they can post into in 20 minutes."
