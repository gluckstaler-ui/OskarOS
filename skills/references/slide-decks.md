# Presentations: 20 categories × 9 formats

This file is the production spec for ALL presentation work in OskarOS — slide decks, scrollytelling pages, dashboards, interactive modules, gallery showcases, anything that's not a marketing landing page. The workflow that gets you here lives in `workflow.md` (Phase 1-GATED, Steps A–D). This file picks up after Step A (category + format chosen) and Step B (PowerPoint editability resolved) and tells you HOW TO BUILD.

> **⚠️ HTML is the base, PDF/PPTX are derivatives.** No matter the final delivery format, the artifact is FIRST built as HTML — it is the "source." PDF/PPTX are one-line-command snapshots exported from HTML. Verified 2026-04-22 (moxt brochure): after 13 HTML slides + index.html, `export_deck_pdf.mjs` exported PDF in one line, zero edits.

---

## The 20-category × 9-format matrix

Every presentation OskarOS produces is one of 20 categories, expressed in one or more of 9 formats. Step A of Phase 1-GATED (`workflow.md`) selects both. The matrix is the spine.

### The 9 formats

| Format         | What it is                                                  |
|----------------|-------------------------------------------------------------|
| Slides         | Paginated browser deck. ←/→, fullscreen.                    |
| Canvas         | Open-web non-paginated container.                           |
| Scrollytelling | Scroll-coupled narrative.                                   |
| 3D             | WebGL / Three.js / GLTF / WebXR.                            |
| Dashboard      | Real-time data UI. WebSocket / D3 / drill-down.             |
| Live           | Synchronous interactive — polls, REPL, audience input.      |
| Timeline       | Sequential / chronological progression.                     |
| Interactive    | Branching modules, quizzes, state-tracked exercises.        |
| Gallery        | Multi-output showcase wall. 10+ tiles in CSS-3D-tilted perspective. Timeline-driven animation (corner convergence / ripple / pan / focus overlay). Apple product-page lineage. |

**PowerPoint editability** is an export sub-branch under Slides only — not a ninth format. Honored via the 4 hard constraints in `export-formats.md` (see "PowerPoint export" section below).

### The 20 categories

| #  | Category               | Format                                   | Primary Objective       | Content Approach                  | Classical Schools                | Interactive Schools                       |
|----|------------------------|------------------------------------------|-------------------------|-----------------------------------|----------------------------------|-------------------------------------------|
| 1  | Investor Pitch         | Slides                                   | Secure Funding          | Problem-first                     | Pentagram / IA / Build           | Active Theory / Locomotive / Stamen       |
| 2  | Product Launch         | Slides / Canvas / Scrollytelling / Gallery | Market Excitement     | Hero's Journey                    | Pentagram / Sagmeister / Hara    | Active Theory / Resn / Locomotive         |
| 3  | Sales / Capabilities   | Slides (Modular)                         | Conversion              | Problem-Solution-Benefit          | Pentagram / Build / Brockmann    | Active Theory / Locomotive / Field.io     |
| 4  | Corporate Board        | Dashboard                                | Decision-Making         | Conclusion-first (Pyramid)        | IA / Fathom / Pentagram          | Active Theory / Stamen / Territory        |
| 5  | Educational / Training | Interactive / Slides / Timeline          | Knowledge Transfer      | Sequential / Active               | IA / Brockmann / Hara            | Lieberman / Locomotive / Active Theory    |
| 6  | Technical / Scientific | Slides (Live-Logic) / Live               | Specialized Education   | Explanation Model                 | IA / Brockmann / Fathom          | Lieberman / Field.io / Kwok               |
| 7  | Marketing Portfolio    | Scrollytelling / Gallery                 | Brand Awareness         | Situation-Opportunity-Resolution  | Sagmeister / Takram / Fathom     | Locomotive / Active Theory / Field.io     |
| 8  | Project Proposal       | Timeline / Slides                        | Alignment               | Goal-Plan-Achievement             | Pentagram / Build / Brockmann    | Locomotive / Active Theory / Field.io     |
| 9  | Status Update          | Dashboard                                | Tracking                | What-So What-Now What             | IA / Fathom / Brockmann          | Active Theory / Stamen / Territory        |
| 10 | Interactive Webinar    | Live / Slides                            | Engagement              | Synchronous Conversation          | IA / Pentagram / Build           | Lieberman / Active Theory / Field.io      |
| 11 | Elevator Pitch         | Slides (Micro)                           | Pique Interest          | Hook-Problem-Solution             | Pentagram / IA / Brockmann       | Locomotive / Active Theory / Field.io     |
| 12 | Case Study             | Scrollytelling                           | Social Proof            | Success Story Narrative           | Sagmeister / Takram / Fathom     | Locomotive / Active Theory / Field.io     |
| 13 | Business Strategy      | Canvas                                   | Strategic Buy-in        | SCQA                              | IA / Pentagram / Brockmann       | Active Theory / Field.io / Locomotive     |
| 14 | Employee Induction     | Timeline / Slides / Interactive          | Culture Integration     | Welcome-Path-Training             | Hara / Brockmann / Build         | Locomotive / Active Theory / Lieberman    |
| 15 | Financial Report       | Dashboard / Scrollytelling               | Transparency            | Performance-Forecast              | IA / Fathom / Brockmann          | Active Theory / Stamen / Locomotive       |
| 16 | Partnership Pitch      | Slides                                   | Alliance Synergy        | Mutual Benefit                    | Pentagram / Build / Brockmann    | Active Theory / Locomotive / Field.io     |
| 17 | Product Demo           | 3D / Canvas / Scrollytelling / Gallery   | UX Proof                | Show-Don't-Tell                   | Sagmeister / Pentagram / Hara    | Active Theory / Resn / Locomotive         |
| 18 | Conference Talk        | Canvas / Slides                          | Thought Leadership      | Narrative Arc                     | Pentagram / IA / Brockmann       | Lieberman / Field.io / Locomotive         |
| 19 | Interactive One-Pager  | Scrollytelling                           | Rapid Awareness         | Problem-Solution Snapshot         | Sagmeister / Takram / Fathom     | Locomotive / Active Theory / Resn         |
| 20 | Sponsorship Proposal   | Slides                                   | Value Exchange          | Transactional ROI                 | Pentagram / Build / Brockmann    | Active Theory / Locomotive / Territory    |

Sub-modes in parentheses (Modular / Live-Logic / Micro) are configuration profiles for the parent format — features to enable inside Slides architecture, not new formats.

**School recommendations are substrate-typed, not register-typed.** A school's substrate (per `design-styles.md` Style × Medium table) determines which column it lives in:

- **Classical substrate** (typography / grid / restraint / published artifact): Pentagram, IA, Fathom, Jetset, Brockmann, Build, Sagmeister, Takram, Hara, Boom.
- **Interactive substrate** (motion / data-as-form / code / canvas / cartography): Stamen, Locomotive, Active Theory, Field.io, Resn, Lieberman, Kwok, Thorp, Territory, Neo Shen.

---

## Canvas dimensions: default, never locked

HTML decks are canvas-independent by design. The default ASSUMPTION for paginated HTML5 Slides is **16:9 True HD (1920×1080)** — that's what publication templates anchor to. **It is never a hard CSS constraint.**

What "never locked" means:

- DON'T write `body { width: 1920px; height: 1080px }` in `shared/tokens.css` or anywhere globally.
- DON'T inline `width: 1920px; height: 1080px` on slide containers.
- DO let the deck-stage runtime (or aggregator iframe) handle scale and letterbox at viewport time — that IS its job.
- DO use CSS variables (`--canvas-width: 1920px`, `--canvas-height: 1080px`) as defaults that can be overridden per deck or per slide.

Why this matters: a deck the user wants for Instagram (1080×1080), an IR microsite (1280×720), or a theater projection (3840×2160) inherits the same architecture without rebuild. Hard-locking the canvas in CSS means rebuilding for every off-default delivery.

**The one legitimate canvas lock** is PowerPoint editability (Slides format only, Step B = YES). When `html2pptx.js` is the export target, the body must be `960pt × 540pt` (LAYOUT_WIDE) — see "PowerPoint export" section below. This is the only time a hard CSS dimension is correct, because the converter math depends on it.

For all other formats (Canvas / Scrollytelling / 3D / Dashboard / Live / Timeline / Interactive), the canvas IS the viewport. Use responsive layouts. No fixed dimensions.

---

## Format details

### Slides — paginated browser deck

`index.html` + `slides/*.html` aggregator (multi-file, default for ≥10 slides), or single-file `<deck-stage>` with `<section>` slides. Keyboard nav (←/→/Home/End/number keys), fullscreen presenting, one slide at a time.

- Tech ceiling: Canvas API for visualizations, D3 for live data, highlight.js for code, LaTeX for math, embedded video/audio.
- Templates: see "Publication grammar template" below; `scene-templates.md` Template 4 (16:9 1920×1080) for content-density anchor.
- Export: PDF via `export_deck_pdf.mjs` (vector, 100% fidelity); editable PPTX via `html2pptx.js` IF the 4 constraints from `export-formats.md` are honored from line one.
- Sub-modes: **(Modular)** swap-in modules per audience; **(Live-Logic)** embedded REPL cells; **(Synchronous)** live-poll embeds; **(Micro)** mobile-first 3–5 slides; **(High-Perf)** Canvas/SVG-rendered visualizations for big-screen.

### Canvas — open-web non-paginated container

Free-layout HTML page. No `←/→`, no slide pagination. Audience scrolls or interacts. The "deck" IS a webpage.

- Tech ceiling: anything the web can do — CSS gradients, web components, complex SVG, animation libraries.
- Templates: `scene-templates.md` Template 6 (landing page) as base; section-based with sticky chapters for narrative.
- Export: lives on the web. PDF capture is screenshot-quality only. No PPTX path.
- Canvas vs Scrollytelling: Canvas is a container; Scrollytelling is a Canvas with scroll-coupled narrative beats. Discrete chapters revealing on scroll → Scrollytelling. Single composed view → Canvas.

### Scrollytelling — scroll-coupled narrative

Section-by-section reveal as the audience scrolls. Sticky chapters, parallax, scroll-triggered animations. Distinct from Canvas because the timeline is enforced by scroll position.

- Tech ceiling: Intersection Observer, GSAP ScrollTrigger, sticky/parallax layouts.
- Templates: hero + chaptered scroll sections; full-bleed cinematic intro + scrolling story.
- Export: lives on the web.

### 3D — WebGL / Three.js / GLTF / WebXR

Hardware-accelerated 3D. Rotatable models, immersive scenes, AR placement.

- Tech ceiling: Three.js / Babylon.js engines; GLTF / USDZ models; WebXR for AR.
- **Asset-dependent**: a clean GLTF gets you Apple-tier rendering. A SketchUp OBJ does not. Validate the asset before promising the experience.
- Templates: full-bleed 3D viewer + caption rail; product hero with rotation interaction.
- Export: lives on the web. Snapshot renders are screenshot-only.

### Dashboard — real-time data UI

Persistent connection to live or near-live data. KPI cards, drill-down panels, filter rails. Click-to-interrogate.

- Tech ceiling: WebSockets / Server-Sent Events / Next.js API routes; D3 for charts; user auth + access scoping.
- Data sourcing: JSON the user edits → trivial. CSV the user drops → easy. REST endpoint they own → easy. Live ERP / Salesforce → out of scope for OskarOS.
- Templates: card grid + chart panel + filter rail; KPI hero + drill-down section.
- Export: snapshot PDF only. The live dashboard IS the artifact.

### Live — synchronous interactive

Real-time audience input. Live polls, live code execution, live Q&A.

- Tech ceiling: third-party services (Mentimeter / Kahoot / Slido) embedded; OR Next.js API routes with WebSocket for OskarOS-native polling.
- Templates: poll widget + result chart; REPL cell + output panel; Q&A queue + answer reveal.
- Export: a static record is possible; the LIVE part is ephemeral.

### Timeline — sequential / chronological progression

Step-by-step or chronological. Audience moves through phases; format enforces order.

- Tech ceiling: medium. State persistence via localStorage; gantt libraries for project plans; phase-marker UI.
- Templates: vertical timeline with milestones; horizontal gantt; phase-card progression.
- Export: PDF (linear) or HTML (interactive).

### Interactive — branching modules, quizzes, state-tracked exercises

H5P-style. Hotspots, quiz sets, drag-drop, branching scenarios. State persists across sessions.

- Tech ceiling: H5P framework specifically (carries its own runtime), OR custom branching with localStorage state. Custom branching ships fast; H5P is a framework dependency.
- Templates: quiz card; branching scenario tree; hotspot image; drag-drop sequence.
- Export: lives on the web. State doesn't survive PDF.

### Gallery — multi-output showcase wall

10+ tiles arranged in a CSS-3D-tilted grid. Timeline-driven animation (no scroll, no pagination — `render(t)` reads timestamp, writes all elements). Five named animation patterns: corner convergence, selected zoom, ripple expand, sinusoidal pan, focus overlay. Apple product-page + claude.ai/design hero lineage. Battle-tested on huashu-design release hero v5.

- **Trigger criteria.** Use Gallery when: 10+ real outputs to display simultaneously; audience is professional and craft-sensitive; the vibe goal is "restrained, exhibition-like, refined"; focus + overview must coexist. Don't use it for single-product spotlight, emotion-driven narrative, or small-screen vertical (the tilt gets muddy).
- **Tech ceiling.** Pure CSS perspective (rotateX 14deg / rotateY -10deg / rotateZ -2deg, perspective 2000-2800px). No WebGL — the 3D is faked via CSS transform. Timeline runtime is `requestAnimationFrame` reading a single `render(t)` function with derived state.
- **Templates.** Gallery has its own grammar — full doctrine in `skills/references/apple-gallery-showcase.md`. Visual tokens (Apple gray `#F5F5F7` + Claude terracotta `#D97757` + 3-typeface stack), floating-card unit (14px radius + two-tier box-shadow + 1px hairline border), 3D tilted canvas (8-column grid, 4320×2520px canvas), 2×2 four-corner convergence, 5 animation patterns, timeline architecture skeleton, craft details (SVG fractalNoise, corner brand mark, brand wordmark with `letter-spacing: -0.045em`).
- **Export.** Lives on the web. The animation is the artifact. Snapshot screenshots lose the soul.
- **Failure modes.** Cards without shadow → looks like PPT. Only rotateY (no rotateZ) → tilt feels cheap. setTimeout/CSS-keyframes loops → pan janky. Reused thumbnail in focus overlay → text unreadable. Pure `#F5F5F7` background → feels empty (needs SVG fractalNoise at 0.5 opacity). Inter-only typography → feels too "internet" (needs Serif CN+EN + mono for the 3-stack publication tone).
- **Categories.** Primary fit: #2 Product Launch (system launch with multiple capabilities), #7 Marketing Portfolio (canonical portfolio pattern), #17 Product Demo (skill capability demo with 10+ outputs). Don't reach for Gallery if the brief has fewer than 10 outputs to display.

---

## PowerPoint export (Slides only) — doctrine

PowerPoint editability is the only sub-branch of Slides that requires upfront discipline — every other format and sub-mode is HTML-native. Resolved at Step B of Phase 1-GATED.

### The doctrine in three rules

1. **If editable PowerPoint is needed, write the HTML under the 4 hard constraints from line one.** Default high-visual-freedom HTML has a <30% pass rate when fed straight into `html2pptx`. Retrofitting costs 2–3 hours per deck.
2. **"HTML presenting AND editable PPTX" is not a hybrid** — PPTX-compliant HTML natively presents fullscreen. No extra cost.
3. **"PPTX AND animations / web components" is a real conflict.** Tell the user: pick one. Don't sneak through with hand-written pptxgenjs (permanent maintenance debt).

### The 4 hard constraints (memorize the rule, look up the details)

1. body fixed at `960pt × 540pt` (matches `LAYOUT_WIDE`, 13.333″ × 7.5″, NOT 1920×1080px)
2. all text inside `<p>` / `<h1>`–`<h6>` / `<ul>` / `<ol>` (no bare text in div)
3. text tags carry no background/border/shadow on themselves (move to outer div)
4. no CSS gradient, no web components, no decorative complex SVG, no `background-image` on div (use `<img>`)

### Mechanics, examples, common errors, fallback flow

→ See `export-formats.md` Section 7 for the full PPTX export mechanics: HTML template skeleton, common errors cheat sheet, basic workflow, fallback flow when PPTX is requested AFTER the HTML is written, and the "why these constraints aren't bugs but physics" explanation.

### Emergency salvage (PPTX requirement discovered late)

Recommended order:

1. **Export PDF first** — visuals 100% preserved, cross-platform, recipients can view/print. If the actual need is "presenting/archiving," PDF wins.
2. **Rewrite an editable HTML version** using the visual draft as blueprint → export to PPTX. Preserves color/layout/copy decisions; sacrifices gradients, web components, complex SVG.
3. **Do NOT hand-rebuild via pptxgenjs first reaction.** That's last-resort fallback.

Full salvage flow at `export-formats.md` Section 7 ("Fallback: Existing Visual Mockup, but the User Insists on Editable PPTX").

---

## 🛑 Before batch production: showcase pages BEFORE filling the rest

Showcase discipline applies twice in the keynote workflow, with different pairings each time. Both layers come from `workflow.md` § "After Phase 1-GATED" — this section gives the Slides-specific elaboration.

### Phase 2 (Junior Pass): 3-slide sample per vibe — title + data-dense + quote

Before any full deck is built, CD specs 5 short vibes and `build_all_vibes(slug, kind='keynote-junior')` produces **3 sample slides per vibe** (15 slides total across 5 vibes). The triplet is fixed:

1. **Title / hero slide** — establishes the masthead, type stack, and dominant compositional move.
2. **Data-dense slide** — exposes information-density discipline (table, chart, multi-column block, KPI grid).
3. **Quote / silence slide** — exposes whitespace discipline (single-line type with generous air, or a centered pull-quote).

These three are the smallest set that shows hierarchy / density / whitespace simultaneously. A 2-slide showcase (title + content) misses density-vs-silence, which is 70% of the keynote design problem. Locked 2026-05-07.

User reacts to the 15-slide moodboard via the universal user-input textarea on the Moodboard ToolCard. Their reaction drives Phase 3 specs.

### Phase 3 (Vibes): 2-page showcase per vibe — cover + mid-content

Phase 3 narrows to 2 full-deck builds (Editorial + Interactive, both school-anchored — see `workflow.md` Rule 2). Each full-deck build still follows the moxt-brochure-tested 2-page showcase discipline INSIDE the vibe before batching the rest.

**The Slides showcase principle inside Phase 3:** pick the two pages with the most distinct visual structures. If those two pass = all in-between states will pass.

| Deck type | Recommended showcase combo |
|-----------|---------------------|
| B2B brochure / product launch | Cover + content page (philosophy/emotion page) |
| Brand launch | Cover + product feature page |
| Data report | Big-data hero page + analysis-conclusion page |
| Tutorial / coursework | Chapter cover + concrete knowledge-point page |
| Investor pitch (12-15 slides) | Cover + the strongest single moment in the deck (the "47-0 streak" slide) |
| Banker due-diligence (30-40 slides) | Cover + a typical content page WITH financial table density |
| Conference talk (20-30 slides) | Cover + the punchline slide (the slide the talk earns) |

**Why this matters specifically for Slides:** verified 2026-04-22 on the moxt brochure — writing 13 pages straight to the end and hearing "wrong direction" = rework × 13. Doing 2 showcase pages first = rework × 2. Once visual grammar is fixed inside the vibe, the decision space for the remaining N pages narrows sharply.

### Why two showcase layers, not one

The Phase 2 triplet is brand-direction discovery — testing which visual register the brand can carry across hierarchy/density/silence. The Phase 3 pair is grammar-locking inside an already-chosen direction — testing whether the cover and a typical content page agree on masthead/type/spacing rules. They serve different decisions and shouldn't be collapsed.

---

## 📐 Publication grammar template (moxt-tested, reusable)

Suits B2B brochure / product launch / long-report decks. Each page reuses this structure = 13 pages with completely consistent visuals, 0 rework.

### Per-page skeleton

```
┌─ masthead (top strip + horizontal line)──────┐
│  [logo 22-28px] · A Product Brochure                Issue · Date · URL │
├──────────────────────────────────────────┤
│                                          │
│  ── kicker (green short bar + uppercase label) │
│  CHAPTER XX · SECTION NAME                 │
│                                          │
│  H1 (Chinese Noto Serif SC 900)              │
│  Key words separately in brand primary       │
│                                          │
│  English subtitle (Lora italic, subheading)  │
│  ─────────── divider ──────────              │
│                                          │
│  [body content: two-column 60/40 / 2x2 grid / list] │
│                                          │
├──────────────────────────────────────────┤
│ section name                     XX / total │
└──────────────────────────────────────────┘
```

### Style conventions (copy directly)

- **H1**: Chinese Noto Serif SC 900, size 80–140px depending on info volume; key words separately on brand primary (don't pile color all over)
- **English sub**: Lora italic 26–46px; brand signature words (e.g. "AI team") bold + primary italic
- **Body**: Noto Serif SC 17–21px, line-height 1.75–1.85
- **accent highlight**: in body, key words bolded in primary, no more than 3 per page (more loses anchoring)
- **Background**: warm cream #FAFAFA + extremely subtle radial-gradient noise (`rgba(33,33,33,0.015)`) for paper feel

### The visual lead must vary

13 pages all "text + one screenshot" is too monotonous. **Rotate the visual-lead type per page**:

| Visual type | Suitable section |
|---------|---------------|
| Cover typography (huge type + masthead + pillar) | Home / chapter cover |
| Single-character portrait (oversized single momo, etc.) | Introducing a single concept/character |
| Multi-character group / avatar cards in a row | Team / user case |
| Timeline cards progressing | Showing "long-term relationship" / "evolution" |
| Knowledge graph / connected nodes | Showing "collaboration" / "flow" |
| Before/after comparison cards + middle arrow | Showing "change" / "difference" |
| Product UI screenshot + outlined device frame | Concrete feature display |
| Big-quote (half-page big text) | Mood page / problem page / quote page |
| Real avatar + quote card (2×2 or 1×4) | User testimonial / use scenarios |
| Big-text closing + URL pill button | CTA / closing |

---

## ⚠️ Common pitfalls (doctrine layer)

For export-mechanics pitfalls (Chromium emoji rendering, ESM module resolution, font-loading races during PDF/PPTX export), see `export-formats.md` Section 8. The pitfalls below are doctrine-layer — they apply to the slide as a designed artifact, regardless of export path.

### 1. Information density imbalance: content page stuffed too full

The first version of moxt's philosophy page used 2×2 = 4 paragraphs + bottom 3 tenets = 7 blocks of content, crowded and repetitive. Switched to 1×3 = 3 paragraphs and the breathing room came right back.

**Rule**: keep each page to "1 core message + 3–4 supporting points + 1 visual lead"; over that, split to a new page. **Less is more** — the audience looks at a page for 10 seconds; giving them 1 memory point beats 4 every time.

---

## Architecture & export — see `export-formats.md`

The mechanics of building and exporting a Slides deck — single-file vs multi-file architecture, the `<deck-stage>` web component CSS trap, slide labels, speaker notes, PDF export pipelines, editable PPTX export with the 4 hard constraints, and common export pitfalls — all live in `export-formats.md`. That file is the sibling reference for "how do I build and ship this deck once the doctrine has decided what it should be."

**Read order:**
1. This file (`slide-decks.md`) — pick category + format, lock content approach, design system, 2-page showcase
2. `export-formats.md` — pick architecture (single-file vs multi-file), build under the constraints, export to PDF / PPTX

The export-formats sections at-a-glance:

| Section | Covers |
|---|---|
| §1 Architecture decision | Single-file vs multi-file decision tree |
| §2 Path A (multi-file) | `index.html` + `slides/*.html` aggregator pattern |
| §3 Path B (single-file deck-stage) | `<deck-stage>` web component, the script-position constraint, the CSS display trap |
| §4 Slide labels | Counter labels, slide numbering starts at 1 |
| §5 Speaker notes | Off by default; `<script type="application/json">` pattern |
| §6 PDF export | `export_deck_pdf.mjs` (multi-file) and `export_deck_stage_pdf.mjs` (single-file) |
| §7 PPTX export | `html2pptx.js` + 4 hard constraints + 960×540pt body |
| §8 Export pitfalls | Chromium emoji, ESM resolution, font-loading races |
| §9 Common questions | Architecture troubleshooting |
| §10 When to pick which | PDF vs PPTX vs HTML-only |

## Slide design patterns

### 1. Build a system (required)

After exploring the design context, **state out loud the system you'll use**:

```markdown
Deck system:
- Background colors: at most 2 (90% white + 10% dark section divider)
- Type: display uses Instrument Serif, body uses Geist Sans
- Rhythm: section dividers use full-bleed color + white text, regular slides use white bg
- Imagery: hero slide uses full-bleed photo, data slide uses chart

I'll work to this system, tell me if anything's wrong.
```

After user confirms, proceed.

### 2. Common slide layouts

- **Title slide**: solid background + huge title + subtitle + author/date
- **Section divider**: colored background + section number + section title
- **Content slide**: white bg + title + 1–3 bullet points
- **Data slide**: title + big chart/number + brief caption
- **Image slide**: full-bleed photo + small bottom caption
- **Quote slide**: whitespace + giant quote + attribution
- **Two-column**: left/right comparison (vs / before-after / problem-solution)

A deck uses at most 4–5 layouts.

### 3. Scale (saying it again)

- Body min **24px**, ideal 28–36px
- Title **60–120px**
- Hero text **180–240px**
- Slides are seen from 10 meters away — make text big enough

### 4. Visual rhythm

A deck needs **intentional variety**:

- Color rhythm: mostly white bg + occasional colored section divider + occasional dark interlude
- Density rhythm: a few text-heavy + a few image-heavy + a few quote-with-whitespace
- Type-size rhythm: normal titles + occasional giant hero text

**Don't make every slide look identical** — that's a PPT template, not design.

### 5. Spatial breathing (mandatory for data-dense pages)

**The trap beginners trip on most**: stuffing every available bit of info into one page.

Information density ≠ effective information transfer. Academic / lecture decks especially require restraint:

- List/matrix pages: don't draw all N elements at the same size. Use **primary/secondary tiering** — make the 5 you'll talk about today the lead, shrink the remaining 16 to background hints.
- Big-number pages: the number itself is the visual lead. Surrounding caption no more than 3 lines, otherwise the eye bounces back and forth.
- Quote pages: have whitespace separating the quote from the attribution, don't slap them together.

Self-audit on "is the data the lead?" and "is the text crammed together?" — keep editing until the whitespace makes you slightly uneasy.

---


## Verification checklist (HTML output)

For HTML deliverable verification only. Export verification (PDF page count, PPTX editability, Chromium emoji rendering, font-loading races) lives in `export-formats.md` Section 8.

1. [ ] Open the deck (`index.html` for multi-file, the single HTML for `<deck-stage>`) directly in the browser; first page no broken images, fonts loaded
2. [ ] Press → through every page, no blank pages, no layout breakage
3. [ ] Pick 3 random pages, Cmd+Shift+R hard-refresh — localStorage memory works correctly
4. [ ] Verify the 2-page showcase pair was approved by the user before the rest was batched (per `workflow.md` After-Phase-1-GATED Rule 2)
5. [ ] Verify each vibe (Vibe 1 CD-developed and Vibe 2 school-developed per `workflow.md` Rule 1) renders independently
6. [ ] Search for `TODO` / `placeholder` leftovers, confirm all cleaned up
7. [ ] If editable PowerPoint required, run the html2pptx export per `export-formats.md` Section 7 — fails on any of the 4 hard constraints means rework the source HTML, don't retrofit
