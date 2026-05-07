/**
 * /api/mcp/snackbar — fire-and-forget user notification (Phase 2 Tier S).
 *
 * The agent calls `snackbar(text, severity?, sticky?)`; this route publishes
 * a `cd_snackbar` event to the per-session event-bus. The frontend's
 * /api/events SSE delivers it, and the existing SnackbarProvider renders
 * it using the SAME palette as every other snackbar in the app.
 *
 * Severity vocabulary (matches components/Snackbar.tsx):
 *   info     — blue,        auto-dismiss 5s
 *   success  — green,       auto-dismiss 5s
 *   progress — cyan,        sticky by default
 *   warning  — yellow,      sticky by default
 *   error    — red,         sticky by default
 *
 * `warn` is accepted as an alias for `warning` for back-compat.
 *
 * `sticky` is orthogonal to severity — pass true to keep info/success
 * visible, or false to auto-dismiss progress/warning/error.
 */

import { NextRequest, NextResponse } from 'next/server'
import { publish } from '@/lib/event-bus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SnackbarSeverity = 'info' | 'success' | 'progress' | 'warning' | 'error'

function normalizeSeverity(input: unknown): SnackbarSeverity {
  if (input === 'warn') return 'warning'
  if (
    input === 'info' ||
    input === 'success' ||
    input === 'progress' ||
    input === 'warning' ||
    input === 'error'
  ) {
    return input
  }
  return 'info'
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | {
        sessionId?: string
        text?: string
        severity?: string
        sticky?: boolean
      }
    | null
  if (!body?.sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  if (!body.text || typeof body.text !== 'string') {
    return NextResponse.json({ ok: false, error: 'text required' }, { status: 400 })
  }
  const severity = normalizeSeverity(body.severity)
  // `sticky` may be true | false | undefined. Undefined → frontend uses
  // the per-severity default (progress/warning/error sticky; others auto).
  const sticky = typeof body.sticky === 'boolean' ? body.sticky : undefined

  // `level` is the legacy field; map sticky severities to 'warn' for any
  // listener that still keys off it. UI now uses `severity` directly.
  const level =
    severity === 'warning' || severity === 'error' || severity === 'progress'
      ? 'warn'
      : 'info'

  publish(body.sessionId, {
    type: 'cd_snackbar',
    text: body.text,
    severity,
    sticky,
    level,
  } as Parameters<typeof publish>[1])

  return NextResponse.json({ ok: true })
}
