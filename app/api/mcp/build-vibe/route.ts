/**
 * /api/mcp/build-vibe — MCP-tool endpoint for `build_vibe(slugs[])`.
 *
 * Ralph 2026-05-18 — collapsed build API. This route is now the single
 * Phase-4 entry point. It replaces:
 *   - the old `{slug, name}` single-vibe shape (now: `slugs: [slug]`)
 *   - `build_all_vibes` (now: `slugs: [...all-vibe-slugs]`, CD enumerates)
 *   - `build_final` (now: `slugs: [selectedSlug]`, orchestrator derives
 *     strictness from session state — no separate tool)
 *
 * Shape mirrors `build_wireframes`: one enqueued job per slug, each runs
 * `runWebDev` under `withWebdevMutex` so spawns serialize per session.
 * Per-slug events flow through the runner's onToolCall hook (same shape
 * the live BuildJobCard already consumes from build_wireframes).
 *
 * What stays unchanged from prior routes:
 *   - escrow `kind: 'build_vibe'` for dedupe + cancel_job + job_status
 *   - withWebdevMutex serialization
 *   - BUILD.md audit-log writes
 *   - publish() lifecycle: build_started → build_progress → vibe_built /
 *     vibe_failed, same shape downstream BuildJobCard already consumes
 *   - real verify pass (broken-<img> scan as soft warning)
 *   - submit_critique tool intercept (forwarded to event-bus)
 *
 * Wiring path:
 *   CD calls build_vibe(["vibe-3", "vibe-1", ...])
 *     → callOrchestratorTool dispatches here
 *     → POST /api/mcp/build-vibe
 *     → enqueueBuild × N (one per slug)
 *     → withWebdevMutex serializes the spawns
 *     → runWebDev(target=slug) per slug
 *     → onToolCall forwards build_progress / submit_critique per slug
 *     → BuildJobCard renders N rows live (queued → html → verify → done/failed)
 */

import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { runWebDev } from '@/lib/run-webdev'
import { publish } from '@/lib/event-bus'
import { enqueueBuild, withWebdevMutex } from '@/lib/build-escrow'
import { resolveWebDevExecution } from '@/lib/session-config'
import { matchField } from '@/lib/markdown-fields'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Hero-image regex chain — same set used by build-wireframes/route.ts.
// Matches the table-cell shape `| Hero | \`file.jpg\` |` first, then
// falls back to bullet / md-image / first-inline-code shapes.
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
 * Resolve a slug to its on-disk vibe spec file. Accepts:
 *   - `vibe-N`           → matches `vibe-N.md` first, then `vibe-N-*.md`
 *   - `vibe-N-slug`      → matches `vibe-N-slug.md` first, then `vibe-N.md`
 *   - bare slug          → matches `vibe-\d+-{slug}.md`
 *
 * Cold-storage suffixes (`vibe-N-old.md`, `vibe-N-slim.md`) are skipped.
 * Returns the spec basename or null if no match.
 */
async function resolveSlugToSpec(sessionPath: string, slug: string): Promise<string | null> {
  try {
    const files = await readdir(sessionPath)
    const COLD = /-(?:old|slim)\.md$/i
    const targetIdxMatch = slug.match(/^vibe-(\d+)(?:-(.+))?$/i)
    const targetIdx = targetIdxMatch ? Number(targetIdxMatch[1]) : null
    const targetSlug = targetIdxMatch?.[2] ?? slug.toLowerCase()

    if (targetIdx != null) {
      // 1. exact `vibe-{idx}.md`
      const exact = files.find((f) => new RegExp(`^vibe-${targetIdx}\\.md$`, 'i').test(f))
      if (exact) return exact
      // 2. variant `vibe-{idx}-{anything}.md` (skip cold-storage)
      const variant = files.find(
        (f) => new RegExp(`^vibe-${targetIdx}-`, 'i').test(f) && f.toLowerCase().endsWith('.md') && !COLD.test(f),
      )
      if (variant) return variant
    }
    // 3. slug match `vibe-\d+-{slug}.md`
    const slugMatch = files.find((f) =>
      new RegExp(`^vibe-\\d+-${targetSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.md$`, 'i').test(f),
    )
    if (slugMatch) return slugMatch
    return null
  } catch {
    return null
  }
}

/**
 * Pull a display name from a spec file. Priority:
 *   1. explicit `Name:` field (via matchField)
 *   2. `# VIBE N: NAME` H1 form
 *   3. Title-Cased filename slug
 */
function resolveLabel(content: string, specFilename: string): string {
  const nameField = matchField(content, 'Name')?.trim()
  if (nameField) return nameField
  const headerMatch = content.match(/^#\s*VIBE[\s\-_]*\d+\s*[:·\-—]\s*(.+)$/im)
  if (headerMatch) {
    return headerMatch[1].trim().replace(/^["']|["']$/g, '')
  }
  const slugFromName = specFilename.replace(/^vibe-\d+(?:-)?/i, '').replace(/\.md$/i, '')
  return (
    slugFromName
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ') || specFilename
  )
}

/**
 * Real verify pass — scan rendered HTML for <img src=...> refs and
 * confirm each local path resolves on disk. Soft-warn on broken refs;
 * never block vibe_built.
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
    const stripped = src.replace(/^\//, '').split('?')[0]
    const sessionRel = stripped.startsWith(`${sessionId}/`)
      ? stripped.slice(sessionId.length + 1)
      : stripped
    const fullPath = path.join(sessionPath, sessionRel)
    if (!existsSync(fullPath)) brokenRefs.push(src)
  }
  return { imgCount: imgMatches.length, brokenRefs }
}

export async function POST(req: NextRequest) {
  const { sessionId, slugs, mode: bodyMode, model: bodyModel } = (await req.json()) as {
    sessionId?: string
    slugs?: string[]
    mode?: 'smpl' | 'cli' | 'api'
    model?: 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'gemini-3.1-pro-preview'
  }
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  if (!Array.isArray(slugs) || slugs.length === 0) {
    return NextResponse.json({ error: 'slugs[] (non-empty array of strings) required' }, { status: 400 })
  }

  // Filter / dedupe defensively
  const cleanSlugs = Array.from(
    new Set(
      slugs
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  )
  if (cleanSlugs.length === 0) {
    return NextResponse.json({ error: 'slugs[] contained no non-empty strings' }, { status: 400 })
  }

  const { mode, model } = resolveWebDevExecution({ mode: bodyMode, model: bodyModel }, sessionId)
  const sessionPath = path.join(process.cwd(), 'public', sessionId)
  const buildMdPath = path.join(sessionPath, 'BUILD.md')

  // Build row metadata for build_started — one row per slug, with
  // best-effort label + hero thumb extracted from each slug's spec.
  const buildRows: { id: string; label: string; thumb?: string }[] = []
  for (const slug of cleanSlugs) {
    const specFile = await resolveSlugToSpec(sessionPath, slug)
    let label = slug
    let thumb: string | undefined
    if (specFile) {
      try {
        const content = await readFile(path.join(sessionPath, specFile), 'utf-8')
        label = resolveLabel(content, specFile)
        thumb = findHeroThumb(content, sessionId)
      } catch {
        // best-effort — row still mounts with id-only
      }
    }
    buildRows.push({ id: slug, label, ...(thumb ? { thumb } : {}) })
  }

  publish(sessionId, {
    type: 'build_started',
    mode: 'vibes',
    vibeCount: cleanSlugs.length,
    rows: buildRows,
  })

  // Per-slug enqueue. Each becomes its own jobId. Dedup means firing the
  // same set of slugs twice in a row coalesces — second call returns the
  // same jobIds (with deduped:true on each). Same shape as build_wireframes.
  const jobs: {
    jobId: string
    target: string
    status: string
    deduped: boolean
    originalStartedAt?: string
  }[] = []

  for (const slug of cleanSlugs) {
    const target = slug
    const enqueued = enqueueBuild({
      sessionId,
      kind: 'build_vibe',
      target,
      runner: ({ signal }) =>
        withWebdevMutex(sessionId, async () => {
          // Audit-log entry
          try {
            const existing = await readFile(buildMdPath, 'utf-8').catch(() => '# Build Log\n')
            await writeFile(
              buildMdPath,
              existing +
                `\n## [${new Date().toISOString()}] BUILD: target="${target}" (via MCP/vibes)\n` +
                `**Status:** BUILDING\n`,
            )
          } catch {}

          // Stage transition queued → html for THIS row. The mutex
          // serializes WebDev spawns, so each iteration here marks the
          // moment its row's runner actually starts.
          publish(sessionId, { type: 'build_progress', target, stage: 'html' })

          try {
            const result = await runWebDev({
              mode,
              model,
              sessionId,
              sessionPath,
              target,
              abortSignal: signal,
              // Ralph 2026-05-18 (Job-Card Ladder Fix — phase-flag plumb-
              // through): explicit `false` (rather than omitted) so the
              // WebDev subprocess gets the "BUILD MODE: VIBE, skip Phase 7"
              // banner from lib/webdev-mode-banner.ts. Without this, the
              // agent could theoretically default to wireframe behavior
              // and add Self-Critique surfaces to vibe builds.
              hasCritique: false,
              onToolCall: (toolName, input) => {
                // build_progress: stage transitions / milestone bullets.
                // Ralph 2026-05-18 (Job-Card Ladder Fix, revert): routing is
                // closure-based via `target` captured at spawn — row.id is the
                // SLUG (no .html), so a filename-based routing key would
                // mismatch page.tsx:1083's `r.id === target` matcher. WebDev's
                // build_progress payload carries no slug. 'critique' stage is
                // allowed (defensive — vibe builds don't emit it per Phase 7
                // doctrine, but the schema permits it).
                if (toolName === 'build_progress') {
                  const stage = typeof input?.stage === 'string' ? input.stage : undefined
                  const milestone = typeof input?.milestone === 'string' ? input.milestone : undefined
                  if (stage === 'html' || stage === 'verify' || stage === 'critique') {
                    publish(sessionId, { type: 'build_progress', target, stage, milestone })
                  } else if (milestone) {
                    publish(sessionId, { type: 'build_progress', target, milestone })
                  }
                  return
                }
                // submit_critique: forward to event-bus per-slug. Per
                // doctrine, Phase 4 vibes get Sentinel-Ti critiques (a
                // separate path); WebDev itself does not self-critique
                // for vibes. This handler exists for parity with
                // build_wireframes (where WebDev DOES self-critique) and
                // as a safe forwarder if the doctrine ever shifts.
                if (toolName === 'submit_critique') {
                  publish(sessionId, {
                    type: 'critique_submitted',
                    target,
                    agent: 'webdev',
                    // `'vibe'` matches CritiqueCardPayload.phase union in
                    // lib/types.ts. NB: post-2026-05-18 build-API collapse,
                    // Phase 5 final-build critiques also tag as 'vibe' —
                    // the route can't distinguish Phase 4 from Phase 5
                    // (both call build_vibe([slugs])); the strictness is
                    // derived from session state, not the critique label.
                    phase: 'vibe',
                    scores: Array.isArray(input?.scores) ? input.scores : [],
                    summary: typeof input?.summary === 'string' ? input.summary : '',
                    recommendations: Array.isArray(input?.recommendations) ? input.recommendations : [],
                  })
                  return
                }
              },
            })

            if (result.status === 'complete') {
              try {
                const cur = await readFile(buildMdPath, 'utf-8')
                await writeFile(buildMdPath, cur + `**Result:** COMPLETE -> ${result.filename}\n`)
              } catch {}

              // Real verify pass — broken-img scan as soft warning
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
                    milestone:
                      `${verdict.brokenRefs.length} broken refs (soft warn): ` +
                      `${verdict.brokenRefs.slice(0, 3).join(', ')}` +
                      `${verdict.brokenRefs.length > 3 ? '…' : ''}`,
                  })
                }
              } catch {
                // best-effort; never block vibe_built
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
    slugCount: cleanSlugs.length,
    jobs,
  })
}
