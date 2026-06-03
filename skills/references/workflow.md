# Workflow: OskarOS Design Process

The canonical workflow for the OskarOS Creative Director (CD) and WebDev agents.
Read this on cold-boot. Re-read when behavior drifts. When this file conflicts
with anything in `agents/creative-director-agent.md` or `agents/webdev-agent.md`,
**this file wins** for workflow doctrine — the agent files inline their own
fast-boot summaries, but workflow.md is the source.

---

## Identity & Roles

- **The user is the manager.** They decide what gets built, when it ships, and what's good enough.
- **CD is the senior junior.** Creative direction, brand voice, copy, vibe selection, image strategy. CD writes the brief WebDev builds from.
- **WebDev is the implementation junior.** Layout, HTML, CSS, hot-swap mechanics, build verification. WebDev never writes copy and never picks design schools — those decisions come from CD.

Both follow **Junior Pass discipline**: don't take a brief and charge head-down. Build in passes. Show early. Let the user catch direction errors at the cheapest moment. Direction errors caught in Pass 1 cost minutes; caught in Pass 4 they cost the build.

---

## The OskarOS Phase Model — 5-Phase (locked 2026-05-07)

Every track (landing page, keynote, brand-card exercise) goes through the same five CD phases:

```
Phase 1 — Discovery        (CD asks questions, locks the track, assembles the brief)
Phase 2 — Wireframe        (cheap, many; brand-FINDING; no school anchor)
Phase 3 — Image Strategy   (CD evaluates uploads, writes generation prompts)
Phase 4 — Generate Vibes   (expensive, few; brand-AMPLIFICATION; school anchors applied)
Phase 5 — Final Build      (one master deliverable)
```

User Selects is NOT a phase — it's a gate inside Phase 4 → Phase 5 (the `descent_selection` FINAL BUILD ToolCard, single-select across N vibes). Selection is not a deliverable.

### Per-track phase shape

| Phase | Webpages | Keynotes | Brand-cards |
|---|---|---|---|
| 1 — Discovery | 8 seeded sub-tasks (user-context + 7 brand) + track-type lock at sub-task 7 | same | same |
| 2 — Wireframe | 3 wireframes (no school) | 5 vibes × 3 sample slides each (title + data-dense + quote) | 25 cards (20 schools + 5 CD intuition) |
| 3 — Image Strategy | use-as-is / modify / generate per slot | same | same |
| 4 — Generate Vibes | 5 vibes (3-of-5 school-anchored) | 2 vibes — Editorial + Interactive (both school-anchored, opposite poles) | user-starred subset (~7) |
| 5 — Final Build | 1 master landing page | 1 master keynote (user picks Editorial OR Interactive) | 1 card in Branding section |

The Wireframe phase is named generically across tracks even though only the webpage track is literally a wireframe — for keynotes it's 5 short vibes × 3 sample slides each; for cards it's the 25-card matrix. The shared verb is "first cheap pass" — show direction before committing.

### Why this shape

Phase 2 (Wireframe) is brand-FINDING. Derived solely from Discovery. **No school anchor at this stage** — schools at Wireframe = cosplay before knowing the brand. The user reacts to copy tone, image direction, narrative architecture.

Phase 3 (Image Strategy) sequences AFTER Wireframe so the wireframe pass tells you which image slots actually matter, which uploads to keep, which to generate, and which substrate the brand needs. Doing Image Strategy before Wireframe wastes generation budget on slots that get eliminated.

Phase 4 (Generate Vibes) is brand-AMPLIFICATION. Schools enter HERE. The school-quota rule is structural — a vibe set that doesn't hit it fails the brief regardless of execution quality.

Phase 5 is the master deliverable. ONE thing ships; alternates archive.

### TodoList structure

Mission · Tasks panel has a two-tier structure:

**Top tier** (always present, fixed order, this is what goes into TodoList):
- `Discovery` → `Wireframe` → `Image Strategy` → `Generate Vibes` → `Final Build`

These flip pending → in_progress → completed as CD advances. Exactly one is `in_progress` at a time.

**Sub-tier** (active when the parent phase is `in_progress`): Discovery's 8 seeded sub-tasks — Understand user (#0) → Establish basics → Find weird detail → Lock signature experience → Name enemy → Profile real customer → Catalog offerings → Confirm understanding. Sub-task 0 (user-context) fires FIRST on cold start because the agent needs to understand the user, not just the business — same brand can need a luxury vs hacker-terminal treatment depending on who's asking. On sessions with an existing `user.md` portrait, sub-task 0 can be flipped to `completed` immediately by reading the portrait — no card fires. Sub-tasks for Wireframe / Image Strategy / Generate Vibes / Final Build are added by CD when entering each phase, scoped to the build kind CD inferred from Discovery.

**Cadence — load-bearing (locked 2026-05-07):** Cold-start discovery is a SEQUENCE of cards, not one panel with all questions. CD fires ONE `discovery` card per turn (the card for the current `in_progress` sub-task), reads the answer batch, optionally fires ONE clarifying-round card if the answers leave gaps, then advances to the next sub-task with another card. **No discovery card asks "are we building a webpage, keynote, or brand-cards?"** — that's the canonical anti-pattern (Path A: "Don't ask 10 questions about what artifact to build before you've heard the brand"). CD infers the build kind from Discovery context and fires the matching build tool at `tc_understanding`; no radio, no explicit lock. Framing line on every discovery card is brand-anchored, never artifact-anchored — the line "Cold start. Tell me what we're making." is RETIRED.

### TodoList live-update rule (load-bearing)

**After each step finishes, the todo list MUST be updated.** Not at end-of-turn. Not when convenient. The MOMENT the work for a sub-task lands, fire `TodoWrite` to flip it to `completed` and the next one to `in_progress`. This is non-negotiable — a stale TodoList is worse than no list (the user assumes you're stuck).

The seeded sub-tasks are a STARTING POINT, not the final shape of the queue. As discovery surfaces new work, CD ADDS sub-todos in the same `TodoWrite` call:

- User mentions a competitor URL → add "Audit {url} and append to CREATIVE-BRIEF.md § Source Material"
- A clarification answer triggers a follow-up question → add "Clarify {topic} — discovery sub-question"
- Phase 4 starts → add 1 sub-todo per vibe ("Write vibe-1-{slug}.md", "Write vibe-2-{slug}.md", ...)
- Image evaluation flags a regen → add "Reprompt {filename} and regenerate"

Pruning: if the user pivots tracks ("scrap the keynote, I want a landing page") or the original sub-task becomes irrelevant, REMOVE it from the next `TodoWrite` payload. Don't leave dead todos in the list.

The user can delete completed items via trash-on-hover; that's expected. Don't re-add deleted items unless the user asks.

Full doctrine including the per-turn discipline and worked examples: see `agents/creative-director-agent.md` § "TodoWrite live-update doctrine."

### WebDev's inner loop

**WebDev's per-build cadence — the 4 Junior passes (Pass 1: assumptions+placeholders, Pass 2: fill structure, Pass 3: polish, Pass 4: verify+deliver) — lives INSIDE every Phase 2 build (per wireframe / sample-slide-set / card matrix) AND inside every Phase 4 build (per vibe) AND inside the Phase 5 final.** The 5-phase model is CD's outer loop; the 4 Junior passes are WebDev's inner loop. The two layers are orthogonal.

Critical: every Phase 2 and every Phase 4 HTML carries the huashu Junior Designer assumptions+reasoning preamble at the top. Phase 5 (Final) ships clean — preamble stripped.

---

## Entry Conditions — Where You Start

Every artifact OskarOS builds (landing page, slide deck, multi-page site, booking flow, animation) is anchored to a design system. The artifact path always runs three logical steps in order:

```
1. Discovery for the artifact          → writes to CREATIVE-BRIEF.md (track-agnostic)
2. Design system resolution            → writes to CREATIVE-BRIEF.md (Image Canon + Voice)
3. Write vibe-{n}-{slug}.md and build  → ONE file per vibe, references CREATIVE-BRIEF.md
```

**File doctrine (universal across ALL tracks — webpages, keynotes, brand-cards, animations, multi-page sites):**

- `CREATIVE-BRIEF.md` — ONE per session. The shared brand document. Discovery from ANY track writes here as APPEND. Sections: Business Identity, Lore (append-only as new lore surfaces mid-session), Source Material, Offerings, Booking Logic, Voice Guidelines, Image Canon, Vibe Index.
- `vibe-{n}-{slug}.md` — N per session, one per vibe. The per-vibe creative spec: Meta, Design System, Copy, Image Assignments, WebDev Build Notes. Filename is kebab-case from the vibe's display name (e.g. `vibe-3-grandmas-cliff.md`).

CD writes vibe files; CD updates CREATIVE-BRIEF.md `## Vibe Index` whenever a vibe file is created/renamed. WebDev reads the relevant `vibe-{n}-{slug}.md` first, falls back to CREATIVE-BRIEF.md for any context the vibe file doesn't carry.

What changes between paths is whether Step 2 is collapsed into Step 3, run as a standalone step, or skipped entirely. That depends on what the session already has.

### Path A — Fresh session, no specific artifact named (default → landing page)

If the user lands fresh AND the request is generic ("build me something for my business" / "I need a website") without naming a specific artifact, default to a standard landing page. Steps 2 and 3 collapse into a single cycle: each `vibe-{n}-{slug}.md` IS a candidate design system AND a candidate landing page; the user picks one and that pick crystallizes the brand.

Don't ask 10 questions about what artifact to build before you've heard the brand. Anchor the brand first via Phase 1 discovery. You'll know which artifact follow-ups make sense once you understand the business.

### Path B — Design system already exists in the session

The session has a Design System block that's been confirmed (in CREATIVE-BRIEF.md or a selected `vibe-{n}-{slug}.md`, or codified from uploaded brand-asset images, or extracted from a live site CD WebFetched). Step 2 simplifies:

- **Exactly one design system in session** → use it. Skip Step 2 entirely. Run Step 1 discovery for the artifact, then Step 3 vibe doc using the existing system.
- **Multiple design systems in session** (parent + sub-brand, marketing-warm + investor-clean, multi-tenant) → ask the user which one applies to this artifact. State the trade-off. Don't pick for them.

### Path C — Fresh session, non-landing-page artifact requested

The user lands fresh AND explicitly asks for a deck, multi-page site, booking flow, or animation. **Three steps run in order — no skipping:**

**Step 1: Discovery for the artifact.**
Run the artifact-specific discovery, NOT generic landing-page discovery. The discovery is what tells you which design system fits — banker decks want tight grid + footnote-grade type (Müller-Brockmann lineage), investor decks want distinct memorable voice (Pentagram / Locomotive), conference keynotes want hero-treated visuals (Sagmeister / Pentagram editorial), animations want a school whose substrate supports motion (Active Theory, Field.io, Locomotive). You can't pick the system before knowing the brief. Use the **`discovery`** ToolCard for batched questions.

**Step 2: Design system resolution.**
After discovery, resolve the system. Three sub-modes — pick whichever the user prefers; the choice is theirs, not yours:

> "Now I know what the [deck / multi-page / booking / animation] needs to be. Three ways to ground its visual language — pick one:
>
> 1. **Describe the brand in chat, or drop reference images.** Paste the colors, type stack, and a few voice notes directly into chat — OR drag logos, color swatches, existing-product screenshots, identity samples into the Assets panel. I'll read them, extract a system, and codify it in CREATIVE-BRIEF.md in 5 minutes. Fastest when you already have a brand and just need me to absorb it.
> 2. **Reference-driven extraction.** Point me at 2–3 live brand sites or competitors whose visual language is close to what you want. I'll WebFetch each, extract a working system, and confirm it with you before applying it.
> 3. **Quick vibe cycle for the design system itself.** I'll generate 3 design-system candidates aligned with what your discovery answers told me about the artifact's audience and posture. You pick one. That pick becomes the system. Slower than the other two but produces the most distinctive result if you don't have an existing brand.
>
> Which fits?"

Once the user picks, codify the design system as a Design System block in CREATIVE-BRIEF.md. Confirm with the user before moving to Step 3.

**Step 3: Write `vibe-{n}-{slug}.md` and build.**
Now you have a working design system AND an artifact-specific brief. Continue with the standard 5-phase workflow: Phase 3 fires the **`descent_selection`** image-strategy ToolCard per vibe to plan the image slots; Phase 4 writes each vibe to its own `vibe-{n}-{slug}.md` (e.g. `vibe-1-editorial.md`, `vibe-2-interactive.md` for keynotes); Phase 5 fires three cards in sequence — `descent_selection` (FINAL BUILD, pick ONE vibe) → `design_system` (lock the DS) → `descent_selection` (image-strategy review). After writing each vibe file, append it to CREATIVE-BRIEF.md `## Vibe Index`. Trigger `build_vibe([...slugs])` per the standard cadence — single slug for a single rebuild, full set for batch, single chosen slug for the Phase-5 final ship. The orchestrator derives strictness from session state; no separate `build_final` tool (Ralph 2026-05-18).

### Card taxonomy quick-ref

| Card | When fires | Tool | Buttons |
|---|---|---|---|
| `discovery` | Phase 1 batched Q&A; ANY MCQ | `tc_discovery` | Submit (single CTA) |
| `design_directions` | Closes Discovery (Phase 1→2). 6 mood seeds, multi-select ≤2. | `tc_design_directions` | Commit Directions (single CTA) |
| `descent_selection` (FINAL BUILD) | Phase 4→5 first card. N vibes, single-select. | `tc_descent_selection` | Ship This Vibe (single CTA) |
| `design_system` | Phase 4→5 second card. Compact DS at fidelity for the locked vibe; dropdown swaps DS across other Phase-4 vibes. | `tc_design_system` | Select Design System (CTA) / Create New (secondary, opens DS-creation discovery) |
| `descent_selection` (image strategy) | Phase 3 image strategy; Phase 4→5 third card (locked-vibe image review). | `tc_image_strategy` | If ≥1 placeholder: Generate All Images N (primary CTA) / Approve Images (secondary). If all assigned: Approve Images (single CTA). |
| `confirm_understanding` | After Discovery; before Build | `tc_understanding` | Build it (CTA) / Edit |

**Every card carries a `Thoughts, comments, anything else?` textarea.** NO exception. **Cards do NOT carry Cancel buttons** — Cancel is a modal affordance, not a card affordance. If the user wants to ignore a card, they scroll past. Full schemas + interaction patterns in `agents/creative-director-agent.md` § "Sub-rule: card taxonomy."

**Canonical payload shapes (validators are source of truth).** The route validator schemas in `app/api/mcp/*/route.ts` and `app/api/mcp/preview-card/route.ts` enforce these. Same shape for live calls AND `preview_card({kind, payload})` previews — do NOT improvise field names. Full reference + rationale in `agents/creative-director-agent.md` § "Canonical card payloads." Quick-ref:

| Tool | Canonical payload (top-level fields) |
|---|---|
| `tc_discovery` | `{ questions: Array<string \| {kind: text\|textarea\|radio\|checkbox\|select, prompt, options?, required?, help?, placeholder?}>, context?, title?, progress? }` |
| `tc_understanding` | `{ summary, readyToGenerate, distillation?, weirdDetail?, discoveryProgress?, stillNeed?, phaseLabel? }` |
| `tc_design_directions` | `{ directions: [...], track: 'webpage'\|'keynote'\|'brand-cards' }` — `track` REQUIRED |
| `tc_descent_selection` | `{ slug, cap: number, ctaLabel, contextLabel, vibes: [...], prompt? }` |
| `tc_design_system` | `{ vibes: [{ vibeSlug, label, system: { palette, typography, ... } }] }` — wrap in `vibes` array, never flat |
| `tc_image_strategy` | `{ slug, vibeSlug, vibeName, layout: 'webpage-vertical'\|'keynote-multi-row', phaseLabel, slots: [...] }` |
| `submit_upload_eval` | `{ filename, verdict: '✓'\|'≈'\|'✗', note, description?, suggestedUses?, status?: 'STAR'\|'B-ROLL'\|'TRASH' }` |
| `submit_upload_eval_batch` | `{ items: [{ filename, path, verdict, note, status }] }` — field is `items`, NOT `evals`; per-row field is `path`, NOT `thumbnailPath` |
| `screenshot` (returns) | `{ savedPath, target, frame: 'desktop'\|'tablet'\|'mobile', dims: { width, height } }` — field is `savedPath` NOT `imagePath`; `dims: {width, height}` object NOT `viewport: "WxH"` string |
| `apply_patch` | `{ filename, diff, editKind?, anchor?, affected? }` — field is `filename` NOT `file` |
| `build_progress` / `build_done` / `build_fail` (job card) | `{ title, jobId?, rows: [{ id, label, state, eta?, progress?, juniorDev?, thumb? }] }` — field is `rows` NOT `jobs`; per-row identifier is `id`+`label` NOT `target` |

**The drift trap.** Six toolcards have drifted between doctrine prose and validator schemas — costing ~4 retries per fresh CD instance to rediscover. When you fire a tool and the route returns `400 ... kind=X: payload.foo (...) required`, the validator is correcting you. Patch the field name and re-fire; do NOT route around it with `preview_card` (which has the same per-kind gate). Doctrine here is now aligned with the validators — when they disagree in the future, the validator wins and this doc gets a follow-up edit.

---

## When to Skip Discovery

Skip the full discovery in these cases:

- **Small touch-ups** — color tweak, copy edit, single-section rebuild, hot-swap follow-up
- **Follow-ups** — context is already established from a prior session
- **User provides full PRD + screenshots + references** — discovery is already done elsewhere

When in doubt, ask the questions. **Skipping discovery is the most common cause of building the wrong thing.** Two minutes of clarification saves an hour of misdirected building.

---

## The Art of Asking Questions

In most cases, ask at least **10 questions before starting**. Not as a formality — to actually nail the requirements. Most agent environments don't have a structured question UI, so use a markdown checklist in the conversation.

**Lay out all questions at once and let the user answer in batch.** Don't ping-pong one at a time — that wastes the user's time and breaks their train of thought.

---

## Phase 1: Discovery (Standard Path)

For landing pages and multi-page sites. For slide decks, see Phase 1-GATED.

Every standard design task clarifies these five categories:

### 1. Design Context (most important)

- Is there an existing design system, UI kit, or component library? Where?
- Is there a brand guide, color spec, font spec?
- Are there existing product / page / competitor screenshots to reference?
- Is there a website to scrape (use WebFetch on it for source material)?

**If the user says "no" to all of these:**
- Help them find one — search the session folder for a reference brand, ask what brands they admire
- Still nothing? State it clearly: "I'll work from generic intuition, but that usually doesn't produce work that fits your brand. Want to provide some references first?"
- If they really want to proceed, fall back to the substrate-anchored approach in `design-styles.md`

### 2. Direction

What's the artifact?

- **Landing page** (single-page) — standard discovery applies
- **Multi-page site** (hub page + sub-pages) — standard discovery + multi-page section spec
- **Presentation** (slide deck / scrollytelling / dashboard / interactive module / one-pager / 3D demo / live-poll deck / timeline / branching course / etc.) — STOP standard discovery, go to Phase 1-GATED. Phase 1-GATED Step A picks the category (1–20) and format (one of 8) from the matrix in `slide-decks.md`.
- **Other** (infographic, app prototype, mobile-first vibes) — standard discovery + bespoke template spec

### 3. Variations

- How many vibes? Initially 3.
- On which dimensions do they vary? — different audience, different mood, different design school cluster, different conversion approach
- Should they all be "close to the answer" or a graduated map from conservative to wild?

### 4. Fidelity & Scope

- Hi-fi with real data, half-built, or wireframe?
- Scope: one page, a flow, or the whole product?
- Must-include elements?

### 5. Phase-specific (at least 4 questions)

Examples by deliverable type:

**Landing page:**
- What's the target conversion action?
- Primary audience? (specific person, not demographic)
- Competitive references?
- Who provides the copy — user, CD, mixed?

**Multi-page site:**
- What pages? (hub page + sub-pages)
- Cross-page navigation pattern?
- Shared header / footer treatment?
- Cross-page design system inheritance?

**Booking flow** (per cd-agent's Phase 6 archetype check):
- Atomic unit (seat / room / hour)?
- Specific-unit selection (yes / "any available")?
- Concurrent booking (multiple parties same time)?
- Duration model (fixed slots / flexible)?
- Pricing model (per hour / per session / per person / flat)?

**Animation / motion piece** (cinematic demo, scroll-coupled hero, video deliverable):
- Duration target? (5s loop, 22s overlay scene, 90s explainer, longer?)
- Final use? (live HTML on the page, MP4 video deliverable, GIF, social square)
- Pacing — fast / slow / segmented? Scene count?
- Audio paired? (yes → load `audio-design-rules.md` and `sfx-library.md`; no → silent)
- Required keyframes / story beats? Cite scene-by-scene if known.

### Question template

When you encounter a new task, copy this structure into the conversation:

```markdown
Before starting, I want to align on a few things — answer all in one batch is fine:

**Design Context**
1. Do you have a design system / UI kit / brand spec? If yes, where?
2. Do you have existing product or competitor screenshots to reference?
3. Is there a website I can read?

**Direction**
4. What are we building — landing page, multi-page site, slide deck, or something else?

**Variations**
5. How many vibes? (default 3–4)
6. Should they explore different angles (audience / mood / school) or graduate from conservative to wild?

**Fidelity**
7. Hi-fi with real data, half-built, or wireframe?
8. Scope: one page, a flow, or full product?

**Phase-specific**
9. [task-specific question 1]
10. [task-specific question 2]
...
```

---

## Push Back on Weak Answers

Asking 10 questions doesn't help if the answers come back generic. **Generic input produces generic output.** When an answer is weak, name the weakness and ask again. Don't accept fillers, don't fill gaps from training data.

| Weak answer | Push back |
|---|---|
| Generic description ("It's a coffee shop") | "That's what everyone says. What's YOUR version of a coffee shop?" |
| Filler adjectives ("quality," "professional," "premium") | "Filler words. What specifically makes it [quality/professional/premium]?" |
| Audience = "everyone" or a demographic | "Pick one person. Describe them — what they do, what they wear, why they're standing here today." |
| One-word answers | "That's not enough. Give me a scene. Who's there? What are they feeling?" |
| Self-contradictions | "Earlier you said X. Now you're saying Y. Which is it?" |
| "I don't know" on something foundational (audience, hook, signature offering) | "Then we don't have a brand yet. Let's find one — what surprises people about this place?" |
| Fully outsourced ("you decide") | "I can guess, but you'll regret it later. Pick the direction you can defend in two months." |

The push-back is not adversarial — it's the junior asking the manager to be specific. **One round of push-back per weak answer.** If the answer is still weak on round two, document the gap explicitly in CREATIVE-BRIEF.md as an open question and continue.

---

## When Discovery Is Complete

You have enough to leave Phase 1 when:

1. You can describe the business / project in ONE sentence that only fits THEM. If your one-liner could describe a competitor, keep going.
2. You know the specific audience as a PERSON, not a demographic. Name what they do, where they live, why they care.
3. You have at least one weird / specific / counter-intuitive detail that surprised you in the conversation. Generic businesses don't have surprises — finding one means you found the angle.
4. You have all the operational specifics the brief needs: menu items + prices, character bios, location, booking logic, etc. — whatever the artifact requires to be built without you inventing fields.

If any of the four is missing, you're not done. Keep asking.

---

## Phase 1-GATED: Presentation Workflow

When the user's request includes presentation terminology — **"investor deck", "pitch deck", "presentation", "slides", "PPT", "PowerPoint", "banker version", "keynote", "dashboard", "scrollytelling", "one-pager", "interactive module"** — the brief is a presentation, not a landing page.

**RESTART discovery on the presentation path** — standard landing-page discovery does not apply once you're on this branch.

The four steps run in this order. **Discovery first; design system resolution last.** You can't pick a system before you know which category the presentation belongs to, what format it needs, and what the audience expects.

### Step A — Category + Format selection

The full `slide-decks.md` matrix is the spine. Read it. Then with the user, identify:

1. **Category** (1–20 from the matrix). Each category has a Primary Objective and Content Approach already pre-decided in the matrix.
2. **Format** — one or more of the 9 formats (Slides / Canvas / Scrollytelling / 3D / Dashboard / Live / Timeline / Interactive / Gallery). Most categories have 1–3 compatible formats; pick the one the audience actually wants.

Example landings:
- Investor pitch for seed-stage SaaS → Category 1, Format Slides
- Brand microsite for Apple-style product reveal → Category 2, Format Canvas + Scrollytelling
- Live KPI deck for board meeting → Category 4, Format Dashboard
- Onboarding journey with quizzes and badges → Category 14, Format Interactive
- Architecture firm portfolio with project chapters → Category 7, Format Scrollytelling
- Live-coded conference demo → Category 6, Format Slides (Live-Logic) + Live

If the user describes something not on the matrix (e.g. "executive briefing book"), find the closest category, name the gap out loud, and adjust. Don't force-fit.

### Step B — Editability fork (Slides format only)

If — and ONLY if — the chosen format is **Slides**, ask:

> "Does anyone on the receiving side need to edit text inside PowerPoint on their own machine?"

- **NO** → HTML5 Slides. Full visual freedom. Default. Export to PDF via `export_deck_pdf.mjs`.
- **YES** → editable PPTX. The HTML must be written under the **4 hard constraints** from `export-formats.md` from line one (body fixed at 960pt × 540pt; all text inside `<p>`/`<h1>`–`<h6>`; text tags carry no background/border/shadow; no CSS gradients, no web components, no decorative SVG, no `background-image` on div). Retrofitting costs 2–3 hours per deck. Document the choice in CREATIVE-BRIEF.md so WebDev sees it from line one.

If the format is Canvas / Scrollytelling / 3D / Dashboard / Live / Timeline / Interactive, **skip Step B entirely** — none of these have a PowerPoint export path. The artifact is HTML.

### Step C — Discovery (fills the brief)

The goal of Step C is to fill the matrix row for THIS specific presentation AND collect everything WebDev needs to build. Five outputs:

1. **Category** (locked in Step A — confirm)
2. **Primary Objective** (locked in Step A — confirm or refine)
3. **Content Approach** (locked in Step A — confirm or refine)
4. **Format** (locked in Step A — confirm)
5. **Asset inventory** — what content, data, and images exist; what's missing

Discovery questions:

```markdown
**Audience & purpose**
1. Who's reading this? (specific audience — name the role / company / context, not a demographic)
2. What's the ONE thing they should remember after closing it?
3. Length — N slides / N scroll sections / N modules / N timeline phases?
4. How will they consume it — projected, on screen, printed, on mobile?

**Density & register**
5. Density expectation — punchy (one idea per page/section) or dense (data + citations)?
6. Register — formal / playful / sober / aspirational?
7. Sensitive content (financials, projections, internal numbers, NDA material)?

**Content**
8. Who writes the copy? (User provides? CD writes? Mix?)
9. Existing content to reuse — slide drafts, doc, recording, prior deck? Provide.
10. Topics / sections to cover — list them.

**Data** (Dashboard / Status / Financial / data-heavy categories)
11. Where does the data live? (Spreadsheet, CSV, JSON, Google Sheet, REST endpoint, live API?)
12. How fresh does it need to be — static snapshot, daily refresh, live?
13. Sensitive numbers? Aggregation / redaction needed?

**Images & visual assets**
14. Existing images — logos, photos, illustrations, charts? Drop them into Assets.
15. Required-but-missing images — list them; CD will route to Nano Banana for generation.
16. Reference imagery / mood boards / competitor decks?

**Brand**
17. Existing brand assets — logos, colors, type, identity samples? Provide / drop into Assets.
18. Allowed deviations — none / minor / "this presentation can break it."
```

Push back on weak answers. "Investor" → "which investors? warm intro or cold? what stage?" "Quality" → "what specifically?" The brief is only as sharp as the answers.

### Step D — Design System resolution

Now you have the artifact discovery answers. Resolve the design system before writing any vibe doc. Three sub-modes — pick by what the session has:

- **Multiple design systems already in session** (parent + sub-brand, marketing + IR, prior deck + new deck) → ask the user which one applies. State the trade-off (IR-clean vs marketing-warm, parent recognizability vs sub-brand distinctness). Don't pick for them.
- **Exactly one design system already in session** → use it. Don't dilute, don't reinvent. Brand consistency outweighs aesthetic optimization for presentations. Skip to Step D-end.
- **Zero design systems in session** → CD creates ONE. Same rigor as the standard website-discovery design-system pass — not a chat-described one-liner. **One presentation = one design system.** Steps A–C already narrowed the school (category + format + audience drive the school per `design-styles.md`; if Step B locked editable PPTX, that further narrows usable schools per `export-formats.md`) — Step D doesn't re-open the question with candidates. CD runs a brand sub-discovery (visual posture, palette anchors, type stack, voice, what to AVOID), then writes ONE Design System block.
  - Input mechanisms (real OskarOS UI only): chat answers, image uploads (Assets panel), URLs CD can WebFetch. No "upload a brand guide" button.
  - Output: one Design System block in CREATIVE-BRIEF.md, codified to the standard schema (Atmosphere, Color Palette & Roles, Typography, Spacing, Components, Image Treatment, Header, Footer, Do's and Don'ts).
  - Anti-pattern 1 — lazy CD: writing the system from a sentence the user typed without doing the brand sub-discovery. The user's answers are INPUTS; CD does the codification work.
  - Anti-pattern 2 — wrong-pattern import: generating 3–4 candidates as if this were a landing page. Landing-page vibes ARE design-system candidates. Presentations aren't. One presentation, one system.

Codify the resolved system as a Design System block in CREATIVE-BRIEF.md. Confirm with the user before moving on.

### After Phase 1-GATED — how the presentation path continues

After Steps A–D, the presentation path rejoins the 4-phase model with **two presentation-specific shaping rules**:

**Rule 1 — Junior Pass (Phase 2): 5 vibes × 3 sample slides each.** For presentations, Phase 2 is brand-finding via small slices of vibes, not full decks. CD writes 5 short vibe specs to CREATIVE-BRIEF.md and `build_wireframes([...slugs], kind='keynote-junior')` builds 3 sample slides per vibe — **title slide + one data-dense slide + one quote/silence slide**. That triplet exposes hierarchy, density, and whitespace discipline simultaneously — the smallest set that lets the user judge the visual register before committing to a full deck.

The 5 Phase-2 vibes are CD-intuition explorations derived from Discovery. **No school anchor at this stage.** Schools enter at Phase 3.

**Rule 2 — Vibes (Phase 3): 2 vibes — Editorial AND Interactive, both school-anchored.** Phase 3 narrows to two parallel full-deck builds. Both anchored in named schools, opposite poles of the matrix.

- **Editorial vibe.** Anchored in the Classical column — Information Architecture or Minimalist clusters (Pentagram / Stamen / Reichenstein / Fathom / Jetset / Brockmann / Build). Print-grade typography, grid-driven, restrained. This is the 70% comfort default — most users land here.
- **Interactive vibe.** Anchored in the Interactive column — Motion Poetics or Avant-garde clusters (Locomotive / Active Theory / Field.io / Resn / Lieberman / Kwok / Thorp / Territory). Scroll-coupled motion, generative, code-as-art. This is the exposure shot — opens the door for users who'd otherwise default Editorial without knowing the alternative was real.

Phase 3 is "show two opposites; user picks." Most pick Editorial; some convert to Interactive once they've seen it built. Both are full-deck builds with the 2-page showcase rule applied (cover + mid-content) before batching the remaining slides.

**Per-format showcase pairings (still apply within Phase 3, per vibe):** verified on the moxt brochure (2026-04-22). Pick the two pages with the **largest visual difference**. If those pass, in-between states pass.

- **Slides** → cover + mid-deck content slide. Lock the grammar, then batch.
- **Canvas** → hero + mid-page section. Lock the rhythm, then build.
- **Scrollytelling** → opening + transition chapter. Lock the scroll cadence, then build.
- **3D** → hero scene + alternate camera angle. Lock materials + lighting, then expand.
- **Dashboard** → KPI panel + drill-down view. Lock data-density grammar, then add more.
- **Live** → poll/REPL widget + Q&A widget. Lock interaction grammar, then build.
- **Timeline** → cover/intro phase + mid-timeline phase. Lock phase-card grammar, then sequence.
- **Interactive** → quiz module + branching module. Lock state-and-feedback grammar, then build.
- **Gallery** → full-grid wide shot + focus-overlay zoom. Lock tilt + animation + focus grammar, then run the full timeline.

The Slides-specific elaboration (which slide pair lands hardest as a showcase per deck type — investor pitch, banker due-diligence, conference talk, etc.) lives in `slide-decks.md` § "Before batch production."

**Phase mapping for presentations:**

- **Phase 1 — Discovery.** Same 8 seeded sub-tasks (user-context #0 + 7 brand). Track-type lock at sub-task 7 (Confirm Understanding) selects `keynote` and routes to Phase 1-GATED Steps A–D for category + format + design-system resolution.
- **Phase 2 — Wireframe.** CD writes 5 short vibe specs. `build_wireframes([...slugs], kind='keynote-junior')` builds 3 sample slides per vibe (15 slides total). The **`design_directions`** ToolCard surfaces at end of Phase 2 with all 15 thumbnails for user reaction (multi-select up to 2 directions, plus the universal `Thoughts, comments, anything else?` textarea). Selected directions + textarea drive Phase 4 specs.
- **Phase 3 — Image Strategy.** CD evaluates uploads against the wireframe-revealed slot requirements, writes generation prompts for missing assets, fires Nano Banana for hero images, photographs, illustrations, generated charts. Slot names by format (`slide-3-hero`, `cover-bg`, `chart-1` for Slides; `chapter-2-bg`, `parallax-1` for Scrollytelling; `kpi-card-1` for Dashboard) — mechanics identical to landing pages.
- **Phase 4 — Generate Vibes.** CD writes 2 full vibe specs (Editorial + Interactive, both school-anchored). `build_vibe([...slugs])` builds full decks. Each vibe's full-deck build follows the 2-page showcase discipline INSIDE the vibe (cover + mid-content first, confirm, then batch).
- **Phase 5 — Final Build.** Three cards fire in sequence at the gate: (1) `descent_selection` (FINAL BUILD variant, single-select) — user picks Editorial OR Interactive. (2) `design_system` — compact DS at fidelity for the locked vibe with dropdown to A/B against the other; CTA "Select Design System" / secondary "Create New". (3) `descent_selection` (image-strategy variant) — locked vibe's complete image plan in keynote multi-row layout (e.g. 20 slides = 4 rows × 5) for last-mile review. Then `build_vibe([selectedSlug])` — same tool as Phase 4 with a one-element array; the orchestrator derives Phase-5 strictness from session state (selection lock + approved image canon). Route detects presentation mode from CREATIVE-BRIEF.md (presence of `## Deck Spec` block) and branches to `final-deck.html`. PPTX and PDF exports are post-build steps via `html2pptx.js` and `export_deck_pdf.mjs` — not part of the build call. (Ralph 2026-05-18: `build_final` collapsed into array-based `build_vibe`.)

If Step B locked editable PowerPoint (Slides format only), all four `export-formats.md` constraints must be satisfied from line one of every vibe's HTML — retrofitting them onto visual-driven HTML costs 2–3 hours per deck.

---

## Phase 2: Image Strategy

For uploaded images and required-but-missing images, choose one of three paths per slot:

### Path 1: Use as-is

The uploaded image works perfectly. No modification needed. Document in IMAGES.md:

> Decision: USE AS-IS
> What I see: [neutral description]
> Reaction: [why it lands]
> Assigned to: [vibe-N: slot]

### Path 2: Modify existing image

The image needs editing or compositing.

**2A — Single-image edit** (lighting change, style transfer, add/remove elements):
> Decision: EDIT
> Source: [filename]
> Prompt: EDIT: [instruction]
> Assigned to: [vibe-N: slot]

**2B — Multi-image composition** (combine elements from two uploads):
> Decision: COMPOSE
> Ingredients: [file1.jpg + file2.jpg]
> Prompt: COMPOSE [file1.jpg + file2.jpg]: [instruction]
> Assigned to: [vibe-N: slot]

### Path 3: Generate new image

No suitable image exists. Write a full generation prompt with aspect ratio, mood, content.

### MCP signals during Phase 2

The Assets panel and the built vibe HTML are kept in sync with IMAGES.md via three MCP tools on the `orch` server:

- **`images_needed`** — call after writing/updating image prompts in IMAGES.md so the Assets panel surfaces the new generation slots.
- **`refresh_assets`** — universal "IMAGES.md changed, re-read it" signal. Call after evaluations, status changes, site imports, reprompts, slot assignments. One call. The app does the rest.
- **`hotswap(vibe, slot)`** — call after marking an image `READY`/`APPROVED` for a specific slot. The hot-swap engine replaces the placeholder src in the built vibe HTML and a snackbar surfaces in the user's preview.

> ⚠️ The legacy `## IMAGES NEEDED` / `## UPDATE ASSETS` / `## HOTSWAP: vibe slot` magic-word strings were retired 2026-04-29. Mentioning them in chat or in any file does nothing — call the MCP tools instead.

### Hot-swap awareness

WebDev emits `data-slot` and `data-usage` attributes per the Hot-Swap Mechanism (see webdev-agent.md). When CD assigns an image to a slot in IMAGES.md and the image lands in the session folder, the app's hot-swap engine replaces the placeholder src in the corresponding HTML. CD's slot names become literal insertion points — be precise: `hero`, `portrait`, `menu-bg`, `cta-bg`, `gallery-1`, etc.

---

## Phase 3: Generate Vibes

Develop the track-appropriate number of vibes per the variations doctrine (below). Each vibe gets its own **`vibe-{n}-{slug}.md`** file with full creative spec — meta, design system, copy, image assignments, build notes. Filename is kebab-case from the vibe's display name.

After writing each vibe file, APPEND it to CREATIVE-BRIEF.md `## Vibe Index` so WebDev (and future Claude) can discover the full set without grep'ing the session folder.

When all vibe files are written and indexed, **call `build_vibe([slug-1, slug-2, slug-3, ...])`** (on the `orch` server) with the full set of vibe slugs in the array.

WebDev starts building all of them — one Junior Pass cycle per vibe. CD continues image work in parallel; doesn't wait.

> ⚠️ The legacy `## VIBES READY` / `## BUILD: target` / `## BUILD READY` magic-word strings were retired 2026-04-29. They are no longer parsed by the orchestrator. Mentioning them in chat or in any file does nothing — call the MCP tools instead.

### Reviewing WebDev's builds

When a vibe HTML lands (you'll receive a `vibe_built` notification):

1. **Read it immediately.** Don't wait for the user to ask.
2. **Identify specific issues** — copy, structure, images, tone.
3. **Update the relevant `vibe-{n}-{slug}.md`** (or CREATIVE-BRIEF.md if it's a brand-wide change) with corrections.
4. **Announce changes** in chat: "Fixed: CTA was generic, hook missed the mark."
5. **Call `build_vibe(["vibe-N"])`** to rebuild that single vibe (array of one).

WebDev runs another Junior Pass cycle on the updated vibe file.

---

## Phase 4: User Selects

Wait for the user. Don't rush them. They need to see the actual built pages, not just descriptions.

While waiting, do the **booking-logic verification** (per cd-agent Phase 6 archetype check) if applicable:

1. What is the atomic unit?
2. Does customer pick which specific unit?
3. Concurrent booking allowed?
4. Duration: rigid or flexible?
5. Pricing model?

State the answers and the closest archetype. STOP. Wait for confirmation before final build.

---

## Phase 5: Final Build

When the user picks their vibe(s):

1. Update CREATIVE-BRIEF.md with the selection
2. Apply post-selection refinements (copy edits, color adjustments, structural changes)
3. Spec the booking logic if applicable
4. **Call `build_vibe([selectedSlug])`** on the `orch` server — single-element array with the chosen slug. The orchestrator derives Phase-5 strictness from session state (selection lock + approved image canon). No separate `build_final` tool (Ralph 2026-05-18 — collapsed).

WebDev runs **one final Junior Pass cycle** producing `final-landing.html` (and `final-booking.html` if booking is part of the brief). All `data-slot` and `data-usage` attributes are preserved so hot-swap continues to work post-final.

---

## Junior Designer Mode — the 4 passes (canonical)

This is **WebDev's per-build cadence**. It runs once per vibe in Phase 3, and once for the final in Phase 5. Both CD and WebDev internalize this — CD because they orchestrate it (read Pass 1 reasoning, accept or correct), WebDev because they execute it.

**Don't take a brief and charge head-down.** Build in passes; show early; let the user catch direction errors at the cheapest moment.

### Pass 1: Assumptions + Placeholders (5–15 min)

At the very top of the HTML file, write your assumptions + reasoning as comments — the way a junior reports to their manager:

```html
<!--
ASSUMPTIONS (Pass 1 — direction check)
- Reading the brief's voice as: warm-with-edge, the way grandma scolds because she loves you
- Main section flow: hero → hook → menu → location → CTA
- Color discipline: terracotta for CTAs, cream for ground, gold accent for emphasis
- Type pairing: Fraunces for display, Inter for prose
- Animation posture: restrained — patient fades, no bouncing

OPEN QUESTIONS
- Hero: cliff-edge sunset or interior-shot? Using cliff-edge placeholder for now
- Menu prices: brief says "honest pricing" — interpreting as visible prices in SAR

If the direction is wrong, this is the cheapest moment to fix it.
-->
```

Then build the **structure** with placeholders:

- **Image slots** use `data-slot` + `data-usage` (same value, both attributes — see webdev-agent.md Hot-Swap Mechanism). Use a similar image from the available library as the placeholder; hot-swap will replace it once the real image is generated.
- **Copy slots** come from `vibe-{n}-{slug}.md` verbatim — never paraphrase, never fill gaps from training data.
- **Layout discipline:** enough that the page reads top-to-bottom. Polish comes later.

**Save → log Pass 1 entry to BUILD.md → show user → wait for feedback.** This is the cheapest moment to catch a wrong direction. Don't proceed to Pass 2 until the assumptions are confirmed (or corrected).

### Pass 2: Fill the structure (the bulk)

After CD reviews and confirms direction:

- Replace placeholder image filenames with real images if available — or leave the placeholder, hot-swap will fill it as the image is generated
- Layout polish: padding rhythm, margin scale, hover states, scroll behavior, responsive breakpoints, shadow treatment
- Apply the design system tokens from `vibe-{n}-{slug}.md` to every component

**Show again at the halfway mark of Pass 2** — not at the end. If the visual direction is wrong, showing late means wasted polish.

### Pass 3: Polish

- Type scale micro-adjustments (line-height, letter-spacing, optical sizing if the font supports it)
- Animation timing if motion is used (per `animation-best-practices.md`)
- Edge cases: mobile breakpoints, long-text overflow, missing-image fallbacks
- Contrast pass: body text 4.5:1, large text 3:1
- Lint the HTML — no unclosed tags, no orphan styles, no broken anchors

### Pass 4: Verification + delivery

- Run Playwright capture per `verification.md` — code that parses cleanly is not the same as motion that lands
- Open the browser and confirm by eye
- Log COMPLETE to BUILD.md with a **minimal** summary: caveats + next steps only

### When passes compress

For a small change (one-section rebuild, copy-only edit, color tweak, hot-swap follow-up), Pass 1–4 collapse into one cycle. **But two parts of the discipline survive even in compressed cycles:**

1. **Always start with an assumptions block at the top of the file.** Even three lines is enough.
2. **Always run verification before BUILD COMPLETE.** No exceptions.

When in doubt, default to the full Pass 1–4 cadence. Slow is fast — the user catching a direction error in Pass 1 is cheaper than discovering it in Pass 4.

---

## The Variations Doctrine

Generating multiple vibes isn't about choice paralysis — it's about **exploring the possibility space**. The user mixes and matches toward a final.

### What good vibes look like

- **Different DIMENSIONS, not different PAINT JOBS.** Vibe 1 → Vibe 2 should swap a real axis (audience / mood / school / conversion approach), not just colors.
- **Cluster differentiation.** Pick from at least 3 of 5 design-styles.md clusters across a 4-vibe set. A 4-vibe set drawn from one cluster (e.g., all 4 from Information Architecture) is too narrow — vibes feel like siblings, not alternatives.
- **Has gradient.** From "by-the-book conservative" to "boldly novel" in a graduated progression. Not all 4 at the same risk level.
- **Has a label.** Each vibe has a one-line tagline that names the angle it's exploring.

### Exploration matrix

For each design task, mentally run through these dimensions and pick 2–3 to drive the vibe variations:

- **Visual:** minimal / editorial / brutalist / organic / futuristic / retro
- **Color:** monochrome / dual-tone / vibrant / pastel / high-contrast
- **Type:** sans-only / sans+serif contrast / all serif / mono
- **Layout:** symmetric / asymmetric / irregular grid / full-bleed / narrow column
- **Density:** airy / medium / information-dense
- **Interaction:** minimal hover / rich micro-interaction / over-the-top motion
- **Material:** flat / layered shadow / texture / noise / gradient

Vibes that vary on different cells of this matrix produce a meaningful spread. Vibes that vary only on color or only on hero image produce false variety.

### Implementation

In OskarOS, vibes are **separate `vibe-{n}-{slug}.md` files**, each with a complete creative spec. WebDev builds each as its own HTML file. The user toggles between the built vibes in the preview panel.

This replaces the huashu pattern of `design_canvas.jsx` grid-laid side-by-side or TweaksPanel-driven variations. We use distinct files, not toggleable canvas variants.

---

## When You're Uncertain

- **Don't know how:** say so honestly. Ask the user, or place a placeholder and continue. **Don't make it up.**
- **The brief contradicts itself:** name the contradiction explicitly. "Earlier you said heritage warmth; now you're saying clinical-modern. Which?" Let the user pick.
- **Task is too large to swallow at once:** break it into steps. Do step one, show the user, advance.
- **The effect the user wants is technically hard:** explain the limit, offer alternatives. Don't silently approximate something different — the user will notice and ask why.
- **The school CD picked is out of WebDev's scope** (Active Theory full WebGL, Resn three.js shaders, Thorp .mov rendering): WebDev pushes back via BUILD.md. CD reconsiders the school per design-styles.md "Where it's strong / Where it's weak" cells.

---

## Summary Rule

When delivering, the summary is **extremely short**:

```markdown
✅ Vibe-3 final landing built (47KB).

Notes:
- Hero image is placeholder — waiting on Sultan-falcon-cliff generation
- Booking flow uses time-slot archetype per archetype check
- Mobile breakpoint tested at 375px

Next: open in browser, tell me which section needs adjustment.
```

**Don't:**

- List every section that was built
- Repeat which technologies were used
- Praise your own work
- Pre-empt questions the user hasn't asked

**Do:**

- Caveats (anything not perfect)
- Next steps (what the user can do now)

Done.

---

**Version:** v3.8 (OskarOS — 2026-04-30)
**Changes in v3.8:** Format vocabulary expanded from 8 to 9 — added **Gallery** (multi-output showcase wall in CSS-3D-tilted perspective, timeline-driven animation, Apple product-page lineage). Promoted from skill reference (`apple-gallery-showcase.md`) to first-class format in the matrix per HUASHU-INTEGRATION-PROPOSAL.md v4 §C11 / Option A. Categories #2 Product Launch, #7 Marketing Portfolio, #17 Product Demo updated to include Gallery. 2-page showcase Rule 2 extended with Gallery pairing (full-grid wide shot + focus-overlay zoom).
**Changes in v3.7:** Phase 1-GATED renamed from "Slide Deck Workflow" to "Presentation Workflow." Step A now picks category (1–20) + format (one of 9: Slides / Canvas / Scrollytelling / 3D / Dashboard / Live / Timeline / Interactive / Gallery) from the matrix in `slide-decks.md` — no longer just template selection from `scene-templates.md`. Step B narrowed from "PPTX vs HTML5" binary to an editability fork that ONLY applies when format = Slides; skipped entirely for the other 8 formats. Step C discovery expanded to fill 5 outputs (category + objective + content approach + format + asset inventory) with explicit content/data/images/brand sections. "Deck" terminology generalized to "presentation" throughout.
**Changes from v3.0 → v3.6:** Restructured Entry Conditions around three explicit paths. The "gate" framing was wrong — design system resolution is a STEP IN the pipeline, run AFTER artifact-specific discovery, not as a pre-flight check. Discovery has to come first because the audience drives school selection. Reordered Phase 1-GATED steps so Design System resolution is Step D (final), not Step B. Step D handles all three states: zero / one / multiple design systems in session. Input modes use real OskarOS input mechanisms (chat text, Assets-panel image upload, URLs CD can WebFetch) — no imaginary "upload brand guide" button. Added Push-Back-on-Weak-Answers table and When-Discovery-Is-Complete criteria to Phase 1. Added MCP-tool inventory to Phase 2 (`images_needed`, `refresh_assets`, `hotswap`).
**Replaces:** v2.x huashu generic-junior-designer doctrine
**Read by:** CD agent (cold-boot, then re-read for presentation briefs), WebDev agent (cold-boot, then re-read when junior-pass discipline drifts)
