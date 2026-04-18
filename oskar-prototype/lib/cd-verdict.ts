/**
 * lib/cd-verdict.ts — extracted from /api/cd-evaluate-result route 2026-04-17
 *
 * Pure server-side function — same pattern as lib/cd-proofread.ts. The
 * /api/cd-evaluate-result route is a thin wrapper; /api/edit-image calls
 * `runVerdict()` inline after Nano returns.
 *
 * Per WP-15: same Big CD bridge as Briefing chat. CD opens the saved image
 * via its FileRead tool when it needs vision (we don't ship base64).
 */

import { callCDBridge } from './cd-bridge-call'
import { buildCDContext } from './cd-context'

export interface VerdictInput {
  sessionId: string
  filename: string
  /** Nano's Turn-2 self-description, if produced. */
  nanoDescription?: string
  /** What was actually sent to Nano (post-proofread, possibly rewritten). */
  originalPrompt: string
  mode: 'generate' | 'edit' | 'compose' | 'layout' | 'brand'
}

export interface VerdictOutcome {
  verdict: '✓' | '≈' | '✗' | 'error'
  note: string
  /** When CD adjusted Nano's description, the new text. Caller updates IMAGES.md. */
  adjustedDescription?: string
  durationMs: number
}

export async function runVerdict(input: VerdictInput): Promise<VerdictOutcome> {
  if (!input.sessionId || !input.filename || !input.originalPrompt) {
    return {
      verdict: 'error',
      note: 'Missing required field',
      durationMs: 0,
    }
  }

  // Full context — no briefBudget cap. CD has 1M tokens.
  const ctx = await buildCDContext(input.sessionId)

  const tagged = [
    '[OSKAR-SYSTEM VERDICT]',
    '',
    `Mode: ${input.mode}`,
    `Generated file: ${input.filename}`,
    `  (saved to public/${input.sessionId}/${input.filename} — open with FileRead if you need to look at it)`,
    '',
    'Prompt sent to Nano:',
    '```',
    input.originalPrompt,
    '```',
    '',
    input.nanoDescription
      ? `Nano's Turn-2 self-description:\n"${input.nanoDescription}"`
      : `Nano's Turn-2 self-description: (none — Nano did not describe its own output)`,
    '',
    ctx.size > 0 ? '---\nSession context:\n' + ctx.block : '',
    '',
    'Respond with the three blocks per the SYSTEM MESSAGES protocol in your agent file (## VERDICT, ## NOTE, ## ADJUSTED_DESCRIPTION).',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const result = await callCDBridge(input.sessionId, tagged)
    const parsed = parseVerdictResponse(result.text)
    return {
      verdict: parsed.verdict,
      note: parsed.note,
      adjustedDescription: parsed.adjustedDescription || undefined,
      durationMs: result.durationMs,
    }
  } catch (err) {
    console.error('[cd-verdict] Bridge call failed:', err)
    return {
      verdict: 'error',
      note: `Bridge error: ${err}`,
      durationMs: 0,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedVerdict {
  verdict: '✓' | '≈' | '✗'
  note: string
  adjustedDescription: string
}

function parseVerdictResponse(text: string): ParsedVerdict {
  const verdictRaw = extractBlock(text, 'VERDICT') || ''
  const note = extractBlock(text, 'NOTE') || ''
  const adjustedDescription = extractBlock(text, 'ADJUSTED_DESCRIPTION') || ''

  let verdict: '✓' | '≈' | '✗' = '≈'
  const v = verdictRaw.trim()
  if (v.startsWith('✓') || /^pass\b|^ok\b|^good\b|^ship\b/i.test(v)) verdict = '✓'
  else if (v.startsWith('✗') || /^fail\b|^redo\b|^bad\b|^reject\b/i.test(v)) verdict = '✗'
  else if (v.startsWith('≈') || /^maybe\b|^okay\b|^usable\b|^meh\b/i.test(v)) verdict = '≈'

  return {
    verdict,
    note: note.trim(),
    adjustedDescription: adjustedDescription.trim(),
  }
}

function extractBlock(text: string, header: string): string | null {
  const re = new RegExp(`##\\s+${header}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i')
  const m = text.match(re)
  return m ? m[1].trim() : null
}
