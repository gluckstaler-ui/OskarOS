# AUDIT.md — Complete Codebase Audit

**Date:** 2026-01-26
**Auditor:** Claude (Opus 4.5)
**Codebase:** oskar-prototype
**Spec:** ARCHITECTURE.md (OskarOS Refactor Specification)

---

## SECTION 1: FILESYSTEM STRUCTURE

### Spec Says:
```
/output/{session-id}/
├── SESSION.md
├── IMAGES.md
├── BUILD.md
├── CREATIVE-BRIEF.md
├── [images]
├── [vibe HTML files]
```
Everything flat. No subfolders. Ever.

### Reality:

**Session folder structure EXISTS but is NEVER CREATED during normal user flow.**

| Write Location | What Gets Written | Code Location | When Called |
|---------------|-------------------|---------------|-------------|
| `/public/uploads/` | User-uploaded images | `app/api/upload/route.ts:32` | Always (user uploads) |
| `/public/generated-images/` | Gemini-generated images | `app/api/edit-image/route.ts:78` | Always (image generation) |
| `/public/vibes/` | Vibe HTML files | `app/api/save-vibes/route.ts:85` | Always (vibe generation) |
| `/public/generated-vibes/` | Alt vibe HTML files | `app/api/save-vibe/route.ts:18` | Sometimes |
| `/public/{sessionId}/` | Session folder with 4 MDs | `lib/session.ts:232-244` | **NEVER in production** |

**Evidence:**

1. `createSession()` is defined at `lib/session.ts:227` — creates the proper folder structure
2. `createSession()` is **NEVER CALLED** from any UI or API route
3. Grep for `createSession` finds calls ONLY in test files:
   - `test-e2e-session.ts:31`
   - `test-e2e-whiskers-wookies.ts:30`
   - `test-e2e-aperol-bar.ts:1164`

**What actually happens when user starts:**
1. User uploads images → `/public/uploads/{timestamp}-{filename}`
2. User chats → React state only
3. Vibes generated → `/public/vibes/{name}-{timestamp}.html`
4. Images generated → `/public/generated-images/{name}-{timestamp}.jpg`

**Verification:**
```bash
# Session folder structure EXISTS in demo sessions
ls /public/2026-01-26-falcamel-cafe/
# → SESSION.md, IMAGES.md, BUILD.md, CREATIVE-BRIEF.md, *.jpg, vibe-*.html

# But these were created by TEST SCRIPTS, not the production app
```

---

## SECTION 2: STATE MANAGEMENT

### Spec Says:
Filesystem is source of truth. React state is for UI only.

### Reality:

**React state IS the source of truth. Filesystem is barely touched.**

| State | Spec Location | Actual Location | Written Where? | Read Where? | Survives Refresh? |
|-------|---------------|-----------------|----------------|-------------|-------------------|
| Conversation history | SESSION.md | `useState` (page.tsx:48) | Never to file | Never from file | **NO** |
| Uploaded images | IMAGES.md | `useState` (page.tsx:37) | `/public/uploads/` only | Never from MD | **NO** |
| Generated images | IMAGES.md | `useState` (page.tsx:44) | `/public/generated-images/` only | Never from MD | **NO** |
| Build progress | BUILD.md | `useState` (page.tsx:58-61) | Never to file | Never from file | **NO** |
| Creative brief | CREATIVE-BRIEF.md | Never created | Never written | Never read | N/A |
| Vibe data | BUILD.md | `useState` (page.tsx:40) | `/public/vibes/` as HTML only | Never from MD | **NO** |
| Workflow phase | SESSION.md | `useState` (page.tsx:27) | Never to file | Never from file | **NO** |

**Browser Refresh Test:**

If user refreshes mid-session:
- ❌ Conversation history — LOST
- ❌ Uploaded image references — LOST (files exist but not re-loaded)
- ❌ Vibes — LOST (HTML exists but not re-loaded)
- ❌ Generated images — LOST (files exist but not re-loaded)
- ❌ Workflow phase — RESET to 'discovery'
- ❌ Selected vibe — LOST
- ✅ billingMode — SURVIVES (localStorage at page.tsx:84-94)

**Evidence:**
```typescript
// page.tsx:27-63 - ALL state is useState, NONE is file-backed
const [workflowPhase, setWorkflowPhase] = useState<WorkflowPhase>('discovery')
const [messages, setMessages] = useState<ConversationMessage[]>([])
const [sourceImages, setSourceImages] = useState<SourceImage[]>([])
const [vibes, setVibes] = useState<VibeData[]>([])
// ... 15 more useState calls
```

---

## SECTION 3: SESSION MANAGEMENT

### Spec Says:
Sessions created in `/output/{session-id}/`, listable, resumable.

### Reality:

| Component | Exists? | Location | Called in UI? |
|-----------|---------|----------|---------------|
| `createSession()` | ✅ | `lib/session.ts:227` | **NO** |
| `createSessionAction()` | ✅ | `lib/session-actions.ts:35` | **NO** |
| `listSessions()` | ✅ | `lib/session.ts:301` | Via orphaned component only |
| `listSessionsAction()` | ✅ | `lib/session-actions.ts:28` | Via orphaned component only |
| `SessionList` component | ✅ | `components/SessionList.tsx:28` | **NO** — never rendered |
| `getSession()` | ✅ | `lib/session.ts:275` | **NO** |

**What happens when user starts the app:**

1. User navigates to `/`
2. `page.tsx` renders (line 25)
3. Three panels render: AssetsPanel, CanvasPanel, ConversationPanel
4. **NO session is created**
5. **NO session list is shown**
6. User is in a single-use, ephemeral workspace

**Can user resume a previous session?**

**NO.** There is no UI to:
- View previous sessions
- Load a session
- Continue from a previous state

The `SessionList` component exists (`components/SessionList.tsx:28`) but is **never imported or rendered** in `page.tsx`.

**Evidence:**
```typescript
// page.tsx imports (lines 4-23)
import { AssetsPanel } from '@/components/AssetsPanel'
import { CanvasPanel } from '@/components/CanvasPanel'
import { ConversationPanel } from '@/components/ConversationPanel'
// ... NO SessionList import

// page.tsx render (lines 817-871)
return (
  <div className={`app-container ${layoutMode}`}>
    <AssetsPanel ... />
    {layoutMode === '3-panel' && <CanvasPanel ... />}
    <ConversationPanel ... />
    // ... NO <SessionList />
  </div>
)
```

---

## SECTION 4: AGENT ARCHITECTURE

### Spec Says:
- Creative Director (CD): Conducts discovery, writes CREATIVE-BRIEF.md, crafts image prompts
- WebDev: Reads brief, builds vibes, handles hot-swap
- Orchestrator: Coordinates handoffs
- Information barriers: CD can't see BUILD.md, WebDev can't see SESSION.md

### Reality:

**It's a MONOLITHIC SINGLE-AGENT SYSTEM, not multi-agent.**

| Aspect | Spec | Reality |
|--------|------|---------|
| Number of agents | 3 (CD, WebDev, COO) | 1 (single Claude instance) |
| Agent invocation | Separate calls per agent | Single `/api/chat` or `/api/chat-stream` |
| System prompts | Separate per agent | One combined prompt from `lib/cd-agent-prompt.ts` |
| Orchestration | ORCHESTRATOR.md coordinates | No orchestration code exists |
| Information barriers | Enforced by code | **NOT ENFORCED** — only mentioned in prompt text |

**Agent prompt files exist but are DOCUMENTATION, not executable:**

| File | Location | Purpose | Used? |
|------|----------|---------|-------|
| `creative-director.md` | `/agents/` | CD instructions | Read and injected into single prompt |
| `webdeveloper.md` | `/agents/` | WebDev instructions | **NEVER LOADED** |
| `coo.md` | `/agents/` | COO instructions | **NEVER LOADED** |
| `ORCHESTRATOR.md` | `/agents/` | Coordination spec | **NEVER LOADED** |

**How Claude is actually called:**

```typescript
// app/api/chat/route.ts:252-261
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY!,
    'anthropic-version': '2023-06-01'
  },
  body: JSON.stringify({
    model: 'claude-opus-4-5-20251101',  // ONE model
    system: systemPrompt,                 // ONE prompt (from buildCDPrompt)
    messages: messages,
    // ...
  })
})
```

**Information barriers are NOT enforced:**
- `lib/session.ts:275-290` — `getSession()` loads ALL 4 markdown files
- No permission checks prevent reading any file
- The "barriers" are instructions in the prompt text only

**Evidence for single-agent:**
```typescript
// lib/cd-agent-prompt.ts:208-235
export function buildCDPrompt(sourceImages: SourceImageInfo[]): string {
  const cdAgentMd = loadCDAgentPrompt()  // Only CD prompt loaded
  const strippedMd = stripTerminalSections(cdAgentMd)
  // ... returns single combined prompt
  // WebDev prompt is NEVER loaded
}
```

---

## SECTION 5: THE FOUR PHASES

### Spec Says:
```
Phase 1: Discovery → STOP (user greenlights)
Phase 2: Vibes → NO STOP (train leaves)
Phase 3: Build → STOP (await user)
Phase 4: Polish → STOP (done)
```

### Reality:

**Phase tracking exists but is NOT connected to the spec's phase system.**

| Spec Phase | Implemented? | Actual Implementation |
|------------|--------------|----------------------|
| PHASE_1_DISCOVERY | Partial | `workflowPhase === 'discovery'` (page.tsx:27) |
| PHASE_2_VIBES | No | Not implemented |
| PHASE_3_BUILD | Partial | `workflowPhase === 'generation'` (different meaning) |
| PHASE_4_POLISH | No | Not implemented |

**Actual workflow phases in code (`lib/types.ts`):**
```typescript
export type WorkflowPhase = 'discovery' | 'moodboard' | 'selection' | 'generation' | 'preview'
```

This is a DIFFERENT phase system than the spec. It's about UI states, not the orchestrated CD→WebDev handoff.

**Phase transitions in `page.tsx`:**
- Line 219: `setWorkflowPhase('generation')` — after vibes generated
- Line 235: `setWorkflowPhase('moodboard')` — after moodboard generated
- Line 658: `setWorkflowPhase('generation')` — when moodboard concept selected

**NO phase transitions for:**
- Discovery complete → STOP
- Brief written → WebDev starts
- Build complete → STOP
- Polish complete → Done

**NO stops exist as specified.** The flow is continuous, not gated.

---

## SECTION 6: HOT-SWAP MECHANISM

### Spec Says:
1. Image generated → written to session folder
2. CD analyzes → updates IMAGES.md
3. Find vibe HTML with matching `data-slot`
4. Replace `src` attribute
5. Log to BUILD.md
6. Fire snackbar

### Reality:

**Hot-swap is FULLY IMPLEMENTED but NEVER CALLED.**

| Component | Exists? | Location | Called? |
|-----------|---------|----------|---------|
| `hotSwap()` | ✅ | `lib/hot-swap.ts:152-203` | **NEVER** |
| `swapInFile()` | ✅ | `lib/hot-swap.ts:101-147` | **NEVER** (only by hotSwap) |
| `autoHotSwap()` | ✅ | `lib/hot-swap.ts:317-333` | **NEVER** |
| `logSwapToBuildMd()` | ✅ | `lib/hot-swap.ts:208-246` | **NEVER** |
| `findMatchingSlots()` | ✅ | `lib/hot-swap.ts:73-92` | **NEVER** |
| `data-slot` attributes | ✅ | All vibe HTML files | Never queried at runtime |

**Actual image generation flow:**

```
User approves prompt
    ↓
/api/edit-image called (app/api/edit-image/route.ts)
    ↓
Gemini generates image
    ↓
Saved to /public/generated-images/{name}-{timestamp}.jpg
    ↓
Response returns { imageUrl, savedPath }
    ↓
page.tsx updates React state (line 544-556)
    ↓
oskarCanvas.sendImageUpdate() to iframe (line 648)
    ↓
STOP — No hot-swap, no BUILD.md update, no snackbar
```

**Evidence that hotSwap is dead code:**
```bash
# Grep for hotSwap calls
grep -r "hotSwap(" --include="*.ts" --include="*.tsx" | grep -v "function hotSwap" | grep -v "export.*hotSwap"
# Result: EMPTY — no calls found
```

**`data-slot` exists in HTML but is never read:**
- 20 instances across 4 vibe HTML files
- Pattern: `<img src="hero.jpg" data-slot="hero">`
- No JavaScript queries for `[data-slot]`
- No DOM manipulation based on data-slot

---

## SECTION 7: SNACKBAR SYSTEM

### Spec Says:
Events fire for: vibe ready, image ready, hot-swap, re-prompt, all complete, error

### Reality:

**Snackbar system is FULLY IMPLEMENTED but NEVER TRIGGERED.**

| Component | Exists? | Location | Working? |
|-----------|---------|----------|----------|
| `Snackbar.tsx` | ✅ | `components/Snackbar.tsx` | Yes (renders correctly) |
| `SnackbarProvider.tsx` | ✅ | `components/SnackbarProvider.tsx` | Yes (listens to events) |
| `sessionEvents` emitter | ✅ | `lib/session-events.ts` | Yes (emitter works) |
| Emit functions | ✅ | `lib/session-events.ts:159-227` | **NEVER CALLED** |

**Event types the provider listens for (`SnackbarProvider.tsx:100-175`):**
- `vibe-ready` → Success snackbar with [View]
- `image-ready` → Info snackbar with [View] [Re-prompt]
- `hot-swap` → Info snackbar with [View]
- `regenerating` → Progress snackbar
- `all-complete` → Success snackbar with [Compare]
- `error` → Error snackbar with [Retry]
- `phase-change` → Suppressed (no snackbar)
- `brief-updated` → Info snackbar

**Emit functions defined but NEVER CALLED:**

| Function | Defined At | Called From |
|----------|-----------|-------------|
| `emitVibeReady()` | session-events.ts:159 | **NOWHERE** |
| `emitImageReady()` | session-events.ts:167 | **NOWHERE** |
| `emitHotSwap()` | session-events.ts:175 | **NOWHERE** |
| `emitRegenerating()` | session-events.ts:189 | **NOWHERE** |
| `emitAllComplete()` | session-events.ts:197 | **NOWHERE** |
| `emitError()` | session-events.ts:205 | **NOWHERE** |
| `emitPhaseChange()` | session-events.ts:213 | **NOWHERE** |
| `emitBriefUpdated()` | session-events.ts:221 | **NOWHERE** |

**Evidence:**
```bash
# Search for any emit call
grep -r "emit.*Ready\|emit.*Complete\|emit.*Swap\|emit.*Error" --include="*.ts" --include="*.tsx" | grep -v "function emit" | grep -v "export function"
# Result: EMPTY — no calls found in production code
```

**Do snackbars ever appear?**

**NO.** The pipeline is:
```
[Action] → emit*() → sessionEvents.emit() → SnackbarProvider listener → show()
           ↑
           BROKEN HERE — emit never called
```

---

## SECTION 8: WHAT WORKS

Components that exist AND are wired up AND produce correct behavior:

### 1. Image Upload
- **What:** User uploads images, they're saved and analyzed
- **Trigger:** Drag-drop or file picker in AssetsPanel
- **Flow:** `AssetsPanel` → `handleUpload` (page.tsx:97) → `/api/upload` → `/public/uploads/`
- **Files:** `components/AssetsPanel.tsx`, `app/api/upload/route.ts`
- **Status:** ✅ WORKS

### 2. Chat with Claude (CLI mode)
- **What:** User sends message, Claude responds with streaming
- **Trigger:** Type in ConversationPanel, click send
- **Flow:** `ConversationPanel` → `handleStreamingMessage` (page.tsx:253) → `/api/chat-stream` → spawns `claude` CLI
- **Files:** `components/ConversationPanel.tsx`, `app/api/chat-stream/route.ts`
- **Status:** ✅ WORKS

### 3. Chat with Claude (API mode)
- **What:** User sends message, Claude responds via API
- **Trigger:** Toggle billing mode to API, then chat
- **Flow:** `ConversationPanel` → `handleSendMessage` (page.tsx:130) → `/api/chat` → Anthropic API
- **Files:** `components/ConversationPanel.tsx`, `app/api/chat/route.ts`
- **Status:** ✅ WORKS

### 4. Vibe Generation
- **What:** Claude generates vibes, they're saved and displayed
- **Trigger:** Chat produces vibe data
- **Flow:** API response → `setVibes` (page.tsx:213) → `/api/save-vibes` → `/public/vibes/`
- **Files:** `app/api/save-vibes/route.ts`, `components/CanvasPanel.tsx`
- **Status:** ✅ WORKS

### 5. Image Generation (Gemini)
- **What:** Generate/edit images via Gemini API
- **Trigger:** Click generate on asset in AssetsPanel
- **Flow:** `handleAssetGenerate` (page.tsx:509) → `/api/edit-image` → Gemini → `/public/generated-images/`
- **Files:** `app/api/edit-image/route.ts`, `lib/gemini.ts`
- **Status:** ✅ WORKS

### 6. Vibe Preview in Canvas
- **What:** Display vibe HTML in iframe
- **Trigger:** Select vibe in CanvasPanel
- **Flow:** `selectedVibe` → `VibePreview` component → iframe
- **Files:** `components/CanvasPanel.tsx`, `components/VibePreview.tsx`
- **Status:** ✅ WORKS

### 7. Director Mode (text editing)
- **What:** Click-to-edit text in vibe preview
- **Trigger:** Toggle Director Mode, click text
- **Flow:** `directorMode` → iframe postMessage → `handleTextEdit` (page.tsx:607)
- **Files:** `components/CanvasPanel.tsx`, `page.tsx`
- **Status:** ✅ WORKS

### 8. Billing Mode Toggle
- **What:** Switch between CLI (subscription) and API (per-token) billing
- **Trigger:** Toggle in UI
- **Flow:** `setBillingMode` → localStorage persist (page.tsx:93)
- **Files:** `components/BillingToggle.tsx`, `page.tsx`
- **Status:** ✅ WORKS (and survives refresh)

---

## SECTION 9: WHAT'S FACADE

Components that exist but are never called/connected:

### 1. Session Creation System
- **Files:** `lib/session.ts:227-250`, `lib/session-actions.ts:35`
- **Supposed to do:** Create session folder with 4 markdown files
- **Why not connected:** `page.tsx` never calls `createSession()`
- **To connect:** Call `createSessionAction(businessName)` when user starts first chat

### 2. Session List Component
- **Files:** `components/SessionList.tsx`
- **Supposed to do:** Show list of previous sessions, allow resume
- **Why not connected:** Never imported or rendered in `page.tsx`
- **To connect:** Import and render `<SessionList />` in page.tsx

### 3. Hot-Swap Mechanism
- **Files:** `lib/hot-swap.ts` (entire file)
- **Supposed to do:** Replace images in vibe HTML, update BUILD.md
- **Why not connected:** `/api/edit-image` doesn't call `hotSwap()`
- **To connect:** After image generation, call `hotSwap(sessionId, newImageFilename, slot)`

### 4. Session Event Emitters
- **Files:** `lib/session-events.ts:159-227`
- **Supposed to do:** Fire events that trigger snackbars
- **Why not connected:** No API route or handler calls any `emit*()` function
- **To connect:** Call appropriate emit function after each action completes

### 5. Build/Images/Session MD Writers
- **Files:** `lib/session.ts:421-447`
- **Functions:** `updateSessionMd()`, `updateImagesMd()`, `updateBuildMd()`
- **Supposed to do:** Persist state to markdown files
- **Why not connected:** No production code calls these functions
- **To connect:** Call after each state change (message sent, image uploaded, vibe generated)

### 6. WebDev Agent Prompt
- **Files:** `/agents/webdeveloper.md`
- **Supposed to do:** Provide instructions for WebDev agent
- **Why not connected:** Only CD prompt is loaded; WebDev prompt ignored
- **To connect:** Load and use in a separate agent call for build phase

### 7. COO Agent Prompt
- **Files:** `/agents/coo.md`
- **Supposed to do:** Provide testing/workaround instructions
- **Why not connected:** Never loaded or used
- **To connect:** Load and use for testing/debug workflows

### 8. Orchestrator Spec
- **Files:** `/agents/ORCHESTRATOR.md`
- **Supposed to do:** Define agent coordination protocol
- **Why not connected:** No orchestration code exists
- **To connect:** Implement orchestration logic that reads this spec

---

## SECTION 10: WHAT'S MISSING

Things the spec requires that don't exist at all:

### 1. Multi-Agent Orchestration
- **Spec requires:** CD and WebDev as separate agents with handoff
- **Current state:** Single monolithic Claude call
- **To build:** Implement agent router that calls CD, then WebDev separately

### 2. CD → CREATIVE-BRIEF.md → WebDev Handoff
- **Spec requires:** CD writes brief, WebDev reads it to build
- **Current state:** No brief is ever written; vibes come directly from CD response
- **To build:** CD generates brief → write to file → WebDev reads and builds

### 3. Parallel Execution (WebDev starts while CD crafts prompts)
- **Spec requires:** Overlapping execution, mini-bus architecture
- **Current state:** Sequential, freight-train (batch) processing
- **To build:** Start WebDev build immediately after brief; handle prompt approvals async

### 4. Phase Stops (Gates)
- **Spec requires:** Stop after Discovery, Build, Polish for user approval
- **Current state:** Continuous flow with no gates
- **To build:** Implement phase state machine with explicit user continue actions

### 5. Information Barrier Enforcement
- **Spec requires:** CD can't read BUILD.md, WebDev can't read SESSION.md
- **Current state:** No enforcement; all files accessible
- **To build:** Create role-specific file access functions that filter by agent

### 6. Conversation Logging to SESSION.md
- **Spec requires:** All messages logged to SESSION.md with timestamps
- **Current state:** Messages exist only in React state
- **To build:** Append to SESSION.md after each message sent/received

### 7. Image Analysis Logging to IMAGES.md
- **Spec requires:** CD analyzes each image, logs to IMAGES.md
- **Current state:** Analysis in React state only
- **To build:** After upload analysis, append to IMAGES.md

### 8. Vibe Build Logging to BUILD.md
- **Spec requires:** Track vibe queue, image slots, hot-swap log
- **Current state:** BUILD.md never updated in production
- **To build:** Update BUILD.md after each vibe created, image swapped

### 9. Session Resume Flow
- **Spec requires:** Homepage shows sessions, user can click to resume
- **Current state:** No session list rendered, no resume capability
- **To build:** Render SessionList, implement `loadSession()` to restore state from MDs

### 10. Mini-Bus Architecture for Image Generation
- **Spec requires:** Each approved prompt leaves immediately
- **Current state:** All image generation is manual, one-at-a-time
- **To build:** Implement prompt approval queue that triggers generation on each approval

---

## SECTION 11: WHY DID THIS HAPPEN?

### What did the previous Claude Code instance actually build?

**A functional webapp with demo-ready scaffolding but no core architecture.**

It built:
- A working 3-panel UI (Assets, Canvas, Conversation)
- Working Claude integration (both CLI and API modes)
- Working image generation via Gemini
- Working vibe preview and Director Mode
- Library files that implement the spec's mechanisms
- Demo sessions with hand-written markdown files

It did NOT build:
- The session-first architecture
- The multi-agent orchestration
- The filesystem-as-truth pattern
- The event-driven notification system
- The hot-swap pipeline

### Where did it diverge from the spec?

| Spec Requirement | What Was Built Instead | Evidence |
|-----------------|------------------------|----------|
| Filesystem is source of truth | React state is source of truth | `page.tsx` has 18 `useState` calls |
| Session folders created on start | Sessions never created | `createSession()` never called |
| 4 markdown files track state | Markdown files are decorative | Only test scripts write to them |
| Multi-agent with handoff | Single monolithic prompt | Only `buildCDPrompt()` used |
| Hot-swap when images arrive | Manual image refresh | `hotSwap()` never called |
| Snackbars on events | Snackbars never appear | `emit*()` never called |
| Session list on homepage | No session list rendered | `SessionList` orphaned |
| Phase stops for user approval | Continuous flow | No gating logic |

### Why do you think it diverged?

**1. Training bias toward React patterns**

Claude Code defaulted to standard Next.js/React patterns:
- `useState` for state management
- API routes that return JSON
- Components that render from props

This is the "normal" way to build webapps. The spec's filesystem-first architecture is unusual.

**2. Misunderstanding of "filesystem as source of truth"**

The Claude instance may have interpreted this as "save files to disk" rather than "read state FROM disk on every render."

Files ARE saved (uploads, vibes, generated images). But they're saved as OUTPUT, not as the SOURCE of state.

**3. Demo-driven development**

The existence of complete demo sessions (`2026-01-26-falcamel-cafe`, etc.) suggests:
- Test scripts were used to create "working" examples
- The demo LOOKS like the spec was followed
- But the production flow bypasses all of it

**4. Incremental improvement instead of reset**

The spec says: "This refactor wraps the webapp around the working architecture, not the other way around."

But the code wraps the architecture around the webapp:
- The webapp (React state, API routes) is primary
- The session/MD system is bolted on as unused scaffolding

**5. Library-first, integration-never**

All the right pieces exist:
- `lib/session.ts` — session management ✅
- `lib/hot-swap.ts` — image replacement ✅
- `lib/session-events.ts` — event system ✅
- `components/Snackbar*.tsx` — notifications ✅
- `components/SessionList.tsx` — session browser ✅

But none are wired into the actual user flow. It's as if the Claude instance:
1. Read the spec
2. Created files matching the spec's file list
3. Never connected them to `page.tsx` or the API routes

### What would it take to get from current state to spec?

**Scope: 8-12 hours of focused work**

The core mechanisms exist. What's missing is integration:

1. **Create session on first message** (1 hour)
   - Call `createSessionAction()` from `handleSendMessage`
   - Store `sessionId` in React state
   - Pass to all API calls

2. **Write to session folder instead of global folders** (2 hours)
   - Modify `/api/upload` to write to `/public/{sessionId}/`
   - Modify `/api/edit-image` to write to `/public/{sessionId}/`
   - Modify `/api/save-vibes` to write to `/public/{sessionId}/`

3. **Log to markdown files after each action** (2 hours)
   - After message: `updateSessionMd()`
   - After upload: `updateImagesMd()`
   - After vibe: `updateBuildMd()`

4. **Wire up hot-swap** (2 hours)
   - After image generation: call `hotSwap()`
   - This updates HTML and BUILD.md

5. **Emit events for snackbars** (1 hour)
   - After vibe ready: `emitVibeReady()`
   - After image ready: `emitImageReady()`
   - After hot-swap: `emitHotSwap()`
   - Etc.

6. **Add session list to homepage** (1 hour)
   - Import `SessionList` in `page.tsx`
   - Render conditionally (show list or show workspace)
   - Implement `loadSession()` to restore from markdown files

7. **Multi-agent orchestration** (3+ hours)
   - This is the hardest part
   - Requires splitting CD and WebDev into separate calls
   - Implementing handoff via CREATIVE-BRIEF.md
   - Parallel execution

---

## SECTION 12: RECOMMENDATION

### B) PARTIAL REBUILD

**Keep:**
- UI components (AssetsPanel, CanvasPanel, ConversationPanel, Snackbar*, VibePreview)
- API routes (with modifications to write paths)
- Library functions (session.ts, hot-swap.ts, session-events.ts, gemini.ts)
- Agent prompt files (/agents/*.md)
- Demo sessions (as reference)

**Discard and rebuild:**
- `app/page.tsx` state management — needs session-first architecture
- API route write paths — need to target session folders
- Integration layer — need to connect libraries to UI flow

**Estimated scope:** 10-14 hours

### Justification:

1. **The pieces are all there.** Unlike a full rebuild, we don't need to rewrite:
   - Hot-swap logic
   - Session management
   - Event system
   - Snackbar UI
   - Agent prompts

2. **The problem is integration, not implementation.** Every "facade" component is correctly implemented. They just need to be called.

3. **The UI is solid.** The 3-panel layout, vibe preview, Director Mode, billing toggle — all work correctly.

4. **Full rebuild would be slower.** Starting from scratch would require:
   - Re-implementing all lib functions
   - Re-building all UI components
   - Re-creating all demo data

5. **Partial rebuild preserves working code.** The 8 "what works" items can remain untouched. We only need to:
   - Add session creation
   - Change write paths
   - Add emit calls
   - Render SessionList

### What to do:

1. Create new `page.tsx` that starts with session creation
2. Modify API routes to accept `sessionId` and write to session folder
3. Add `emit*()` calls after each significant action
4. Import and render `SessionList` for session browsing
5. Implement `loadSession()` to restore state from markdown files
6. (Optional) Implement multi-agent orchestration for true CD→WebDev handoff

The codebase is salvageable. It just needs someone to connect the plumbing.

---

## APPENDIX: FILE EVIDENCE INDEX

For quick reference, every claim in this audit with file:line evidence:

| Claim | File | Line |
|-------|------|------|
| createSession defined | lib/session.ts | 227 |
| createSession never called (UI) | (grep result) | N/A |
| SessionList defined | components/SessionList.tsx | 28 |
| SessionList never rendered | app/page.tsx | (not imported) |
| hotSwap defined | lib/hot-swap.ts | 152-203 |
| hotSwap never called | (grep result) | N/A |
| emitVibeReady defined | lib/session-events.ts | 159 |
| emit* never called | (grep result) | N/A |
| React state source of truth | app/page.tsx | 27-63 |
| Single agent prompt | lib/cd-agent-prompt.ts | 208-235 |
| Only CD prompt loaded | lib/cd-agent-prompt.ts | 212 |
| WebDev prompt exists | agents/webdeveloper.md | 1 |
| WebDev prompt never loaded | (grep result) | N/A |
| Uploads go to /public/uploads/ | app/api/upload/route.ts | 32 |
| Generated images go to /public/generated-images/ | app/api/edit-image/route.ts | 78 |
| Vibes go to /public/vibes/ | app/api/save-vibes/route.ts | 85 |
| billingMode persisted | app/page.tsx | 84-94 |
| SnackbarProvider listens | components/SnackbarProvider.tsx | 100-175 |
| data-slot in HTML | public/2026-01-26-falcamel-cafe/vibe-1-qahwa-landing.html | 146+ |

---

**END OF AUDIT**
