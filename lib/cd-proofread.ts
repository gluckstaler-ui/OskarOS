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
    'Respond by calling the `submit_proofread` MCP tool with structured ' +
    '{severity, note, rewrittenPrompt?} args. Do NOT write `## SEVERITY` / ' +
    '`## NOTE` / `## REWRITTEN_PROMPT` headers in chat — those parsers were ' +
    'retired 2026-04-30 (Phase 2 MCP migration). The tool call IS the response.',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const result = await callCDBridge(input.sessionId, tagged, {
      expectedTools: ['submit_proofread'],
    })
    const args = (result.toolCalls.submit_proofread as ProofreadToolArgs | undefined) || null
    if (!args) {
      // CD didn't call the tool — treat as advisory pass-through. Logging
      // surfaces the failure so we can tune the agent prompt or retry.
      console.warn(
        `[cd-proofread] CD did not call submit_proofread for session ${input.sessionId}. ` +
        `text length=${result.text.length}, events=${result.events.length}`,
      )
      return {
        finalPrompt: input.prompt,
        severity: 'advisory',
        note: 'CD did not commit to a structured proofread; passing prompt through.',
        durationMs: result.durationMs,
      }
    }
    const severity = normalizeSeverity(args.severity)
    return {
      finalPrompt:
        severity === 'rewritten' && args.rewrittenPrompt ? args.rewrittenPrompt : input.prompt,
      severity,
      note: args.note || '',
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
// Tool args shape — must match mcp-server/tools-cd.ts:submit_proofread schema.
// ─────────────────────────────────────────────────────────────────────────────

interface ProofreadToolArgs {
  severity: string
  note: string
  rewrittenPrompt?: string
}

function normalizeSeverity(s: unknown): ProofreadOutcome['severity'] {
  if (s === 'pass' || s === 'advisory' || s === 'rewritten') return s
  // Defensive: malformed severity from a misbehaving agent → advisory so the
  // prompt still goes through but the caller knows something was off.
  return 'advisory'
}

function buildStagedImagesText(staged: { scene?: string; subjects?: string[] }): string {
  const parts: string[] = []
  if (staged.scene) parts.push(`Scene: ${staged.scene}`)
  if (staged.subjects?.length) parts.push(`Subjects: ${staged.subjects.join(', ')}`)
  return parts.length ? parts.join('\n') : ''
}
