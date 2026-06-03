/**
 * /api/mcp/ask-discovery-questions — Phase 2 (Ralph 2026-05-04).
 *
 * The CD agent calls `ask_discovery_questions(questions[], context?, ...)`
 * via MCP during initial brand discovery. The MCP server's tool handler
 * POSTs here; this route publishes a `discovery_questions` event to the
 * per-session event bus. The frontend's /api/events SSE delivers it;
 * <DiscoveryQuestionsCard> renders mixed input types. User submits →
 * handleSend posts the answers as a normal user message so CD picks them
 * up next turn.
 *
 * Ralph 2026-05-12 — schema widened. Each question is either a bare
 * string (text input) or a typed `DiscoveryQuestion` object. Per-kind
 * validation lives here; the renderer trusts whatever the route emits.
 * Mockup §discovery-card (docs/toolcards-mockup.html:2015-2058) is the
 * spec for the mixed-input form.
 *
 * Mirrors /api/mcp/snackbar/route.ts shape.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/event-bus'
import type { DiscoveryQuestion } from '@/lib/types'
import { parsePreamble } from '@/lib/preamble'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPTION_KINDS = new Set(['radio', 'checkbox', 'select'])
const ALL_KINDS = new Set(['text', 'textarea', 'radio', 'checkbox', 'select'])

/**
 * Normalise one entry to a typed DiscoveryQuestion or `null` (rejected).
 *
 * Strings collapse to {kind:'text', prompt}. Object entries must declare
 * a known kind; radio/checkbox/select must also carry a non-empty
 * `options[]`. Common LLM-emit prompt aliases (`question`, `q`, `text`)
 * are accepted as a fallback for `prompt` so a careless agent doesn't
 * silently render an empty label.
 */
function validateQuestion(raw: unknown): DiscoveryQuestion | null {
  if (typeof raw === 'string') {
    const prompt = raw.trim()
    return prompt ? { kind: 'text', prompt } : null
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const kind = String(o.kind ?? 'text').toLowerCase()
  if (!ALL_KINDS.has(kind)) return null

  const promptRaw = o.prompt ?? o.question ?? o.q ?? o.text ?? o.label
  const prompt = String(promptRaw ?? '').trim()
  if (!prompt) return null

  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : undefined
  const required = o.required === true ? true : undefined
  const help = typeof o.help === 'string' && o.help.trim() ? o.help.trim() : undefined
  const placeholder = typeof o.placeholder === 'string' && o.placeholder.trim()
    ? o.placeholder.trim() : undefined

  if (OPTION_KINDS.has(kind)) {
    const optionsRaw = Array.isArray(o.options) ? o.options : []
    const options = optionsRaw.map((v) => String(v ?? '').trim()).filter(Boolean)
    if (options.length === 0) return null

    if (kind === 'checkbox') {
      const defaultValue = Array.isArray(o.defaultValue)
        ? (o.defaultValue as unknown[]).map((v) => String(v ?? '').trim()).filter((v) => v && options.includes(v))
        : undefined
      return { kind: 'checkbox', prompt, id, required, help, options, defaultValue }
    }
    // radio | select
    const dv = typeof o.defaultValue === 'string' && options.includes(o.defaultValue)
      ? o.defaultValue : undefined
    return { kind: kind as 'radio' | 'select', prompt, id, required, help, options, defaultValue: dv }
  }

  // text | textarea
  const defaultValue = typeof o.defaultValue === 'string' ? o.defaultValue : undefined
  return { kind: kind as 'text' | 'textarea', prompt, id, required, help, placeholder, defaultValue }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | {
        sessionId?: string
        questions?: unknown
        context?: unknown
        title?: unknown
        progress?: unknown
        preamble?: unknown
      }
    | null
  if (!body?.sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  if (!Array.isArray(body.questions) || body.questions.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'questions must be a non-empty array' },
      { status: 400 },
    )
  }
  const questions = body.questions
    .map(validateQuestion)
    .filter((q): q is DiscoveryQuestion => q !== null)
  if (questions.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'questions array contains no valid entries — each must be a non-empty string ' +
          'or {kind, prompt, ...} object (radio/checkbox/select require non-empty options[])',
      },
      { status: 400 },
    )
  }
  const context = typeof body.context === 'string' && body.context.trim()
    ? body.context.trim() : undefined
  const title = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim() : undefined
  const progress =
    body.progress && typeof body.progress === 'object'
      ? (() => {
          const p = body.progress as { current?: unknown; total?: unknown }
          if (typeof p.current === 'number' && typeof p.total === 'number') {
            return { current: p.current, total: p.total }
          }
          return undefined
        })()
      : undefined

  const preamble = parsePreamble(body.preamble)

  publish(body.sessionId, {
    type: 'discovery_questions',
    questions,
    context,
    title,
    progress,
    preamble,
  } as Parameters<typeof publish>[1])

  return NextResponse.json({ ok: true, questionCount: questions.length })
}
