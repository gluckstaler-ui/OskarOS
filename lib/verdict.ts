// ============================================================================
// lib/verdict.ts — the unified Scout ↔ Kanban verdict vocabulary
// (Ralph 2026-06-10 · TASTED redesign).
//
// ONE tag scale on both surfaces, replacing Scout's derived gap/heat band
// (corrected by Ralph 2026-06-10 — second pass):
//
//   GREEN  · PERSUE      — go now
//   YELLOW · WARMING UP  — heating, not ready to close
//   ORANGE · WATCH       — keep an eye, not ripe
//   RED    · SKIP        — nothing to displace / no felt lack
//
// The tag is WRITTEN by the agent (submit_scout_verdict.verdict_tag) and
// carried into Kanban's intel_json at promote. Color derives from the tag —
// stored once, never twice. The old gap = palate − execution formula is
// RETIRED; legacy rows map heat → tag read-side only.
//
// PALAT (a.k.a. Kanban BUDGET) is the 0–5 affordability band derived from
// the agent's CHF estimate against headcount — code derives, agent never
// writes the band directly. Same helper renders both surfaces.
// ============================================================================

export const VERDICT_TAGS = ['PERSUE', 'WARMING UP', 'WATCH', 'SKIP'] as const
export type VerdictTag = (typeof VERDICT_TAGS)[number]

export const isVerdictTag = (s: unknown): s is VerdictTag =>
  typeof s === 'string' && (VERDICT_TAGS as readonly string[]).includes(s)

/** THE four-value verdict tone — the contract; the tag is the Consular's
 *  words. ONE language across db, frontend and feature-xx.md (Ralph
 *  2026-06-10): stored as good · mid · low · bad, rendered green · phosphor ·
 *  orange · red. Kanban already stores these values in intel_json.verdict_tone;
 *  Scout stores the same in scout_json.taste.verdict_tone. */
export const VERDICT_TONES = ['good', 'mid', 'low', 'bad'] as const
export type VerdictTone = (typeof VERDICT_TONES)[number]

export const isVerdictTone = (s: unknown): s is VerdictTone =>
  typeof s === 'string' && (VERDICT_TONES as readonly string[]).includes(s)

/** House-default tag → tone. FALLBACK ONLY — a stored verdict_tone always
 *  wins (the tag is free text once the Consular writes it). */
export function verdictTagTone(tag: VerdictTag): VerdictTone {
  return tag === 'PERSUE' ? 'good' : tag === 'WARMING UP' ? 'mid' : tag === 'WATCH' ? 'low' : 'bad'
}

/** Legacy Scout heat (pre-redesign rows) → tag, read-side only: hot meant
 *  "go now" → PERSUE; warm → WARMING UP; cold = nothing to displace = SKIP.
 *  WATCH has no legacy source — it's agent-written only. */
export function tagFromLegacyHeat(heat: string | null | undefined): VerdictTag | null {
  return heat === 'hot' ? 'PERSUE' : heat === 'warm' ? 'WARMING UP' : heat === 'cold' ? 'SKIP' : null
}

/**
 * PALAT / BUDGET — the 0–5 affordability band: CHF estimate per head.
 * (chf ÷ heads) banded ≤400→5 · ≤600→4 · ≤800→3 · ≤1000→2 · ≤2000→1 · else 0.
 * Cheaper per head = higher score = easier yes. Null when inputs are missing
 * (un-retasted legacy rows fall back to their stored palate).
 */
export function palateBand(chfEst: number | null | undefined, heads: number | null | undefined): number | null {
  if (typeof chfEst !== 'number' || !Number.isFinite(chfEst) || chfEst <= 0) return null
  const h = typeof heads === 'number' && Number.isFinite(heads) && heads >= 1 ? heads : 1
  const per = chfEst / h
  return per <= 400 ? 5 : per <= 600 ? 4 : per <= 800 ? 3 : per <= 1000 ? 2 : per <= 2000 ? 1 : 0
}

/** Legacy Kanban verdict_budget — the retired LOW/MID/HIGH tier → 0–5 scale
 *  (LOW→1 · MID→3 · HIGH→5); numeric strings/values pass through clamped. */
export function legacyBudgetTo5(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(5, Math.round(v)))
  const s = String(v ?? '').trim()
  if (!s || s === '—') return null
  if (/^low$/i.test(s)) return 1
  if (/^mid$/i.test(s)) return 3
  if (/^high$/i.test(s)) return 5
  const n = Number(s)
  return Number.isFinite(n) ? Math.max(0, Math.min(5, Math.round(n))) : null
}
