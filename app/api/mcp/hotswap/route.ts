/**
 * /api/mcp/hotswap — MCP-tool endpoint for `hotswap(vibe, slot)`.
 *
 * Replaces the `## HOTSWAP: vibe slot` magic word. Logic ported verbatim
 * from `chat-stream/route.ts` lines 528–576: locate the approved image for
 * the slot in IMAGES.md, find the vibe's HTML file, swap the `data-usage`
 * attribute, reconcile tags. Emits events instead of SSE-sending to the
 * frontend.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, readdir, stat } from 'fs/promises'
import path from 'path'
import { reconcileUsedTags } from '@/lib/session'
import { publish } from '@/lib/event-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Resolve an image for `slot` from IMAGES.md.
 *
 * Reads BOTH formats CD has historically used:
 *   1. Prose: `### filename.jpg` block with `**Slot:** X` + `**Status:** READY`
 *      (or `APPROVED`, or `✓ ready`).
 *   2. Table:  `| slot | filename | … | ✓ ready` row.
 *
 * Returns the filename if found, or null. The table format is what the
 * original Phase 1 hotswap was hardcoded to, but no real session uses it
 * — this function adds the prose path so the actual format CD writes
 * (and that generate_image now writes) resolves correctly.
 */
function resolveSlotImage(imagesMd: string, slot: string): string | null {
  // Prose format — split on `### `, scan each block for matching slot+status.
  const blocks = imagesMd.split(/(?=^###\s)/m).filter((b) => b.trim().startsWith('### '))
  const slotRe = new RegExp(`(?:\\*+\\s*)?(?:Slot|Purpose)(?:\\s*\\*+)?\\s*:\\s*([^\\n]+)`, 'i')
  const statusRe = /(?:\*+\s*)?Status(?:\s*\*+)?\s*:\s*([^\n]+)/i
  // Sort blocks newest-first by checking for a Generated/Uploaded timestamp.
  // No timestamp → leave in declared order (CD's append order is recency-stable).
  for (const block of blocks) {
    const filenameMatch = block.match(/^###\s+(.+)$/m)
    if (!filenameMatch) continue
    const filename = filenameMatch[1].trim()
    // Skip prompt-ID headers (img-NNN); only consider real image filenames.
    if (!/\.(jpg|jpeg|png|webp|gif|avif)$/i.test(filename)) continue
    const blockSlot = block.match(slotRe)?.[1]?.trim().toLowerCase()
    if (!blockSlot || !blockSlot.includes(slot.toLowerCase())) continue
    const blockStatus = (block.match(statusRe)?.[1] || '').toLowerCase()
    if (
      blockStatus.includes('ready') ||
      blockStatus.includes('approved') ||
      blockStatus.includes('✓')
    ) {
      return filename
    }
  }
  // Legacy table format fallback.
  const tableRe = new RegExp(
    `\\|\\s*${slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|\\s*([^|]+)\\s*\\|[^|]*\\|\\s*✓\\s*ready`,
    'i',
  )
  const m = imagesMd.match(tableRe)
  return m ? m[1].trim() : null
}

/**
 * Resolve a vibe slug (e.g. "vibe-3", "qahwa") to a single .html file.
 *
 * 2026-04-30 (Ralph bug B): the previous resolver `files.find(f => f.includes(slug))`
 * picked the FIRST match in readdir order — alphabetical on macOS. Sessions
 * with multiple `vibe-3-*.html` files (legacy + current) would silently
 * route the swap to the older file that lacked `data-slot` attributes.
 *
 * New rule: prefer files with the EXACT prefix `${slug}-` (boundary anchor),
 * then sort by mtime DESC, return the newest. If multiple files match
 * equally, log all candidates and return the first.
 */
async function resolveVibeFile(
  sessionPath: string,
  vibeSlug: string,
): Promise<{ chosen: string | null; candidates: string[] }> {
  const files = await readdir(sessionPath)
  const slug = vibeSlug.toLowerCase().replace(/\s+/g, '-')
  const candidates = files.filter(
    (f) =>
      f.endsWith('.html') &&
      (f.toLowerCase().startsWith(`${slug}-`) || f.toLowerCase() === `${slug}.html`),
  )
  if (candidates.length === 0) {
    // Loose fallback — old "includes" behavior, last resort.
    const loose = files.filter(
      (f) => f.endsWith('.html') && f.toLowerCase().includes(slug),
    )
    return { chosen: loose[0] || null, candidates: loose }
  }
  if (candidates.length === 1) return { chosen: candidates[0], candidates }
  // Sort by mtime desc.
  const stats = await Promise.all(
    candidates.map(async (f) => ({
      f,
      mtime: (await stat(path.join(sessionPath, f))).mtimeMs,
    })),
  )
  stats.sort((a, b) => b.mtime - a.mtime)
  return { chosen: stats[0].f, candidates: stats.map((s) => s.f) }
}

export async function POST(req: NextRequest) {
  const { sessionId, vibe, slot, sourceImage: explicitSource } = (await req.json()) as {
    sessionId?: string
    vibe?: string
    slot?: string
    sourceImage?: string
  }
  if (!sessionId) return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  if (!vibe || !slot) return NextResponse.json({ ok: false, error: 'vibe + slot required' }, { status: 400 })

  const sessionPath = path.join(process.cwd(), 'public', sessionId)

  try {
    let sourceImage = explicitSource?.trim()
    if (!sourceImage) {
      const imagesContent = await readFile(path.join(sessionPath, 'IMAGES.md'), 'utf-8').catch(() => '')
      const found = resolveSlotImage(imagesContent, slot)
      if (!found) {
        const error = `No approved image found for slot "${slot}". Pass sourceImage explicitly, or mark an entry **Slot: ${slot}** + **Status: READY** in IMAGES.md.`
        publish(sessionId, { type: 'hotswap_failed', vibe, slot, error, level: 'error' })
        return NextResponse.json({ ok: false, error })
      }
      sourceImage = found
    }
    const { chosen: vibeFile, candidates } = await resolveVibeFile(sessionPath, vibe)
    if (!vibeFile) {
      const error = `HTML file not found for vibe "${vibe}"`
      publish(sessionId, { type: 'hotswap_failed', vibe, slot, error, level: 'error' })
      return NextResponse.json({ ok: false, error })
    }
    if (candidates.length > 1) {
      console.log(
        `[mcp/hotswap] vibe "${vibe}" matched ${candidates.length} files; picked newest: ${vibeFile} (others: ${candidates.slice(1).join(', ')})`,
      )
    }

    const htmlPath = path.join(sessionPath, vibeFile)
    const html = await readFile(htmlPath, 'utf-8')
    // 2026-04-30: try data-slot first, then data-usage as fallback. CD's
    // current convention writes BOTH; the previous code only looked at
    // data-usage which silently missed when only data-slot was present.
    //
    // 2026-04-30 (Ralph bug B-extra): differentiate "regex didn't match" from
    // "regex matched but produced no diff because sourceImage already equals
    // the current src." The previous code used `newHtml === html` as the
    // match check — false negative when the swap was a no-op. Now we walk
    // each pattern, ASK if it matches with `.test()`, and only conclude
    // "no slot in HTML" when ZERO patterns hit.
    const escapedSlot = slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns: Array<{ re: () => RegExp; src: '$1' | 'inner' }> = [
      // data-slot BEFORE src
      { re: () => new RegExp(`(<img[^>]*data-slot="${escapedSlot}"[^>]*src=")[^"]*(")`, 'gi'), src: 'inner' },
      // data-usage BEFORE src
      { re: () => new RegExp(`(<img[^>]*data-usage="${escapedSlot}"[^>]*src=")[^"]*(")`, 'gi'), src: 'inner' },
      // src BEFORE data-slot
      { re: () => new RegExp(`(<img[^>]*src=")[^"]*("[^>]*data-slot="${escapedSlot}"[^>]*>)`, 'gi'), src: 'inner' },
      // src BEFORE data-usage
      { re: () => new RegExp(`(<img[^>]*src=")[^"]*("[^>]*data-usage="${escapedSlot}"[^>]*>)`, 'gi'), src: 'inner' },
    ]
    let newHtml = html
    let matched = false
    let oldSrc: string | null = null
    for (const { re } of patterns) {
      const r = re()
      if (!r.test(newHtml)) continue
      matched = true
      // Reset lastIndex (test() advances it for /g regexes) and capture old src
      // before overwriting. We use a callback replace so we can read $2 (which
      // contains the old src for "inner" position 1, or `"` close + tail for the
      // alt patterns — we just need to know match happened).
      const re2 = re()
      newHtml = newHtml.replace(re2, (_m: string, p1: string, p2: string) => {
        // For patterns where the captured src is between p1 and p2 (`(<img...src=")[^"]*(")`)
        // p1 ends in src=" and p2 starts with ". For src-before-attr patterns
        // p1 ends in src=" and p2 starts with " too. Old src is the slice between.
        // Cheap, correct: extract from the original m.
        if (!oldSrc) {
          const sm = _m.match(/src="([^"]*)"/)
          if (sm) oldSrc = sm[1]
        }
        return `${p1}${sourceImage}${p2}`
      })
    }
    if (!matched) {
      const error = `No <img> with data-slot="${slot}" or data-usage="${slot}" found in ${vibeFile}.`
      publish(sessionId, { type: 'hotswap_failed', vibe, slot, error, level: 'error' })
      return NextResponse.json({ ok: false, error })
    }

    await writeFile(htmlPath, newHtml, 'utf-8')

    // Reconcile USED tags in IMAGES.md against the updated HTML.
    try {
      const r = await reconcileUsedTags(sessionId)
      console.log(
        `[mcp/hotswap] reconcileUsedTags: +${r.promoted.length} USED, -${r.demoted.length} demoted`,
      )
    } catch (err) {
      console.error('[mcp/hotswap] reconcileUsedTags failed:', err)
    }

    publish(sessionId, {
      type: 'hotswap_complete',
      vibe,
      slot,
      sourceImage,
      htmlPath: `/${sessionId}/${vibeFile}`,
    })
    publish(sessionId, { type: 'assets_updated' })

    return NextResponse.json({ ok: true, sourceImage, htmlPath: `/${sessionId}/${vibeFile}` })
  } catch (err) {
    const error = String(err)
    publish(sessionId, { type: 'hotswap_failed', vibe, slot, error, level: 'error' })
    return NextResponse.json({ ok: false, error }, { status: 500 })
  }
}
