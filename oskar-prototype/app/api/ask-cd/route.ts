/**
 * /api/ask-cd — refactored 2026-04-17 for WP-15
 *
 * Pre-WP-15 this route called a stateless Sonnet 4.6 instance via
 * `callAnthropic`. That was Little CD — different model from Briefing's
 * Big CD, no session memory, no shared identity. Per WP-15 §"no anonymous
 * spawns," all CD interactions must go through the SAME Briefing bridge.
 *
 * This route now sends `[OSKAR-SYSTEM ASK-CD]` to the bridge and parses
 * CD's reply. CD recognizes the tag (per agent file) and replies
 * conversationally. The reply lands as a snackbar in Image Mode AND in
 * the chat log per WP-15 rule 8.
 *
 * Backward compat: the response shape (`imagePrompt` + `feedback` + `tier`)
 * is preserved so `AdvancedMode.handleAskCD` keeps working without changes.
 * `imagePrompt` is non-empty when CD's reply contains a `## IMAGE PROMPT`
 * block — this is rare with the new free-form contract but we keep the
 * extractor so the old flow degrades gracefully.
 */

import { NextRequest, NextResponse } from 'next/server'
import { callCDBridge } from '@/lib/cd-bridge-call'
import { buildCDContext } from '@/lib/cd-context'
import { parseCDResponse, type CDParsedResponse } from '@/lib/cd-response-parser'
import { logToChat } from '@/lib/chat-logger'

export interface AskCDRequestBody {
  source: 'advanced-mode'
  mode: 'generate' | 'edit' | 'compose' | 'layout'
  image?: { filename: string; description: string }
  currentPrompt: string
  stagedImages?: { scene?: string; subjects?: string[]; slots?: string[] }
  userMessage: string
  /** Required for the bridge call. Older callers may not pass this — we
   *  return an error in that case rather than spawning anonymously. */
  sessionId?: string
}

export async function POST(req: NextRequest) {
  const requestId = Date.now()

  try {
    const body = (await req.json()) as AskCDRequestBody

    if (!body.userMessage?.trim()) {
      return NextResponse.json({ error: 'No message provided' }, { status: 400 })
    }
    if (!body.sessionId) {
      // WP-15: no anonymous spawns. Without sessionId we have no bridge to talk to.
      return NextResponse.json(
        { error: 'sessionId required (WP-15: Big CD only — no stateless fallback)' },
        { status: 400 }
      )
    }

    console.log(
      `[ask-cd ${requestId}] mode=${body.mode} image=${body.image?.filename || 'none'} msg="${body.userMessage.slice(0, 80)}"`
    )

    const tagged = await buildAskCDMessage(body)
    const result = await callCDBridge(body.sessionId, tagged)

    if (!result.text) {
      console.error(`[ask-cd ${requestId}] Empty CD reply`)
      return NextResponse.json(
        { error: 'CD did not respond. Try again.' },
        { status: 502 }
      )
    }

    // Use the existing parser so any future `## IMAGE PROMPT` blocks still
    // route to Zone 4. With the WP-15 conversational contract most replies
    // won't have one — the parser falls through to tier 5 and returns the
    // raw text as `feedback`.
    const parsed: CDParsedResponse = parseCDResponse(result.text)

    console.log(
      `[ask-cd ${requestId}] tier=${parsed.tier} promptLen=${parsed.imagePrompt?.length || 0} feedbackLen=${parsed.feedback?.length || 0} ${result.durationMs}ms`
    )

    // ── WP-15 rule 8 (paper-trail): Ask CD in Image Mode logs BOTH the
    // user message AND CD's reply to SESSION.md §"CD Activity". Snackbar
    // is the immediate signal; the chat log is the audit trail. Without
    // this, Ask CD interactions vanish after the snackbar dismisses.
    try {
      await logToChat(body.sessionId, {
        kind: 'user',
        content: body.userMessage,
        source: `image-mode:${body.mode}`,
        ref: body.image?.filename,
      })
      await logToChat(body.sessionId, {
        kind: 'cd-reply',
        content:
          parsed.imagePrompt && (parsed.tier === 1 || parsed.tier === 2)
            ? `**CD committed prompt** (routed to Zone 4):\n\n\`\`\`\n${parsed.imagePrompt}\n\`\`\`\n\n${parsed.feedback ? `**Note:** ${parsed.feedback}` : ''}`
            : parsed.feedback || result.text,
        source: `image-mode:${body.mode}`,
        ref: body.image?.filename,
      })
    } catch (logErr) {
      console.error(`[ask-cd ${requestId}] Chat log write failed:`, logErr)
      // Non-fatal — the response still ships to the client.
    }

    return NextResponse.json(parsed)
  } catch (err) {
    console.error(`[ask-cd ${requestId}] Error:`, err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

/**
 * Build the `[OSKAR-SYSTEM ASK-CD]` payload for Big CD. Includes session
 * context so CD's reply is grounded in the brand brief + recent images.
 */
async function buildAskCDMessage(body: AskCDRequestBody): Promise<string> {
  const ctx = await buildCDContext(body.sessionId!)

  const stagedImagesText = body.stagedImages
    ? buildStagedImagesText(body.stagedImages)
    : ''

  return [
    '[OSKAR-SYSTEM ASK-CD]',
    '',
    `Mode: ${body.mode}`,
    body.image
      ? `Selected image: ${body.image.filename}` +
        (body.image.description ? `\n  Description: ${body.image.description}` : '')
      : 'Selected image: (none)',
    body.currentPrompt.trim()
      ? `Current prompt in Zone 4:\n\`\`\`\n${body.currentPrompt}\n\`\`\``
      : 'Current prompt: (empty)',
    stagedImagesText,
    '',
    '---',
    `User asks: ${body.userMessage}`,
    '',
    ctx.size > 0 ? '---\nContext for your judgment:\n' + ctx.block : '',
    '',
    'Reply conversationally per the SYSTEM MESSAGES protocol in your agent file. Keep it under ~200 words.',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildStagedImagesText(staged: { scene?: string; subjects?: string[]; slots?: string[] }): string {
  const parts: string[] = []
  if (staged.scene) parts.push(`Scene: ${staged.scene}`)
  if (staged.subjects?.length) parts.push(`Subjects: ${staged.subjects.join(', ')}`)
  if (staged.slots?.length) parts.push(`Layout slots: ${staged.slots.join(', ')}`)
  return parts.length ? parts.join('\n') : ''
}
