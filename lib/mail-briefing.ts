// ==========================================
// POSTMASTER · Consular briefing after a sweep (Filippo 2026-07-13)
//
// Fires ONE bridge call at the end of every sweep with the list of prospect IDs
// that have new inbound mail AND no pending fresh draft. The Consular reads the
// mail itself via SQL, produces a chat report (freeform text), and per prospect
// either commits a draft via `suggest_reply` OR files a decline note.
//
// This is the auto-brief-and-draft flow (PM-3 / EVAL-INBOUND) Filippo asked for
// on 2026-07-13. Not "auto-brief only" — real drafts prefill the composer.
// ==========================================

import { getDb } from './crm-boot'
import { callConsularBridge } from './consular-bridge-call'
import { upsertSuggestion } from './crm-store'

/**
 * Find prospects whose latest E-mail In arrived AFTER their latest email
 * suggestion (or who have no suggestion). Correct gate — the "just has any
 * draft" gate was wrong (stale draft blocks a fresh brief when new mail lands).
 */
export function prospectsNeedingBriefing(): string[] {
  const db = getDb()
  // Prospect IDs with an unanswered fresh inbound: latest 'E-mail In' timestamp
  // is newer than their 'email' suggestion's created_at (or no suggestion exists).
  // Also skip prospects with a recent decline note («Keine Antwort nötig») —
  // that's the Consular's own "I've decided nothing to reply" signal.
  const rows = db.prepare(`
    WITH latest_in AS (
      SELECT prospect_id, MAX(timestamp) AS last_in
      FROM activities
      WHERE type = 'E-mail In' AND soft_deleted = 0
      GROUP BY prospect_id
    ),
    sug AS (
      SELECT prospect_id, created_at FROM suggestions WHERE channel = 'email'
    ),
    decline AS (
      SELECT prospect_id, MAX(timestamp) AS last_decline
      FROM activities
      WHERE type = 'note' AND soft_deleted = 0 AND (notes LIKE '%Keine Antwort nötig%' OR notes LIKE '%Entwurf verworfen%')
      GROUP BY prospect_id
    )
    SELECT latest_in.prospect_id
    FROM latest_in
    LEFT JOIN sug     ON sug.prospect_id     = latest_in.prospect_id
    LEFT JOIN decline ON decline.prospect_id = latest_in.prospect_id
    WHERE (sug.created_at IS NULL OR latest_in.last_in > sug.created_at)
      AND (decline.last_decline IS NULL OR latest_in.last_in > decline.last_decline)
  `).all() as Array<{ prospect_id: string }>
  return rows.map(r => r.prospect_id)
}

/** Persist any `suggest_reply` tool calls the Consular made. */
async function persistSuggestions(toolCalls: Record<string, unknown>): Promise<number> {
  const raw = toolCalls['suggest_reply']
  if (!raw) return 0
  const arr = Array.isArray(raw) ? raw : [raw]
  let persisted = 0
  for (const call of arr) {
    const c = call as { prospect_id?: string; channel?: string; body?: string; subject?: string; in_reply_to?: string }
    if (!c.prospect_id || !c.body) continue
    const channel = c.channel === 'whatsapp' ? 'whatsapp' : 'email'
    try {
      await upsertSuggestion({
        prospect_id: c.prospect_id, channel, body: c.body,
        subject: c.subject ?? null, in_reply_to: c.in_reply_to ?? null,
        actor: 'consular',
      })
      persisted++
    } catch (err) {
      console.warn('[mail-briefing] failed to persist suggestion:', err)
    }
  }
  return persisted
}

export interface BriefingResult {
  prospectIds: string[]
  drafted: number
  chatReport: string
  ms: number
  error?: string
}

/**
 * ONE bridge call per sweep. Directive is the EVAL-INBOUND tag + the list of
 * prospect IDs — the Consular does the rest via SQL/eml reads (per its agent
 * file). Any `suggest_reply` calls are persisted to the suggestions table so
 * the composer prefills on next render.
 */
export async function briefConsular(prospectIds: string[]): Promise<BriefingResult> {
  const start = Date.now()
  if (prospectIds.length === 0) {
    return { prospectIds: [], drafted: 0, chatReport: '', ms: 0 }
  }
  const directive =
    `[OSKAR-SYSTEM EVAL-INBOUND]\n\n` +
    `Prospects with fresh inbound mail — brief and reply per your agent file's EVAL-INBOUND doctrine.\n` +
    `Read each prospect's fresh E-mail In activities via crm_query, decide per prospect: commit a draft via suggest_reply, decline with a one-line note, or silently skip. One chat paragraph summarizing the batch is expected.\n\n` +
    `Prospect IDs:\n` +
    prospectIds.map(id => `- ${id}`).join('\n')

  try {
    const result = await callConsularBridge(directive, { expectedTools: ['suggest_reply'] })
    const drafted = await persistSuggestions(result.toolCalls)
    return { prospectIds, drafted, chatReport: result.text, ms: Date.now() - start }
  } catch (err) {
    return { prospectIds, drafted: 0, chatReport: '', ms: Date.now() - start, error: String(err) }
  }
}
