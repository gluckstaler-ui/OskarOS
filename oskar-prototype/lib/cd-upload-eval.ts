/**
 * lib/cd-upload-eval.ts — WP-15 rule 7 (added 2026-04-17)
 *
 * Per WP-15: "Every uploaded image gets the same treatment as a Nano return."
 * Pre-2026-04-17 the upload pipeline only saved the file and the Snackbar
 * subscriber for `cd.upload-evaluated` had no emitter (dead subscriber bug).
 *
 * This module fills the gap. The `[OSKAR-SYSTEM EVAL-UPLOAD]` tag (in
 * `agents/creative-director-agent.md`) tells Big CD: open the file, classify,
 * suggest slot roles, return a verdict. Same Big CD bridge as everything
 * else — no anonymous spawn.
 */

import { callCDBridge } from './cd-bridge-call'
import { buildCDContext } from './cd-context'

export interface UploadEvalInput {
  sessionId: string
  filename: string
}

export interface UploadEvalOutcome {
  verdict: '✓' | '≈' | '✗' | 'error'
  note: string
  /** Comma-separated slot roles CD recommends for this image. Empty when none. */
  suggestedUses: string[]
  durationMs: number
}

export async function runUploadEval(input: UploadEvalInput): Promise<UploadEvalOutcome> {
  if (!input.sessionId || !input.filename) {
    return {
      verdict: 'error',
      note: 'Missing sessionId or filename',
      suggestedUses: [],
      durationMs: 0,
    }
  }

  // Full context — no briefBudget cap. CD has 1M tokens.
  const ctx = await buildCDContext(input.sessionId)

  const tagged = [
    '[OSKAR-SYSTEM EVAL-UPLOAD]',
    '',
    `Uploaded file: ${input.filename}`,
    `  (saved to public/${input.sessionId}/${input.filename} — open with FileRead before judging)`,
    '',
    ctx.size > 0 ? '---\nSession context:\n' + ctx.block : '',
    '',
    'Respond per the SYSTEM MESSAGES protocol in your agent file (## VERDICT, ## NOTE, ## SUGGESTED_USES).',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const result = await callCDBridge(input.sessionId, tagged)
    const parsed = parseUploadEvalResponse(result.text)
    return {
      verdict: parsed.verdict,
      note: parsed.note,
      suggestedUses: parsed.suggestedUses,
      durationMs: result.durationMs,
    }
  } catch (err) {
    console.error('[cd-upload-eval] Bridge call failed:', err)
    return {
      verdict: 'error',
      note: `Bridge error: ${err}`,
      suggestedUses: [],
      durationMs: 0,
    }
  }
}

interface ParsedUploadEval {
  verdict: '✓' | '≈' | '✗'
  note: string
  suggestedUses: string[]
}

function parseUploadEvalResponse(text: string): ParsedUploadEval {
  const verdictRaw = extractBlock(text, 'VERDICT') || ''
  const note = extractBlock(text, 'NOTE') || ''
  const usesRaw = extractBlock(text, 'SUGGESTED_USES') || ''

  let verdict: '✓' | '≈' | '✗' = '≈'
  const v = verdictRaw.trim()
  if (v.startsWith('✓') || /^pass\b|^ok\b|^good\b/i.test(v)) verdict = '✓'
  else if (v.startsWith('✗') || /^fail\b|^bad\b|^reject\b/i.test(v)) verdict = '✗'
  else if (v.startsWith('≈') || /^maybe\b|^okay\b|^usable\b/i.test(v)) verdict = '≈'

  const suggestedUses = usesRaw
    .split(/[,\n]/)
    .map((s) => s.trim().replace(/^[-•]\s*/, ''))
    .filter(Boolean)
    .slice(0, 6)

  return { verdict, note: note.trim(), suggestedUses }
}

function extractBlock(text: string, header: string): string | null {
  const re = new RegExp(`##\\s+${header}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i')
  const m = text.match(re)
  return m ? m[1].trim() : null
}
