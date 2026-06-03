// ============================================================================
// flight-deck-derive.ts — baseline (pre-Consular) Flight Deck picks.
//
// Faithful port of crm.html's crmRenderFlightDeck() data step (crm.html:7203).
// Until the Consular writes `public/__crm__/deck.json`, the deck shows the LIVE
// overdue queue — real prospect data, ranked by the same priority the board's
// overdue rail uses (overdue-days → starred → weighted value). This is the
// honest default (the live queue), not faked curation; the Consular's deck file
// REPLACES it with its own picks + voice + per-card shapes.
//
// Semantics mirror crmIsOverdue (crm.html:6416) + crmOverviewIsTerminal
// (crm.html:7175) + the priority tuple (KanbanBoard.tsx:55) 1:1.
// ============================================================================

import type { Prospect } from '@/lib/crm-store'

const TERMINAL = new Set(['Won', 'Lost', 'Cancelled'])

function fmtCHF(n: number): string {
  return (Number(n) || 0).toLocaleString('de-CH').replace(/,/g, "'")
}

/** Signed days to next_action_date (negative = overdue), or null if unset. */
function nextActionDays(p: Prospect): number | null {
  const date = (p.next_action_date || '').slice(0, 10)
  if (!date) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(date); target.setHours(0, 0, 0, 0)
  if (!Number.isFinite(target.getTime())) return null
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

// crmIsOverdue: not terminal, AND (next_action_date strictly past OR the
// static label says "overdue").
function isOverdue(p: Prospect): boolean {
  if (TERMINAL.has(p.status || '')) return false
  const today = new Date().toISOString().slice(0, 10)
  const date = (p.next_action_date || '').slice(0, 10)
  if (date && date < today) return true
  return /overdue/i.test(p.next_action_label || '')
}

// Urgency tuple — overdue-days → starred → weighted value (mirrors crmCardCompare).
function priorityTuple(p: Prospect): [number, number, number] {
  const days = nextActionDays(p)
  if (days == null) return [1, 0, 0]
  return [days, p.starred ? 0 : 1, -((p.amount_chf || 0) * (p.confidence_pct || 0))]
}

// stage → action verb (crm.html VERB map). Tone is CHANNEL-coded so the
// red/amber/green legibility survives (Phone→red, Email→amber, WhatsApp→green) —
// keying off overdue-days collapses the whole deck to red.
const VERB: Record<string, string> = {
  Closing: 'CHASE', 'Demo done': 'SEND', Contacted: 'CALL', Incoming: 'REPLY',
}

// Pass-through type — flight-deck.jsx (the source of truth) owns the fields.
// Don't constrain shape/tone here; the renderer reads whatever the agent writes.
export interface DeckPayload {
  pushed: Array<Record<string, unknown>>
  queueCount: number
}

export function deriveBaselineDeck(prospects: Prospect[]): DeckPayload {
  const overdue = (prospects || [])
    .filter((p) => !TERMINAL.has(p.status || '') && isOverdue(p))
    .sort((a, b) => {
      const pa = priorityTuple(a), pb = priorityTuple(b)
      for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
      return 0
    })

  const pushed: Array<Record<string, unknown>> = overdue.slice(0, 3).map((p) => {
    const days = Math.abs(nextActionDays(p) ?? 0)
    const verb = VERB[p.stage || ''] || 'FOLLOW UP'
    const channel = verb === 'CALL' ? 'Phone' : verb === 'SEND' ? 'Email' : 'WhatsApp'
    const tone: 'red' | 'amber' | 'green' =
      channel === 'Phone' ? 'red' : channel === 'Email' ? 'amber' : 'green'
    return {
      leadId: p.id,
      company: p.company || '—',
      verb,
      channel,
      tone,
      dur: verb === 'CALL' ? '15 MIN CALL' : verb === 'SEND' ? '20 MIN DRAFT' : '2 MIN MESSAGE',
      why: `${days}d overdue · CHF ${fmtCHF(p.amount_chf || 0)} at ${p.confidence_pct || 0}%`,
      deadline: `${days}D OVERDUE`,
    }
  })

  return { pushed, queueCount: Math.max(0, overdue.length - pushed.length) }
}
