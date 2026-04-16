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

Replace the current overloaded hover overlay with View/Edit entry points.

### Files:
| File | Action |
|------|--------|
| `components/AssetsPanel.tsx` | MODIFY — hover overlay rewrite |

### Deliverables:
1. Kill inline prompt textarea from BentoTile hover
2. Kill "Advanced" and "Generate" buttons
3. New hover content: Filename + Delete + Nano description (3-line clamp) + prompt preview (single line) + View button + Edit button
4. View button → opens Advanced Mode on View tab with this image
5. Edit button → opens Advanced Mode on Edit tab with this image + existing prompt loaded
6. Hero images: green border always visible + HERO badge

### Test — Integration:
1. **Every image type:** Hover over 5 different images (hero, generated, uploaded, composed, extracted). Does each show correct description? Correct prompt preview (or "No edit prompt")?
2. **Entry point correctness:** Click View on sultan.jpg → Advanced Mode opens on View tab with sultan.jpg selected. Click Edit on the same image → Edit tab with prompt loaded. Are these DIFFERENT experiences?
3. **Hero treatment:** Find a hero-tagged image. Does it have green border WITHOUT hovering? Does the HERO badge show? Click Edit → is CD's existing prompt pre-loaded?
4. **Delete still works:** Hover → click Delete → image removed from panel AND from disk. Check session folder.
5. **No regressions:** Upload a new image. Does it appear in Uploads section? Submit images. Do they move to Library? All existing flows still work?

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

## Stage 2C: Generation Pipeline
**Workpackage: WP-2C** | **Dependencies: WP-2B, WP-1C** | **Estimate: 1 session**

The actual API call, result handling, and GenerationRecord persistence.

### Files:
| File | Action |
|------|--------|
| `components/AdvancedMode.tsx` | MODIFY — generate handler |
| `lib/session-actions.ts` | MODIFY — persist GenerationRecord |

### Data Flow — Generation Results:

When Generate returns an image:
1. Image file saved to session folder by the API
2. New `SourceImage` entry created with `parentImage` set → appears in Zone 1 asset grid
3. `GenerationRecord` written to IMAGES.md under the generated image's sub-entry
4. Version sidebar updates (WP-1C already built this — now it receives new data)

```typescript
interface GenerationRecord {
  id: string
  parentImage?: string       // filename of source image (for edit/compose chains)
  sourceImages: string[]     // all input images
  preset: string             // preset label used
  prompt: string             // full prompt sent to Nano
  resultImage: string        // filename of generated result
  aspectRatio: string
  timestamp: number
  mode: 'generate' | 'edit' | 'compose' | 'layout'
}
```

### Deliverables:
1. Generate button → `/api/edit-image` with full payload (prompt, operation, sourceImages, aspectRatio, imageSize, sessionId)
2. Loading state in Zone 2 during generation
3. Success: new image in Zone 1, preview in Zone 2, GenerationRecord written
4. Failure: error in Zone 4 with Retry button (see Error Recovery section below)
5. Prompt integrity check: log the EXACT prompt sent (for WP-7 audit)

### Test — Integration:
1. **Generate 5 images with 5 different presets** (Hero Banner, Product Shot, Epic Landscape, Isometric 3D, Abstract Concept). CD evaluates ALL 5 results: did the preset instruction produce what it described? Score 1-5 each. Log results.
2. **Prompt integrity:** Before clicking Generate, copy the prompt from Zone 4. After generation, check server logs — is the prompt that reached Nano Banana EXACTLY what was in Zone 4? Any mutation = bug.
3. **Aspect ratio obedience:** Generate with 16:9, then 1:1, then 9:16. Are the output images actually those ratios? Measure pixel dimensions.
4. **Resolution obedience:** Generate same prompt at 1K, 2K. Is 2K visibly higher resolution?
5. **Asset grid sync:** After generation, does the new image appear in Zone 1 immediately? Can you click it? Does its description show in Zone 2?
6. **GenerationRecord persistence:** After generation, read IMAGES.md. Is the full record there (preset, prompt, parentImage, timestamp, mode)? Restart app. Still there?
7. **Version chain integration:** Generate from "Hero Banner". Edit the result with "Vibrant". Edit THAT result with "Night Scene". Does WP-1C sidebar show the 3-step chain?

---

## Stage 3: Edit Tab
**Workpackage: WP-3** | **Dependencies: WP-2** | **Estimate: 1 session**

Single-image editing with description-aware presets.

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
**Workpackage: WP-4** | **Dependencies: WP-2** | **Estimate: 1-2 sessions**

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
**Workpackage: WP-5** | **Dependencies: WP-2C** | **Estimate: 1-2 sessions**

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

## Stage 6A: Ask CD — UI + Prompt Routing
**Workpackage: WP-6A** | **Dependencies: WP-1** | **Estimate: 1 session**

Wire the "Ask CD" textarea to the existing chat bridge. CD's response always updates the prompt.

### The Contract:

You ask CD → CD writes you a prompt. That's it. No "feedback only" path. No "sometimes a suggestion, sometimes just a comment." The whole point of Ask CD in Advanced Mode is to get a better prompt than you'd write yourself.

### CD Output Format:

CD responds with two structured blocks. Both are mandatory in every response.

```
## IMAGE PROMPT
[the complete prompt — ready to send to Nano Banana as-is]

## FEEDBACK
[CD's reasoning, opinions, suggestions — why this prompt, what to try next, what CD noticed about the image]
```

**Both sections are always present. Both get routed:**
- `## IMAGE PROMPT` → Zone 4 textarea (replaces content)
- `## FEEDBACK` → snackbar notification(s)

The user sees the prompt update in Zone 4 AND gets CD's thinking as a snackbar. No information lost. No hidden chat panel to check later.

**Snackbar behavior:**
- Short feedback (< 100 chars): single snackbar, auto-dismiss after 5s
- Long feedback: snackbar with "Show more" expand, persists until dismissed
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

## Stage 9: Polish
**Workpackage: WP-9** | **Dependencies: WP-1 through WP-8** | **Estimate: 1 session**

### Deliverables:
1. Keyboard shortcuts: Escape=close, Cmd+Enter=generate
2. Loading states: "Generating..." on button, Zone 2 loading overlay with spinner
3. Error handling: API failures show error message + retry button in Zone 4
4. Minimum viewport: 1280px (below that: warning or simplified layout)
5. Generation counter badge on tab bar or Zone 1 header
6. Drag-drop reorder in staging slots
7. Tooltips on preset pills (show first line of prompt on hover)

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
WP-9 (Polish) ← depends on all above
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
| WP-9 | Polish | Dev | 1 session | All above |

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
