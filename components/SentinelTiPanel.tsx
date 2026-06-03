'use client'

import { useState, useEffect, useRef } from 'react'

// ═══════════════════════════════════════════════════════════════════════
// SENTINEL TI PANEL — feedback view inside AssetsPanel
// Replaces the modal. Streams Ti's critique inline, keeps history of
// past critiques run this session, lets the user fire new ones with a
// target picker.
// ═══════════════════════════════════════════════════════════════════════

interface SentinelTiPanelProps {
  sessionId: string | null
  vibeFilenames?: string[]
  /**
   * When set, the panel auto-starts a critique with the given target.
   * Caller should clear this back to null after the panel calls
   * `onConsumePendingTarget` so it doesn't loop.
   */
  pendingTarget?: string | null
  onConsumePendingTarget?: () => void
}

interface CritiqueEntry {
  id: string
  target: string
  startedAt: number
  finishedAt?: number
  output: string
  status: 'streaming' | 'done' | 'error'
  error?: string
  reportPath?: string
  /** True when loaded from disk (mtime only, no real elapsed time available). */
  fromDisk?: boolean
}

// Pull a score X.X out of "Overall: X.X / 10" or "— X.X / 10" or any
// "X.X / 10" (plain or wrapped in markdown bold). Tries strict "Overall:"
// first, then falls back to the first plain "N.N / 10" hit. Sentinel's
// templates have drifted across runs so we accept several formats.
function parseOverallScore(output: string): number | null {
  const strict = output.match(/Overall:?\s*\*{0,2}\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/i)
  if (strict) return parseFloat(strict[1])
  const loose = output.match(/(?:^|\s|—|-|\*)\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10\b/m)
  if (loose) return parseFloat(loose[1])
  return null
}

function scoreColor(score: number): string {
  if (score >= 8) return '#10b981'      // emerald — Excellent
  if (score >= 6) return '#fbbf24'      // amber — Good
  if (score >= 4) return '#f97316'      // orange — Needs work
  return '#f87171'                       // red — Failing
}

export function SentinelTiPanel({
  sessionId,
  vibeFilenames = [],
  pendingTarget,
  onConsumePendingTarget,
}: SentinelTiPanelProps) {
  const [target, setTarget] = useState<string>('brief')
  const [history, setHistory] = useState<CritiqueEntry[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const scrollRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const listScrollRef = useRef<HTMLDivElement | null>(null)

  // Load past critique reports from disk on mount (and whenever sessionId changes).
  // The reports live at public/{sessionId}/critique/sentinel-ti-*.md.
  useEffect(() => {
    if (!sessionId) {
      setHistory([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const resp = await fetch(
          `/api/sentinel-ti/list?sessionId=${encodeURIComponent(sessionId)}`,
        )
        if (!resp.ok) return
        const data = await resp.json()
        if (cancelled) return
        const past: CritiqueEntry[] = (data.critiques || []).map((c: any) => ({
          id: c.id,
          target: c.target,
          startedAt: c.finishedAt,
          finishedAt: c.finishedAt,
          output: c.output,
          status: 'done' as const,
          reportPath: c.filename,
          fromDisk: true,  // mtime-only, no real elapsed time
        }))
        // Merge with any in-memory entries from this session, preferring
        // existing in-memory ones (they may be still streaming).
        setHistory((prev) => {
          const seen = new Set(prev.map((e) => e.id))
          const merged = [...prev, ...past.filter((e) => !seen.has(e.id))]
          merged.sort((a, b) => b.startedAt - a.startedAt)
          return merged
        })
      } catch {
        // Silent — disk listing is a nice-to-have, not critical.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Auto-start when pendingTarget is set by the parent (TopBar 🛡 click)
  useEffect(() => {
    if (pendingTarget && sessionId) {
      setTarget(pendingTarget)
      startCritique(pendingTarget)
      onConsumePendingTarget?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTarget, sessionId])

  // Auto-scroll the OUTER list as the active critique streams. Single
  // scroll surface — the cards no longer have their own scrollbar.
  useEffect(() => {
    if (activeIdRef.current && listScrollRef.current) {
      const el = listScrollRef.current
      el.scrollTop = el.scrollHeight
    }
  })

  // Cancel any in-flight stream on unmount
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  async function startCritique(targetVal: string) {
    if (!sessionId) return

    const id = `critique-${Date.now()}`
    activeIdRef.current = id
    const ac = new AbortController()
    abortRef.current = ac

    const entry: CritiqueEntry = {
      id,
      target: targetVal,
      startedAt: Date.now(),
      output: '',
      status: 'streaming',
    }
    setHistory((prev) => [entry, ...prev])
    setExpandedId(id)

    try {
      const resp = await fetch('/api/sentinel-ti', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, target: targetVal }),
        signal: ac.signal,
      })

      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => '')
        throw new Error(`HTTP ${resp.status}: ${txt}`)
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })

        let frameEnd: number
        while ((frameEnd = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, frameEnd)
          buf = buf.slice(frameEnd + 2)
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'))
          if (!dataLine) continue
          const json = dataLine.slice(5).trim()
          if (!json) continue
          try {
            const event = JSON.parse(json)
            if (event.type === 'text' && typeof event.content === 'string') {
              setHistory((prev) =>
                prev.map((h) =>
                  h.id === id ? { ...h, output: h.output + event.content } : h,
                ),
              )
            } else if (event.type === 'complete') {
              setHistory((prev) =>
                prev.map((h) =>
                  h.id === id
                    ? {
                        ...h,
                        status: 'done',
                        finishedAt: Date.now(),
                        reportPath: event.reportPath,
                      }
                    : h,
                ),
              )
            } else if (event.type === 'error') {
              setHistory((prev) =>
                prev.map((h) =>
                  h.id === id
                    ? {
                        ...h,
                        status: 'error',
                        finishedAt: Date.now(),
                        error: event.error || 'Unknown error',
                      }
                    : h,
                ),
              )
            }
          } catch {
            /* ignore unparseable */
          }
        }
      }

      // If the stream ended cleanly without an explicit complete event, mark done
      setHistory((prev) =>
        prev.map((h) =>
          h.id === id && h.status === 'streaming'
            ? { ...h, status: 'done', finishedAt: Date.now() }
            : h,
        ),
      )
    } catch (err: any) {
      if (err.name === 'AbortError') return
      setHistory((prev) =>
        prev.map((h) =>
          h.id === id
            ? {
                ...h,
                status: 'error',
                finishedAt: Date.now(),
                error: String(err.message || err),
              }
            : h,
        ),
      )
    } finally {
      if (activeIdRef.current === id) activeIdRef.current = null
      abortRef.current = null
    }
  }

  function abortActive() {
    if (abortRef.current) {
      abortRef.current.abort()
      const id = activeIdRef.current
      if (id) {
        setHistory((prev) =>
          prev.map((h) =>
            h.id === id
              ? {
                  ...h,
                  status: 'error',
                  finishedAt: Date.now(),
                  error: 'Aborted by user.',
                }
              : h,
          ),
        )
      }
      activeIdRef.current = null
      abortRef.current = null
    }
  }

  function copyEntry(entry: CritiqueEntry) {
    if (entry.output) navigator.clipboard.writeText(entry.output).catch(() => {})
  }

  // Build target options
  const targetOptions: { value: string; label: string }[] = [
    { value: 'brief', label: 'Brief (CREATIVE-BRIEF.md)' },
  ]
  for (const fn of vibeFilenames) {
    const m = fn.match(/^(vibe-\d+)/)
    if (m && !targetOptions.find((o) => o.value === m[1])) {
      targetOptions.push({ value: m[1], label: `${m[1]} · ${fn}` })
    }
  }
  targetOptions.push({ value: 'all', label: 'All (brief + every vibe)' })

  const isStreaming = !!activeIdRef.current && abortRef.current !== null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        gap: '12px',
        padding: '12px',
        overflow: 'hidden',
      }}
    >
      {/* Trigger row */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={isStreaming}
          style={{
            flex: 1,
            padding: '7px 10px',
            borderRadius: '6px',
            border: '1px solid var(--border-card)',
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            fontSize: '12px',
            fontFamily: 'inherit',
            cursor: isStreaming ? 'not-allowed' : 'pointer',
          }}
        >
          {targetOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {isStreaming ? (
          <button
            onClick={abortActive}
            style={{
              padding: '7px 14px',
              borderRadius: '6px',
              border: '1px solid #f87171',
              background: 'transparent',
              color: '#f87171',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.05em',
              cursor: 'pointer',
            }}
          >
            ABORT
          </button>
        ) : (
          <button
            onClick={() => startCritique(target)}
            disabled={!sessionId}
            style={{
              padding: '7px 14px',
              borderRadius: '6px',
              border: '1px solid #6366f1',
              background: sessionId
                ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                : 'rgba(99, 102, 241, 0.3)',
              color: '#ffffff',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.05em',
              cursor: sessionId ? 'pointer' : 'not-allowed',
            }}
          >
            🛡 RUN
          </button>
        )}
      </div>

      {/* Empty state */}
      {history.length === 0 && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: '12px',
            textAlign: 'center',
            padding: '24px',
            gap: '12px',
          }}
        >
          <div style={{ fontSize: '36px', opacity: 0.5 }}>🛡</div>
          <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
            Sentinel Ti standing watch
          </div>
          <div style={{ maxWidth: '280px', lineHeight: 1.55, opacity: 0.85 }}>
            Pick a target above and run a critique. Ti will score the brief or
            a vibe on huashu&apos;s 5-dimension rubric and recommend two design
            schools from different philosophical groups.
          </div>
        </div>
      )}

      {/* History list — single scroll surface for the whole panel body */}
      {history.length > 0 && (
        <div
          ref={listScrollRef}
          className="ti-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            paddingRight: '4px',
          }}
        >
          {history.map((entry) => {
            const isExpanded = expandedId === entry.id
            const isActive = entry.status === 'streaming'
            const elapsed = entry.finishedAt
              ? Math.round((entry.finishedAt - entry.startedAt) / 1000)
              : Math.round((Date.now() - entry.startedAt) / 1000)
            const startedTime = new Date(entry.startedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })

            return (
              <div
                key={entry.id}
                style={{
                  border: isActive
                    ? '1px solid rgba(99, 102, 241, 0.5)'
                    : entry.status === 'error'
                    ? '1px solid rgba(248, 113, 113, 0.4)'
                    : '1px solid var(--border-card)',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-app)',
                  overflow: 'hidden',
                  // Cards are flex children of a column flex container
                  // (listScrollRef). Without flex-shrink: 0, the flex layout
                  // squashes each card to fit available space — collapsed
                  // cards render at 8px instead of 35px, the expanded card
                  // gets clipped at ~480px even though its body is 2600+px.
                  // flexShrink: 0 forces every card to render at its natural
                  // height; listScrollRef then overflows and the scrollbar
                  // activates correctly.
                  flexShrink: 0,
                  boxShadow: isActive
                    ? '0 0 12px rgba(99, 102, 241, 0.18)'
                    : 'none',
                }}
              >
                {/* Card header */}
                <div
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: isActive
                        ? '#6366f1'
                        : entry.status === 'done'
                        ? '#10b981'
                        : '#f87171',
                      flexShrink: 0,
                      animation: isActive ? 'ti-pulse 1.4s ease-in-out infinite' : 'none',
                    }}
                  />
                  <span
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '11px',
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      color: 'var(--text-main)',
                    }}
                  >
                    🛡 {entry.target}
                  </span>
                  {(() => {
                    const score = parseOverallScore(entry.output)
                    if (score === null) return null
                    return (
                      <span
                        style={{
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: '10px',
                          fontWeight: 700,
                          color: scoreColor(score),
                          backgroundColor: `${scoreColor(score)}1a`,
                          border: `1px solid ${scoreColor(score)}66`,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {score.toFixed(1)} / 10
                      </span>
                    )
                  })()}
                  <span
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    · {startedTime}
                    {/* Skip elapsed for disk-loaded reports — mtime gives us
                        finishedAt only, so elapsed is bogus 0s. Show only when
                        we tracked the real start (in-session runs). */}
                    {!entry.fromDisk && entry.status !== 'streaming' && elapsed > 0 && (
                      <> · {elapsed}s</>
                    )}
                    {entry.status === 'streaming' && <> · {elapsed}s</>}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span
                    style={{
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </div>

                {/* Card body */}
                {isExpanded && (
                  <div
                    style={{
                      borderTop: '1px solid var(--border-card)',
                      backgroundColor: 'var(--bg-card)',
                    }}
                  >
                    {entry.status === 'error' && entry.error && (
                      <div
                        style={{
                          padding: '12px 14px',
                          color: '#fca5a5',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: '11px',
                          lineHeight: 1.55,
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {entry.error}
                      </div>
                    )}

                    {(entry.output || isActive) && (
                      <div
                        ref={(el) => {
                          scrollRefs.current[entry.id] = el
                        }}
                        style={{
                          padding: '14px 16px',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontSize: '12px',
                          lineHeight: 1.65,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          color: 'var(--text-main)',
                        }}
                      >
                        {entry.output ||
                          (isActive ? 'Sentinel Ti is reading the references…' : '')}
                      </div>
                    )}

                    {/* Footer */}
                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        padding: '8px 12px',
                        borderTop: '1px solid var(--border-card)',
                        fontSize: '10px',
                        fontFamily: 'JetBrains Mono, monospace',
                        color: 'var(--text-muted)',
                        alignItems: 'center',
                      }}
                    >
                      {entry.reportPath && (
                        <span style={{ flex: 1, opacity: 0.75 }}>
                          {entry.reportPath.split('/').slice(-2).join('/')}
                        </span>
                      )}
                      {!entry.reportPath && <span style={{ flex: 1 }} />}
                      <button
                        onClick={() => copyEntry(entry)}
                        disabled={!entry.output}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '4px',
                          border: '1px solid var(--border-card)',
                          background: 'transparent',
                          color: 'var(--text-main)',
                          fontSize: '10px',
                          fontWeight: 600,
                          cursor: entry.output ? 'pointer' : 'not-allowed',
                          opacity: entry.output ? 1 : 0.4,
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
