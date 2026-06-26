// ============================================================================
// app/api/admin/system-load/route.ts — live load for the Scout pressure gauge.
//
// Detects which box we're on and reads CPU% / processes / entry-processes from
// the right source — no root needed either way:
//   - Webserver (CloudLinux): `uapi ResourceUsage get_usages` exposes
//       lvecpu  → CPU as % of a core (0–200, the burst cap)
//       lvenproc→ process count   (N / 200)
//       lveep   → entry processes (N / 30)
//     (See memory: oskar-server-deploy / oskar-bridge-mcp.)
//   - Local dev (Mac): os.cpus() delta for CPU% normalised to % of a core
//     (so 200 = 2 cores busy, same scale as LVE), `ps` for the process count;
//     there is no entry-process concept locally, so it reports null.
// ============================================================================
import { NextResponse } from 'next/server'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UAPI = '/usr/bin/uapi'
const ON_SERVER = existsSync(UAPI)

type Metric = { n: number | null; max: number | null }
type Load = { source: 'cloudlinux' | 'local'; cpu: Metric; proc: Metric; ep: Metric }

function fromUapi(): Load {
  const out = execFileSync(UAPI, ['--output=json', 'ResourceUsage', 'get_usages'], {
    timeout: 4000,
    maxBuffer: 1 << 20,
  }).toString()
  const data = (JSON.parse(out)?.result?.data ?? []) as Array<{ id: string; usage: number; maximum: string | number | null }>
  const pick = (id: string): Metric => {
    const m = data.find((x) => x.id === id)
    return { n: m ? Number(m.usage) : null, max: m && m.maximum != null ? Number(m.maximum) : null }
  }
  return { source: 'cloudlinux', cpu: pick('lvecpu'), proc: pick('lvenproc'), ep: pick('lveep') }
}

// Local CPU%: idle/total delta across all cores since the last poll, on the
// PER-CORE scale (200 = 2 cores busy, up to cores×100) — the same scale as the
// server's lvecpu, so the same Scout workload reads comparably on both boxes.
// Background noise doesn't false-alarm because the gauge's LOCAL colour bands
// are wide (green <100 / amber <400 / red >400, set in the component); a dev
// Mac spreading Scout across a few cores stays green/amber by design.
let prevCpu: { idle: number; total: number } | null = null
function localCpuPct(): number {
  const cpus = os.cpus()
  let idle = 0
  let total = 0
  for (const c of cpus) {
    idle += c.times.idle
    for (const t of Object.values(c.times)) total += t
  }
  if (!prevCpu) {
    prevCpu = { idle, total }
    return 0
  }
  const dIdle = idle - prevCpu.idle
  const dTotal = total - prevCpu.total
  prevCpu = { idle, total }
  if (dTotal <= 0) return 0
  return Math.round((1 - dIdle / dTotal) * cpus.length * 100)
}

function fromLocal(): Load {
  const cores = os.cpus().length
  let proc: number | null = null
  try {
    proc = parseInt(execFileSync('bash', ['-c', 'ps -A -o pid= | wc -l'], { timeout: 2000 }).toString().trim(), 10) || null
  } catch {
    proc = null
  }
  return {
    source: 'local',
    cpu: { n: localCpuPct(), max: cores * 100 },
    proc: { n: proc, max: null },
    ep: { n: null, max: null },
  }
}

export function GET() {
  const headers = { 'cache-control': 'no-store' }
  try {
    return NextResponse.json(ON_SERVER ? fromUapi() : fromLocal(), { headers })
  } catch {
    // never break the gauge — fall back to local on any uapi hiccup
    try {
      return NextResponse.json(fromLocal(), { headers })
    } catch {
      const empty: Metric = { n: null, max: null }
      return NextResponse.json({ source: 'local', cpu: empty, proc: empty, ep: empty }, { headers })
    }
  }
}
