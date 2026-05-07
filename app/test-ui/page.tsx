'use client'

/**
 * /test-ui — Snackbar + Modal testing harness.
 *
 * Exercises every Snackbar severity × sticky combination, every action
 * configuration, every stacking edge case, and every AskUserModal shape
 * (2 options, many options, long question, long labels, click-outside cancel).
 *
 * Two firing paths per snackbar test:
 *   IN-PROCESS — calls `useSnackbar().show()` directly (no SSE round-trip).
 *   ROUND-TRIP — POSTs to `/api/mcp/snackbar` so we exercise route → event-bus
 *                → SSE → SnackbarProvider. Use this to validate the full chain
 *                (severity normalization, sticky undefined-passthrough, etc.).
 *
 * Modal tests fire `cd.ask-user` events directly via sessionEvents.emit().
 * The AskUserModal mounted in app/page.tsx listens — so to test the modal,
 * open this page in one tab and the main page in another, OR mount the modal
 * here. We mount it here for convenience.
 */

import { useState, useRef, useEffect } from 'react'
import { useSnackbar } from '@/components/SnackbarProvider'
import { AskUserModal } from '@/components/AskUserModal'
import { sessionEvents } from '@/lib/session-events'

const TEST_SESSION_ID = '__test-ui__'

type Severity = 'info' | 'success' | 'progress' | 'warning' | 'error'

const SECTIONS_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
  gap: 20,
  padding: 24,
  fontFamily: 'var(--font-sans, Inter, sans-serif)',
  background: '#0a0a0a',
  color: '#f4f4f5',
  minHeight: '100vh',
}

const CARD_STYLE: React.CSSProperties = {
  background: '#18181b',
  border: '1px solid #27272a',
  borderRadius: 12,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const H2: React.CSSProperties = {
  fontSize: 13,
  letterSpacing: 1.5,
  textTransform: 'uppercase',
  fontWeight: 700,
  color: '#a1a1aa',
  marginBottom: 4,
}

const ROW: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
}

const NOTE: React.CSSProperties = {
  fontSize: 11,
  color: '#71717a',
  lineHeight: 1.4,
}

const SEVERITY_COLORS: Record<Severity, string> = {
  info: '#3b82f6',
  success: '#22c55e',
  progress: '#06b6d4',
  warning: '#eab308',
  error: '#ef4444',
}

function btn(color: string): React.CSSProperties {
  return {
    background: 'transparent',
    color: color,
    border: `1px solid ${color}55`,
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
  }
}

export default function TestUIPage() {
  const { show, dismiss, dismissAll, update } = useSnackbar()
  const [useRoute, setUseRoute] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const counterRef = useRef(0)

  function appendLog(msg: string) {
    setLog((prev) => [`${new Date().toLocaleTimeString()} · ${msg}`, ...prev].slice(0, 40))
  }

  // Stable ref to appendLog so the SSE effect doesn't churn on every log change.
  const appendLogRef = useRef(appendLog)
  appendLogRef.current = appendLog

  // ── SSE bridge — closes the round-trip loop ──────────────────────────────
  // /api/mcp/snackbar publishes to the per-session event-bus for sessionId.
  // Without an SSE subscriber on this page, nothing arrives. Subscribe to
  // /api/events?session=<TEST_SESSION_ID> and translate `cd_snackbar` /
  // `cd_ask_user` payloads into sessionEvents.emit() so the local
  // SnackbarProvider + AskUserModal render them. Mirrors the bridge in
  // app/page.tsx (around line 794-820).
  const [sseStatus, setSseStatus] = useState<'idle' | 'open' | 'error'>('idle')
  useEffect(() => {
    const url = `/api/events?session=${encodeURIComponent(TEST_SESSION_ID)}`
    const es = new EventSource(url)
    es.onopen = () => {
      setSseStatus('open')
      appendLogRef.current(`SSE open · session=${TEST_SESSION_ID}`)
    }
    es.onmessage = (msg) => {
      let payload: any
      try {
        payload = JSON.parse(msg.data)
      } catch {
        return
      }
      switch (payload.type) {
        case 'connected':
          appendLogRef.current(`SSE connected ack`)
          break
        case 'cd_snackbar':
          sessionEvents.emit({
            type: 'cd.snackbar',
            sessionId: TEST_SESSION_ID,
            data: {
              text: payload.text,
              severity: payload.severity || 'info',
              ...(typeof payload.sticky === 'boolean'
                ? { sticky: payload.sticky }
                : {}),
            },
          })
          appendLogRef.current(
            `SSE recv cd_snackbar · ${payload.severity}${
              typeof payload.sticky === 'boolean'
                ? payload.sticky
                  ? '+sticky'
                  : '-sticky'
                : ''
            } · "${String(payload.text).slice(0, 48)}"`
          )
          break
        case 'cd_ask_user':
          sessionEvents.emit({
            type: 'cd.ask-user',
            sessionId: TEST_SESSION_ID,
            data: {
              requestId: payload.requestId,
              question: payload.question,
              options: payload.options,
            },
          })
          appendLogRef.current(`SSE recv cd_ask_user · ${payload.requestId}`)
          break
        default:
          appendLogRef.current(`SSE recv ${payload.type}`)
      }
    }
    es.onerror = () => {
      setSseStatus('error')
      // Don't spam the log — EventSource auto-reconnects and will fire
      // onerror repeatedly during dev-server hot-reloads.
    }
    return () => {
      es.close()
      setSseStatus('idle')
    }
  }, [])

  // ── Snackbar firing ──────────────────────────────────────────────────────
  // Two paths: in-process (direct show) and round-trip (POST to /api/mcp/snackbar).

  async function fireSnackbar(
    severity: Severity,
    text: string,
    opts?: { sticky?: boolean; actions?: { label: string; onClick: () => void }[] }
  ) {
    if (useRoute) {
      // Round-trip path. Note: the /api/mcp/snackbar route doesn't accept
      // `actions` (intentional — agents can't pass click handlers across SSE),
      // so this path is severity-only.
      try {
        const r = await fetch('/api/mcp/snackbar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: TEST_SESSION_ID,
            text,
            severity,
            ...(typeof opts?.sticky === 'boolean' ? { sticky: opts.sticky } : {}),
          }),
        })
        appendLog(`ROUTE ${severity}${opts?.sticky === undefined ? '' : opts.sticky ? '+sticky' : '-sticky'} → ${r.status}`)
      } catch (e) {
        appendLog(`ROUTE error: ${e}`)
      }
      return
    }
    // In-process path — direct show().
    const defaultSticky = severity === 'warning' || severity === 'error' || severity === 'progress'
    const sticky = typeof opts?.sticky === 'boolean' ? opts.sticky : defaultSticky
    const duration = sticky ? 0 : 5000
    const id = show(severity, text, {
      duration,
      isProgress: severity === 'progress',
      actions: opts?.actions,
    })
    appendLog(`SHOW ${severity}${opts?.sticky === undefined ? '' : opts.sticky ? '+sticky' : '-sticky'} (id=${id.slice(-6)})`)
    return id
  }

  // ── Modal firing ─────────────────────────────────────────────────────────

  function fireModal(question: string, options: string[]) {
    const requestId = `test-${Date.now()}-${counterRef.current++}`
    sessionEvents.emit({
      type: 'cd.ask-user',
      sessionId: TEST_SESSION_ID,
      data: { requestId, question, options },
    })
    appendLog(`MODAL "${question.slice(0, 32)}..." × ${options.length} options`)
  }

  // ── Composite scenarios ──────────────────────────────────────────────────

  async function scenarioStackOverflow() {
    // MAX_VISIBLE = 3. Fire 5 to verify oldest get clipped.
    for (let i = 1; i <= 5; i++) {
      await fireSnackbar('info', `Stack test #${i}/5`, { sticky: true })
    }
    appendLog('Stack overflow: fired 5 sticky info — oldest 2 should drop')
  }

  function scenarioProgressToSuccess() {
    if (useRoute) {
      appendLog('Progress→Success scenario only works in IN-PROCESS mode')
      return
    }
    const id = show('progress', 'Generating image...', {
      duration: 0,
      isProgress: true,
    })
    appendLog(`Progress kicked off (id=${id.slice(-6)})`)
    setTimeout(() => {
      update(id, {
        type: 'success',
        message: '✓ Image generated.',
        duration: 5000,
        isProgress: false,
      })
      appendLog(`→ promoted to success (id=${id.slice(-6)})`)
    }, 2500)
  }

  function scenarioWarnAlias() {
    // Tests the `warn` → `warning` normalization on the route side.
    if (!useRoute) {
      appendLog('warn-alias scenario only meaningful in ROUND-TRIP mode')
      return
    }
    fetch('/api/mcp/snackbar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: TEST_SESSION_ID,
        text: 'warn alias should normalize → warning (yellow, sticky)',
        severity: 'warn',
      }),
    }).then((r) => appendLog(`warn-alias route → ${r.status}`))
  }

  function scenarioInvalidSeverity() {
    if (!useRoute) {
      appendLog('invalid-severity scenario only meaningful in ROUND-TRIP mode')
      return
    }
    fetch('/api/mcp/snackbar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: TEST_SESSION_ID,
        text: 'severity=garbage → should fall back to info',
        severity: 'garbage',
      }),
    }).then((r) => appendLog(`invalid-severity route → ${r.status} (expect info blue)`))
  }

  function scenarioStickyOverrideError() {
    fireSnackbar('error', 'Error w/ sticky:false → auto-dismisses 5s', {
      sticky: false,
    })
  }

  function scenarioStickyOverrideInfo() {
    fireSnackbar('info', 'Info w/ sticky:true → never auto-dismisses', {
      sticky: true,
    })
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  return (
    <div style={SECTIONS_STYLE}>
      {/* HEADER spans full grid */}
      <div style={{ ...CARD_STYLE, gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
              Snackbar + Modal Test Suite
            </div>
            <div style={NOTE}>
              5 severities × sticky orthogonal × actions × stacks × the AskUser modal.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span
              style={{
                fontSize: 11,
                padding: '4px 8px',
                borderRadius: 4,
                background:
                  sseStatus === 'open'
                    ? 'rgba(34,197,94,0.15)'
                    : sseStatus === 'error'
                    ? 'rgba(239,68,68,0.15)'
                    : 'rgba(113,113,122,0.15)',
                color:
                  sseStatus === 'open'
                    ? '#22c55e'
                    : sseStatus === 'error'
                    ? '#ef4444'
                    : '#a1a1aa',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              SSE: {sseStatus}
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={useRoute}
                onChange={(e) => setUseRoute(e.target.checked)}
              />
              <span>
                <strong>Round-trip mode</strong> ({useRoute ? 'POST → SSE → Provider' : 'direct show()'})
              </span>
            </label>
            <button
              onClick={() => {
                dismissAll()
                appendLog('dismissAll()')
              }}
              style={btn('#a1a1aa')}
            >
              Dismiss all
            </button>
            <button
              onClick={() => setLog([])}
              style={btn('#a1a1aa')}
            >
              Clear log
            </button>
          </div>
        </div>
        {useRoute && (
          <div style={{ ...NOTE, color: sseStatus === 'open' ? '#22c55e' : '#fbbf24' }}>
            {sseStatus === 'open'
              ? `✓ SSE listener attached for session=${TEST_SESSION_ID}. Round-trip events will render.`
              : sseStatus === 'error'
              ? `⚠ SSE error — EventSource will retry. Snackbars from /api/mcp/snackbar may not arrive until reconnected.`
              : `… SSE connecting to session=${TEST_SESSION_ID}.`}
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────────────
           SECTION 1 — All five severities at default sticky
       ─────────────────────────────────────────────────────────────────── */}
      <div style={CARD_STYLE}>
        <div style={H2}>1 · Severity defaults</div>
        <div style={NOTE}>
          Each severity at its <em>default</em> sticky behavior.
          <br />
          info / success → auto-dismiss 5s. progress / warning / error → sticky.
        </div>
        <div style={ROW}>
          {(['info', 'success', 'progress', 'warning', 'error'] as Severity[]).map((sev) => (
            <button
              key={sev}
              onClick={() => fireSnackbar(sev, `${sev} (default)`)}
              style={btn(SEVERITY_COLORS[sev])}
            >
              {sev}
            </button>
          ))}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────
           SECTION 2 — Sticky override (force)
       ─────────────────────────────────────────────────────────────────── */}
      <div style={CARD_STYLE}>
        <div style={H2}>2 · Sticky:true override</div>
        <div style={NOTE}>
          Force info/success to persist. Verifies the orthogonal flag works on the
          "auto by default" severities.
        </div>
        <div style={ROW}>
          {(['info', 'success'] as Severity[]).map((sev) => (
            <button
              key={sev}
              onClick={() => fireSnackbar(sev, `${sev} sticky:true`, { sticky: true })}
              style={btn(SEVERITY_COLORS[sev])}
            >
              {sev} +sticky
            </button>
          ))}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────
           SECTION 3 — Sticky override (release)
       ─────────────────────────────────────────────────────────────────── */}
      <div style={CARD_STYLE}>
        <div style={H2}>3 · Sticky:false override</div>
        <div style={NOTE}>
          Force progress/warning/error to auto-dismiss 5s. Verifies the orthogonal
          flag works on the "sticky by default" severities.
        </div>
        <div style={ROW}>
          {(['progress', 'warning', 'error'] as Severity[]).map((sev) => (
            <button
              key={sev}
              onClick={() => fireSnackbar(sev, `${sev} sticky:false`, { sticky: false })}
              style={btn(SEVERITY_COLORS[sev])}
            >
              {sev} -sticky
            </button>
          ))}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────
           SECTION 4 — Actions (single, multi)
       ─────────────────────────────────────────────────────────────────── */}
      <div style={CARD_STYLE}>
        <div style={H2}>4 · Action buttons</div>
        <div style={NOTE}>
          Direct path only. Routes don't carry click handlers.
        </div>
        <div style={ROW}>
          <button
            onClick={() =>
              fireSnackbar('info', 'Click "View" →', {
                actions: [
                  { label: 'View', onClick: () => appendLog('action: View clicked') },
                ],
              })
            }
            style={btn(SEVERITY_COLORS.info)}
          >
            1 action
          </button>
          <button
            onClick={() =>
              fireSnackbar('success', 'Two actions:', {
                actions: [
                  { label: 'Open', onClick: () => appendLog('action: Open clicked') },
                  { label: 'Copy', onClick: () => appendLog('action: Copy clicked') },
                ],
              })
            }
            style={btn(SEVERITY_COLORS.success)}
          >
            2 actions
          </button>
          <button
            onClick={() =>
              fireSnackbar('error', 'Three actions:', {
                sticky: true,
                actions: [
                  { label: 'Retry', onClick: () => appendLog('action: Retry clicked') },
                  { label: 'Edit', onClick: () => appendLog('action: Edit clicked') },
                  { label: 'Skip', onClick: () => appendLog('action: Skip clicked') },
                ],
              })
            }
            style={btn(SEVERITY_COLORS.error)}
          >
            3 actions
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────
           SECTION 5 — Content edge cases
       ─────────────────────────────────────────────────────────────────── */}
      <div style={CARD_STYLE}>
        <div style={H2}>5 · Content edge cases</div>
        <div style={NOTE}>
          Long text, emoji, special chars. Container is min 300 / max 400px wide.
        </div>
        <div style={ROW}>
          <button
            onClick={() => fireSnackbar('info', 'a')}
            style={btn(SEVERITY_COLORS.info)}
          >
            1-char
          </button>
          <button
            onClick={() =>
              fireSnackbar(
                'info',
                'A very long message that should wrap onto multiple lines and stress-test the snackbar layout to make sure padding, alignment, and the dismiss button all behave correctly under content pressure.',
              )
            }
            style={btn(SEVERITY_COLORS.info)}
          >
            Long text
          </button>
          <button
            onClick={() => fireSnackbar('success', '🎉 Vibe-3 ✓ ready — مرحبا 你好 🐪')}
            style={btn(SEVERITY_COLORS.success)}
          >
            Emoji + RTL
          </button>
          <button
            onClick={() => fireSnackbar('warning', '<script>alert(1)</script>')}
            style={btn(SEVERITY_COLORS.warning)}
          >
            HTML escape
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────
           SECTION 6 — Stacking
       ─────────────────────────────────────────────────────────────────── */}
      <div style={CARD_STYLE}>
        <div style={H2}>6 · Stacking</div>
        <div style={NOTE}>
          MAX_VISIBLE = 3 in SnackbarProvider. Firing 5 should leave the newest 3.
        </div>
        <div style={ROW}>
          <button onClick={scenarioStackOverflow} style={btn('#a78bfa')}>
            Fire 5 (expect 3)
          </button>
          <button
            onClick={() => {
              ['info', 'success', 'progress', 'warning', 'error'].forEach((s, i) =>
                fireSnackbar(s as Severity, `${s} #${i + 1}`)
              )
            }}
            style={btn('#a78bfa')}
          >
            One of each (5)
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────
           SECTION 7 — Lifecycle scenarios
       ─────────────────────────────────────────────────────────────────── */}
      <div style={CARD_STYLE}>
        <div style={H2}>7 · Lifecycle scenarios</div>
        <div style={NOTE}>
          Real-world flows the agent triggers in production.
        </div>
        <div style={ROW}>
          <button onClick={scenarioProgressToSuccess} style={btn('#22d3ee')}>
            progress → success (2.5s)
          </button>
          <button onClick={scenarioStickyOverrideError} style={btn(SEVERITY_COLORS.error)}>
            error w/ sticky:false
          </button>
          <button onClick={scenarioStickyOverrideInfo} style={btn(SEVERITY_COLORS.info)}>
            info w/ sticky:true
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────
           SECTION 8 — Route-only contract tests
       ─────────────────────────────────────────────────────────────────── */}
      <div style={CARD_STYLE}>
        <div style={H2}>8 · Route contract (round-trip only)</div>
        <div style={NOTE}>
          Only fires meaningfully when "Round-trip mode" is on at the top.
          Tests severity normalization and the `warn` alias.
        </div>
        <div style={ROW}>
          <button onClick={scenarioWarnAlias} style={btn(SEVERITY_COLORS.warning)}>
            severity:"warn" → warning
          </button>
          <button onClick={scenarioInvalidSeverity} style={btn('#a1a1aa')}>
            severity:"garbage" → info
          </button>
          <button
            onClick={() =>
              fetch('/api/mcp/snackbar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sessionId: TEST_SESSION_ID,
                  // intentionally missing text
                }),
              }).then((r) =>
                r.json().then((j) =>
                  appendLog(`missing text → ${r.status} ${JSON.stringify(j)}`)
                )
              )
            }
            style={btn('#a1a1aa')}
          >
            missing text → 400
          </button>
          <button
            onClick={() =>
              fetch('/api/mcp/snackbar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: 'no session' }),
              }).then((r) =>
                r.json().then((j) =>
                  appendLog(`missing session → ${r.status} ${JSON.stringify(j)}`)
                )
              )
            }
            style={btn('#a1a1aa')}
          >
            missing sessionId → 400
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────
           SECTION 9 — AskUser modal
       ─────────────────────────────────────────────────────────────────── */}
      <div style={CARD_STYLE}>
        <div style={H2}>9 · AskUser modal</div>
        <div style={NOTE}>
          Fires `cd.ask-user` events. AskUserModal is mounted on this page
          and intercepts directly. RequestIds use the `test-` prefix —
          AskUserModal recognizes the prefix and closes locally instead of
          POSTing to /api/mcp/ask-user-response (which would 404 since these
          IDs were never registered by the `ask_user` MCP tool). Picks log to
          the browser console: <code>[AskUserModal] test pick: ...</code>
        </div>
        <div style={ROW}>
          <button
            onClick={() =>
              fireModal('Should I commit this prompt or keep iterating?', [
                'Commit',
                'Iterate',
                'Cancel',
              ])
            }
            style={btn('#3b82f6')}
          >
            3 options
          </button>
          <button
            onClick={() => fireModal('Continue?', ['Yes', 'No'])}
            style={btn('#3b82f6')}
          >
            2 options
          </button>
          <button
            onClick={() =>
              fireModal('Pick a vibe to send to the CEO:', [
                'Vibe 1 — Qahwa',
                'Vibe 2 — Heritage',
                'Vibe 3 — Race',
                'Vibe 4 — Family Saturday',
              ])
            }
            style={btn('#3b82f6')}
          >
            4 options
          </button>
          <button
            onClick={() =>
              fireModal(
                'Which severity should the closing CTA snackbar use when the user finishes the booking flow on a Saturday afternoon during peak load conditions?',
                ['info', 'success', 'progress', 'warning', 'error', 'whatever you think']
              )
            }
            style={btn('#3b82f6')}
          >
            Long Q + 6 opts
          </button>
          <button
            onClick={() =>
              fireModal('One option only (degenerate):', ['OK got it'])
            }
            style={btn('#3b82f6')}
          >
            1 option
          </button>
          <button
            onClick={() =>
              fireModal('Long-label test:', [
                'A short option',
                'A medium-length option that says more about what it does',
                'An extremely long option label that goes on and on and on, well past anything reasonable, to make sure long buttons still wrap and align correctly inside the modal card',
              ])
            }
            style={btn('#3b82f6')}
          >
            Long labels
          </button>
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────────────────
           SECTION 10 — Activity log
       ─────────────────────────────────────────────────────────────────── */}
      <div style={{ ...CARD_STYLE, gridColumn: '1 / -1' }}>
        <div style={H2}>10 · Activity log (last 40)</div>
        <div
          style={{
            background: '#0a0a0a',
            border: '1px solid #27272a',
            borderRadius: 6,
            padding: 12,
            fontFamily: 'var(--font-mono, JetBrains Mono, monospace)',
            fontSize: 11,
            maxHeight: 240,
            overflow: 'auto',
            color: '#a1a1aa',
            whiteSpace: 'pre-wrap',
          }}
        >
          {log.length === 0 ? <em style={{ color: '#52525b' }}>No activity yet.</em> : log.join('\n')}
        </div>
      </div>

      {/* Modal lives here so this page can fire/observe it self-contained. */}
      <AskUserModal />
    </div>
  )
}
