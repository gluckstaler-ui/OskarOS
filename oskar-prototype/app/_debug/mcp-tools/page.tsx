/**
 * /_debug/mcp-tools — dev-mode MCP tool probe (Ralph 2026-05-04).
 *
 * One-click sanity check for every MCP tool. Fires each via its
 * /api/mcp/{slug} route with safe args, captures the response, displays
 * status (ok / 4xx / 5xx) + the raw body. Whenever Ralph suspects "agent
 * communication isn't working" or "tool X is broken", open this page —
 * if a row goes red here, the regression is real and isolatable to that
 * one tool. If everything's green here but CD still complains, the
 * problem is upstream (agent prompt, MCP transport, scoping).
 */

'use client'

import { useState } from 'react'

interface ProbeRow {
  name: string
  endpoint: string
  body: () => unknown
  expectFields?: string[]
}

interface ProbeResult {
  status: number | 'pending' | 'fetch-error'
  ok: boolean
  body: unknown
  durationMs: number
}

function makeSession() {
  return `mcp-probe-${Date.now()}`
}

function PROBES(sessionId: string): ProbeRow[] {
  return [
    // ── Capability tools (Tier S/A/B) ─────────────────────────────────
    { name: 'snackbar', endpoint: '/api/mcp/snackbar',
      body: () => ({ sessionId, text: 'probe', severity: 'info' }) },
    { name: 'session-meta', endpoint: '/api/mcp/session-meta',
      body: () => ({ sessionId }) },
    { name: 'list-assets', endpoint: '/api/mcp/list-assets',
      body: () => ({ sessionId, limit: 10 }) },
    { name: 'find-assets', endpoint: '/api/mcp/find-assets',
      body: () => ({ sessionId, query: 'probe' }) },
    { name: 'lint-brand', endpoint: '/api/mcp/lint-brand',
      body: () => ({ sessionId, file: 'vibe-1.html' }) },
    { name: 'vibe-diff', endpoint: '/api/mcp/vibe-diff',
      body: () => ({ sessionId, target: 'vibe-1', since: 'last-build' }) },

    // ── Discovery flow (Phase 2 — Ralph 2026-05-04) ───────────────────
    { name: 'ask-discovery-questions', endpoint: '/api/mcp/ask-discovery-questions',
      body: () => ({ sessionId, questions: ['Probe Q1?', 'Probe Q2?'] }) },
    { name: 'confirm-understanding', endpoint: '/api/mcp/confirm-understanding',
      body: () => ({ sessionId, summary: 'Probe summary.', readyToGenerate: false }) },

    // ── Orchestrator (cross-agent comms) ──────────────────────────────
    { name: 'notify-agent', endpoint: '/api/mcp/notify-agent',
      body: () => ({ sessionId, target: 'cd', message: 'probe', senderRole: 'jedi-code' }) },
    { name: 'agent-inbox', endpoint: '/api/mcp/agent-inbox',
      body: () => ({ sessionId, callerRole: 'cd' }) },
    { name: 'replay-events', endpoint: '/api/mcp/replay-events',
      body: () => ({ sessionId }) },
    { name: 'thread-history', endpoint: '/api/mcp/thread-history',
      body: () => ({ sessionId, threadId: 'probe' }) },

    // ── State management ──────────────────────────────────────────────
    { name: 'images-needed', endpoint: '/api/mcp/images-needed',
      body: () => ({ sessionId }) },
    { name: 'refresh-assets', endpoint: '/api/mcp/refresh-assets',
      body: () => ({ sessionId }) },
    { name: 'job-status', endpoint: '/api/mcp/job-status',
      body: () => ({ sessionId }) },

    // ── Session config (Commit A) ─────────────────────────────────────
    {
      name: 'session-config (GET via probe POST)', endpoint: `/api/sessions/${sessionId}/config`,
      body: () => ({ webDevModel: 'claude-sonnet-4-6' }),
    },

    // Note: build_vibe / build_all_vibes / build_final / generate_image
    // / hotswap / screenshot / image_ops / apply_patch / update_image_metadata
    // are intentionally OMITTED — they have side effects (spawn child
    // processes, fire Nano Banana, etc.) we don't want from a probe page.
  ]
}

export default function McpDebugPage() {
  const [sessionId] = useState(makeSession)
  const [results, setResults] = useState<Record<string, ProbeResult>>({})
  const [running, setRunning] = useState(false)

  async function runOne(probe: ProbeRow) {
    const t0 = performance.now()
    setResults((r) => ({ ...r, [probe.name]: { status: 'pending', ok: false, body: null, durationMs: 0 } }))
    try {
      const resp = await fetch(probe.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(probe.body()),
      })
      let body: unknown
      try { body = await resp.json() } catch { body = await resp.text().catch(() => '<no body>') }
      const durationMs = Math.round(performance.now() - t0)
      setResults((r) => ({ ...r, [probe.name]: { status: resp.status, ok: resp.ok, body, durationMs } }))
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0)
      setResults((r) => ({
        ...r,
        [probe.name]: {
          status: 'fetch-error',
          ok: false,
          body: err instanceof Error ? err.message : String(err),
          durationMs,
        },
      }))
    }
  }

  async function runAll() {
    setRunning(true)
    setResults({})
    for (const probe of PROBES(sessionId)) {
      await runOne(probe)
    }
    setRunning(false)
  }

  const probes = PROBES(sessionId)
  const counts = Object.values(results).reduce(
    (acc, r) => {
      if (r.status === 'pending') acc.pending++
      else if (r.ok) acc.ok++
      else acc.fail++
      return acc
    },
    { ok: 0, fail: 0, pending: 0 },
  )

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '20px', marginBottom: '4px' }}>/_debug/mcp-tools</h1>
      <p style={{ fontSize: '13px', color: '#666', marginBottom: '16px' }}>
        Dev-mode MCP probe. Sandboxed sessionId: <code>{sessionId}</code>. No
        side-effecting tools (build_*, generate_image, screenshot,
        image_ops, apply_patch, update_image_metadata) are wired here.
      </p>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
        <button
          onClick={runAll}
          disabled={running}
          style={{
            padding: '8px 16px',
            background: running ? '#999' : '#111',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            fontSize: '14px',
            cursor: running ? 'wait' : 'pointer',
          }}
        >
          {running ? 'Running…' : 'Run all probes'}
        </button>
        <span style={{ fontSize: '13px', color: '#444' }}>
          ✓ {counts.ok} &nbsp; ✗ {counts.fail} &nbsp; … {counts.pending}
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>
            <th style={{ padding: '6px 8px', width: '180px' }}>Tool</th>
            <th style={{ padding: '6px 8px', width: '60px' }}>Status</th>
            <th style={{ padding: '6px 8px', width: '70px' }}>Time</th>
            <th style={{ padding: '6px 8px' }}>Body</th>
            <th style={{ padding: '6px 8px', width: '60px' }}></th>
          </tr>
        </thead>
        <tbody>
          {probes.map((probe) => {
            const r = results[probe.name]
            const statusColor = !r ? '#999' : r.status === 'pending' ? '#888' : r.ok ? '#0a7' : '#d00'
            return (
              <tr key={probe.name} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{probe.name}</td>
                <td style={{ padding: '6px 8px', color: statusColor, fontWeight: 600 }}>
                  {r ? r.status : '—'}
                </td>
                <td style={{ padding: '6px 8px', color: '#666' }}>{r ? `${r.durationMs}ms` : ''}</td>
                <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: '#333' }}>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '120px', overflow: 'auto' }}>
                    {r ? JSON.stringify(r.body, null, 2).slice(0, 800) : ''}
                  </pre>
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <button
                    onClick={() => runOne(probe)}
                    disabled={running}
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      background: '#eee',
                      border: '1px solid #ccc',
                      borderRadius: '3px',
                      cursor: 'pointer',
                    }}
                  >
                    Run
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
