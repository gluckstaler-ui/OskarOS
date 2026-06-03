/**
 * GET /api/sessions/[id]/probe-model?mode=smpl|cli|api
 *
 * Returns the ACTUAL model Claude Code (CLI) or Anthropic (API) is going
 * to use for this session's next CD turn. Real query, not config inference.
 *
 * Ralph 2026-05-04 (Bug M follow-up): the badge MUST reflect the truth
 * on the wire when the user toggles billing mode. Reading config files
 * or translating session-config sentinels would be "cheating" — Ralph's
 * word — because the wire truth can differ from what we configured
 * (e.g. Claude Code's settings override our --model default, or
 * ANTHROPIC_BASE_URL routes through a compat layer that maps model
 * names internally).
 *
 * Probe semantics per mode:
 *
 *   ── CLI ──
 *   Claude Code emits a `system/init` JSON event as the first stdout
 *   line of every `claude --output-format stream-json` invocation. That
 *   event's `model` field is the truth. Two sources, fastest first:
 *     1. If a bridge is already running for this session, use its
 *        cached `actualModel` (captured from a prior init event). Free.
 *     2. Otherwise spawn `claude --print "" --output-format stream-json`
 *        in a child process, read stdout until init lands (always the
 *        first JSON line), parse `model`, kill the child, return.
 *        The probe sends an empty prompt so Claude Code has nothing to
 *        actually run on the LLM side — init fires from local config
 *        resolution, not from the Anthropic call. Effectively zero cost.
 *
 *   ── API ──
 *   We control the wire — the model we send IS the model in use, since
 *   the Anthropic API doesn't have its own default to override us. The
 *   honest answer here is `resolveConfig('cdModel', ...)` with the
 *   'auto' sentinel translated to a real Anthropic identifier. This
 *   isn't cheating because there's no separate process to query — we
 *   ARE the process making the request.
 *
 * Returns: `{ model: string, source: 'bridge-cache' | 'cli-probe' | 'api-config' }`.
 * On CLI probe failure (Claude Code missing, env wrong, timeout):
 * `{ error: string }` with HTTP 500.
 */

import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { resolveConfig } from '@/lib/session-config'
import { bridgeManager } from '@/lib/bridge-process-manager'
import { findBinary } from '@/lib/cli-paths'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

function findClaudeBinary(): string | null {
  // Resolve via the shared candidate list (lib/cli-paths.ts, WP-40). Preserve
  // the null contract: findBinary falls back to the bare name 'claude' when
  // nothing resolves — treat that as "not found" so the caller's explicit
  // error fires instead of spawning a guaranteed-ENOENT process. Operators on
  // an unusual layout (e.g. nvm-only) can set CLAUDE_BIN to pin the path.
  const p = findBinary('claude')
  return existsSync(p) ? p : null
}

interface InitEventShape {
  type?: string
  subtype?: string
  model?: string
}

/**
 * Spawn `claude --print "" --output-format stream-json` and capture the
 * first system/init event's model field. Empty prompt means Claude Code
 * never reaches the LLM call — the init event fires from local config
 * resolution. Kills the child as soon as init lands.
 *
 * Times out at 8 seconds; throws on timeout, missing binary, or stream
 * malformation.
 */
async function probeCliModel(): Promise<string> {
  const claudePath = findClaudeBinary()
  if (!claudePath) throw new Error('claude binary not found — set CLAUDE_BIN or install claude on PATH (see lib/cli-paths.ts candidates)')

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      claudePath,
      ['--print', '--output-format', 'stream-json', '--verbose'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      },
    )

    // Send a minimal prompt via stdin so --print doesn't error. The init
    // event fires before the model processes input, so we kill the child
    // as soon as init lands — the model never actually runs.
    try {
      child.stdin?.write('test\n')
      child.stdin?.end()
    } catch { /* best effort */ }

    let buffer = ''
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGTERM') } catch {}
      reject(new Error('CLI probe timed out after 8s waiting for system/init event'))
    }, 8000)

    const stderr: string[] = []
    child.stderr?.on('data', (chunk) => {
      stderr.push(chunk.toString())
    })

    child.stdout?.on('data', (chunk) => {
      if (settled) return
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        try {
          const obj = JSON.parse(line) as InitEventShape
          // Two valid init shapes:
          //   {type: 'system', subtype: 'init', model: 'X'}        ← newer Claude Code
          //   {type: 'init', model: 'X'}                           ← older shape (also seen via bridge)
          const isInit =
            (obj.type === 'system' && obj.subtype === 'init') ||
            obj.type === 'init'
          if (isInit && typeof obj.model === 'string' && obj.model.length > 0) {
            settled = true
            clearTimeout(timeout)
            try { child.kill('SIGTERM') } catch {}
            resolve(obj.model)
            return
          }
        } catch {
          // Ignore non-JSON noise
        }
      }
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      const stderrStr = stderr.join('').slice(0, 500)
      reject(new Error(
        `claude probe exited with code ${code} before emitting system/init. ` +
        `stderr: ${stderrStr || '<empty>'}`,
      ))
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(err)
    })
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId required' }, { status: 400, headers: NO_CACHE })
    }
    const url = new URL(req.url)
    const mode = url.searchParams.get('mode')
    if (mode !== 'smpl' && mode !== 'cli' && mode !== 'api') {
      return NextResponse.json({ error: 'mode must be `smpl`, `cli`, or `api`' }, { status: 400, headers: NO_CACHE })
    }

    if (mode === 'api') {
      // We control the wire for API mode — resolve, translate the 'auto'
      // sentinel, return. No probe necessary because there's no separate
      // process to query.
      const raw = resolveConfig('cdModel', null, sessionId, 'claude-opus-4-8')
      const model = raw === 'auto' ? 'claude-opus-4-8' : raw
      return NextResponse.json({ model, source: 'api-config' }, { headers: NO_CACHE })
    }

    // SMPL and CLI both use the bridge — prefer cached actualModel.
    const cached = bridgeManager.getProcessActualModel?.(sessionId) ?? null
    if (cached) {
      return NextResponse.json({ model: cached, source: 'bridge-cache' }, { headers: NO_CACHE })
    }

    // No bridge running — spawn a real probe.
    const probed = await probeCliModel()
    return NextResponse.json({ model: probed, source: 'cli-probe' }, { headers: NO_CACHE })
  } catch (err) {
    console.error('[/api/sessions/[id]/probe-model] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: `Probe failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500, headers: NO_CACHE },
    )
  }
}
