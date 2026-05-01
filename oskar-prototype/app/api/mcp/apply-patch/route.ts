/**
 * /api/mcp/apply-patch — Phase 2 Tier A (2026-04-30).
 *
 * CD calls this to make surgical edits to a built vibe HTML without
 * invoking a full WebDev rebuild. The schema is the gate — only the
 * typed `kind`s in lib/html-patch-engine.ts are allowed.
 *
 * Side effects:
 *   - Writes the patched HTML back to disk.
 *   - Publishes a `canvas_update` event so the live preview hot-reloads.
 *   - Appends a one-line entry to `logs/_debug-apply-patch.log` for
 *     Director-Mode revert.
 */

import { NextResponse } from 'next/server'
import { join } from 'path'
import { existsSync } from 'fs'
import { readFile, writeFile, appendFile, mkdir } from 'fs/promises'
import { applyPatchToHtml, type ApplyPatchEdit } from '@/lib/html-patch-engine'
import { publish } from '@/lib/event-bus'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const target = String(body.target || '').trim()
  const edit = body.edit as ApplyPatchEdit | undefined
  if (!sessionId || !target || !edit || !edit.kind) {
    return NextResponse.json(
      { error: 'sessionId + target + edit{kind,...} required' },
      { status: 400 },
    )
  }

  const sessionDir = join(process.cwd(), 'public', sessionId)
  // Resolve target — either filename or vibe slug.
  let filename = target
  if (!filename.endsWith('.html')) {
    // Find vibe-N-*.html
    const { readdir } = await import('fs/promises')
    let entries: string[] = []
    try {
      entries = await readdir(sessionDir)
    } catch {
      return NextResponse.json({ error: `session not found: ${sessionId}` }, { status: 404 })
    }
    const match = entries.find((f) => f.startsWith(`${target}-`) && f.endsWith('.html'))
    if (!match) {
      return NextResponse.json({ error: `target not found: ${target}` }, { status: 404 })
    }
    filename = match
  }

  const filePath = join(sessionDir, filename)
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: `file not found: ${filename}` }, { status: 404 })
  }

  const html = await readFile(filePath, 'utf-8')
  const result = applyPatchToHtml(html, edit)

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, affected: result.affected },
      { status: 400 },
    )
  }

  // Persist + log.
  await writeFile(filePath, result.html!, 'utf-8')
  try {
    const logsDir = join(sessionDir, 'logs')
    if (!existsSync(logsDir)) await mkdir(logsDir, { recursive: true })
    const ts = new Date().toISOString()
    await appendFile(
      join(logsDir, '_debug-apply-patch.log'),
      `[${ts}] ${filename} ${edit.kind} ${('anchor' in edit ? edit.anchor : ('selector' in edit ? edit.selector : '(no-selector)'))} (affected ${result.affected})\n${result.diff}\n---\n`,
    )
  } catch {
    // logging is best-effort
  }

  // Hot-reload the canvas.
  try {
    publish(sessionId, { type: 'canvas_update', filename } as any)
  } catch {}

  return NextResponse.json({
    ok: true,
    affected: result.affected,
    diff: result.diff,
    filename,
  })
}
