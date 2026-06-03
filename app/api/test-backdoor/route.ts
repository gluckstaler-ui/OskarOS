/**
 * /api/test-backdoor — HTTP test surface (rewritten 2026-05-10 for WP-68).
 *
 * Purpose: drive a real OskarOS session via HTTP without UI friction.
 * Used by:
 *   • COO Claude (Bash + curl) — at test-harness/COO.md
 *   • Playwright e2e tests
 *   • Manual debug curl from any shell
 *
 * Architecture (current arch — was pre-MCP / pre-bridge / pre-per-session
 * before this rewrite):
 *   • Per-sessionId state (Map<sessionId, BackdoorState>) — no module globals
 *   • All actions wrap real APIs; no bypass paths, no second persona
 *   • Aligned with per-session folder doctrine (writes to public/{sessionId}/)
 *   • Dev-only — locked behind NODE_ENV check + path-not-exposed-in-prod-build
 *
 * Action surface (8 actions):
 *   start_session    — create or open a session
 *   upload_image     — copy a local file into public/{sessionId}/uploads/
 *   click_action     — fire a UI button (order_65, order_66, generate_all, etc.)
 *   wait_for_event   — poll event-bus replay until match or timeout
 *   get_state        — aggregate session state (messages, manifests, todos, vibes)
 *   read_log         — readFile a session-folder MD file
 *   screenshot       — wrap /api/mcp/screenshot
 *   reset            — clear per-session backdoor state
 *
 * User-impersonation (sending chat messages, responding to cards) lives on
 * 2 MCP tools — `send_user_input` and `respond_to_card` — registered in
 * `mcp-server/tools-orchestrator.ts`. Those tools are test-agent-allowlist
 * only; they enforce `from: 'user'` server-side. Card resolution and chat
 * input via the MCP tools is the principled split per WP-68.
 *
 * The earlier 12-action / 437-LOC pre-MCP backdoor is replaced by this
 * file. Old action names (`send`, `start-session`, `get-state`, etc.)
 * return 400 with a typed error citing the new surface.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, copyFile, mkdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { createSession, getSession } from '@/lib/session'
import { readTodos } from '@/lib/runtime/todos-store'
import { getImageManifestsAction } from '@/lib/session-actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ────────────────────────────────────────────────────────────────────────
// Per-session state
// ────────────────────────────────────────────────────────────────────────

interface BackdoorState {
  startedAt: string             // ISO timestamp of start_session
  businessName: string          // for SESSION.md header
  uploadedImages: string[]      // filenames copied into public/{id}/uploads/
  lastEventTs: string | null    // for incremental wait_for_event polling
}

const STATES = new Map<string, BackdoorState>()

function getState(sessionId: string): BackdoorState | undefined {
  return STATES.get(sessionId)
}

function ensureState(sessionId: string, businessName: string): BackdoorState {
  let s = STATES.get(sessionId)
  if (!s) {
    s = {
      startedAt: new Date().toISOString(),
      businessName,
      uploadedImages: [],
      lastEventTs: null,
    }
    STATES.set(sessionId, s)
  }
  return s
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

const BASE_URL = () => process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

function ok(data: Record<string, unknown>) {
  return NextResponse.json({ ok: true, ...data })
}

function err(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production'
}

// ────────────────────────────────────────────────────────────────────────
// Route handler
// ────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isDev()) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as
    | { action?: string; sessionId?: string; [k: string]: unknown }
    | null
  if (!body || !body.action) {
    return err('action required')
  }

  const action = String(body.action).trim()
  const sessionId = String(body.sessionId || '').trim()

  // Reject the old 12-action API names with a typed error citing the new surface.
  const RETIRED = new Set([
    'ping',
    'send',
    'start-session',
    'get-state',
    'get-image-prompts',
    'update-prompt',
    'generate-image',
    'generate-all-pending',
    'view-html',
    'list-generated-images',
    'list-vibes',
  ])
  if (RETIRED.has(action)) {
    return err(
      `action "${action}" was retired in the 2026-05-10 backdoor rewrite. ` +
        'New surface: start_session, upload_image, click_action, wait_for_event, ' +
        'get_state, read_log, screenshot, reset. User-impersonation (chat + ' +
        'card response) is on MCP tools send_user_input + respond_to_card.',
    )
  }

  try {
    switch (action) {
      case 'start_session':
        return await handleStartSession(body)
      case 'upload_image':
        return await handleUploadImage(sessionId, body)
      case 'click_action':
        return await handleClickAction(sessionId, body)
      case 'wait_for_event':
        return await handleWaitForEvent(sessionId, body)
      case 'get_state':
        return await handleGetState(sessionId)
      case 'read_log':
        return await handleReadLog(sessionId, body)
      case 'screenshot':
        return await handleScreenshot(sessionId, body)
      case 'reset':
        return await handleReset(sessionId)
      default:
        return err(
          `unknown action "${action}". Valid: start_session, upload_image, ` +
            'click_action, wait_for_event, get_state, read_log, screenshot, reset.',
        )
    }
  } catch (e) {
    return err(`handler error: ${e instanceof Error ? e.message : String(e)}`, 500)
  }
}

// ────────────────────────────────────────────────────────────────────────
// Action handlers
// ────────────────────────────────────────────────────────────────────────

async function handleStartSession(body: Record<string, unknown>) {
  const businessName = typeof body.businessName === 'string' ? body.businessName : 'Test Session'
  const session = await createSession(businessName)
  ensureState(session.id, businessName)
  return ok({ sessionId: session.id, businessName, startedAt: STATES.get(session.id)!.startedAt })
}

async function handleUploadImage(sessionId: string, body: Record<string, unknown>) {
  if (!sessionId) return err('sessionId required')
  const filePath = typeof body.filePath === 'string' ? body.filePath : ''
  if (!filePath) return err('filePath required (absolute path on the server filesystem)')

  if (!existsSync(filePath)) return err(`source file not found: ${filePath}`, 404)

  const filename = path.basename(filePath)
  const sessionDir = path.join(process.cwd(), 'public', sessionId)
  const uploadsDir = path.join(sessionDir, 'uploads')
  await mkdir(uploadsDir, { recursive: true })

  // Avoid name collisions — append timestamp if needed.
  let dest = path.join(uploadsDir, filename)
  if (existsSync(dest)) {
    const ext = path.extname(filename)
    const base = path.basename(filename, ext)
    dest = path.join(uploadsDir, `${base}-${Date.now()}${ext}`)
  }
  await copyFile(filePath, dest)

  const finalName = path.basename(dest)
  const state = STATES.get(sessionId)
  if (state) state.uploadedImages.push(finalName)

  return ok({
    imageId: finalName,
    filename: finalName,
    relativePath: `/${sessionId}/uploads/${finalName}`,
  })
}

const VALID_CLICK_ACTIONS = new Set([
  'order_65',
  'order_66',
  // Ralph 2026-05-18: 'build_final' removed — collapsed into array-based
  // build_vibe. Tests that need to fire final build should POST directly
  // to /api/mcp/build-vibe with {slugs: [selectedSlug]}.
  'generate_all',
  'set_billing_mode',
  'set_webdev_model',
  'set_layout_mode',
  'set_theme',
  'director_save',
])

async function handleClickAction(sessionId: string, body: Record<string, unknown>) {
  if (!sessionId) return err('sessionId required')
  const clickAction = typeof body.action === 'string' ? body.action : ''
  // (`body.action` here is the OUTER backdoor action — but click_action's
  // payload also has its own `action` field via body. Disambiguate via the
  // payload field instead.)
  // Actually, the outer `action` is "click_action"; the inner click target
  // lives at `body.payload?.action` OR a top-level `body.target`. Use a
  // dedicated field name to avoid shadowing.
  const target = typeof body.target === 'string' ? body.target : ''
  const payload = (body.payload as Record<string, unknown>) || {}
  if (!target) return err('target required (one of: ' + [...VALID_CLICK_ACTIONS].join(', ') + ')')
  if (!VALID_CLICK_ACTIONS.has(target)) {
    return err(`unknown click target "${target}". Valid: ${[...VALID_CLICK_ACTIONS].join(', ')}`)
  }

  const url = BASE_URL()

  switch (target) {
    case 'order_65': {
      const r = await fetch(`${url}/api/order65?session=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
      })
      if (!r.ok) return err(`order_65 failed: HTTP ${r.status}`, r.status)
      return ok({ target, status: r.status })
    }
    case 'order_66': {
      const r = await fetch(`${url}/api/order66?session=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
      })
      if (!r.ok) return err(`order_66 failed: HTTP ${r.status}`, r.status)
      return ok({ target, status: r.status })
    }
    // Ralph 2026-05-18: 'build_final' case removed — collapsed into
    // array-based build_vibe. Use a direct POST to /api/mcp/build-vibe
    // with {slugs: [selectedSlug]} for final-build testing.
    case 'generate_all': {
      // The "Generate All" UI button kicks off the existing image-generation
      // pipeline. We delegate to the same path the AssetsPanel button uses.
      const r = await fetch(`${url}/api/mcp/refresh-assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, generateAll: true, ...payload }),
      })
      if (!r.ok) return err(`generate_all failed: HTTP ${r.status}`, r.status)
      return ok({ target, status: r.status })
    }
    case 'set_billing_mode':
    case 'set_webdev_model':
    case 'set_layout_mode':
    case 'set_theme': {
      // TopBar pill writes — go through the session-config endpoint.
      const fieldMap: Record<string, string> = {
        set_billing_mode: 'billingMode',
        set_webdev_model: 'webDevModel',
        set_layout_mode: 'layoutMode',
        set_theme: 'theme',
      }
      const field = fieldMap[target]
      const value = payload.value
      if (typeof value !== 'string') {
        return err(`payload.value (string) required for ${target}`)
      }
      const r = await fetch(`${url}/api/sessions/${encodeURIComponent(sessionId)}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      if (!r.ok) return err(`${target} failed: HTTP ${r.status}`, r.status)
      return ok({ target, field, value })
    }
    case 'director_save': {
      const r = await fetch(`${url}/api/director/save-edits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...payload }),
      })
      if (!r.ok) return err(`director_save failed: HTTP ${r.status}`, r.status)
      return ok({ target, status: r.status })
    }
  }

  return err(`click target "${target}" handler not implemented`)
}

async function handleWaitForEvent(sessionId: string, body: Record<string, unknown>) {
  if (!sessionId) return err('sessionId required')
  const eventType = typeof body.eventType === 'string' ? body.eventType : ''
  if (!eventType) return err('eventType required')
  const timeoutMs = typeof body.timeoutMs === 'number' ? body.timeoutMs : 60_000
  const pollIntervalMs = 500
  const state = STATES.get(sessionId)
  // Use the lastEventTs as the floor — only events newer than this count.
  const sinceTs = state?.lastEventTs ?? new Date(Date.now() - 5_000).toISOString()

  const startedAt = Date.now()
  const url = BASE_URL()

  while (Date.now() - startedAt < timeoutMs) {
    const r = await fetch(`${url}/api/mcp/replay-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, sinceTs }),
    })
    if (r.ok) {
      const data = (await r.json().catch(() => ({}))) as {
        events?: { type?: string; ts?: string; [k: string]: unknown }[]
      }
      const events = data.events || []
      const match = events.find((e) => e.type === eventType)
      if (match) {
        if (state && typeof match.ts === 'string') state.lastEventTs = match.ts
        return ok({ event: match, elapsedMs: Date.now() - startedAt })
      }
    }
    await new Promise((res) => setTimeout(res, pollIntervalMs))
  }

  return err(`timeout waiting for event "${eventType}" after ${timeoutMs}ms`, 408)
}

async function handleGetState(sessionId: string) {
  if (!sessionId) return err('sessionId required')
  const session = await getSession(sessionId)
  if (!session) return err(`session "${sessionId}" not found`, 404)

  const [todos, manifestsResult, galleryResp] = await Promise.all([
    readTodos(sessionId).catch(() => []),
    getImageManifestsAction(sessionId).catch(() => ({ success: false as const, manifests: [] })),
    fetch(`${BASE_URL()}/api/sessions/${encodeURIComponent(sessionId)}/gallery`)
      .then((r) => (r.ok ? r.json() : { cards: [] }))
      .catch(() => ({ cards: [] })),
  ])

  // Tail of SESSION.md — last ~5k chars to avoid bloating the response.
  const sessionMd = session.sessionMd || ''
  const sessionTail = sessionMd.length > 5000 ? sessionMd.slice(-5000) : sessionMd

  return ok({
    sessionId,
    sessionMdTail: sessionTail,
    todos,
    manifests: ('manifests' in manifestsResult ? manifestsResult.manifests : []) || [],
    vibes: (galleryResp as { cards?: unknown[] }).cards || [],
    backdoorState: STATES.get(sessionId) ?? null,
  })
}

async function handleReadLog(sessionId: string, body: Record<string, unknown>) {
  if (!sessionId) return err('sessionId required')
  const log = typeof body.log === 'string' ? body.log : ''
  if (!log) return err('log required')

  const ALIASES: Record<string, string> = {
    session: 'SESSION.md',
    images: 'IMAGES.md',
    brief: 'CREATIVE-BRIEF.md',
    build: 'BUILD.md',
  }
  const filename = ALIASES[log] ?? log
  // Confine to the session folder — refuse path traversal attempts.
  if (filename.includes('..') || path.isAbsolute(filename)) {
    return err('log path must be relative to the session folder')
  }
  const fullPath = path.join(process.cwd(), 'public', sessionId, filename)
  if (!existsSync(fullPath)) return err(`log not found: ${filename}`, 404)
  const [content, st] = await Promise.all([readFile(fullPath, 'utf-8'), stat(fullPath)])
  return ok({ log: filename, content, mtime: st.mtime.toISOString(), size: st.size })
}

async function handleScreenshot(sessionId: string, body: Record<string, unknown>) {
  if (!sessionId) return err('sessionId required')
  const target = typeof body.target === 'string' ? body.target : ''
  if (!target) return err('target required (vibe slug, filename, or "session")')
  const frame = typeof body.frame === 'string' ? body.frame : 'desktop'

  const r = await fetch(`${BASE_URL()}/api/mcp/screenshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, target, frame }),
  })
  if (!r.ok) return err(`screenshot failed: HTTP ${r.status}`, r.status)
  const data = (await r.json().catch(() => ({}))) as { filePath?: string; path?: string }
  return ok({ filePath: data.filePath ?? data.path ?? null })
}

async function handleReset(sessionId: string) {
  if (!sessionId) return err('sessionId required')
  const had = STATES.delete(sessionId)
  return ok({ cleared: had })
}
