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

  // Phase 2 toggle wiring (Ralph 2026-05-04). See build-vibe/route.ts for
  // the rationale — the hardcoded mode:'cli', model:'claude-sonnet-4-6'
  // made the TopBar pill purely cosmetic.
  const { mode, model } = resolveWebDevExecution({ mode: bodyMode, model: bodyModel }, sessionId)

  const sessionPath = path.join(process.cwd(), 'public', sessionId)
  const vibes = await parseVibesFromFiles(sessionPath)
  if (vibes.length === 0) {
    publish(sessionId, { type: 'error', message: 'No VIBE-*.md files found', level: 'error' })
    return NextResponse.json({ error: 'No VIBE-*.md files found' }, { status: 400 })
  }

  const buildMdPath = path.join(sessionPath, 'BUILD.md')
  // Ship enriched row metadata so the live BuildJobCard mounts with names +
  // optional thumbs from the vibe's hero image, instead of empty placeholders.
  // (CD 2026-05-06: live card looked barren next to the mockup because rows
  // had only id+state; vibes[] is right here, costs nothing to forward.)
  // Hero-image discovery (CD 2026-05-06): VIBE-N.md image manifests use
  // a markdown table — `| Hero | \`hero-night.jpeg\` | description |` —
  // so a markdown-image-syntax regex misses them entirely. Match the
  // table-cell shape FIRST, fall back to bullet / md-image / first-image
  // shapes so older vibes still work.
  const HERO_PATTERNS: RegExp[] = [
    // 1. Table row: | Hero | `file.jpg` | ...
    /\|\s*Hero[^\|]*\|\s*`?\s*([^`\s|][^`|]*?\.(?:jpg|jpeg|png|webp|gif|avif))\s*`?\s*\|/i,
    // 2. Bold-bullet: - **Hero:** file.jpg
    /^\s*-\s+\*\*Hero:?\*\*\s*[`"']?([^\s`"']+\.(?:jpg|jpeg|png|webp|gif|avif))[`"']?/im,
    // 3. Markdown image: ![alt](file.jpg)
    /!\[[^\]]*\]\(([^)]+\.(?:jpg|jpeg|png|webp|gif|avif))\)/i,
    // 4. Last resort — first inline-code filename in the file (often
    //    the hero-image cell in unexpectedly-shaped tables)
    /`([^`\s]+\.(?:jpg|jpeg|png|webp|gif|avif))`/i,
  ]
  const buildRows = vibes.map((v) => {
    const id = `vibe-${v.index}`
    let thumb: string | undefined
    for (const pat of HERO_PATTERNS) {
      const m = v.content.match(pat)
      if (m && m[1]) {
        thumb = `/${sessionId}/${m[1].trim().replace(/^\/+/, '')}`
        break
      }
    }
    return { id, label: v.name, thumb }
  })
  publish(sessionId, {
    type: 'build_started',
    mode: 'all',
    vibeCount: vibes.length,
    rows: buildRows,
  })

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

        // Stage transition queued → html for THIS row (Ralph 2026-05-06).
        // The mutex serializes WebDev spawns, so each iteration here marks
        // the moment its row's runner actually starts — sibling rows stay
        // 'queued' until their turn. Mirror of build-vibe/route.ts.
        publish(sessionId, { type: 'build_progress', target, stage: 'html' })

        // Belt-and-suspenders (Ralph 2026-05-06): catch unhandled throws so
        // the row never hangs in 'html' state. Mirror of build-vibe/route.ts.
        try {
          const result = await runWebDev({
            mode,
            model,
            sessionId,
            sessionPath,
            target,
            abortSignal: signal,
            // Mirror build-vibe/route.ts — forward WebDev's progress tool
            // calls onto the SSE bus so the BuildJobCard row can flip
            // through queued → html → verify in real time.
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

            // Real verify pass (mirror of build-vibe/route.ts). Scans
            // <img src=...> refs in the rendered HTML against on-disk
            // assets, posts a milestone with the verdict. Soft-warn on
            // broken refs — does not fail the build.
            publish(sessionId, { type: 'build_progress', target, stage: 'verify' })
            try {
              const { existsSync } = await import('fs')
              const htmlPath = path.join(sessionPath, result.filename)
              if (existsSync(htmlPath)) {
                const html = await readFile(htmlPath, 'utf-8')
                const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
                const brokenRefs: string[] = []
                for (const m of imgMatches) {
                  const src = m[1]
                  if (!src) continue
                  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) continue
                  const stripped = src.replace(/^\//, '').split('?')[0]
                  const sessionRel = stripped.startsWith(`${sessionId}/`)
                    ? stripped.slice(sessionId.length + 1)
                    : stripped
                  const fullPath = path.join(sessionPath, sessionRel)
                  if (!existsSync(fullPath)) brokenRefs.push(src)
                }
                if (brokenRefs.length === 0) {
                  publish(sessionId, {
                    type: 'build_progress',
                    target,
                    milestone: `Verified ${imgMatches.length} image refs`,
                  })
                } else {
                  publish(sessionId, {
                    type: 'build_progress',
                    target,
                    milestone: `${brokenRefs.length} broken refs (soft warn): ${brokenRefs.slice(0, 3).join(', ')}${brokenRefs.length > 3 ? '…' : ''}`,
                  })
                }
              }
            } catch {
              // Verify is best-effort — never block vibe_built on it.
            }

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
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[build-all-vibes] runner threw for target="${target}":`, err)
          try {
            const cur = await readFile(buildMdPath, 'utf-8')
            await writeFile(buildMdPath, cur + `**Result:** THREW -- ${msg}\n`)
          } catch {}
          publish(sessionId, { type: 'vibe_failed', target, error: `runner threw: ${msg}`, level: 'error' })
          return { ok: false as const, error: msg }
        }
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
