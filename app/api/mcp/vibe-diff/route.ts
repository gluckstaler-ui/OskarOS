/**
 * /api/mcp/vibe-diff — Phase 2 Tier B (2026-04-30).
 *
 * Spec lock: ONLY `since='last-build'` is supported in v1. Any other
 * value returns 400. The spec-lock test in lib/__tests__/vibe-diff-since-lock.test.ts
 * pins this — adding `last-cd-touch` or `last-director` requires updating
 * both the route AND the test.
 *
 * Mechanism: every WebDev build snapshots the HTML to `.cache/last-build/`
 * before writing the new version. `vibe_diff` compares disk-current to that
 * snapshot. If no snapshot exists, returns an empty diff (the vibe has
 * never been built; nothing to diff against).
 */

import { NextResponse } from 'next/server'
import { join } from 'path'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

const ALLOWED_SINCE = ['last-build'] as const

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const target = String(body.target || '').trim()
  const since = String(body.since || 'last-build').trim()
  if (!sessionId || !target) {
    return NextResponse.json({ error: 'sessionId + target required' }, { status: 400 })
  }
  if (!ALLOWED_SINCE.includes(since as typeof ALLOWED_SINCE[number])) {
    return NextResponse.json(
      {
        error: `since must be one of: ${ALLOWED_SINCE.join(', ')}. v1 spec lock — only last-build is supported.`,
      },
      { status: 400 },
    )
  }

  const sessionDir = join(process.cwd(), 'public', sessionId)
  // Resolve target to filename (mirror apply-patch).
  let filename = target
  if (!filename.endsWith('.html')) {
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

  const currentPath = join(sessionDir, filename)
  const snapshotPath = join(sessionDir, '.cache', 'last-build', filename)

  if (!existsSync(currentPath)) {
    return NextResponse.json({ error: `file not found: ${filename}` }, { status: 404 })
  }
  if (!existsSync(snapshotPath)) {
    // Bug 10 fix (Ralph 2026-04-30): the previous behavior returned an empty
    // diff with a "no snapshot" note — agent had no way to verify ANYTHING
    // changed since the file was first written. Now we return the file's
    // mtime + sizeKB as a fallback baseline so the agent at least knows when
    // the file last moved, even without a proper diff. Documents the
    // pre-snapshot legacy state without lying about a diff.
    const { statSync } = await import('fs')
    let mtime = ''
    let sizeKB = 0
    try {
      const st = statSync(currentPath)
      mtime = st.mtime.toISOString()
      sizeKB = Math.round(st.size / 1024)
    } catch {}
    return NextResponse.json({
      diff: '',
      summary: { linesAdded: 0, linesRemoved: 0, sectionsChanged: 0 },
      note: `No last-build snapshot exists yet — this vibe was built before the snapshot system shipped (or has never been rebuilt). File mtime: ${mtime}, size: ${sizeKB}KB. Future builds will populate a real diff.`,
      fallback: { mtime, sizeKB },
    })
  }

  const [current, before] = await Promise.all([
    readFile(currentPath, 'utf-8'),
    readFile(snapshotPath, 'utf-8'),
  ])

  // Lightweight unified-diff: line-by-line LCS-free comparison. Good enough
  // for "what changed since last build" — not a substitute for `git diff`.
  const beforeLines = before.split('\n')
  const currentLines = current.split('\n')
  const beforeSet = new Set(beforeLines)
  const currentSet = new Set(currentLines)

  const added = currentLines.filter((l) => !beforeSet.has(l))
  const removed = beforeLines.filter((l) => !currentSet.has(l))

  // Sections: count <section ...> blocks that differ.
  const sectionRe = /<section[^>]*>/gi
  const beforeSections = before.match(sectionRe)?.length || 0
  const currentSections = current.match(sectionRe)?.length || 0

  const diff = [
    `--- ${filename} (last-build)`,
    `+++ ${filename} (current)`,
    ...removed.slice(0, 50).map((l) => `- ${l}`),
    ...added.slice(0, 50).map((l) => `+ ${l}`),
  ].join('\n')

  return NextResponse.json({
    diff,
    summary: {
      linesAdded: added.length,
      linesRemoved: removed.length,
      sectionsChanged: Math.abs(currentSections - beforeSections),
    },
  })
}
