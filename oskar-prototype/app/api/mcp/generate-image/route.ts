/**
 * /api/mcp/generate-image — Tier S `generate_image` tool backend.
 *
 * The agent calls `generate_image({ prompt, ratio?, refs?, slot? })`. We:
 *   1. Resolve `refs` (filenames in session folder) to base64 data URLs
 *      so the existing image-gen pipeline can hand them to Nano.
 *   2. Delegate to the existing /api/generate-image POST endpoint —
 *      same pipeline the frontend uses. That endpoint already publishes
 *      `image_ready` to the event-bus on success (Phase 1), so snackbar /
 *      Assets-panel refresh fires automatically.
 *   3. Return {filename, savedPath, geminiText} to the MCP tool, which
 *      forwards to the agent.
 *
 * Refs not found on disk → tool errors before the API call (no partial state).
 * Refs are NOT silently dropped.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { enqueueBuild } from '@/lib/build-escrow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface GenerateImageBody {
  sessionId?: string
  prompt?: string
  ratio?: string
  refs?: string[]
  slot?: string
}

const VALID_RATIOS = new Set(['1:1', '16:9', '9:16', '3:4', '4:3'])

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as GenerateImageBody | null
  if (!body?.sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  if (!body.prompt || typeof body.prompt !== 'string') {
    return NextResponse.json({ error: 'prompt required' }, { status: 400 })
  }

  const ratio = body.ratio && VALID_RATIOS.has(body.ratio) ? body.ratio : '16:9'
  const slot = (body.slot || 'b-roll').trim()

  // Load refs (if any) from the session folder. Missing files = error.
  const sessionDir = path.join(process.cwd(), 'public', body.sessionId)
  const referenceImages: string[] = []
  if (Array.isArray(body.refs) && body.refs.length > 0) {
    for (const ref of body.refs) {
      if (typeof ref !== 'string') continue
      const filePath = path.join(sessionDir, ref)
      if (!existsSync(filePath)) {
        return NextResponse.json(
          { error: `Reference image not found: ${ref}` },
          { status: 400 },
        )
      }
      try {
        const buffer = await readFile(filePath)
        const ext = path.extname(ref).slice(1).toLowerCase() || 'jpeg'
        const mime =
          ext === 'jpg' ? 'image/jpeg' :
          ext === 'jpeg' ? 'image/jpeg' :
          ext === 'png' ? 'image/png' :
          ext === 'webp' ? 'image/webp' :
          'image/jpeg'
        referenceImages.push(`data:${mime};base64,${buffer.toString('base64')}`)
      } catch (err) {
        return NextResponse.json(
          { error: `Failed to load reference ${ref}: ${err instanceof Error ? err.message : String(err)}` },
          { status: 500 },
        )
      }
    }
  }

  // Phase 2.5 (Ralph 2026-04-30): escrowed. Nano takes ~2 min — too long
  // to keep CD's tool call open. Enqueue + return jobId; CD polls via
  // job_status. The downstream /api/generate-image still runs synchronously
  // because the FRONTEND uses it directly (with its own progress UI) —
  // the escrow lives at the MCP wrapper layer only.
  const enqueued = enqueueBuild({
    sessionId: body.sessionId,
    kind: 'generate_image',
    target: (body.slot || 'b-roll').slice(0, 64), // dedup key includes slot
    runner: async ({ signal }) => {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
      let upstream: Response
      try {
        upstream = await fetch(`${baseUrl}/api/generate-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: body.sessionId,
            vibe: 'cd-direct',
            purpose: slot,
            prompt: body.prompt,
            aspectRatio: ratio,
            imageSize: '2K',
            referenceImages,
          }),
          signal, // cancel_job propagates here
        })
      } catch (err) {
        return {
          ok: false as const,
          error: `Internal call to /api/generate-image failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
      const data = (await upstream.json().catch(() => ({}))) as {
        success?: boolean
        filename?: string
        path?: string
        geminiText?: string | null
        error?: string
      }
      if (!upstream.ok || !data.success) {
        return { ok: false as const, error: data.error || `HTTP ${upstream.status}` }
      }
      return {
        ok: true as const,
        result: {
          filename: data.filename,
          savedPath: data.path,
          geminiText: data.geminiText ?? null,
        },
      }
    },
  })

  return NextResponse.json({
    status: enqueued.job.status,
    jobId: enqueued.job.jobId,
    deduped: enqueued.deduped,
    originalStartedAt: enqueued.originalStartedAt,
  })
}
