// ============================================================================
// POST /api/admin/sync/run?target=crm|session|codebase[&id=<session>][&dir=up|down]
//
// The MUTATING half of the SYNC panel (WP-28). Runs the per-target sync script
// on THIS machine (the spoke) and STREAMS its stdout/stderr back live so the
// panel can show real progress (the scripts emit `=== phase ===` markers).
//
// dir=up (default) — PUSH this machine → hub:
//   crm      → scripts/sync-crm.sh       (event-log files + Scout screenshots; never WhatsApp/email)
//   session  → scripts/sync-session.sh   (one session folder, additive — no deletes)
//   codebase → scripts/deploy-server.sh  (full build + ship; the proven engine)
// dir=down — PULL hub → this machine (the download half):
//   crm      → scripts/sync-crm.sh       (already bidirectional: pushes ours, pulls hub-authored)
//   session  → scripts/pull-session.sh   (fetch one session folder down, additive)
//   codebase → scripts/pull-codebase.sh  (fetch the hub's built .next down; stages under a live dev server)
//
// Transport is SSH+GNU-tar (the cPanel/Imunify scanner eats HTTP file uploads
// but not server-side writes — see scripts/deploy-server.sh).
//
// GUARD: only the spoke runs syncs. On the hub (OSKAR_SYNC_HUB unset) we refuse
// (returned as a normal JSON error, not a stream) — the hub has no deploy key.
//
// Stream protocol: raw script output, then a final sentinel line —
//   __SYNC_DONE__ <exitCode>   (0 = success)  |  __SYNC_ERROR__ <message>
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const NO_CACHE = { 'Cache-Control': 'no-store' }

// Per target, the script for each direction. `up` = push to hub, `down` = pull
// from hub. crm has no separate down: sync-crm.sh already pulls hub-authored
// files as part of its run, so both directions map to it.
const SCRIPTS: Record<string, { up: string; down: string; timeoutMs: number; needsId?: boolean }> = {
  codebase: { up: 'scripts/deploy-server.sh', down: 'scripts/pull-codebase.sh', timeoutMs: 12 * 60_000 },
  crm: { up: 'scripts/sync-crm.sh', down: 'scripts/sync-crm.sh', timeoutMs: 6 * 60_000 },
  session: { up: 'scripts/sync-session.sh', down: 'scripts/pull-session.sh', timeoutMs: 6 * 60_000, needsId: true },
}

export async function POST(req: NextRequest) {
  const target = new URL(req.url).searchParams.get('target') ?? ''
  const id = new URL(req.url).searchParams.get('id') ?? ''
  const dir = new URL(req.url).searchParams.get('dir') === 'down' ? 'down' : 'up'
  const spec = SCRIPTS[target]
  if (!spec) return NextResponse.json({ ok: false, error: 'target must be crm|session|codebase' }, { status: 400, headers: NO_CACHE })
  if (!process.env.OSKAR_SYNC_HUB) {
    return NextResponse.json({ ok: false, error: 'Syncs run from the spoke (the machine with OSKAR_SYNC_HUB set), not the hub.' }, { status: 409, headers: NO_CACHE })
  }
  if (spec.needsId && (!id || id.includes('/') || id.includes('..'))) {
    return NextResponse.json({ ok: false, error: 'valid session id required' }, { status: 400, headers: NO_CACHE })
  }

  const scriptFile = spec[dir]
  const args = spec.needsId ? [id] : []
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (s: string) => { try { controller.enqueue(enc.encode(s)) } catch { /* closed */ } }
      let child
      try {
        child = spawn('bash', [join(process.cwd(), scriptFile), ...args], { cwd: process.cwd() })
      } catch (e) {
        send(`__SYNC_ERROR__ ${e instanceof Error ? e.message : String(e)}\n`)
        try { controller.close() } catch { /* noop */ }
        return
      }
      // Watchdog only — we deliberately do NOT kill on client disconnect: a
      // deploy killed mid-ship could leave the hub half-updated. Let it finish.
      const killer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* noop */ }
        send(`\n__SYNC_ERROR__ timed out after ${Math.round(spec.timeoutMs / 1000)}s\n`)
      }, spec.timeoutMs)
      child.stdout.on('data', (d) => send(d.toString()))
      child.stderr.on('data', (d) => send(d.toString()))
      child.on('error', (e) => { clearTimeout(killer); send(`\n__SYNC_ERROR__ ${e.message}\n`); try { controller.close() } catch { /* noop */ } })
      child.on('close', (code) => { clearTimeout(killer); send(`\n__SYNC_DONE__ ${code ?? 1}\n`); try { controller.close() } catch { /* noop */ } })
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  })
}
