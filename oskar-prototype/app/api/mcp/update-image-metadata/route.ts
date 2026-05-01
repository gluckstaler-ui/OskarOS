/**
 * /api/mcp/update-image-metadata — Phase 2 (Ralph bug 18, 2026-04-30).
 *
 * Single typed gateway for IMAGES.md mutations. Replaces the FileEdit
 * footgun. Internally used by /api/generate-image so generations always
 * land in IMAGES.md.
 */

import { NextResponse } from 'next/server'
import { join } from 'path'
import { upsertImageMetadata, type ImageMetadataPatch, type ImageStatus } from '@/lib/images-md-writer'

const VALID_STATUSES = new Set<string>([
  'HERO', 'USED', 'B-ROLL', 'READY', 'APPROVED', 'REDO', 'INGESTED', 'TRASH', 'PENDING',
])

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const filename = String(body.filename || '').trim()
  if (!sessionId || !filename) {
    return NextResponse.json({ error: 'sessionId + filename required' }, { status: 400 })
  }
  if (body.status && !VALID_STATUSES.has(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` },
      { status: 400 },
    )
  }

  const sessionDir = join(process.cwd(), 'public', sessionId)
  const patch: ImageMetadataPatch = {
    status: body.status as ImageStatus | undefined,
    evaluation: body.evaluation,
    vibe: body.vibe,
    slot: body.slot,
    note: body.note,
  }
  try {
    const r = await upsertImageMetadata(sessionDir, filename, patch)
    return NextResponse.json({ ok: true, ...r })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    )
  }
}
