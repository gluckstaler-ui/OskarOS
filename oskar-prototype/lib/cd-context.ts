/**
 * CD Context Builder — WP-15 (built 2026-04-17, caps removed 2026-04-17)
 *
 * Single source of truth for the context CD receives in BOTH Image Mode
 * (Ask CD pill, proofread, verdict, evaluate-upload) AND Briefing chat.
 *
 * Until 2026-04-17 there were two effective CDs in the app:
 *   - Big CD (Briefing) — Opus 4.7 with full session memory via boot prompt
 *   - Little CD (Ask CD) — Sonnet 4.6 with NO session memory; each call cold
 *
 * The WP-15 contract requires both surfaces to share the same substantive
 * context so CD's voice and judgment don't drift between them. This module
 * is the assembler.
 *
 * Returns a context BLOCK (string) ready to inject into a CD system prompt.
 * Caller adds task-specific instructions on top.
 *
 * NO context budget caps (removed per Ralph 2026-04-17). CD is on Opus 4.7
 * with 1M token context. Rationing the brief slice or image list to fit a
 * (now-dead) 2s latency budget was a Darth-Checkmark constraint that
 * starved CD of the very signal it needs to do its job.
 */

import { readFile } from 'fs/promises'
import path from 'path'
import { parseImagesMd } from './session'

export interface CDContextOptions {
  /** Optional: name of the vibe the user is currently working in/on. */
  currentVibe?: string
}

export interface CDContext {
  /** Assembled context block ready for CD's system prompt. */
  block: string
  /** Per-source presence — useful for endpoint logs. */
  sources: {
    userPortrait: boolean
    brief: boolean
    images: boolean
    vibe: boolean
  }
  /** Approximate char count of the block. */
  size: number
}

const EMPTY: CDContext = {
  block: '',
  sources: { userPortrait: false, brief: false, images: false, vibe: false },
  size: 0,
}

function sessionPath(sessionId: string): string {
  return path.join(process.cwd(), 'public', sessionId)
}

/**
 * Best-effort read — returns null on missing file or unreadable bytes.
 */
async function tryRead(p: string): Promise<string | null> {
  try {
    return await readFile(p, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Format ALL entries from IMAGES.md (most recent first) into a digest.
 * No count cap — CD has 1M tokens, send everything.
 * Each entry: filename + 1-line analysis or reprompt summary.
 */
function summarizeAllImages(
  entries: ReturnType<typeof Array.from<[string, any]>>
): string {
  // entries comes from Array.from(map.entries()) — preserve insertion order;
  // newest are appended last by parseImagesMd's section walks. Reverse for
  // most-recent-first.
  const recent = [...entries].reverse()
  if (recent.length === 0) return ''

  const lines: string[] = []
  for (const [filename, entry] of recent) {
    // Bug 8 fix (Ralph 2026-04-30): prefer the normalized .tag (frozen
    // vocabulary) over the raw .status string. Old IMAGES.md files
    // contain `Status: ACTIVE` which is not in the documented enum;
    // .tag normalizes ACTIVE → USED so the agent never sees the
    // deprecated label.
    const summary =
      entry.cdAnalysis?.split('\n')[0]?.slice(0, 140) ||
      entry.reprompt?.split('\n')[0]?.slice(0, 140) ||
      entry.tag ||
      entry.status ||
      '(no analysis)'
    lines.push(`- ${filename}: ${summary}`)
  }
  return lines.join('\n')
}

/**
 * Build the shared CD context block for `sessionId`.
 * Always returns — never throws. Missing sources reduce the block, not
 * crash the caller.
 */
export async function buildCDContext(
  sessionId: string,
  options: CDContextOptions = {}
): Promise<CDContext> {
  if (!sessionId) return EMPTY

  const sp = sessionPath(sessionId)

  // Pull all sources in parallel — IO bound; doing them serially adds
  // ~3× latency for no benefit.
  const [userPortraitRaw, briefRaw, entriesMap] = await Promise.all([
    tryRead(path.join(sp, 'user.md')),
    tryRead(path.join(sp, 'CREATIVE-BRIEF.md')),
    parseImagesMd(sessionId).catch(() => new Map()),
  ])

  const sources: CDContext['sources'] = {
    userPortrait: !!userPortraitRaw,
    brief: !!briefRaw,
    images: entriesMap.size > 0,
    vibe: !!options.currentVibe,
  }

  const sections: string[] = []

  if (userPortraitRaw) {
    sections.push(
      '## USER PORTRAIT (from user.md — written by Padawan Sage)\n\n' +
        userPortraitRaw.trim()
    )
  }

  if (briefRaw) {
    // Full brief — no slicing. CD on Opus 1M can handle it.
    sections.push(
      '## CREATIVE BRIEF (from CREATIVE-BRIEF.md)\n\n' + briefRaw.trim()
    )
  }

  if (options.currentVibe) {
    sections.push(`## CURRENT VIBE\n\n${options.currentVibe}`)
  }

  if (entriesMap.size > 0) {
    // All images — no count cap. CD sees the full session image history.
    const digest = summarizeAllImages(Array.from(entriesMap.entries()))
    if (digest) {
      sections.push(
        `## IMAGES (${entriesMap.size} entries from IMAGES.md, newest first)\n\n${digest}`
      )
    }
  }

  if (sections.length === 0) return EMPTY

  const block =
    '---\n## CD CONTEXT — assembled by lib/cd-context.ts\n---\n\n' +
    sections.join('\n\n---\n\n')

  return { block, sources, size: block.length }
}
