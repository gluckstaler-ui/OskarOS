'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

/**
 * CompactionOverlay — 4-layer architecture:
 *
 *   Layer 0: App (untouched, behind everything)
 *   Layer 1: Cinematic backdrop (z-2000) — injected HTML visuals + audio
 *   Layer 2: HUD background (z-2001) — text overlays rendered by HTML (compactOverlay, orderText, res-text)
 *   Layer 3: HUD foreground (z-2002) — React-rendered progress bars + Continue button
 *
 * Communication:
 *   HTML → React: postMessage({ type: 'compaction-phase', phase: '...' })
 *   React → HTML: postMessage({ type: 'compaction-event', ... }) for SSE events
 *   HTML → React: postMessage({ type: 'compaction-continue' }) for stop/cleanup
 */

interface Props {
  sessionId: string
  endpoint?: 'order65' | 'order66'  // which API route to hit
  onContinue: () => void
  onComplete?: () => void  // fires when bridge-ready — TopBar button goes green
}

type CinematicPhase = 'init' | 'order66' | 'kill' | 'black' | 'yoda' | 'dot' | 'resurrection'

const PHASE_PCT: Record<string, number> = {
  started: 5, reading: 25, compacting: 55, writing: 85,
  completed: 100, skipped: 100, failed: 100,
}

// LJ has 7 stages during 'compacting' phase — spread between 25% and 85%
const LJ_STAGE_PCT: Record<string, number> = {
  P1: 33, P2: 41, P3: 49, P4: 57, P5: 65, P6: 73, LEDGER: 81,
}

export function CompactionOverlay({ sessionId, endpoint = 'order66', onContinue, onComplete }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const mountedRef = useRef(false)

  // Cinematic phase — drives what's visible in Layer 3
  const [phase, setPhase] = useState<CinematicPhase>('init')

  // Bar state — driven by SSE events
  const [ljPct, setLjPct] = useState(0)
  const [sagePct, setSagePct] = useState(0)
  const [ljStatus, setLjStatus] = useState<'waiting' | 'running' | 'done' | 'failed'>('waiting')
  const [sageStatus, setSageStatus] = useState<'waiting' | 'running' | 'done' | 'failed'>('waiting')

  // Bridge-ready end state — context bar snaps to post-compaction value + green
  const [bridgeReady, setBridgeReady] = useState(false)
  const [postCompactionPct, setPostCompactionPct] = useState(5) // fallback 5%

  // Context bar: drains during compaction, snaps to post-compaction value at end
  const ctxPct = bridgeReady
    ? postCompactionPct
    : Math.max(0, 66 * (1 - (ljPct + sagePct) / 200))
  const ctxColor = bridgeReady ? '#10b981' : '#ef4444' // green when done, red during compaction
  const showCtxBar = phase === 'yoda' || phase === 'dot' || phase === 'resurrection'

  const cleanup = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
  }, [])

  const handleContinue = useCallback(() => {
    cleanup()
    // Tell overlay HTML to kill audio + timers
    window.postMessage({ type: 'compaction-continue' }, '*')
    onContinue()
  }, [cleanup, onContinue])

  useEffect(() => {
    // Guard against React StrictMode double-mount
    if (mountedRef.current) return
    mountedRef.current = true

    const container = containerRef.current
    if (!container) return

    // Listen for messages from injected HTML
    const handleMessage = (evt: MessageEvent) => {
      if (!evt.data?.type) return

      if (evt.data.type === 'compaction-phase') {
        setPhase(evt.data.phase)
      }

      if (evt.data.type === 'compaction-continue') {
        cleanup()
        onContinue()
      }
    }
    window.addEventListener('message', handleMessage)

    // Fetch and inject the overlay HTML (Layer 1 + Layer 2)
    const overlayFile = endpoint === 'order65' ? '/rejuvenation-overlay.html' : '/compaction-overlay.html'
    fetch(overlayFile)
      .then(r => r.text())
      .then(html => {
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')

        // Inject styles
        doc.querySelectorAll('style').forEach(s => {
          const style = document.createElement('style')
          style.textContent = s.textContent
          container.appendChild(style)
        })

        // Inject font links
        doc.querySelectorAll('link[href*="fonts"]').forEach(l => {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = (l as HTMLLinkElement).href
          document.head.appendChild(link)
        })

        // Inject body content — wrapped with scoping class
        const bodyDiv = document.createElement('div')
        bodyDiv.className = 'compaction-root'
        bodyDiv.style.cssText = 'width:100%;height:100%;overflow:hidden;'
        bodyDiv.innerHTML = doc.body.innerHTML
        container.appendChild(bodyDiv)

        // Execute scripts — IIFE to avoid global const collisions
        doc.querySelectorAll('script').forEach(s => {
          if (s.src) return
          const script = document.createElement('script')
          script.textContent = `(function(){${s.textContent}}).call(window);`
          container.appendChild(script)
        })

        // Auto-click start gate (user gesture already happened on Order 66 button)
        const gate = container.querySelector('#startGate') as HTMLElement
        if (gate) gate.click()

        // Open SSE — forward events to overlay HTML + update React state
        const es = new EventSource(`/api/${endpoint}?session=${encodeURIComponent(sessionId)}`)
        esRef.current = es

        es.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data)
            console.log('[CompactionOverlay] SSE ←', data.agent || 'system', data.phase, data.stage || '', data.detail || '')

            // Forward to overlay HTML for completion tracking
            window.postMessage({ type: 'compaction-event', ...data }, '*')

            // Update React bar state (Layer 3)
            if (data.agent === 'lumberjack') {
              // LJ has 7 stages during compacting — use stage-level percentages
              if (data.phase === 'compacting' && data.stage && LJ_STAGE_PCT[data.stage] !== undefined) {
                setLjPct(LJ_STAGE_PCT[data.stage])
              } else {
                const pct = PHASE_PCT[data.phase]
                if (pct !== undefined) setLjPct(pct)
              }
              if (data.phase === 'started') setLjStatus('running')
              if (data.phase === 'completed' || data.phase === 'skipped') setLjStatus('done')
              if (data.phase === 'failed') setLjStatus('failed')
            }
            if (data.agent === 'sage') {
              const pct = PHASE_PCT[data.phase]
              if (pct !== undefined) setSagePct(pct)
              if (data.phase === 'started') setSageStatus('running')
              if (data.phase === 'completed' || data.phase === 'skipped') setSageStatus('done')
              if (data.phase === 'failed') setSageStatus('failed')
            }

            // Capture compression ratio → compute post-compaction context %
            if (data.phase === 'compaction-complete' && data.lumberjack) {
              const compression = parseInt(data.lumberjack.compression, 10)
              // compression is "% reduced" (e.g. 60 = 60% smaller)
              // Post-compaction context ≈ original 66% × (1 - compression/100)
              if (!isNaN(compression) && compression > 0) {
                const postPct = Math.max(2, Math.round(66 * (1 - compression / 100)))
                setPostCompactionPct(postPct)
              }
            }

            if (data.phase === 'bridge-ready') {
              setBridgeReady(true)
              onComplete?.()
              es.close()
            }
            if (data.phase === 'error') {
              es.close()
            }
          } catch (e) {
            console.error('[CompactionOverlay] parse error:', e)
          }
        }

        es.onopen = () => { console.log('[CompactionOverlay] SSE connected') }
        es.onerror = (e) => { console.error('[CompactionOverlay] SSE error — closing', e); es.close() }
      })
      .catch(err => console.error('[CompactionOverlay] load failed:', err))

    return () => {
      window.removeEventListener('message', handleMessage)
      cleanup()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      {/* Layer 1 + 2: Cinematic + HUD text (injected HTML) */}
      <div
        ref={containerRef}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2000,
          overflow: 'hidden',
        }}
      />

      {/* Layer 3: HUD foreground — ALWAYS visible from frame zero */}
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2002,
        pointerEvents: 'none',
      }}>
        {/* Bar panel — centered at 58% from top, matching original layout */}
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '72%',
          transform: 'translateX(-50%)',
          width: '45%',
          maxWidth: 550,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}>
          {/* Context Window — joins panel at Yoda, above LJ. Red during compaction, green when done. */}
          {showCtxBar && (
            <CompactionBar
              name="Context Window"
              pct={ctxPct}
              color={ctxColor}
            />
          )}
          {/* Lumberjack */}
          <CompactionBar
            name="Lumberjack"
            pct={ljPct}
            color={ljStatus === 'failed' ? '#ff4444' : '#10b981'}
          />
          {/* Sage */}
          <CompactionBar
            name="Sage"
            pct={sagePct}
            color={sageStatus === 'failed' ? '#ff4444' : '#4fc3f7'}
          />
        </div>

        {/* Continue button — always visible, always clickable, fixed at bottom */}
        <button
          onClick={handleContinue}
          style={{
            position: 'absolute',
            bottom: '5rem',
            left: '50%',
            transform: 'translateX(-50%)',
            pointerEvents: 'auto',
            fontFamily: "'Orbitron', monospace",
            fontSize: 'clamp(0.7rem, 1.2vw, 0.9rem)',
            fontWeight: 700,
            letterSpacing: 4,
            textTransform: 'uppercase',
            padding: '16px 48px',
            background: '#ff0a0a',
            color: '#fff',
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
            boxShadow: '0 0 20px rgba(255,10,10,0.4), 0 0 40px rgba(255,10,10,0.2)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = '#ff2020'
            e.currentTarget.style.boxShadow = '0 0 30px rgba(255,10,10,0.6), 0 0 60px rgba(255,10,10,0.3)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = '#ff0a0a'
            e.currentTarget.style.boxShadow = '0 0 20px rgba(255,10,10,0.4), 0 0 40px rgba(255,10,10,0.2)'
          }}
        >
          Continue
        </button>
      </div>
    </>
  )
}

/** Single progress bar — matches .cbar styling from compaction.html */
function CompactionBar({ name, pct, color }: { name: string; pct: number; color: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{
          fontFamily: "'Orbitron', monospace",
          fontSize: '0.6rem',
          fontWeight: 700,
          letterSpacing: 4,
          textTransform: 'uppercase',
          color,
        }}>
          {name}
        </span>
        <span style={{
          fontFamily: "'Orbitron', monospace",
          fontSize: '0.65rem',
          fontWeight: 900,
          color,
        }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div style={{
        width: '100%',
        height: 6,
        background: 'rgba(255,255,255,0.06)',
        borderRadius: 3,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: color,
          borderRadius: 3,
          boxShadow: `0 0 8px ${color}40`,
          transition: 'width 1.5s ease',
        }} />
      </div>
    </div>
  )
}
