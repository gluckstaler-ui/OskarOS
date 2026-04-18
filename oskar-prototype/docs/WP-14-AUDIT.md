# WP-14-AUDIT — CD Workflow Wiring

**Date:** 2026-04-17
**Author:** Claude (Opus 4.7) — during WP-14A
**Purpose:** Map the documented CD workflow against the actual implementation. Identify gaps. No code changes in this doc.

User report (verbatim, 2026-04-17):

> "the whole CD interaction doesn't work — CD doesn't get informed of images generated, the whole workflow as described in the document seems not wired. Nothing works or almost nothing works as specified."

---

## Summary of findings

The implementation has **more wired than Ralph thinks** (outbound triggers work, boot context is rich, Ask CD parses correctly, WP-6B 2-turn self-description is already live). But there are **six structural gaps** that together produce the "nothing works" experience:

1. **Two different CDs** live in the app (Opus Briefing vs. Sonnet Ask-CD) with no shared memory.
2. **CD is never notified when Nano Banana returns an image.** Files land on disk, IMAGES.md gets appended, Briefing CD is oblivious unless user mentions it.
3. **Briefing CD reads session files ONLY at boot.** Mid-session, no mechanism exists to tell CD "a new image arrived" or "WebDev built a new page."
4. **Ask CD context is stripped.** Little CD doesn't get session id, user portrait, brand, or recent generations — each call is a cold start.
5. **CD activity has no dedicated log.** There's no `## CD Activity` trail in SESSION.md for Sage to harvest later.
6. **Error handling is generic.** Timeouts, 5xx, model errors bubble up as silent failures in the UI.

The "nothing works as specified" complaint is valid at a system-integration level, even though many individual pieces work. It's not broken code — it's a broken pipeline between the pieces.

---

## A. CD-facing surfaces — inventory

| # | Surface | Entry point (user action) | Backend | Model | Context |
|---|---------|---------------------------|---------|-------|---------|
| 1 | **Briefing chat** (Studio right pane, direct API route) | Type in ConversationPanel textarea | `app/api/chat-stream/route.ts` (CLI bridge) OR `app/api/chat/route.ts` (direct API) | `claude-opus-4-7[1m]` | Full — system prompt includes session files on cold/resume; mid-session, only user text + bridge memory |
| 2 | **Ask CD pill** (Advanced Mode Zone 3) | Type in Ask CD textarea, hit Enter | `app/api/ask-cd/route.ts` (one-shot) | `claude-sonnet-4-6` via `callAnthropic` | Thin — mode, image filename+description, current prompt, staged images, user message. **No session id, no user portrait, no history.** |
| 3 | **Uploaded-image analysis** (implicit, on upload) | User drops images in Assets panel | Image upload → `sourceImages` array → included in `buildCDPrompt` on next chat-stream turn | Same as #1 | Images enumerated by filename; CD is told in system prompt "First action: analyze these" |
| 4 | **Trigger execution** (CD → app) | CD's response text contains `## VIBES READY` / `## BUILD: X` / `## HOTSWAP: X Y` / `## UPDATE ASSETS` / `## IMAGES NEEDED` / `## BUILD READY` | `chat-stream/route.ts` — regex detection at lines 379-549 | N/A (parsing) | Works |

**Finding A1:** Surfaces #1 and #2 are **different agents** in every meaningful sense — different model, different context shape, different memory. The user experiences one "CD" conceptually. The app has two.

---

## B. Per-surface gap analysis

### B1. Briefing chat (chat-stream + chat)

**Spec:**
- CD boots with full session memory (SESSION.md, CREATIVE-BRIEF.md, IMAGES.md, user.md)
- CD reads images and pages IMMEDIATELY when they arrive
- CD triggers workflows via magic words

**Implementation (`lib/cd-agent-prompt.ts:36-160`):**
- Cold start → full session context assembled, including consolidated session.md, user.md, CREATIVE-BRIEF.md, IMAGES.md, html files list ✅
- Bridge resume → short "I'm back" prompt relying on Claude CLI's `--resume` for history ✅
- Source images list passed ✅

**Gaps:**
- **B1.a — Mid-session awareness is zero.** Once the bridge is warm, CD only sees new events if they appear in the user's message text. `chat-stream/route.ts:625` pulls only `lastUserMessage.content` — no synthesized context delta. If user generates 10 images in Advanced Mode and then asks "what do you think?", CD has no memory of those files being created.
- **B1.b — No "fresh IMAGES.md" re-injection.** When the user finishes image generation and comes back to briefing, the IMAGES.md on disk has grown. CD doesn't re-read it unless explicitly asked. The bridge's `--resume` keeps stale context from last turn.
- **B1.c — No WebDev-result notification.** Per agent file lines 152-158: "When a page comes in from WebDev: Read it immediately — don't wait for user to ask." No mechanism delivers this signal — CD only reads new HTML if the user's message names it.
- **B1.d — Error handling is generic.** `chat-stream/route.ts` emits text events but has no visible timeout; on backend failure the stream just stops. The Briefing UI (ConversationPanel) may show a spinner forever.

### B2. Ask CD pill (`ask-cd/route.ts`)

**Spec** (from ADVANCED-MODE-PLAN.md, WP-6A section):
- CD receives: mode, image + analysis, current prompt, staged images, user message
- CD responds with `## IMAGE PROMPT` + `## FEEDBACK`
- Prompt goes to Zone 4; feedback surfaces inline/snackbar
- Graceful fallback when CD breaks format

**Implementation (`app/api/ask-cd/route.ts`):**
- Accepts AskCDRequestBody with the documented shape ✅
- Uses `parseCDResponse` with tiered fallback ✅
- Routes `imagePrompt` to Zone 4 via `patchCurrentTab` in `AdvancedMode.tsx:795-796` ✅
- Shows feedback inline in Zone 3 via `setCDFeedback` ✅

**Gaps:**
- **B2.a — Context is stripped.** The prompt built in `buildAskCDPrompt` (`ask-cd/route.ts:37-99`) contains only the request body data. No session id is passed in. CD cannot:
  - Read the user's portrait (`user.md`)
  - Read the brand brief (CREATIVE-BRIEF.md)
  - See recent generations (last 5)
  - See vibe selections
  - Reference the current session's aesthetic calibration
- **B2.b — Wrong model.** `CD_MODEL = 'claude-sonnet-4-6'` (`ask-cd/route.ts:15`). The "Big CD" user talks to in Briefing is Opus 4.7. The user trusts Big CD's taste. Little CD is a different model; its judgments will drift.
- **B2.c — No session-level memory.** Each Ask CD call is isolated. Successive asks don't build on each other. CD has no "you just told me to avoid golden-hour clichés" memory across asks.
- **B2.d — No CD-activity append.** The call happens, response returns, nothing is written to SESSION.md or any log. Sage has no way to learn from Little CD's interactions.
- **B2.e — No timeout visibility in the UI.** The user clicks Send, `handleAskCD` sets `isCDLoading = true` (`AdvancedMode.tsx:742`), and on network failure shows generic error (lines 813-825). No visible countdown; on silent stall, UI hangs until fetch eventually times out at browser default (~60s).

### B3. Image upload — CD notification

**Spec** (agent file lines 160-164, 207): "When images come back — READ THEM IMMEDIATELY. Evaluate. Update IMAGES.md. Don't wait."

**Implementation:**
- User uploads images → `emitImageReady(sessionId, imageName)` fires (`session-events.ts:167`)
- On the NEXT chat-stream turn, new uploads appear in `sourceImages` in `buildCDPrompt` ✅
- No server-side push to CD between turns

**Gap:** Upload notification reaches snackbars, not CD. CD only sees the upload on the next user message. If user uploads 10 images and doesn't message CD, they sit un-analyzed.

### B4. Image generation — CD notification (the core complaint)

**Spec:** Same as B3 — CD reads results immediately.

**Implementation (`app/api/edit-image/route.ts`):**
- Nano Banana returns image + `geminiText` (Turn 2 description)
- `edit-image/route.ts:153-165` appends entry to IMAGES.md:
  ```
  ### {filename}
  - **Operation:** edit
  - **Prompt:** {instruction}
  - **Nano Banana:** {geminiText}
  ```
- UI emits `emitImageReady` for snackbar
- `AdvancedMode.tsx:1778-1800` fires auto-hot-swap via `hotSwapAction`

**Gaps:**
- **B4.a — Briefing CD never receives an event.** The bridge process knows nothing about the generation. Even if CD is live in the bridge, no message reaches it.
- **B4.b — Stale context in continued bridge session.** Since the bridge caches its context via `--resume`, even re-reading IMAGES.md after every generation doesn't help — CD's conversation history still reflects the pre-generation state.
- **B4.c — No `## CD Activity` append.** Neither the app nor CD writes to a log summarizing "image X generated at T with prompt P and Nano's description D." Sage can't harvest this signal at session end.

### B5. WebDev build — CD notification

**Spec:** Agent file lines 152-158. When WebDev builds a page, CD reads + evaluates + maybe rebuilds.

**Implementation:**
- `chat-stream/route.ts:380-429` handles `## VIBES READY` → triggers WebDev via fetch to `/api/webdev` or similar
- Result (HTML file in session folder) is detected via session-level events (`session-events.ts` — `all-complete` and similar)
- No signal goes back to the Briefing chat loop

**Gap:** WebDev writes HTML to disk, fires snackbars. CD's next turn sees the new file in `htmlFiles` only on the next cold start. Mid-session CD is blind to the new build.

### B6. Trigger execution (outbound CD → app)

**Status:** ✅ **This works.** `chat-stream/route.ts` lines 342-549 handle all six documented triggers. Regex detection on `fullOutput` accumulates text + tool-use content. Actions fire: vibe-build, single-vibe rebuild, hot-swap, asset refresh, images-needed extraction. This is the one part of the workflow that matches the spec end-to-end.

---

## C. Architectural gaps

### C1. Two CDs, one brand
Big CD (Briefing, Opus) and Little CD (Ask CD pill, Sonnet) don't share memory, don't share model, don't share voice. User believes they're talking to "the CD." System has two agents with different calibration. This manifests as:
- Little CD suggests prompts that contradict what Big CD wrote in CREATIVE-BRIEF.md
- Little CD ignores user portrait in `user.md` (doesn't even know it exists)
- Each Ask CD is a cold start — no "scar tissue" from the session

### C2. No event bus between app and CD
Every "CD must know about X" moment in the agent file (image arrival, page arrival, user selection, hot-swap) assumes a push mechanism. None exists. The architecture is:
- User → CD: via typed message
- CD → App: via magic words
- App → CD: *no channel* — CD only reads disk state at boot

This is the root of most complaints. The app emits events (`session-events.ts`), but they're UI-only (snackbars). They don't reach CD.

### C3. IMAGES.md is write-only from the app's POV
Both `edit-image/route.ts` and the upload pipeline append to IMAGES.md. CD reads it at cold start. In between, there's no sync. When CD's bridge is mid-session and IMAGES.md grows, CD doesn't know.

### C4. SESSION.md lacks a CD activity log
The `## Conversation Log` in SESSION.md has a documented format (agent file lines 350-355) but nothing writes to it automatically. Sage's consolidation pipeline would benefit hugely from structured `CD | HH:MM:SS | [action]` entries.

### C5. Error surfaces are inconsistent
- `chat-stream` errors: SSE stream dies; UI shows nothing explicit
- `ask-cd` errors: 500 + generic message; UI shows "CD did not respond"
- Timeouts: none defined explicitly; browser default (~60s) is the only guardrail

---

## D. Recommendations for WP-14B / 14C / 14D

Based on the gaps above, here's what 14B-D should deliver, in priority order:

### D1. Unify or bridge the two CDs (addresses C1)

**Option A (minimal):** Give Ask CD access to session files. Expand `AskCDRequestBody` to include `sessionId`; `ask-cd/route.ts` reads `user.md` + CREATIVE-BRIEF.md + IMAGES.md and injects them into the Ask CD prompt. Model stays Sonnet for cost/latency, but context matches Big CD.

**Option B (aggressive):** Route Ask CD through the Briefing bridge. Single CD, single memory, single voice. Cost goes up (Opus per-ask); consistency goes up more.

My recommendation: **Option A** for 14B, leave Option B as a Phase-2 refactor. The cost delta and latency hit of Opus-per-ask is non-trivial.

### D2. Push events to Briefing CD (addresses B1.a, B1.b, B1.c, B4, B5)

New function in `lib/cd-notifications.ts`:
```
pushCDEvent(sessionId, kind, payload)
  // Appends to public/{sessionId}/CD-INBOX.md
  // Briefing bridge reads CD-INBOX.md on every user turn,
  // folds entries into a synthesized context delta,
  // then clears the inbox
```

Kinds: `image-generated`, `image-uploaded`, `vibe-built`, `user-selection`, `hot-swap-fired`.

Wire:
- `app/api/edit-image/route.ts` → push `image-generated` after Nano Banana returns
- Upload pipeline → push `image-uploaded`
- Vibe build completion → push `vibe-built`
- Hot-swap actions → push `hot-swap-fired`

`chat-stream/route.ts:625` (where `currentMessage` is pulled) prepends the CD-INBOX delta to every user message sent to the bridge. CD sees "Since you last heard from me, 3 images were generated, 1 vibe was built, 2 hot-swaps happened" and can react.

### D3. CD Activity log (addresses C4)

New function `appendCDActivity(sessionId, entry)`. Called:
- From `chat-stream` on every CD response (summary)
- From `ask-cd` on every successful response (summary)
- From event pushers (D2) to log what CD was told

Writes to `SESSION.md` under `## CD Activity`. Sage's consolidator reads it for signal extraction at session end.

### D4. Visible errors + retry (addresses C5, B2.e, B1.d)

- Every CD API call gets a 30s timeout
- Loading state shows elapsed seconds after 5s ("CD thinking… 8s")
- Failures surface the real error (not "CD did not respond"); include the HTTP status and a retry button
- Timeouts: clear UI state ("CD timed out after 30s") + retry

### D5. Per-surface context templates (addresses B2.a)

Create `lib/ask-cd-context.ts`:
```
buildAskCDContext({ sessionId, mode, image, currentPrompt, stagedImages })
  → {
      userPortrait: string (from user.md),
      brandBrief: string (from CREATIVE-BRIEF.md, relevant sections),
      recentGenerations: GenerationRecord[] (last 5 from IMAGES.md),
      voiceSamples: string[] (from relevant VIBE-N.md if picked),
    }
```

`ask-cd/route.ts` calls this once; injects into the CD prompt under a `## Session Context` block. Shape is auditable and reviewable.

---

## E. Out-of-scope for 14

These surfaced during the audit but are their own work:

- **CD response parsing drift.** `parseCDResponse` (`lib/cd-response-parser.ts`) is tier-based but the tier statistics aren't logged anywhere. If tier-4/5 fires more than 10% of the time the agent prompt needs tuning — no monitoring exists.
- **Bridge resume fidelity.** When the Opus bridge is resumed via `--resume`, the Claude CLI loads its own conversation history but CD has no mechanism to know which files changed. A "delta injection" pattern would help (overlaps with D2).
- **CD-Padawan communication.** Agent file lines 34-38 describe Sage writing to `CD-MEMORY.md` and `user.md`. Currently Sage runs via a different pipeline (the Dreamer subprocess). The handshake between Sage's outputs and CD's inputs works on cold start only (user.md gets loaded) — mid-session changes don't reach CD. Same underlying issue as D2.

---

## F. Question answers carried from 14A planning

From the WP-14 plan ("open questions" section):

- **"CD briefing channel"** → Recommendation: use `public/{sessionId}/CD-INBOX.md` (new file) as the append-only event log, read-and-cleared by `chat-stream/route.ts` on every user turn. Not the chat-stream route itself (that would mean fake user messages), not a dedicated endpoint (needless complexity). An append-only file has the virtue that the Briefing bridge doesn't need a new push primitive — it reads disk on every turn anyway.
- **Where CD image commentary surfaces** → Recommendation: for proactive notifications (D2), inside the Briefing chat as CD's next response. For Ask CD (D1/D5), in Zone 3 inline feedback (unchanged).

---

## G. Proposed 14B/C/D scope (for Ralph's greenlight)

| Sub-WP | Deliverable | Est. |
|--------|-------------|------|
| **14B** | Event pipeline (D2) + CD Activity log (D3). `CD-INBOX.md` read-and-clear in chat-stream. Event pushers in edit-image, upload, vibe-build, hot-swap. `appendCDActivity` helper. | 1 session |
| **14C** | Visible errors + retry + timeouts across all CD call sites (D4). | 0.5 session |
| **14D** | Ask CD context template (D5) + session-file injection (D1 Option A). Pull user portrait + brand brief + recent gens into Ask CD prompt. Keep model as Sonnet. | 0.5 session |

**Total remaining after audit: ~2 sessions.** Matches the original WP-14 estimate.

---

## Open questions for Ralph

1. **Unify the two CDs or leave them separate?** Option A (thin) vs B (bridge-through). Default: A.
2. **CD-INBOX read-and-clear timing** — on every user turn (simplest) or explicit "catch up" action? Default: every turn.
3. **What belongs in SESSION.md `## CD Activity`?** Every response (verbose), or only decisions + triggers (curated)? Default: curated.
4. **Should Ask CD surface a "more context next time" hint when it declines to answer?** E.g., "I don't have vibe context here — ask this in Briefing for better answers."

No blockers on any of these — sensible defaults exist. Call them out before 14B starts if different choices are preferred.
