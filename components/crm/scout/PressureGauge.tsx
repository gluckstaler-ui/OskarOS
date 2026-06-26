'use client'
// ============================================================================
// PressureGauge — live LVE/system pressure strip above the Run Scout button.
//
// Four readouts (Ralph's spec):
//   1. CPU   — % of a core. GREEN ≤50, AMBER ≤100, RED >100 (the burst zone).
//   2. BURST — MM:SS counting up the moment CPU crosses 50%; resets to 00:00
//              the instant it drops back to ≤50%. The duty-cycle conscience.
//   3. PROC  — process count   (n / max).
//   4. ENTRY — entry processes (n / max).
//
// Data from /api/admin/system-load, which auto-detects the box: CloudLinux
// `uapi` on the webserver, os.cpus()/ps on local dev. The poll only refreshes
// the CPU *value*; the BURST clock ticks client-side so MM:SS stays smooth
// between polls. See memory: oskar-server-deploy / oskar-bridge-mcp.
// ============================================================================
import { useEffect, useRef, useState } from 'react'

type Metric = { n: number | null; max: number | null }
type Load = { source: 'cloudlinux' | 'local'; cpu: Metric; proc: Metric; ep: Metric }

const POLL_MS = 2000

function fmtMMSS(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function PressureGauge() {
  const [load, setLoad] = useState<Load | null>(null)
  // Wall-clock ms at which CPU first crossed 50% (null ⇒ currently ≤50%).
  const aboveSinceRef = useRef<number | null>(null)
  const [burstMs, setBurstMs] = useState(0)

  // Poll the load endpoint; arm/disarm the burst clock off the CPU reading.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const r = await fetch('/api/admin/system-load', { cache: 'no-store' })
        if (alive && r.ok) {
          const data = (await r.json()) as Load
          setLoad(data)
          const cpu = data.cpu.n
          if (cpu != null && cpu > 50) {
            if (aboveSinceRef.current == null) aboveSinceRef.current = Date.now()
          } else {
            aboveSinceRef.current = null
          }
        }
      } catch {
        /* keep last good reading; the gauge never goes blank on a blip */
      }
      if (alive) timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  // Tick the displayed MM:SS 4×/s so it counts up smoothly between polls.
  useEffect(() => {
    const i = setInterval(() => {
      setBurstMs(aboveSinceRef.current == null ? 0 : Date.now() - aboveSinceRef.current)
    }, 250)
    return () => clearInterval(i)
  }, [])

  const cpu = load?.cpu.n ?? null
  const cpuMax = load?.cpu.max ?? 200
  const tone = cpu == null ? 'idle' : cpu > 100 ? 'red' : cpu > 50 ? 'amber' : 'green'

  return (
    <div
      className="scout-gauge"
      title={load ? `Live ${load.source === 'cloudlinux' ? 'server (LVE)' : 'local'} load` : 'reading load…'}
    >
      <div className={`sg-cell sg-cpu sg-${tone}`}>
        <span className="sg-k">CPU</span>
        <span className="sg-v">{cpu == null ? '—' : `${cpu}%`}</span>
        <span className="sg-bar">
          <i style={{ width: `${Math.min(100, ((cpu ?? 0) / cpuMax) * 100)}%` }} />
        </span>
      </div>
      <div className={`sg-cell sg-timer${burstMs > 0 ? ' sg-amber' : ''}`}>
        <span className="sg-k">BURST</span>
        <span className="sg-v">{fmtMMSS(burstMs)}</span>
      </div>
      <div className="sg-cell">
        <span className="sg-k">PROC</span>
        <span className="sg-v">
          {load?.proc.n ?? '—'}
          {load?.proc.max ? <em>/{load.proc.max}</em> : null}
        </span>
      </div>
      <div className="sg-cell">
        <span className="sg-k">ENTRY</span>
        <span className="sg-v">
          {load?.ep.n ?? '—'}
          {load?.ep.max ? <em>/{load.ep.max}</em> : null}
        </span>
      </div>
    </div>
  )
}
