/**
 * DiscoveryQuestionsCard — structured questions panel from CD's
 * `ask_discovery_questions` MCP tool (Ralph 2026-05-04).
 *
 * v2 (Ralph 2026-05-12): mixed-input form. The pre-2026-05-12 component
 * accepted only `string[]` and rendered one `<input type="text">` per
 * entry — multiple-choice questions collapsed into a single text box. The
 * mockup at docs/toolcards-mockup.html §discovery-card (lines 2015-2058)
 * specs the full grammar: text · textarea · radio · checkbox · select.
 * This rebuild branches on `q.kind` and matches the mockup's `.field`,
 * `.field .q`, `.field .req`, `.field .help`, `.field .radio-row`,
 * `label.selected` shape.
 *
 * Backwards compat: legacy `string` entries collapse to {kind:'text',
 * prompt}. Both shapes round-trip cleanly through the route + preview
 * gate.
 *
 * UX flow:
 *   1. CD calls ask_discovery_questions(questions[], context?, title?, progress?).
 *   2. MCP route validates per-kind shape, publishes `discovery_questions` event.
 *   3. page.tsx subscriber renders this card in the chat surface.
 *   4. User fills inputs, clicks Submit.
 *   5. onSubmit fires with a markdown numbered list of {Q: A} pairs;
 *      checkbox answers comma-join their selections.
 *   6. CD picks up the answers next turn — no special path needed.
 */
'use client'

import * as React from 'react'
import { useState } from 'react'
import type { DiscoveryQuestion, Preamble } from '@/lib/types'

interface DiscoveryQuestionsCardProps {
  /**
   * Each entry is either a string (text input) or a typed-question object.
   * Strings are normalised to {kind:'text', prompt} at the component
   * boundary so the renderer doesn't have to special-case downstream.
   */
  questions: Array<string | DiscoveryQuestion>
  /** CD-speaking preamble — "Why I'm asking" cyan callout. Per mockup §discovery-card. */
  preamble?: Preamble
  /** @deprecated — flat-string preamble. Use `preamble: {label, body}` instead. */
  context?: string
  /** Optional head-bar title. Defaults to "A few quick questions". */
  title?: string
  /** Optional progress chip (mockup: "step 1 / 3"). Pure cosmetic. */
  progress?: { current: number; total: number }
  /**
   * Called with a single markdown-formatted user-message payload (numbered
   * list of "Q — A" pairs). The parent passes this to handleSend so CD
   * sees it as a normal turn.
   */
  onSubmit: (formattedAnswers: string) => void
}

/**
 * Normalise legacy + new-shape entries to the typed union, dropping
 * anything that can't be salvaged. Mirrors the validator in
 * /api/mcp/ask-discovery-questions/route.ts but lives here too because
 * the `card_preview` synthetic-message path forwards `payload.questions`
 * opaquely (no route hits).
 */
function normaliseQuestions(raw: Array<string | DiscoveryQuestion> | undefined): DiscoveryQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: DiscoveryQuestion[] = []
  for (const q of raw) {
    if (typeof q === 'string') {
      const prompt = q.trim()
      if (prompt) out.push({ kind: 'text', prompt })
      continue
    }
    if (!q || typeof q !== 'object') continue
    const o = q as Record<string, unknown>
    const kind = String(o.kind ?? 'text').toLowerCase()
    const promptRaw = o.prompt ?? (o as Record<string, unknown>).question ?? (o as Record<string, unknown>).q ?? (o as Record<string, unknown>).text ?? (o as Record<string, unknown>).label
    const prompt = String(promptRaw ?? '').trim()
    if (!prompt) continue
    const required = o.required === true ? true : undefined
    const help = typeof o.help === 'string' && o.help.trim() ? o.help.trim() : undefined
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : undefined
    const placeholder = typeof o.placeholder === 'string' && o.placeholder.trim() ? o.placeholder.trim() : undefined

    if (kind === 'radio' || kind === 'select') {
      const options = Array.isArray(o.options)
        ? (o.options as unknown[]).map((v) => String(v ?? '').trim()).filter(Boolean)
        : []
      if (options.length === 0) continue
      const dv = typeof o.defaultValue === 'string' && options.includes(o.defaultValue) ? o.defaultValue : undefined
      out.push({ kind, prompt, id, required, help, options, defaultValue: dv })
      continue
    }
    if (kind === 'checkbox') {
      const options = Array.isArray(o.options)
        ? (o.options as unknown[]).map((v) => String(v ?? '').trim()).filter(Boolean)
        : []
      if (options.length === 0) continue
      const dv = Array.isArray(o.defaultValue)
        ? (o.defaultValue as unknown[]).map((v) => String(v ?? '').trim()).filter((v) => v && options.includes(v))
        : undefined
      out.push({ kind: 'checkbox', prompt, id, required, help, options, defaultValue: dv })
      continue
    }
    // text | textarea (default)
    const safeKind: 'text' | 'textarea' = kind === 'textarea' ? 'textarea' : 'text'
    const defaultValue = typeof o.defaultValue === 'string' ? o.defaultValue : undefined
    out.push({ kind: safeKind, prompt, id, required, help, placeholder, defaultValue })
  }
  return out
}

type AnswerState = { single: string } | { multi: string[] }

function initialAnswer(q: DiscoveryQuestion): AnswerState {
  if (q.kind === 'checkbox') {
    return { multi: Array.isArray(q.defaultValue) ? [...q.defaultValue] : [] }
  }
  return { single: typeof q.defaultValue === 'string' ? q.defaultValue : '' }
}

function answerToString(q: DiscoveryQuestion, a: AnswerState): string {
  if (q.kind === 'checkbox') {
    const vals = 'multi' in a ? a.multi : []
    return vals.length ? vals.join(', ') : ''
  }
  const v = 'single' in a ? a.single : ''
  return v.trim()
}

function formatAnswers(
  questions: DiscoveryQuestion[],
  answers: AnswerState[],
  freeform: string,
): string {
  // "1. **Q1** — A1\n2. **Q2** — A2\n…" — stable, parser-friendly. Skipped
  // questions render as "(no answer)" so CD can still see what was asked.
  const lines = questions.map((q, i) => {
    const a = answerToString(q, answers[i]).trim() || '(no answer)'
    return `${i + 1}. **${q.prompt}** — ${a}`
  })
  const ff = freeform.trim()
  const trailer = ff
    ? `\n\n**Thoughts, comments, anything else?**\n${ff}`
    : ''
  return `**My answers:**\n\n${lines.join('\n')}${trailer}`
}

function isAnswered(q: DiscoveryQuestion, a: AnswerState): boolean {
  return answerToString(q, a).length > 0
}

export function DiscoveryQuestionsCard({
  questions: rawQuestions,
  preamble,
  context,
  title,
  progress,
  onSubmit,
}: DiscoveryQuestionsCardProps) {
  const questions = normaliseQuestions(rawQuestions)
  const [answers, setAnswers] = useState<AnswerState[]>(() => questions.map(initialAnswer))
  const [freeform, setFreeform] = useState('')
  const [submitted, setSubmitted] = useState(false)

  if (questions.length === 0) return null

  // Ralph 2026-05-14 — no required-field gating in Discovery. The user
  // submits whatever they have; unfilled questions render as "(no answer)"
  // in the markdown payload so CD can still see what was asked. Discovery
  // is conversation, not a form — blocking on missing fields stalls the
  // flow when the user wants to type free-form thoughts instead.
  const allEmpty =
    answers.every((a, i) => !isAnswered(questions[i], a)) && !freeform.trim()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitted) return
    if (allEmpty) return
    setSubmitted(true)
    onSubmit(formatAnswers(questions, answers, freeform))
  }

  function updateSingle(i: number, v: string) {
    setAnswers((prev) => {
      const next = [...prev]
      next[i] = { single: v }
      return next
    })
  }
  function toggleMulti(i: number, opt: string) {
    setAnswers((prev) => {
      const next = [...prev]
      const cur = 'multi' in next[i] ? next[i].multi : []
      next[i] = cur.includes(opt)
        ? { multi: cur.filter((v) => v !== opt) }
        : { multi: [...cur, opt] }
      return next
    })
  }

  const headTitle = (title && title.trim()) || 'A few quick questions'
  const progressLabel = progress
    ? `step ${progress.current} / ${progress.total}`
    : `${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`

  return (
    <form
      className="discovery-card"
      data-style="discovery"
      onSubmit={handleSubmit}
      role="form"
      aria-label="Discovery questions"
    >
      <div className="head">
        <span className="glyph" aria-hidden>?</span>
        <span className="title">{headTitle}</span>
        <span className="progress">{progressLabel}</span>
      </div>
      {/* CD-speaking preamble — cyan callout above the questions per mockup §discovery-card.
          Structured {label, body} preferred; legacy flat-string `context` falls back. */}
      {preamble ? (
        <div className="context">
          <span className="preamble-label">{preamble.label}</span>
          <span className="preamble-body">{preamble.body}</span>
        </div>
      ) : context ? (
        <div className="context">
          <span className="preamble-body">{context}</span>
        </div>
      ) : null}

      <div className="fields">
        {questions.map((q, i) => {
          const fieldId = q.id || `discovery-q-${i}`
          const a = answers[i]
          const single = 'single' in a ? a.single : ''
          const multi = 'multi' in a ? a.multi : []
          const isReq = q.required === true
          return (
            <div className="field" key={`${i}-${q.kind}-${q.prompt.slice(0, 16)}`}>
              <label className="q" htmlFor={fieldId}>
                <span>{q.prompt}</span>
                {isReq ? <span className="req" aria-label="required">*</span> : null}
              </label>
              {q.help ? <span className="help">{q.help}</span> : null}
              {q.kind === 'text' ? (
                <input
                  id={fieldId}
                  type="text"
                  value={single}
                  disabled={submitted}
                  placeholder={q.placeholder || 'Type your answer…'}
                  onChange={(e) => updateSingle(i, e.target.value)}
                />
              ) : null}
              {q.kind === 'textarea' ? (
                <textarea
                  id={fieldId}
                  value={single}
                  disabled={submitted}
                  placeholder={q.placeholder || 'Type your answer…'}
                  onChange={(e) => updateSingle(i, e.target.value)}
                />
              ) : null}
              {q.kind === 'radio' ? (
                <div className="radio-row" role="radiogroup" aria-labelledby={fieldId}>
                  {q.options.map((opt) => {
                    const selected = single === opt
                    return (
                      <label key={opt} className={selected ? 'selected' : ''}>
                        <input
                          type="radio"
                          name={fieldId}
                          value={opt}
                          checked={selected}
                          disabled={submitted}
                          onChange={() => updateSingle(i, opt)}
                        />
                        {opt}
                      </label>
                    )
                  })}
                </div>
              ) : null}
              {q.kind === 'checkbox' ? (
                <div className="radio-row checkbox-row" role="group" aria-labelledby={fieldId}>
                  {q.options.map((opt) => {
                    const selected = multi.includes(opt)
                    return (
                      <label key={opt} className={selected ? 'selected' : ''}>
                        <input
                          type="checkbox"
                          name={fieldId}
                          value={opt}
                          checked={selected}
                          disabled={submitted}
                          onChange={() => toggleMulti(i, opt)}
                        />
                        {opt}
                      </label>
                    )
                  })}
                </div>
              ) : null}
              {q.kind === 'select' ? (
                <select
                  id={fieldId}
                  value={single}
                  disabled={submitted}
                  onChange={(e) => updateSingle(i, e.target.value)}
                >
                  <option value="">Choose one…</option>
                  {q.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : null}
            </div>
          )
        })}
      </div>

      {/* Free-text catch-all — required by toolcard doctrine (creative-director-agent.md §workflow).
          Every user-input card carries a "Thoughts, comments, anything else?" textarea at the bottom
          so the user can add nuance no checkbox could capture. Empty by default; if filled, it
          appends a labeled trailer to the submitted answers. */}
      <div className="freeform">
        <label className="q" htmlFor="discovery-freeform">
          Thoughts, comments, anything else?
        </label>
        <textarea
          id="discovery-freeform"
          value={freeform}
          disabled={submitted}
          placeholder="Anything the questions above missed…"
          onChange={(e) => setFreeform(e.target.value)}
        />
      </div>

      <div className="foot">
        <button
          type="submit"
          className="btn primary"
          disabled={submitted || allEmpty}
          aria-disabled={submitted || allEmpty}
        >
          {submitted ? 'Submitted ✓' : 'Submit answers'}
        </button>
      </div>

      <style jsx>{`
        .discovery-card {
          background: var(--bg-card, #1e1e22);
          border: 1px solid var(--border-card, rgba(255, 255, 255, 0.08));
          border-radius: var(--radius-card, 10px);
          padding: 18px;
          box-shadow: var(--shadow-card, 0 1px 2px rgba(0, 0, 0, 0.3));
          display: flex;
          flex-direction: column;
        }
        .head {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border-card, rgba(255, 255, 255, 0.08));
          margin-bottom: 14px;
        }
        .head .glyph {
          color: var(--brand-green-bright, #15b981);
          font-size: 14px;
          font-weight: 600;
        }
        .head .title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-main, #f5f5f7);
        }
        .head .progress {
          margin-left: auto;
          font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
          font-size: 10px;
          color: var(--text-faint, rgba(255, 255, 255, 0.45));
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        /* CD-speaking preamble — cyan border-left, "CD speaking" universal
           channel per mockup §discovery-card. Structured {label, body}: the
           label is a mono-caps role tag (cyan), the body is prose. */
        .context {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 13px;
          color: var(--text-main, #f5f5f7);
          line-height: 1.55;
          margin-bottom: 16px;
          padding: 12px 14px;
          border-left: 2px solid var(--brand-cyan, #22d3ee);
          background: rgba(34, 211, 238, 0.04);
          border-radius: 0 8px 8px 0;
        }
        .context .preamble-label {
          font-size: 10px;
          color: var(--brand-cyan, #22d3ee);
          font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-weight: 700;
        }
        .context .preamble-body {
          color: var(--text-main, #f5f5f7);
        }
        .fields {
          display: flex;
          flex-direction: column;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 16px;
        }
        .field:last-child {
          margin-bottom: 0;
        }
        .q {
          font-size: 13px;
          color: var(--text-main, #f5f5f7);
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .q .req {
          color: var(--brand-red, #ef4444);
          font-size: 11px;
        }
        .help {
          font-size: 11px;
          color: var(--text-faint, rgba(255, 255, 255, 0.45));
        }
        .field input[type='text'],
        .field textarea,
        .field select {
          background: var(--bg-card, #1e1e22);
          border: 1px solid var(--border-card, rgba(255, 255, 255, 0.08));
          color: var(--text-main, #f5f5f7);
          padding: 10px 12px;
          border-radius: 6px;
          font-family: inherit;
          font-size: 13px;
          width: 100%;
          box-sizing: border-box;
        }
        .field input[type='text']:focus,
        .field textarea:focus,
        .field select:focus {
          outline: none;
          border-color: var(--brand-green-bright, #15b981);
        }
        /* Defeat Chrome's -webkit-autofill light-blue/yellow background that
           ignores the 'background' property. Inset box-shadow is the only
           reliable override. Tied to --bg-card so it adapts to theme:
           dark in Onyx, light in Polar. Long transition delays the
           browser's eventual revert to its own colors. */
        .field input[type='text']:-webkit-autofill,
        .field input[type='text']:-webkit-autofill:hover,
        .field input[type='text']:-webkit-autofill:focus,
        .field input[type='text']:-webkit-autofill:active,
        .field textarea:-webkit-autofill,
        .field textarea:-webkit-autofill:hover,
        .field textarea:-webkit-autofill:focus,
        .field select:-webkit-autofill {
          -webkit-box-shadow: 0 0 0 1000px var(--bg-card, #1e1e22) inset;
          box-shadow: 0 0 0 1000px var(--bg-card, #1e1e22) inset;
          -webkit-text-fill-color: var(--text-main, #f5f5f7);
          caret-color: var(--text-main, #f5f5f7);
          transition: background-color 600000s 0s, color 600000s 0s;
        }
        .field textarea {
          min-height: 60px;
          resize: vertical;
        }
        /* Block layout, not flex — flex children default to min-width:auto
           which is the textarea's intrinsic (cols-based) width, defeating
           width:100%. Matching the working .dd-textarea-wrap pattern in
           DesignDirectionsCard. */
        .freeform {
          display: block;
          margin-top: 18px;
          padding-top: 16px;
          border-top: 1px dashed var(--border-card, rgba(255, 255, 255, 0.08));
        }
        .freeform .q {
          margin-bottom: 6px;
        }
        .freeform textarea {
          display: block;
          width: 100%;
          box-sizing: border-box;
          min-width: 0;
          background: var(--bg-card, #1e1e22);
          border: 1px solid var(--border-card, rgba(255, 255, 255, 0.08));
          color: var(--text-main, #f5f5f7);
          padding: 10px 12px;
          border-radius: 6px;
          font-family: inherit;
          font-size: 13px;
          min-height: 60px;
          resize: vertical;
        }
        .freeform textarea:focus {
          outline: none;
          border-color: var(--brand-green-bright, #15b981);
        }
        .freeform textarea:-webkit-autofill,
        .freeform textarea:-webkit-autofill:hover,
        .freeform textarea:-webkit-autofill:focus,
        .freeform textarea:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px var(--bg-card, #1e1e22) inset;
          box-shadow: 0 0 0 1000px var(--bg-card, #1e1e22) inset;
          -webkit-text-fill-color: var(--text-main, #f5f5f7);
          caret-color: var(--text-main, #f5f5f7);
          transition: background-color 600000s 0s, color 600000s 0s;
        }
        .radio-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .radio-row label {
          padding: 8px 14px;
          background: var(--bg-card, #1e1e22);
          border: 1px solid var(--border-card, rgba(255, 255, 255, 0.08));
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          color: var(--text-main, #f5f5f7);
          user-select: none;
          display: inline-flex;
          align-items: center;
        }
        .radio-row label.selected {
          background: rgba(21, 185, 129, 0.12);
          border-color: var(--brand-green-bright, #15b981);
          color: var(--brand-green-bright, #15b981);
        }
        .radio-row input {
          display: none;
        }
        .foot {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 12px;
          padding-top: 14px;
          border-top: 1px solid var(--border-card, rgba(255, 255, 255, 0.08));
          margin-top: 4px;
        }
        .btn.primary {
          background: var(--brand-green-bright, #15b981);
          color: #0a0a0a;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.12s ease;
        }
        .btn.primary:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </form>
  )
}
