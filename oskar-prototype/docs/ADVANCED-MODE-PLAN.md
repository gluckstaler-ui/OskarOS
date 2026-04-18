# Advanced Mode — Implementation Plan

## Context

The current AssetsPanel shows images in a flat grid with hover overlays for inline editing (BentoTile: prompt textarea + Advanced/Generate buttons). The user built a working HTML mockup (`public/2026-01-27-31/advanced-mode-a.html`) that replaces this with a 4-zone professional image workstation. Five modes: View, Generate, Edit, Compose, Layout.

Key architecture decisions proven in the mockup:
- Presets written BY Nano Banana (it knows what it can do), reviewed BY CD
- Nano Banana descriptions baked into every image — used as prompt foundation
- Live prompt rebuilding as user fills compose/layout slots
- Staging area with role-tagged slots (Scene + Subjects for Compose, Hero + Cells for Layout)
- Version sidebar showing generation history per image
- Cross-tab state preservation — switching tabs doesn't nuke your work
- Preset categories with inline labels (Filters, Object Edits, Art Direction, Advanced)
- Per-mode instructional placeholders in both Zone 3 and Zone 4
- Copy button inserts at cursor (non-destructive)
- Exit button (not Approve/Discard)

Reference mockup: `public/2026-01-27-31/advanced-mode-a.html`

---

## Architecture — Component Hierarchy

One shell component coordinating four zone components. No god components.

```
AdvancedMode.tsx           — Grid shell, tab state machine, cross-tab state store, coordinates children
├── AssetGrid.tsx          — Zone 1: thumbnails, click handlers, role badges (Scene/Subj/Hero)
├── CanvasPreview.tsx      — Zone 2: image display, description overlay, version sidebar, bento preview
├── PresetsStaging.tsx     — Zone 3: category-grouped preset pills, staging slots, Ask CD textarea + response
└── PromptEditor.tsx       — Zone 4: prompt textarea, aspect ratio pills, resolution pills, Generate button
```

**Each component: 200-350 lines.** The parent owns shared state (selected image, active tab, staged slots, prompt text) and passes handlers down. Children own their own rendering and local UI state.

### Shared State (owned by AdvancedMode.tsx):

```typescript
interface AdvancedModeState {
  activeTab: 'view' | 'generate' | 'edit' | 'compose' | 'layout'
  perTabState: Record<string, TabState>  // preserved across tab switches
  selectedImage: SourceImage | null
  prompt: string
  aspectRatio: string
  resolution: string
  activePreset: Preset | null
  // Compose-specific
  sceneSlot: SourceImage | null
  subjectSlots: (SourceImage | null)[]
  // Layout-specific
  layoutSlots: (SourceImage | null)[]
}

interface TabState {
  prompt: string
  preset: Preset | null
  selectedImage: SourceImage | null
  heroSrc: string
  description: string
  badges: BadgeState[]
  // compose/layout slot state preserved in DOM (hidden, not destroyed)
}
```

---

## Entry Points + AssetsPanel Hover Redesign

### The Problem With Current Hover:

Current BentoTile hover is overloaded: fullscreen icon, filename, delete, an inline prompt textarea, "Advanced" button, "Generate" button — all crammed into a thumbnail overlay. With Advanced Mode, the inline prompt editing and generate are redundant. Advanced Mode IS the editing interface.

### Current AssetsPanel Hover (BentoTile):
- Fullscreen icon (top-left) → opens fullscreen modal
- Filename + delete X (top-right)
- Prompt textarea (inline, user edits prompt right on the thumbnail)
- **Advanced** button (amber) → opens fullscreen modal (same as fullscreen icon)
- **Generate** button (blue/purple) → fires `onSourceImageEdit` with inline prompt

### Proposed AssetsPanel Hover:

**Visual mockup:** `public/2026-01-27-31/hover-mockup.html`

Kill the inline prompt textarea. Kill the duplicate fullscreen triggers. The overlay now shows what matters: what's IN the image (Nano description) and what's PLANNED for it (existing prompt preview).

**Overlay content on hover:**
1. **Filename** (top-left, bold) + **Delete X** (top-right)
2. **Nano description** — 3-line clamp, white @ 55% opacity. What the image contains.
3. **Prompt preview** — single line, green italic, ellipsis overflow. Shows the existing edit prompt if one exists. If no prompt: "No edit prompt — click Edit to start" in dim text.
4. **Two buttons** pinned at bottom: **👁 View** (ghost) and **✏️ Edit** (amber)

**Hero images** get additional treatment: green border on the tile even without hover, plus a "HERO" badge (top-left corner). Their prompts are pre-loaded — CD already wrote them during vibe development.

| Element | Action | Why |
|---------|--------|-----|
| **👁 View** button | → Advanced Mode, **View** tab, this image selected | "I want to see this bigger + check its description and versions" |
| **✏️ Edit** button | → Advanced Mode, **Edit** tab, this image selected, **existing prompt loaded** into Zone 4 | "I want to work on this image" |
| Nano description | Read-only display | User sees what Nano thinks is in the image without opening Advanced Mode |
| Prompt preview | Read-only display | User sees if a prompt exists and what it says — at a glance |
| Delete X | Delete image | Unchanged |

**Removed:**
- Inline prompt textarea → editing moved to Advanced Mode Zone 4
- "Advanced" button → replaced by "Edit" (clearer intent)
- "Generate" button → generating moved to Advanced Mode Zone 4
- Fullscreen icon → replaced by "View" (same destination, clearer label)

**Why two buttons, not one?** View is read-only inspection. Edit is work mode. Different intent, different landing tab. Click View → you see the image big, check its description, browse versions. Click Edit → you land in Edit tab, existing prompt is loaded, presets are ready, you're working.

### Prompt Pre-loading:

This is the part everyone missed. The current system already has prompts for most images — in IMAGES.md Reprompt fields, in CD's analysis, in imageManifests. When Advanced Mode opens for a specific image, that work must be there.

**Where prompts come from (priority order):**
1. `imageManifests` — if this image has a manifest entry with a prompt → use that
2. `sourceImage.reprompt` — if Nano Banana or CD wrote a reprompt → use that
3. `sourceImage.analysis` — Nano's original description → use as fallback context
4. Nothing → show instructional placeholder

**What gets loaded where:**
- Zone 2 description overlay: always shows the Nano Banana description (what's IN the image)
- Zone 4 prompt textarea: loads the existing EDIT prompt (what to DO with the image)
- These are different things. Description = "peregrine falcon on wooden stand." Prompt = "Make the falcon's feathers shimmer with iridescent highlights."

**Hero images especially.** CD has already written refined prompts for hero shots during vibe development. Those prompts exist in IMAGES.md. If the user clicks Edit on a hero image and Zone 4 is empty, we've thrown away work.

### The `openAdvancedMode` Call:

Both entry points call the same function with different parameters:

```typescript
openAdvancedMode({
  image: sourceImage,           // which image to select
  tab: 'view' | 'edit',        // which tab to land on
  prompt: existingPrompt,       // pre-loaded from IMAGES.md / manifests (can be null)
  description: nanoDescription, // Nano's analysis text
})
```

---

## Stage 1A: Shell + Tab State Machine + Basic Grid
**Workpackage: WP-1A** | **Dependencies: None** | **Estimate: 1 session**

Shell + tab switching + basic asset grid. View mode preview only (no version sidebar yet, no prompt pre-loading yet).

### Files:
| File | Action | Lines est. |
|------|--------|------------|
| `components/AdvancedMode.tsx` | CREATE — shell, tabs, state | ~300 |
| `components/advanced/AssetGrid.tsx` | CREATE — Zone 1 | ~200 |
| `components/advanced/CanvasPreview.tsx` | CREATE — Zone 2 (basic preview) | ~180 |
| `components/advanced/PresetsStaging.tsx` | CREATE — Zone 3 (placeholder) | ~150 |
| `components/advanced/PromptEditor.tsx` | CREATE — Zone 4 (placeholder) | ~150 |
| `app/page.tsx` | MODIFY — state for open/close | ~30 |

### Deliverables:
1. 4-zone CSS grid layout matching mockup
2. Tab bar: View | Generate | Edit | Compose | Layout (only View functional, others show placeholders)
3. **Exit** button (top-right of tab bar, ghost style)
4. Zone 1: Asset grid from `sourceImages` — click → green highlight, image in Zone 2
5. Zone 2: Full preview + description overlay + copy-to-prompt button (insert-at-cursor, non-destructive)
6. Cross-tab state preservation built in from the start (per-tab state store, save on leave, restore on return)

### Explicitly NOT in WP-1A:
- Version sidebar → WP-1C
- Prompt pre-loading from IMAGES.md → WP-1D

### Test — Integration:
1. **State machine stress test:** Open Advanced Mode. Select sultan.jpg in View. Switch to Edit. Switch to Compose. Switch back to View. Is sultan.jpg still selected? Is the description still there? Switch to Layout. Back to Edit. 10 round trips. Log every state transition. Any leak = fail.
2. **Description overlay grounding:** Select 5 different images. For each: read the description in the overlay, then read the actual image. Is the description accurate? Does it match what's visually in the image? If description says "falcon" but image is a cat = fail.
3. **Copy-to-prompt non-destructive:** Type text in Zone 4. Click copy button on description. Is text inserted at cursor position? Does existing text remain? Move cursor, click again. Insert at new position?
4. **Exit integrity:** Open Advanced Mode, do work, Exit. Reopen. Is the state fresh or stale? (Should be fresh — Advanced Mode doesn't persist across open/close.)

---

## Stage 1C: Version Sidebar + Generation Lineage
**Workpackage: WP-1C** | **Dependencies: WP-1A** | **Estimate: 1 session**

Version sidebar showing generation chains per image. Requires data model work, not just UI.

### The Problem:

Generated images have parent images (an edit has a source, a compose has multiple sources). To show "original → v1 → v2 → v3" we need a lineage chain traversal. The current `SourceImage` type has no parent pointer.

### Files:
| File | Action |
|------|--------|
| `lib/types.ts` | MODIFY — add `parentImage` to SourceImage, add GenerationRecord type |
| `components/advanced/CanvasPreview.tsx` | MODIFY — version sidebar |
| `lib/session-actions.ts` | MODIFY — persist lineage to IMAGES.md |

### Deliverables:
1. `parentImage?: string` field on SourceImage (filename of source, null for uploads)
2. `GenerationRecord` type written to IMAGES.md sub-entries so lineage survives reload
3. Version sidebar traversal: select image → walk parent chain backward, walk children chain forward
4. Grouped display: Original at top, generations below in chronological order
5. Click version → Zone 2 swaps to that version
6. Branching: if edit v2 is re-edited → two branches appear
7. Rapid switching between versions: no flash, no lag

### Test — Integration:
1. **3-step chain:** Upload hero.jpg. Edit → v1. Edit v1 → v2. Edit v2 → v3. Select v3: does sidebar show hero → v1 → v2 → v3? Select hero: does sidebar show all 3 descendants?
2. **Branching:** Upload hero.jpg. Edit → v1. Edit v1 → v1a. Edit v1 (again) → v1b. Select v1: does sidebar show both v1a and v1b?
3. **Persistence:** Create a 3-step chain. Close Advanced Mode. Reopen. Select v3. Is chain still intact? Restart the app. Still intact?
4. **Compose lineage:** Compose cliff-majlis + sultan + haboob → result. Does the result show all 3 sources in its lineage view?

---

## Stage 1D: Prompt Pre-Loading (4-Tier Waterfall)
**Workpackage: WP-1D** | **Dependencies: WP-1A** | **Estimate: 1 session**

When an image is selected in Advanced Mode, load the existing prompt from the highest-priority source.

### Priority Order:
1. `imageManifests[].assets[].instruction` — CD-written manifest prompt (highest priority, for hero/vibe slots)
2. `sourceImage.reprompt` — Explicit reprompt written to IMAGES.md
3. `sourceImage.sourcePrompt` — Prompt that was used to generate this image
4. Empty with instructional placeholder — "Select a preset above, or write your own instruction..."

### Files:
| File | Action |
|------|--------|
| `components/AdvancedMode.tsx` | MODIFY — prompt resolver on image select |
| `lib/image-prompt-resolver.ts` | CREATE — waterfall logic |

### Deliverables:
1. `resolvePrompt(image, manifests): { prompt: string, source: 'manifest' \| 'reprompt' \| 'sourcePrompt' \| 'none' }`
2. Source indicator in Zone 4 (tiny label: "From IMAGES.md" / "From generation" / "New")
3. When user edits prompt: source indicator becomes "Modified"
4. When user selects different image: prompt re-resolves from new image's priority chain

### Test — Integration:
1. **Hero image with manifest:** Select a hero-tagged image that has a manifest entry. Does Zone 4 load the MANIFEST prompt (not the sourcePrompt)? Check source indicator says "From IMAGES.md".
2. **Uploaded image with reprompt:** Find an uploaded image where CD wrote a reprompt. Select it. Does the reprompt load?
3. **Generated image:** Select an image generated this session. Does sourcePrompt load? Indicator says "From generation"?
4. **Plain upload:** Select an uploaded image with no prompt anywhere. Zone 4 empty with placeholder?
5. **Priority conflict:** Manually create an image with BOTH manifest AND reprompt. Which wins? (Should be manifest — highest priority.)
6. **10 switches:** Switch between 10 different images. Does prompt always match the selected image? Any stale prompts = fail.

---

## Stage 1B: AssetsPanel Hover Redesign
**Workpackage: WP-1B** | **Dependencies: WP-1A** | **Estimate: 1 session**

Replace the current overloaded BentoTile hover with a clean View/Edit entry point overlay. The inline editing era is over — Advanced Mode is where editing happens.

**Visual mockup:** `public/2026-01-27-31/hover-mockup.html` — shows all 4 states side-by-side with the current hover for comparison.

### What Gets Killed:
| Current element | Why it dies |
|-----------------|-------------|
| Inline prompt `<textarea>` | Editing moves to Advanced Mode Zone 4 |
| "Advanced" button (amber) | Replaced by "Edit" — clearer intent, same destination |
| "Generate" button (blue/purple) | Generation moves to Advanced Mode Zone 4 |
| Fullscreen icon (⤢ top-left) | Replaced by "View" button — same action, clearer label |

### What Replaces It:

```
┌─────────────────────────────┐
│ ████████████████████████████ │  ← dark overlay (rgba(0,0,0,.8))
│                             │
│  filename.jpg            ✕  │  ← 10px Inter 600, white. Delete: red on hover.
│                             │
│  Peregrine falcon perched   │  ← Nano description: 10px, rgba(255,255,255,.55)
│  on carved wooden stand.    │     3-line clamp (-webkit-line-clamp: 3)
│  Sharp plumage detail...    │     Source: sourceImage.analysis
│                             │
│  Prompt: The falcon against │  ← Prompt preview: 9px, rgba(16,185,129,.6), italic
│                             │     1-line, ellipsis overflow
│                             │     Source: resolvePrompt() from WP-1D
│                             │     If no prompt: "No edit prompt — click Edit to start"
│                             │     in rgba(255,255,255,.2) italic
│                             │
│  [  👁 View  ] [ ✏️ Edit  ] │  ← Bottom-pinned, 30px height, 6px gap
│                             │     View: ghost (rgba(255,255,255,.08) bg, #3f3f46 border)
│                             │     Edit: amber (#F59E0B bg, white text)
└─────────────────────────────┘
```

### Button Behavior:

**👁 View** calls:
```typescript
openAdvancedMode({
  image: sourceImage,
  tab: 'view',
  prompt: null,                    // View doesn't pre-load prompt into Zone 4
  description: sourceImage.analysis
})
```

**✏️ Edit** calls:
```typescript
openAdvancedMode({
  image: sourceImage,
  tab: 'edit',
  prompt: resolvePrompt(sourceImage, imageManifests),  // WP-1D waterfall
  description: sourceImage.analysis
})
```

### Hero Image Treatment:

Hero-tagged images get special styling WITHOUT hover:
- **Border:** 2px solid rgba(16,185,129,.3) — green tint, always visible
- **Badge:** "HERO" label, top-left corner, 8px font, #10B981 background, white text, rounded 4px
- **On hover:** border intensifies to solid #10B981

### What Happens to RepromptCards?

Current AssetsPanel has RepromptCards below the image library (EDIT/COMPOSE operations in progress). These stay — they're a different UI concern (pending operations, not image browsing). But their "Advanced" button also needs updating:
- RepromptCard "Advanced" → opens Advanced Mode, Edit tab, with the reprompt's prompt pre-loaded
- RepromptCard "Generate" stays — it fires the existing generation pipeline for that specific reprompt

### What Happens to GenerateTile?

Deleted. Generation lives in Advanced Mode now. The GenerateTile component and its inline prompt textarea are dead code.

### Files:
| File | Action |
|------|--------|
| `components/AssetsPanel.tsx` | MODIFY — BentoTile overlay rewrite, RepromptCard "Advanced" update, GenerateTile redirect |

### Deliverables:
1. New BentoTile hover overlay matching mockup spec above
2. View button → `openAdvancedMode({ tab: 'view' })`
3. Edit button → `openAdvancedMode({ tab: 'edit', prompt: resolvePrompt() })`
4. Nano description: 3-line clamp from `sourceImage.analysis`
5. Prompt preview: single line from `resolvePrompt()` (WP-1D), green italic, or "No edit prompt" dim text
6. Hero images: green border + HERO badge (always visible, no hover required)
7. RepromptCard "Advanced" → opens Advanced Mode Edit tab with reprompt prompt
8. GenerateTile click → opens Advanced Mode Generate tab
9. Kill: inline textarea, old "Advanced" button, old "Generate" button, fullscreen icon

### Test — Integration:
1. **Every image type:** Hover over 5 different images (hero, generated, uploaded, composed, plain upload). Does each show correct Nano description? Correct prompt preview (green italic) or "No edit prompt" (dim)?
2. **Entry point correctness:** Click View on sultan.jpg → Advanced Mode opens on View tab with sultan.jpg in Zone 2, description in overlay, Zone 4 empty. Click Edit on same image → Edit tab, Zone 4 has the existing prompt. These MUST be different experiences.
3. **Hero treatment:** Find a hero-tagged image. Green border visible WITHOUT hovering? HERO badge visible? Click Edit → CD's existing prompt from IMAGES.md pre-loaded in Zone 4?
4. **Prompt preview accuracy:** For an image with an existing prompt — does the green italic line show the first ~60 chars of that prompt? Does it match what loads into Zone 4 when you click Edit?
5. **No-prompt state:** For an image with no prompt anywhere in the system — does the overlay show "No edit prompt — click Edit to start" in dim text? Click Edit → Zone 4 shows instructional placeholder (not stale prompt from another image)?
6. **RepromptCard redirect:** Click "Advanced" on a RepromptCard → Advanced Mode opens with that image selected, Edit tab, reprompt prompt in Zone 4?
7. **GenerateTile redirect:** Click the GenerateTile → Advanced Mode opens on Generate tab, no image selected, Zone 4 empty with generate placeholder?
8. **Delete still works:** Hover → click Delete X → image removed from panel AND from disk. Verify session folder.
9. **No regressions:** Upload a new image → appears in Uploads. Submit → moves to Library. Hover → new overlay works. All existing flows intact.

---

## Stage 2A: Presets Data Structure
**Workpackage: WP-2A** | **Dependencies: WP-1A** | **Estimate: 1 session**

Build the typed preset library. 67 presets, categorized. Pure data work, no UI.

### Files:
| File | Action | Lines est. |
|------|--------|------------|
| `lib/image-presets.ts` | CREATE — all presets with categories | ~500 |

### Preset Data Structure:

```typescript
interface PresetCategory {
  label: string              // "Filters", "Object Edits", etc.
  presets: Preset[]
}

interface Preset {
  label: string              // "Vibrant", "Clean Background"
  // One of these depending on mode:
  prompt?: string            // Generate: static prompt
  editFn?: (desc: string) => string  // Edit: instruction + description
  composeFn?: (data: ComposeData) => string  // Compose: builds from slots
  layoutFn?: (data: LayoutData) => string    // Layout: builds from slots
  // Layout-specific grid metadata:
  gridMeta?: GridConfig      // See WP-5 — drives dynamic bento preview
}
```

Categories per mode:
- **Generate** (15 presets): Website Essentials (6) | Marketing (6) | Creative (3)
- **Edit** (24 presets): Filters (4) | Object Edits (5) | Art Direction (5) | Advanced (10)
- **Compose** (15 presets): Editorial (3) | Placement (5) | Artistic (3) | People & Product (4)
- **Layout** (13 presets): Grids (3) | Editorial (4) | Gallery (4) | Special (2)

### Deliverables:
1. All 67 presets from the mockup ported to typed TS data
2. Full type coverage (no `any`)
3. Grid metadata attached to layout presets (see WP-5 for GridConfig)
4. Unit tests: every preset function produces a non-empty string given valid data
5. Exported helper: `getPresetsForMode(mode)` returns the right category list

### Test:
1. **Type check:** `tsc --noEmit` passes. Zero `any`.
2. **Every preset callable:** Loop through all 67 presets. Invoke their function with a stub. Any throw or empty result = fail.
3. **Mode → categories:** `getPresetsForMode('edit')` returns exactly the Edit categories. No cross-pollution.

---

## Stage 2B: Generate Tab UI
**Workpackage: WP-2B** | **Dependencies: WP-2A** | **Estimate: 1 session**

Wire up the preset pills and prompt editor. UI only, no generation pipeline yet.

### Files:
| File | Action | Lines est. |
|------|--------|------------|
| `components/advanced/PresetsStaging.tsx` | MODIFY — preset pills, categories | ~300 |
| `components/advanced/PromptEditor.tsx` | MODIFY — textarea + pills | ~250 |

### Deliverables:
1. Zone 3: Preset pills rendered by category with inline category labels
2. Click preset → fills Zone 4 prompt textarea (for Generate: static; for Edit: `editFn(description)`)
3. Zone 4: Prompt textarea with per-mode instructional placeholders
4. Zone 4: Aspect ratio pills (1:1, 16:9, 9:16, 3:4, 4:3)
5. Zone 4: Resolution pills (1K, 2K, 4K)
6. Zone 4: Generate button (visually distinct, per-mode color)
7. Tab help text per mode (below tab bar)
8. **No** actual generation yet — Generate button just logs the payload

### Test:
1. **Preset render per mode:** Switch to Generate → see Generate presets. Switch to Edit → see Edit presets. No Compose presets visible in Edit mode.
2. **Click → fill:** Click "Hero Banner" → Zone 4 fills with the preset prompt. Click "Epic Landscape" → prompt swaps.
3. **Placeholder contextual:** No preset selected in Edit mode → placeholder says "Select an image and a preset above..."
4. **Ratio/res state:** Click 16:9. Click 2K. Click Generate → log shows aspectRatio=16:9, imageSize=2K in the payload.

---

## Stage 2C: Generation Pipeline (REVISED 2026-04-17)
**Workpackage: WP-2C** | **Dependencies: WP-2B, WP-1C, WP-15 (contract)** | **Estimate: 1 session**

The actual API call, result handling, and GenerationRecord persistence. Under WP-15, the pipeline now includes CD proofread BEFORE Nano and CD verdict AFTER Nano.

### Files:
| File | Action |
|------|--------|
| `components/AdvancedMode.tsx` | MODIFY — generate handler (calls proofread endpoint first) |
| `app/api/edit-image/route.ts` | MODIFY — call `/api/cd-evaluate-prompt` before Nano, `/api/cd-evaluate-result` after |
| `app/api/generate-image/route.ts` | MODIFY — same |
| `lib/session-actions.ts` | MODIFY — persist GenerationRecord (now includes `proofreadResult` field) |

### Data Flow — Full Pipeline (per WP-15):

When the user clicks Generate:
1. **Proofread call** → POST `/api/cd-evaluate-prompt` with the user's prompt + session context (2s ceiling)
2. If CD returns `severity: 'rewritten'` → substitute CD's prompt; fire snackbar with the note
3. If CD returns `severity: 'advisory'` → keep user's prompt; fire snackbar with the advisory (optional if note is empty)
4. If the proofread times out at 2s → proceed with user's prompt; fire "sent as-is" snackbar
5. **Nano Banana call** → generate image with the (possibly rewritten) prompt
6. Image file saved to session folder
7. New `SourceImage` entry created with `parentImage` set → appears in Zone 1 asset grid
8. `GenerationRecord` written to IMAGES.md under the generated image's sub-entry — INCLUDES `actualPromptSent` (distinct from `userPrompt`) so any rewrite is auditable
9. Version sidebar updates (WP-1C already built this — now it receives new data)
10. **Verdict call** → POST `/api/cd-evaluate-result` with filename + Nano's Turn-2 description + the prompt actually sent (3s ceiling)
11. Verdict snackbar (extended toast) — ✓ / ≈ / ✗
12. Adjusted description (if any) written back to IMAGES.md

**Prompt integrity (WP-15 version):** The pipeline MUST log both `userPrompt` (what the user typed/clicked) AND `actualPromptSent` (what Nano received after any CD rewrite). If they differ, the GenerationRecord's `proofreadResult` explains why. This replaces the old "prompt exactly as in Zone 4" integrity check — under WP-15, the prompt CAN legitimately be rewritten by CD, but the rewrite MUST be logged.

```typescript
interface GenerationRecord {
  id: string
  parentImage?: string         // filename of source image (for edit/compose chains)
  sourceImages: string[]       // all input images
  preset: string               // preset label used
  userPrompt: string           // what the user actually typed/clicked (pre-proofread)
  actualPromptSent: string     // what Nano received (may equal userPrompt, or may be CD's rewrite)
  proofreadResult?: {          // WP-15 — populated on every generation
    severity: 'advisory' | 'rewritten' | 'timeout'
    note: string
  }
  resultImage: string          // filename of generated result
  aspectRatio: string
  timestamp: number
  mode: 'generate' | 'edit' | 'compose' | 'layout'
  verdict?: {                  // WP-15 — populated after post-gen evaluation
    rating: '✓' | '≈' | '✗'
    note: string
    adjustedDescription?: string
  }
}
```

### Deliverables:
1. Generate button → proofread → Nano call → verdict pass (full WP-15 pipeline)
2. Loading state in Zone 2 during generation (covers all three phases)
3. Success: new image in Zone 1, preview in Zone 2, GenerationRecord written with both prompts + proofread result + verdict
4. Failure: error in Zone 4 with Retry button (see Error Recovery section below)
5. **Prompt integrity audit:** log BOTH `userPrompt` and `actualPromptSent`. WP-7 preset audit reads `userPrompt` (ignores CD rewrites) for preset quality scoring; regression tests compare `actualPromptSent` to Nano's log.

### Test — Integration:
1. **Generate 5 images with 5 different presets** (Hero Banner, Product Shot, Epic Landscape, Isometric 3D, Abstract Concept). CD evaluates ALL 5 results: did the preset instruction produce what it described? Score 1-5 each. Log results.
2. **Prompt integrity (updated for WP-15):** Before clicking Generate, copy the prompt from Zone 4. After generation, read GenerationRecord. If `proofreadResult.severity === 'advisory'` or `'timeout'`, `actualPromptSent` === user's Zone 4 text. If `'rewritten'`, `actualPromptSent` MUST differ AND `proofreadResult.note` MUST explain why. Unexplained mutation = bug.
3. **Aspect ratio obedience:** Generate with 16:9, then 1:1, then 9:16. Are the output images actually those ratios? Measure pixel dimensions.
4. **Resolution obedience:** Generate same prompt at 1K, 2K. Is 2K visibly higher resolution?
5. **Asset grid sync:** After generation, does the new image appear in Zone 1 immediately? Can you click it? Does its description show in Zone 2?
6. **GenerationRecord persistence:** After generation, read IMAGES.md. Is the full record there (preset, prompt, parentImage, timestamp, mode)? Restart app. Still there?
7. **Version chain integration:** Generate from "Hero Banner". Edit the result with "Vibrant". Edit THAT result with "Night Scene". Does WP-1C sidebar show the 3-step chain?

---

## Stage 3: Edit Tab
**Workpackage: WP-3** | **Dependencies: WP-2, WP-15 (contract)** | **Estimate: 1 session**

Single-image editing with description-aware presets. Inherits WP-15 contract: every Generate click goes through proofread → Nano → verdict; all CD output routes to snackbar; prompt rewrites overwrite Zone 4 in place.

### Files:
| File | Action |
|------|--------|
| `components/advanced/PresetsStaging.tsx` | MODIFY — edit mode |
| `components/advanced/CanvasPreview.tsx` | MODIFY — before/after in versions |

### Deliverables:
1. Edit flow: select image → description populates → click edit preset → `editFn(description)` → prompt fills → tweak → Generate
2. Existing prompt from IMAGES.md pre-loaded into Zone 4 when image selected
3. Before/after comparison via version sidebar (original + generations in chronological order)
4. Green highlight on selected image in asset grid

### Test — Integration:
1. **Every edit tier tested:** Run one preset from each category on the SAME image (sultan.jpg):
   - Filter: "Vibrant" — are colors actually more saturated?
   - Object Edit: "Clean Background" — is the background actually removed?
   - Art Direction: "Watercolor" — does it look hand-painted?
   - Advanced: "Portrait Pro" — is it sharper with better lighting?
   CD evaluates all 4 results. Log with scores.
2. **Description feeding:** Select sultan.jpg. Read the description in Zone 2. Click "Vibrant" preset. Read the prompt in Zone 4. Is the description IN the prompt? Is it appended correctly? Does the preset instruction come BEFORE the description?
3. **Prompt pre-loading on switch:** Select a hero image with existing prompt → Zone 4 shows it. Select a different image → Zone 4 updates. Select original hero → original prompt returns. 10 switches. Any stale prompt = fail.
4. **Edit chain quality:** Edit sultan.jpg with "Vibrant". Then edit the RESULT with "Night Scene". Does the second edit use the RESULT's description (from 2-turn), not the original sultan.jpg description? This tests description propagation through edit chains.
5. **Before/after version sidebar:** After editing, click original in sidebar → original shows. Click edit → edit shows. Rapid switching 5 times. Any flash, wrong image, or lag = fail.

---

## Stage 4: Compose Tab + Staging Area
**Workpackage: WP-4** | **Dependencies: WP-2, WP-15 (contract)** | **Estimate: 1-2 sessions**

Inherits WP-15 contract. Compose is the highest-risk surface for silent rewrite — ambiguous multi-subject masking triggers CD to rewrite. Staged images list is part of the proofread payload so CD knows what's on the table.

Multi-image composition with staging slots and live prompt building.

### Files:
| File | Action |
|------|--------|
| `components/advanced/PresetsStaging.tsx` | MODIFY — compose staging |
| `components/AdvancedMode.tsx` | MODIFY — compose state |

### Deliverables:
1. Staging: Scene slot (green) + Subject slots (orange, initially 3) + "+" button + Reset
2. Toggle selection: click image → fills next empty slot. Click again → removes. (proven in mockup)
3. Asset grid badges: "Scene" / "Subj" on assigned images
4. Live prompt building from `ComposeData` — **includes descriptions, not just filenames**:
   ```
   "Seamlessly integrate sultan.jpg (peregrine falcon on wooden stand) into 
   cliff-majlis.jpg (cliff-top majlis at golden hour, man in white thobe...)"
   ```
5. Zone 2 shows scene image when scene slot filled
6. Prompt builds even without a preset selected (neutral listing of staged images in roles). Preset refines the instruction.

### Test — Integration:
1. **Compose with 2, 3, 4, 5 images.** Start with cliff-majlis.jpg as scene + sultan.jpg as subject. Generate. Then add haboob.jpg. Generate again. Then shams.jpg + qamar.jpg. Generate. CD evaluates ALL 3 results:
   - Do ALL subjects actually appear in the composed image?
   - Is the lighting matched between scene and subjects?
   - Are subjects at correct scale?
   - Any floating/pasted-on look = fail.
2. **Prompt includes descriptions, not just filenames:** Fill 3 slots. Read Zone 4 prompt. Does it say "sultan.jpg (peregrine falcon on wooden stand)" or just "sultan.jpg"? Just filename = fail.
3. **Slot toggle:** Fill Scene + 2 Subjects. Click the scene image again in Zone 1. Does the scene slot clear? Click a different image. Does it fill the scene slot? Is the prompt updated?
4. **Cross-tab preservation:** Fill Scene + 3 Subjects in Compose. Switch to Edit. Switch back to Compose. Are ALL 4 slots still filled? Are badges still on the images in Zone 1?
5. **Prompt without preset:** Fill 3 slots but DON'T select a preset. Is there a neutral prompt listing the staged images in their roles? It should read naturally, not "[scene] [subjects]" placeholders.
6. **Scene description appended:** After the preset prompt, is the scene's full Nano Banana description appended? This gives Gemini the visual context it needs.

---

## Stage 5: Layout Tab + Bento Preview Engine
**Workpackage: WP-5** | **Dependencies: WP-2C, WP-15 (contract)** | **Estimate: 1-2 sessions**

Inherits WP-15 contract. Slot contents list is part of the proofread payload.

Multi-image layout/grid with live bento preview. **This is a mini layout engine, not a CSS tweak.** The preset data structure carries grid metadata that drives both the staging slot count AND the Zone 2 preview rendering.

### The Grid Engine:

```typescript
interface GridConfig {
  columns: string              // CSS grid-template-columns, e.g. "1fr 1fr" or "1fr 2fr"
  rows: string                 // CSS grid-template-rows, e.g. "1fr 1fr"
  cells: CellConfig[]          // Per-cell placement + role
  minSlots: number             // Minimum slot count
  maxSlots: number             // Maximum slot count
  allowsExpansion: boolean     // Can user click "+" to add more?
}

interface CellConfig {
  role: 'hero' | 'cell'        // Hero cell is visually distinct (larger/highlighted)
  slotIndex: number            // Which slot in staging fills this cell
  gridColumn?: string          // e.g. "1" or "1 / 3" for spanning
  gridRow?: string             // e.g. "1 / 3" for spanning
}
```

### Per-Preset Grid Metadata (attached in WP-2A):

| Preset | columns | rows | cells | min/max slots |
|--------|---------|------|-------|---------------|
| Bento 2×2 | `1fr 1fr` | `1fr 1fr` | hero spans row 1/3 col 1, cells 2/3/4 | 4/4 |
| Bento Asymmetric | `2fr 1fr` | `1fr 1fr` | hero col 1 / row 1-2, cells col 2 | 3/3 |
| Triptych | `1fr 1fr 1fr` | `1fr` | 3 equal cells | 3/3 |
| Side by Side | `1fr 1fr` | `1fr` | 2 cells | 2/2 |
| Editorial Stack | `1fr` | `auto 1fr` | hero row 1, row of cells row 2 | 3/5 |
| Filmstrip | `repeat(N, 1fr)` | `1fr` | N equal cells, N=slots.length | 3/8 |
| Portfolio Grid | `repeat(3, 1fr)` | `repeat(auto, 1fr)` | uniform cells | 4/9 |
| Mosaic | `1fr 2fr 1fr` | `1fr 2fr` | mixed sizes | 4/6 |

### Files:
| File | Action |
|------|--------|
| `lib/grid-engine.ts` | CREATE — GridConfig types + renderer logic |
| `components/advanced/PresetsStaging.tsx` | MODIFY — slot count adapts to preset |
| `components/advanced/CanvasPreview.tsx` | MODIFY — render grid from GridConfig |

### Deliverables:
1. `GridConfig` type + per-preset grid metadata in `image-presets.ts`
2. Grid renderer: given GridConfig + filled slots, produces the CSS grid layout in Zone 2
3. Staging slot count driven by preset: switching from Bento 2×2 to Triptych reduces slots from 4 to 3
4. When slot count decreases: preserve slots 1..newCount, drop extras (warn if dropped)
5. When slot count increases: existing slots preserved, new empty slots appended
6. Layout prompt building from `LayoutData` (slot filenames + descriptions in order)
7. Hero slot visually distinguished in staging AND in preview (size + border color)

### Test — Integration:
1. **Every layout type generates correctly:** Test with 4 real images (sultan, haboob, shams, qamar):
   - Bento 2×2 → CD evaluates: are there 4 cells? Is hero larger? Gutters clean?
   - Triptych → CD evaluates: exactly 3 panels? Equal widths?
   - Side by Side → 2 panels, 50/50 split?
   - Filmstrip → single row, all images visible?
   Log each result with score.
2. **Bento preview accuracy:** Fill 4 layout slots. Does the bento preview in Zone 2 show the ACTUAL images in the CORRECT cells? Swap two images in slots. Does preview update immediately?
3. **Preset-driven slot count:** Select Triptych → staging should show 3 slots (not 4). Select Bento 2×2 → 4 slots. Select Side by Side → 2 slots. Switch between presets 5 times. Do slot counts always match? Do images carry over when possible (slot 1-2 preserved when going from 4-slot to 2-slot)?
4. **Large grid:** Click "+" to add slots until you have 6. Fill all 6. Does the bento preview handle it? Select "Portfolio Grid" preset. Generate. CD evaluates: are all 6 images in the result?
5. **Aspect ratio interaction:** Generate a layout at 16:9. Then at 1:1. Then at 9:16. Do the grid proportions adapt to the aspect ratio? Does a portrait layout still make sense?

---

## Stage 6A: Ask CD — UI + Prompt Routing (REVISED 2026-04-17)
**Workpackage: WP-6A** | **Dependencies: WP-1, WP-15 (contract)** | **Estimate: 1 session**

> **Status note (2026-04-17):** The original WP-6A contract ("`## IMAGE PROMPT` / `## FEEDBACK`" two-block response, prompt replaces Zone 4, feedback becomes snackbar) is SUPERSEDED by WP-15 for all Image Mode behavior. WP-6A now describes only the Ask CD UI affordances (textarea, send button, staging). CD's response behavior — how it's routed, what snackbars fire, when chat logs — follows WP-15.

### What WP-6A still owns:
- Ask CD textarea + "Send to CD" button in Zone 3
- The `AskCDRequest` payload shape (below) used by `/api/ask-cd`
- The "staged images" concept for Compose/Layout modes

### What moved to WP-15:
- Snackbar-first output channel
- Paper-trail logic
- Silent rewrite authority
- Proofread pass before Nano
- Post-generation verdict
- Augenmass chat filter

### The Contract (unchanged intent, new routing per WP-15):

User asks CD → CD writes/improves the prompt AND/OR comments. CD's output routes per WP-15:
- In Image Mode (Advanced Mode / all sub-tabs): reply lands as a snackbar; conversation lands in chat log via Augenmass.
- Rewrites to the prompt field: overwrite in place; snackbar announces the change and reason.
- No mandatory `## IMAGE PROMPT` / `## FEEDBACK` headers — the `/api/cd-evaluate-prompt` endpoint (WP-15) produces structured output directly.

### Legacy behavior (still supported for non-Image-Mode surfaces):

The old `## IMAGE PROMPT` / `## FEEDBACK` header parsing remains as a tier-4 fallback in `lib/chat-parser.ts` — preserved for Briefing chat compatibility where CD still writes in long-form markdown. It is NOT the primary path for Advanced Mode anymore.

**Snackbar behavior in Image Mode (per WP-15):**
- All CD output → snackbar
- Extended-toast (sticky) for verdicts
- Short toast (auto-dismiss 5s) for advisories / passthroughs
- Multiple points: split into separate snackbars if CD uses bullet points

### Soft Fallback — When CD Breaks the Format:

CD is an LLM. It will sometimes forget `## IMAGE PROMPT`, write `## Prompt`, put the prompt before the header, or just respond conversationally. The parser must degrade gracefully, not hard-fail.

**Fallback waterfall (priority order):**
1. **Strict match:** `## IMAGE PROMPT\n...` → extract, send to Zone 4. Done.
2. **Loose match:** Any `##` or `###` header containing "prompt" (case-insensitive) — extract content until next header or EOF.
3. **Pattern match:** First code block after "prompt" keyword — some CDs wrap prompts in backticks.
4. **Heuristic match:** The longest paragraph in the response that's NOT a greeting/preamble — likely the prompt.
5. **Full response dialog:** No match found → show a dialog: "CD's response doesn't contain a clearly-marked prompt. Here's the full response: [text]. Use it as prompt? [Use] [Dismiss]"

**Never hard-fail.** The user typed a question, CD spent tokens answering — they deserve the content even if the format is off.

**Dialog UX:** Modal with scrollable text area. Two buttons: "Use as Prompt" (copies to Zone 4) and "Dismiss" (just closes). Snackbar after: "Parsed using fallback — prompt format was unusual."

**Logging:** Every fallback tier that fires gets logged. If tier 4+ fires more than 10% of the time, the CD agent prompt needs tuning.

### What CD Receives:

The message to CD includes full context so CD can write a good prompt:

```typescript
interface AskCDRequest {
  source: 'advanced-mode'
  mode: 'generate' | 'edit' | 'compose' | 'layout'
  image: {
    filename: string
    description: string        // Nano's analysis
  }
  currentPrompt: string        // what's currently in Zone 4
  stagedImages?: {             // compose/layout only
    scene?: string
    subjects?: string[]
    slots?: string[]
  }
  userMessage: string          // what the user typed in Zone 3
}
```

CD sees: the image, its description, what the user has so far, what mode they're in, and what they're asking. CD writes back a complete `## IMAGE PROMPT` block.

### Message Flow:

```
User types in Zone 3 → "Send to CD"
  ↓
Message sent to chat bridge tagged with AskCDRequest context
  ↓
CD receives: image context + current prompt + user question
  ↓
CD responds with ## IMAGE PROMPT block (always)
  ↓
Regex parser extracts prompt text → Zone 4 textarea (replaces content)
  ↓
Snackbar: "✏️ CD updated your prompt"
  ↓
Any additional CD commentary → stays in chat panel (not routed to Advanced Mode)
```

### Files:
| File | Action |
|------|--------|
| `components/advanced/PresetsStaging.tsx` | MODIFY — Ask CD textarea + send button |
| `app/api/chat-stream/route.ts` | MODIFY — detect `source: 'advanced-mode'`, attach context |
| `lib/chat-parser.ts` (or equivalent) | MODIFY — regex for `## IMAGE PROMPT` → Zone 4 |
| `agents/creative-director-agent.md` | MODIFY — "When responding to Advanced Mode queries, always output `## IMAGE PROMPT` with a complete, ready-to-use Nano Banana prompt." |

### Deliverables:
1. Ask CD textarea + "Send to CD" button in Zone 3
2. Message tagged with full Advanced Mode context (image, mode, current prompt, staged images)
3. Regex pattern: `## IMAGE PROMPT` → extract text → replace Zone 4 content
4. CD agent instructions: always respond with `## IMAGE PROMPT` for Advanced Mode queries
5. Snackbar confirmation on prompt update

### Test Plan:

Every test must verify the prompt lands in Zone 4. No exceptions.

| Test | User asks | CD should return | Zone 4 result |
|------|-----------|-----------------|---------------|
| Basic edit | "Make this more dramatic" | `## IMAGE PROMPT\nIncrease contrast dramatically...` | Prompt replaced |
| Vague request | "Make this better" | CD interprets + writes specific prompt | Prompt replaced |
| Compose help | "How should I combine these?" | Complete compose prompt with all staged images | Prompt replaced |
| Mode-aware | Same image, Edit vs Compose | Different prompts (edit instruction vs scene description) | Correct per mode |
| With existing prompt | Zone 4 has content, user asks "refine this" | CD rewrites the existing prompt | Prompt replaced (not appended) |
| Empty state | No image selected, user asks something | CD can still respond with a generate prompt | Prompt replaced |

---

## Stage 6B: Nano Banana 2-Turn Self-Description
**Workpackage: WP-6B** | **Dependencies: WP-2** | **Estimate: 1 session**

After generation, Nano Banana describes what it made in a second turn. Independent of Ask CD.

### The Problem:

Currently Nano describes uploaded images, but generated images have no description. The version sidebar and future edits need descriptions for generated images too.

### Solution: 2-Turn Pattern

```
Turn 1: Generate image (existing flow)
Turn 2: Send generated image back to Nano → "Describe what you created" → text description
```

### Files:
| File | Action |
|------|--------|
| `lib/nano-banana.ts` | MODIFY — 2-turn generation + description |
| `lib/gemini.ts` | MODIFY — 2-turn API call |
| `app/api/edit-image/route.ts` | MODIFY — return description with result |
| `lib/session-actions.ts` | MODIFY — store description on SourceImage |

### Deliverables:
1. After generation: automatic Turn 2 asks Nano to describe the result
2. Description stored on the new `SourceImage` entry
3. Description appears in Zone 2 overlay when generated image is selected
4. Description written to IMAGES.md (`**Nano Banana:** [text]`)
5. Description available for chained edits (edit a generated image → description feeds the edit preset)

### Test — Integration:
1. **10 generations, 10 descriptions.** Generate 10 images across all modes (3 generate, 3 edit, 2 compose, 2 layout). Does EVERY single one get a description? Any missing = fail. Log the count.
2. **Description grounding.** For each of the 10 results: CD reads the generated image AND reads the description. Does the description match the actual pixels? If Nano says "falcon on the left" but the falcon is on the right = fail. If description repeats the prompt instead of describing the output = fail.
3. **Filename usage.** For compose/edit results with source images: does the description use real filenames (sultan.jpg, haboob.jpg) or generic labels (image_0, image_1)? Generic labels = fail.
4. **IMAGES.md persistence.** After generation, read IMAGES.md. Is there a `**Nano Banana:** [text]` entry under the generated image? Restart the app. Open Advanced Mode. Select the generated image. Does the description still show in Zone 2? (Tests persistence, not just runtime state.)
5. **Edit chain propagation.** Generate image A. Edit A to produce B. Does B get its OWN description (not A's)? Is B's description about what B looks like, not what A looked like?
6. **Turn 2 reliability.** Run the 2-turn pattern 5 times in a row. Does Turn 2 succeed every time? If Turn 1 returns text inline (sometimes happens), does the system use that instead of making a Turn 2 call? (Optimization: skip Turn 2 if Turn 1 already gave good text.)

---

## Stage 7: Prompt Audit + Regex Integration
**Workpackage: WP-7** | **Dependencies: WP-6A** | **Estimate: 1 session**

Review every prompt path and ensure the regex parser handles all Advanced Mode outputs correctly.

### The Problem:

The app uses regex parsing to route CD responses to different UI elements. Advanced Mode adds new output patterns. Every prompt that flows through the system needs to be verified:

1. **Preset prompts → Nano Banana:** Do the 67 preset prompt templates produce good results? Are there presets that ask Nano to do things it's bad at?
2. **CD → Advanced Mode:** Does the regex parser correctly catch `## PROMPT` and `## FEEDBACK`? Edge cases: what if CD doesn't use the format? What if the response has both?
3. **Nano description → IMAGES.md:** Does the self-description text get written in the right format for the IMAGES.md parser?
4. **Ask CD messages:** Does the context tag (image, mode, prompt) survive the bridge correctly?

### Deliverables:
1. Audit all 67 preset prompts against Nano Banana capabilities — flag/rewrite any that ask for things Nano can't do
2. `## IMAGE PROMPT` regex tested end-to-end: CD responds → parser extracts → Zone 4 updates
3. IMAGES.md write format verified: Nano description → correct IMAGES.md block → parseable on reload
4. Context survival tested: AskCDRequest data makes it through chat bridge intact

### Presets to Review/Rewrite:
- **Infographic** (Layout): asks Nano to generate readable text labels — Nano is bad at text
- **Detail Inset** (Layout): asks for "clean white connecting lines" — precise geometric constraint
- **Mosaic** (Layout): "No strict grid, artistic" — too vague, random results

### E2E Preset Testing — CD-in-the-Loop

CD (me) runs the test. Not a script. Not Nano self-evaluating. I pick the right image for each preset, I review what comes back, I judge whether it worked. Everything gets logged.

**Why CD, not a script:**
- A script can't judge whether "Cinematic Noir" actually looks like noir or just dark
- A script picks the same 3 images for everything — I pick the image that actually tests what the preset claims to do
- A script can't rewrite a broken preset on the spot — I can

**Image Library for Testing:**

Use the FULL session image library — every uploaded image available as a test candidate. CD picks the best match per preset based on what the preset does:

| Image | Best for testing |
|-------|-----------------|
| sultan.jpg | Portrait presets, subject isolation, studio lighting edits |
| cliff-majlis.jpg | Scene transforms, complex compositions, multi-subject edits |
| hero.jpg | Aerial/landscape transforms, dramatic lighting, scale effects |
| hero-night.jpeg | Night-to-day transforms, lighting reversal, atmosphere |
| haboob.jpg | Single large subject, color changes, background swaps |
| shams.jpg | Small subject, soft textures, pet/product-style edits |
| qamar.jpg | Warm tones, compact form, color grade testing |
| shabby-2.jpeg | Dark subject on light bg, contrast presets, eye detail |
| falcon-diving.jpg | Motion, speed, dynamic compositions, action presets |
| luqaimat.jpg | Food/product, detail enhancement, warm lighting edits |
| cliff-steve.jpeg | Portrait in scene, person + animals, golden hour |
| bento.jpeg | Already-composed image, re-layout testing |
| Haus-D-E.jpg | Architecture, blueprint preset, clean lines |
| blueprint.jpg | Technical drawing, style transfer FROM blueprint |
| tenet.jpg | Infographic/dark UI, text-heavy source |
| magazine-cover.jpg | Editorial layout, text + image composition |

**The Process — Per Preset:**

```
1. CD selects the right test image (why THIS image for THIS preset)
2. CD reviews the prompt template before sending (is it well-written? specific enough?)
3. Prompt gets built: preset template + image description
4. Send to Nano Banana via API
5. Result image saved: test-outputs/{mode}/{preset-name}-{image-name}.jpg
6. CD reads the result image (multimodal — actual pixels, not a description)
7. CD evaluates:
   - Did the instruction get followed? (Y/N)
   - Quality of result (1-5)
   - Specific issues (if any)
   - Prompt rewrite needed? (if yes, write the improved version)
8. Everything logged to test-outputs/preset-test-log.md
```

**Log Format — `test-outputs/preset-test-log.md`:**

```markdown
# Preset E2E Test Log — [date]

---

### EDIT / Filters / Vibrant
**Test image:** sultan.jpg (portrait subject with warm browns — good for testing saturation boost)
**Prompt sent:** "Make this image more vibrant and saturated. Increase the intensity of all colors. Brighter, more lively, punchier.\n\nPeregrine falcon perched on carved wooden stand..."
**Result:** test-outputs/edit/vibrant-sultan.jpg
**CD evaluation:** ✓ PASS (5/5). Brown-gold feathers are noticeably richer. Beige backdrop shifted warmer. No artifacts, subject intact. The preset works as intended.

---

### EDIT / Object Edits / Motion Blur
**Test image:** falcon-diving.jpg (action shot — the ONLY right image for testing motion blur)
**Prompt sent:** "Add controlled, dynamic motion blur. The central subject must remain sharp..."
**Result:** test-outputs/edit/motion-blur-falcon-diving.jpg
**CD evaluation:** ✓ PASS (4/5). Falcon sharp, background streaked horizontally. Slight softness on wing tips — acceptable. Good sense of speed.

---

### LAYOUT / Special / Infographic
**Test image:** sultan.jpg + haboob.jpg + shams.jpg + hero.jpg
**Prompt sent:** "Illustrated infographic layout. Arrange sultan.jpg, haboob.jpg, shams.jpg, hero.jpg as visual elements within a dark UI infographic. Teal and gold accents. Add diagrams, labels..."
**Result:** test-outputs/layout/infographic-multi.jpg
**CD evaluation:** ✗ FAIL (1/5). Text labels are garbled. "Diagrams" are abstract shapes with no meaning. Nano cannot generate readable text. REWRITE NEEDED.
**Rewritten preset:** "Dark-themed image arrangement. [images] arranged as visual panels within a structured dark layout (#0e1117 background). Teal (#14b8a6) and gold (#f59e0b) accent borders and dividers between panels. Clean geometric frames around each image. No text, no labels, no diagrams — visual arrangement only."
```

**What Gets Logged Per Test:**
1. Preset name, mode, category
2. Why this test image was chosen
3. Full prompt sent to Nano (verbatim)
4. Result filename (image saved to disk)
5. CD's visual evaluation of the result (reading actual pixels)
6. Score (1-5) and PASS/FAIL/REWRITE
7. If REWRITE: the improved prompt, ready to replace the original

**Summary Section at Top of Log:**

```markdown
## Summary
- Total presets tested: 67
- PASS: XX
- FAIL: XX (presets that need rewriting)
- REWRITE: XX (rewritten and ready to re-test)

## Rewrites Applied
| Preset | Old prompt (first line) | Problem | New prompt (first line) |
|--------|------------------------|---------|------------------------|
| Infographic | "Illustrated infographic layout..." | Nano can't generate text | "Dark-themed image arrangement..." |
| Detail Inset | "Technical detail view..." | Connecting lines imprecise | "..." |
```

**After the test run:**
- Failed presets get rewritten in the log
- Rewrites get applied to `lib/image-presets.ts`
- Rewritten presets get re-tested (second pass, failed only)
- Final report shows the clean state

**Compose and Layout tests** use multiple images — CD picks the right combination:
- Compose: scene image + 1-3 subject images (CD picks based on what the preset does — "Movie Poster" gets a dramatic scene + heroic subjects, "Product Staging" gets an interior + products)
- Layout: 2-4 images (CD picks a mix that tests the grid — portrait + landscape + square to stress different aspect ratios)

### Files:
| File | Action |
|------|--------|
| `test-outputs/preset-test-log.md` | CD writes during testing |
| `test-outputs/edit/*.jpg` | Edit preset results |
| `test-outputs/generate/*.jpg` | Generate preset results |
| `test-outputs/compose/*.jpg` | Compose preset results |
| `test-outputs/layout/*.jpg` | Layout preset results |

**CD → Zone 4 + Snackbar (every Ask CD path):**

| Test | Input | Expected Zone 4 | Expected Snackbar |
|------|-------|-----------------|-------------------|
| Basic ask | "Make this more dramatic" | Complete Nano-ready prompt | CD's reasoning ("I went with noir lighting because...") |
| Refine existing | Zone 4 has content + "make it better" | Rewritten prompt (replaces) | What CD changed and why |
| Compose context | 3 staged images + "how to combine?" | Compose prompt referencing all 3 | CD's composition rationale |
| No image selected | "Generate me a hero shot" | Generate prompt | CD's creative direction notes |
| Long feedback | Complex question about image strategy | Prompt | Multi-line snackbar with "Show more" |

**Regex parser tests (unit tests, no API calls):**

| Input | `## IMAGE PROMPT` extracted | `## FEEDBACK` extracted |
|-------|---------------------------|------------------------|
| Both sections present | ✓ prompt text | ✓ feedback text |
| Extra whitespace / newlines | ✓ trimmed | ✓ trimmed |
| Markdown formatting in prompt | ✓ preserved as-is | ✓ preserved |
| Only `## IMAGE PROMPT` (CD forgot feedback) | ✓ prompt text | Empty — no snackbar |
| Only `## FEEDBACK` (CD forgot prompt) | ✗ ERROR — must flag, CD must always provide a prompt | Show error snackbar |
| Neither section (CD broke format) | ✗ ERROR — entire response shown as error snackbar | "CD response format error" |
| Nested `##` headers inside sections | ✓ correctly scoped | ✓ correctly scoped |

---

## Stage 8A: Hot-Swap Auto-Trigger
**Workpackage: WP-8A** | **Dependencies: WP-2C, existing hot-swap system** | **Estimate: 0.5 session**

Connect Advanced Mode generations to the vibe hot-swap pipeline — automatic path only.

### The Problem:

When a generated image is meant for a vibe slot (hero, portrait, menu-bg), the built HTML page should update automatically. This already exists (`hotSwapAction`) but Advanced Mode isn't connected to it.

### Flow:

```
Generate image in Advanced Mode
  ↓
System checks IMAGES.md for existing slot assignment on this image's filename
  ↓
If match found → trigger hotSwapAction → HTML file updated → snackbar confirms
```

### Deliverables:
1. After generation: check IMAGES.md vibe assignments for matching slot
2. If match found → trigger `hotSwapAction` automatically
3. Snackbar: "🔄 [vibe-name] updated with new [slot]"
4. No UI work — this is pipeline glue

### Test — Integration:
1. Manually assign sultan.jpg to vibe-qahwa hero slot in IMAGES.md. Generate a new image from sultan.jpg. Does hotSwapAction fire? Check the vibe HTML — is the new image in the hero `<img>` tag?
2. Generate an image with no slot assignment → nothing hot-swaps (no errors).

---

## Stage 8B: Vibe Assignment UI
**Workpackage: WP-8B** | **Dependencies: WP-8A, WP-1C** | **Estimate: 1 session**

User-facing UI for assigning generated images to vibe slots.

### The Problem:

Users need to see: (a) what vibe slots exist for this session, (b) what's currently assigned to each slot, (c) how to change assignments. None of this exists in Advanced Mode yet.

### Vibe Slot Discovery:

Session vibes are defined in IMAGES.md. Each vibe has standardized slots:
- `hero` — main hero image (16:9)
- `portrait` — character/person shots (3:4)
- `menu-bg` — menu background (16:9)
- `gallery-1`, `gallery-2`, ... — gallery images
- `icon` — small icons (1:1)

For each vibe in the session, build a slot matrix: `{ vibeName, slots: [{ slotId, currentImage, usage }] }`.

### UI Location:

**Zone 2 — new panel below the version sidebar:** "Assign to Vibe" expandable drawer.

When expanded, shows:
```
[Vibe Dropdown: Qahwa ▼]  [Slot Dropdown: hero ▼]
Current: sultan-v3.jpg
[Assign This Image]
```

- Vibe dropdown lists all session vibes
- Slot dropdown lists that vibe's slots with current filename (if any)
- "Assign This Image" button replaces the slot's current image with the currently-viewed image
- Saves to IMAGES.md, triggers hotSwapAction

### Files:
| File | Action |
|------|--------|
| `components/advanced/CanvasPreview.tsx` | MODIFY — assignment drawer |
| `lib/vibe-slot-actions.ts` | CREATE — read/write slot assignments |
| `lib/types.ts` | MODIFY — VibeSlotMap type |

### Deliverables:
1. `getVibeSlotMap(sessionId)` — reads IMAGES.md, builds vibe → slots map
2. `assignImageToSlot(sessionId, vibe, slot, filename)` — updates IMAGES.md + triggers hotSwapAction
3. Assignment drawer UI in Zone 2 (collapsed by default)
4. Drawer shows: vibe picker, slot picker with current filename, assign button
5. After assign: snackbar confirms, drawer shows updated state
6. Clear Assignment button — unassigns slot (slot goes back to placeholder)

### Test — Integration:
1. **Empty state:** New session with no vibes yet. Open drawer. Shows "No vibes built yet" — correct?
2. **Populated state:** Session with 4 vibes. Open drawer. Does dropdown list all 4? Select Qahwa. Does slot dropdown show Qahwa's slots with current assignments?
3. **Assign:** Select a generated image. Open drawer. Assign to Qahwa hero. Check IMAGES.md — is the assignment there? Check Qahwa's HTML — did hot-swap fire?
4. **Reassign:** Assign image A to Qahwa hero. Assign image B to same slot. Is A now unassigned? Does the HTML show B?
5. **Clear:** Clear Qahwa hero assignment. Does the HTML revert to placeholder? Is IMAGES.md updated?

---

## Error Recovery — Generation Failures & Bad Outputs

Applies to every WP that generates images (WP-2C, WP-3, WP-4, WP-5, WP-6A, WP-6B).

### Failure Modes:

1. **Network failure:** API call fails, timeout, 5xx. System knows it failed.
2. **API error:** 4xx with error body (rate limit, content filter, invalid request).
3. **Bad output:** API returns an image but it's wrong — hallucinated elements, garbled text, wrong subject, safety-filtered blob. System doesn't know it's bad. Only CD/user can tell.

### Recovery Paths:

**For failure modes 1-2 (system knows):**
- Zone 4 shows error banner with message + **Retry** button
- Prompt stays in Zone 4 (not cleared)
- Retry button re-sends the EXACT same request
- 3 consecutive failures → banner changes to "Check network / API status" + link to Anthropic status page

**For failure mode 3 (only human can tell):**

After generation succeeds, three buttons appear above the generated image:

| Button | Action |
|--------|--------|
| ✓ **Approve** | Tags image as approved. Moves on. |
| 🔄 **Retry** | Re-sends EXACT same prompt. Produces a new variation. Original stays in version sidebar. |
| ✏️ **Retry + Tweak** | Prompt stays editable in Zone 4. User modifies. Click Generate → new version. |
| ✕ **Discard** | Removes the generation from version sidebar. **Prompt stays in Zone 4 unchanged.** User can tweak and regenerate. |

### Key Invariant: **Discard does NOT clear the prompt.**

If I Discarded every time and had to retype my prompt, I'd stop using the tool. Discard just removes the bad result, not the user's work.

### Partial Failure — Turn 2 Description Missing:

If the image generates OK but Nano Banana refuses/fails to describe it in Turn 2:
- The image is still saved and shown (don't throw it away over a missing description)
- Zone 2 description shows "Description unavailable" in italic muted text
- A 🔁 icon next to the description triggers a manual Turn 2 retry
- Logged: image has `descriptionStatus: 'failed' | 'retry_pending' | 'complete'`

### Test — Error Recovery:

1. **Network fail + retry:** Disconnect WiFi. Click Generate. See error banner. Reconnect. Click Retry. Does it succeed? Is Zone 4 prompt unchanged?
2. **Discard preserves prompt:** Type "a falcon in flight" in Zone 4. Generate. Click Discard. Is Zone 4 still "a falcon in flight"? Type more. Regenerate. Does it work?
3. **Retry same produces variation:** Generate with "Vibrant" preset. Click Retry. Is the new image different from the first? (Same prompt, different seed, should vary.)
4. **Retry + Tweak:** Generate. Result is close but wrong color. Click Retry + Tweak. Modify prompt to add "blue tones". Generate. Is the new result different AND bluer?
5. **Turn 2 failure:** Force Turn 2 to fail (stub it). Is the image still shown? Does Zone 2 say "Description unavailable"? Can manual retry recover it?
6. **3 consecutive failures:** Disconnect for the full duration. Click Generate 3 times. Does the banner escalate to "Check network"?

---

## Stage 9: Polish (amended 2026-04-17)
**Workpackage: WP-9** | **Dependencies: WP-1 through WP-8** | **Estimate: 0.5 session**

### Deliverables (revised):
1. **Keyboard shortcuts** — Escape closes the assign drawer / picker; Cmd+Enter triggers Generate when focus is inside the prompt editor.
2. **Loading states** — "Generating…" label on the Generate button while in-flight; Zone 2 loading overlay with a spinner.
3. **Preset pill tooltips** — on hover, show the first line of the preset's prompt so Ralph can see what each pill actually does across 64+ presets.

### Already shipped:
- Error handling + Retry button (`handleRetry` wired in PromptEditor; 3-failure escalation present).

### Dropped from the original scope (per Ralph 2026-04-17):
- ~~Minimum viewport 1280px warning~~ — desktop-only internal tool; not worth building.
- ~~Generation counter badge~~ — adds noise, not load-bearing.

### Deferred:
- Drag-drop reorder in staging slots — revisit if reorder becomes a frequent task in practice.

---

## Stage 10: Director Mode Coverage (added 2026-04-17)
**Workpackage: WP-10** | **Dependencies: WP-8B** | **Estimate: 1-2 sessions**

User report (2026-04-17): "Director Mode doesn't work — I cannot edit anything, no images, no text." Root cause is **dual**:

- **(a) Click handler only matches `<img>` tags.** Most vibes render heroes as CSS `background-image`, not `<img>`. In this session 34 of 35 vibes have zero `data-slot` and their hero sections are invisible to the bridge.
- **(b) The text-edit path is provided by the old save-vibes bridge.** That bridge is only baked into one HTML file in the current session (`vibe-5-the-main-event.html`). Every vibe generated by the gemini/sonnet/opus variants has no bridge at all, so there's no text-editing affordance.

### Deliverables:

#### 10A — Background-image click support
1. **Server (`lib/vibe-slots.ts`)** — `extractSlotsWithMetadata` scans inline `style="background-image: url(X)"` AND `<style>` blocks with `background-image: …url(X)`. Each becomes a `bgimg:<src>` pseudo-slot with its own slot name, human label, and nearest-heading context.
2. **Server (`swapSingleFile`)** — new `bgimg:` branch: finds `url("<oldsrc>")` / `url('<oldsrc>')` / `url(<oldsrc>)` in inline styles or `<style>` blocks, replaces one occurrence, preserves quote style.
3. **Client (`lib/studio-bridge.ts`)** — CSS outlines any element with a computed `background-image` in Director Mode; click handler walks up from `e.target` to find the nearest ancestor with a `background-image`; emits `bgimg:<src>`; `UPDATE_SLOT_IMAGE` receiver rewrites the element's inline `backgroundImage` style.
4. **`humanizeSlot`** — label `bgimg:` entries distinctly from bare `img:` (e.g. "Background (hero.jpg)" vs "Image (sultan.jpg)").

#### 10B — Text editing on bare HTMLs
1. **Detection** — in Director Mode, iframe patch walks the DOM and marks text-bearing leaf elements (h1/h2/h3/p/button/span whose children are text-only) with a runtime `data-oskar-editable="text"` attribute.
2. **Click handler** — clicking a tagged text element opens an inline `contentEditable` on that node.
3. **Persist path** — on commit (Enter or blur), post `{ type: 'TEXT_EDITED', xpath, newText }` to parent. Parent hits `/api/director/text-edit` which opens the HTML file, resolves the xpath, replaces the text node, writes back.
4. **Safety** — refuse to edit elements that contain HTML children; only text-only leaves are editable.
5. **Verification** — after commit, re-fetch the HTML and compare to iframe state; surface a warning if they drift.

#### 10C — Director button as iframe overlay
1. Remove the Director Mode toggle from the canvas toolbar.
2. Add a floating button **absolute-positioned in the top-right corner of the iframe wrapper** (lives in parent DOM, not inside the iframe — no chrome injected into saved HTML).
3. On/off states match current emerald styling.
4. Button's pointer events don't interfere with iframe content clicks beneath.

### Test — 10A:
1. Open `vibe-1-grandma-s-cliff-gemini.html` in Studio. Toggle Director Mode. Do all heroes (bg-image sections) and `<img>` portraits have a dashed emerald outline?
2. Click the hero. Does the picker open with the current src + heading context? Pick a replacement. Does the hero update in place AND persist to disk?
3. Click a bare portrait `<img>`. Same picker flow. Does it update?

### Test — 10B:
1. In a bare HTML (no `data-editable`), click the H1. Inline editor opens. Type new text. Press Enter. Does it persist to disk?
2. Refresh the iframe. Is the edit still there?
3. Try to click a nested `<div><span>text</span></div>` — does the bridge refuse (only leaf text nodes are editable)?

### Test — 10C:
1. Does the toggle live in the iframe's top-right? Does it still flip emerald-on when active?
2. Does clicking the toggle NOT propagate to the iframe content beneath?

### Open questions:
- For 10B's xpath resolution: do we trust runtime-generated xpath, or inject a stable `data-oskar-id` attribute at first-load so we can address text nodes by ID across reloads? Either works; ID is safer if the HTML gets re-saved.

---

## Stage 11: Generation Management (added 2026-04-17)
**Workpackage: WP-11** | **Dependencies: WP-8B** | **Estimate: 1 session**

Two operations on Nano Banana-generated images that are currently missing.

### Deliverables:

#### 11A — Delete a generation (hard delete with orphan guard)
1. **Trigger** — ✕ button on the Assets panel tile (hover state) and on version sidebar entries in Advanced Mode.
2. **Orphan scan** before deletion — search for references in:
   - All vibe HTMLs (`<img src>`, `data-slot`, `background-image url()`)
   - `IMAGES.md` entries (Filename + Used in + Reprompt)
   - `CREATIVE-BRIEF.md`, `SESSION.md`, `BUILD.md` (text mentions)
3. **Guard dialog** — if references exist, show:
   ```
   This image is used by:
     • vibe-1-grandma-s-cliff-gemini.html (hero)
     • IMAGES.md (status entry)
   Delete anyway, or cancel and fix references first?
   [Cancel]  [Delete anyway]
   ```
4. **Hard delete** (on confirm) — `rm public/{session}/{filename}`, remove IMAGES.md entry, optionally replace HTML references with `placeholder.jpg` so the vibe doesn't show broken images.
5. **Undo window** — 5-second toast with Undo that restores from a short-lived backup.

#### 11B — Replace all occurrences
1. **Trigger** — "Replace everywhere with…" action on a selected image (Assets panel context menu + inline action).
2. **Picker** — opens the existing image-picker UI showing the session's image library.
3. **Scope** — scans every vibe HTML for references to the source filename and swaps to the target. Covers all three patterns: `data-slot`, bare `<img src>`, `background-image url()`.
4. **Confirmation** — pre-swap summary: "Replace `sultan.jpg` with `sultan-v2.jpg` in 7 places across 4 vibes?"
5. **Logging** — each swap appends to BUILD.md's Hot-Swap Log.

### Test:
1. Delete an image with zero references — file and library entry disappear.
2. Delete an image used by vibe-8 hero. Guard fires with the expected list. Click "Delete anyway" — is the vibe's reference replaced with `placeholder.jpg`?
3. Undo a delete within 5s — is the file restored, library + disk?
4. Replace `cliff-majlis.jpg` with `cliff-majlis-v2.jpg` everywhere — all 4 vibes using it update; BUILD.md gains 7 rows.

---

## Stage 12: Studio Tab Overflow (added 2026-04-17)
**Workpackage: WP-12** | **Dependencies: None** | **Estimate: 0.5 session**

Studio view renders one tab per vibe HTML. In the current session that's 35+ tabs and they wrap / clip. Need overflow navigation.

### Deliverables:
1. **Horizontal scroll** — tab row uses `overflow-x: auto`; trackpad swipe and Shift+wheel both scroll.
2. **Left/right arrow buttons** — absolute-positioned at the tab row's edges; visible only when content overflows; fade based on scroll position; click scrolls by ~80% of visible width.
3. **Smooth scroll** — arrow clicks use `scrollTo({ behavior: 'smooth' })`.
4. **Active tab auto-scroll** — if the current tab is selected and out of view, scroll it into view automatically.

### Test:
1. Open Studio with 35 vibes. Does the tab row show an overflow indicator on the right? Trackpad-scroll right — do more tabs appear?
2. Click the right arrow — smooth scroll.
3. Select a hidden tab programmatically — does it scroll into view?

---

## Stage 13: Image Mode UX Refinements (added 2026-04-17)
**Workpackage: WP-13** | **Dependencies: None** | **Estimate: 0.5 session**

Three small polish items in Image / Advanced Mode.

### Deliverables:

#### 13A — Zone 4 Reset button
1. Add a **Reset** button to the left of Generate (icon or short label; Ralph picked "Reset").
2. Generate button's `flex: 1` fills the remaining width.
3. On click: restore the prompt textarea to the last-loaded value (the 4-tier waterfall output from `resolvePrompt()`); restore the prompt-source indicator to its original label.
4. Disabled if the prompt already matches the loaded state (nothing to reset).

#### 13B — Zone 3 presets inline wrap
1. Current: category labels on their own rows, then pills below, then next category on a new row.
2. New: a single flex-wrap container where labels and pills flow inline. Reads:
   ```
   FILTERS:  [preset1] [preset2]  OBJECT EDITS:  [preset3] [preset4]  ART DIRECTION:  …
   ```
   Wraps as a single stream across visual lines; logically one flow.
3. Category labels keep typographic distinction (bolder/uppercased, dimmer color).

#### 13C — Zone 1 tile fill
1. **Source of truth** — the Assets panel tile behavior as rendered in **BRIEF and STUDIO views**. Pixel-diff the current implementations; replicate whatever BRIEF/STUDIO does inside `AssetGrid.tsx`.
2. Expected gap (unverified until diffed): `object-fit: cover` + `width: 100%` + `height: 100%`; zero padding inside the tile border; consistent aspect ratio.
3. Deliverable includes a short "what was different" note in the commit so the drift is documented.

### Test:
1. Load Image tab with an image selected. Type in the prompt. Click Reset. Does the prompt revert to the loaded value?
2. Open Zone 3 — are categories and pills on the same flowing lines now, not stacked?
3. Side-by-side compare Image tab Zone 1 tile to BRIEF mode tile — identical?

---

## Branding Tab — Workpackages WP-B1 through WP-B5 (folded in 2026-04-17 from docs/BRANDING-PLAN.md)

**Why:** Vibes already carry rich brand data — fonts, colors, mood, audience, voice. The Branding tab turns that data into generated brand deliverables (logo, business card, pitch slide, website hero, social kit) via one shared 4-block prompt pattern (FORMAT / STRUCTURE / BRAND DATA / CONSTRAINTS). One vibe → full brand kit in under 60s of active work.

**Status:** Proposal. Not yet implemented. Full spec remains in `docs/BRANDING-PLAN.md` — this is the workpackage-level summary to keep the master plan complete.

**Dependencies:** Advanced Mode shell (WP-1A), Session state with `VibeData`, Nano Banana generate pipeline (WP-2C).

### WP-B1 — Brand Data Extraction
**Workpackage: WP-B1** | **Dependencies: WP-1A** | **Estimate: 0.5 session**

New `lib/brand-data.ts` exporting:
- `BrandData` interface — businessName, fontHeading, fontBody, audience, mood, colors[], voiceSample, oneLiner
- `brandDataFromVibe(vibe, businessName) → BrandData` — pulls from the existing VibeData React state
- `brandDataFromFile(sessionId, vibeKey) → Promise<BrandData|null>` — server-side fallback that parses VIBE-N.md
- `brandDataBlock(b) → string` — the shared metadata block that every deliverable prompt embeds

### WP-B2 — Deliverable Catalog + Prompt Builders
**Workpackage: WP-B2** | **Dependencies: WP-B1** | **Estimate: 1 session**

New `lib/brand-deliverables.ts` exporting `BRAND_DELIVERABLES: DeliverableTemplate[]` with 7 entries:

| ID | Label | Aspect | Emoji |
|----|-------|--------|-------|
| `logo` | Logo | 1:1 | 🔖 |
| `guideline` | Brand Guideline | 3:4 | 📘 |
| `business-card` | Business Card | 16:9 | 💳 |
| `pitch-slide` | Pitch Slide | 16:9 | 🎯 |
| `website-hero` | Website Hero | 16:9 | 🖥 |
| `social-post` | Social Post | 1:1 | 📷 |
| `social-story` | Social Story | 9:16 | 📱 |

Each template has `build(brand, imageRef?) → string` that assembles the FORMAT + STRUCTURE + `brandDataBlock()` + CONSTRAINTS blocks. Full prompt bodies are spec'd in `docs/BRANDING-PLAN.md` §7.

### WP-B3 — BrandingPanel UI
**Workpackage: WP-B3** | **Dependencies: WP-B2** | **Estimate: 1 session**

Three components in `components/advanced/`:
- `BrandingPanel.tsx` — the tab body (vibe selector → brand-data editor → deliverable picker → generate button → result display)
- `BrandDataEditor.tsx` — inline-editable fields over the current brand data + "reset to vibe defaults"; overrides ephemeral (cleared on vibe change)
- `DeliverablePicker.tsx` — 7-tile grid with hover + selection highlight

### WP-B4 — Generate API + Auto-Catalog
**Workpackage: WP-B4** | **Dependencies: WP-B2, WP-B3** | **Estimate: 1 session**

- `app/api/brand/generate/route.ts` — POST handler taking `{ sessionId, vibeKey, deliverableId, brandOverrides?, imageRef? }`, assembling the prompt, calling Nano with the declared aspect ratio, saving to `public/{sessionId}/brand/brand-{vibeKey}-{deliverableId}-v{n}.jpg`
- Auto-catalog: append entry to IMAGES.md under `## Brand Assets` section (filename, vibe, deliverable, aspect, timestamp)
- Client: Generate button wires through, shows loading state, renders result inline with "Open full size" + "Save to assets"

### WP-B5 — Advanced Mode Integration
**Workpackage: WP-B5** | **Dependencies: WP-B3, WP-B4** | **Estimate: 0.5 session**

- `components/AdvancedMode.tsx` — add `'brand'` to `AdvancedTab` union, render tab button, route to `<BrandingPanel>`
- `lib/types.ts` — export `BrandData`, `DeliverableTemplate`, `DeliverableId`
- Tab bar: `view | generate | edit | compose | layout | brand` (6 tabs)

### Output naming
```
public/{sessionId}/brand/brand-{vibeKey}-{deliverableId}-v{n}.jpg
```

### Success criteria (Phase 1 MVP)
- All 7 deliverables generate for a vibe with complete brand data
- Pixel dimensions match declared aspect ratios
- Brand data visibly reflected in every output (fonts, colors, voice sample)
- Iterations create `-v2`, `-v3` — no overwrites
- Files discoverable in IMAGES.md under `## Brand Assets`
- Tab preserves state across switches

### Phase 2+ (deferred)
- Batch mode ("GENERATE ALL 7" — concurrent Nano calls, streaming UI)
- Extended catalog (letterhead, packaging, merch, signage, email signature, menu)
- Brand Library View (gallery grouped by vibe + deliverable)

See `docs/BRANDING-PLAN.md` for full prompt templates, test plan, and risk analysis.

---

## Stage 14: CD Workflow Wiring (REVISED 2026-04-17)
**Workpackage: WP-14** | **Dependencies: WP-15 (normative contract), WP-6B** | **Estimate: 1 session (after audit)**

User report (2026-04-17, verbatim): "the whole CD interaction doesn't work — CD doesn't get informed of images generated, the whole workflow as described in the document seems not wired. Nothing works or almost nothing works as specified."

This WP owns the **audit + remediation** of the Potemkin gaps. The substantive CD BEHAVIOR is now specified in WP-15 (normative). WP-14 is the mechanical plumbing that makes WP-15 possible.

### Status:

- **14A — Audit:** ✅ COMPLETE. See `WP-14-AUDIT.md` at repo root for the full gap analysis.
- **14B — Open questions resolved:** The audit's "open questions" (CD briefing channel, commentary surface, two-CDs) were answered in the 2026-04-17 conversation that produced WP-15. TL;DR: snackbars in Image Mode, chat in Briefing, one CD context builder shared across both surfaces. Full rules in WP-15.

### Remaining deliverables (post-audit):

#### 14C — Error handling (still applies)
1. Every CD API call has a visible loading state + 30s timeout.
2. On failure: surface the real error to the user, not a silent spinner.
3. Retry button for transient errors.
4. Session log captures CD errors with request context for later debugging.
5. Proofread endpoint (WP-15) has its own 2s ceiling — separate from this 30s outer bound.

#### 14D — Shared context builder (satisfies both WP-14 and WP-15)
1. `lib/cd-context.ts` — `buildCDContext(sessionId)` function.
2. Assembles: `user.md` + relevant CREATIVE-BRIEF.md sections + IMAGES.md recent entries + current vibe + last 20 lines of SESSION.md conversation log.
3. Used by `/api/ask-cd`, `/api/cd-evaluate-prompt`, `/api/cd-evaluate-result`, and (optionally) `/api/chat-stream` on every user turn.
4. Single source of truth — Ask CD and Briefing CD share the SAME context block. Only the model differs (Sonnet for evaluator calls, Opus for Briefing conversation).
5. Auditable — the function is pure; given the same session state it returns the same string.

### Test:
1. Generate an image in Image mode. Within 3s, a verdict snackbar fires. GenerationRecord contains the verdict.
2. Ask CD "what do you think of that last one?" in either Image Mode or Briefing. CD references the recent image by filename. Both surfaces produce substantively consistent answers (shared context).
3. Disconnect network. Click Generate. Proofread call fails → user's prompt is sent as-is after 2s. Verdict call fails → "verdict unavailable" snackbar with retry. No silent spinner.
4. Re-read `WP-14-AUDIT.md` — every listed gap is now closed OR deferred with rationale to WP-15 Phase 2 (autonomous actions).

---

## Stage 15: Image Mode CD Contract (NORMATIVE, added 2026-04-17)
**Workpackage: WP-15** | **Dependencies: WP-1A, WP-6B, supersedes WP-6A CD response spec** | **Estimate: 1 session (evaluator endpoints + snackbar plumbing + proofread hook)**

### Preface — this WP is the rulebook

Ralph locked the CD behavior for Image Mode in conversation on 2026-04-17 after discovering that the documented flow was a Potemkin (agents built individual pieces; no one built the pipe). This WP captures that contract as normative spec. Every other CD-touching WP in Image Mode (WP-6A, WP-2C, WP-3, WP-4, WP-5, WP-14) must comply. Violations are bugs, not taste calls.

This is not a redesign of the architecture — it's the FINAL answer to "how does CD behave in Image Mode," put down so no coding agent has to infer it from spec drift again.

### The 10 rules

1. **Output channel = snackbar.** Every CD output in Image Mode (all sub-tabs: View, Generate, Edit, Compose, Layout) reaches the user as a snackbar. No modal, no inline panel, no badge-only.

2. **Paper-trail by Augenmass.** Conversations and significant decisions (rewrites, ✗ verdicts) land in the chat log for paper-trail. Routine proofread advisories and ✓ verdicts do NOT clutter the chat. The filter is judgment — err toward less.

3. **Proofread every prompt. Blocking.** _(Amended 2026-04-17 — "no caps" pass.)_ Before any prompt reaches Nano Banana, CD reads it. Generate WAITS for CD's reply. **No artificial latency ceiling** — CD on Opus 4.7 + 1M context needs ~10–30s to do real work; capping it at 2s meant CD never actually proofread anything in the first build of WP-15. The user sees a "CD reviewing…" state during the wait. If the bridge errors out (process died, parse failure), severity is `error` and the failure surfaces as a visible snackbar — no silent fallthrough. Caps lead to bugs and silent failures.

4. **Silent rewrite authority.** If CD detects an objective defect, CD rewrites the prompt in place; the rewritten version goes to Nano; a snackbar tells the user what changed and why. No dialog, no accept button. CD has the pen; user has the trigger.

5. **Rewrite rubric.** CD rewrites ONLY for objective/structural defects — contradicts brand brief, references absent assets, internal contradictions, ambiguous multi-subject masking in compose, missing critical negative constraints, typos in technical parameters. CD does NOT rewrite for taste ("warmer," "more dramatic," different framing). Taste = snackbar note. Structure = rewrite.

6. **Post-generation verdict.** On every Nano return, CD reads the image + Nano's Turn-2 self-description. CD may adjust the stored description (written to IMAGES.md). CD issues a verdict — ✓ / ≈ / ✗ — as an extended-toast snackbar (sticks until dismissed).

7. **Uploads trigger evaluation.** Every uploaded image gets the same treatment as a Nano return — CD reads it, writes evaluation to IMAGES.md, fires a snackbar.

8. **User-initiated conversation.** User types in Ask CD (Image Mode) → CD reply lands as a snackbar AND the conversation lands in chat log. User types in Briefing → CD reply lands in chat directly (no snackbar). Both channels share the same CD context.

9. **Prompt edit = overwrite in place.** When CD writes to the prompt field: the field changes. A snackbar announces the change + reason. No diff widget, no accept button.

10. **Scope: all Image sub-tabs.** View, Generate, Edit, Compose, Layout. Same rules in each.

### Signal routing

```
         User uploads image                       User clicks Generate
                │                                          │
                ▼                                          ▼
       image.uploaded event                  prompt → CD proofread (≤2s ceiling)
                │                                          │
                ▼                                ┌─────────┴──────────┐
     CD evaluator (Sonnet, ≤3s)                  │                    │
                │                          defects found?        no defects
                ▼                                │                    │
   verdict + suggestion written          CD rewrites in place    pass-through
   to IMAGES.md; snackbar fired                  │                    │
                                                 └──────────┬─────────┘
                                                            ▼
                                                  prompt → Nano Banana
                                                            │
                                                            ▼
                                             Nano returns (image + Turn-2 desc)
                                                            │
                                                            ▼
                                             CD evaluates result vs prompt
                                                            │
                                                            ▼
                                            verdict (✓ / ≈ / ✗)
                                                            │
                                                            ▼
                                          ext-toast snackbar; if ✗ or rewrite,
                                          also logged to chat (Augenmass)
```

### Endpoints (new)

| Endpoint | Method | Purpose | Model | Latency budget |
|----------|--------|---------|-------|----------------|
| `/api/cd-evaluate-prompt` | POST | Proofread. Returns `{ finalPrompt: string, severity: 'pass' \| 'advisory' \| 'rewritten' \| 'error', note: string }` | **Big CD bridge (Opus 4.7 [1m])** | **No cap — blocks until CD replies** |
| `/api/cd-evaluate-result` | POST | Post-gen verdict. Returns `{ verdict: '✓' \| '≈' \| '✗' \| 'error', note: string, adjustedDescription?: string }` | **Big CD bridge (Opus 4.7 [1m])** | **No cap — blocks until CD replies** |
| `/api/cd-evaluate-upload` | POST | Upload eval. Returns `{ verdict, note, suggestedUses }` | **Big CD bridge** | **No cap** |

Both endpoints receive session context (user.md + brief + IMAGES.md recent + current vibe) via `buildCDContext(sessionId)` — single source of truth.

### Request schemas

**`/api/cd-evaluate-prompt`:**
```json
{
  "sessionId": "2026-01-27-31",
  "mode": "generate" | "edit" | "compose" | "layout",
  "prompt": "string (user's prompt)",
  "image": { "filename": "sultan.jpg", "description": "..." },
  "stagedImages": { "scene": "...", "subjects": ["..."] }
}
```

**`/api/cd-evaluate-result`:**
```json
{
  "sessionId": "2026-01-27-31",
  "filename": "sultan-edit-v3.jpg",
  "nanoDescription": "Turn-2 self-description from Nano",
  "originalPrompt": "what was actually sent to Nano",
  "mode": "edit"
}
```

### Files changed

| File | Change |
|------|--------|
| `app/api/cd-evaluate-prompt/route.ts` | NEW — proofread endpoint |
| `app/api/cd-evaluate-result/route.ts` | NEW — verdict endpoint |
| `lib/cd-context.ts` | NEW — `buildCDContext(sessionId)` — shared context assembler |
| `lib/chat-logger.ts` | NEW — `logToChat(sessionId, { kind, content })` with Augenmass filter |
| `app/api/edit-image/route.ts` | MODIFY — proofread before Nano call; verdict after; both emit snackbar events |
| `app/api/generate-image/route.ts` | MODIFY — same |
| `app/api/compose-image/route.ts` (if exists) | MODIFY — same |
| Upload pipeline (`app/api/upload/route.ts` or handler) | MODIFY — post-upload, call `/api/cd-evaluate-result` |
| `lib/session-events.ts` | EXTEND — new event kinds: `cd.proofread.advisory`, `cd.proofread.rewritten`, `cd.verdict`, `cd.comment` |
| `app/api/ask-cd/route.ts` | MODIFY — use `buildCDContext`; emit snackbar when Image Mode, chat when Briefing |
| `components/advanced/*` | MODIFY — subscribe to new snackbar events; display ext-toast for verdicts |

### Rewrite rubric (enforced in the CD prompt for `/api/cd-evaluate-prompt`)

**Rewrite when ANY of the following are true:**
- Prompt contradicts the CREATIVE-BRIEF.md voice or brand tokens
- References files that don't exist in the session
- Has internal contradictions ("at night with bright sunlight")
- Ambiguous multi-subject masking in compose ("put the falcon and the cat" — which one is primary?)
- Missing critical negative constraints for the mode (e.g., edit without "preserve the subject's identity" risks face drift)
- Technical parameter errors (invalid aspect, impossible lighting physics)

**Do NOT rewrite when:**
- Taste preference — "I'd go warmer," "more dramatic," "rule of thirds"
- User explicitly wants something unusual and the prompt is internally coherent
- The prompt is terse but not defective

Taste commentary → `severity: 'advisory'` with a `note`. Prompt passes through unchanged.

### Paper-trail filter (Augenmass)

Lands in chat log:
- User messages
- CD conversational replies (Ask CD, Briefing)
- Rewrites (`severity: 'rewritten'` with note)
- `✗` verdicts with note

Stays in snackbars only (NOT chat):
- `advisory` proofread notes
- `✓` verdicts
- Mechanical events (save, hot-swap)

### Test plan

1. **Proofread pass-through.** Clean prompt → Generate → Nano fires verbatim. No rewrite. Chat log NOT updated.
2. **Proofread rewrite.** Prompt contradicting brief → CD rewrites → snackbar explains → Nano gets CD's version. Chat log updated.
3. **Proofread timeout.** Stub evaluator to hang 5s. Click Generate. At 2s, Nano fires with user prompt. Snackbar: "Sent as-is — proofread timed out."
4. **Post-gen ✓.** Generate → good result → green verdict snackbar. Chat NOT updated.
5. **Post-gen ✗.** Generate deliberately broken prompt → Nano returns miss → red verdict + note snackbar. Chat updated.
6. **Upload evaluation.** Drop an image → snackbar with CD's take → IMAGES.md updated. Chat NOT updated.
7. **Ask CD in Image Mode.** Type question in Ask CD → snackbar reply. Chat log updated.
8. **Ask CD in Briefing.** Type question in Briefing → chat reply directly. No snackbar.
9. **Sub-tab parity.** Repeat tests 1-7 in View, Edit, Compose, Layout. Identical behavior.
10. **Context consistency.** Same question asked in Image Mode AND Briefing — CD's substantive answer reflects the same session state (both surfaces share `buildCDContext`).

### Success criteria

- Every prompt sent to Nano Banana passes through proofread (or is explicitly marked "sent as-is due to timeout")
- Every Nano return produces a verdict snackbar within 3s
- Every upload produces an evaluation snackbar within 3s
- Chat log growth rate ≤ 1 entry per 5 snackbars (paper-trail is curated, not exhaustive)
- User can trace any CD decision via snackbar history OR the chat paper-trail — no CD action is invisible

### Deferred (Phase 2)
- Autonomous CD actions (CD writes to IMAGES.md / triggers hot-swap without user turn) — requires the event-reactive rebuild the 2026-04-17 audit agent proposed. Not part of WP-15. Revisit after this contract is stable.
- Batch proofread (if user queues 10 generations, proofread them in parallel) — optimization, not required for correctness.

---

## Stage 16: Brand Tab (added 2026-04-17, supersedes WP-B1..B5)

**Supersedes:** WP-B1, WP-B2, WP-B3, WP-B4, WP-B5 (the old BrandingPanel architecture, specced in `docs/BRANDING-PLAN.md` — now marked SUPERSEDED).

**Reason for supersession:** The WP-B1..B5 plan shipped a dedicated BrandingPanel component with its own layout, API route, and state. Ralph's requirement: Brand is a tab inside Image Mode that rides the same Zone 1/2/3/4 layout as every other tab, with its presets + slot staging, zero dedicated API route. The old files exist as orphans; §16.6 plans their deletion.

---

### §16.1 The architecture in one paragraph

Brand is a **stateful tab**. Entering it locks in the active vibe's brand identity (fonts, colors, voice, mood, audience, business name, truth). Every preset bakes those tokens into its prompt verbatim — no placeholder brackets, no user retyping. Most presets also require the user to fill image slot(s) (logo, product shot, hero image). CD assembles the final prompt per click using (a) locked brand tokens, (b) slot images, (c) real copy pulled from `CREATIVE-BRIEF.md` (voice samples, business truth, tagline — menu items and character bios stay a future-WP concern). Nano outputs JPG. For Logo System, Nano renders on a pure-magenta background and a post-processing step (`lib/brand-postproc.ts`, TBD — see §16.4d) chroma-keys magenta → PNG with alpha. That PNG becomes the source image slot for downstream deliverables (Card, Sign, Social, QR).

---

### §16.2 The presets — final list (7)

| # | Preset | Slots | Postproc | Uses from brief |
|---|--------|-------|----------|-----------------|
| 1 | Logo System | — | magenta → alpha PNG | business name, fonts, primary color, truth |
| 2 | Brand Guideline | Logo slot (optional — uses Logo System output if present) | — | business name, fonts, all colors, mood, audience, voice |
| 3 | Business Card | Logo slot (required) | — | business name, tagline, fonts, colors, voice |
| 4 | Storefront Sign | Logo slot (required) | — | business name, mood (picks signage material) |
| 5 | Social Post (1:1) | Hero image slot (required) | — | business name, voice sample, colors |
| 6 | Social Story (9:16) | Hero image slot (required) | — | business name, voice sample, colors |
| 7 | QR Card | Logo slot (required) + URL text input | — | business name, colors, fonts |

**Dropped from earlier draft:** Menu Card (own WP — needs menu-items fetch from brief), Packaging (v2), Staff Uniform (dated), Loyalty Card (dated), Pitch Slide (wrong audience for small biz), Website Hero (designer deliverable), Social Template (renamed to Social Post).

---

### §16.3 What's already shipped (honest audit, with file + line refs)

**§16.3a — Tab shell + routing**
- `components/AdvancedMode.tsx:57` — `AdvancedTab` union includes `'brand'`.
- `components/AdvancedMode.tsx:126` — Brand tab button in tab bar.
- `components/AdvancedMode.tsx:135` — `TAB_COLORS.brand = '#EC4899'`.
- `components/AdvancedMode.tsx:144` — `TAB_HELP` entry for brand.
- `components/AdvancedMode.tsx:327` — `perTabState.brand` initialized.
- Brand rides the Zone 1/2/3/4 layout — BrandingPanel special case removed.
- `components/advanced/PromptEditor.tsx` — `activeTab` union extended; `MODE_COLORS.brand`, `PLACEHOLDERS.brand` added.

**§16.3b — Preset system extension**
- `lib/image-presets.ts:81` — new `BrandPreset` kind: `brandFn(brandData, selectedDescription) => string` + `needsImage?: boolean`.
- `lib/image-presets.ts:92` — `Preset` union includes `BrandPreset`.
- `lib/image-presets.ts` — `BRAND_PRESETS` category currently has 8 wrong entries (Logo System, Business Card, Storefront Sign, Menu Card, Packaging, Staff Uniform, Social Template, Loyalty Card). **→ needs edit per §16.2 final list.**
- `lib/image-presets.ts:772` — `PRESETS_BY_MODE.brand = [BRAND_PRESETS]`.

**§16.3c — Brand data plumbing**
- `lib/brand-data.ts` — `brandDataFromVibe(vibe, businessName)` + `brandDataBlock(b)` + `isBrandDataComplete(b)`. Pure, client-safe.
- `components/AdvancedMode.tsx:363` — `activeBrandData` memo from `vibes[0]` (v1 simplification — vibe picker in §16.4c).
- `components/AdvancedMode.tsx:243` — `buildPromptFromPreset` handles `case 'brand'`.
- `components/AdvancedMode.tsx:544` + `:475` — both preset-click path and image-select rebuild path pass `activeBrandData`.

**§16.3d — Generation pipeline (inherited, not new)**
- Brand generations route through `/api/edit-image` via the Edit path because `tabToOperation('brand')` falls through to `'edit'`.
- WP-15 proofread + verdict fire on brand generations (snackbars work end-to-end — verified today). **BUT** see §16.5a: proofread rewrite not reaching Nano for brand mode.

---

### §16.4 What still needs to ship

**§16.4a — Revise preset list (client only)**
Replace current 8 presets with the 7 from §16.2. Delete: Menu Card, Packaging, Staff Uniform, Loyalty Card, Social Template. Rename/add: Brand Guideline, Social Post, Social Story, QR Card. File: `lib/image-presets.ts`.

**§16.4b — Slot staging for Brand tab (client only)**
Every preset except Logo System needs ≥1 named image slot. Copy Layout-tab slot pattern:
- `BrandStaging` interface: `{ slots: Record<'logo'|'hero', SourceImage | null>, qrUrl?: string }`.
- Add to `TabState.brandStaging`.
- Zone 3 renders named slot cards (Logo / Hero — labeled, not positional).
- Click-to-assign: click a slot, then click an image in Zone 1.
- Preset click greys irrelevant slots for that preset.
- QR Card preset adds a URL text input inline.
- Files: `lib/image-presets.ts` (slot declarations per preset), `components/AdvancedMode.tsx` (state + handlers), `components/advanced/PresetsStaging.tsx` (named-slot render branch for brand).

**§16.4c — Vibe picker in Brand tab header (client only)**
Currently hardcoded to `vibes[0]`. Add a picker: small pill at the Zone 2 tab bar right side, reading `Brand: FalCaMel · Majlis ▾`. Picking updates `activeBrandData` and re-runs the active preset's prompt assembly. Files: `components/AdvancedMode.tsx` + optionally new `BrandHeader.tsx` component.

**§16.4d — Magenta chroma-key postprocessing (server / tooling)**
Logo System only. Pipeline (per Ralph's pseudo-code):

```ts
const jpeg = await nano.generate(prompt) // Nano returns JPG on pure #FF00FF
const mask = chromaKeyMagenta(jpeg)      // threshold magenta → alpha
const png = combine(jpeg, invert(mask))  // PNG with transparency
await saveAsPng(png, `brand-${vibe}-logo-v${n}.png`)
```

**Tool choice — Ralph's call needed:** `sharp` (fast, native, ~3MB footprint, already widely used), `jimp` (pure JS, slower, no native deps), or `imagemagick` subprocess (cleanest but external dep). Recommendation: **sharp**.

Files to create/modify:
- `lib/brand-postproc.ts` — new, exports `chromaKeyMagenta(jpgBuffer): Promise<Buffer>`.
- `app/api/edit-image/route.ts` — when `mode === 'brand'` AND `preset === 'Logo System'`, pipe Nano's JPG through the keyer before saving; output `.png` not `.jpg`.

**§16.4e — Filename prefix fix (tiny — client)**
`components/AdvancedMode.tsx:753` currently falls through to `'layout'` prefix for brand. Extend `buildFilename` to emit `'brand'` prefix when `tab === 'brand'`.

**§16.4f — Generation mode typing (tiny — client)**
`components/AdvancedMode.tsx:826` — `generationMode: activeTab as 'generate' | 'edit' | 'compose' | 'layout'` — cast lies for brand. Extend the union OR introduce a `'brand'` generation mode and map server-side.

**§16.4g — Rewrite every preset prompt per WP-15 principles (CD work)**
No placeholders. Real brief data baked in. Magenta background explicit for Logo System. Slot images referenced by name. Voice samples pulled from brief. Each of the 7 presets gets a fresh prompt. Example for Logo:

> "Render the primary lockup of FalCaMel Café: 'FalCaMel' in Playfair Display, burgundy #7B1E1E wordmark, [optional mark] positioned above/beside the wordmark. Entire image on a pure solid #FF00FF magenta background — no texture, no gradient, no vignette, no shadow. The mark fills ~80% of frame centered with ~10% flat magenta margin on all sides. Crisp vector-style edges. This is a standalone logo asset for chroma-key extraction, not a mockup."

---

### §16.5 What's broken / missing in related WPs

**§16.5a — WP-15 proofread rewrite not reaching Nano (HIGH — flagged today)**
Evidence: in today's Pitch Slide test, the verdict event's "Prompt sent to Nano" was the original placeholder prompt, not my rewrite. `edit-image/route.ts` supposedly applies `actualPrompt = proofread.finalPrompt` per the earlier audit. Either (a) brand-mode route takes a different code path that skips the reassignment, or (b) the verdict event logs the original user prompt instead of the actual sent prompt. **Action:** end-to-end audit with a brand-mode fixture; fix whichever side is wrong.

**§16.5b — WP-15 `GenerationRecord` audit fields still missing (MEDIUM)**
WP-2C revised spec mandates `userPrompt`, `actualPromptSent`, `proofreadResult`, `verdict`. `lib/types.ts:95` still has one `prompt` field. `edit-image/route.ts:264` writes the user's prompt, not the rewrite. Silent rewrites have no audit trail. **Unfixed.**

**§16.5c — Upload CD evaluation dead-wire (MEDIUM)**
`SnackbarProvider` subscribes to `cd.upload-evaluated`, nothing emits it. Uploads don't trigger CD evaluation. **Unfixed.**

**§16.5d — Brand orphan code from my WP-B5 session (MEDIUM — my mess)**
| File | Disposition |
|------|-------------|
| `components/advanced/BrandingPanel.tsx` | **DELETE** — replaced by preset-driven tab |
| `components/advanced/BrandDataEditor.tsx` | **DELETE** — vibe picker (§16.4c) replaces it |
| `components/advanced/DeliverablePicker.tsx` | **DELETE** — preset pills replace it |
| `lib/brand-deliverables.ts` | **DELETE** — prompts now live in `image-presets.ts` BRAND_PRESETS |
| `app/api/brand/generate/route.ts` | **DELETE** — brand generations use `/api/edit-image` |
| `lib/brand-data-server.ts` | **KEEP** — server-side brief parsing, may be reused by §16.4g CD prompt assembly |
| `lib/brand-data.ts` | **KEEP** — actively used (`brandDataFromVibe`, `brandDataBlock`) |
| `lib/types.ts:4` | **EDIT** — remove `export type { DeliverableTemplate, DeliverableId } from './brand-deliverables'` (breaks if brand-deliverables is deleted) |
| `docs/BRANDING-PLAN.md` | **MARK SUPERSEDED** — keep as design history; add header pointing at §16 |

**§16.5e — WP-14 fix plan / WP-15 normative contract (MEDIUM, already specced)**
Implementation gap is §16.5a + §16.5b + §16.5c above.

---

### §16.6 Cleanup plan (Phase 0)

Before any §16.4 feature work:
1. Delete the 5 orphan files listed in §16.5d.
2. Edit `lib/types.ts` to remove the dead re-export.
3. Typecheck clean; confirm dev server hot-reloads the Brand tab without broken imports.
4. Add "SUPERSEDED BY WP-16 / Stage 16 in ADVANCED-MODE-PLAN.md" header to `docs/BRANDING-PLAN.md`.

Separate commit — hygiene, not feature work.

---

### §16.7 Open decisions for Ralph

1. **Post-processing tool** — `sharp` / `jimp` / `imagemagick`? (§16.4d)
2. **QR Card URL input location** — Zone 3 (with slots) or Zone 4 (with prompt)? (Vote: Zone 3.)
3. **Brand Guideline with no logo yet** — refuse to fire until Logo System has run, or render a Guideline with a wordmark-only fallback seal? (Vote: allow; wordmark fallback.)
4. **Vibe picker UX** — dropdown in Zone 2 tab bar area, or a strip in Zone 3? (Vote: pill in tab bar, right of tab buttons.)
5. **Social Post vs. Social Story** — two separate presets, or one preset with aspect toggle? (Vote: two separate — cleaner mental model.)
6. **Fix §16.5a (WP-15 rewrite-wire bug) before or after Brand v1 ships?** (Vote: after. With correct preset prompts from §16.4g, proofread has little to rewrite. Defer to WP-15 follow-up.)

---

### §16.8 Shipping order

| Phase | Work | Est. |
|-------|------|------|
| **Phase 0: Hygiene** | §16.6 cleanup (delete 5 orphans, docs header, typecheck) | 15 min |
| **Phase 1: Preset list revision + prompt rewrites** | §16.4a + §16.4g | 45 min |
| **Phase 2: Slot staging + vibe picker + filename fix + mode typing** | §16.4b + §16.4c + §16.4e + §16.4f | 90 min |
| **Phase 3: Chroma-key postproc** | §16.4d (install sharp, write `lib/brand-postproc.ts`, wire into `edit-image/route.ts` for Logo System) | 60 min |
| Phase 4 (deferred) | §16.5a — WP-15 rewrite-wire audit | separate session |
| Phase 5 (deferred) | §16.5b — GenerationRecord audit fields | separate session |
| Phase 6 (deferred) | §16.5c — Upload CD evaluation | separate session |

Total Phases 0–3: ~3.5 hours.

---

### §16.9 Ownership

The orphan pile in §16.5d is mine. I built BrandingPanel + BrandDataEditor + DeliverablePicker + `/api/brand/generate` + `lib/brand-deliverables.ts` in a single session, shipped as WP-B5, then replaced the architecture today with the preset-tab approach — leaving those files dead. Not walking away from it. Phase 0 deletes them before Phase 1 begins. I live in this house.

---

## Dependency Graph

```
WP-1A (Shell + Tabs + Basic Grid)
  ├── WP-1B (AssetsPanel Hover Redesign)     ← needs WP-1A entry points
  ├── WP-1C (Version Sidebar + Lineage)      ← data model work
  ├── WP-1D (Prompt Pre-Loading Waterfall)   ← can parallel with 1C
  ├── WP-2A (Presets Data Structure)         ← pure data
  │     └── WP-2B (Generate Tab UI)
  │           └── WP-2C (Generation Pipeline) ← needs WP-1C for lineage
  │                 ├── WP-3 (Edit Tab)
  │                 ├── WP-4 (Compose + Staging)
  │                 ├── WP-5 (Layout + Bento Engine)
  │                 ├── WP-6B (2-Turn Description)
  │                 └── WP-8A (Hot-Swap Auto)
  │                       └── WP-8B (Vibe Assignment UI) ← needs WP-1C
  ├── WP-6A (Ask CD + Soft Fallback)         ← can parallel
  │
WP-7 (Preset Audit — CD workpackage) ← needs WP-2C + WP-6B
WP-9 (Polish — lite) ← depends on all above

# Added 2026-04-17
WP-10 (Director Mode Coverage)      ← extends WP-8B (bg-images + text edit + overlay button)
WP-11 (Generation Management)       ← needs WP-8B (delete + replace-all)
WP-12 (Studio Tab Overflow)         ← standalone
WP-13 (Image Mode UX Refinements)   ← standalone
WP-14 (CD Workflow Wiring)          ← mechanical plumbing; behavior now per WP-15
WP-15 (Image Mode CD Contract)      ← NORMATIVE — supersedes WP-6A contract; enforced by
                                      WP-2C, WP-3, WP-4, WP-5, WP-14

# Branding tab (folded 2026-04-17 from docs/BRANDING-PLAN.md)
# WP-B1..B5 SUPERSEDED 2026-04-17 by WP-16 (Brand Tab) — see §16
# ~~WP-B1~~ ~~WP-B2~~ ~~WP-B3~~ ~~WP-B4~~ ~~WP-B5~~ (orphan code pending deletion, §16.5d)
WP-16  (Brand Tab)                  ← needs WP-1A, WP-2A (preset system), WP-15 (CD contract);
                                      supersedes WP-B1..B5
```

**Parallel tracks after WP-1A:**
- Track A: WP-1B (hover redesign), WP-1C (sidebar), WP-1D (pre-loading) — three independent tracks off WP-1A
- Track B: WP-2A → WP-2B → WP-2C → [WP-3, WP-4, WP-5] (preset data → UI → pipeline → tabs)
- Track C: WP-6A (CD integration — independent)
- Track D: WP-6B (self-description — depends on WP-2C)
- Track E: WP-8A → WP-8B (hot-swap glue → assignment UI)

**WP-7 is special:** CD workpackage, not developer code. Runs after WP-2C (presets exist, generation works) + WP-6B (descriptions work). Produces rewritten presets that get committed as code change to `image-presets.ts`.

**Total estimate: 14-17 sessions** (13 WPs, some can parallel)

---

## Workpackage Summary

| WP | Name | Type | Estimate | Dependencies |
|----|------|------|----------|-------------|
| WP-1A | Shell + Tab State Machine + Basic Grid | Dev | 1 session | None |
| WP-1B | AssetsPanel Hover Redesign | Dev | 1 session | WP-1A |
| WP-1C | Version Sidebar + Generation Lineage | Dev | 1 session | WP-1A |
| WP-1D | Prompt Pre-Loading (4-Tier Waterfall) | Dev | 1 session | WP-1A |
| WP-2A | Presets Data Structure | Dev | 1 session | WP-1A |
| WP-2B | Generate Tab UI | Dev | 1 session | WP-2A |
| WP-2C | Generation Pipeline | Dev | 1 session | WP-2B, WP-1C |
| WP-3 | Edit Tab | Dev | 1 session | WP-2C |
| WP-4 | Compose Tab + Staging | Dev | 1-2 sessions | WP-2C |
| WP-5 | Layout Tab + Bento Engine | Dev | 1-2 sessions | WP-2C |
| WP-6A | Ask CD + Soft Fallback | Dev | 1 session | WP-1A |
| WP-6B | Nano Banana 2-Turn Description | Dev | 1 session | WP-2C |
| WP-7 | Preset Audit (CD tests all 67) | CD/QA | 2-3 sessions | WP-2C + WP-6B |
| WP-8A | Hot-Swap Auto-Trigger | Dev | 0.5 session | WP-2C |
| WP-8B | Vibe Assignment UI | Dev | 1 session | WP-8A, WP-1C |
| WP-9 | Polish (lite — amended 2026-04-17) | Dev | 0.5 session | All above |
| WP-10 | Director Mode Coverage (added 2026-04-17) | Dev | 1-2 sessions | WP-8B |
| WP-11 | Generation Management (added 2026-04-17) | Dev | 1 session | WP-8B |
| WP-12 | Studio Tab Overflow (added 2026-04-17) | Dev | 0.5 session | — |
| WP-13 | Image Mode UX Refinements (added 2026-04-17) | Dev | 0.5 session | — |
| WP-14 | CD Workflow Wiring (revised 2026-04-17 — superseded by WP-15 for behavior) | Dev + CD | 1 session remaining | WP-15 |
| **WP-15** | **Image Mode CD Contract (NORMATIVE, added 2026-04-17)** | **Dev** | **1 session** | **WP-1A, WP-6B; supersedes WP-6A contract** |
| ~~WP-B1~~ | ~~Brand Data Extraction~~ | SUPERSEDED by WP-16 | — | — |
| ~~WP-B2~~ | ~~Deliverable Catalog + Prompt Builders~~ | SUPERSEDED by WP-16 | — | — |
| ~~WP-B3~~ | ~~BrandingPanel UI~~ | SUPERSEDED by WP-16 | — | — |
| ~~WP-B4~~ | ~~Brand Generate API + Auto-Catalog~~ | SUPERSEDED by WP-16 | — | — |
| ~~WP-B5~~ | ~~Advanced Mode Integration~~ | SUPERSEDED by WP-16 | — | — |
| **WP-16** | **Brand Tab (added 2026-04-17, supersedes WP-B1..B5)** | **Dev + CD** | **3.5 hours (Phases 0–3)** | **WP-1A, WP-2A, WP-15** |

---

## Files Summary

| File | WP | Action | Lines est. |
|------|-----|--------|------------|
| `components/AdvancedMode.tsx` | WP-1A | CREATE — shell + state | ~300 |
| `components/advanced/AssetGrid.tsx` | WP-1A | CREATE — Zone 1 | ~200 |
| `components/advanced/CanvasPreview.tsx` | WP-1A | CREATE — Zone 2 | ~250 |
| `components/advanced/PresetsStaging.tsx` | WP-2+ | CREATE — Zone 3 | ~350 |
| `components/advanced/PromptEditor.tsx` | WP-2 | CREATE — Zone 4 | ~250 |
| `lib/image-presets.ts` | WP-2 | CREATE — 67 presets, categorized | ~500 |
| `components/AssetsPanel.tsx` | WP-1B | MODIFY — hover redesign | ~200 changed |
| `app/page.tsx` | WP-1A | MODIFY — state | ~30 |
| `app/api/chat-stream/route.ts` | WP-6A | MODIFY — Advanced Mode tag | minor |
| `lib/chat-parser.ts` | WP-6A | MODIFY — new regex patterns | ~50 |
| `agents/creative-director-agent.md` | WP-6A | MODIFY — response format | minor |
| `lib/nano-banana.ts` | WP-6B | MODIFY — 2-turn | ~40 |
| `lib/gemini.ts` | WP-6B | MODIFY — 2-turn | ~30 |
| `app/api/edit-image/route.ts` | WP-6B | MODIFY — return description | ~20 |
| `lib/session-actions.ts` | WP-6B | MODIFY — description field | ~15 |
| `test-outputs/preset-test-log.md` | WP-7 | CD writes during testing | N/A |

## Reference

- HTML mockup: `public/2026-01-27-31/advanced-mode-a.html`
- Current AssetsPanel: `components/AssetsPanel.tsx`
- API endpoint: `app/api/edit-image/route.ts`
- Types: `lib/types.ts` (SourceImage, ImageAsset, ImageManifest)
- Nano Banana: `lib/nano-banana.ts`, `lib/gemini.ts`
- Hot-swap: `lib/session-actions.ts` → `hotSwapAction`
