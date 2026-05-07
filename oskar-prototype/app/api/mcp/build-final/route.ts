/**
 * /api/mcp/build-final — MCP-tool endpoint for `build_final()`.
 *
 * Phase 2.5 (Ralph 2026-04-30): escrowed. Returns {jobId, status:'running'}
 * in <100ms; the actual /api/webdev call runs in the background.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/event-bus'
import { enqueueBuild, withWebdevMutex } from '@/lib/build-escrow'
import { resolveWebDevExecution } from '@/lib/session-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { sessionId, mode: bodyMode, model: bodyModel } = (await req.json()) as {
    sessionId?: string
    mode?: 'smpl' | 'cli' | 'api'
    model?: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'gemini-3.1-pro-preview'
  }
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  // Phase 2 toggle wiring (Ralph 2026-05-04). See build-vibe/route.ts.
  const { mode, model } = resolveWebDevExecution({ mode: bodyMode, model: bodyModel }, sessionId)

  const enqueued = enqueueBuild({
    sessionId,
    kind: 'build_final',
    runner: () => withWebdevMutex(sessionId, async () => {
      publish(sessionId, { type: 'build_started', mode: 'final' })

      // Stage transition queued → html (Ralph 2026-05-06): the moment the
      // mutex grants us a slot we're calling /api/webdev — the agent is
      // running. Build-final has only one row, target='final'. The
      // 'verify' / 'done' transitions land via /api/webdev's own publish
      // path (which fires vibe_built on success).
      publish(sessionId, { type: 'build_progress', target: 'final', stage: 'html' })

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
      const resp = await fetch(`${baseUrl}/api/webdev`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, mode: 'final', executionMode: mode, webDevModel: model }),
      })

      let result: { success?: boolean; paths?: { landing?: string }; error?: string }
      try { result = await resp.json() }
      catch { result = { success: false, error: `Bad response from /api/webdev: HTTP ${resp.status}` } }

      if (result.success) {
        publish(sessionId, {
          type: 'vibe_built',
          mode: 'final',
          filename: result.paths?.landing,
          htmlPath: result.paths?.landing,
        })
        return { ok: true as const, result: { paths: result.paths } }
      }

      publish(sessionId, { type: 'build_failed', mode: 'final', error: result.error, level: 'error' })
      return { ok: false as const, error: result.error || 'unknown error' }
    }),
  })

  return NextResponse.json({
    status: enqueued.job.status,
    jobId: enqueued.job.jobId,
    deduped: enqueued.deduped,
    originalStartedAt: enqueued.originalStartedAt,
  })
}
