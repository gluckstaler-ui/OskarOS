/**
 * /api/mcp/propose-image-prompt — write a new ### img-N PENDING block
 * into IMAGES.md so the Assets panel renders it as a prompt card with
 * a Generate button (Ralph 2026-05-04, Bug I).
 *
 * Closes the doctrine gap CD flagged: `update_image_metadata` writes
 * the WRONG shape (`#### filename` — that's the generated-image record
 * stored under a parent prompt block), and `generate_image` skips the
 * prompt block entirely (it fires Nano right away). Neither path lets
 * CD propose a prompt for user approval before firing.
 *
 * Block shape matches the parser's contract (lib/session-actions.ts:503):
 *   ### img-{id}
 *   **Vibe:** {vibe}
 *   **Purpose:** {purpose}
 *   **Aspect Ratio:** {aspectRatio}
 *   **Status:** PENDING
 *   **Prompt:** {prompt}
 *
 *   ---
 *
 * Insertion:
 *   - Append to `## Image Prompts + Generated` section (creates the
 *     section if missing).
 *   - Auto-numbers as img-N when `id` not provided. N = max(existing
 *     numeric img-N) + 1; named blocks like `img-goofy-v1` are skipped
 *     by the regex so they don't break the count.
 *
 * After write, publishes `assets_updated` with reason 'propose_image_prompt'
 * so page.tsx's EventSource handler refreshes the panel via the existing
 * Bug F wiring. No frontend changes needed for this tool to land.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, rename } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { existsSync } from 'fs'
import { publish } from '@/lib/event-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_ASPECT_RATIOS = new Set([
  '1:1', '4:3', '3:4', '16:9', '9:16', '21:9', '3:2', '2:3', '4:5', '5:4',
])

const SECTION_HEADER = '## Image Prompts + Generated'

interface ProposeBody {
  sessionId?: string
  vibe?: string
  purpose?: string
  aspectRatio?: string
  prompt?: string
  id?: string
}

/**
 * Find the next numeric img-N that doesn't collide with existing entries.
 * Skips named entries (img-goofy-v1, img-haboob-silhouette-sunset-v1, etc.)
 * — only counts the bare integer pattern.
 */
function nextImgId(md: string): string {
  const matches = md.matchAll(/^### img-(\d+)\b/gm)
  let max = 0
  for (const m of matches) {
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `img-${String(max + 1).padStart(3, '0')}`
}

/**
 * Insert a new entry block under `## Image Prompts + Generated`. If the
 * section doesn't exist, create it before the next `## ` heading or
 * append to file. Idempotent: if the same id already exists, returns
 * `{ inserted: false }` so the caller can warn rather than duplicate.
 */
function insertBlock(md: string, id: string, block: string): {
  next: string
  inserted: boolean
  reason?: string
} {
  // Reject if this id is already present (any heading depth — covers
  // both ### img-N and #### img-N edge cases).
  if (new RegExp(`^#### \\s*${escapeRegex(id)}\\b`, 'm').test(md) ||
      new RegExp(`^### ${escapeRegex(id)}\\b`, 'm').test(md)) {
    return { next: md, inserted: false, reason: `entry ${id} already exists` }
  }

  const sectionStart = md.indexOf(SECTION_HEADER)

  if (sectionStart === -1) {
    // Section missing — create it. Append to end of file with a leading
    // separator so it doesn't run into prior content.
    const trailingNewlines = md.endsWith('\n') ? '' : '\n'
    return {
      next: `${md}${trailingNewlines}\n${SECTION_HEADER}\n\n${block}`,
      inserted: true,
    }
  }

  // Find the END of the section: next `## ` heading after the section
  // header, or end-of-file if it's the last section.
  const afterHeader = sectionStart + SECTION_HEADER.length
  const nextH2Match = md.slice(afterHeader).match(/\n## (?!#)/)
  const sectionEnd = nextH2Match
    ? afterHeader + (nextH2Match.index ?? 0)
    : md.length

  // Insert at the end of the section. Trim trailing whitespace inside
  // the section so we don't end up with N+ blank lines stacking up.
  const before = md.slice(0, sectionEnd).replace(/[\s]+$/, '')
  const after = md.slice(sectionEnd)
  return {
    next: `${before}\n\n${block}${after.startsWith('\n') ? after : '\n' + after}`,
    inserted: true,
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildBlock(args: {
  id: string
  vibe: string
  purpose: string
  aspectRatio: string
  prompt: string
}): string {
  // Match the parser's expected layout exactly. `**Status:** PENDING` is
  // the magic word that makes the panel render a Generate button instead
  // of a thumbnail. Trailing `---` separator matches every other entry.
  return [
    `### ${args.id}`,
    `**Vibe:** ${args.vibe}`,
    `**Purpose:** ${args.purpose}`,
    `**Aspect Ratio:** ${args.aspectRatio}`,
    `**Status:** PENDING`,
    `**Prompt:** ${args.prompt}`,
    ``,
    `---`,
    ``,
  ].join('\n')
}

async function atomicWriteUtf8(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmp = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, filePath)
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as ProposeBody | null
  if (!body?.sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  const vibe = (body.vibe || '').trim()
  if (!vibe) {
    return NextResponse.json({ ok: false, error: 'vibe required' }, { status: 400 })
  }
  const purpose = (body.purpose || '').trim()
  if (!purpose) {
    return NextResponse.json({ ok: false, error: 'purpose required' }, { status: 400 })
  }
  const aspectRatio = (body.aspectRatio || '').trim()
  if (!VALID_ASPECT_RATIOS.has(aspectRatio)) {
    return NextResponse.json(
      {
        ok: false,
        error: `aspectRatio must be one of: ${[...VALID_ASPECT_RATIOS].join(', ')}`,
      },
      { status: 400 },
    )
  }
  const prompt = (body.prompt || '').trim()
  if (!prompt) {
    return NextResponse.json({ ok: false, error: 'prompt required' }, { status: 400 })
  }
  // id is optional: caller provides for named entries (img-goofy-v1),
  // omits for auto-numbered (img-001, img-002, …).
  const callerId = body.id ? body.id.trim() : ''
  if (callerId && !/^img-[a-z0-9-]+$/i.test(callerId)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'id must be of the form `img-<slug>` (lowercase, alphanumerics + hyphens). ' +
          'Example: `img-goofy-v1`. Omit `id` to auto-number.',
      },
      { status: 400 },
    )
  }

  // Read existing IMAGES.md (empty if missing).
  const imagesPath = path.join(process.cwd(), 'public', body.sessionId, 'IMAGES.md')
  const existing = existsSync(imagesPath)
    ? await readFile(imagesPath, 'utf-8')
    : ''

  const id = callerId || nextImgId(existing)
  const block = buildBlock({ id, vibe, purpose, aspectRatio, prompt })
  const { next, inserted, reason } = insertBlock(existing, id, block)

  if (!inserted) {
    return NextResponse.json(
      {
        ok: false,
        error: reason || `failed to insert ${id}`,
        id,
      },
      { status: 409 },
    )
  }

  await atomicWriteUtf8(imagesPath, next)

  publish(body.sessionId, {
    type: 'assets_updated',
    reason: 'propose_image_prompt',
    id,
  } as Parameters<typeof publish>[1])

  return NextResponse.json({
    ok: true,
    id,
    bytesWritten: next.length,
    section: SECTION_HEADER,
  })
}
