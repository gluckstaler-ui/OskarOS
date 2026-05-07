> **INTEGRATED 2026-04-30.** This plan has been folded into `docs/HUASHU-INTEGRATION-PROPOSAL.md` v4 §A1 (the BRANDING tab section). All 17 sections of this document — user flow, deliverables catalog, architecture, data model, prompt templates, workpackages WP-B1 through WP-B5, output naming, aspect ratio handling, auto-cataloging, phasing, open decisions, test plan, success criteria, risks — are present in the integration proposal in full. Future edits should go to `HUASHU-INTEGRATION-PROPOSAL.md` v4 §A1, not this file. This file is preserved as historical record.

---

# Branding Tab — Implementation Plan

**Status:** Proposal · **Owner:** Dev · **Scope:** 1-2 sessions for Phase 1 MVP
**Dependencies:** Advanced Mode (shipped), Session state with `VibeData`, Nano Banana generate pipeline

---

## 1. Why

OskarOS generates vibes (landing pages). Vibes contain rich brand data — fonts, colors, mood, audience, voice — but that data is trapped inside the HTML rendering. Users who want to spin up **brand deliverables** (logo, business card, pitch slide, website hero, social kit) currently have to:

1. Remember the fonts and hex codes from the vibe
2. Retype them into Nano Banana prompts
3. Write the deliverable-specific structural spec from scratch
4. Pick aspect ratios manually

The **Branding tab** fixes that. One click reads the vibe's brand data, another click picks a deliverable, a third click generates a production-ready asset at the correct aspect ratio. Shared prompt infrastructure means changing fonts/colors in one place (the vibe) updates every future deliverable consistently.

**Benchmark:** The user should be able to go from a new vibe to a complete brand kit (logo + card + slide + hero + 2 social) in under 60 seconds of active work.

---

## 2. User Flow

### Entry point
New tab in Advanced Mode, added alongside existing tabs:

```
view | generate | edit | compose | layout | brand
```

### Panel layout

```
┌─────────────────────────────────────────────────────────┐
│ BRAND                                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
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
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Flow

1. **Select vibe** — dropdown lists every vibe in session state. On change, auto-populates brand data.
2. **Review / override brand data** — every field is editable. Overrides are ephemeral (cleared on vibe change). User can add a custom voice sample, tweak a color, etc.
3. **Optional image reference** — open the session image picker. If present, the image is passed to Nano as the source. Different deliverables handle this differently (Logo: "improve this mark"; Guideline: "use this as the Visual Identity Seal"; Card: "place this logo on the card").
4. **Pick deliverable** — click one of the tiles. This does NOT generate — it previews the prompt below (see §7).
5. **Click Generate** — assembles the 4-block prompt, calls Nano with the deliverable's declared aspect ratio, saves output to `brand/` subfolder, shows result inline.

---

## 3. Deliverables Catalog (7 MVP)

All use the same 4-block prompt structure (FORMAT / STRUCTURE / BRAND DATA / CONSTRAINTS) with a shared `brandDataBlock()` helper.

| ID | Label | Aspect | Emoji | Description |
|----|-------|--------|-------|-------------|
| `logo` | Logo | 1:1 | 🔖 | Complete logo system — primary mark, monochrome, icon-only, wordmark — on one sheet |
| `guideline` | Brand Guideline | 3:4 | 📘 | Bento sheet: title, visual identity seal, typography, color palette, iconography, mood/voice |
| `business-card` | Business Card | 16:9 | 💳 | Front + back split layout at standard 85×54mm ratio |
| `pitch-slide` | Pitch Slide | 16:9 | 🎯 | Investor deck title slide — headline in primary font, tagline, CTA button |
| `website-hero` | Website Hero | 16:9 | 🖥 | Full-width hero with nav bar, headline overlay, CTA button |
| `social-post` | Social Post | 1:1 | 📷 | Instagram square — bold headline, brand image, accent accent |
| `social-story` | Social Story | 9:16 | 📱 | Instagram story — vertical full-bleed with top headline + bottom CTA |

**Logo is first on the grid.** It's foundational — other deliverables can use a generated logo as their image reference in subsequent passes.

---

## 4. Architecture

### New files

```
lib/
  brand-data.ts              # Brand data extraction + shared block builder
  brand-deliverables.ts      # The 7 deliverable templates (prompt builders)
components/
  advanced/
    BrandingPanel.tsx        # The tab's UI
    BrandDataEditor.tsx      # The brand-data override widget
    DeliverablePicker.tsx    # The tile grid
app/api/
  brand/
    generate/route.ts        # POST → Nano call → save to brand/ subfolder
```

### Modified files

| File | Change |
|------|--------|
| `components/AdvancedMode.tsx` | Add `'brand'` to the `AdvancedTab` type. Add a tab button. Route the tab to `<BrandingPanel>`. |
| `lib/types.ts` | Export `BrandData`, `DeliverableTemplate`, `DeliverableId`. |
| `lib/image-presets.ts` | No changes. Brand deliverables are their own preset family, not Edit presets. |
| `lib/session.ts` | Add `writeBrandAsset(sessionId, filename, bytes)` helper if not already present. |

### Data flow

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
Save result to public/{sessionId}/brand/brand-{vibeKey}-{deliverableId}-v{n}.jpg
  ↓
Return { filename, url } → client renders inline
```

---

## 5. Data Model

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

/** Server-side fallback when state is empty — parses VIBE-N.md. */
export async function brandDataFromFile(sessionId: string, vibeKey: string): Promise<BrandData | null>

/** The shared metadata block every deliverable embeds. */
export function brandDataBlock(b: BrandData): string
```

```ts
// lib/brand-deliverables.ts

export type DeliverableId =
  | 'logo'
  | 'guideline'
  | 'business-card'
  | 'pitch-slide'
  | 'website-hero'
  | 'social-post'
  | 'social-story'

export interface DeliverableTemplate {
  id: DeliverableId
  label: string
  aspectRatio: AspectRatio       // from lib/types.ts
  thumbnailEmoji: string
  description: string
  /** Assemble the full 4-block prompt from brand data. `imageRef` is the filename
   *  of an optional source image (logo, product shot, etc.). */
  build: (brand: BrandData, imageRef?: string) => string
}

export const BRAND_DELIVERABLES: DeliverableTemplate[]
```

---

## 6. Shared brand-data block

Every deliverable prompt embeds this block:

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

---

## 7. Prompt Templates

Every prompt follows the **4-block pattern**: FORMAT · STRUCTURE · BRAND DATA · CONSTRAINTS.

### 7.1 Logo

```
# FORMAT
Deliverable: Complete logo system on one sheet
Producer: CD / Nano
**Recommended styles**: 01 Pentagram / 11 Build / 12 Sagmeister / 18 Kenya Hara / 09. Experimental Jetset / 10. Müller-Brockmann

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

### 7.2 Brand Guideline

```
# FORMAT
Deliverable: Brand Identity Guideline — single-page bento infographic // design-system file
Producer: CD
**Recommended styles**: 01 Pentagram / 11 Build / 03 Information Architects / 18 Kenya Hara / 09. Experimental Jetset / 10. Müller-Brockmann

# STRUCTURE
Non-overlapping bento grid. Named cells:
  - Title (top band, full-width) — business name in {fontHeading} + one-line tagline
  - Visual Identity Seal v1.1 — the logo/mark (from image reference)
  - Typography — Primary Font ({fontHeading}) sample + Secondary Font ({fontBody}) sample, both with full alphabet + size scale
  - Color Palette — four swatches rendered with EXACT 6-digit hex codes + usage notes (primary surface, text, accent, etc.)
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

### 7.3 Business Card

Deliverable: HTML page rendering one business card per school across the 20-school matrix. Each card is a 3-D stage (mouse-tilt parallax, click-flip front↔back, touch support).

Inputs: one user-supplied picture (optional). One user-supplied logo (optional).

Doctrine, per school:
- Substrate. Information Architecture, Minimalist (except Sagmeister), and Eastern Philosophy work on PAPER. Motion Poetics, Avant-garde, and Territory work with MATERIAL (frosted vellum, acetate, hologram) at real translateZ depth.
- Type. The font is the founder. Declare SANS / SERIF / DECLARED BREAK   per card. 
- Photograph. Optional, but recommended. 
- Faces are sacred. Never crop a face. Make sure to orient the cropped part so that the face is visible. 
- Render-verify before declaring done. Every card that uses photo or logo must be screenshotted at readable crop.

Selection: user picks one card from the 20. The selected card is promoted to the brand's Business Card slot and displayed in the section. Selection page is available as link. 

Required information (collected from brand data, if not available it needs to be collected with a modal):
- Business name
- Owner / contact name
- Title / role
- Phone
- Email
- Website
- Location (city or address)



### 7.4 Illustration

```
# FORMAT
Deliverable: SVG
Producer: CD
**Recommended styles**: pick by article tone, commonly 01 Pentagram / 04 Fathom / 10 Müller-Brockmann / 17 Takram / 18 Hara

# STRUCTURE
- Article illustration, concept visualization
- [16:9 / 1:1 / 4:3] aspect ratio
- Single clear concept: [describe core concept]
- Serve the argument, not decoration
- [Light/Dark] background to match article tone

*Key design factors**:
- Serves the article's argument, not decoration
- Forms a visual rhythm with surrounding context
- Expresses one core concept clearly
- Prefer AI-generated; HTML screenshots only for precise data tables



**Scene prompt template**:
```
[insert style DNA here]
- Article illustration, concept visualization
- [16:9 / 1:1 / 4:3] aspect ratio
- Single clear concept: [describe core concept]
- Serve the argument, not decoration
- [Light/Dark] background to match article tone
{image description}


### 7.5 Infographic / Data Visualization

```
#Format
Deliverable: SVG / Interactive data visualization
Producer: CD
**Recommended styles**: 04 Fathom / 10 Müller-Brockmann / 02 Stamen / 17 Takram

#Structure
- Vertical long-form: 1080×1920px (mobile reading)
- Horizontal: 1920×1080px (embedded in article)
- Square: 1080×1080px (social media)

**Key design factors**:
- Clear info hierarchy (title → key data → details)
- Data accuracy, no fabrication
- Visual flow lines (reader's reading path)
- Use icons / charts to aid comprehension where appropriate



**Scene prompt template**:
```
[insert style DNA here]
- Infographic / data visualization
- [Vertical 1080x1920 / Horizontal 1920x1080 / Square 1080x1080]
- Clear information hierarchy: title → key data → details
- Visual flow guiding reader's eye path
- Icons and charts for comprehension
- Data-accurate, no decorative distortion
```

### 7.6 Social Post (Instagram Square)

```
# FORMAT
Deliverable: Instagram feed post
Aspect: 1:1 square
Register: Bold, scroll-stopping editorial — designed to stop a thumb

**Key design factors**:
- Visual impact first (users scroll quickly through the feed)
- Minimal or no text (the WeChat title overlays on top)
- Moderate color saturation (WeChat reading environment skews white)
- Avoid excessive detail (must be recognizable as thumbnail)

**Recommended styles**: 01 Pentagram / 11 Build / 12 Sagmeister / 18 Kenya Hara / 07 Field.io

**Scene prompt template**:
```
[insert style DNA here]
- Article cover image for WeChat subscription
- Landscape format, 2.35:1 aspect ratio
- Bold visual impact, minimal or no text
- Moderate color saturation for white reading environment
- Must remain recognizable as thumbnail
- Clean composition with clear focal point


### 7.7 Social Story (Instagram Story)

```
# FORMAT
Deliverable: Instagram story
Aspect: 9:16 vertical
**Recommended styles**: 12 Sagmeister / 11 Build / 20 Neo Shen / 09 Experimental Jetset

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

### 7.8 Keynote Presentation

# FORMAT
- Standard: 16:9 (1920×1080px)
- Widescreen: 16:10 (1920×1200px)

**Key design factors**:
- One core message per slide (don't pile on)
- Clear type hierarchy (title 40pt+ / body 24pt+ / annotation 16pt+)
- Generous whitespace, clearer when projected
- Image-to-text ratio at least 60:40
- Consistent visual system (color, type, spacing)

**Recommended styles**: 01 Pentagram / 10 Müller-Brockmann / 11 Build / 18 Kenya Hara / 04 Fathom

**Scene prompt template**:
```
[insert style DNA here]
- Presentation slide design, 16:9
- One core message per slide
- Clear type hierarchy (title 40pt+, body 24pt+)
- Generous whitespace for projection clarity
- Consistent visual system throughout
- [Light/Dark] theme
```


---

## 8. Workpackages

### WP-B1 — Brand Data Extraction
**Deliverables:** 1 file, 3 functions
- `lib/brand-data.ts` with `BrandData` interface, `brandDataFromVibe()`, `brandDataFromFile()`, `brandDataBlock()`
- Unit test: given a mock `VibeData`, returns a fully-populated `BrandData`
- Integration test: on a real session, `brandDataFromFile('2026-01-27-31', 'vibe-1')` returns non-null data

**Test — Manual:**
1. Open a session with 4+ vibes
2. Call `brandDataFromVibe(session.vibes[0], session.businessName)` from a console hook
3. Verify all fields populated — business, fonts, target, mood, colors (4 entries), voice sample

### WP-B2 — Deliverable Catalog + Prompt Builders
**Deliverables:** 1 file, 7 templates
- `lib/brand-deliverables.ts` with `BRAND_DELIVERABLES` array (7 entries)
- Each template has `id`, `label`, `aspectRatio`, `thumbnailEmoji`, `description`, `build()`
- Pure functions — no React, no fs

**Test — Manual:**
1. Import `BRAND_DELIVERABLES` in a test file
2. For each deliverable, call `build(mockBrandData, 'sultan.jpg')` and paste output into a text file
3. Verify all 4 blocks present, brand data injected correctly, no unresolved placeholders

### WP-B3 — BrandingPanel UI
**Deliverables:** 3 components
- `components/advanced/BrandingPanel.tsx` — the tab body (vibe selector, brand-data editor, deliverable picker, generate button, result display)
- `components/advanced/BrandDataEditor.tsx` — inline-editable fields showing current brand data with "reset to vibe defaults" button
- `components/advanced/DeliverablePicker.tsx` — the tile grid with hover state and selection highlight

**Test — Manual:**
1. Switch to Advanced Mode → Brand tab
2. Select a vibe → brand data populates
3. Edit a field (e.g. change heading font) → state updates but vibe untouched
4. Change vibe → brand data resets to new vibe's values (overrides cleared)
5. Click a deliverable tile → tile shows selected state
6. (Generate button wired in WP-B4)

### WP-B4 — Generate API + Client Wiring
**Deliverables:** 1 API route, client integration
- `app/api/brand/generate/route.ts` — POST handler that takes `{ sessionId, vibeKey, deliverableId, brandOverrides?, imageRef? }`, assembles the prompt, calls Nano with the correct aspect ratio, saves to `public/{sessionId}/brand/`, returns `{ filename, url }`
- Client: Generate button calls the API, shows loading state, renders result inline with "Open full size" + "Save to assets" actions
- Auto-catalog: on success, append entry to IMAGES.md under a new `## Brand Assets` section

**Test — Integration:**
1. Pick a vibe with full brand data
2. Pick "Logo" deliverable
3. Click Generate
4. Wait 10-30s → image renders in the panel
5. Verify file exists at `public/{sessionId}/brand/brand-{vibeKey}-logo-v1.jpg`
6. Verify IMAGES.md has a new `## Brand Assets` entry
7. Repeat with each of the 7 deliverables — verify aspect ratios match the declared values
8. Regenerate the same deliverable → version increments to `-v2.jpg`

### WP-B5 — Advanced Mode Integration
**Deliverables:** Tab wiring, type updates
- Add `'brand'` to `AdvancedTab` union in `components/AdvancedMode.tsx`
- Add tab button with icon
- Route `brand` tab to `<BrandingPanel>`
- `lib/types.ts` exports `BrandData`, `DeliverableTemplate`, `DeliverableId`

**Test — Manual:**
1. Open Advanced Mode → verify 6 tabs visible: view | generate | edit | compose | layout | **brand**
2. Click Brand tab → panel loads without errors
3. Switch between tabs → brand state preserved across switches

---

## 9. File Manifest

### Create

```
docs/
  BRANDING-PLAN.md                         ← this file
lib/
  brand-data.ts                            ← WP-B1
  brand-deliverables.ts                    ← WP-B2
components/advanced/
  BrandingPanel.tsx                        ← WP-B3
  BrandDataEditor.tsx                      ← WP-B3
  DeliverablePicker.tsx                    ← WP-B3
app/api/brand/generate/
  route.ts                                 ← WP-B4
```

### Modify

```
components/AdvancedMode.tsx                ← WP-B5 — add brand tab
lib/types.ts                               ← WP-B5 — export new types
lib/session.ts                             ← WP-B4 — add writeBrandAsset if missing
```

---

## 10. Output Naming Convention

```
public/{sessionId}/brand/brand-{vibeKey}-{deliverableId}-v{n}.jpg
```

Examples:
- `brand-vibe-1-logo-v1.jpg`
- `brand-vibe-1-guideline-v1.jpg`
- `brand-vibe-1-business-card-v1.jpg`
- `brand-vibe-3-pitch-slide-v2.jpg`

Rationale:
- `brand-` prefix makes them grep-discoverable
- `{vibeKey}` binds the asset to a specific vibe
- `{deliverableId}` matches the catalog key — parseable
- `-v{n}` version suffix enables iteration without loss

---

## 11. Aspect Ratio Handling

Nano Banana accepts aspect ratio as a parameter to the API. For Branding:

1. The `DeliverableTemplate.aspectRatio` is authoritative
2. The API route passes it as a separate Nano parameter
3. The prompt body ALSO states the aspect ratio (belt + suspenders — Nano sometimes drifts without explicit prompt mention)

Supported Nano aspect ratios used by this feature: `1:1`, `16:9`, `9:16`, `3:4`. All four are in Nano's allowed list.

---

## 12. Auto-cataloging to IMAGES.md

On successful generation, the API appends to IMAGES.md:

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

This makes brand assets visible in the Assets panel automatically.

---

## 13. Phasing

### Phase 1 — MVP (this plan, ~1 session)
- All 7 deliverables
- Single-generate only
- Brand data pulled from vibe with manual override
- Auto-save to `brand/` subfolder
- Auto-catalog to IMAGES.md

### Phase 2 — Batch Mode (separate plan, ~0.5 session)
- "GENERATE ALL 7" button
- Parallel Nano calls (3-4 concurrent to respect rate limits)
- Streaming UI: tiles fill in as each result arrives
- Progress indicator per deliverable

### Phase 3 — Extended Catalog
- Letterhead (3:4)
- Packaging mockup (1:1 or 3:4)
- Merchandise preview — T-shirt, tote, mug (4-panel grid, 1:1)
- Signage (16:9)
- Email signature block (16:9)
- Menu / price list (3:4)

All Phase 3 additions are new `DeliverableTemplate` entries in `BRAND_DELIVERABLES` — zero framework changes.

### Phase 4 — Brand Library View
- Dedicated gallery view of all brand assets generated for this session
- Group by vibe, then by deliverable type
- One-click re-download as ZIP

---

## 14. Open Decisions

Resolved by this plan:

| Decision | Choice |
|----------|--------|
| Tab or new top-level mode? | Tab inside Advanced Mode |
| State vs re-parse for brand data | Prefer VibeData in React state; fall back to `brandDataFromFile()` |
| Persistent vs ephemeral overrides | Ephemeral — cleared on vibe change |
| Batch mode timing | Phase 2, after single-generate is proven |
| Output location | `public/{sessionId}/brand/` subfolder |
| Auto-catalog | Yes, to IMAGES.md under `## Brand Assets` section |
| Phase 1 deliverable count | 7 (Logo, Guideline, Card, Pitch Slide, Hero, Post, Story) |

Deferred decisions (for Phase 2+):

- **Image reference flow for Logo**: should the first "Logo" generation produce the seal, then subsequent deliverables auto-reference `brand-{vibeKey}-logo-v1.jpg` as their image? → Phase 2 automation.
- **Does CD interact with the Branding tab?** → Phase 4: CD reviews brand outputs, approves/rejects, triggers regeneration with notes.
- **Does the Branding tab have a prompt-editable mode?** (Show assembled prompt → let user tweak → send) → Phase 2, gated behind a "Show prompt" toggle.

---

## 15. Test Plan — End-to-End

1. **Session setup**: open a session with 4+ built vibes, each with complete brand data (fonts, colors, mood, audience).
2. **Tab access**: open Advanced Mode → click Brand tab → panel loads.
3. **Vibe selection**: dropdown lists all vibes. Select Vibe 1 → brand data populates within 200ms.
4. **Field override**: change the heading font to "Bodoni". Brand data editor shows "Bodoni" with an "override" indicator. Change vibe → override cleared.
5. **Deliverable selection**: click Logo tile → tile highlights. Click Guideline → Guideline highlights, Logo deselects.
6. **Single generate — Logo**: click Generate. Loading state shows. After 10-30s, image renders inline. File saved to `public/{sessionId}/brand/brand-vibe-1-logo-v1.jpg`.
7. **IMAGES.md catalog**: open IMAGES.md. New `## Brand Assets` section exists with one entry for the logo.
8. **Iterate — regenerate**: click Generate again with same vibe+deliverable. New file `-v2.jpg`. Panel shows the v2 result; v1 still on disk.
9. **All deliverables**: generate each of the 7 deliverables for Vibe 1. Verify 7 files in `brand/`. Verify 7 IMAGES.md entries. Verify aspect ratios: logo 1:1, guideline 3:4, card 16:9, slide 16:9, hero 16:9, post 1:1, story 9:16.
10. **Cross-vibe consistency**: generate a Logo for Vibe 2. Open both logos side by side. Verify they're visibly different (different colors, different register) — brand data is ACTUALLY driving the output.
11. **Empty state**: open a session with no vibes. Brand tab shows "No vibes yet — build vibes first to generate brand assets."
12. **Missing brand data**: select a vibe whose VibeData has empty fonts/colors. Editor highlights missing fields. Generate button disabled until required fields filled.

---

## 16. Success Criteria

Phase 1 is shipped when:

- [ ] All 7 deliverables generate successfully for a vibe with complete brand data
- [ ] Each output matches its declared aspect ratio (measure pixel dimensions, not just "looks right")
- [ ] Brand data is visibly reflected in every output (fonts match, colors match, voice sample appears where the prompt asks for it)
- [ ] Iterating generates versioned files, no overwrites
- [ ] Files are discoverable in IMAGES.md
- [ ] Tab is stable across switches — no state loss
- [ ] Typecheck passes, no new ESLint errors

---

## 17. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Nano ignores aspect ratio in prompt body | Pass aspect ratio as explicit API parameter. Prompt body is secondary. |
| Brand data in VibeData is incomplete (missing mood, incomplete colors) | Editor highlights missing fields. Generate button disabled until minimum viable brand data present (business name + fonts + 2 colors + mood). |
| Generated deliverables feel template-y | Each prompt includes a `Register:` line pointing to a specific high-end reference (Pentagram, IBM, Stripe). Stress-test with diverse vibes; refine prompts based on outputs. |
| Users edit the heading font in Branding, expecting it to persist to the vibe | Override indicator + explicit "This change is for this generation only. Update the vibe to make it permanent." copy. |
| Logo generates something that looks nothing like the source image | Logo prompt explicitly says "Do not render the source verbatim — design an original mark informed by the brand data." If users want a 1:1 logo redraw, that's a different deliverable (logo-restyle, Phase 3). |

---

**End of plan.**
