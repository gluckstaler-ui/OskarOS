/**
 * /api/mcp/build-all-vibes — MCP-tool endpoint for `build_all_vibes()`.
 *
 * Phase 2.5 (Ralph 2026-04-30): per CD's review, no umbrella jobId.
 * Instead: enqueue ONE build_vibe job per VIBE-N.md file. Return the
 * array of jobIds to CD. CD can then monitor / retry / cancel each
 * vibe independently — same shape as if she'd fired N build_vibe calls
 * by hand, minus the boilerplate.
 *
 * The route still returns in <100ms — enqueue does not block on runner
 * completion. Each vibe runs sequentially under the hood (avoids
 * parallel WebDev spawns saturating the API), but enqueue order is
 * what CD sees up front.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { parseVibesFromFiles } from '@/lib/creative-brief-parser'
import { runWebDev } from '@/lib/run-webdev'
import { publish } from '@/lib/event-bus'
import { enqueueBuild, withWebdevMutex, type BuildJob } from '@/lib/build-escrow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { sessionId } = (await req.json()) as { sessionId?: string }
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const sessionPath = path.join(process.cwd(), 'public', sessionId)
  const vibes = await parseVibesFromFiles(sessionPath)
  if (vibes.length === 0) {
    publish(sessionId, { type: 'error', message: 'No VIBE-*.md files found', level: 'error' })
    return NextResponse.json({ error: 'No VIBE-*.md files found' }, { status: 400 })
  }

  const buildMdPath = path.join(sessionPath, 'BUILD.md')
  publish(sessionId, { type: 'build_started', mode: 'all', vibeCount: vibes.length })

  // Per-vibe enqueue. Each becomes its own jobId. Dedup means firing
  // build_all_vibes twice in a row coalesces — second call returns the
  // same jobIds (with deduped:true on each).
  const jobs: { jobId: string; target: string; status: string; deduped: boolean; originalStartedAt?: string }[] = []

  for (const vibe of vibes) {
    const target = `vibe-${vibe.index}`
    const enqueued = enqueueBuild({
      sessionId,
      kind: 'build_vibe',
      target,
      // Wrap the runner in the per-session WebDev mutex so all N spawns
      // serialize. CD still sees all N jobIds immediately; only the
      // actual Claude-CLI invocations run one at a time.
      runner: ({ signal }) => withWebdevMutex(sessionId, async () => {
        try {
          const existing = await readFile(buildMdPath, 'utf-8').catch(() => '# Build Log\n')
          await writeFile(
            buildMdPath,
            existing + `\n## [${new Date().toISOString()}] BUILD: target="${target}" (via MCP/all)\n**Status:** BUILDING\n`,
          )
        } catch {}

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
            result: { filename: result.filename, vibeName: result.vibeName, vibeIndex: result.vibeIndex },
          }
        }

        try {
          const cur = await readFile(buildMdPath, 'utf-8')
          await writeFile(buildMdPath, cur + `**Result:** FAILED -- ${result.error}\n`)
        } catch {}
        publish(sessionId, { type: 'vibe_failed', target, error: result.error, level: 'error' })
        return { ok: false as const, error: result.error }
      }),
    })

    jobs.push({
      jobId: enqueued.job.jobId,
      target,
      status: enqueued.job.status,
      deduped: enqueued.deduped,
      originalStartedAt: enqueued.originalStartedAt,
    })
  }

  return NextResponse.json({
    vibeCount: vibes.length,
    jobs,
  })
}
