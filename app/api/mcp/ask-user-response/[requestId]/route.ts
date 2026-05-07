/**
 * /api/mcp/ask-user-response/[requestId] — frontend → backend resolver.
 *
 * The frontend modal POSTs the user's choice here. We deliver it to the
 * pending Promise (registered by /api/mcp/ask-user) which unblocks the
 * agent's tool call.
 *
 * Returns 404 if the requestId is unknown — already resolved, expired, or
 * was never registered. The frontend should treat that as a no-op (the
 * modal closes on its own when the cancel sentinel fires).
 */

import { NextRequest, NextResponse } from 'next/server'
import { deliverChoice } from '@/lib/ask-user-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await ctx.params
  if (!requestId) {
    return NextResponse.json({ ok: false, error: 'requestId required' }, { status: 400 })
  }

  const body = (await req.json().catch(() => null)) as { value?: string } | null
  if (!body?.value || typeof body.value !== 'string') {
    return NextResponse.json({ ok: false, error: 'value required' }, { status: 400 })
  }

  const delivered = deliverChoice(requestId, body.value)
  if (!delivered) {
    return NextResponse.json(
      { ok: false, error: 'unknown or expired requestId' },
      { status: 404 },
    )
  }

  return NextResponse.json({ ok: true })
}
