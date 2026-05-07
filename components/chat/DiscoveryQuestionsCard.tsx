/**
 * DiscoveryQuestionsCard — structured questions panel from CD's
 * `ask_discovery_questions` MCP tool (Ralph 2026-05-04).
 *
 * Render slot: assistant-message companion. Source styling: `.tool-card`
 * chassis (app/globals.css, Ralph 2026-05-06: "style ALL of them according
 * to your mockup"). Mirrors docs/toolcards-mockup.html — neutral bento
 * card grammar with 22×22 icon, sans-serif title, mono meta, head/body/foot
 * dividers.
 *
 * Was: `.unfinished-todos` chassis (agency-tracker green-mono-uppercase).
 * Migrated 2026-05-06 — that styling is reserved for the TodoWrite panel
 * which is a different surface ("agent narrating itself" vs "agent asking
 * the user something").
 *
 * UX flow:
 *   1. CD calls ask_discovery_questions(questions[], context?).
 *   2. MCP route publishes `discovery_questions` event.
 *   3. page.tsx subscriber renders this card in the chat surface.
 *   4. User fills inputs, clicks Submit.
 *   5. onSubmit fires with a markdown numbered list of {Q: A} pairs;
 *      the parent posts that as a regular user message via handleSend.
 *   6. CD picks up the answers next turn — no special path needed.
 */
'use client'

import * as React from 'react'
import { useState } from 'react'

interface DiscoveryQuestionsCardProps {
  questions: string[]
  context?: string
  /**
   * Called with a single markdown-formatted user-message payload (numbered
   * list of "Q — A" pairs). The parent should pass this to handleSend so
   * CD sees it as a normal turn.
   */
  onSubmit: (formattedAnswers: string) => void
}

function formatAnswers(questions: string[], answers: string[]): string {
  // "1. Q1 — A1\n2. Q2 — A2\n…" — stable, parser-friendly, easy for CD
  // to reference by number. Skipped questions render as "(no answer)" so
  // CD can still see what was asked.
  const lines = questions.map((q, i) => {
    const a = (answers[i] || '').trim() || '(no answer)'
    return `${i + 1}. **${q}** — ${a}`
  })
  return `**My answers:**\n\n${lines.join('\n')}`
}

export function DiscoveryQuestionsCard({
  questions,
  context,
  onSubmit,
}: DiscoveryQuestionsCardProps) {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''))
  const [submitted, setSubmitted] = useState(false)

  if (questions.length === 0) return null

  const allEmpty = answers.every((a) => !a.trim())

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitted || allEmpty) return
    setSubmitted(true)
    onSubmit(formatAnswers(questions, answers))
  }

  return (
    <form
      className="tool-card discovery-questions"
      data-style="discovery"
      onSubmit={handleSubmit}
      role="form"
      aria-label="Discovery questions"
    >
      <div className="tool-card-head">
        <span className="tool-card-icon" data-accent="green" aria-hidden>?</span>
        <span className="tool-card-title">A few quick questions</span>
        <span className="tool-card-meta">{questions.length} {questions.length === 1 ? 'question' : 'questions'}</span>
      </div>
      <div className="tool-card-body">
        {context ? <p className="tool-card-context">{context}</p> : null}
        <ul className="tool-card-questions">
          {questions.map((q, i) => (
            <li key={`${i}-${q.slice(0, 16)}`}>
              <label htmlFor={`discovery-q-${i}`}>
                {q}
              </label>
              <input
                id={`discovery-q-${i}`}
                type="text"
                value={answers[i]}
                disabled={submitted}
                onChange={(e) => {
                  const next = [...answers]
                  next[i] = e.target.value
                  setAnswers(next)
                }}
                placeholder="Type your answer…"
              />
            </li>
          ))}
        </ul>
      </div>
      <div className="tool-card-foot">
        <button
          type="submit"
          className="tool-card-btn"
          data-variant="primary"
          disabled={submitted || allEmpty}
          aria-disabled={submitted || allEmpty}
        >
          {submitted ? 'Submitted ✓' : 'Submit answers'}
        </button>
      </div>
    </form>
  )
}
