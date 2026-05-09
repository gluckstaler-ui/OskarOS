/**
 * /api/mcp/build-final — MCP-tool endpoint for `build_final()`.
 *
 * Routes through runWebDev (Claude / Gemini / API). Same escrow + event-bus
 * contract as build-vibe. WP-67 (Ralph 2026-05-09).
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { runWebDev } from '@/lib/run-webdev'
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

  const { mode, model } = resolveWebDevExecution({ mode: bodyMode, model: bodyModel }, sessionId)
  const sessionPath = path.join(process.cwd(), 'public', sessionId)
  const buildMdPath = path.join(sessionPath, 'BUILD.md')
  const target = 'final'

  const enqueued = enqueueBuild({
    sessionId,
    kind: 'build_final',
    runner: ({ signal }) => withWebdevMutex(sessionId, async () => {
      // Audit log
      try {
        const existing = await readFile(buildMdPath, 'utf-8').catch(() => '# Build Log\n')
        await writeFile(
          buildMdPath,
          existing + `\n## [${new Date().toISOString()}] BUILD: target="final" (via runWebDev)\n**Status:** BUILDING\n`,
        )
      } catch {}

      publish(sessionId, { type: 'build_started', mode: 'final' })
      publish(sessionId, { type: 'build_progress', target, stage: 'html' })

      try {
        const result = await runWebDev({
          mode,
          model,
          sessionId,
          sessionPath,
          target,
          abortSignal: signal,
          onToolCall: (toolName, input) => {
            if (toolName !== 'report_build_progress') return
            const stage = typeof input?.stage === 'string' ? input.stage : undefined
            const milestone = typeof input?.milestone === 'string' ? input.milestone : undefined
            if (stage === 'html' || stage === 'verify') {
              publish(sessionId, { type: 'build_progress', target, stage, milestone })
            } else if (milestone) {
              publish(sessionId, { type: 'build_progress', target, milestone })
            }
          },
        })

        if (result.status === 'complete') {
          try {
            const cur = await readFile(buildMdPath, 'utf-8')
            await writeFile(buildMdPath, cur + `**Result:** COMPLETE -> ${result.filename}\n`)
          } catch {}

          // Verify pass — same best-effort posture as build-vibe
          publish(sessionId, { type: 'build_progress', target, stage: 'verify' })

          publish(sessionId, {
            type: 'vibe_built',
            mode: 'final',
            filename: result.filename,
            htmlPath: `/${sessionId}/${result.filename}`,
          })
          return { ok: true as const, result: { filename: result.filename } }
        }

        try {
          const cur = await readFile(buildMdPath, 'utf-8')
          await writeFile(buildMdPath, cur + `**Result:** FAILED -- ${result.error}\n`)
        } catch {}
        publish(sessionId, { type: 'build_failed', mode: 'final', error: result.error, level: 'error' })
        return { ok: false as const, error: result.error }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[build-final] runner threw:`, err)
        try {
          const cur = await readFile(buildMdPath, 'utf-8')
          await writeFile(buildMdPath, cur + `**Result:** THREW -- ${msg}\n`)
        } catch {}
        publish(sessionId, { type: 'build_failed', mode: 'final', error: `runner threw: ${msg}`, level: 'error' })
        return { ok: false as const, error: msg }
      }
    }),
  })

  return NextResponse.json({
    status: enqueued.job.status,
    jobId: enqueued.job.jobId,
    deduped: enqueued.deduped,
    originalStartedAt: enqueued.originalStartedAt,
  })
}
