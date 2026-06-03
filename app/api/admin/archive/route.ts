// ==========================================
// Archive endpoint — fires when CRM Status → Lost
// POST /api/admin/archive
//
// WP-CRM-D4 (Ralph 2026-05-22): moves the session folder from
// `public/<sessionId>/` to `public/_archive/<sessionId>/`. Uses
// `fs.renameSync` — same-volume rename, no atomic-move ceremony. The
// session folder disappears from the Sessions tab and the CRM's
// LinksMap scan once moved.
//
// Writes a `session_archived` Activity row to the lead's history. Caller
// is responsible for confirming with the user before invoking — this
// endpoint is destructive.
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { existsSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import { appendActivity, invalidateLinksCache, PUBLIC_DIR } from '@/lib/crm-store'

interface ArchiveRequest {
  prospect_id?: string
  session_id?: string
  company?: string
}

const ARCHIVE_DIR = join(PUBLIC_DIR, '_archive')

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ArchiveRequest
    const prospectId = body.prospect_id?.trim()
    const sessionId = body.session_id?.trim()
    if (!prospectId || !sessionId) {
      return NextResponse.json({ error: 'prospect_id and session_id required' }, { status: 400 })
    }

    const src = join(PUBLIC_DIR, sessionId)
    if (!existsSync(src)) {
      return NextResponse.json({ error: `session folder not found: ${sessionId}` }, { status: 404 })
    }

    mkdirSync(ARCHIVE_DIR, { recursive: true })
    const dst = join(ARCHIVE_DIR, sessionId)
    if (existsSync(dst)) {
      // Don't clobber a previous archive — the user has to clean up first.
      return NextResponse.json({
        error: `archive already exists at _archive/${sessionId}; rename or remove it before re-archiving.`,
      }, { status: 409 })
    }

    // Plain rename — same volume, fast, no copy. fs.renameSync would
    // throw on cross-device moves; we don't span devices on the laptop.
    renameSync(src, dst)

    // Now the prospect→session linkage is gone — invalidate the cache so
    // the kanban and Sessions tab redraw without this session.
    invalidateLinksCache()

    try {
      await appendActivity({
        prospect_id: prospectId,
        type: 'session_archived',
        icon: 'archive',
        color: '#71717a',
        session_id: sessionId,
        notes: body.company ? `Archived ${sessionId} (${body.company})` : `Archived ${sessionId}`,
      })
    } catch (err) {
      console.warn('[archive] activity append failed (non-fatal):', err)
    }

    return NextResponse.json({
      status: 'archived',
      from: `public/${sessionId}/`,
      to: `public/_archive/${sessionId}/`,
    })
  } catch (err) {
    console.error('[archive] POST failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
