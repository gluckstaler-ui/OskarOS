/**
 * POST /api/admin/crm/consular/chat  (WP-117)
 *
 * The right-rail Consular chat (OVERVIEW → Chat tab). Conversational, NOT a
 * draft commit: the rep asks strategy / pipeline / "who's gone cold this
 * week?" and the Consular answers in prose. Reuses `callConsularBridge` on
 * the `__crm__` session, so the thread is stateful — it persists across
 * messages until Order 66 cuts the session log.
 *
 * Body `{ message }` → `[OSKAR-SYSTEM ASK-CONSULAR]` → `{ reply }` (the
 * Consular's text). The agent SQL-reads whatever it needs via `crm_query`.
 */

import { readFileSync } from 'fs'
import { NextRequest, NextResponse } from 'next/server'
import { callConsularBridge } from '@/lib/consular-bridge-call'
import { getCrmDeckPath } from '@/lib/memory/paths'
import type { DiscoveryCardPayload, Preamble } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

/**
 * Normalize a captured `tc_discovery` tool input into the DiscoveryCardPayload
 * the studio's <DiscoveryQuestionsCard> renders (the CRM chat IS the studio
 * <ConversationPanel/>, reused 1:1). Mirrors app/page.tsx's `discovery_questions`
 * SSE normalization — defensive, because the bridge forwards the agent's raw
 * tool args opaquely. Returns null when there are no usable questions.
 */
function buildDiscoveryCard(raw: unknown): DiscoveryCardPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const rawQuestions = Array.isArray(p.questions) ? p.questions : []
  const questions = rawQuestions.filter((q: unknown) => {
    if (typeof q === 'string') return q.trim().length > 0
    if (q && typeof q === 'object') return true
    return false
  })
  if (questions.length === 0) return null
  const progressRaw = p.progress as { current?: unknown; total?: unknown } | undefined
  const progress =
    progressRaw && typeof progressRaw.current === 'number' && typeof progressRaw.total === 'number'
      ? { current: progressRaw.current, total: progressRaw.total }
      : undefined
  const preRaw = p.preamble as { label?: unknown; body?: unknown } | undefined
  const preamble: Preamble | undefined =
    preRaw && typeof preRaw.label === 'string' && typeof preRaw.body === 'string'
      ? { label: preRaw.label, body: preRaw.body }
      : undefined
  return {
    kind: 'discovery_questions',
    questions: questions as DiscoveryCardPayload['questions'],
    preamble,
    context: typeof p.context === 'string' ? p.context : undefined,
    title: typeof p.title === 'string' ? p.title : undefined,
    progress,
  }
}


/**
 * Normalize the Consular's deck JSON into the payload <FlightDeck> consumes.
 * Defensive — the source is a file the agent wrote by hand, so every field is
 * validated. Returns null when there are no usable picks.
 */
function buildFlightDeck(raw: unknown): { pushed: unknown[]; queueCount: number } | null {
  // Pass-through, no validation. `public/__crm__/flight-deck.jsx` is the source
  // of truth for what shapes/fields exist, so we don't strip anything here. If
  // the agent registers a new shape (or adds a new field) in flight-deck.jsx,
  // it flows straight to the renderer with no route change.
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const rawPushed = Array.isArray(p.pushed) ? p.pushed : []
  if (rawPushed.length === 0) return null
  return {
    pushed: rawPushed.slice(0, 6),
    queueCount: typeof p.queueCount === 'number' ? p.queueCount : 0,
  }
}

/**
 * Read the Consular's curated deck from db/flight-deck.json. The Consular writes
 * that file directly with its native Write tool — NO MCP tool, NO iframe; the
 * same file-as-API pattern as db/SESSION.md. The Write resolves inside the
 * agent's turn, so by the time the bridge returns the file is current. Absent /
 * malformed → null (the page falls back to the live overdue-queue baseline).
 */
function readFlightDeck(): { pushed: unknown[]; queueCount: number } | null {
  try {
    return buildFlightDeck(JSON.parse(readFileSync(getCrmDeckPath(), 'utf-8')))
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  let body: { message?: string }
  try {
    body = (await req.json()) as { message?: string }
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400, headers: NO_CACHE })
  }

  const message = (body.message || '').trim()
  if (!message) {
    return NextResponse.json({ error: 'message required' }, { status: 400, headers: NO_CACHE })
  }

  // Conversational tag — the agent file routes [ASK-CONSULAR] to a prose
  // reply when it's a conversation (vs a submit_image_prompt commit when
  // asked to draft).
  const content = `[OSKAR-SYSTEM ASK-CONSULAR]\n\n${message}`

  try {
    // Capture tc_discovery so the Consular can ask the rep structured /
    // multiple-choice questions — the SAME card the studio renders. This is
    // the shared studio card mechanism (CD fires the same tool), so it stays
    // tool-captured. The render + answer-back are free: the CRM chat IS the
    // studio <ConversationPanel/>, whose <DiscoveryQuestionsCard onSubmit>
    // routes answers through handleSend.
    const result = await callConsularBridge(content, { expectedTools: ['tc_discovery'] })
    const card = buildDiscoveryCard(result.toolCalls['tc_discovery'])
    // The deck is NOT a tool — the Consular drives it by writing
    // db/flight-deck.json (file-as-API, no MCP, no iframe). Read it back and
    // hand it to the React panel; it rides ALONGSIDE the prose reply.
    const deck = readFlightDeck()
    return NextResponse.json(
      {
        // Card owns the turn: when a discovery card fires, the card IS the
        // message. Prose alongside a question-card breaks the contract
        // (lib/strip-feedback.ts) — the rep reads the prose and never fills
        // the card. So suppress the text when a card is present.
        reply: card ? '' : (result.text || '(the Consular returned no text)'),
        ...(card ? { card } : {}),
        ...(deck ? { deck } : {}),
        durationMs: result.durationMs,
      },
      { headers: NO_CACHE },
    )
  } catch (err) {
    console.error('[consular/chat] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: `Consular chat failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500, headers: NO_CACHE },
    )
  }
}
