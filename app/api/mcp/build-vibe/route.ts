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
import { resolveWebDevExecution } from '@/lib/session-config'
import { parseVibesFromFiles } from '@/lib/creative-brief-parser'

// Hero-image regex chain — same set used by build-all-vibes/route.ts.
// Matches the table-cell shape `| Hero | \`file.jpg\` |` first, then
// falls back to bullet / md-image / first-inline-code shapes. Kept
// in sync to avoid the build-all-vibes-shows-thumbs / build-vibe-doesn't
// asymmetry. CD 2026-05-06.
const HERO_PATTERNS: RegExp[] = [
  /\|\s*Hero[^\|]*\|\s*`?\s*([^`\s|][^`|]*?\.(?:jpg|jpeg|png|webp|gif|avif))\s*`?\s*\|/i,
  /^\s*-\s+\*\*Hero:?\*\*\s*[`"']?([^\s`"']+\.(?:jpg|jpeg|png|webp|gif|avif))[`"']?/im,
  /!\[[^\]]*\]\(([^)]+\.(?:jpg|jpeg|png|webp|gif|avif))\)/i,
  /`([^`\s]+\.(?:jpg|jpeg|png|webp|gif|avif))`/i,
]
function findHeroThumb(content: string, sessionId: string): string | undefined {
  for (const pat of HERO_PATTERNS) {
    const m = content.match(pat)
    if (m && m[1]) return `/${sessionId}/${m[1].trim().replace(/^\/+/, '')}`
  }
  return undefined
}

/**
 * Real verify pass (Ralph 2026-05-06): the previous "verify" stage was
 * cosmetic — it animated a dot but did no actual work. This function
 * scans the rendered HTML for `<img src=...>` references and confirms
 * each local path resolves on disk. Returns the count of broken refs +
 * the count of total refs scanned. Best-effort: any throw is caught by
 * the caller and treated as "verify skipped" rather than "build failed".
 *
 * Soft warning posture — broken refs do NOT fail the build (we still
 * publish vibe_built). They surface as a milestone bullet so CD sees
 * the issue without losing the vibe entirely. Hard fail can be added
 * later via lint_brand_compliance gating.
 */
async function verifyVibeAssets(
  sessionPath: string,
  sessionId: string,
  htmlFilename: string,
): Promise<{ imgCount: number; brokenRefs: string[] }> {
  const { existsSync } = await import('fs')
  const htmlPath = path.join(sessionPath, htmlFilename)
  if (!existsSync(htmlPath)) {
    return { imgCount: 0, brokenRefs: [`HTML missing: ${htmlFilename}`] }
  }
  const html = await readFile(htmlPath, 'utf-8')
  const imgMatches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
  const brokenRefs: string[] = []
  for (const m of imgMatches) {
    const src = m[1]
    if (!src) continue
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) continue
    // Strip query string + leading slash, drop session-prefix if present
    const stripped = src.replace(/^\//, '').split('?')[0]
    const sessionRel = stripped.startsWith(`${sessionId}/`)
      ? stripped.slice(sessionId.length + 1)
      : stripped
    const fullPath = path.join(sessionPath, sessionRel)
    if (!existsSync(fullPath)) brokenRefs.push(src)
  }
  return { imgCount: imgMatches.length, brokenRefs }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { sessionId, target, mode: bodyMode, model: bodyModel } = (await req.json()) as {
    sessionId?: string
    target?: string
    mode?: 'smpl' | 'cli' | 'api'
    model?: 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'gemini-3.1-pro-preview'
  }
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  if (!target) return NextResponse.json({ error: 'target required' }, { status: 400 })

  // Phase 2 toggle wiring (Ralph 2026-05-04). Resolve WebDev mode+model:
  // per-request body > session-config file > hardcoded default. The
  // hardcodes used to be `mode:'cli', model:'claude-sonnet-4-6'` —
  // making the TopBar pill purely cosmetic. They're now defaults that
  // get overridden by the user's actual choice.
  const { mode, model } = resolveWebDevExecution({ mode: bodyMode, model: bodyModel }, sessionId)

  const sessionPath = path.join(process.cwd(), 'public', sessionId)
  const buildMdPath = path.join(sessionPath, 'BUILD.md')

  // Resolve label + thumb for the row before publishing build_started.
  // build-all-vibes ships rows[] in the event so the live card mounts
  // with names + thumbs; this route was the asymmetric one — the
  // single-vibe card mounted with no metadata. Same parser, same
  // regex chain. CD 2026-05-06.
  let rowLabel: string | undefined
  let rowThumb: string | undefined
  try {
    const vibes = await parseVibesFromFiles(sessionPath)
    // target may be `vibe-N` or a slug — match against either.
    const matchByIndex = target.match(/^vibe-(\d+)$/i)
    const idx = matchByIndex ? Number(matchByIndex[1]) : null
    const v = idx != null
      ? vibes.find((x) => x.index === idx)
      : vibes.find((x) => x.slug === target.toLowerCase())
    if (v) {
      rowLabel = v.name
      rowThumb = findHeroThumb(v.content, sessionId)
    }
  } catch {
    // Best-effort — if parsing fails, the card still mounts with id
    // only. No reason to block the build on metadata.
  }

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

      publish(sessionId, {
        type: 'build_started',
        target,
        // Single-row payload mirrors build-all-vibes' rows[] shape so
        // the live card can mount with the hero thumb + label instead
        // of an empty-stub row.
        rows: [{
          id: target,
          label: rowLabel ?? '',
          ...(rowThumb ? { thumb: rowThumb } : {}),
        }],
      })

      // Stage transition queued → html (Ralph 2026-05-06): publish the
      // moment the runner is about to spawn the WebDev agent. The 'queued'
      // dot is for the brief window between the card mounting and the
      // worker actually running; once we call runWebDev the agent IS
      // writing, so we flip immediately. The 'verify' transition lives
      // inside lib/webdev.ts / lib/run-webdev.ts at the verify boundary,
      // and 'done' arrives via vibe_built below. This keeps the timeline
      // deterministic — no dependency on the agent calling
      // report_build_progress with a stage field.
      publish(sessionId, { type: 'build_progress', target, stage: 'html' })

      // Pass the abort signal so cancel_job propagates to the WebDev child.
      // onToolCall hook forwards the agent's optional
      // `report_build_progress({milestone})` calls onto the bus as bullet
      // milestones for the single-vibe view. Stage flips are NOT sourced
      // from the agent — see the deterministic publishes above and inside
      // the runner.
      // Belt-and-suspenders (Ralph 2026-05-06): wrap the runner body so a
      // throw from runWebDev still publishes a terminal event. Without this,
      // an unhandled rejection inside the agent loop / spawn / mutex layer
      // returned to the escrow but NEVER fired vibe_built / vibe_failed,
      // leaving the BuildJobCard row stuck in 'html' with the timer ticking
      // forever. The result-branch publishes (success / structured-error)
      // remain primary; this catch only fires for unexpected throws.
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
              // Free-form milestone with no stage — surface as a milestone bullet
              // for single-vibe view; row state unchanged.
              publish(sessionId, { type: 'build_progress', target, milestone })
            }
          },
        })

        if (result.status === 'complete') {
          try {
            const cur = await readFile(buildMdPath, 'utf-8')
            await writeFile(buildMdPath, cur + `**Result:** COMPLETE -> ${result.filename}\n`)
          } catch {}

          // Real verify pass (Ralph 2026-05-06: "verify is not equal to
          // build complete"). The synthetic-stage version was potemkin —
          // visually animated a verify dot that did no work. Now: scan the
          // rendered HTML for broken <img> refs against the session folder,
          // post the verdict as a milestone, then publish vibe_built.
          publish(sessionId, { type: 'build_progress', target, stage: 'verify' })
          try {
            const verdict = await verifyVibeAssets(sessionPath, sessionId, result.filename)
            if (verdict.brokenRefs.length === 0) {
              publish(sessionId, {
                type: 'build_progress',
                target,
                milestone: `Verified ${verdict.imgCount} image refs`,
              })
            } else {
              publish(sessionId, {
                type: 'build_progress',
                target,
                milestone: `${verdict.brokenRefs.length} broken refs (soft warn): ${verdict.brokenRefs.slice(0, 3).join(', ')}${verdict.brokenRefs.length > 3 ? '…' : ''}`,
              })
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[build-vibe] runner threw for target="${target}":`, err)
        try {
          const cur = await readFile(buildMdPath, 'utf-8')
          await writeFile(buildMdPath, cur + `**Result:** THREW -- ${msg}\n`)
        } catch {}
        publish(sessionId, {
          type: 'vibe_failed',
          target,
          error: `runner threw: ${msg}`,
          level: 'error',
        })
        return { ok: false as const, error: msg }
      }
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
