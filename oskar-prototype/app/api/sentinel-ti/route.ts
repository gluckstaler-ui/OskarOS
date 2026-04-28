// ═══════════════════════════════════════════════════════════════════════
// /api/sentinel-ti  —  POST endpoint that streams Sentinel Ti's critique
// back to the caller via SSE.
//
// Body: { sessionId: string, target: string }
//
// SSE events:
//   data: {"type":"text","content":"..."}
//   data: {"type":"complete","reportPath":"..."}
//   data: {"type":"error","error":"..."}
// ═══════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { runSentinelTi } from '@/lib/sentinel-ti'

export async function POST(req: NextRequest) {
  let body: { sessionId?: string; target?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    )
  }

  const { sessionId, target } = body
  if (!sessionId) {
    return NextResponse.json(
      { error: 'sessionId required' },
      { status: 400 },
    )
  }

  const sessionPath = path.join(process.cwd(), 'public', sessionId)
  const finalTarget = target || 'brief'

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: { type: string; [k: string]: any }) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          )
        } catch {
          /* controller already closed */
        }
      }

      // Tell the client we've started — useful for the modal "thinking" state
      send({ type: 'start', target: finalTarget, sessionId })

      try {
        const result = await runSentinelTi({
          sessionId,
          sessionPath,
          target: finalTarget,
          onText: (chunk) => send({ type: 'text', content: chunk }),
        })

        if (result.status === 'complete') {
          send({
            type: 'complete',
            reportPath: result.reportPath,
            length: result.reportText?.length ?? 0,
          })
        } else {
          send({ type: 'error', error: result.error || 'Unknown error' })
        }
      } catch (err) {
        send({ type: 'error', error: String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
