// ============================================================================
// GET /api/admin/media/[hash] — auth-gated media serving
// WP-CRM-F20 (Ralph 2026-05-25)
//
// Replaces the prior model where media lived under public/_whatsapp/media/
// and was statically served by Next.js at predictable HTTPS URLs (anyone who
// guessed a date + message id could fetch any file). After F20, media lives
// at media/<sha256>.<ext> outside any statically-served path; this route is
// the only way to reach those bytes.
//
// Defense layers (in order of effectiveness):
//   1. Deployment-level auth gate at the Namecheap/web-server tier (the
//      whole /api/admin/* tree sits behind whatever basic-auth / IP allow-
//      list / token gate the host enforces). NOT this route's responsibility.
//   2. Orphan prevention: we only serve a hash if some activity row in the
//      DB references it. Random-hash guesses return 404 even when /api/admin/*
//      isn't auth-gated (dev mode).
//   3. Path-traversal safety: the [hash] segment is matched against a strict
//      hex regex before being used in a filesystem path.
//
// Returns the media bytes with Content-Type from the activity row's
// media_mime field. 404 on missing hash, malformed hash, or no referencing row.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import { readActivities } from '@/lib/crm-store'
import { resolveMediaFile } from '@/lib/media-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HASH_RE = /^[a-f0-9]{64}$/i   // SHA256 hex, exactly 64 chars

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params

  // Layer 3: strict hash format check before any filesystem touch.
  if (!HASH_RE.test(hash)) {
    return NextResponse.json({ error: 'malformed hash' }, { status: 404 })
  }

  // Layer 2: orphan prevention. Look up an activity row that references
  // this hash via media_path '/api/admin/media/<hash>'. If none exists,
  // refuse — the file might be on disk but the CRM no longer owns it.
  const expectedUrl = `/api/admin/media/${hash}`
  let mime = ''
  try {
    const activities = readActivities()
    const owning = activities.find(a => a.media_path === expectedUrl)
    if (!owning) {
      return NextResponse.json({ error: 'no activity references this hash' }, { status: 404 })
    }
    mime = owning.media_mime || 'application/octet-stream'
  } catch (err) {
    console.error('[media-route] activity lookup failed:', err)
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
  }

  // Find the file on disk. We don't store the extension or bucket in the DB
  // row (just the URL with the hash); resolveMediaFile locates <hash>.<ext>
  // wherever it lives — the flat root (legacy / pre-bucketing files) or a
  // per-number subfolder (media/<phone>/ or media/unmatched/<phone>/).
  let filePath: string | null = null
  try {
    filePath = resolveMediaFile(hash)
  } catch (err) {
    console.error('[media-route] resolve failed:', err)
    return NextResponse.json({ error: 'media dir not accessible' }, { status: 500 })
  }

  if (!filePath || !existsSync(filePath)) {
    return NextResponse.json({ error: 'media file missing on disk' }, { status: 404 })
  }

  const bytes = readFileSync(filePath)
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(bytes.length),
      // Cache aggressively — content-hashed URLs are immutable by definition.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
}
