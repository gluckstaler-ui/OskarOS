/**
 * /api/mcp/build-wireframes — MCP-tool endpoint for `build_wireframes(slugs[])`.
 *
 * Phase 2 build for webpages (WP-69 backend, Ralph 2026-05-10). Dispatched by
 * the orchestrator's `callOrchestratorTool` after CD calls
 * `build_wireframes({slugs: [...]})`. One enqueued job per slug; each job
 * runs `runWebDev` with the slug as target. WebDev's existing agent prompt
 * handles the wireframe-vs-vibe distinction by reading the spec content
 * (Pass-1 Reasoning section, subject-matched-SVG instructions, no school
 * anchor) — no special tooling here.
 *
 * Mirrors `app/api/mcp/build-all-vibes/route.ts` but:
 *  - takes EXPLICIT slugs from CD (no parser enumeration)
 *  - emits per-slug `build_progress` events through the runner's
 *    onToolCall hook (mirror of build-all-vibes/route.ts:130-139)
 *  - uses `kind: 'build_vibe'` for the escrow + dedupe key so the same
 *    build-job infrastructure (BuildJobCard, job_status, cancel_job)
 *    applies without divergent UI paths
 *
 * Backend wiring path (was deferred under WP-69's original scope; landed
 * 2026-05-10 to make the tool actually fly end-to-end):
 *   CD calls build_wireframes(slugs)
 *     → callOrchestratorTool dispatches to here
 *     → POST /api/mcp/build-wireframes
 *     → enqueueBuild × N (one per slug)
 *     → withWebdevMutex serializes the spawns
 *     → runWebDev(target=slug) per slug
 *     → onToolCall forwards build_progress per slug onto the bus
 *     → BuildJobCard renders N rows live (queued → html → verify → done/failed)
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, readdir } from 'fs/promises'
import path from 'path'
import { runWebDev } from '@/lib/run-webdev'
import { publish } from '@/lib/event-bus'
import { enqueueBuild, withWebdevMutex } from '@/lib/build-escrow'
import { resolveWebDevExecution } from '@/lib/session-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Hero-image regex chain — same set used by build-vibe/route.ts and
// build-all-vibes/route.ts. Kept in sync so the live BuildJobCard rows
// for wireframes mount with the same hero-thumb behavior as full vibes.
// Future cleanup: WP-84 (lib/html-scraper.ts) collapses these into one
// shared helper. Until then, mirror.
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
 * Resolve a slug to its on-disk vibe spec file. Per Ralph's "no parser"
 * rule, do this via direct readdir + filename glob — NOT via
 * parseVibesFromFiles. The slug CD passed should match either the bare
 * filename (`vibe-1-grandmas-cliff.md`) or the canonical fallback
 * (`vibe-1.md`). Case-insensitive.
 *
 * Returns the resolved filename (basename) or null if no match exists.
 * The runner uses the slug as target; this lookup only powers the
 * row-metadata extraction (label + thumb) for the live BuildJobCard.
 */
async function resolveSlugToSpec(sessionPath: string, slug: string): Promise<string | null> {
  try {
    const files = await readdir(sessionPath)
    const lname = slug.toLowerCase()
    // Exact match first
    const exact = files.find((f) => f.toLowerCase() === `${lname}.md`)
    if (exact) return exact
    // Index match: slug "vibe-3-grandmas-cliff" → fall back to "vibe-3.md"
    const idxMatch = slug.match(/^vibe-(\d+)/i)
    if (idxMatch) {
      const indexFile = files.find((f) => f.toLowerCase() === `vibe-${idxMatch[1]}.md`)
      if (indexFile) return indexFile
    }
    return null
  } catch {
    return null
  }
}

/**
 * Pull a display-name from a vibe spec's `## Gallery Card` block (Name field)
 * or the H1, falling back to a Title-Cased version of the slug. Best-effort —
 * if reading fails, return undefined so the row mounts with id only.
 */
async function resolveLabel(sessionPath: string, specFilename: string): Promise<string | undefined> {
  try {
    const content = await readFile(path.join(sessionPath, specFilename), 'utf-8')
    // Try Gallery Card Name field first (locked schema per CD doctrine)
    const nameMatch = content.match(/^Name:\s*([^\n]+)$/m)
    if (nameMatch && nameMatch[1].trim()) return nameMatch[1].trim()
    // Fall back to H1, stripped of "VIBE N · " / "VIBE N: " / quotes
    const h1Match = content.match(/^#\s+([^\n]+)/m)
    if (h1Match) {
      let name = h1Match[1].trim()
      name = name.replace(/^VIBE[-\s]+\d+\s*[·:—–-]\s*/i, '')
      name = name.replace(/^["'""'']+|["'""'']+$/g, '')
      if (name) return name
    }
    return undefined
  } catch {
    return undefined
  }
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

  // Filter / dedupe slugs defensively. Empty strings, whitespace, and
  // duplicates would otherwise produce ghost jobs.
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

  // Resolve mode/model the same way build-vibe / build-all-vibes do.
  // TopBar pill + per-request body > session-config > hardcoded default.
  const { mode, model } = resolveWebDevExecution({ mode: bodyMode, model: bodyModel }, sessionId)

  const sessionPath = path.join(process.cwd(), 'public', sessionId)
  const buildMdPath = path.join(sessionPath, 'BUILD.md')

  // Build the rows[] payload for the live BuildJobCard mount. One row per
  // slug; label + thumb extracted best-effort from the spec file. Mirrors
  // build-all-vibes/route.ts:69-86 but keyed on slugs instead of parsed vibes.
  const buildRows: { id: string; label: string; thumb?: string; hasCritique: true }[] = []
  for (const slug of cleanSlugs) {
    const specFile = await resolveSlugToSpec(sessionPath, slug)
    let label: string | undefined
    let thumb: string | undefined
    if (specFile) {
      label = await resolveLabel(sessionPath, specFile)
      try {
        const content = await readFile(path.join(sessionPath, specFile), 'utf-8')
        thumb = findHeroThumb(content, sessionId)
      } catch {}
    }
    buildRows.push({
      id: slug,
      label: label ?? slug,
      ...(thumb ? { thumb } : {}),
      // Ralph 2026-05-18 (Job-Card Ladder Fix): wireframes get the
      // 5-stage ladder (queued → html → verify → critique → done).
      // BuildJobCard.buildSteps() reads this flag to pick the ladder.
      hasCritique: true,
    })
  }

  publish(sessionId, {
    type: 'build_started',
    mode: 'wireframes',
    vibeCount: cleanSlugs.length,
    rows: buildRows,
  })

  // Per-slug enqueue. Each becomes its own jobId. Dedup means firing
  // build_wireframes twice in a row coalesces — second call returns the
  // same jobIds (with deduped:true on each). Same shape as build_vibe.
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
      // Use 'build_vibe' as the kind so escrow dedupe + cancel_job + the
      // BuildJobCard component all work without a parallel implementation
      // path. The wireframe-vs-vibe distinction lives in the SPEC content
      // (Pass-1 Reasoning section instructs WebDev), not in the kind.
      kind: 'build_vibe',
      target,
      // Wrap the runner in the per-session WebDev mutex so all N spawns
      // serialize. CD sees all N jobIds immediately; only the actual
      // Claude-CLI / Gemini invocations run one at a time.
      runner: ({ signal }) =>
        withWebdevMutex(sessionId, async () => {
          // Audit-log entry mirroring build-all-vibes' shape, with a
          // wireframes marker so BUILD.md scans can distinguish phases.
          try {
            const existing = await readFile(buildMdPath, 'utf-8').catch(() => '# Build Log\n')
            await writeFile(
              buildMdPath,
              existing +
                `\n## [${new Date().toISOString()}] BUILD: target="${target}" (via MCP/wireframes)\n` +
                `**Status:** BUILDING\n`,
            )
          } catch {}

          // Stage transition queued → html for THIS row. The mutex
          // serializes WebDev spawns, so each iteration here marks the
          // moment its row's runner actually starts — sibling rows stay
          // 'queued' until their turn. Mirror of build-all-vibes/route.ts.
          publish(sessionId, { type: 'build_progress', target, stage: 'html' })

          // Belt-and-suspenders catch so the row never hangs in 'html'
          // state if runWebDev throws unexpectedly.
          try {
            const result = await runWebDev({
              mode,
              model,
              sessionId,
              sessionPath,
              target,
              abortSignal: signal,
              // Ralph 2026-05-18 (Job-Card Ladder Fix — phase-flag plumb-
              // through): tells the WebDev subprocess "you are doing a
              // wireframe build, Phase 7 is REQUIRED, fire
              // build_progress({stage:'critique'}) before filling surfaces."
              // Without this, the agent inferred mode from spec content and
              // was observed in E2E to short-circuit Phase 2/6/7 entirely
              // when an existing HTML was found on disk. See
              // lib/webdev-mode-banner.ts for the injected text.
              hasCritique: true,
              // Forward WebDev's optional progress tool calls onto the SSE
              // bus per-slug, so the BuildJobCard row flips through stages
              // and surfaces milestone bullets in real time.
              onToolCall: (toolName, input) => {
                // build_progress: stage transitions / milestone bullets onto
                // the per-row timeline. Ralph 2026-05-18 (Job-Card Ladder Fix,
                // revert): routing is closure-based via `target` captured at
                // spawn — row.id is the SLUG (no .html), so a filename-based
                // routing key would mismatch page.tsx:1083's `r.id === target`
                // matcher. WebDev's build_progress payload carries no slug.
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
                // submit_critique: WF-mode self-critique from WebDev. Per-slug
                // (one critique per wireframe per webdev-agent.md doctrine
                // lines 514-565 + CD-agent doctrine line 546 "full-width at
                // the very top of each wireframe"). The handler in
                // mcp-server/tools-sentinel.ts just acks; the publish here
                // is what reaches the UI. Ralph 2026-05-18 — wired together
                // with allowlist + event-kind additions in the same commit.
                if (toolName === 'submit_critique') {
                  publish(sessionId, {
                    type: 'critique_submitted',
                    target,
                    agent: 'webdev',
                    phase: 'wireframes',
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

              // Real verify pass — scan rendered HTML for broken <img> refs
              // against on-disk assets. Soft-warn via milestone; never
              // block vibe_built. Mirror of build-vibe/route.ts:209-232.
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
                    if (
                      src.startsWith('http://') ||
                      src.startsWith('https://') ||
                      src.startsWith('data:')
                    )
                      continue
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
                      milestone:
                        `${brokenRefs.length} broken refs (soft warn): ` +
                        `${brokenRefs.slice(0, 3).join(', ')}` +
                        `${brokenRefs.length > 3 ? '…' : ''}`,
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
            console.error(`[build-wireframes] runner threw for target="${target}":`, err)
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
