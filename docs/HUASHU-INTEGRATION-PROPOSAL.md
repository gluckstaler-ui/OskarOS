# Huashu Integration v4 — Backlog After the Matrix Landing

**Date:** 2026-04-30
**Author:** CD JEDI Master
**Status:** Sequenced backlog — ready to execute
**Supersedes:** v3 (2026-04-29) — comprehensive but unsequenced; this version is post-matrix and prioritized

---

## Why v4 supersedes v3

v3 was 878 lines of comprehensive doctrine in three deep dives (animation, decks, audio) plus surgical edits A–G. It was correct on substance but never sequenced execution. None of the deep-dive integrations actually merged into agents; the surgical edits sat as drafts.

Today (2026-04-30) the **matrix landing** shipped: the 20-category × 9-format presentation matrix (Gallery added as Format 9 later in the day per §C11), Classical / Interactive school columns, CANVAS UNLOCK, TWO-vibes rule, 2-page showcase as universal rule, CTA-MANUAL broadened and integrated. That work cleared the doctrine layer for presentations.

v4 is the post-matrix backlog: what to ship next, in what order, scoped tight enough to execute one item per pass. v3's substantive doctrine (animation grammar, audio rules, deck construction constraints) carries forward as pending integration work — those deep dives are still real, just unsequenced.

---

## What shipped 2026-04-30 (the matrix landing)

For the record, so v4 doesn't repeat them:

1. **20-category × 9-format presentation matrix** — written into `slide-decks.md`. Each row maps Category → Format(s) → Primary Objective → Content Approach → Classical Schools → Interactive Schools. Spine for Phase 1-GATED Step A. (Started as 8 formats; Gallery promoted to Format 9 later 2026-04-30 — see §C11.)

2. **Format vocabulary defined** — 9 formats (Slides / Canvas / Scrollytelling / 3D / Dashboard / Live / Timeline / Interactive / Gallery). PowerPoint editability is a sub-branch under Slides only, not a tenth format.

3. **Classical / Interactive substrate split** — schools categorized by substrate type (typography/grid vs. motion/data/code/canvas). The split governs which column a school lives in. Stamen lives in Interactive (data cartography is interactive substrate). Pentagram and Hara stay Classical (typographic editorial).

4. **CANVAS UNLOCK** — `body { width: 1920px; height: 1080px }` as a hard CSS rule is forbidden everywhere except the PowerPoint editability sub-branch (where `html2pptx.js` math requires `960pt × 540pt`). True HD is the default ASSUMPTION via CSS variables; never a lock. New "Canvas dimensions: default, never locked" section in `slide-decks.md`.

5. **TWO-vibes rule for presentations** — Phase 3 generates exactly TWO vibes per presentation (not 3-4 like landing pages). Vibe 1 CD-developed, Vibe 2 school-developed. Written into `workflow.md` After-Phase-1-GATED.

6. **2-page showcase as universal rule** — applies to ALL 9 formats, not just Slides. Per-format showcase pairings spelled out (cover+mid for Slides; hero+mid-section for Canvas; opening+transition chapter for Scrollytelling; full-grid + focus-overlay for Gallery; etc.). Both vibes follow it. Written into `workflow.md`.

7. **CTA-MANUAL.md** — moved from `docs/` to `skills/references/cta-manual.md`. Broadened from landing-pages-only to all narrative artifacts. Added format-specific Opening / Closing CTA position table for all 9 formats. Added 6th anti-pattern (investor-deck tell-not-show). TIER 2 reference inserted in `creative-director-agent.md`. Old `docs/CTA-MANUAL.md` redirect-stubbed.

These are committed. Backlog below assumes they're in place.

---

## Backlog — Track A: UI work (HUASHU integration scope)

These items require code changes to the OskarOS app, not just doctrine writes. Scope is meaningful (new tabs, asset management UI, file watching). Not one-pass surgical edits.

### A1 — BRANDING tab (full spec, integrated from BRANDING-PLAN.md)

**Scope:** A new tab inside Advanced Mode (NOT a new top-level mode) sitting alongside `view | generate | edit | compose | layout | brand`. The tab does TWO things in one place:

1. **Brand asset management** — logos, color tokens, typography, voice keywords, identity references stored ONCE per project, read by CD/WebDev on every artifact.
2. **Brand deliverable generation** — 7 prompt-driven Nano deliverables (logo / guideline / business card / pitch slide / website hero / social post / social story) that read brand data and produce production-ready assets at correct aspect ratios.

**Why this matters:** Brand assets today are scattered across IMAGES.md, chat, and Assets-panel uploads. CD scrapes each session to find logos and palette. Consolidating means CD reads once and writes vibes against a stable brand token set, AND the user can spin up a complete brand kit in <60 seconds of active work.

**Source:** This specification is the integrated form of `docs/BRANDING-PLAN.md` (now superseded by this section). Phase 1 MVP scope is single-generate; batch mode and library view are Phase 2-4 expansions.

#### A1.1 — User flow

Entry point: new tab in Advanced Mode.

```
view | generate | edit | compose | layout | brand
```

Panel layout:

```
┌─────────────────────────────────────────────────────────┐
│ BRAND                                                   │
├─────────────────────────────────────────────────────────┤
│ VIBE SELECTOR                                           │
│ [Vibe 1 — Grandma's Cliff ▼]                           │
│                                                         │
│ BRAND DATA  (pulled from vibe — click any to override) │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Business:      FalCaMel Café                        │ │
│ │ Primary Font:  Playfair Display                     │ │
│ │ Secondary:     Inter                                │ │
│ │ Target:        Saudi 30-45, dual-income…            │ │
│ │ Mood:          Warm, Nostalgic, Guilt-Inducing      │ │
│ │ Colors:        #1C1C1C  #FFD700  #DC143C  #FFFFFF   │ │
│ │ Voice sample:  "Grandma's Waiting…"                 │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ IMAGE REFERENCE  (optional)                             │
│ [ Pick from session library · None selected ]           │
│                                                         │
│ DELIVERABLE                                             │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│ │Logo  │ │Guide │ │Card  │ │Slide │ │Hero  │ │Post  │   │
│ │ 1:1  │ │ 3:4  │ │16:9  │ │16:9  │ │16:9  │ │ 1:1  │   │
│ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘   │
│ ┌──────┐                                                │
│ │Story │                                                │
│ │ 9:16 │                                                │
│ └──────┘                                                │
│                                                         │
│ [ GENERATE ]       [ GENERATE ALL ] (Phase 2)           │
└─────────────────────────────────────────────────────────┘
```

Flow:

1. **Select vibe** — dropdown lists every vibe in session state. On change, auto-populates brand data.
2. **Review / override brand data** — every field is editable. Overrides are ephemeral (cleared on vibe change).
3. **Optional image reference** — open the session image picker. Different deliverables handle this differently (Logo: "improve this mark"; Guideline: "use this as the Visual Identity Seal"; Card: "place this logo on the card").
4. **Pick deliverable** — click a tile. Does NOT generate — previews the prompt below.
5. **Click Generate** — assembles the 4-block prompt, calls Nano with the deliverable's declared aspect ratio, saves to `brand/` subfolder, shows result inline.

#### A1.2 — Deliverables Catalog (7 MVP)

All use the same 4-block prompt structure (FORMAT / STRUCTURE / BRAND DATA / CONSTRAINTS) with a shared `brandDataBlock()` helper.

| ID | Label | Aspect | Description |
|----|-------|--------|-------------|
| `logo` | Logo | 1:1 | Complete logo system — primary mark, monochrome, icon-only, wordmark — on one sheet |
| `guideline` | Brand Guideline | 3:4 | Bento sheet: title, visual identity seal, typography, color palette, iconography, mood/voice |
| `business-card` | Business Card | 16:9 | Front + back split layout at standard 85×54mm ratio |
| `pitch-slide` | Pitch Slide | 16:9 | Investor deck title slide — headline in primary font, tagline, CTA button |
| `website-hero` | Website Hero | 16:9 | Full-width hero with nav bar, headline overlay, CTA button |
| `social-post` | Social Post | 1:1 | Instagram square — bold headline, brand image, accent |
| `social-story` | Social Story | 9:16 | Instagram story — vertical full-bleed with top headline + bottom CTA |

**Logo is first on the grid.** Foundational — other deliverables can use a generated logo as image reference in subsequent passes.

#### A1.3 — Architecture

New files:

```
lib/
  brand-data.ts              # Brand data extraction + shared block builder
  brand-deliverables.ts      # The 7 deliverable templates (prompt builders)
components/advanced/
  BrandingPanel.tsx          # The tab's UI
  BrandDataEditor.tsx        # The brand-data override widget
  DeliverablePicker.tsx      # The tile grid
app/api/brand/
  generate/route.ts          # POST → Nano call → save to brand/ subfolder
```

Modified files:

| File | Change |
|------|--------|
| `components/AdvancedMode.tsx` | Add `'brand'` to the `AdvancedTab` type. Add tab button. Route to `<BrandingPanel>`. |
| `lib/types.ts` | Export `BrandData`, `DeliverableTemplate`, `DeliverableId`. |
| `lib/session.ts` | Add `writeBrandAsset(sessionId, filename, bytes)` helper if not present. |

Data flow:

```
User picks Vibe X
  ↓
BrandingPanel reads session.vibes[X] from React state
  ↓
brandDataFromVibe(vibe, businessName) → BrandData
  ↓
User picks Deliverable Y
  ↓
deliverable.build(brandData, imageRef?) → full prompt string
  ↓
User clicks Generate
  ↓
POST /api/brand/generate { sessionId, vibeKey, deliverableId, brandOverrides?, imageRef? }
  ↓
Server: re-assemble prompt + call Nano with correct aspect ratio
  ↓
Save: public/{sessionId}/brand/brand-{vibeKey}-{deliverableId}-v{n}.jpg
  ↓
Return { filename, url } → client renders inline
```

#### A1.4 — Data Model

```ts
// lib/brand-data.ts

export interface BrandData {
  businessName: string         // from session.businessName or vibe.name
  fontHeading: string          // vibe.typography.heading
  fontBody: string             // vibe.typography.body
  audience: string             // vibe.audience OR "whoItsFor" OR "Target"
  mood: string                 // vibe.mood (comma-joined if array)
  colors: string[]             // vibe.colors — [primary, secondary, accent, text]
  voiceSample: string          // first vibe.voiceSamples entry OR vibe.tagline
  oneLiner?: string            // vibe.headline / vibe.tagline
}

export function brandDataFromVibe(vibe: VibeData, businessName: string): BrandData
export async function brandDataFromFile(sessionId: string, vibeKey: string): Promise<BrandData | null>
export function brandDataBlock(b: BrandData): string
```

```ts
// lib/brand-deliverables.ts

export type DeliverableId =
  | 'logo' | 'guideline' | 'business-card'
  | 'pitch-slide' | 'website-hero'
  | 'social-post' | 'social-story'

export interface DeliverableTemplate {
  id: DeliverableId
  label: string
  aspectRatio: AspectRatio
  thumbnailEmoji: string
  description: string
  build: (brand: BrandData, imageRef?: string) => string
}

export const BRAND_DELIVERABLES: DeliverableTemplate[]
```

#### A1.5 — Shared brand-data block

Every deliverable prompt embeds:

```
# BRAND DATA
Business: {businessName}
Primary Font: {fontHeading}
Secondary Font: {fontBody}
Target Audience: {audience}
Mood: {mood}
Colors: {color1} | {color2} | {color3} | {color4}
Voice sample: {voiceSample}
```

Implemented in `brandDataBlock()`. One edit there updates every deliverable.

#### A1.6 — The 7 Prompt Templates

Every prompt follows the **4-block pattern**: FORMAT · STRUCTURE · BRAND DATA · CONSTRAINTS.

##### Logo (1:1)

```
# FORMAT
Deliverable: Complete logo system on one sheet
Aspect: 1:1 square
Register: Pentagram brand identity / Saul Bass modernism — clean, confident, reproducible at any scale

# STRUCTURE
Four-quadrant layout on a clean neutral background:
  - Top-left: PRIMARY LOGO (full lockup — icon + wordmark)
  - Top-right: MONOCHROME version of the primary logo (single color, for stamping/embossing)
  - Bottom-left: ICON / SYMBOL alone (app-icon ready, centered in its frame)
  - Bottom-right: WORDMARK alone (business name in {fontHeading}, no icon)
Each quadrant labeled in small {fontBody} caps beneath.
14px gutter between quadrants. Unified diffused daylight across the sheet.

{brandDataBlock}

# CONSTRAINTS
- Do not render any of the source image verbatim. Create an original mark informed by the brand data.
- The icon must work at 16px (favicon scale) — no fine detail that would disappear.
- Use ONLY the declared colors. No gradients unless two of the declared colors are blended.
- No Lorem Ipsum. No invented taglines. Only the business name appears in the wordmark.
- Pure background (white or the declared secondary color), no photo textures.

{image description, if imageRef provided — otherwise "No reference image — design from the brand data alone."}
```

##### Brand Guideline (3:4)

```
# FORMAT
Deliverable: Brand Identity Guideline — single-page bento infographic
Aspect: 3:4 portrait
Register: Pentagram rebrand / IBM design standards — editorial, precise, high-end

# STRUCTURE
Non-overlapping bento grid. Named cells:
  - Title (top band, full-width) — business name in {fontHeading} + one-line tagline
  - Visual Identity Seal v1.1 — the logo/mark (from image reference)
  - Typography — Primary Font ({fontHeading}) sample + Secondary Font ({fontBody}) sample, both with full alphabet + size scale
  - Color Palette — four swatches rendered with EXACT 6-digit hex codes + usage notes
  - Iconography & Asset Suite — 6 minimal line icons in {fontBody} style, 2px stroke, rounded corners
  - Mood & Brand Voice — bold headline in {fontHeading}, 3-4 sentences of brand voice in {fontBody}
14px gutter between cells. Unified diffused beauty light.

{brandDataBlock}

# CONSTRAINTS
- The provided image IS the Visual Identity Seal — render it directly in that cell. Do not redraw.
- Render all hex codes as EXACT 6-digit strings. No color approximations.
- No Lorem Ipsum. Use the provided voice sample and mood adjectives verbatim.
- No cell may overlap another. Respect the 14px gutter.
- No fake logos, partner marks, or invented content beyond what's in the brand data.

{image description}
```

##### Business Card (16:9)

```
# FORMAT
Deliverable: Business Card — front and back, side by side
Aspect: 16:9 landscape
Register: Pentagram / minimalist — clean, confident, premium paper stock feel

# STRUCTURE
Two panels separated by a 14px white gutter:
  - LEFT (front): Business name in {fontHeading} centered or offset. Logo/mark area. Accent color strip along one edge. Minimal.
  - RIGHT (back): Contact field placeholders in {fontBody} — "[NAME]", "[TITLE]", "[EMAIL]", "[PHONE]", "[WEBSITE]". Small QR code area bottom-right. Secondary color background.
Both sides share the same outer dimensions. Card edges subtly visible against a neutral surface.

{brandDataBlock}

# CONSTRAINTS
- Do not invent a logo not present in the source image. If no source image provided, use a clean wordmark of the business name in {fontHeading}.
- Use realistic field placeholders: "[NAME]", "[EMAIL]", etc. No Lorem Ipsum, no fake names.
- Render hex codes correctly if any are shown.
- Both sides must share the same palette. Don't drift between the two sides.

{image description}
```

##### Pitch Slide (16:9)

```
# FORMAT
Deliverable: Pitch Deck Title Slide
Aspect: 16:9 landscape (Keynote/Powerpoint native)
Register: Stripe / Linear / Apple keynote — confident, minimal, premium

# STRUCTURE
Single-slide composition:
  - Headline (top-third or centered): business one-liner in large {fontHeading}
  - Subtitle: voice-sample sentence in {fontBody}, muted color
  - CTA element: a single button/pill in the accent color with white text
  - Brand mark: small, bottom-left or top-right corner
  - Background: subtle gradient of primary + secondary colors OR brand image full-bleed with dark overlay
Generous negative space. No bullet points.

{brandDataBlock}

# CONSTRAINTS
- ONE headline only. No sub-bullets. No multi-point lists. This is a title slide.
- CTA text: "Learn More" or "Get Started" or use the brand's voice sample verbatim if short enough.
- No placeholder company logos ("YOUR LOGO HERE"). Either render the source image as the mark, or a clean wordmark.
- No stock-photo people. Use the brand image OR an abstract gradient.

{image description}
```

##### Website Hero (16:9)

```
# FORMAT
Deliverable: Website hero section — desktop render, above-the-fold
Aspect: 16:9 landscape (can also render 21:9 letterbox — declare 16:9 for default)
Register: High-end web design — Stripe, Arc, Vercel — crisp, generous, loaded

# STRUCTURE
Top-to-bottom layout:
  - NAVIGATION BAR (top 8% of height): brand wordmark left, 3-4 nav links in {fontBody} right, subtle 1px underline or pill CTA
  - HERO CONTENT (middle 70%): headline in {fontHeading} on the left third, subtitle in {fontBody} below, accent-colored CTA button
  - HERO IMAGE (right two-thirds OR full-bleed background): the source image positioned with slight parallax framing
  - SUBTLE DETAIL (bottom 8%): a thin accent divider + scroll indicator

{brandDataBlock}

# CONSTRAINTS
- Nav links: use realistic, minimal link labels — "Home", "Menu", "Reservations", "Contact" — not "Link 1", "Link 2".
- ONE CTA button only. Accent color background, white text, rounded corners.
- Headline: business voice sample verbatim, NOT invented.
- No fake testimonials, star ratings, or press logos.
- Mobile/tablet variants NOT included — desktop only at this aspect.

{image description}
```

##### Social Post (1:1)

```
# FORMAT
Deliverable: Instagram feed post
Aspect: 1:1 square
Register: Bold, scroll-stopping editorial — designed to stop a thumb

# STRUCTURE
Either:
  (a) Full-bleed brand image with a bottom 40% dark gradient and headline in large {fontHeading} overlay, OR
  (b) Split composition — left half bold color block with headline in {fontHeading}, right half full-bleed brand image
Include a subtle brand mark (bottom-right corner, small).
Generous negative space. No text layered over busy image areas.

{brandDataBlock}

# CONSTRAINTS
- Headline under 8 words. Punchy. Use the brand voice sample or a natural variation.
- One CTA at most — "Book Now", "Reserve", "Open Menu". Or NO CTA (just brand presence).
- No hashtags in the image. No emojis in the image.
- No fake likes, comments, or social UI chrome — this is the post artwork only.

{image description}
```

##### Social Story (9:16)

```
# FORMAT
Deliverable: Instagram story
Aspect: 9:16 vertical
Register: Vertical scroll-stopper, full immersion — phone-native

# STRUCTURE
Top-to-bottom:
  - Top 15%: headline in {fontHeading}, bold, large, overlay on the image
  - Middle 60%: full-bleed brand image
  - Bottom 25%: voice sample sentence in {fontBody} + a prominent "Swipe Up" / tappable CTA in accent color
Safe zones: keep headline below the 10% mark (avoid phone status bar) and CTA above the 10% bottom mark (avoid IG UI overlay).

{brandDataBlock}

# CONSTRAINTS
- Absolutely no Lorem Ipsum.
- CTA: pill-shaped, accent color, centered horizontally.
- No invented engagement metrics (no fake reactions, viewer counts).
- No phone chrome in the render — just the story content.

{image description}
```

#### A1.7 — Workpackages (sequenced)

**WP-B1 — Brand Data Extraction.** `lib/brand-data.ts` with `BrandData` interface, `brandDataFromVibe()`, `brandDataFromFile()`, `brandDataBlock()`. Unit + integration test.

**WP-B2 — Deliverable Catalog + Prompt Builders.** `lib/brand-deliverables.ts` with `BRAND_DELIVERABLES` array (7 entries). Each template has `id`, `label`, `aspectRatio`, `thumbnailEmoji`, `description`, `build()`. Pure functions — no React, no fs.

**WP-B3 — BrandingPanel UI.** Three components: `BrandingPanel.tsx` (tab body), `BrandDataEditor.tsx` (inline-editable brand-data fields with reset), `DeliverablePicker.tsx` (tile grid).

**WP-B4 — Generate API + Client Wiring.** `app/api/brand/generate/route.ts` POST handler that takes `{ sessionId, vibeKey, deliverableId, brandOverrides?, imageRef? }`, assembles prompt, calls Nano with correct aspect ratio, saves to `public/{sessionId}/brand/`, returns `{ filename, url }`. Auto-catalog: append entry to IMAGES.md under new `## Brand Assets` section.

**WP-B5 — Advanced Mode Integration.** Add `'brand'` to `AdvancedTab` union. Add tab button. Route `brand` tab to `<BrandingPanel>`. Export new types from `lib/types.ts`.

#### A1.8 — Output naming + cataloging

Naming convention:

```
public/{sessionId}/brand/brand-{vibeKey}-{deliverableId}-v{n}.jpg
```

Examples: `brand-vibe-1-logo-v1.jpg` / `brand-vibe-3-pitch-slide-v2.jpg`.

On successful generation, append to IMAGES.md under `## Brand Assets`:

```markdown
## Brand Assets

### brand-vibe-1-logo-v1.jpg
Generated: 14:23:07
Vibe: Vibe 1 — Grandma's Cliff
Deliverable: Logo
Aspect: 1:1
Prompt source: Branding tab, BRAND_DELIVERABLES.logo
CD Analysis: [auto-generated by Nano description pass, if enabled]
```

#### A1.9 — Aspect ratio handling

The `DeliverableTemplate.aspectRatio` is authoritative. The API route passes it as a separate Nano parameter. The prompt body ALSO states the aspect ratio (belt + suspenders — Nano sometimes drifts without explicit prompt mention).

Supported: `1:1`, `16:9`, `9:16`, `3:4`. All four are in Nano's allowed list.

#### A1.10 — Phasing

- **Phase 1 — MVP (~1 session):** All 7 deliverables. Single-generate only. Brand data pulled from vibe with manual override. Auto-save to `brand/` subfolder. Auto-catalog to IMAGES.md.
- **Phase 2 — Batch Mode (~0.5 session):** "GENERATE ALL 7" button. Parallel Nano calls (3-4 concurrent, respect rate limits). Streaming UI: tiles fill in as each result arrives. Progress indicator per deliverable.
- **Phase 3 — Extended Catalog:** Letterhead (3:4), Packaging mockup (1:1 or 3:4), Merchandise preview — T-shirt/tote/mug (4-panel grid, 1:1), Signage (16:9), Email signature block (16:9), Menu / price list (3:4). All Phase 3 additions are new `DeliverableTemplate` entries — zero framework changes.
- **Phase 4 — Brand Library View:** Dedicated gallery view of all brand assets generated for this session. Group by vibe, then by deliverable type. One-click re-download as ZIP.

#### A1.11 — Open decisions resolved

| Decision | Choice |
|----------|--------|
| Tab or new top-level mode? | Tab inside Advanced Mode |
| State vs re-parse for brand data | Prefer VibeData in React state; fall back to `brandDataFromFile()` |
| Persistent vs ephemeral overrides | Ephemeral — cleared on vibe change |
| Batch mode timing | Phase 2, after single-generate is proven |
| Output location | `public/{sessionId}/brand/` subfolder |
| Auto-catalog | Yes, to IMAGES.md under `## Brand Assets` section |
| Phase 1 deliverable count | 7 (Logo, Guideline, Card, Pitch Slide, Hero, Post, Story) |

Deferred (Phase 2+):
- Image reference flow for Logo: should the first "Logo" generation produce the seal, then subsequent deliverables auto-reference `brand-{vibeKey}-logo-v1.jpg`?
- Does CD interact with the Branding tab? (Phase 4: CD reviews brand outputs, approves/rejects, triggers regeneration with notes)
- Does the Branding tab have a prompt-editable mode? (Show assembled prompt → let user tweak → send) → Phase 2, gated behind a "Show prompt" toggle.

#### A1.12 — Test plan

1. **Session setup:** open a session with 4+ built vibes, each with complete brand data.
2. **Tab access:** Advanced Mode → Brand tab → panel loads.
3. **Vibe selection:** dropdown lists all vibes. Select Vibe 1 → brand data populates within 200ms.
4. **Field override:** change heading font to "Bodoni". Editor shows "Bodoni" with override indicator. Change vibe → override cleared.
5. **Deliverable selection:** click Logo → tile highlights. Click Guideline → Guideline highlights, Logo deselects.
6. **Single generate — Logo:** click Generate. Loading state. After 10-30s, image renders inline. File saved to `public/{sessionId}/brand/brand-vibe-1-logo-v1.jpg`.
7. **IMAGES.md catalog:** open IMAGES.md. New `## Brand Assets` section exists with one entry for the logo.
8. **Iterate — regenerate:** click Generate again. New file `-v2.jpg`. Panel shows v2; v1 still on disk.
9. **All deliverables:** generate each of the 7 for Vibe 1. Verify 7 files, 7 IMAGES.md entries, aspect ratios correct.
10. **Cross-vibe consistency:** generate a Logo for Vibe 2. Side by side with Vibe 1 — visibly different (brand data is ACTUALLY driving output).
11. **Empty state:** session with no vibes → "No vibes yet — build vibes first to generate brand assets."
12. **Missing brand data:** vibe with empty fonts/colors → editor highlights missing fields. Generate disabled until minimum viable brand data present.

#### A1.13 — Success criteria

Phase 1 ships when:

- [ ] All 7 deliverables generate successfully for a vibe with complete brand data
- [ ] Each output matches its declared aspect ratio (measure pixel dimensions, not "looks right")
- [ ] Brand data is visibly reflected in every output (fonts match, colors match, voice sample appears where prompt asks)
- [ ] Iterating generates versioned files, no overwrites
- [ ] Files are discoverable in IMAGES.md
- [ ] Tab is stable across switches — no state loss
- [ ] Typecheck passes, no new ESLint errors

#### A1.14 — Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Nano ignores aspect ratio in prompt body | Pass aspect ratio as explicit API parameter. Prompt body is secondary. |
| Brand data in VibeData is incomplete (missing mood, incomplete colors) | Editor highlights missing fields. Generate disabled until minimum viable brand data present. |
| Generated deliverables feel template-y | Each prompt includes a `Register:` line pointing to a specific high-end reference (Pentagram, IBM, Stripe). Stress-test with diverse vibes; refine prompts based on outputs. |
| Users edit heading font in Branding, expecting persistence to vibe | Override indicator + explicit "This change is for this generation only. Update the vibe to make it permanent." copy. |
| Logo generates something that looks nothing like source image | Logo prompt explicitly says "Do not render the source verbatim — design an original mark informed by the brand data." If users want 1:1 logo redraw, that's a different deliverable (logo-restyle, Phase 3). |

#### A1.15 — Acceptance criteria for §A1 itself (the integration-level gate)

This subsection ships when:
- All 5 workpackages WP-B1 through WP-B5 are complete and tested
- BRANDING tab visible in Advanced Mode
- 7 deliverables generate at correct aspect ratios
- Brand assets auto-catalog to IMAGES.md
- CD reads brand state on cold-boot per Phase 1-GATED Step D Design System resolution (this is the doctrine layer landing)

**A1 supersedes `docs/BRANDING-PLAN.md` in full.** That file is now redirect-stubbed pointing to this section.

### A2 — Scene-templates redistribution into BRANDING tab

**Scope:** `skills/references/scene-templates.md` ships 8 templates (WeChat cover / article hero / infographic / PPT slide / PDF white paper / landing page / app UI / Xiaohongshu image). The user's intent: most of these don't belong in slide-decks.md doctrine; they're brand-asset templates that belong in the new BRANDING tab.

**Per-template fate:**

| # | Template | Fate |
|---|---|---|
| 1 | WeChat subscription cover / article hero | Move to BRANDING tab — branded social-media collateral |
| 2 | Article inline illustration | Move to BRANDING — branded editorial imagery |
| 3 | Infographic / data visualization | Split: data-viz-as-brand-asset → BRANDING; data-viz-as-Dashboard-template → `slide-decks.md` Dashboard format |
| 4 | PPT / Keynote slide (16:9 1920×1080) | Already referenced as anchor in `slide-decks.md` Slides format. Keep that reference. Delete the duplicated content from scene-templates.md once moved. |
| 5 | PDF white paper / technical report | Move to BRANDING tab as branded PDF export template |
| 6 | Landing page / product website | Already covered by landing-page workflow (`workflow.md` Phase 1 standard path). Delete from scene-templates.md after confirming. |
| 7 | App UI / iOS-Android prototype | Move to BRANDING tab as Interactive Presentation Format / branded prototype template |
| 8 | Xiaohongshu (RED) image | DELETE. Out of scope for OskarOS use cases. |

**After redistribution:** `skills/references/scene-templates.md` is empty / redundant → delete the file. Update `creative-director-agent.md` SCRIPTS / ASSETS section to remove the scene-templates.md reference (currently at line ~163 in TIER 2).

**Order:** Cannot complete this until A1 (BRANDING tab) exists, because templates 1/2/3a/5/7 need a destination.

### A3 — Existing `editable-pptx.md` → `export-formats.md` rename + content move

**Scope:** Today's `slide-decks.md` is heavily Slides-deep — single-file vs multi-file architecture, deck-stage CSS trap, html2pptx constraints, export script docs. All of this is **export and architecture mechanics**, not category/format doctrine. It belongs in a sibling file.

**Plan:**
1. Rename `skills/references/editable-pptx.md` → `skills/references/export-formats.md`.
2. Move the architecture / export sections out of `slide-decks.md` into `export-formats.md`:
   - "🛑 Architecture first: single file or multi-file?" (lines ~221-258)
   - "Path A (default): multi-file architecture" (lines ~261-348)
   - "Path B (small deck): single file + deck_stage.js" (lines ~352-425)
   - "Print to PDF" / "Export to PPTX / PDF" / "Export pipelines" sections (lines ~520-700)
   - The export script documentation
3. `slide-decks.md` keeps: matrix, format details, format-aware doctrine, content approach templates (incoming per C1), per-format production grammar (incoming per C2), 2-page showcase rule.
4. `export-formats.md` becomes the sibling reference for: how HTML5 decks become PDF / PPTX / web archive. The existing 4 hard PowerPoint constraints stay there as the editable-PPTX section, with the architecture content joining it.
5. Update all cross-references (`creative-director-agent.md`, `workflow.md`, `slide-decks.md` itself) to point to `export-formats.md`.

**Acceptance criteria:**
- `slide-decks.md` is doctrine-only (matrix + format details + content templates + per-format production + showcase rule + verification checklist for HTML output).
- `export-formats.md` is mechanics-only (HTML → PDF / HTML → PPTX / single-file vs multi-file architecture / deck_stage.js usage / script invocations).
- No content duplication.
- All cross-references resolve.

**Order:** Independent of A1 / A2. Can proceed anytime.

### A4 — Image-slot vocabulary canonical table (user-facing)

**Scope:** The After-Phase note in `workflow.md` mentions slot naming conventions in passing (`slide-3-hero`, `chapter-2-bg`, `kpi-card-1`). These should be promoted to a canonical user-facing table per format, telling the user "your deck has these slots — drop assets into them."

**Per-format slots (rough — to be fleshed out):**

- **Slides:** `cover-bg`, `slide-N-hero`, `slide-N-chart`, `slide-N-portrait`, `slide-N-icon`, `closing-bg`
- **Canvas:** `hero`, `section-N-bg`, `gallery-N`, `cta-bg`
- **Scrollytelling:** `chapter-N-intro-bg`, `chapter-N-parallax-1`, `chapter-N-parallax-2`, `transition-N-bg`
- **3D:** `model-gltf`, `environment-hdri`, `caption-overlay`
- **Dashboard:** `kpi-card-N-icon`, `chart-N-bg`, `brand-mark`
- **Live:** `poll-graphic-N`, `presenter-avatar-N`
- **Timeline:** `phase-N-marker`, `milestone-N-art`
- **Interactive:** `quiz-N-illustration`, `hotspot-N-art`

**Deliverable:** New section in `slide-decks.md` titled "Image slot vocabulary per format" — sits in the Format details area or as its own section. CD references it when writing image manifests; user references it when uploading assets to the Assets panel.

**Order:** Independent of A1-A3. Surgical edit, can be done one-pass.

---

## Backlog — Track B: Doctrine completion (one-pass surgical edits)

These are smaller, can be done in single passes without UI changes.

### B1 — Content Approach templates (HIGH PRIORITY)

**Scope:** The matrix names content approaches (Problem-first / Hero's Journey / Pyramid / SCQA / etc.) but doesn't define their slide sequences. Without this, every deck is a fresh invention.

**Templates to draft (one section each in `slide-decks.md`):**

- **Problem-first** (Investor Pitch / Sales / Capabilities): 8-12 slide skeleton starting with Hook → Problem → Why now → Solution → How → Proof → Why us → Ask
- **Hero's Journey** (Product Launch / Marketing Portfolio): Status quo → Inciting incident → Journey → Transformation → Reveal → Call
- **Pyramid (Conclusion-first)** (Corporate Board): Conclusion → 3 supporting pillars → Detail per pillar → Risks → Approval ask
- **SCQA** (Business Strategy): Situation → Complication → Question → Answer → Supporting evidence
- **Goal-Plan-Achievement** (Project Proposal): Goal → Plan → Milestones → Risks → Approval
- **What-So What-Now What** (Status Update): What happened → So what → Now what → Asks
- **Sequential / Active** (Educational / Training): Concept → Application → Exercise → Feedback → Next
- **Hook-Problem-Solution** (Elevator Pitch): Hook → Problem → Solution → Proof → Ask (3-5 slides max)
- **Welcome-Path-Training** (Employee Induction): Welcome → Day 1 → Week 1 → Month 1 → First-day path
- **Mutual Benefit** (Partnership Pitch): Their world → Our world → Shared opportunity → Joint value → Partnership ask
- **Performance-Forecast** (Financial Report): Headline → Performance → Drivers → Forecast → Asks
- **Show-Don't-Tell** (Product Demo): Setup → Demo → Outcome → Detail → Try
- **Narrative Arc** (Conference Talk): Hook → Build → Insight → Application → Call
- **Problem-Solution Snapshot** (Interactive One-Pager): Problem → Solution → Proof → CTA (single scroll page)
- **Synchronous Conversation** (Webinar): Welcome → Frame → Content → Audience input → Synthesis → Close
- **Success Story Narrative** (Case Study): Before → Trigger → Approach → Result → Lesson
- **Situation-Opportunity-Resolution** (Marketing Portfolio): Project context → Brief → Approach → Outcome → Visual showcase
- **Explanation Model** (Technical / Scientific): Background → Concept → Mechanism → Demo → Implications
- **Transactional ROI** (Sponsorship Proposal): Audience → Value → Tiers → Past results → Ask

**Per-template structure:** ~5-12 slides skeleton, each slot tagged optional/variable. Header note: "these are guardrails not harness — deviate when the brief warrants. The skeleton prevents fresh-invention; the variation lets the brief breathe."

**Deliverable:** New section in `slide-decks.md` titled "Content Approach templates" between Format details and any per-format production guidance. ~100-150 lines.

**Order:** Independent. One-pass edit. **Highest doctrinal priority** because it's the gap that most prevents WebDev from seeding decks correctly.

### B2 — Per-format production guidance for non-Slides formats

**Scope:** `slide-decks.md` Slides format has full production doctrine (architecture, per-slide template skeleton, publication grammar, common pitfalls, deck-stage CSS trap, etc.). The other 7 formats get only a 10-line "Format details" block — no architecture, no template, no pitfalls.

**Deliverable per format (~100 lines each):**

- **Canvas** — page-as-artifact architecture, sticky-chapter pattern, parallax layer rules, common pitfalls (over-scrolling fatigue, decoration without purpose), example skeleton
- **Scrollytelling** — Intersection Observer pattern, GSAP ScrollTrigger usage, sticky chapter grammar, scroll-coupled motion vocabulary, common pitfalls (jank on slow scroll, misaligned beats)
- **3D** — Three.js scene structure, GLTF loader pattern, lighting setup, performance budget (LOD), AR via WebXR (when), common pitfalls (mobile GPU drowning, asset format mismatch)
- **Dashboard** — KPI panel grid, drill-down pattern, WebSocket data plumbing, filter rail UX, common pitfalls (live-data race conditions, unauthenticated read-only mode)
- **Live** — Mentimeter / Slido embed pattern, OskarOS-native poll widget pattern, REPL cell pattern (Monaco / CodeMirror), common pitfalls (unmuted-audio gotcha, presenter-vs-audience screen fork)
- **Timeline** — phase-card grammar, gantt library options, state persistence, common pitfalls (overcrowded phases, unclear current-state)
- **Interactive** — H5P framework usage OR custom-branching pattern, localStorage state, quiz / hotspot / drag-drop / branching scenarios, common pitfalls (state corruption, no-progress-feedback)

**Order:** Big lift. ~700 lines new doctrine. Ship in two phases: B2a (Canvas + Scrollytelling + Dashboard, the most-used) first; B2b (3D + Live + Timeline + Interactive) second.

### B3 — Interactive column rename

**Scope:** The user has flagged "Interactive Schools" column header as misleading. Pending alternative naming.

**Candidates:**
- "Motion-driven Schools"
- "Live-substrate Schools"
- "Active Schools"
- "Expressive Schools"
- "Dynamic Schools"

**Deferred until a better name lands.** Not blocking.

---

## Backlog — Track C: v3 carry-forward (still pending, independent of matrix work)

These are v3's substantive integration items that never merged. They remain real — animation, audio, deck construction, cross-vibe coherence, quality bar all still leak today. The matrix landing didn't address them.

### C1 — Animation Audit Gate (Sentinel Ti)

Per v3 §1D. Sentinel Ti runs an animation audit AUTOMATICALLY on every WebDev `## BUILD COMPLETE` for any vibe containing animation. Playwright capture → perceptual checks (first-paint flicker, easing identifiability, Slow-Fast-Boom-Stop rhythm, yielding pause, abrupt-cut endings, stagger, hover-stuck, reduced-motion respect, layer count, GPU on idle).

Fix for "utterly incapable of seeing faulty code." Self-blindness can't be patched with self-discipline.

**Deliverable:** Insert "Animation Audit Gate" section into `agents/sentinel-ti.md`. Auto-fires on `## BUILD COMPLETE`.

### C2 — Animation Direction block per vibe (CD-side)

Per v3 §1E. CD writes a block per vibe in CREATIVE-BRIEF.md / vibe-X.md:

```
## Animation Direction — Vibe N: {name}
- School: {Pentagram / Field.io / Active Theory / Locomotive / Apple-grade / Anthropic-grade / Editorial / Brutalist}
- Reference works: 2-3 URLs
- Beat structure: 5-beat timeline OR scroll-progress mapping OR "micro only"
- Easing default: expoOut / overshoot / spring / school-specific
- Forbidden moves: what kills this school's identity for THIS vibe
- Audio paired: yes/no
```

**Deliverable:** Insert into `creative-director-agent.md` Phase 3 vibe-writing section. Required block per vibe.

### C3 — Animation Discipline (WebDev-side)

Per v3 §1E. Insert into `agents/webdev-agent.md`:

```
## Animation Discipline

Before writing any animation:
1. READ Animation Direction in vibe-X.md (CD writes this).
2. READ skills/references/animations.md, animation-best-practices.md, animation-pitfalls.md.
3. READ public/{session}/ANIMATION-MEMORY.md if it exists.

While writing:
1. Default main easing is expoOut. NOT ease, NOT linear.
2. Animate ONLY transform and opacity.
3. Duration ladder: 80ms / 200ms / 400-500ms / 800ms+.
4. For narrative animations, follow Slow-Fast-Boom-Stop 5-beat structure.
5. Yielding pause ≥300ms before key info.
6. End on abrupt cut + hold. Not on fade.
7. position: relative on every container holding position: absolute children.
8. document.fonts.ready before any layout measurement.
9. IntersectionObserver: disconnect after firing if one-shot.
10. prefers-reduced-motion: handle it.

After writing:
1. Sentinel Ti will fire the Animation Audit Gate automatically.
2. Read Ti's verdict before declaring done.
3. NEVER ship animation that hasn't passed Ti's audit.
```

**Deliverable:** Insert into `agents/webdev-agent.md` build instructions.

### C4 — INSTITUTIONAL-MEMORY.md project-wide (REVISED 2026-04-30)

**Originally specced as `ANIMATION-MEMORY.md` per-session (animation-only, owned by Sentinel Ti).** Ralph 2026-04-30 generalized the spec because animation isn't the only domain where a bug eats 3+ turns to fix. The dollar-reset bug took 6+ turns across multiple sessions and would have been caught instantly if there were a project-wide log of "what broke, why, how to recognize it next time." Animation gets its own log section, but the file's scope is the whole project.

**File:** `docs/INSTITUTIONAL-MEMORY.md` — project-wide, single-file, append-only.

**Owner:** Everyone — CD, WebDev, Sentinel Ti, Sage, Ralph, any Jedi Claude. The first agent (or Ralph) to recognize a 3+-turn failure logs it. Subsequent agents read the file on cold-boot to avoid the same trap.

**Logging trigger — the 3-turn rule:**
- If fixing a single bug took **3 or more iterations** (turns of "I tried X, that didn't work, I tried Y, still broken, …"), log it.
- The trigger is independent of domain. Animation, UX, API plumbing, file I/O, race conditions, doctrine misalignment — any class of bug.
- The bar is "I burned at least three rounds before the fix held," not "I think this is interesting."

**Each entry must record:**
- Date + session ID (or "across sessions")
- One-line symptom (what the user / Ralph saw)
- Turn count (rough: how many failed attempts before resolution)
- Root cause — the actual mechanism, named precisely. NOT "it was confusing" or "I forgot." A real causal handle: "stdin pipe buffer + premature .end() race" or "two-click arm pattern with subtle visual feedback that nobody saw"
- Fix applied — the change that finally landed
- Lesson — how a future agent recognizes this class of bug before re-burning the turns
- Tags — `#animation`, `#ux`, `#api`, `#race`, `#stdin`, `#caching`, etc.

**Sections (preserve animation-specific buckets within):**
- Failure Log (chronological — every 3+-turn fix gets an entry)
- Don't-Do List (one-line rules distilled from the failure log; the most-repeated mistakes get promoted here)
- Animation-specific sub-section (covers what the original ANIMATION-MEMORY.md spec wanted: tested patterns, school fingerprints, promote-to-skills candidates)
- Promote-to-Skills Candidates (lessons that have appeared across 2+ entries are candidates for moving into `skills/` as doctrine; Sage triages on cold-boot)

**Deliverable:** File template at `docs/INSTITUTIONAL-MEMORY.md`. CD agent reads on cold-boot (after CD-MEMORY.md). All four agents (CD, WebDev, Sentinel Ti, Sage) have permission to append. Ralph appends manually when an agent forgets.

### C5 — Audio decision gate + construction

Per v3 §3. Two-track audio (BGM 0.40-0.50 + SFX 1.00 with frequency separation BGM lowpass=4000 / SFX highpass=800). Density brackets 0-3 / 4-5 / 6-9 per 10s by personality. P0/P1/P2 cue priority.

**Deliverable:** Insert "Audio Direction" block per vibe into CD; insert "Audio Construction" section into WebDev. Both per v3 §3 drafts. Ti audit extends to audio when vibe has Audio paired: YES.

### C6 — Cross-vibe coherence (4-axis differentiation)

Per v3 "Cross-vibe coherence rule." When CD writes 4 vibes for a landing-page project (NOT decks — decks use TWO-vibes rule per matrix), they must DIVERGE on at least 2 of: persona, school, hook, register. Two vibes sharing 2+ axes = same vibe at different fidelities.

**Deliverable:** Insert into `creative-director-agent.md` Phase 3. Reject criterion enforced before `## VIBES READY`.

### C7 — Quality bar 5-10-2-8

Per v3 "Quality bar mechanism." `SKILL.md` §1.a "5-10-2-8 quality bar" becomes a literal checklist in CREATIVE-BRIEF.md:

```
## §1.a Quality Bar
- [ ] 5+ brand-specific signals identified (logo, product photo, UI, color, font, voice keyword)
- [ ] 10+ brand-specific copy lines drafted
- [ ] 2+ hero-quality assets confirmed
- [ ] 8+ {confirm fourth number from SKILL.md re-read}
```

CD ticks boxes as discovery progresses. Junior Pass cannot trigger until all four are checked.

**Deliverable:** Insert into `creative-director-agent.md` Phase 1 / 2 transition.

### C8 — CD-MEMORY ↔ skills/ promotion path (Sage)

Per v3 "CD-MEMORY ↔ skills/ promotion path." Sage triages CD-MEMORY entries for promotion to skills/ when (a) lesson has appeared in 2+ projects, (b) lesson is generalizable, (c) clear skills/ destination exists.

**Deliverable:** Insert into `agents/dreamer-agent.md` (Sage). Tag `[CANDIDATE FOR SKILLS]` on candidates; CD reviews on next session boot.

### C9 — Cull list (currently-unused files)

Two files (revised from v3 — apple-gallery-showcase.md is reclassified to C11 below as integrated active doctrine, NOT a cull-list item):

- `skills/references/design-context.md` (213 lines) — REVIVE. Fill with bridge doctrine (Position → audience persona → school → execution). Allocate one session.
- `skills/references/tweaks-system.md` (313 lines) — REVIVE. Add to CD's optional toolkit; document `?tweaks=on` mode trigger for client A/B comparisons.

**Order:** Cull list is cleanup work, not blocking. Defer until B1 / B2 / C1-C5 done.

**NOTE: `skills/references/apple-gallery-showcase.md` was on this list in v3 with a wrong description ("mobile knowledge base"). It's actually a gallery showcase wall animation pattern. Reclassified to C11 as integrated active doctrine.**

### C10 — Legacy inventory (30+ vibes built without skill compliance)

Per v3. Hybrid plan: active vibes audited and brought into compliance; inactive vibes moved to `legacy/`. New work uses new gates from day one.

**Deliverable:** Audit pass + directory restructure. Cleanup work. Defer.

### C11 — Gallery format (promoted to Format 9 in the matrix)

**Status: SHIPPED 2026-04-30 (matrix integration). C11.8 integration deliverables remaining.**

This was originally framed in v3 as a "reusable design pattern" with a TIER 2 trigger. The 2026-04-30 reread revealed it's a **distinct presentation format** — multi-output showcase wall in CSS-3D-tilted perspective with timeline-driven animation. Not an animation overlay on top of Canvas; not a Scrollytelling sub-mode; its own structural pattern.

**Decision:** promoted to Format 9 in the matrix (Option A from the 2026-04-30 reread). Matrix and format details now ship Gallery as a first-class format alongside Slides / Canvas / Scrollytelling / 3D / Dashboard / Live / Timeline / Interactive.

**Source:** `skills/references/apple-gallery-showcase.md` (338 lines). Live skill reference. The substantive doctrine (visual tokens, layout patterns, animation patterns A-E, timeline architecture, craft details, failure modes) is folded into this section below so v4 is self-contained for backlog reasoning. The skill file remains at `skills/references/` as the canonical runtime read for CD/WebDev when implementing the format.

**What landed 2026-04-30 (matrix integration):**
- `slide-decks.md` title and matrix headers updated from "8 formats" to "9 formats"
- Gallery row added to the 9-format table with structural definition
- Categories #2 Product Launch, #7 Marketing Portfolio, #17 Product Demo updated to include Gallery in their format columns
- New "Gallery — multi-output showcase wall" section in Format details
- 2-page showcase Rule 2 in `workflow.md` extended with Gallery pairing (full-grid wide shot + focus-overlay zoom)
- `creative-director-agent.md` and `webdev-agent.md` Presentations blocks updated with the 9-format list and Gallery pointer to `apple-gallery-showcase.md`
- `workflow.md` v3.7 → v3.8 with the Gallery promotion noted in the changelog

**What still ships under §C11.8 (the integration deliverables remaining):**
- TIER 2 trigger entry in `creative-director-agent.md` for Gallery-specific work (currently it's referenced from the Presentations block; a dedicated trigger would fire faster)
- Cross-reference with v4 §C2 Animation Direction block (when CD specs Gallery, the Animation Direction block names the 5 patterns and timeline)
- Sentinel Ti audit checks for Gallery-specific failure modes (tilt feels cheap, pan janky, focus overlay reused thumbnail) when the §C1 animation gate fires

#### C11.1 — Trigger: when to use this pattern

**Good fit:**
- 10+ real outputs to display simultaneously (PPT, App, web, infographics)
- Audience is professional (developers, designers, PMs) sensitive to "craft"
- The vibe goal is "restrained, exhibition-like, refined, with breathing room"
- Focus and overview must coexist (close-up details without losing the whole)

**Bad fit:**
- Single-product spotlight (use the frontend-design product hero template)
- Emotion-driven / story-driven animation (use a timeline narrative template)
- Small screen / vertical (the tilted perspective gets muddy on small canvases)

#### C11.2 — Core visual tokens

```css
:root {
  /* Light gallery palette */
  --bg:         #F5F5F7;   /* main canvas — Apple site gray */
  --bg-warm:    #FAF9F5;   /* warm off-white variant */
  --ink:        #1D1D1F;   /* primary text */
  --ink-80:     #3A3A3D;
  --ink-60:     #545458;
  --muted:      #86868B;   /* secondary text */
  --dim:        #C7C7CC;
  --hairline:   #E5E5EA;   /* card 1px border */
  --accent:     #D97757;   /* terracotta orange — Claude brand */
  --accent-deep:#B85D3D;

  --serif-cn: "Noto Serif SC", "Songti SC", Georgia, serif;
  --serif-en: "Source Serif 4", "Tiempos Headline", Georgia, serif;
  --sans:     "Inter", -apple-system, "PingFang SC", system-ui;
  --mono:     "JetBrains Mono", "SF Mono", ui-monospace;
}
```

**Key principles:**
1. **Never pure black.** Black makes the work feel cinematic — not "an output you could actually adopt"
2. **Terracotta is the only accent hue**, everything else is grayscale + white
3. **Three-typeface stack** (serif EN + serif CN + sans + mono) creates a "publication" tone, not an "internet product" tone

#### C11.3 — Core layout patterns

**1. Floating cards** (the basic unit)

```css
.gallery-card {
  background: #FFFFFF;
  border-radius: 14px;
  padding: 6px;                          /* the padding is the "matting paper" */
  border: 1px solid var(--hairline);
  box-shadow:
    0 20px 60px -20px rgba(29, 29, 31, 0.12),   /* main shadow, soft and long */
    0 6px 18px -6px rgba(29, 29, 31, 0.06);     /* second close-light layer, creates float */
  aspect-ratio: 16 / 9;                  /* unified slide ratio */
  overflow: hidden;
}
.gallery-card img {
  width: 100%; height: 100%;
  object-fit: cover;
  border-radius: 9px;                    /* slightly smaller radius than the card — visual nesting */
}
```

Counter-example: don't tile flush (no padding, border, or shadow) — that's information-graphic density, not exhibition.

**2. 3D tilted showcase wall**

```css
.gallery-viewport {
  position: absolute; inset: 0;
  overflow: hidden;
  perspective: 2400px;                   /* deeper perspective, tilt isn't exaggerated */
  perspective-origin: 50% 45%;
}
.gallery-canvas {
  width: 4320px;                         /* canvas = 2.25x viewport */
  height: 2520px;                        /* leaves room for pan */
  transform-origin: center center;
  transform: perspective(2400px)
             rotateX(14deg)              /* tilt back */
             rotateY(-10deg)             /* turn left */
             rotateZ(-2deg);             /* slight tilt — kills the too-orderly look */
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 40px;
  padding: 60px;
}
```

Sweet-spot parameters:
- rotateX: 10-15deg (more = VIP party backdrop)
- rotateY: ±8-12deg (left-right symmetry)
- rotateZ: ±2-3deg (kills robot-placed look)
- perspective: 2000-2800px (less = fish-eye; more = orthographic)

**3. 2×2 four-corner convergence (selection scenario)**

```css
.grid22 {
  display: grid;
  grid-template-columns: repeat(2, 800px);
  gap: 56px 64px;
  align-items: start;
}
```

Each card slides in from its corner (tl/tr/bl/br) toward center, with fade in. Matching `cornerEntry` vectors:

```js
const cornerEntry = {
  tl: { dx: -700, dy: -500 },
  tr: { dx:  700, dy: -500 },
  bl: { dx: -700, dy:  500 },
  br: { dx:  700, dy:  500 },
};
```

#### C11.4 — Five animation patterns

**Pattern A · Four-corner convergence (0.8-1.2s)** — 4 elements slide in from viewport corners, scaling 0.85→1.0, with ease-out. Best as opening for "showing multi-directional choice."

```js
const inP = easeOut(clampLerp(t, start, end));
card.style.transform = `translate3d(${(1-inP)*ce.dx}px, ${(1-inP)*ce.dy}px, 0) scale(${0.85 + 0.15*inP})`;
card.style.opacity = inP;
```

**Pattern B · Selected zoom + others slide out (0.8s)** — selected card scales 1.0→1.28, others fade out + blur + drift back to corners.

```js
// Selected
card.style.transform = `translate3d(${cellDx*outP}px, ${cellDy*outP}px, 0) scale(${1 + 0.28*easeOut(zoomP)})`;
// Not selected
card.style.opacity = 1 - outP;
card.style.filter = `blur(${outP * 1.5}px)`;
```

**Key:** the unselected ones must blur, not just fade. Blur simulates depth of field — visually "pushing the selected one forward."

**Pattern C · Ripple expand (1.7s)** — from the center outward, delay by distance — each card fades in + scales 1.25x→0.94x (camera pulling back).

```js
const col = i % COLS, row = Math.floor(i / COLS);
const dc = col - (COLS-1)/2, dr = row - (ROWS-1)/2;
const dist = Math.sqrt(dc*dc + dr*dr);
const delay = (dist / maxDist) * 0.8;
const localT = Math.max(0, (t - rippleStart - delay) / 0.7);
card.style.opacity = easeOut(Math.min(1, localT));

// Whole gallery scales 1.25→0.94 simultaneously
const galleryScale = 1.25 - 0.31 * easeOut(rippleProgress);
```

**Pattern D · Sinusoidal Pan (continuous drift)** — combine sine wave + linear drift, avoiding the "has start, has end" loop feel of a marquee.

```js
const panX = Math.sin(panT * 0.12) * 220 - panT * 8;    // horizontal drift left
const panY = Math.cos(panT * 0.09) * 120 - panT * 5;    // vertical drift up
const clampedX = Math.max(-900, Math.min(900, panX));   // prevent edge exposure
```

Parameters:
- Sine period `0.09-0.15 rad/s` (slow — about 30-50s per swing)
- Linear drift `5-8 px/s` (slower than a viewer's blink)
- Amplitude `120-220 px` (large enough to feel, small enough to not nauseate)

**Pattern E · Focus Overlay (focus shift)** — the focus overlay is a **flat element** (no tilt) floating on top of the tilted canvas. The selected slide scales from its tile position (~400×225) to screen center (960×540); the background canvas keeps its tilt but **dims to 45%**.

```js
// Focus overlay (flat, centered)
focusOverlay.style.width = (startW + (endW - startW) * focusIntensity) + 'px';
focusOverlay.style.height = (startH + (endH - startH) * focusIntensity) + 'px';
focusOverlay.style.opacity = focusIntensity;

// Background cards dim, but stay visible (key — never 100% mask)
card.style.opacity = entryOp * (1 - 0.55 * focusIntensity);   // 1 → 0.45
card.style.filter = `brightness(${1 - 0.3 * focusIntensity})`;
```

**Sharpness iron rule:**
- The focus overlay's `<img>` `src` must point at the original full-res image — **don't reuse the gallery's compressed thumbnail**
- Preload all originals into a `new Image()[]` array
- Set the overlay's `width/height` per-frame; the browser resamples the original each frame

#### C11.5 — Timeline architecture (reusable skeleton)

```js
const T = {
  DURATION: 25.0,
  s1_in: [0.0, 0.8],    s1_type: [1.0, 3.2],  s1_out: [3.5, 4.0],
  s2_in: [3.9, 5.1],    s2_hold: [5.1, 7.0],  s2_out: [7.0, 7.8],
  s3_hold: [7.8, 8.3],  s3_ripple: [8.3, 10.0],
  panStart: 8.6,
  focuses: [
    { start: 11.0, end: 12.7, idx: 2  },
    { start: 13.3, end: 15.0, idx: 3  },
    { start: 15.6, end: 17.3, idx: 10 },
    { start: 17.9, end: 19.6, idx: 16 },
  ],
  s4_walloff: [21.1, 21.8], s4_in: [21.8, 22.7], s4_hold: [23.7, 25.0],
};

// Core easing
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
function lerp(time, start, end, fromV, toV, easing) {
  if (time <= start) return fromV;
  if (time >= end) return toV;
  let p = (time - start) / (end - start);
  if (easing) p = easing(p);
  return fromV + (toV - fromV) * p;
}

// Single render(t) function reads timestamp, writes all elements
function render(t) { /* ... */ }
requestAnimationFrame(function tick(now) {
  const t = ((now - startMs) / 1000) % T.DURATION;
  render(t);
  requestAnimationFrame(tick);
});
```

**Architecture essence:** all state derives from the timestamp `t` — no state machine, no setTimeout. So:
- `window.__setTime(12.3)` jumps to any time instantly (great for Playwright frame-by-frame screenshots)
- Loops are seamless naturally (`t mod DURATION`)
- During debugging you can freeze any frame

#### C11.6 — Craft details (easily missed but lethal)

**1. SVG noise texture.** Light backgrounds risk looking too flat. Layer in a very subtle fractalNoise:

```html
<style>
.stage::before {
  content: '';
  position: absolute; inset: 0;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.078  0 0 0 0 0.078  0 0 0 0 0.074  0 0 0 0.035 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  opacity: 0.5;
  pointer-events: none;
  z-index: 30;
}
</style>
```

You won't see the difference — until you remove it.

**2. Corner brand mark.** Show only during showcase-wall scene, fading in/out. Like a museum label.

```css
.corner-brand {
  position: absolute; top: 48px; left: 72px;
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--muted);
}
```

**3. Brand resolution wordmark.** `letter-spacing: -0.045em` is the standard Apple product-page large-display move.

```css
.brand-wordmark {
  font-family: var(--sans);
  font-size: 148px;
  font-weight: 700;
  letter-spacing: -0.045em;   /* negative tracking is key — pulls letters into a logo */
}
.brand-wordmark .accent {
  color: var(--accent);
  font-weight: 500;           /* the accent character is actually thinner — visual contrast */
}
```

#### C11.7 — Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Looks like a PPT template | Cards have no shadow / no hairline | Add two box-shadow layers + 1px border |
| Tilt feels cheap | Only used rotateY, no rotateZ | Add ±2-3deg rotateZ to break the rigidity |
| Pan feels janky | Used setTimeout or CSS keyframes loops | Use rAF + sin/cos continuous functions |
| Text unreadable on focus | Reused the low-res gallery thumbnail | Independent overlay + original src |
| Background feels empty | Pure `#F5F5F7` | Layer in SVG fractalNoise at 0.5 opacity |
| Type feels too "internet" | Only Inter | Add Serif (CN+EN) + mono for a 3-stack |

#### C11.8 — Integration deliverables (matrix done; remaining items below)

**What landed 2026-04-30 (the matrix integration, Option A):**
- Gallery promoted to Format 9 in the matrix vocabulary
- `slide-decks.md` updated: title, matrix headers, 9-format table with Gallery row, Format details section for Gallery, categories #2/#7/#17 updated to include Gallery
- `workflow.md` updated: 9-format references, Gallery showcase pairing in Rule 2 (full-grid + focus-overlay), v3.8 changelog
- `creative-director-agent.md` and `webdev-agent.md` Presentations blocks updated with the 9-format list and Gallery pointer to `skills/references/apple-gallery-showcase.md`
- `apple-gallery-showcase.md` integration note updated to reflect Format 9 status

**What still ships under §C11.8 (remaining items, can run alongside §C1-C5 animation work):**

1. **Optional: dedicated TIER 2 trigger in `creative-director-agent.md` for Gallery format work.** Currently Gallery is referenced from the Presentations block; a dedicated trigger entry like `Gallery Format Production - always-read on: GALLERY FORMAT IN MATRIX` could fire faster when CD enters Step A and selects Gallery for #2/#7/#17. Trade-off: more triggers = more cognitive load on cold-boot. Defer this until usage shows it's needed.
2. **Cross-reference with §C2 Animation Direction block.** When CD writes Animation Direction for a Gallery vibe, the block should reference the 5 named patterns (corner convergence / selected zoom / ripple expand / sinusoidal pan / focus overlay) and timeline architecture. The Animation Direction block template (per §C2) gets a "Gallery sub-template" addition that names these patterns and the timeline skeleton.
3. **Sentinel Ti audit extension for Gallery format.** When Ti's animation audit gate (§C1) fires on a Gallery build, Ti's perceptual checks should include the Gallery-specific failure modes from §C11.7 above: tilt feels cheap (only rotateY, no rotateZ), pan janky (setTimeout/keyframes loops instead of rAF + sin/cos), text unreadable on focus (low-res thumbnail in overlay instead of full-res preload), background empty (pure `#F5F5F7` without SVG fractalNoise), type too "internet" (Inter-only, missing the 3-stack publication tone).

**Order:** Items 1-3 above are independent of each other. Most efficient: bundle with §C2 (Animation Direction block per vibe) and §C1 (Sentinel Ti animation audit gate) — single CD-agent / webdev-agent / sentinel-ti.md edit pass covers the Gallery-specific add-ons alongside the general animation framework.

---

## Order of execution

Sequenced by impact and dependency. Each line is one work session.

| # | Item | Why this position |
|---|---|---|
| 1 | **B1 — Content Approach templates** | Highest doctrinal priority. Closes the gap that most prevents WebDev from seeding decks correctly. One-pass surgical edit. ~150 lines. |
| 2 | **A4 — Image slot vocabulary canonical table** | Surgical, user-facing, completes the Phase 2 image-strategy story for presentations. ~50 lines. |
| 3 | ~~**A3 — editable-pptx.md → export-formats.md rename + content move**~~ **DONE 2026-04-30** | `slide-decks.md` is now doctrine-only (matrix + format details + canvas policy + PowerPoint doctrine + 2-page showcase + publication grammar + slide design patterns + verification checklist). `export-formats.md` houses architecture / Path A / Path B / slide labels / speaker notes / PDF export / PPTX export / common export pitfalls / when-to-pick. Slide-decks.md went from 828 → 370 lines. Export-formats.md went from 301 → 758 lines. Cross-refs updated across `skills/` and `agents/`. |
| 4 | **C1 + C3 — Animation Audit Gate (Ti) + Animation Discipline (WebDev)** | The biggest unmerged v3 leak. Animation is shipping uncrafted today. Ship Ti's audit gate AND WebDev's discipline together — they're paired. |
| 5 | **C2 — Animation Direction block per vibe (CD)** | Pairs with #4. CD now has the brief structure to direct animation; Ti has the audit; WebDev has the discipline. Animation triangle closed. |
| 6 | **C4 — ANIMATION-MEMORY.md per-session** | Created on first Ti audit per #4. Spec it now so the file is consistent across projects. |
| 7 | **C7 — Quality bar 5-10-2-8 checklist** | Quick. Closes the Junior-Pass-without-brand-signal leak. |
| 8 | **C6 — Cross-vibe coherence (4-axis differentiation)** | For landing-page projects (NOT decks — decks already locked to TWO-vibes per matrix). Rejects 4 vibes that are 4 registers of one insight. |
| 9 | **A1 — BRANDING tab (full spec, 5 workpackages)** | First UI work. Engineering decides specifics. Phase 1 MVP = WP-B1 → WP-B2 → WP-B3 → WP-B4 → WP-B5 sequenced (~1 session for the whole MVP). Unblocks A2. Full spec integrated from former BRANDING-PLAN.md (now superseded). |
| 10 | **A2 — Scene-templates redistribution into BRANDING tab** | Depends on A1. Move 5 templates to Branding, delete 1 (Xiaohongshu), confirm Slides anchor in slide-decks.md. Then delete `scene-templates.md`. |
| 11 | **B2a — Per-format production: Canvas + Scrollytelling + Dashboard** | Most-used non-Slides formats. ~300 lines new doctrine. |
| 12 | **C5 — Audio decision gate + construction (CD + WebDev + Ti)** | Audio integration. Pairs Ti's audio audit with CD's Audio Direction block and WebDev's Audio Construction. |
| 13 | ~~**C11 — Apple Gallery Showcase pattern as active doctrine**~~ **MATRIX INTEGRATION DONE 2026-04-30** | Gallery promoted to Format 9 in the matrix vocabulary. Slide-decks.md, workflow.md, CD-agent, WebDev-agent, apple-gallery-showcase.md all updated. Categories #2 / #7 / #17 now include Gallery. Remaining items (dedicated TIER 2 trigger, §C2 Animation Direction sub-template, Sentinel Ti audit extension) bundled with C1-C2 animation work. |
| 14 | **C8 — CD-MEMORY ↔ skills/ promotion path (Sage)** | Sage gets skill-aware. Stops CD-MEMORY drift into parallel doctrine. |
| 15 | **B2b — Per-format production: 3D + Live + Timeline + Interactive** | Less-used formats. ~400 lines new doctrine. |
| 16 | **C9 — Cull list execution** | Revive design-context.md / tweaks-system.md per their plans. (apple-gallery-showcase.md is no longer on the cull list — see C11.) |
| 17 | **C10 — Legacy inventory triage** | Move pre-integration vibes to `legacy/`. |
| 18 | **B3 — Interactive column rename** | Defer until a better name lands. Non-blocking. |

Items 1-8 are urgency. 9-13 are infrastructure. 14-18 are cleanup.

---

## What we are NOT doing

- **Not deleting `scene-templates.md` until A2 is complete** (need destination first).
- **Not deleting `docs/CTA-MANUAL.md` either** — already redirect-stubbed pointing to `skills/references/cta-manual.md`.
- **Not deleting `docs/BRANDING-PLAN.md` either** — redirect-stubbed pointing to v4 §A1 as of 2026-04-30. The full content is integrated into §A1 above; the source doc is preserved as historical record.
- **Not deleting `skills/references/apple-gallery-showcase.md`** — it stays at `skills/references/` as the live skill that CD/WebDev runtime-read. v4 §C11 contains the integrated doctrine summary for backlog reasoning, but the source remains the canonical runtime reference.
- **Not adding new agents.** Sentinel Ti, CD, WebDev, Sage cover the surface.
- **Not breaking the matrix.** The matrix landed today and is the spine. All future doctrine writes against it.
- **Not retrofitting all legacy vibes** — Hybrid plan per C10 (audit active, freeze inactive).
- **Not renaming any other files** beyond `editable-pptx.md → export-formats.md` and the `docs/CTA-MANUAL.md → skills/references/cta-manual.md` move that already shipped.

---

## Closing note

v3's failure was depth without sequence. v4 has sequence: 17 items, ordered by impact and dependency, with each scoped tight enough to execute one per pass. The matrix landing today gives v4 a stable spine.

Items 1-3 are the next three sessions — content approach templates, image slot vocabulary, and the export-formats restructure. Pick one and say go.
