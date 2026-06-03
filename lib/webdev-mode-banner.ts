/**
 * Ralph 2026-05-18 (Job-Card Ladder Fix — phase-flag plumb-through):
 *
 * Extracted into its own file to avoid a circular import between
 * `lib/run-webdev.ts` (the API-mode runner) and `lib/webdev.ts` (the
 * CLI-mode Claude / Gemini runners). Both call buildModeBanner() at
 * the top of their per-build user prompt assembly; run-webdev.ts also
 * imports buildVibeHTML / buildVibeHTMLGemini from webdev.ts, so the
 * banner cannot live in either of them without a cycle.
 *
 * The banner is the agent's STATIC signal about whether it's doing a
 * wireframe build (Phase 7 required, `build_progress({stage:"critique"})`
 * mandatory) or a vibe build (Phase 7 skipped). Before this, the agent
 * had to infer mode from spec content — observed in E2E (2026-05-18,
 * session 2026-05-16-1) to silently short-circuit Phase 2/6/7 when an
 * existing HTML was found on disk for 2 of 3 wireframe builds.
 */

export function buildModeBanner(hasCritique?: boolean): string {
  if (hasCritique) {
    return `# ⚑ BUILD MODE: WIREFRAME (5-stage ladder, Phase 7 REQUIRED)

You were spawned by \`build_wireframes\` — NOT \`build_vibe\`. The job-card
row has \`hasCritique: true\`; the ladder is queued → html → verify →
**critique** → done. The orchestrator is WAITING for your critique-stage
event to advance the row off \`verify\`.

**MANDATORY actions you cannot skip, even if an HTML file already exists:**

1. **Phase 2** — add the Self-Critique + Direction Banner surface
   skeletons per \`skills/references/wireframe-surfaces.md\`. If you see an
   existing HTML without \`.critique\` CSS / \`.wf-marker\` / a radar
   \`<polygon>\`, the file is INCOMPLETE — Phase 2 still applies.
2. **Phase 6** — fire \`build_progress({stage: "verify", milestone})\`,
   take a screenshot, render-check.
3. **Phase 7 — FIRST ACTION:** before reading the screenshot, before
   filling any polygon points, before any FileEdit on the surfaces,
   call:

       build_progress({stage: "critique", milestone: "Filling in-page critique surfaces"})

   This is non-optional. The job-card row will hang forever on
   \`verify\` if you skip this fire. Closure routes the event — do NOT
   put slug or filename in the payload.
4. **Phase 7 — fill the surfaces.** Polygon points, composite score,
   KEEP / FIX / QUICK-WINS lists. Score the SHIPPED artifact, not the
   intent.

**Fast-path / short-circuit on existing files is FORBIDDEN in wireframe
mode.** A previous build's HTML without Phase 2 skeletons is an
incomplete build, not a done one. Treat it as a rebuild from Phase 2
forward.

---`
  }
  return `# ⚑ BUILD MODE: VIBE (4-stage ladder, Phase 7 SKIPPED)

You were spawned by \`build_vibe\`. The job-card row has \`hasCritique:
false\`; the ladder is queued → html → verify → done. **Skip Phase 7
entirely.** Do NOT add Self-Critique surfaces, do NOT fire
\`build_progress({stage: "critique"})\`. Verify (Phase 6) is the last
stage before \`build_done\`.

---`
}
