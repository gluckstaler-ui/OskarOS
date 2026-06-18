// ============================================================================
// GET /api/admin/scout/capture/[plz]/[slug]/[file] — auth-gated Scout capture
// serving. WP-132 / §18 MEDIA REWIRE (Ralph 2026-06-05)
//
// Scout screenshots live at media/<plz-or-region>/<slug>/<firstname>.jpg —
// OUTSIDE public/, so Next.js never statically serves them. This route is the
// ONLY way to reach those bytes. It mirrors the auth pattern of the WhatsApp
// media route (/api/admin/media/[hash]): the whole /api/admin/* tree sits
// behind the host's auth gate in production; in dev it's open, so the route's
// own defenses carry the weight.
//
// Defense layers (in order):
//   1. Deployment-level auth gate on /api/admin/* (host tier — not ours).
//   2. Path-traversal safety: every path component is matched against a strict
//      ^[a-z0-9_-]+$ charset (the file's stem) before touching the filesystem,
//      the extension is whitelisted, and the resolved absolute path is asserted
//      to stay inside MEDIA_DIR. A malformed component is rejected with 400
//      BEFORE any disk access (e.g. .../8050/..%2F..%2Fetc%2Fpasswd → 400).
//
// Unlike the WhatsApp media route, there is NO DB orphan-prevention layer:
// captures are screenshots of public practice homepages (low sensitivity), the
// path is structured (plz/slug/firstname — not a flat guessable namespace), and
// §18/WP-132 scopes the defense to the auth gate + the regex. MIME is derived
// from the whitelisted extension (no activity row to read it from).
//
// 400 on a malformed component, 404 on a well-formed path with no file on disk,
// 200 + image bytes otherwise.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import { MEDIA_DIR } from '@/lib/media-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// plz-or-region and slug: lowercase alnum + dash/underscore, nothing else.
// No dot (blocks ..), no slash, no spaces, no Unicode.
const SEG_RE = /^[a-z0-9_-]+$/
// file: a SEG_RE stem + one whitelisted image extension.
const FILE_RE = /^[a-z0-9_-]+\.(jpg|png|webp)$/
const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ plz: string; slug: string; file: string }> },
) {
  const { plz, slug, file } = await params

  // Layer 2: strict validation BEFORE any filesystem touch. A failure here is
  // a malformed request (including every traversal attempt) → 400.
  if (!SEG_RE.test(plz) || !SEG_RE.test(slug) || !FILE_RE.test(file)) {
    return NextResponse.json({ error: 'malformed path component' }, { status: 400 })
  }

  // Build the path and assert it stays inside MEDIA_DIR (belt-and-suspenders —
  // the regex already forbids `.`/`/`/`..`, so this branch is unreachable in
  // practice, but a single missed escape here is a file-disclosure bug).
  const filePath = join(MEDIA_DIR, plz, slug, file)
  const resolved = resolve(filePath)
  if (resolved !== filePath || !resolved.startsWith(MEDIA_DIR + sep)) {
    return NextResponse.json({ error: 'path escapes media root' }, { status: 400 })
  }

  if (!existsSync(resolved)) {
    return NextResponse.json({ error: 'capture not found' }, { status: 404 })
  }

  const ext = file.slice(file.lastIndexOf('.') + 1)
  const bytes = readFileSync(resolved)
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': String(bytes.length),
      // Per-user cacheable, dev-friendly (WP-132). Not `immutable` — a re-tasted
      // practitioner can overwrite <firstname>.jpg with a fresh capture.
      'Cache-Control': 'private, max-age=86400',
    },
  })
}
