import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises'
import path from 'path'

/**
 * Director-Mode page backup.
 *
 * Ralph's ask (2026-06-22): "a copy of the page is produced when entering
 * director mode, in order that [butchering] doesn't happen anymore."
 *
 * The compare-and-swap guard in director-surgery now PREVENTS the i18n clobber
 * at write time, so this is the belt to that suspenders: a pristine snapshot of
 * the page is taken the moment director mode opens, kept outside `public/` (not
 * web-served) under db/director-backups/<session>/, capped to the last 5. If
 * anything ever does go wrong, `action:'restore'` puts the most recent snapshot
 * back over the live file — a one-call undo.
 *
 *   POST { sessionId, pageFilename }                      → create a snapshot
 *   POST { sessionId, pageFilename, action:'restore' }    → restore newest snapshot
 */

const KEEP = 5

function backupDir(sessionId: string) {
  return path.join(process.cwd(), 'db', 'director-backups', sessionId)
}
// Flatten any subfolder in the page path so the backup filename is safe.
function safeBase(pageFilename: string) {
  return pageFilename.replace(/[\\/]/g, '__')
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId, pageFilename, action } = await req.json()
    if (!sessionId || !pageFilename) {
      return NextResponse.json({ error: 'sessionId and pageFilename are required' }, { status: 400 })
    }
    const livePath = path.join(process.cwd(), 'public', sessionId, pageFilename)
    const dir = backupDir(sessionId)
    const base = safeBase(pageFilename)

    if (action === 'restore') {
      let names: string[] = []
      try { names = await readdir(dir) } catch { /* no dir yet */ }
      const mine = names.filter((n) => n.startsWith(base + '.') && n.endsWith('.html')).sort()
      const newest = mine[mine.length - 1]
      if (!newest) {
        return NextResponse.json({ error: 'No backup to restore' }, { status: 404 })
      }
      const snapshot = await readFile(path.join(dir, newest), 'utf-8')
      await writeFile(livePath, snapshot, 'utf-8')
      console.log(`[director-backup] restored ${pageFilename} from ${newest}`)
      return NextResponse.json({ success: true, restored: newest })
    }

    // create — snapshot the current live file
    let html: string
    try {
      html = await readFile(livePath, 'utf-8')
    } catch {
      return NextResponse.json({ error: `File not found: ${pageFilename}` }, { status: 404 })
    }
    await mkdir(dir, { recursive: true })
    // Timestamp via Date.now() — this is a Node route (not the workflow sandbox).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const name = `${base}.${stamp}.html`
    await writeFile(path.join(dir, name), html, 'utf-8')

    // Prune to the last KEEP snapshots for this page.
    const all = (await readdir(dir)).filter((n) => n.startsWith(base + '.') && n.endsWith('.html')).sort()
    for (const old of all.slice(0, Math.max(0, all.length - KEEP))) {
      await unlink(path.join(dir, old)).catch(() => {})
    }
    console.log(`[director-backup] snapshot ${pageFilename} → ${name}`)
    return NextResponse.json({ success: true, backup: name, kept: Math.min(all.length, KEEP) })
  } catch (error) {
    console.error('[director-backup] error:', error)
    return NextResponse.json({ error: `Backup failed: ${error}` }, { status: 500 })
  }
}
