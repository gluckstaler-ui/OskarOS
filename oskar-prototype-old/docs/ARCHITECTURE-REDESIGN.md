# OskarOS Architecture Redesign: Moodboard-First Workflow

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
