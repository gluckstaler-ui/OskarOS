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
    'Respond by calling the `submit_image_verdict` MCP tool with structured ' +
    '{verdict, note, adjustedDescription?} args. Do NOT write `## VERDICT` / ' +
    '`## NOTE` / `## ADJUSTED_DESCRIPTION` headers in chat — those parsers ' +
    'were retired 2026-04-30 (Phase 2 MCP migration). The tool call IS the response.',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const result = await callCDBridge(input.sessionId, tagged, {
      expectedTools: ['submit_image_verdict'],
    })
    const args = (result.toolCalls.submit_image_verdict as VerdictToolArgs | undefined) || null
    if (!args) {
      console.warn(
        `[cd-verdict] CD did not call submit_image_verdict for session ${input.sessionId}. ` +
        `Defaulting to '≈' so the caller can decide.`,
      )
      return {
        verdict: '≈',
        note: 'CD did not commit to a structured verdict.',
        durationMs: result.durationMs,
      }
    }
    return {
      verdict: normalizeVerdict(args.verdict),
      note: typeof args.note === 'string' ? args.note : '',
      adjustedDescription: args.adjustedDescription || undefined,
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
// Tool args shape — must match mcp-server/tools-cd.ts:submit_image_verdict.
// ─────────────────────────────────────────────────────────────────────────────

interface VerdictToolArgs {
  verdict: string
  note: string
  adjustedDescription?: string
}

function normalizeVerdict(v: unknown): '✓' | '≈' | '✗' {
  if (v === '✓' || v === '≈' || v === '✗') return v
  // Defensive fallback: ambiguous verdict from a misbehaving agent.
  return '≈'
}
