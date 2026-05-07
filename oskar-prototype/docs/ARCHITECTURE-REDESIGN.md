# OskarOS Architecture Redesign: Moodboard-First Workflow

> Status block added: 2026-05-01

---

## STATUS UPDATE — 2026-05-01

Plan body below is preserved for context. The moodboard-first workflow shipped, but the layout and phase state machines expanded beyond what this plan described — `LayoutMode` is now a 4+ mode union (not 2) and `WorkflowPhase` has 5 phases (not 4). Image approval flow shifted from sequential single-vibe to parallel build with hot-swap.

### STATUS — Moodboard-First Workflow - SHIPPED (with expansion)

**SHIPPED:** All five problems identified in §"Key Problems" addressed. `app/api/moodboard/route.ts` exists; `MoodboardConcept` + `MoodboardData` + `QuadrantPosition` types in `lib/types.ts`; 4-quadrant moodboard generation operational; `workflowPhase` + `layoutMode` state machines wired in `app/page.tsx`; `ImageManifest` + `ImageQueueItem` types shipped.

**CHANGED — `LayoutMode` union expanded:**
- Plan was `'2-panel' | '3-panel'` (2 modes).
- Current is `'2-panel' | '3-panel' | 'image' | 'gallery'` (4+ modes). The new modes ship full-bleed Image Mode and Gallery Mode for asset-management workflows. **Do not revert** — additional modes are intentional.

**CHANGED — `WorkflowPhase` expanded:**
- Plan was `'discovery' | 'moodboard' | 'generation' | 'preview'` (4 phases).
- Current is `'discovery' | 'moodboard' | 'selection' | 'generation' | 'preview'` (5 phases). The `'selection'` phase formalizes the moodboard→commit transition that was implicit in the plan's state machine.

**CHANGED — Generation flow shifted from sequential to parallel:**
- Plan said: "CD generates HTML pages, image generation runs in parallel, user approves each image generation."
- Current: vibes build in parallel from the brief; images generate against per-vibe slots; the **hot-swap** pattern (`hotSwapAction` in `lib/session-actions.ts` + `mcp__oskar-orchestrator__hotswap` MCP tool) replaces the per-image approval gate. User approves at vibe-level via Director Mode + Sentinel Ti audits, not per-image during generation.

**CHANGED — Components diverged:**
- Plan's `MoodboardSelector.tsx` — moodboard rendering landed in `components/ConversationPanel.tsx` and `components/CanvasPanel.tsx`, not a dedicated `MoodboardSelector`.
- Plan's "memory injection: edits sent to AI in subsequent messages" — replaced by `director_save` event-bus event + `apply_patch` MCP tool (typed contract, not chat-text relay).

### STATUS — API Changes

**SHIPPED:** `/api/moodboard` route operational.

**CHANGED — `/api/chat` moodboard parsing:** the plan's `\`\`\`moodboard-concepts` markdown-fence parser is RETIRED. CD emits structured `submit_image_prompt` / typed MCP tool calls; `lib/mcp-tool-collector.ts` captures them. The fence-block parser doesn't exist.

**CHANGED — `/api/edit-image`:** approval flow + quality checking landed but evolved — quality scoring now goes through Sentinel Ti's `submit_critique` MCP tool, not inline in `/api/edit-image`.

### STATUS — Component Changes (per plan §"Component Changes")

| Plan said | Status |
|-----------|--------|
| `app/page.tsx` add `layoutMode` + `workflowPhase` | SHIPPED (with expanded unions, see above) |
| `components/MoodboardSelector.tsx` (new) | NOT BUILT — moodboard UI lives in ConversationPanel + CanvasPanel |
| `components/AssetsPanel.tsx` fix duplicate keys, add queue | SHIPPED |
| `components/ConversationPanel.tsx` moodboard inline | SHIPPED |
| `lib/cd-agent-prompt.ts` moodboard phase + manifest format | SHIPPED |

### STATUS — DO NOT IMPLEMENT

- **Revert `LayoutMode` to `'2-panel' | '3-panel'`** — `'image'` and `'gallery'` modes are intentional production features.
- **Revert `WorkflowPhase` to 4 phases** — the explicit `'selection'` phase prevents an implicit-state class of bugs.
- **Re-add per-image sequential approval gate** — replaced by hot-swap + Director Mode + Sentinel Ti audits.
- **Build `components/MoodboardSelector.tsx`** as a separate component — moodboard UI is integrated into existing panels.
- **Re-add `\`\`\`moodboard-concepts` markdown-fence parser** to `/api/chat` — typed MCP tool calls are the contract.

### STATUS — What IS the source of truth for layout + workflow today

Read these (not this plan):
- `app/page.tsx` — current state machine, `LayoutMode` and `WorkflowPhase` consumers
- `lib/types.ts` — `LayoutMode`, `WorkflowPhase`, `MoodboardData`, `MoodboardConcept`, `QuadrantPosition`, `ImageQueueItem`
- `app/api/moodboard/route.ts` — current moodboard API
- `components/ConversationPanel.tsx` + `components/CanvasPanel.tsx` — where moodboard renders
- `components/AssetsPanel.tsx` — image queue + approval UI
- `lib/session-actions.ts` `hotSwapAction()` — production image-update path
- `mcp-server/tools-orchestrator.ts` `hotswap` tool — typed hot-swap contract

---

## Overview

This document outlines the redesigned architecture based on user feedback from the initial prototype testing.

## Key Problems Identified

1. **Images generated AFTER vibes** → HTML references broken images
2. **Parallel vibe generation** → Errors and inconsistency
3. **Wrong initial layout** → Should be 2-panel, not 3-panel
4. **Generic booking sections** → "Harmful" not just generic
5. **Duplicate key errors** → Frontend bugs in AssetsPanel

## New Workflow

### Phase 1: Discovery (2-Panel Layout)
```
┌─────────────────────────┬─────────────────────────────────┐
│                         │                                 │
│   Assets Panel (40%)    │      Chat Panel (60%)           │
│                         │                                 │
│   - Source uploads      │   - CD discovery questions      │
│   - Analysis results    │   - User answers                │
│                         │                                 │
└─────────────────────────┴─────────────────────────────────┘
```

### Phase 2: Moodboard Generation
CD generates ONE 1000x1000px moodboard image with four 250x250px quadrants:

```
┌─────────────────┬─────────────────┐
│                 │                 │
│   Vibe 1        │   Vibe 2        │
│   (250x250)     │   (250x250)     │
│                 │                 │
├─────────────────┼─────────────────┤
│                 │                 │
│   Vibe 3        │   Vibe 4        │
│   (250x250)     │   (250x250)     │
│                 │                 │
└─────────────────┴─────────────────┘
```

User selects ONE vibe direction to proceed with.

### Phase 3: Sequential Generation (3-Panel Layout)
```
┌──────────────┬──────────────────────────┬─────────────────┐
│              │                          │                 │
│   Assets     │      Canvas Panel        │   Chat Panel    │
│   (25%)      │        (50%)             │    (25%)        │
│              │                          │                 │
│   - Source   │   - Vibe preview         │   - CD dialogue │
│   - Generated│   - Full-screen HTML     │   - Actions     │
│              │                          │                 │
└──────────────┴──────────────────────────┴─────────────────┘
```

**Parallel Execution:**
- CD starts generating HTML pages
- Image generation runs in parallel
- User approves each image generation

**CD Agent Responsibilities:**
1. Check if image generation successful before presenting vibe
2. Remind user if no response to image approval
3. Check quality of generated images, regenerate if needed
4. Be aware of user regenerations

## New Data Flow

```
1. User uploads source images
   ↓
2. Gemini analyzes images (elements, subjects, quality)
   ↓
3. CD discovery conversation (2-panel)
   ↓
4. CD generates moodboard (1000x1000, 4 quadrants)
   ↓
5. User selects one vibe direction
   ↓
6. PARALLEL:
   ├── CD generates HTML (with placeholder references)
   └── Image generation queue (user approves each)
   ↓
7. CD waits for images OR proceeds with placeholders
   ↓
8. Final HTML with actual image paths (3-panel preview)
   ↓
9. User feedback → iteration
```

## API Changes

### New: `/api/moodboard`
Generate 4-quadrant moodboard image.

```typescript
POST /api/moodboard
{
  vibeDescriptions: [
    { name: string, visualStyle: string, colorPalette: string[] },
    { name: string, visualStyle: string, colorPalette: string[] },
    { name: string, visualStyle: string, colorPalette: string[] },
    { name: string, visualStyle: string, colorPalette: string[] }
  ],
  sourceImages: string[] // paths to source images for style reference
}

Response:
{
  moodboardPath: string,  // /generated-images/moodboard-{timestamp}.jpg
  quadrants: [
    { vibeName: string, position: 'top-left' },
    { vibeName: string, position: 'top-right' },
    { vibeName: string, position: 'bottom-left' },
    { vibeName: string, position: 'bottom-right' }
  ]
}
```

### Updated: `/api/chat`
New output format for moodboard concepts:

```markdown
```moodboard-concepts
{
  "vibes": [
    {
      "name": "The Sanctuary",
      "visualStyle": "minimal Swiss precision meets warmth",
      "colorPalette": ["#1a1915", "#f5f2eb", "#c9a227"],
      "headline": "Forty-five minutes of nothing urgent",
      "oneWord": "Respite"
    },
    // ... 3 more vibes
  ]
}
```
```

### Updated: `/api/edit-image`
Add approval flow and quality checking.

## Component Changes

### `app/page.tsx`
- Add `layoutMode: '2-panel' | '3-panel'` state
- Add `workflowPhase: 'discovery' | 'moodboard' | 'generation' | 'preview'` state
- Transition to 3-panel when first vibe ready

### `components/MoodboardSelector.tsx` (New)
- Display 4-quadrant moodboard
- Clickable quadrants for selection
- Hover states showing vibe names

### `components/AssetsPanel.tsx`
- Fix duplicate key error
- Add image generation queue with approval buttons
- Show generation status per image

### `components/ConversationPanel.tsx`
- Handle moodboard display inline
- Add approval prompts for images
- Show generation progress

### `lib/cd-agent-prompt.ts`
- Add moodboard generation phase
- Update image manifest format
- Add quality checking instructions

## State Machine

```
DISCOVERY ──────────────┐
    │                   │
    ▼                   │
MOODBOARD_GENERATION    │ (user can go back)
    │                   │
    ▼                   │
MOODBOARD_SELECTION ◄───┘
    │
    ▼
VIBE_GENERATION (parallel images)
    │
    ▼
PREVIEW ◄───────────────┐
    │                   │
    ▼                   │ (regeneration loop)
ITERATION ──────────────┘
```

## Files to Modify

1. **`app/page.tsx`** - Layout state machine
2. **`lib/cd-agent-prompt.ts`** - Moodboard-first flow
3. **`app/api/chat/route.ts`** - Parse moodboard concepts
4. **`app/api/moodboard/route.ts`** - NEW: Generate 4-quadrant image
5. **`components/AssetsPanel.tsx`** - Fix duplicate keys, add queue
6. **`components/ConversationPanel.tsx`** - Moodboard inline display
7. **`components/MoodboardSelector.tsx`** - NEW: Selection UI
8. **`lib/types.ts`** - New types for moodboard, workflow phases
