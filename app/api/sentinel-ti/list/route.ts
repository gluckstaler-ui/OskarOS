// ═══════════════════════════════════════════════════════════════════════
// /api/sentinel-ti/list — GET past critique reports for a session.
// Used by SentinelTiPanel on mount to populate the history list with
// reports written to disk by previous runs.
//
// Query: ?sessionId=2026-01-27-31
// Returns: [{ id, filename, target, output, finishedAt }, ...] newest first
// ═══════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server'
import { readdir, readFile, stat } from 'fs/promises'
import path from 'path'

interface PastCritique {
  id: string
  filename: string
  target: string
  output: string
  finishedAt: number
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const critiqueDir = path.join(
    process.cwd(),
    'public',
    sessionId,
    'critique',
  )

  let files: string[]
  try {
    files = await readdir(critiqueDir)
  } catch {
    // Folder doesn't exist yet — no past critiques.
    return NextResponse.json({ critiques: [] })
  }

  const tiFiles = files.filter(
    (f) => f.startsWith('sentinel-ti-') && f.endsWith('.md'),
  )

  const out: PastCritique[] = []
  for (const filename of tiFiles) {
    try {
      const fullPath = path.join(critiqueDir, filename)
      const [content, st] = await Promise.all([
        readFile(fullPath, 'utf-8'),
        stat(fullPath),
      ])
      // Extract target from filename: sentinel-ti-{target}-{ISO}.md
      // ISO contains dashes too, so split smartly: target is the chunk
      // between the second `-` and the date-looking suffix.
      const m = filename.match(/^sentinel-ti-(.+?)-\d{4}-\d{2}-\d{2}T/)
      const target = m ? m[1] : 'unknown'

      out.push({
        id: filename,
        filename,
        target,
        output: content,
        finishedAt: st.mtimeMs,
      })
    } catch {
      // Skip files we can't read — don't fail the whole listing.
    }
  }

  // Newest first
  out.sort((a, b) => b.finishedAt - a.finishedAt)

  return NextResponse.json({ critiques: out })
}
