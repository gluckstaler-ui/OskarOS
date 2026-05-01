/**
 * /api/mcp/session-meta — Phase 2 Tier A (2026-04-30).
 *
 * One call returns the full session snapshot CD/WebDev/Sentinel need to
 * make decisions without polling six different files. Cheap to compute
 * (no Sharp, no JSDOM, no fork) so safe to call freely.
 */

import { NextResponse } from 'next/server'
import { join } from 'path'
import { readdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { parseImagesMd } from '@/lib/session'

interface MetaResponse {
  vibesBuilt: string[]
  vibesPending: string[]
  imagesByStatus: Record<string, number>
  deckFiles: string[]
  brokenRefs: string[]
  currentPhase: string
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  const sessionDir = join(process.cwd(), 'public', sessionId)
  if (!existsSync(sessionDir)) {
    return NextResponse.json({ error: `session not found: ${sessionId}` }, { status: 404 })
  }

  const result: MetaResponse = {
    vibesBuilt: [],
    vibesPending: [],
    imagesByStatus: {},
    deckFiles: [],
    brokenRefs: [],
    currentPhase: 'unknown',
  }

  // Vibes built = vibe-N-*.html files; pending = VIBE-N.md files without a
  // matching .html.
  let entries: string[] = []
  try {
    entries = await readdir(sessionDir)
  } catch {
    return NextResponse.json({ error: 'cannot list session' }, { status: 500 })
  }

  const builtVibeNums = new Set<string>()
  for (const f of entries) {
    const m = f.match(/^vibe-(\d+)[-.].*\.html$/i)
    if (m) {
      result.vibesBuilt.push(f)
      builtVibeNums.add(m[1])
    }
  }
  for (const f of entries) {
    const m = f.match(/^VIBE-(\d+)\.md$/)
    if (m && !builtVibeNums.has(m[1])) result.vibesPending.push(f)
  }

  // Deck files (final landing / booking outputs).
  for (const f of entries) {
    if (/^landing\.html$/.test(f) || /^booking\.html$/.test(f) || /^index\.html$/.test(f)) {
      result.deckFiles.push(f)
    }
  }

  // Image status histogram from IMAGES.md.
  //
  // Bug fix 2026-04-30 (Ralph): parseImagesMd keys every `### ` line as an
  // entry, which includes:
  //   - section headings ("### SPONSOR CARD — Standalone Generated Images")
  //   - prompt IDs ("### img-001 — Logo (ALPHA CENTAURI)")
  //   - actual filenames ("### sultan.jpg")
  // The status histogram still wants to see all entries (a prompt with
  // status PENDING is real signal). The brokenRefs scan does NOT — it
  // must only flag actual-filename references that are missing on disk,
  // otherwise prompt IDs and section headers spam the list.
  const IMAGE_EXT_RE = /\.(jpg|jpeg|png|webp|avif|gif)$/i
  try {
    const parsed = await parseImagesMd(sessionId)
    for (const entry of parsed.values()) {
      const tag = entry.tag || 'UNTAGGED'
      result.imagesByStatus[tag] = (result.imagesByStatus[tag] || 0) + 1
      // Broken ref = entry recorded in IMAGES.md AS AN IMAGE FILE
      // (extension match) but missing on disk. Section headers and
      // prompt IDs are intentionally excluded.
      if (
        entry.filename &&
        IMAGE_EXT_RE.test(entry.filename) &&
        !existsSync(join(sessionDir, entry.filename))
      ) {
        result.brokenRefs.push(entry.filename)
      }
    }
  } catch {
    // Empty session or no IMAGES.md — leave counts empty.
  }

  // Phase: read SESSION.md if present, look for "Phase: N" or default to
  // discovery/build/final based on file presence.
  try {
    const sessionMd = await readFile(join(sessionDir, 'SESSION.md'), 'utf-8')
    const phaseMatch = sessionMd.match(/(?:^|\n)\s*(?:\*\*)?Phase(?:\*\*)?\s*:\s*([^\n]+)/i)
    if (phaseMatch) {
      result.currentPhase = phaseMatch[1].trim()
    } else if (result.deckFiles.length > 0) {
      result.currentPhase = 'final'
    } else if (result.vibesBuilt.length > 0) {
      result.currentPhase = 'vibes'
    } else if (existsSync(join(sessionDir, 'CREATIVE-BRIEF.md'))) {
      result.currentPhase = 'discovery'
    }
  } catch {
    // No SESSION.md — leave phase as 'unknown' or fall through to file heuristics.
    if (result.deckFiles.length > 0) result.currentPhase = 'final'
    else if (result.vibesBuilt.length > 0) result.currentPhase = 'vibes'
  }

  return NextResponse.json(result)
}
