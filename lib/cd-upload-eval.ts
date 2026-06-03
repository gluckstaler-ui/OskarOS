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
    'Respond by calling the `submit_upload_eval` MCP tool with structured ' +
    '{verdict, note, suggestedUses[]} args. Do NOT write `## VERDICT` / ' +
    '`## NOTE` / `## SUGGESTED_USES` headers in chat — those parsers were ' +
    'retired 2026-04-30 (Phase 2 MCP migration). The tool call IS the response.',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    // Ralph 2026-06-01 · useWorker:true routes through the per-session
    // worker bridge pool. N parallel uploads = N parallel CLI subprocesses
    // (capped at MAX_WORKERS_PER_SESSION=5). No withSessionLock, no
    // stacking on the main bridge's single stdin/stdout. The eval is
    // one-shot — no --resume context needed, the session ctx is already
    // inlined in `tagged` above via buildCDContext.
    const result = await callCDBridge(input.sessionId, tagged, {
      expectedTools: ['submit_upload_eval'],
      useWorker: true,
    })
    const args = (result.toolCalls.submit_upload_eval as UploadEvalToolArgs | undefined) || null
    if (!args) {
      console.warn(
        `[cd-upload-eval] CD did not call submit_upload_eval for session ${input.sessionId}.`,
      )
      return {
        verdict: '≈',
        note: 'CD did not commit to a structured upload-eval.',
        suggestedUses: [],
        durationMs: result.durationMs,
      }
    }
    return {
      verdict: normalizeVerdict(args.verdict),
      note: typeof args.note === 'string' ? args.note : '',
      suggestedUses: Array.isArray(args.suggestedUses)
        ? args.suggestedUses.filter((s): s is string => typeof s === 'string').slice(0, 6)
        : [],
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

// ─────────────────────────────────────────────────────────────────────────────
// Tool args shape — must match mcp-server/tools-cd.ts:submit_upload_eval.
// ─────────────────────────────────────────────────────────────────────────────

interface UploadEvalToolArgs {
  verdict: string
  note: string
  suggestedUses: unknown
}

function normalizeVerdict(v: unknown): '✓' | '≈' | '✗' {
  if (v === '✓' || v === '≈' || v === '✗') return v
  return '≈'
}
