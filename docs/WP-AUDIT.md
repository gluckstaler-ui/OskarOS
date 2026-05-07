# Advanced Mode WP Audit — WP-1 through WP-9

**Date:** 2026-04-17
**Scope:** WP-1A, WP-1B, WP-1C, WP-1D, WP-2A, WP-2B, WP-2C, WP-3, WP-4, WP-5, WP-6A, WP-6B, WP-8A, WP-8B, WP-9.
**Out of scope:** WP-7 (CD-run preset audit), WP-14 (covered separately in `WP-14-AUDIT.md`), WP-10 / WP-11 / WP-12 / WP-13 / WP-B1-5 (not yet implemented).
**Method:** Three parallel agent traces against the plan + my own self-audit on WP-9. No runtime browser tests beyond what the type-checker and a handful of manual API curls covered.

---

## Executive summary

**Three confirmed Potemkin-village implementations** — code that exists, compiles, and looks wired but produces nothing in real use:

1. **WP-5 Layout Bento Engine.** `lib/grid-engine.ts` was never created. `GridConfig` metadata on every layout preset is dead data — `BentoPreview` ignores it entirely and uses a hardcoded slot-count algorithm. Every preset renders the same grid. `cells: []` placeholders for "WP-5 computes" were never filled.
2. **WP-8A Auto Hot-Swap.** End-to-end pipeline is wired (handleGenerate → hotSwapAction → emitHotSwap → snackbar), but the filenames produced by `buildFilename` (`edited-{preset}-{base}`, `gen-{preset}-{base}`) don't match the regex `inferSlotFromFilename` expects (`{prefix}-{slot}-v{n}`). So in practice the trigger almost never fires.
3. **WP-1C / WP-2C Lineage Persistence.** `GenerationRecord` type exists in `lib/types.ts`. Zero code writes it, zero code reads it. Lineage exists only in client memory; refreshing the page wipes the version sidebar's history.

**Several significant gaps that aren't full facades but still violate the spec:**
- **WP-1A** — no Exit button (declared as a prop, never rendered).
- **WP-1B** — three regressions: hover prompt preview skips Tier 1 (manifest), RepromptCard "Advanced" button was deleted not redirected, GenerateTile was deleted with no replacement entry point for Generate mode.
- **WP-2A** — preset counts disagree at three levels (spec: 67, header comment: 69, actual: 72); category taxonomy deviates from spec; Bento 2×2 grid has a cell-collision bug.
- **WP-4 Compose** — subject descriptions are never appended to the prompt (only the scene description is). Spec test #2 fails.
- **WP-6A Ask CD** — snackbar contract was silently downgraded to a one-line truncated strip; Tier-5 "Use as Prompt" modal doesn't exist; CD agent file was not updated with the `## IMAGE PROMPT` instruction.
- **WP-6B** — `lib/session-actions.ts` "store description on SourceImage" modification specified in plan was not done. Description survives via in-memory state + IMAGES.md re-parse, not via the spec'd path.
- **WP-8B** — Clear Assignment button missing; stale empty-state text contradicts the bare-img extension.

**Three real TypeScript errors** (caught by `tsc --noEmit`, ignored by SWC at build time):
- `components/advanced/PresetsStaging.tsx:371` — duplicate `fontWeight`
- `components/advanced/PromptEditor.tsx:387` — duplicate `fontWeight`
- `components/advanced/PromptEditor.tsx:389` — duplicate `border`

**What was shipped clean:** WP-1D (prompt resolver), WP-2B (Generate UI), WP-3 (Edit tab — modulo aspect-ratio preservation), WP-9 (Polish per amended scope).

---

## Per-WP findings

### WP-1A — Shell + Tab State Machine + Basic Grid → **Mostly shipped**

| Spec deliverable | Status | Notes |
|---|---|---|
| 4-zone CSS grid layout | ✅ | `AdvancedMode.tsx:938-1249` |
| Tab bar (View/Generate/Edit/Compose/Layout) | ✅ | `:122-128, :1011-1049` |
| Exit button (top-right of tab bar) | ❌ | `onClose` prop declared at `:111, :264`, never rendered |
| Zone 1 asset grid + selection highlight | ✅ | `AssetGrid.tsx:138-277, :141` (#10B981 border) |
| Zone 2 preview + description overlay + insert-at-cursor | 🟡 | Logic correct (`AdvancedMode.tsx:538-559`); overlay uses 2-line clamp instead of mockup's 3-line (`CanvasPreview.tsx:203`) |
| Cross-tab state preservation | ✅ | `AdvancedMode.tsx:278-291` per-tab state map |

### WP-1B — AssetsPanel Hover Redesign → **Partial — multiple regressions**

| Spec deliverable | Status | Notes |
|---|---|---|
| BentoTile hover overlay matching mockup | ✅ | `AssetsPanel.tsx:225-374` |
| View button → `openAdvancedMode({ tab: 'view' })` | ✅ | `:320-321` |
| Edit button → `{ tab: 'edit', prompt: resolvePrompt() }` | 🟡 | Edit caller doesn't pre-resolve; AdvancedMode resolves downstream — functionally OK but hover preview will mismatch Zone 4 for hero/manifest images |
| Description: 3-line clamp from `analysis` | ✅ | `:282` |
| Prompt preview: from `resolvePrompt()` (WP-1D) | ❌ | `:1419` `getPrompt(img)` SKIPS Tier 1 (manifest). Hero images with CD-written manifest prompts show wrong text or nothing |
| Hero images: green border + HERO badge | ✅ | `:145, :169-188` |
| RepromptCard "Advanced" → opens Edit tab | ❌ | `:859` button removed entirely. Comment says "now accessed via IMAGE tab in TopBar" — but that's a different entry point, not the per-card redirect spec'd |
| GenerateTile click → opens Generate tab | ❌ | Component DELETED (`:381-383`, `:1444`). Top-level "✨ Advanced" button at `:1125-1152` opens `tab: 'view'`, not 'generate'. **No way to enter Generate from the Assets panel** |
| Kill inline textarea / old buttons / fullscreen icon | ✅ | All removed from BentoTile |

### WP-1C — Version Sidebar + Generation Lineage → **Facade-at-the-edges (persistence missing)**

| Spec deliverable | Status | Notes |
|---|---|---|
| `parentImage` field on SourceImage | ✅ | `lib/types.ts:52-55` (also `parentImages`, `generationMode`, `preset`) |
| `GenerationRecord` type written to IMAGES.md | ❌ | Type defined at `lib/types.ts:90-103`; **zero writers, zero readers** in entire repo. Lineage is in-memory only |
| Sidebar walks ancestors + descendants | ✅ | `lib/image-lineage.ts:61-109` (`walkAncestors` with cycle guard, BFS `walkDescendants`) |
| Grouped: Original at top, gens chronologically | ✅ | `:144-154` `buildSidebarList` |
| Click version → Zone 2 swaps | ✅ | `CanvasPreview.tsx:170-175` → `AdvancedMode.tsx:1164` |
| Branching: edit v2 re-edited → two branches | ✅ | `getDirectChildren:78-85` |
| Compose: multi-parent lineage | 🟡 | Data model supports `parentImages[]` but `getParent` (`image-lineage.ts:49-55`) walks only the FIRST parent, so 3-source compose only shows one ancestry line |
| Persistence across reload | ❌ | Lineage data is set in-memory at `AdvancedMode.tsx:671-674`; nothing writes it to disk. App restart loses the entire chain |

### WP-1D — Prompt Pre-Loading (4-Tier Waterfall) → **Shipped**

| Spec deliverable | Status | Notes |
|---|---|---|
| `resolvePrompt(image, manifests)` 4-tier waterfall | ✅ | `lib/image-prompt-resolver.ts:48-87` (manifest → reprompt → sourcePrompt → none) |
| Source indicator label in Zone 4 | 🟡 | Labels defined; passed to PromptEditor at `AdvancedMode.tsx:1246`. UI render of label not verified in this audit |
| Indicator → "Modified" on edit | ✅ | `AdvancedMode.tsx:420-427` |
| Re-resolve on image switch | ✅ | `:408-415` |
| Manifest wins (priority conflict) | ✅ | Tier 1 returns first |
| **Side note** | — | WP-1B's hover preview bypasses this resolver — that gap belongs to WP-1B, not WP-1D |

### WP-2A — Presets Data Structure → **Partial — count + category drift, dead grid metadata**

| Spec deliverable | Status | Notes |
|---|---|---|
| 67 presets ported, typed | 🟡 | **Three numbers disagree:** spec says 67, `lib/image-presets.ts:5` header comment says 69, actual count is 72. Categories deviate too (Generate uses "Functional"/"Creative" not spec's "Website Essentials/Marketing/Creative"; Compose has 1 category not 4; Layout has 1 category not 4) |
| Full type coverage (no `any`) | ✅ | `lib/image-presets.ts:61-91` discriminated union, zero `any` |
| Grid metadata on layout presets | 🟡 | Every preset has `grid: GridConfig`, but Bento 2×2 (`:451-456`) has **cell collision** — slots 3 and 4 both at gridColumn:'2' / gridRow:'2'. Several presets have `cells: []` with "WP-5 computes" comment — never computed (see WP-5) |
| Unit tests | ❌ | None. No `__tests__` for `image-presets` |
| `getPresetsForMode(mode)` helper | ✅ | `:705-707` |

### WP-2B — Generate Tab UI → **Shipped (with type errors)**

| Spec deliverable | Status | Notes |
|---|---|---|
| Zone 3 preset pills by category with inline labels | ✅ | `PresetsStaging.tsx:98-103, :334-347` |
| Click preset → fills Zone 4 prompt | ✅ | `AdvancedMode.tsx:444-457` → `buildPromptFromPreset:194-232` |
| Zone 4 textarea with per-mode placeholders | ✅ | `PromptEditor.tsx:67-73` |
| Zone 4 aspect ratio pills | ✅ | `:56`. Note: Gemini supports more ratios than UI exposes (5 of 10) |
| Zone 4 resolution pills | ✅ | `:57` (1K/2K/4K) |
| Generate button per-mode color | ✅ | `:59-65, :304` via `MODE_COLORS[activeTab]` |
| Tab help text "below tab bar" | 🟡 | Exists but is `position: absolute` overlay inside Zone 2 canvas, not below the tab bar |
| **Type errors** | ❌ | `PresetsStaging.tsx:371` duplicate `fontWeight`; `PromptEditor.tsx:387` duplicate `fontWeight`; `:389` duplicate `border`. Real TS1117 errors masked by SWC build |

### WP-2C — Generation Pipeline → **Partial (persistence facade)**

| Spec deliverable | Status | Notes |
|---|---|---|
| Generate → `/api/edit-image` with full payload | ✅ | `AdvancedMode.tsx:610-644` |
| Loading state in Zone 2 | ✅ | `CanvasPreview.tsx:129-167` spinner overlay |
| Success path: image in Zone 1 + Zone 2 preview | ✅ | `:681, :684` |
| `GenerationRecord` written to IMAGES.md | ❌ | **No writer exists.** `app/api/edit-image/route.ts:153-163` writes free-form markdown (Operation/Prompt/Nano Banana) but lacks the spec'd fields (id, preset, parentImage, resolution, timestamp, mode) |
| Failure: Retry button in Zone 4 | ✅ | `AdvancedMode.tsx:715-729`, `PromptEditor.tsx:248-285` |
| Lineage attached on result | ✅ | `AdvancedMode.tsx:651-675` sets parentImage/parentImages/generationMode/preset — in-memory only |
| Prompt integrity log | ✅ | `:632` console.logs full payload |
| `tabToOperation` wires all 4 modes | ✅ | `:572-577`. Note: layout maps to 'edit' (semantically odd but functional) |

### WP-3 — Edit Tab → **Mostly shipped**

| Spec deliverable | Status | Notes |
|---|---|---|
| Select image → description populates → preset → editFn(description) | ✅ | `AdvancedMode.tsx:398-415` + `:444-457` + `:208-210` |
| Existing prompt pre-loaded (manifest waterfall) | ✅ | `:410-415` calls `resolvePrompt` |
| Before/after via version sidebar | ✅ | `CanvasPreview.tsx:65-70` |
| Green highlight on selected image | ✅ | passed via `selectedImageId` at `:968` |
| Preserve image dimensions on edit | ❌ | Not implemented. Edit tab keeps `aspectRatio: '16:9'` default (`makeInitialTabState:151`); editing a portrait will force 16:9 output. No "match source" code path |

### WP-4 — Compose Tab + Staging Area → **Partial — signature deliverable half-done**

| Spec deliverable | Status | Notes |
|---|---|---|
| Scene + Subject slots + "+" + Reset | ✅ | `PresetsStaging.tsx:214-238`. Scene is purple (mockup-aligned) not green (spec text) |
| Toggle selection (click staged removes; unstaged fills scene-first) | ✅ | `AdvancedMode.tsx:312-354` |
| Asset grid badges Scene/Subj | ✅ | `:512-528` `roleBadgeMap` |
| Live prompt building **including descriptions** | ❌ | **Only scene description is appended** (`AdvancedMode.tsx:216-218, :244`). Subject descriptions never appear in the prompt. Spec example explicitly shows `sultan.jpg (peregrine falcon...) into cliff-majlis.jpg (cliff-top majlis...)` — actual output has no inline descriptions for subjects. Spec test #2 fails |
| Zone 2 shows scene image when filled | ✅ | `:335, :350` |
| Prompt builds without preset | 🟡 | `buildNeutralComposePrompt:237-246` exists but still no per-subject descriptions |

### WP-5 — Layout Tab + Bento Preview Engine → **FACADE**

| Spec deliverable | Status | Notes |
|---|---|---|
| GridConfig type + per-preset metadata | ✅ | `lib/image-presets.ts:43-57, :441-682` (with the Bento 2×2 collision bug) |
| Grid renderer reading `preset.grid` | ❌ | **`BentoPreview` ignores GridConfig entirely.** `CanvasPreview.tsx:473-551` uses hardcoded `getGridLayout(totalSlots)` with 3 cases (≤2, 3, ≥4). `lib/grid-engine.ts` (spec line 590) was never created |
| Staging slot count driven by preset | ❌ | `INITIAL_LAYOUT_SLOTS = 4` hardcoded (`AdvancedMode.tsx:146`). `handlePresetSelect:444-457` never mutates `layoutStaging.slots`. Switching preset doesn't grow/shrink slots |
| Slot count decrease preserves 1..N, drops extras | ❌ | Path doesn't exist (no preset-driven count) |
| Slot count increase: existing preserved, new appended | 🟡 | Manual `+` button works (`handleLayoutAddSlot:484-498`); preset-driven path missing |
| Layout prompt building (filenames + descriptions) | 🟡 | `buildLayoutData:184-188` filenames only — descriptions absent |
| Hero slot visually distinguished | 🟡 | Staging marks slot 0 as Hero. Preview also treats slot 0 as hero — but presets like Mosaic declare hero at `slotIndex: 1`, which the renderer ignores |
| **Net effect** | — | "Bento 2×2", "Triptych", "Side by Side", "Portfolio Grid" all render with the same `getGridLayout(totalSlots)` — i.e., visually identical for any given slot count |

### WP-6A — Ask CD UI + Prompt Routing → **Partial — feedback UX degraded**

| Spec deliverable | Status | Notes |
|---|---|---|
| Ask CD textarea + Send button in Zone 3 | ✅ | `PresetsStaging.tsx:144-168, :178-204` |
| Message tagged with full Advanced Mode context | 🟡 | `AdvancedMode.tsx:742-781` builds `AskCDRequest` correctly. Bigger gap (no sessionId / portrait / brand) covered separately in WP-14-AUDIT |
| 5-tier fallback waterfall in parser | ✅ | `lib/cd-response-parser.ts:75-140` (all 5 tiers present) |
| `## IMAGE PROMPT` → Zone 4 | ✅ | `AdvancedMode.tsx:798-802` |
| `## FEEDBACK` → snackbar(s) per spec (single, "Show more", bullet split) | ❌ | **Implementation uses a one-line truncated strip** at `PresetsStaging.tsx:171-175` (`CD: {text.slice(0,80)…}`). No snackbar fires. No "Show more". No bullet split |
| Tier-5 fallback dialog ("Use as Prompt" / "Dismiss") | ❌ | Implementation just sets feedback text `"CD responded but didn't format a clear prompt. Response: ..."`. No modal, no Use/Dismiss buttons |
| CD agent file updated with `## IMAGE PROMPT` instruction | ❌ | Spec says modify `agents/creative-director-agent.md`. The route bypasses by building its own system prompt inline (`app/api/ask-cd/route.ts:41-51`). Big CD and Little CD will drift |
| Anthropic model = `claude-sonnet-4-6` | ✅ | `app/api/ask-cd/route.ts:15` |
| Fallback-tier frequency logging (>10% threshold) | ❌ | Only per-call console.log, no aggregation |

### WP-6B — Nano Banana 2-Turn Self-Description → **Mostly shipped**

| Spec deliverable | Status | Notes |
|---|---|---|
| Automatic Turn 2 describes the result | ✅ | `lib/gemini.ts:489-547` `describeGeneratedImage`; called from `app/api/edit-image/route.ts:136-150` only when Turn 1 returned no text (matches spec optimization) |
| Description stored on new SourceImage | 🟡 | Set at `AdvancedMode.tsx:663-669` in client state. **Spec also says modify `lib/session-actions.ts`** — that modification doesn't exist. Persistence across reload depends on IMAGES.md re-parse, not the spec'd path |
| Description in Zone 2 overlay | ✅ | Description renders at `CanvasPreview.tsx:179-242` from `selectedImage.analysis.description` |
| Description written to IMAGES.md | ✅ | `app/api/edit-image/route.ts:153-163` writes `**Nano Banana:** {text}` block |
| Available for chained edits | ✅ | `buildPromptFromPreset` Edit branch reads `selectedImage.analysis.description` (`:202, :209`) |

### WP-8A — Hot-Swap Auto-Trigger → **FACADE**

| Spec deliverable | Status | Notes |
|---|---|---|
| Check IMAGES.md for matching slot assignment | ❌ | Implementation infers slot from filename only (`AdvancedMode.tsx:50-63`), ignoring IMAGES.md vibe assignments per spec |
| If match found → `hotSwapAction` automatically | ✅ | Wired correctly at `:687-714` |
| Snackbar `🔄 [vibe-name] updated with new [slot]` | 🟡 | `emitHotSwap` fires; SnackbarProvider has `case 'hot-swap'`. Exact wording not verified |
| No UI work — pipeline glue | ✅ | Silent inside `handleGenerate` |
| **Real-world behavior** | ❌ | **`buildFilename` (`AdvancedMode.tsx:603-608`) produces names like `edited-vibrant-sultan.jpg` and `gen-{preset}-image`.** `inferSlotFromFilename` regex requires `{prefix}-{slot}-v{n}.{ext}` or bare common slot names. **Generated filenames never match.** Pipeline is fully wired and almost never fires for actual generations |

### WP-8B — Vibe Assignment UI → **Mostly shipped (richer than spec, missing Clear)**

| Spec deliverable | Status | Notes |
|---|---|---|
| `getVibeSlotMap(sessionId)` | ✅ | `lib/vibe-slots.ts:565-659`. Returns vibe → pages → slots (richer than spec) |
| `assignImageToSlot` (per-vibe) | ✅ | `hotSwapToVibe:695-737` + `app/api/sessions/[id]/assign-slot/route.ts:11-44`. Writes HTML, logs to BUILD.md |
| Assignment drawer in Zone 2 | 🟡 | Two-step page→slot picker (`AssignToVibeDrawer.tsx`) is BETTER than spec's two-dropdown design, but it's a deviation worth noting |
| Assign button in tab bar | ✅ | `AdvancedMode.tsx:1056-1136` |
| Snackbar after assign | ✅ | `:1172-1183` `emitHotSwap` via `onAssignedToVibe` |
| Clear Assignment button | ❌ | Spec deliverable #6 ("unassigns slot, slot returns to placeholder"). No "Clear" / "Unassign" button anywhere in `AssignToVibeDrawer.tsx` |
| Bare-img fallback (extended 2026-04-17) | ✅ | `lib/vibe-slots.ts:411-437` scans both data-slot and bare `<img>`; `swapBareImage` and `swapBgImage` paths in `hotSwapToVibe` |
| **Stale doc comment** | ❌ | `app/api/sessions/[id]/vibe-slots/route.ts:7` says "scanning `data-slot=` attributes" — out of date since bare-img extension |
| **Stale empty-state copy** | ❌ | `AssignToVibeDrawer.tsx:247` says "Pages need `data-slot` attributes to appear here." Contradicts the bare-img extension that makes any `<img>` page appear |

### WP-9 — Polish (amended scope) → **Shipped**

| Spec deliverable (kept items) | Status | Notes |
|---|---|---|
| Esc + Cmd+Enter shortcuts | ✅ | `PromptEditor.tsx:218-228` (Esc blurs, Cmd/Ctrl+Enter triggers Generate) |
| "Generating…" + Zone 2 spinner overlay | ✅ | `CanvasPreview.tsx:128-165` |
| Error + Retry button | ✅ | `AdvancedMode.tsx:716-722, :733`; PromptEditor surfaces it; 3-failure escalation present |
| Preset pill tooltips | ✅ | `PresetsStaging.tsx:354-364` (first line of prompt as `title`) |
| Min viewport 1280px | — | Dropped per Ralph 2026-04-17 |
| Generation counter | — | Dropped per Ralph 2026-04-17 |
| Drag-drop reorder | — | Deferred per Ralph 2026-04-17 |

---

## TypeScript hygiene

`tsc --noEmit` flags 37 errors total in the repo. Three of them are **inside the Advanced Mode component code** and are real (object literal duplicate keys):

```
components/advanced/PresetsStaging.tsx:371   error TS1117: duplicate fontWeight
components/advanced/PromptEditor.tsx:387     error TS1117: duplicate fontWeight
components/advanced/PromptEditor.tsx:389     error TS1117: duplicate border
```

The rest are in unrelated files (memory tests, regex flags in chat-stream, etc.) and are pre-existing.

---

## Implementation priorities (proposed)

Ordered by user impact + spec gravity. **All items below WP-7 are in scope per Ralph's "implement everything" directive.**

### P1 — Functional bugs that block features
| Item | WP | Effort |
|---|---|---|
| Fix `buildFilename` to produce slot-matching names (or rewrite `inferSlotFromFilename` to accept actual gen filenames) | WP-8A | 0.5h |
| Persist `GenerationRecord` to IMAGES.md so lineage survives reload | WP-1C / WP-2C | 1.5h |
| Build the actual grid renderer that reads `preset.grid` | WP-5 | 2-3h |
| Wire preset-driven slot count in Layout staging | WP-5 | 0.5h |
| Subject descriptions in Compose prompt | WP-4 | 0.5h |
| Fix Bento 2×2 cell collision in `image-presets.ts` | WP-2A | 5min |

### P2 — Spec deliverables explicitly missed
| Item | WP | Effort |
|---|---|---|
| Add Exit button to tab bar | WP-1A | 15min |
| Restore Generate entry point from Assets panel | WP-1B | 30min |
| Restore RepromptCard "Advanced" redirect | WP-1B | 15min |
| Fix prompt preview to use `resolvePrompt` (Tier 1) | WP-1B | 15min |
| Update `agents/creative-director-agent.md` with `## IMAGE PROMPT` contract | WP-6A | 10min |
| Implement snackbar feedback per spec | WP-6A | 30min |
| Implement Tier-5 "Use as Prompt" modal | WP-6A | 45min |
| Add Clear Assignment button + fix stale empty-state text | WP-8B | 30min |

### P3 — Hygiene
| Item | WP | Effort |
|---|---|---|
| Fix 3 TypeScript duplicate-key errors | WP-2B | 5min |
| 3-line clamp on Zone 2 description (was 2) | WP-1A | 5min |
| Match source aspect ratio on Edit | WP-3 | 15min |
| Reconcile preset count (spec 67 vs header 69 vs actual 72) | WP-2A | TBD with CD |

### Out of scope per Ralph's directive
- **WP-7** — CD's preset audit, runs from CD agent, not implementation work.

### Total
- P1: ~5 hours
- P2: ~3 hours
- P3: ~30 minutes
- **All in: ~8.5 hours of focused dev**

---

## Files to touch (consolidated)

| File | Affected WPs |
|---|---|
| `components/AdvancedMode.tsx` | WP-1A (Exit button), WP-4 (subject desc in compose prompt), WP-5 (preset-driven slot count), WP-8A (fix buildFilename) |
| `components/advanced/CanvasPreview.tsx` | WP-1A (3-line clamp), WP-5 (grid renderer rewrite) |
| `components/advanced/PromptEditor.tsx` | WP-2B (TS errors) |
| `components/advanced/PresetsStaging.tsx` | WP-2B (TS errors) |
| `components/AssetsPanel.tsx` | WP-1B (3 fixes: prompt preview, RepromptCard redirect, GenerateTile entry) |
| `components/advanced/AssignToVibeDrawer.tsx` | WP-8B (Clear button, empty-state text) |
| `lib/image-presets.ts` | WP-2A (Bento 2×2 fix, header comment, optional category reorg) |
| `lib/grid-engine.ts` | WP-5 (CREATE — the missing engine) |
| `lib/session-actions.ts` | WP-1C/2C (GenerationRecord persistence), WP-6B (description persistence) |
| `app/api/edit-image/route.ts` | WP-1C/2C (GenerationRecord append + parse) |
| `app/api/sessions/[id]/vibe-slots/route.ts` | WP-8B (stale doc comment) |
| `agents/creative-director-agent.md` | WP-6A (`## IMAGE PROMPT` contract) |

---

**End of audit.**
