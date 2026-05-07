/**
 * /api/mcp/images-needed — MCP-tool endpoint for `images_needed()`.
 *
 * Replaces the `## IMAGES NEEDED` magic word. CD has already written the
 * prompts to IMAGES.md; this endpoint signals the frontend to re-read the
 * file and refresh the Assets panel.
 *
 * We also emit a structured `assets_updated` event so the MCP notification
 * loop tells CD that the panel update has been pushed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { publish } from '@/lib/event-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Count distinct vibe assignments by scanning every `### ` block in
 * IMAGES.md for its `**Vibe:**` field and collecting unique slugs. Replaces
 * the bogus `^### VIBE-N` regex (2026-04-30 Ralph bug report) — IMAGES.md
 * has never used that heading format. Vibes are declared per-prompt via
 * a `**Vibe:**` field inside each prompt block.
 *
 * "all" / "all four" / "master brand" → counted once as the special
 * pseudo-vibe `all`. "vibe 1, vibe 3" → counted as 2 distinct vibes.
 */
function countDistinctVibes(md: string): { vibes: number; prompts: number } {
  const blocks = md.split(/(?=^###\s)/m).filter((b) => b.trim().startsWith('### '))
  const vibeSet = new Set<string>()
  let prompts = 0
  for (const block of blocks) {
    // A "prompt" entry has BOTH a `**Prompt:**` field AND a `**Vibe:**` field.
    // Section headers and pure-uploaded-image entries don't have a Prompt field.
    const hasPrompt = /(?:\*\*\s*)?Prompt(?:\s*\*\*)?\s*:/i.test(block)
    if (!hasPrompt) continue
    prompts += 1
    const vibeMatch = block.match(/(?:\*\*\s*)?Vibe(?:\s*\*\*)?\s*:\s*([^\n]+)/i)
    const vibeRaw = vibeMatch?.[1]?.trim()
    if (!vibeRaw) continue
    const lower = vibeRaw.toLowerCase()
    // "all" / "all vibes" / "all four" / "master brand asset" all collapse
    // to the special pseudo-vibe.
    if (/^all\b|master\s+brand|every\s+vibe/i.test(lower)) {
      vibeSet.add('all')
      continue
    }
    // Otherwise pull every `vibe-N` or `vibe N` token. CD writes these in
    // a few shapes — `Vibe: vibe-1, vibe-3` / `Vibe: Vibe 1 Observatory` /
    // `Vibe: Vibe 1 Observatory and Vibe 3 Frontier Warm`.
    const tokens = vibeRaw.match(/vibe[\s-]?\d+/gi)
    if (tokens) {
      for (const t of tokens) {
        const num = t.match(/\d+/)?.[0]
        if (num) vibeSet.add(`vibe-${num}`)
      }
      continue
    }
    // Fallback: treat the whole value as a slug (e.g. `Vibe: qahwa`).
    vibeSet.add(vibeRaw)
  }
  return { vibes: vibeSet.size, prompts }
}

export async function POST(req: NextRequest) {
  const { sessionId } = (await req.json()) as { sessionId?: string }
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  let promptCount = 0
  let manifestCount = 0
  try {
    const imagesPath = path.join(process.cwd(), 'public', sessionId, 'IMAGES.md')
    const md = await readFile(imagesPath, 'utf-8').catch(() => '')
    const counts = countDistinctVibes(md)
    manifestCount = counts.vibes
    promptCount = counts.prompts
  } catch {}

  publish(sessionId, {
    type: 'assets_updated',
    reason: 'images_needed',
    manifestCount,
    promptCount,
  })

  return NextResponse.json({ ok: true, manifestCount, promptCount })
}
