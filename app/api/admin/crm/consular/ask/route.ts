/**
 * POST /api/admin/crm/consular/ask  (WP-112 + WP-113)
 *
 * The "Ask AI" button in the Send-WhatsApp modal. Mirrors `/api/ask-cd`,
 * pointed at the Consular instead of CD. The rep's field text + the client
 * id go to the Consular; it SQL-reads the client (`crm_query`), drafts in
 * Filippo's voice grounded on what the rep wrote, and commits the message
 * via `submit_image_prompt`.
 *
 * Returns the SAME shape as ask-cd — `{ imagePrompt, feedback }` — so the
 * client wiring is identical to "Ask CD": `imagePrompt` replaces the
 * WhatsApp field, `feedback` is shown in a snackbar. No envelope is built
 * here (WP-111 retired) — the agent self-fetches.
 */

import { NextRequest, NextResponse } from 'next/server'
import { callConsularBridge } from '@/lib/consular-bridge-call'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

interface AskBody {
  prospectId?: string
  prospectName?: string
  /** Whatever the rep typed in the WhatsApp field — a steer, keywords, or a rough draft. */
  draftText?: string
}

export async function POST(req: NextRequest) {
  let body: AskBody
  try {
    body = (await req.json()) as AskBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400, headers: NO_CACHE })
  }

  const { prospectId, prospectName, draftText } = body
  if (!prospectId) {
    return NextResponse.json({ error: 'prospectId required' }, { status: 400, headers: NO_CACHE })
  }

  // The directive — NOT an envelope. The Consular's agent file owns the
  // [OSKAR-SYSTEM ASK-CONSULAR] tag (reads the client, drafts, commits via
  // submit_image_prompt) and the voice/field-exclusion doctrine.
  const content =
    `[OSKAR-SYSTEM ASK-CONSULAR]\n` +
    `prospect_id=${prospectId}` +
    (prospectName ? ` name=${prospectName}` : '') +
    ` channel=whatsapp\n\n` +
    `Draft a WhatsApp message for this client. First SELECT what you need about them ` +
    `(lead row, recent activities, lead_notes, matching voice anchors) via crm_query — ` +
    `never from {first_name} stubs — then write it in Filippo's voice. The rep's steer:\n\n` +
    (draftText && draftText.trim() ? draftText.trim() : '(field empty — open from what you find)') +
    `\n\nCommit the final message with submit_image_prompt. Keep the snackbar note to one line.`

  try {
    const result = await callConsularBridge(content, { expectedTools: ['submit_image_prompt'] })
    const committed = result.toolCalls['submit_image_prompt'] as
      | { prompt?: string; feedback?: string }
      | undefined
    const imagePrompt = committed?.prompt ?? null
    // If the Consular committed a draft, its feedback is the snackbar line.
    // If it replied conversationally instead (no commit), surface that text.
    const feedback = committed?.feedback ?? (imagePrompt ? null : result.text || null)

    return NextResponse.json(
      { imagePrompt, feedback, raw: result.text, durationMs: result.durationMs },
      { headers: NO_CACHE },
    )
  } catch (err) {
    console.error('[consular/ask] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: `Consular draft failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500, headers: NO_CACHE },
    )
  }
}
