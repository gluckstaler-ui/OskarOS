# Branding — Active Plan (consolidated 2026-05-01)

**Status:** Active master document for ALL Branding work. **OWNS** the WP-16 (Phase 7) backlog, the WP-7 extended E2E test plan, and the §A1/§A2 doctrine pulled in from HUASHU-INTEGRATION-PROPOSAL.md.
**Owner:** Dev (engineering) + CD (preset prompts) + Ralph (decisions)
**Supersedes:** the original 7-deliverable WP-B1..WP-B5 spec at the bottom of this file (preserved as historical record only — DO NOT IMPLEMENT).

---

## 0. Where this work currently sits — verified 2026-05-01

Plain reality before any planning:

- **WP-B1..WP-B5 (the original 7-deliverable plan, lower in this file): SUPERSEDED.** The 3 component files (`BrandingPanel.tsx`, `BrandDataEditor.tsx`, `DeliverablePicker.tsx`) and the 2 lib/api files (`lib/brand-deliverables.ts`, `app/api/brand/generate/route.ts`) are orphan dead code awaiting deletion (Phase 0 below). Do not touch them. Do not extend them.
- **WP-16 (Phase 7 of ADVANCED-MODE-PLAN.md): RUDIMENTARILY SHIPPED.** Tab shell exists, `BrandPreset` type lives in the preset union, `lib/brand-data.ts` extracts brand data from VibeData. But the preset list is the wrong 8 (not the §16.2 final 7), the vibe picker is hardcoded `vibes[0]`, magenta chroma-key postproc is unwired, the Logo System / Brand Guideline prompts are not WP-15-compliant.
- **WP-7 (Preset Audit): NOT DONE.** No `test-outputs/preset-test-log.md` exists in any session folder. The image_ops + screenshot E2E across both branding-relevant workflows (Logo chroma-key + Layout slicing) is the current scope — this file owns that spec.
- **§A1/§A2 from HUASHU-INTEGRATION-PROPOSAL.md:** §A1 is the doctrinal master spec for the Branding tab (kept here as reference, no longer authoritative — WP-16 is the live implementation track and supersedes it on architecture). §A2 (scene-templates redistribution into the Branding tab) is BLOCKED until §16.4 closes.

Two bugs that ALSO touch branding but live elsewhere:
- §16.5a (proofread rewrite not reaching Nano) — **FIXED** 2026-05-01 (`/api/edit-image:235`).
- §16.5b/c (GenerationRecord audit fields, Upload CD eval) — **FIXED** 2026-05-01.

---

## 1. Phase 0 — Cleanup (BEFORE any §16.4 feature work)

Single hygiene commit. Five orphan files + one types edit + one redirect note.

| Action | File | Notes |
|---|---|---|
| DELETE | `components/advanced/BrandingPanel.tsx` (447 LOC) | WP-B3 orphan |
| DELETE | `components/advanced/BrandDataEditor.tsx` (322 LOC) | WP-B3 orphan |
| DELETE | `components/advanced/DeliverablePicker.tsx` (103 LOC) | WP-B3 orphan |
| DELETE | `lib/brand-deliverables.ts` | WP-B2 orphan |
| DELETE | `app/api/brand/generate/route.ts` | WP-B4 orphan — brand now inherits `/api/edit-image` |
| EDIT | `lib/types.ts:4` | Remove dead re-export of `DeliverableTemplate` / `DeliverableId` |
| KEEP | `lib/brand-data.ts` | NOT orphan — `brandDataFromVibe` / `brandDataBlock` / `isBrandDataComplete` are LIVE for WP-16 |
| KEEP | `docs/BRANDING-PLAN.md` (this file) | Re-purposed as active master per this consolidation |

**Acceptance:** `grep -r "DeliverableTemplate\|DeliverableId\|BRAND_DELIVERABLES\|/api/brand/generate" oskar-prototype/` returns zero hits in production code. Typecheck passes. No imports break.

**Order:** Separate commit BEFORE §16.4. Hygiene, not feature.

---

## 2. §16.4 Feature Work — the 7 open items

Each item below is a discrete commit. None depend on each other architecturally; they can ship in any order. Recommended sequence at end of section.

### §16.4a — Revise preset list (8 wrong → 7 right)

**Problem:** `BRAND_PRESETS` currently has 8 entries (Logo System / Business Card / Storefront Sign / Menu Card / Packaging / Staff Uniform / Social Template / Loyalty Card). Three are out of scope for v1 (Menu Card, Packaging, Staff Uniform — better as Phase 3 catalog expansion); Loyalty Card is folded into QR Card; Social Template splits into two distinct ratios.

**Final 7 presets (per §16.2):**

| ID | Label | Aspect | Notes |
|----|-------|--------|-------|
| `logo` | Logo System | 1:1 | 4-quadrant lockup. Magenta chroma-key target. |
| `brand-guideline` | Brand Guideline | 3:4 | Bento sheet. Uses logo as Visual Identity Seal. |
| `business-card` | Business Card | 16:9 | Front + back side-by-side. |
| `storefront-sign` | Storefront Sign | 16:9 | Building signage in real environment. |
| `qr-card` | QR Card | 1:1 | Brand mark + URL/QR area. URL is a Zone 3 text input. |
| `social-post` | Social Post | 1:1 | Instagram feed square. |
| `social-story` | Social Story | 9:16 | Instagram story vertical. |

**Files:** `lib/presets-brand.ts` (or wherever `BRAND_PRESETS` lives — verify path before editing).

**Test:** Brand tab shows exactly 7 preset pills. Clicking each populates Zone 4 with its `brandFn(brandData, slotImage?)` output. No WP-B catalog references remain.

### §16.4b — Slot staging UI for Brand tab

**Status:** Data layer DONE (MCP Tier-A `list_assets` + `find_assets` ship the asset-discovery substrate). UI layer OPEN.

**What's needed:**
- `interface BrandStaging { logo?: string; hero?: string; qrUrl?: string }` in `lib/types.ts` or co-located.
- `TabState.brandStaging` field added to the per-tab state slice in `AdvancedMode.tsx` (lives next to `composeStaging` / `layoutStaging`).
- Zone 3 named-slot cards: **Logo** (image picker), **Hero** (image picker), and for `qr-card` preset only: **QR URL** (text input).
- Click-to-assign from Zone 1 thumbnails → fills selected slot.
- Slot contents flow into `brandFn(brandData, slotImage)` → live prompt rebuild in Zone 4.

**Files:**
- `components/advanced/AdvancedMode.tsx` — add `brandStaging` to TabState
- `components/advanced/PresetsStaging.tsx` — render the brand-mode slot cards when `activeTab === 'brand'`
- `lib/presets-brand.ts` — preset prompts read the staged slots

**Test:** Pick `logo` preset → Logo slot appears, Hero slot hidden. Pick `business-card` → Logo + Hero slots both appear. Pick `qr-card` → Logo slot + QR URL text input. Drop image into Logo slot → Zone 4 prompt updates with `slot:logo:filename.jpg` reference. Switch presets → staging persists per-preset within a session.

### §16.4c — Vibe picker in Brand tab header

**Problem:** `activeBrandData` is `useMemo(() => brandDataFromVibe(vibes[0], ...), [vibes])` — hardcoded to vibe 0. Brand-data-driven generation only works for the first vibe.

**Fix:** Pill at Zone 2 tab bar right edge: `Brand: FalCaMel · Majlis ▾`. Click opens a small dropdown listing all vibes by name (matches the brand pill pattern from the Studio sidebar).

**State:** New `selectedBrandVibeKey` in `AdvancedMode.tsx`, default `vibes[0]?.key`. `activeBrandData` derived from `vibes.find(v => v.key === selectedBrandVibeKey)`.

**Files:**
- `components/advanced/AdvancedMode.tsx` — pill placement + state + memo dep
- (probably a small new component) `components/advanced/BrandVibePicker.tsx`

**Test:** Session with 4 vibes. Brand pill defaults to vibe-1. Click pill → dropdown lists all 4. Pick vibe-3 → brand-data block in Zone 4 prompt updates to vibe-3's fonts/colors/voice. Switch tab away and back → selection persists per-session.

### §16.4d — Magenta chroma-key postprocessing for Logo System

**Status:** Sharp pipeline SHIPPED — `image_ops` MCP tool ships `chroma-key` + `format-convert` operations on top of sharp. Wiring INTO the brand generation flow is OPEN.

**Decision (was open §16.7.1, now resolved):** Use `image_ops` directly. **Do NOT create `lib/brand-postproc.ts`** as a wrapper — call the MCP tool from the API route.

**Wiring required:**

In `/api/edit-image` (or wherever the brand-mode dispatch lives), after Nano returns for `preset.id === 'logo'`:

```ts
// pseudo, verify exact API surface
const keyed = await mcp.image_ops(filename, 'chroma-key', { color: '#FF00FF' /* threshold? */ });
const png = await mcp.image_ops(keyed, 'format-convert', { to: 'png' });
// rename: brand-{vibeKey}-logo-v{n}.jpg → brand-{vibeKey}-logo-v{n}.png
```

The output PNG REPLACES the JPG in IMAGES.md (don't keep both — the JPG is intermediate). Status `B-ROLL` for the JPG, `READY` for the PNG, OR delete the JPG entirely once chroma-key passes — pick one and document. (Recommended: delete the intermediate; an orphan magenta JPG in the assets panel will confuse the user.)

**The doubts to resolve via WP-7 (§3 below):** chroma-key threshold tuning, near-magenta protection on brand strokes that contain pink hues, edge anti-aliasing preservation.

**Files:**
- `app/api/edit-image/route.ts` — brand-mode Logo branch calls `image_ops` post-Nano
- `lib/presets-brand.ts` — Logo prompt explicitly demands `#FF00FF` background (already drafted, verify)

**Test:** See WP-7 EXTENDED §3.A below. End-to-end: Generate Logo → file lands as `brand-{vibe}-logo-v1.png` with real alpha channel.

### §16.4e — Filename prefix fix

**Problem:** `buildFilenameHint` at `AdvancedMode.tsx:829` doesn't have a brand-tab branch. `case 'brand':` only exists in `buildPromptFromPreset` (line 289). Brand assets fall through to the `'layout'` prefix.

**Fix:** Add `case 'brand'` to `buildFilenameHint`:

```ts
case 'brand':
  return `brand-${vibeKey}-${preset.id}-v${nextVersion}`;
```

Where `vibeKey` reads from `selectedBrandVibeKey` (per §16.4c) and `nextVersion` is the existing version-counter logic.

**Files:** `components/advanced/AdvancedMode.tsx:829` only.

**Test:** Generate Logo for vibe-1 → file lands as `brand-vibe-1-logo-v1.{ext}`. Generate again → `-v2`. Switch to vibe-3 → `brand-vibe-3-logo-v1`. No `layout-` prefix anywhere.

### §16.4f — Generation mode typing

**Problem:** `activeTab` cast at `AdvancedMode.tsx:826` doesn't include `'brand'`. Server-side mode mapping (used for routing in `/api/edit-image`) may also be missing the branch.

**Fix:**
1. Update the cast type at `:826` to include `'brand'`.
2. Verify `/api/edit-image` recognizes `mode: 'brand'` and dispatches to the brand pipeline (which under v1 inherits the edit pipeline + adds chroma-key postproc per §16.4d).
3. Verify `GenerationRecord.mode` accepts `'brand'`.

**Files:** `components/advanced/AdvancedMode.tsx`, `app/api/edit-image/route.ts`, `lib/types.ts` (if `GenerationRecord` is typed).

**Test:** Generate Logo → Network tab shows POST with `mode: 'brand'`. GenerationRecord on disk has `mode: 'brand'`. No type errors in Studio mode-switching telemetry.

### §16.4g — Rewrite all 7 preset prompts per WP-15 principles

**Status:** Substrate SHIPPED — `submit_image_prompt` MCP tool is the canonical channel for committing CD-rewritten prompts. The rewrite work itself is CD's job.

**WP-15 principles to apply per preset:**

1. **No placeholders.** Every prompt bakes in real brief data: business name, fonts, colors, voice sample, audience. Reads from `brandDataBlock(brandData)` literal, not `{businessName}` template strings.
2. **Magenta is explicit (Logo only).** Logo prompt declares `pure #FF00FF magenta background, no gradient, no vignette, no soft shadow, every pixel exactly (255,0,255)` — leaving room for chroma-key tolerance.
3. **Slot images by filename.** When a slot is staged (Hero, Logo), prompt references it by filename, not "the source image." E.g. `Take the logo from sultan-mark-v3.png and place it in the top-left of the card.`
4. **Aspect declared in prompt body** (belt + suspenders — Nano sometimes drifts without explicit prompt mention; aspect is ALSO passed as separate API parameter).
5. **Negative constraints explicit.** Each preset's `# CONSTRAINTS` block bans the failure modes for that deliverable type (no Lorem Ipsum, no fake testimonials, no invented logos, etc. — see HUASHU §A1.6 prompts as starting reference, then rewrite for WP-15 voice).
6. **No banned phrases** ("Book Now" / generic CTAs that survive a search-replace into any other brand).

**Files:** `lib/presets-brand.ts` (or current location of `BRAND_PRESETS`).

**Test:** WP-7 EXTENDED §3 below — each preset gets graded on (a) WP-15 principle compliance via `submit_proofread`, (b) Nano output verdict via `submit_image_verdict`, (c) brand-data interpolation completeness, (d) slot-image filename references when slots are staged.

### Recommended order

1. §16.4a (preset list) — prerequisite for all others
2. §16.4f (typing) — quick, unblocks §16.4d wiring
3. §16.4e (filename prefix) — quick
4. §16.4c (vibe picker) — unblocks per-vibe testing
5. §16.4b (slot staging UI) — unblocks slot-aware presets
6. §16.4g (preset prompt rewrite) — depends on slot staging being live so prompts can reference real slots
7. §16.4d (chroma-key wiring) — last, ride on top of WP-7 chroma-key validation

---

## 3. WP-7 EXTENDED — `image_ops` + `screenshot` E2E test plan

The two MCP tools that do real file work — `image_ops` and `screenshot` — must be tested end-to-end across both workflows that use them. Each workflow has a prompt-side (does Nano produce what file ops need?) and a file-ops-side (do the operations actually do what we expect?). Both halves can fail independently.

**Why both halves matter:** if HALF 1 fails, HALF 2 results don't say anything about file ops — they say the prompt is broken. Test order is HALF 1 → HALF 2 per workflow.

### 3.A — Workflow A: JPG → PNG chroma-key (Logo System)

Goal: Nano produces a logo on pure-magenta background → `image_ops` chroma-keys out the magenta → output is a transparent PNG suitable for compositing onto Cards / Signs / Social / QR Card.

**HALF 1A — Does the prompt generate what we need?**

Run `Logo System` preset's `brandFn(brandData, '')` against a known fixture brand (`FalCaMel Café`, fonts, primary color, truth statement). Capture Nano's output JPG.

Verify on the JPG:
- **Background is pure `#FF00FF` magenta.** Sample N pixels (corners + 4 edge midpoints + 12 interior); every pixel must be exactly `(255,0,255)`. Not `(254,1,254)`. Not gradient. Not vignette. Not soft shadow.
- **Foreground in center ~80% with ~10% flat magenta margin.** Sample edge bands; verify no logo content within 10% of any edge.
- **Logo content matches prompt:** business name in heading font, primary brand color, no mockup chrome, no contextual scene, no "designer comp" feel.
- **Aspect 1:1.** Verify dimensions are square (Nano sometimes ignores aspect param).
- **All 4 quadrants present** per the Logo System prompt (primary lockup top-left, monochrome top-right, icon bottom-left, wordmark bottom-right).

If HALF 1A fails: preset prompt is broken — rewrite it (§16.4g) before HALF 2A means anything.

**HALF 2A — Do the file operations do what we expect?**

Take the JPG from HALF 1A:

```ts
const keyed = await image_ops(jpg, 'chroma-key', { color: '#FF00FF', threshold: ??? });
const png   = await image_ops(keyed, 'format-convert', { to: 'png' });
```

Verify on the output:
- **Output is real PNG, not JPG-renamed.** Read magic bytes: `89 50 4E 47 0D 0A 1A 0A`. JPEG magic (`FF D8 FF`) means format-convert silently no-op'd.
- **Alpha channel is real, not flat.** Decode pixels; corner pixels (magenta in source) must have `alpha === 0`; foreground pixels `alpha === 255`. Uniform `255` everywhere = chroma-key didn't apply, file is RGB-on-magenta not RGBA.
- **Edge anti-aliasing preserved.** Boundary pixels have intermediate `alpha ∈ [50, 240]`. Hard 0/255 binary distribution = jagged edges from too-tight threshold.
- **No false-positive on near-magenta strokes.** Fixture brand with `#FF1A99` / `#E93FA8` / deep pink stroke — verify NOT punched through. The main doubt: Sharp's threshold may default too loose.
- **Color fidelity on retained pixels.** Foreground RGB matches source within ±2 per channel.

`screenshot`-verify:
- Composite keyed PNG onto a checkerboard HTML page; `screenshot` it; visually confirm transparency in a real rendering context (not just byte-level).
- Composite onto DARK background to catch white-fringe haloing (chroma-key artifact where edge magenta tint is invisible on light bg but obvious on dark).
- `screenshot frame: 'mobile' | 'tablet' | 'desktop'` actually changes capture dimensions.

### 3.B — Workflow B: Slice/crop into bento cells (Layout mode)

Goal: one source image (Nano-generated panorama or uploaded photo) gets sliced into multiple pieces for a bento layout. Common patterns:
- Wide hero panorama (16:9) → 3 vertical strips for triptych
- Tall portrait (3:4) → top/middle/bottom for sequential storytelling
- Wide image → square + remainder for hero+sidebar bento
- Single source → N×M grid for gallery wall

**HALF 1B — Does the prompt generate what we need?** (skip if uploaded source)

Run the Layout preset that produces the panorama / wide / tall source. Capture Nano's output JPG.

Verify on the JPG:
- **Aspect ratio matches what slicing expects** (e.g., 21:9 panorama for 3-strip slice, 3:4 portrait for top/middle/bottom).
- **Subject placement: visual content distributed across slice regions.** A panorama prompt that bunches everything in the center then leaves the flanks empty produces useless side-strips. Sample density per region.
- **Composition has clear "joints"** the slicer can cut on without bisecting key elements (no face-cut-in-half through middle of a slice line).

If HALF 1B fails: preset prompt is broken — rewrite it (Layout preset) before HALF 2B means anything.

**HALF 2B — Do the file operations do what we expect?**

Take source through `image_ops` slice/crop per the bento template:

```ts
// Triptych pattern from a 1920×1080 panorama → 3 strips of 640×1080
image_ops(src, 'slice', { grid: { rows: 1, cols: 3 } });
// or explicit
image_ops(src, 'crop', { x: 0,    y: 0, w: 640, h: 1080 });
image_ops(src, 'crop', { x: 640,  y: 0, w: 640, h: 1080 });
image_ops(src, 'crop', { x: 1280, y: 0, w: 640, h: 1080 });
```

Verify:
- **Slice count correct.** Requesting 3-strip returns exactly 3 files.
- **Each slice has correct dimensions.** 1920÷3 = 640 exactly; any slice that's 639 or 641 = rounding bug. Off-by-one on edge slices is the most common Sharp `extract` bug.
- **Slices align losslessly.** Compositing the 3 slices back side-by-side reproduces the original within ±0 per pixel (no gap, no overlap, no resampling drift). Hash reassembled vs source — should match exactly.
- **No edge artifacts at slice boundaries.** Decode boundary columns of each slice; no resampling / sharpening / compression artifacts from the cut. (Sharp's default may apply jpeg quality settings on slice output that drift colors.)
- **Filenames deterministic.** Each slice gets `{src}-slice-{r}-{c}.{ext}` or similar; downstream Layout HTML can reference predictably.
- **Slices land in IMAGES.md** as `Status: B-ROLL` per the spec.
- **Source aspect respected.** Cropping a 16:9 source to a 1:1 cell: verify CROP region, not resize-then-squish path. Squished aspect = bug.
- **Color fidelity per slice.** Each slice's pixels match the corresponding region of source within ±2 RGB per channel.

`screenshot`-verify:
- Render the bento HTML referencing the sliced files; `screenshot` it; compare to a hand-composed reference. Confirm visual continuity across slice borders (no visible line where adjacent slices meet, no color jump).
- For grid layouts with gaps (CSS gap between bento cells): bisected content reads correctly across the gap (eyes still align, horizon still level, no jarring break).

### 3.C — Specific Sharp / `image_ops` gotchas to test across both workflows

- `removeAlpha()` / `joinChannel()` / `ensureAlpha()` API path matters for chroma-key; silent format issues if wrong order.
- `.extract()` API for crop/slice: 1-indexed vs 0-indexed mode differences across Sharp versions. Verify implementation matches what the bento template expects.
- Linear vs sRGB color space: Sharp processes in linear by default; chroma-key in linear vs sRGB produces different edges. Verify color space declared.
- Some Sharp versions strip ICC profiles on format-convert; confirm output is sRGB.
- `.png({ compressionLevel: ... })` defaults: alpha PNGs aren't bloated by no compression.
- `.jpeg({ quality: ... })` defaults on slice output: slices retain quality, not re-compressed at default 80.
- File written to disk with correct mode bits; readable by subsequent `image_ops` calls in the same session.
- Concurrent `image_ops` calls on same source (3 parallel crops): no read-during-write file corruption.

### 3.D — Assertions WP-7 records to log

Per workflow per run, append to `public/{session}/test-outputs/preset-test-log.md`:

```
Workflow A — Logo System E2E run #N for {brand}
  HALF 1A (prompt → Nano JPG):
    background_pure_magenta:    PASS / FAIL (sampled K, M deviations)
    foreground_in_frame:        PASS / FAIL
    aspect_1_1:                 PASS / FAIL (actual: WxH)
    quadrants_present:          PASS / FAIL
  HALF 2A (image_ops chroma-key + format-convert):
    output_is_real_png:         PASS / FAIL (magic bytes: ...)
    alpha_channel_real:         PASS / FAIL (corner=A, fg=B)
    edge_aa_preserved:          PASS / FAIL (boundary distribution)
    near_magenta_safe:          PASS / FAIL (#FF1A99 stroke fixture)
    color_fidelity:             PASS / FAIL (max drift ±D)
  HALF 2A (screenshot composite):
    transparent_on_checkerboard: PASS / FAIL
    no_dark_bg_halo:             PASS / FAIL
    viewport_frame_works:        PASS / FAIL

Workflow B — Layout slice run #N for {pattern}
  HALF 1B (prompt → Nano source, skip if uploaded):
    aspect_match:                PASS / FAIL (expected R, actual R')
    visual_content_distributed:  PASS / FAIL (no center-bunch)
    no_key_element_at_joints:    PASS / FAIL
  HALF 2B (image_ops slice/crop):
    slice_count_correct:         PASS / FAIL (expected N, got M)
    slice_dimensions_exact:      PASS / FAIL (per-slice WxH)
    reassembly_lossless:         PASS / FAIL (hash match)
    no_edge_artifacts:           PASS / FAIL (boundary column analysis)
    aspect_respected:            PASS / FAIL (crop, not squish)
    color_fidelity_per_slice:    PASS / FAIL (max drift ±D)
    filenames_deterministic:     PASS / FAIL
    images_md_entries_added:     PASS / FAIL (B-ROLL status)
  HALF 2B (screenshot bento render):
    slice_borders_invisible:     PASS / FAIL
    visual_continuity:           PASS / FAIL (gap-respect)
```

Run each matrix N times per fixture (recommend N=3). Variance reveals deterministic vs stochastic failure.

### 3.E — The doubts WP-7 resolves

- **Workflow A:** is `image_ops` chroma-key real Sharp or a stub? `output_is_real_png` + `alpha_channel_real` answer it. If both fail, chroma-key isn't shipped — block §16.4d wiring until fixed.
- **Workflow B:** does `image_ops` slice/crop preserve byte-fidelity? `reassembly_lossless` answers it. If hash doesn't match, slicer is doing some lossy operation (resampling, recompression, color-space conversion) under the hood. Catching this byte-level is the whole point — visually it might look fine but slice-and-recompose workflows compound drift across operations.

If byte-level passes but `screenshot` renders look bad, the bug is downstream (CSS gap handling, image-rendering hint, browser scaling) — NOT `image_ops`.

---

## 4. From HUASHU §A1 — Doctrinal reference (NOT authoritative for impl)

Pulled here as reference for the deliverable catalog, prompt structure pattern, and brand-data interpolation contract. Authoritative impl track is §1-§3 above; if §A1 doctrine and WP-16 implementation diverge, WP-16 wins.

### 4.A — Brand data interpolation contract

Every brand preset prompt embeds:

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

Implemented in `brandDataBlock()` in `lib/brand-data.ts` (LIVE — not orphan). One edit there updates every preset.

### 4.B — Four-block prompt pattern (FORMAT · STRUCTURE · BRAND DATA · CONSTRAINTS)

Every brand preset prompt follows the same structure. Reference template skeletons (Logo / Brand Guideline / Business Card / Pitch Slide / Website Hero / Social Post / Social Story) live in HUASHU-INTEGRATION-PROPOSAL.md §A1.6 (lines 232-425). They are STARTING references — §16.4g rewrites them per WP-15 principles before they ship.

Notable per-preset constraints to preserve in the rewrite:

- **Logo:** background pure `#FF00FF`, no gradient, every pixel `(255,0,255)`. Foreground in center 80%. 4 quadrants (primary lockup / monochrome / icon / wordmark). Icon must work at 16px favicon scale.
- **Brand Guideline:** Visual Identity Seal renders the staged Logo verbatim (do NOT redraw). All hex codes EXACT 6-digit strings. No cell overlap; respect 14px gutter.
- **Business Card:** front + back, 14px gutter. Realistic field placeholders `[NAME]` `[EMAIL]` etc. — no Lorem Ipsum, no fake names.
- **Storefront Sign:** signage in real environment (building face / awning / monolith), not a flat product render. Ambient lighting matches the time of day implied by the brief.
- **QR Card:** brand mark + URL/QR area. URL string baked into the prompt from the Zone 3 text input.
- **Social Post (1:1):** headline under 8 words. Brand voice or natural variation. No hashtags / emojis / fake social UI chrome.
- **Social Story (9:16):** safe zones (headline below 10% top, CTA above 10% bottom). No phone chrome in the render.

### 4.C — Output naming + cataloging

```
public/{sessionId}/brand/brand-{vibeKey}-{presetId}-v{n}.{ext}
```

- `.jpg` for non-Logo presets (Nano default).
- `.png` for Logo (post chroma-key per §16.4d).

Auto-catalog appends to IMAGES.md under `## Brand Assets`:

```
## Brand Assets

### brand-vibe-1-logo-v1.png
Generated: 14:23:07
Vibe: Vibe 1 — Grandma's Cliff
Preset: Logo System
Aspect: 1:1
Source: Branding tab, BRAND_PRESETS.logo
Postproc: chroma-key #FF00FF, format-convert PNG
```

### 4.D — Aspect ratio handling

The preset's declared aspect ratio is authoritative. The API route passes it as a separate Nano parameter. The prompt body ALSO states the aspect (belt + suspenders — Nano sometimes drifts without explicit prompt mention).

Supported: `1:1`, `16:9`, `9:16`, `3:4`. All four are in Nano's allowed list.

---

## 5. From HUASHU §A2 — Scene-templates redistribution (BLOCKED)

`skills/references/scene-templates.md` ships 8 templates — most don't belong in `slide-decks.md` doctrine; they're brand-asset templates that belong in the Branding tab.

**Per-template fate:**

| # | Template | Fate | Branding-tab landing |
|---|----------|------|---------------------|
| 1 | WeChat subscription cover / article hero | → Branding tab | New preset (Phase 3 catalog) |
| 2 | Article inline illustration | → Branding tab | New preset (Phase 3 catalog) |
| 3 | Infographic / data visualization | SPLIT: data-viz-as-brand-asset → Branding; data-viz-as-Dashboard-template → `slide-decks.md` Dashboard format | New preset (Phase 3 catalog) |
| 4 | PPT / Keynote slide | Already anchored in `slide-decks.md` Slides format | Delete from scene-templates.md |
| 5 | PDF white paper / technical report | → Branding tab as branded PDF export | New preset (Phase 3 catalog) |
| 6 | Landing page / product website | Already covered by `workflow.md` Phase 1 | Delete from scene-templates.md |
| 7 | App UI / iOS-Android prototype | → Branding tab as Interactive Presentation Format / branded prototype | New preset (Phase 3 catalog) |
| 8 | Xiaohongshu (RED) image | DELETE | Out of scope |

**After redistribution:** `skills/references/scene-templates.md` is empty/redundant → delete the file. Update `creative-director-agent.md` SCRIPTS / ASSETS section to remove the scene-templates.md reference.

**Order:** BLOCKED on §16.4 close. Cannot redistribute templates 1/2/3a/5/7 until the Branding tab has the substrate to receive them (slot staging UI shipped, vibe picker live, preset rewriter in place). After §16.4 ships, A2 lands as Phase 3 catalog expansion (§7 below).

---

## 6. Open decisions (Ralph)

| # | Decision | Default vote | Notes |
|---|----------|--------------|-------|
| 1 | ~~Postproc tool — sharp / jimp / imagemagick?~~ | RESOLVED | `image_ops` MCP tool uses sharp. No `lib/brand-postproc.ts` wrapper. |
| 2 | QR Card URL input location — Zone 3 or Zone 4? | Zone 3 | Slot-input grouping; Zone 4 stays the prompt textarea. |
| 3 | Brand Guideline with no Logo yet — refuse or wordmark fallback? | Allow + fallback | Refuse blocks too early; fallback is graceful (the user iterates). |
| 4 | Vibe picker UX — dropdown in Zone 2 tab bar, or strip in Zone 3? | Pill in tab bar | Matches Studio sidebar pattern; doesn't steal Zone 3 real estate. |
| 5 | Social Post vs Social Story — two presets or one with aspect toggle? | Two | Aspect toggle leaks the aspect-as-content abstraction; two presets is simpler. |
| 6 | Fix §16.5a (WP-15 rewrite-wire bug) before or after Brand v1? | RESOLVED — fixed 2026-05-01 | No longer blocking. |
| 7 | Logo intermediate JPG: keep as `B-ROLL` or delete? | Delete | Orphan magenta JPG confuses asset panel. |
| 8 | Image reference flow for Logo: should subsequent deliverables auto-reference `brand-{vibeKey}-logo-v1.png`? | Phase 2 | Manual slot staging works for v1. Auto-wire later. |
| 9 | Does CD interact with Branding tab? | Phase 4 | CD reviews brand outputs, approves/rejects, triggers regenerate with notes. |
| 10 | Does Branding tab have prompt-editable mode? | Phase 2 | Show assembled prompt → let user tweak → send. Gated behind a "Show prompt" toggle. |

---

## 7. Phasing (revised from old WP-B Phase 1-4 model)

- **Phase 0 — Cleanup** (§1): orphan deletion, types tidy. Single hygiene commit.
- **Phase 1 — §16.4 close** (§2): the 7 open feature items. Complete Branding tab MVP.
- **Phase 1.5 — WP-7 audit** (§3): E2E test pass on both workflows. Records to `test-outputs/preset-test-log.md`. Validates §16.4d before declaring v1 done.
- **Phase 2 — Batch + prompt-editable mode:** "GENERATE ALL" button, parallel Nano calls (3-4 concurrent), streaming UI. Show-prompt toggle for power users.
- **Phase 3 — Catalog expansion (= HUASHU §A2 landing):** Scene-templates redistribution (5 new presets) + extended catalog (Letterhead 3:4, Packaging 1:1/3:4, Merchandise grid, Email signature, Menu/price list). All new entries are added to `BRAND_PRESETS` — zero framework changes.
- **Phase 4 — Brand library view + CD review loop:** Dedicated gallery view of all brand assets per session. Group by vibe, then by preset type. One-click ZIP. CD review wired to MCP `submit_image_verdict` with optional regen-with-notes.

---

## 8. Files manifest (consolidated)

### Live files (DO NOT delete)

```
lib/brand-data.ts                            ← brandDataFromVibe / brandDataBlock / isBrandDataComplete
lib/presets-brand.ts (or wherever            ← BRAND_PRESETS catalog (revise to final 7 per §16.4a)
   BRAND_PRESETS lives — verify path)
components/advanced/AdvancedMode.tsx         ← TabState.brandStaging (§16.4b), vibe picker state (§16.4c),
                                               buildFilenameHint brand branch (§16.4e), activeTab cast (§16.4f)
components/advanced/PresetsStaging.tsx       ← brand-mode slot cards (§16.4b)
app/api/edit-image/route.ts                  ← brand-mode chroma-key wiring (§16.4d), mode: 'brand' branch (§16.4f)
lib/types.ts                                 ← BrandStaging interface, GenerationRecord.mode = 'brand'
```

### To create

```
components/advanced/BrandVibePicker.tsx      ← §16.4c — pill dropdown in Zone 2 tab bar
public/{session}/test-outputs/                ← WP-7 — preset-test-log.md target dir
  preset-test-log.md
```

### To delete (Phase 0)

```
components/advanced/BrandingPanel.tsx        ← orphan
components/advanced/BrandDataEditor.tsx      ← orphan
components/advanced/DeliverablePicker.tsx    ← orphan
lib/brand-deliverables.ts                    ← orphan
app/api/brand/generate/route.ts              ← orphan
```

---

## 9. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Nano ignores aspect ratio in prompt body | Pass aspect as explicit API parameter. Prompt body is secondary. |
| Brand data in VibeData incomplete (missing mood, incomplete colors) | `isBrandDataComplete()` already exists in `lib/brand-data.ts`. Editor highlights missing fields. Generate disabled until minimum viable brand data present. |
| Generated deliverables feel template-y | Each preset includes a `Register:` line pointing to a high-end reference (Pentagram, IBM, Stripe). WP-7 stress-tests with diverse vibes; preset prompts iterate based on outputs. |
| Users edit heading font in Branding, expecting persistence to vibe | Override indicator + explicit "This change is for this generation only. Update the vibe to make it permanent." copy. |
| Logo generates something that looks nothing like staged source image | Prompt explicitly says "Do not render the source verbatim — design an original mark informed by the brand data." If users want 1:1 logo redraw, that's a different deliverable (Phase 3 logo-restyle). |
| `image_ops` chroma-key threshold too loose → near-magenta brand strokes punched through | WP-7 §3.A `near_magenta_safe` assertion catches it. Tuning threshold is the fix. |
| `image_ops` slice not byte-lossless | WP-7 §3.B `reassembly_lossless` hash match catches it. If failing, the bug is in Sharp config (color space, jpeg recompression on extract output). |
| §16.4d wired before WP-7 chroma-key validation passes | Order discipline: §16.4d ships LAST per recommended order in §2. Don't wire production until tests pass. |

---

## 10. Acceptance — Phase 1 ships when

- [ ] Phase 0 cleanup landed (5 orphan files deleted, types tidy, no dead imports)
- [ ] §16.4a — `BRAND_PRESETS` is the final 7 (Logo / Brand Guideline / Business Card / Storefront Sign / QR Card / Social Post / Social Story)
- [ ] §16.4b — Slot staging UI lives; per-preset slots render correctly; click-to-assign works
- [ ] §16.4c — Vibe picker pill in Zone 2 tab bar; brand-data driven by selected vibe (not hardcoded `vibes[0]`)
- [ ] §16.4d — Logo generation produces real-alpha PNG via `image_ops` chroma-key + format-convert; intermediate JPG handled per decision #7
- [ ] §16.4e — Filenames `brand-{vibeKey}-{presetId}-v{n}.{ext}` (no `layout-` fallthrough)
- [ ] §16.4f — `mode: 'brand'` typed end-to-end (client cast, server dispatch, GenerationRecord)
- [ ] §16.4g — All 7 presets rewritten per WP-15 principles; pass `submit_proofread` rubric
- [ ] WP-7 §3 — `preset-test-log.md` exists with PASS results across all assertions for both workflows
- [ ] Each preset's output matches its declared aspect ratio (measure pixel dimensions, not "looks right")
- [ ] Brand data visibly drives every output (fonts match, colors match, voice sample appears where prompt asks)
- [ ] Iterating generates versioned files, no overwrites
- [ ] Brand assets discoverable in IMAGES.md under `## Brand Assets`
- [ ] Tab state stable across switches — no state loss
- [ ] Typecheck passes, no new ESLint errors

---

# Appendix — Historical record

The original WP-B1..WP-B5 spec below is the SUPERSEDED 7-deliverable plan. Preserved for archeology only. **DO NOT IMPLEMENT.** All authoritative work is above (§1-§10). The 5 component/lib/api files referenced in WP-B2..WP-B4 are orphan dead code awaiting Phase 0 deletion.

> Original spec note (preserved): "INTEGRATED 2026-04-30. This plan has been folded into `docs/HUASHU-INTEGRATION-PROPOSAL.md` v4 §A1 (the BRANDING tab section)." That integration is itself now superseded by WP-16; HUASHU §A1 is reference only (see §4 above).

## A. Original 17-section spec (historical, do not implement)

The full original BRANDING-PLAN.md content (sections 1-17 — Why / User Flow / Deliverables Catalog / Architecture / Data Model / Shared brand-data block / Prompt Templates / Workpackages WP-B1 through WP-B5 / File Manifest / Output Naming / Aspect Ratio / Auto-cataloging / Phasing / Open Decisions / Test Plan / Success Criteria / Risks) lived here through 2026-05-01. The substantive content is preserved verbatim in `HUASHU-INTEGRATION-PROPOSAL.md` v4 §A1.1 through §A1.15 (lines 47-540 of that file) and is referenced from §4 above when relevant.

The reason the full text is no longer duplicated here: it described an architecture (`BrandingPanel.tsx`, `BrandDataEditor.tsx`, `DeliverablePicker.tsx`, `lib/brand-deliverables.ts`, `app/api/brand/generate/route.ts`) that was never the live shipping path. WP-16 chose a different architecture — brand inherits the Advanced Mode tab framework + `/api/edit-image` pipeline + MCP `image_ops` postproc, with `lib/brand-data.ts` as the only retained module. Keeping the verbatim text here would invite someone to re-implement the orphan files.

If you need the original prompt templates for the 7 deliverables, read HUASHU-INTEGRATION-PROPOSAL.md §A1.6 and treat them as starting references — §16.4g requires WP-15-compliant rewrites before they ship.

**End of plan.**
