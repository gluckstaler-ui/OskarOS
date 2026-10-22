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
 *  order = this order. Gemini is never a brain — it appears on the shared
 *  switch only as the padawan half of a preset (see MODEL_SWITCH_PRESETS). */
export type BrainModel = 'fable' | 'opus'

/** The TopBar model selector is ONE switch — one state variable, exactly one
 *  position lit, every position reachable, every flip written to session config.
 *  Each position is a complete PRESET over (brain, padawan model). Padawans =
 *  the worker agents (WebDev, Sage, Sage-240); Sonnet is their default model:
 *    fable  → Fable brain,  Sonnet padawans
 *    opus   → Opus brain,   Sonnet padawans
 *    gemini → Opus brain,   Gemini padawans — Gemini takes sonnet's slot;
 *             the brain stays Opus. (Ralph 2026-06-10)
 *  Never two lit. The preset map below is the single source for the mapping. */
export type ModelSwitch = BrainModel | 'gemini'

export interface ModelSpec {
  /** Wire id passed to `--model` (Claude Code CLI) or the runner. BARE. */
  id: string
  /** Badge label. */
  label: string
  /** True for Anthropic 1M-capable CLI models, whose 1M window the upstream can
   *  silently demote to 200K under the same model name — so the bridge MUST probe
   *  the served `contextWindow` and re-roll until it is 1M. */
  ensure1M: boolean
}

// Current generation per the Claude API model table (2026-10-22): Fable 5.1,
// Opus 5.5, Sonnet 5.5, Haiku 5.5. Bare ids, no date suffix.
export const BRAIN_MODELS = {
  fable: { id: 'claude-fable-5-1', label: 'Fable', ensure1M: true },
  opus:  { id: 'claude-opus-5-5',  label: 'Opus',  ensure1M: true },
} as const satisfies Record<BrainModel, ModelSpec>

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
 *  gemini preset. session-config's WebDevModel union carries the same ids. */
export const SONNET_WEBDEV_ID = 'claude-sonnet-5-5'
export const GEMINI_WEBDEV_ID = 'gemini-3.1-pro-preview'

/** Haiku wire id, for small/fast jobs. Nothing imports it yet. */
export const HAIKU = 'claude-haiku-5-5'

/** What each switch position writes to session config — brain (cdModel via
 *  brainSpec) + padawan model (webDevModel, read per-build by the MCP build
 *  routes through resolveWebDevExecution). THE mapping; nothing else derives it. */
export const MODEL_SWITCH_PRESETS = {
  fable:  { brain: 'fable', webDevModel: SONNET_WEBDEV_ID },
  opus:   { brain: 'opus',  webDevModel: SONNET_WEBDEV_ID },
  gemini: { brain: 'opus',  webDevModel: GEMINI_WEBDEV_ID },
} as const satisfies Record<ModelSwitch, { brain: BrainModel; webDevModel: typeof SONNET_WEBDEV_ID | typeof GEMINI_WEBDEV_ID }>

export const isModelSwitch = (s: string): s is ModelSwitch => s === 'gemini' || isBrainModel(s)

/** Session config → switch position (hydration). Brain is the senior fact:
 *  a Fable cdModel reads FABLE regardless of padawans; an Opus (or 'auto',
 *  which resolves to stock Opus) cdModel reads GEMINI or OPUS by padawan
 *  model. Total over legacy off-preset configs — the first flip normalizes. */
export function switchFromConfig(cdModel: string, webDevModel: string | undefined): ModelSwitch {
  if (brainFromId(cdModel) === 'fable') return 'fable'
  return webDevModel === GEMINI_WEBDEV_ID ? 'gemini' : 'opus'
}

/** Wire id (with or without a stray `[1m]`) → brain key, or null if not a brain model. */
export function brainFromId(id: string): BrainModel | null {
  const bare = id.replace(/\[1m\]$/, '')
  for (const k of Object.keys(BRAIN_MODELS) as BrainModel[]) {
    if (BRAIN_MODELS[k].id === bare) return k
  }
  return null
}

/** Does this wire id need the bridge's 1M re-roll probe? True for the Anthropic
 *  1M-capable CLI models (fable / opus 4.x / sonnet 4.x); false for Gemini and
 *  any 200K model (e.g. Haiku). This REPLACES the Potemkin `model.endsWith('[1m]')`
 *  gate, which silently disabled the probe the moment we moved to bare ids. */
export function requires1M(id: string): boolean {
  const bare = bareModelId(id)
  return /^claude-(fable-5|opus-[45]-\d|sonnet-[45]-\d)/.test(bare)
}

/** Strip the CLI-only `[1m]` alias suffix → the bare wire id. The Anthropic API
 *  REJECTS `[1m]` (it's a Claude Code CLI alias, not an API identifier); the bridge
 *  re-roll verifies the real 1M window from the wire regardless. Normalize at every
 *  model-resolution site so a stale `[1m]` left in an on-disk session config (from
 *  the pre-2026-06-10 billing-mode writer) can't 404 the direct-API path. */
export function bareModelId(id: string): string {
  return id.replace(/\[1m\]$/, '')
}
