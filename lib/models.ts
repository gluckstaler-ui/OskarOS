// ============================================================================
// lib/models.ts — THE single source of truth for which model powers what.
// One model, one place. (Ralph 2026-06-10)
//
// RULES enforced by this module:
//   1. Bare wire ids ONLY — never the `[1m]` suffix. The 1M context window is
//      VERIFIED at runtime by the bridge's re-roll probe (bridge-process-manager
//      reads the wire-reported `result.modelUsage[model].contextWindow` and
//      re-rolls a fresh SIGKILL'd spawn until it's ≥1M). 1M is a fact we MEASURE,
//      not a suffix we DECORATE. A `[1m]` string is Potemkin — it cannot demote-
//      proof anything, and it silently disabled the probe via `endsWith('[1m]')`.
//   2. Switching the big agent (CD in Studio, Consular in CRM) = change ONE
//      value (`DEFAULT_BRAIN`, or the badge, which writes it to session config).
//      No model literal lives anywhere else.
// ============================================================================

/** The models the big agent (CD in Studio, Consular in CRM) can run. Badge
 *  order = this order. Gemini is a brain since 2026-10-26 (Ralph: the GEMINI
 *  position switches everything to Gemini), run by the Antigravity CLI. */
export type BrainModel = 'fable' | 'opus' | 'gemini'

/** The TopBar model selector is ONE switch — one state variable, exactly one
 *  position lit, every position reachable, every flip written to session config.
 *  Each position is a complete PRESET over (brain, padawan model). Padawans =
 *  the worker agents (WebDev, Sage, Sage-240); Sonnet is their default model:
 *    fable  → Fable brain,  Sonnet padawans
 *    opus   → Opus brain,   Sonnet padawans
 *    gemini → Gemini brain, Gemini padawans — everything on Gemini 4 Argon
 *             (Ralph 2026-10-26; until then the brain stayed Opus).
 *  Never two lit. The preset map below is the single source for the mapping. */
export type ModelSwitch = BrainModel

export interface ModelSpec {
  /** Wire id passed to `--model` (Claude Code CLI) or the runner. BARE. */
  id: string
  /** Badge label. */
  label: string
}

// Current generation per the Claude API model table (2026-10-22): Fable 5.1,
// Opus 5.5, Sonnet 5.5, Haiku 5.5. Bare ids, no date suffix.
// Gemini (Ralph 2026-10-26): Gemini 4 Argon through the Antigravity CLI (`agy`, lib/bridge-process-manager.ts);
// the id is agy's model slug (`agy models`), effort included.
export const BRAIN_MODELS = {
  fable:  { id: 'claude-fable-5-1',   label: 'Fable' },
  opus:   { id: 'claude-opus-5-5',    label: 'Opus' },
  gemini: { id: 'gemini-4-argon-high', label: 'Gemini' },
} as const satisfies Record<BrainModel, ModelSpec>

/** Does this wire id run on the Antigravity CLI instead of the Claude CLI? */
export const isAgyModel = (id: string | undefined): boolean => !!id && /^gemini-/.test(bareModelId(id))

/** Union of the bare wire ids — DERIVED from the registry, so the CdModel type
 *  (and anything else that lists ids) can never drift from BRAIN_MODELS. */
export type BrainId = (typeof BRAIN_MODELS)[BrainModel]['id']

/** The ONE default brain. Flip this single value to move CD + Consular.
 *  Back to 'fable' on 2026-07-03 — Fable 5 returned as a big-brain model
 *  (Fable 5.1 since 2026-10-22).
 *  (Was 'opus' from 2026-06-13 while Fable 5 access was suspended.) */
export const DEFAULT_BRAIN: BrainModel = 'fable'

// Generic so `.id` keeps its literal type (a BrainId), not widened to `string`.
export function brainSpec<B extends BrainModel>(b: B): (typeof BRAIN_MODELS)[B] {
  return BRAIN_MODELS[b]
}
export const isBrainModel = (s: string): s is BrainModel => s in BRAIN_MODELS

/** Padawan wire ids (rule 2: no model literal anywhere else). Sonnet is the
 *  padawan default (WebDev, Sage, Sage-240); Gemini replaces it under the
 *  gemini preset. session-config's WebDevModel union carries the same ids.
 *  Gemini = Gemini 4 Argon through the Antigravity CLI (agy's model slug, lib/agy.ts), like the Gemini brain
 *  (Ralph 2026-10-26: WebDev via agy, not Vertex). */
export const SONNET_WEBDEV_ID = 'claude-sonnet-5-5'
export const GEMINI_WEBDEV_ID = 'gemini-4-argon-high'

/** Haiku wire id, for small/fast jobs. Nothing imports it yet. */
export const HAIKU = 'claude-haiku-5-5'

/** What each switch position writes to session config — brain (cdModel via
 *  brainSpec) + padawan model (webDevModel, read per-build by the MCP build
 *  routes through resolveWebDevExecution). THE mapping; nothing else derives it. */
export const MODEL_SWITCH_PRESETS = {
  fable:  { brain: 'fable', webDevModel: SONNET_WEBDEV_ID },
  opus:   { brain: 'opus',  webDevModel: SONNET_WEBDEV_ID },
  gemini: { brain: 'gemini', webDevModel: GEMINI_WEBDEV_ID },
} as const satisfies Record<ModelSwitch, { brain: BrainModel; webDevModel: typeof SONNET_WEBDEV_ID | typeof GEMINI_WEBDEV_ID }>

export const isModelSwitch = (s: string): s is ModelSwitch => isBrainModel(s)

/** Session config → switch position (hydration). Brain is the senior fact:
 *  a Fable or Gemini cdModel reads FABLE or GEMINI regardless of padawans; an
 *  Opus (or 'auto', which resolves to stock Opus) cdModel reads OPUS. Total over
 *  legacy off-preset configs — the first flip normalizes. */
export function switchFromConfig(cdModel: string, webDevModel: string | undefined): ModelSwitch {
  void webDevModel
  const brain = brainFromId(cdModel)
  return brain === 'fable' || brain === 'gemini' ? brain : 'opus'
}

/** Wire id (with or without a stray `[1m]`) → brain key, or null if not a brain model. */
export function brainFromId(id: string): BrainModel | null {
  const bare = id.replace(/\[1m\]$/, '')
  for (const k of Object.keys(BRAIN_MODELS) as BrainModel[]) {
    if (BRAIN_MODELS[k].id === bare) return k
  }
  return null
}

/** Strip the CLI-only `[1m]` alias suffix → the bare wire id. The Anthropic API
 *  REJECTS `[1m]` (it's a Claude Code CLI alias, not an API identifier); the bridge
 *  re-roll verifies the real 1M window from the wire regardless. Normalize at every
 *  model-resolution site so a stale `[1m]` left in an on-disk session config (from
 *  the pre-2026-06-10 billing-mode writer) can't 404 the direct-API path. */
export function bareModelId(id: string): string {
  return id.replace(/\[1m\]$/, '')
}

/** Family token of a model id — 'fable' | 'mythos' | 'opus' | 'sonnet' | 'haiku',
 *  or the bare id when no known family matches (e.g. a glm-* reroute).
 *  Used by the substitution tripwire (Ralph 2026-08-06): Fable 5 requests can be
 *  silently re-run on an Opus model (classifier fallback) — the swap is visible
 *  ONLY in the per-response `message.model` label. Family comparison is deliberate:
 *  version numbers and the `[1m]` suffix must not trigger it; a cross-family
 *  divergence (fable→opus, claude→glm) always must.
 *  NOTE `[1m]` is Opus-4.6-only (its 1M-window alias); no other model carries or
 *  needs it. bareModelId strips it either way, so a request on `opus-4-6[1m]`
 *  served as bare `opus-4-6` stays same-family (no false fire) — while the swap
 *  that MATTERS, fable→opus (the classifier fallback), still fires. */
export function modelFamily(id: string): string {
  const base = bareModelId(id).toLowerCase()
  for (const fam of ['fable', 'mythos', 'opus', 'sonnet', 'haiku', 'gemini'] as const) {
    if (base.includes(fam)) return fam
  }
  return base
}
