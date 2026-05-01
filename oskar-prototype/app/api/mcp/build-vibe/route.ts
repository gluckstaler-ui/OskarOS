/**
 * /api/mcp/build-vibe — MCP-tool endpoint for `build_vibe(name)`.
 *
 * Phase 2.5 (Ralph 2026-04-30): converted from synchronous to escrowed.
 * The route enqueues runWebDev as a background job and returns
 * {jobId, status:'running'} to CD in <100ms. CD polls via job_status.
 *
 * Same publish() events fire (build_started → vibe_built / vibe_failed)
 * — the escrow runner emits them at the same lifecycle points the
 * synchronous version did. The frontend Assets-panel + snackbar pipeline
 * is unchanged.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { runWebDev } from '@/lib/run-webdev'
import { publish } from '@/lib/event-bus'
import { enqueueBuild } from '@/lib/build-escrow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { sessionId, target } = (await req.json()) as { sessionId?: string; target?: string }
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  if (!target) return NextResponse.json({ error: 'target required' }, { status: 400 })

  const sessionPath = path.join(process.cwd(), 'public', sessionId)
  const buildMdPath = path.join(sessionPath, 'BUILD.md')

  const enqueued = enqueueBuild({
    sessionId,
    kind: 'build_vibe',
    target,
    runner: async ({ signal }) => {
      // Audit-log entry mirroring the legacy synchronous shape.
      try {
        const existing = await readFile(buildMdPath, 'utf-8').catch(() => '# Build Log\n')
        await writeFile(
          buildMdPath,
          existing + `\n## [${new Date().toISOString()}] BUILD: target="${target}" (via MCP escrow)\n**Status:** BUILDING\n`,
        )
      } catch {}

      publish(sessionId, { type: 'build_started', target })

      // Pass the abort signal so cancel_job propagates to the WebDev child.
      const result = await runWebDev({
        mode: 'cli',
        model: 'claude-sonnet-4-6',
        sessionId,
        sessionPath,
        target,
        abortSignal: signal,
      })

      if (result.status === 'complete') {
        try {
          const cur = await readFile(buildMdPath, 'utf-8')
          await writeFile(buildMdPath, cur + `**Result:** COMPLETE -> ${result.filename}\n`)
        } catch {}
        publish(sessionId, {
          type: 'vibe_built',
          vibeIndex: result.vibeIndex,
          vibeName: result.vibeName,
          filename: result.filename,
          htmlPath: `/${sessionId}/${result.filename}`,
        })
        return {
          ok: true as const,
          result: {
            filename: result.filename,
            vibeName: result.vibeName,
            vibeIndex: result.vibeIndex,
          },
        }
      }

      try {
        const cur = await readFile(buildMdPath, 'utf-8')
        await writeFile(buildMdPath, cur + `**Result:** FAILED -- ${result.error}\n`)
      } catch {}
      publish(sessionId, {
        type: 'vibe_failed',
        target,
        error: result.error,
        level: 'error',
      })
      return { ok: false as const, error: result.error }
    },
  })

  return NextResponse.json({
    status: enqueued.job.status, // 'running' (or whatever the dedup return surfaces)
    jobId: enqueued.job.jobId,
    target,
    deduped: enqueued.deduped,
    originalStartedAt: enqueued.originalStartedAt,
  })
}
