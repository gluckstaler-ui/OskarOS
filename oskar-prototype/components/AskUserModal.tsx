'use client'

/**
 * AskUserModal — Phase 2 Tier S (2026-04-30).
 * 2026-05-03 redesign — uses shared `.modal-backdrop` / `.modal` classes
 * from globals.css plus the new `.os-ask-*` block. Eyebrow shifted from
 * blue --accent (which was repointed off the OskarOS palette) to
 * --brand-green-bright. Option buttons now carry Feather icons.
 *
 * Subscribes to `cd.ask-user` events. When an agent calls the `ask_user`
 * MCP tool, the backend route fires the event with `{requestId, question,
 * options}`. We render a modal, the user picks an option, we POST to
 * `/api/mcp/ask-user-response/{requestId}` to resolve the agent's
 * blocked tool call.
 *
 * Self-contained: no props, no external state.
 */

import { useEffect, useState } from 'react'
import { sessionEvents } from '@/lib/session-events'
import { Feather, FeatherName } from './Feather'

interface AskState {
  requestId: string
  question: string
  options: string[]
  sessionId: string
}

/** Heuristic: pick a Feather icon for an option string. Falls back to
 *  a neutral chevron-style "play" arrow if no keyword matches. The point
 *  is to give each option a glance-tell, not to be exhaustive. */
function iconForOption(opt: string): FeatherName {
  const o = opt.toLowerCase()
  if (/(commit|confirm|yes|approve|ok\b|ship|send|do it)/.test(o)) return 'check'
  if (/(cancel|abort|no\b|skip|nope|never)/.test(o)) return 'x'
  if (/(retry|again|iterate|redo|regenerate|rerun)/.test(o)) return 'rotate-cw'
  if (/(refresh|reload|rejuvenate|reset)/.test(o)) return 'refresh-cw'
  if (/(image|photo|picture|render)/.test(o)) return 'image'
  if (/(info|detail|learn more|explain)/.test(o)) return 'info'
  if (/(warn|caution|careful)/.test(o)) return 'alert-triangle'
  return 'play'
}

export function AskUserModal() {
  const [ask, setAsk] = useState<AskState | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const unsub = sessionEvents.on('cd.ask-user', (event) => {
      const data = event.data as {
        requestId?: string
        question?: string
        options?: string[]
      }
      if (!data?.requestId || !data.question || !Array.isArray(data.options)) return
      setAsk({
        requestId: data.requestId,
        question: data.question,
        options: data.options,
        sessionId: event.sessionId,
      })
    })
    return unsub
  }, [])

  // Auto-close when the agent's tool call resolves (e.g. another caller
  // already answered, or the 10-min timeout fired).
  useEffect(() => {
    const unsub = sessionEvents.on('cd.ask-user-resolved', () => setAsk(null))
    return unsub
  }, [])

  // ESC closes (treat as cancel — backend will get __cancelled__ on timeout)
  useEffect(() => {
    if (!ask) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAsk(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ask])

  async function pick(value: string) {
    if (!ask || submitting) return
    setSubmitting(true)
    // Test harness opt-out: requestIds prefixed `test-` are emitted by
    // /test-ui without ever going through the `ask_user` MCP tool, so
    // /api/mcp/ask-user-response would always 404 for them. Skip the POST
    // entirely — close the modal locally and log to the console for
    // visibility. Real production requestIds (UUID-shaped) hit the route.
    if (ask.requestId.startsWith('test-')) {
      console.info(`[AskUserModal] test pick: ${ask.requestId} → "${value}" (no POST)`)
      setSubmitting(false)
      setAsk(null)
      return
    }
    try {
      const r = await fetch(`/api/mcp/ask-user-response/${encodeURIComponent(ask.requestId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      if (!r.ok) {
        console.error('[AskUserModal] response POST failed:', r.status, await r.text())
      }
    } catch (err) {
      console.error('[AskUserModal] response POST error:', err)
    } finally {
      setSubmitting(false)
      setAsk(null)
    }
  }

  if (!ask) return null

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) setAsk(null)
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="os-ask-eyebrow">
          <Feather name="message-circle" size={11} strokeWidth={2.5} />
          CD asks
        </div>
        <div className="os-ask-question">{ask.question}</div>
        <div className="os-ask-options">
          {ask.options.map((opt) => (
            <button
              key={opt}
              type="button"
              className="os-ask-option"
              disabled={submitting}
              onClick={() => pick(opt)}
            >
              <Feather name={iconForOption(opt)} size={14} strokeWidth={2.25} />
              <span>{opt}</span>
            </button>
          ))}
        </div>
        <div className="os-ask-foot">ESC or click outside to cancel</div>
      </div>
    </div>
  )
}
