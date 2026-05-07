/**
 * /api/mcp/image-ops — Phase 2 Tier B (2026-04-30).
 *
 * Thin route → lib/image-ops.ts. The lib does the Sharp work + appends
 * IMAGES.md entry.
 */

import { NextResponse } from 'next/server'
import { join } from 'path'
import { existsSync } from 'fs'
import { stat } from 'fs/promises'
import sharp from 'sharp'
import { runImageOp, type ImageOp } from '@/lib/image-ops'

interface OutputInfo {
  filename: string
  dimensions: string // "WxH"
  sizeKB: number
}

async function describe(sessionDir: string, filename: string): Promise<OutputInfo> {
  const abs = join(sessionDir, filename)
  let dimensions = ''
  let sizeKB = 0
  try {
    const st = await stat(abs)
    sizeKB = Math.round(st.size / 1024)
  } catch {}
  try {
    const m = await sharp(abs).metadata()
    if (m.width && m.height) dimensions = `${m.width}x${m.height}`
  } catch {}
  return { filename, dimensions, sizeKB }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const filename = String(body.filename || '').trim()
  const operation = String(body.operation || '').trim()
  const params = body.params
  if (!sessionId || !filename || !operation) {
    return NextResponse.json(
      { error: 'sessionId + filename + operation required' },
      { status: 400 },
    )
  }

  const sessionDir = join(process.cwd(), 'public', sessionId)
  if (!existsSync(sessionDir)) {
    return NextResponse.json({ error: `session not found: ${sessionId}` }, { status: 404 })
  }

  // WP-IMG-7 (2026-05-06): tag-chip threading. Workshop sends `tag` at the
  // top level (orthogonal to op params). Defaults to B-ROLL for parity with
  // pre-WP-7 behavior; the route doesn't validate the value because the
  // IMAGES.md tag enum is owned by `lib/types.ts` (and the parser tolerates
  // unknown statuses by falling through to undefined).
  const tag = String(body.tag || 'B-ROLL').trim() || 'B-ROLL'

  const op = { operation, params } as ImageOp
  const result = await runImageOp(sessionDir, filename, op, tag)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  // 2026-04-30 (Ralph bug C): include dimensions + sizeKB per output so
  // the agent can verify the op landed as specified — not just that some
  // file got written. e.g. resize to w=400 → dimensions reads "400x600".
  const outputs: OutputInfo[] = await Promise.all(
    result.outputs.map((f) => describe(sessionDir, f)),
  )
  return NextResponse.json({ ok: true, outputs })
}
