/**
 * lib/cd-proofread.ts — extracted from /api/cd-evaluate-prompt route 2026-04-17
 *
 * Pure server-side function so callers can run a proofread WITHOUT an HTTP
 * round-trip (e.g. /api/edit-image calls this inline before sending to Nano).
 * The /api/cd-evaluate-prompt route is now a thin wrapper around this.
 *
 * Per WP-15: all CD work goes through the same bridge — Big CD only.
 */

import { callCDBridge } from './cd-bridge-call'
import { buildCDContext } from './cd-context'

export interface ProofreadInput {
  sessionId: string
  mode: 'generate' | 'edit' | 'compose' | 'layout' | 'brand'
  prompt: string
  image?: { filename: string; description?: string }
  stagedImages?: { scene?: string; subjects?: string[] }
}

export interface ProofreadOutcome {
  finalPrompt: string
  severity: 'pass' | 'advisory' | 'rewritten' | 'error'
  note: string
  durationMs: number
}

/**
 * Run a proofread. Blocks until CD replies — no timeout.
 * If the bridge errors out (process died, parse failure), returns
 * severity 'error' with the input prompt unchanged so the caller can
 * decide whether to fail the request or proceed cautiously.
 */
export async function runProofread(input: ProofreadInput): Promise<ProofreadOutcome> {
  if (!input.sessionId || !input.prompt) {
    return {
      finalPrompt: input.prompt || '',
      severity: 'error',
      note: 'Missing sessionId or prompt',
      durationMs: 0,
    }
  }

  const ctx = await buildCDContext(input.sessionId)
  const stagedImagesText = input.stagedImages ? buildStagedImagesText(input.stagedImages) : ''

  const tagged = [
    '[OSKAR-SYSTEM PROOFREAD]',
    '',
    `Mode: ${input.mode}`,
    input.image
      ? `Image in focus: ${input.image.filename}` +
        (input.image.description ? `\n  Description: ${input.image.description}` : '')
      : '',
    stagedImagesText,
    '',
    'Prompt to proofread:',
    '```',
    input.prompt,
    '```',
    '',
    ctx.size > 0 ? '---\nContext for your judgment:\n' + ctx.block : '',
    '',
    'Respond with the three blocks per the SYSTEM MESSAGES protocol in your agent file (## SEVERITY, ## NOTE, ## REWRITTEN_PROMPT).',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const result = await callCDBridge(input.sessionId, tagged)
    const parsed = parseProofreadResponse(result.text)
    return {
      finalPrompt:
        parsed.severity === 'rewritten' && parsed.rewritten ? parsed.rewritten : input.prompt,
      severity: parsed.severity,
      note: parsed.note,
      durationMs: result.durationMs,
    }
  } catch (err) {
    console.error('[cd-proofread] Bridge call failed:', err)
    return {
      finalPrompt: input.prompt,
      severity: 'error',
      note: `Bridge error: ${err}`,
      durationMs: 0,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing — generous: tolerates missing blocks / surrounding whitespace.
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedProofread {
  severity: 'pass' | 'advisory' | 'rewritten'
  note: string
  rewritten: string
}

function parseProofreadResponse(text: string): ParsedProofread {
  const sev = extractBlock(text, 'SEVERITY')
    ?.toLowerCase()
    .trim() as ParsedProofread['severity'] | undefined
  const note = extractBlock(text, 'NOTE')?.trim() || ''
  const rewritten = extractBlock(text, 'REWRITTEN_PROMPT')?.trim() || ''

  let severity: ParsedProofread['severity']
  if (rewritten) severity = 'rewritten'
  else if (sev === 'advisory' || sev === 'pass' || sev === 'rewritten') severity = sev
  else severity = note ? 'advisory' : 'pass'

  return { severity, note, rewritten }
}

function extractBlock(text: string, header: string): string | null {
  const re = new RegExp(`##\\s+${header}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i')
  const m = text.match(re)
  return m ? m[1].trim() : null
}

function buildStagedImagesText(staged: { scene?: string; subjects?: string[] }): string {
  const parts: string[] = []
  if (staged.scene) parts.push(`Scene: ${staged.scene}`)
  if (staged.subjects?.length) parts.push(`Subjects: ${staged.subjects.join(', ')}`)
  return parts.length ? parts.join('\n') : ''
}
