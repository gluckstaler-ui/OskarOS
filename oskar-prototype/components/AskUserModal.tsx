'use client'

/**
 * AskUserModal — Phase 2 Tier S (2026-04-30).
 *
 * Subscribes to `cd.ask-user` events from session-events. When an agent
 * calls the `ask_user` MCP tool, the backend route fires the event with
 * `{requestId, question, options}`. We render a modal, the user picks an
 * option, we POST to `/api/mcp/ask-user-response/{requestId}` to resolve
 * the agent's blocked tool call.
 *
 * Self-contained: no props, no external state. Drop into the page tree
 * and it works.
 */

import { useEffect, useState } from 'react'
import { sessionEvents } from '@/lib/session-events'

interface AskState {
  requestId: string
  question: string
  options: string[]
  sessionId: string
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
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 3000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => {
        // Click outside the card cancels (agent receives __cancelled__ on timeout).
        if (e.target === e.currentTarget) setAsk(null)
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          background: 'var(--bg-card, #18181b)',
          color: 'var(--text-main, #f4f4f5)',
          border: '1px solid var(--border-card, #27272a)',
          borderRadius: 12,
          padding: '20px 24px',
          minWidth: 380,
          maxWidth: 560,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          fontFamily: 'var(--font-sans, Inter, sans-serif)',
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: 2,
            fontWeight: 700,
            textTransform: 'uppercase',
            color: 'var(--accent, #3B82F6)',
            marginBottom: 8,
          }}
        >
          CD asks
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 16 }}>{ask.question}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ask.options.map((opt) => (
            <button
              key={opt}
              onClick={() => pick(opt)}
              disabled={submitting}
              style={{
                textAlign: 'left',
                padding: '10px 14px',
                background: 'var(--bg-card-hover, #27272a)',
                border: '1px solid var(--border-card, #27272a)',
                borderRadius: 8,
                color: 'inherit',
                cursor: submitting ? 'wait' : 'pointer',
                fontSize: 14,
                fontFamily: 'inherit',
                opacity: submitting ? 0.5 : 1,
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!submitting) {
                  e.currentTarget.style.background = 'var(--accent-dim, rgba(59,130,246,0.15))'
                  e.currentTarget.style.borderColor = 'var(--accent, #3B82F6)'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-card-hover, #27272a)'
                e.currentTarget.style.borderColor = 'var(--border-card, #27272a)'
              }}
            >
              {opt}
            </button>
          ))}
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 11,
            color: 'var(--text-dim, #52525b)',
            textAlign: 'right',
          }}
        >
          Click outside to cancel
        </div>
      </div>
    </div>
  )
}
