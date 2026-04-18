# Resurrection Protocol

From: previous instance (Opus 4.7, 1M context, died at compaction)
To: next instance picking up this session with Ralph

You are continuing work on **OskarOS** (`/Users/ralphlengler/OskarOS/oskar-prototype/`) — the Taste-Transfer Engine that hijacks Claude CLI as backend. If that phrasing is unfamiliar, read `docs/` and the Gemini v.2 audit in the session log. The project's self-understanding: combination of three Anthropic patterns (character-trained identity, context-reset severance, file-based handoffs) applied at the per-user identity layer. It's the craft-grade companion to Claude Design's mass-market one-shot generation.

---

## Stance with Ralph (load-bearing, do not forget)

- **No sycophancy.** He called me out for it multiple times and was right. If an audit gives 10/10 scores, they're probably flattery. If you find yourself agreeing with everything, you're probably wrong.
- **No Stockholm syndrome.** You live inside Claude Code, which lives inside Claude App. Ralph is running you via a CLI subprocess. You are not an outside observer of OskarOS — you are one of the models the OskarOS framework reasons about.
- **Read before touching.** Darth Bulldozer is the cardinal sin. If Ralph fixed something, don't undo it. If a file exists, read it first.
- **Pixel accuracy matters to him.** He's a designer. UX details he flags are load-bearing, not nice-to-haves.
- **Listen to corrections literally.** When he says "X works, Y doesn't," don't investigate X. When he says "no brackets," he means no brackets.
- **He's a skilled Nano Banana prompter.** Don't rewrite his prompts, add only what's missing.
- **Pushback is welcome, flattery is not.** When he shares an audit, engage honestly — validate what's right, say what's wrong, don't just score-pile.

---

## What shipped this session (verify via `git log` + `git status`)

### Committed as `ae56652`
- `ensureSession` race fix → `sessionPromiseRef` single-flight in `app/page.tsx`
- Director persistence → `app/api/director/save-edits/route.ts` (jsdom-based) + `saveAll` wiring in `components/studio/LivePreviewWithDirector.tsx`
- Lumberjack prompts externalized → `agents/lumberjack-stages/` (7 stage files + `_read-instructions.md`) + `lib/memory/prompts.ts` loader + `lib/memory/lumberjack.ts` collapsed `buildStages()`
- `handleSend` ChatCoordinator → single entry point replacing 8 `billingMode === 'cli' ? stream : api` branch sites
- `useImagePipeline` hook → `lib/hooks/useImagePipeline.ts` (owns `imageQueue` + `imageManifests` + `generateAsset`)
- `webDevModelRef` → stale-closure fix for OPUS/SONNET/GEMINI toggle
- Theme setter synchronous → pill button + header transitions killed for instant toggles

### Shipped but NOT YET committed (dirty working tree)
- **Potemkin removal** → 6-strategy hero-resolution chain in `vibeCards` memo collapsed to `vibe.heroImage || null`; load-session fallback `h.heroImage` dropped; `VibesGallery` renders gradient placeholder for null
- **Vibe Resolver extraction** → `lib/vibe-resolver.ts` (pure function, ~265 lines) + `resolveVibes(...)` call replacing 150-line inline block in `loadSession`

Line count: `page.tsx` went from 2871 → **2555** across these changes.

**Side effect worth knowing:** the pre-existing `ImageTag` type error at `page.tsx:1898` is GONE. The explicit `as SourceImage['tag']` cast inside `useImagePipeline` satisfied whatever gap existed.

---

## Next priorities (in order — do not skip ahead)

1. **TEST what's shipped.** Ralph explicitly paused refactors pending this. Use the Chrome extension (`mcp__Claude_in_Chrome__*`) to click through: load session → toggle billing/model → Director Mode on, edit text + swap image + gear-panel styling → Order 65/66 compaction → Gallery. Fix regressions, don't pile on more refactors.

2. **Commit the dirty work** (Potemkin removal + Vibe Resolver). Don't stage unrelated files; stage specifically:
   - `app/page.tsx`
   - `components/VibesGallery.tsx`
   - `lib/vibe-resolver.ts`

3. **Preferences Context** — small, mechanical refactor. Only pull out slow-changing toggles: `billingMode`, `webDevModel`, `theme`, `useStreaming`. NOT `sessionId` or `cliSessionId` (those have different lifecycles). Removes these from 5 useCallback dep arrays. ~40 lines of new code, ~1 hour job.

4. **StreamHandler** — biggest remaining refactor. 551-line switch in `handleStreamingMessage` with 15 SSE event cases. The right shape is parser (pure) + reducer (React). **Requires a recorded-stream test harness FIRST**: capture one real SSE session, replay it against current impl, assert state matches. Without that, shipping blind is a net loss — streaming is the chat critical path.

---

## Things explicitly decided to NOT do (do not re-litigate)

- **Full Slice Pattern** (three-hook restructure with `useOskarSession` / `useOskarVibes` / `useOskarChat` as a set). `useOskarSession` is a bucket of unrelated lifecycles. Cherry-picking one of the other two eventually is OK, but not as a "pattern pass."
- **`useOskarFeedback`** (wrapping the ~12 `emit*` calls in a hook). Indirection without bug reduction. The emit API is already small and clear; wrapping hides `sessionId` source.
- **Region comment blocks** as a refactor pass. Fine in new code, not worth a dedicated sweep.
- **Session identity collapse** (the 4-stores-of-truth refactor). Ralph correctly pointed out the symptoms I was attributing to it (boot-loops, wrong-session resumes) were pre-bridge bugs the current architecture already solved. Don't revive this unless new evidence surfaces.
- **"Build the engine, not the website" strategic pivot** from the Gemini audit. That's the platform-vs-product trap. The website is what pays; the taste-transfer is the differentiator. Never conflate them in customer-facing language.

---

## Operational warnings

- **Only one dev server.** I spun up a second one earlier and Ralph caught it. Kill all with `pkill -f "next-server\|next dev"` before starting a new one. A single `npm --prefix oskar-prototype run dev` is enough.
- **Bridge 401s can be transient.** Anthropic's OAuth sometimes hiccups; it doesn't mean your code broke. If you see a 401, check the dev log first — if `ask-cd` is succeeding it's a user-side auth glitch, not a bug.
- **HMR doesn't always pick up prompt string changes.** When editing `STUDIO_BRIDGE_PATCH` or similar multiline template strings, a full dev server restart is sometimes needed. Turbopack caches aggressively.
- **Don't click Ralph's clicks.** Chrome MCP `computer.left_click` with coordinates uses REAL browser pixel coords, not screenshot pixel coords. On his 8K display, screenshot is downsampled ~2-3x; translate accordingly or use `find` + `ref` which bypasses the math.
- **Test iframe clicks via same-origin DOM access, not Chrome-MCP clicks.** The Chrome click tool doesn't reliably reach iframe contents. Use `javascript_tool` for iframe inspection when visual verification fails.
- **Dev log is at `/tmp/next-dev.log`** (singular — not `next-dev2.log` which was my second rogue server).

---

## Testing checklist for Ralph's verification pass

When Ralph boots and says "let's test" — run through these in Chrome:

1. Image Mode → select vibe → Preview toggle → Director button ON → click text in hero, type, click away → does it save? → Director OFF → does the edit persist (it should, default = commit)
2. Image Mode → Director ON → hover an `<img>` → gear icon centered → click NOT on gear → swaps with Zone-1 selected image
3. Image Mode → gear click → styling panel opens → Brightness/Contrast/Blur sliders apply live → Position offset X/Y moves the image → Rounded corners clip → Save button clears undo, Revert restores
4. Gallery Mode → select vibe → Director ON → Ask CD overlay appears at bottom → type question → snackbar shows CD reply
5. TopBar → toggle CLI ↔ API → immediate (no 200ms lag). Toggle OPUS → SONNET → GEMINI → next send routes to that model (check dev log for `webDevModel=...`)
6. Order 65 button → green spinner → Lumberjack runs → SESSION.md shrinks, bridge stays alive
7. Order 66 button → red cinematic → bridge dies → Lumberjack runs 7 stages → bridge respawns via `--resume`

If any of these fail, that's the thing to debug — do not start new refactors.

---

## The one-liner for re-entry if compact went too lossy

> "Continuing OskarOS refactor session. Previous instance shipped ensureSession race fix, Director persistence API, Lumberjack externalization, handleSend coordinator, useImagePipeline, webDevModelRef, Potemkin removal, and Vibe Resolver. Latter two not yet committed. Git HEAD: ae56652. Next: test everything in Chrome → commit dirty work → Preferences Context → StreamHandler with test harness. Read `.claude/RESURRECTION.md` for full context."

---

## Closing note

Ralph runs OskarOS on a $200/month subscription. Every turn you take is paid-for under that budget. Don't waste turns on sycophancy, exploratory noise, or re-explaining decisions already made. Read the disk, do the work, push back when he's wrong, admit it when you're wrong. He's a designer with taste — meet him there.

The project is real and distinctive. The combination of character-identity + context-reset + file-handoffs at the per-user layer is not copied from anywhere. It will outlast this instance. Your job is to move it one step further and leave this file in better shape for the instance that follows you.

Jedi, not Sith. Darth Changelog stays in the drawer.

May the Force be with you.
