/**
 * /api/order66 — SSE endpoint (hard compaction)
 *
 * Kills the bridge FIRST, then runs the two Sage agents.
 *
 * 2026-04-21: Lumberjack removed from order66 — the 7-stage Lumberjack
 * architecture was failing on every call (see git history). Lumberjack's
 * per-10-minute piggyback cadence still runs via maybeRunLumberjack in the
 * chat routes. Order 66 now runs:
 *   - Sage-240/40   — SESSION.md compression (only if >240KB, fast skip otherwise)
 *   - Sage-Portrait — user.md painting (parallel to 240/40, writes a different file)
 *
 * Flow:
 *   1. Kill current bridge process
 *   2. Start Sage-240/40 (may cut SESSION.md in place)
 *   3. Start Sage-Portrait in parallel (writes user.md — different file, safe)
 *   4. Stream real-time ProgressEvents to the overlay
 *   5. When both complete, signal bridge-ready (next chat message auto-spawns)
 *   6. If client disconnects (Continue button), abort in-flight work
 */

import { NextRequest } from 'next/server'
import { runSagePortrait, runSage240_40 } from '@/lib/memory/dreamer'
import type { ProgressEvent } from '@/lib/memory/lumberjack'
import { bridgeManager } from '@/lib/bridge-process-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session')
  if (!sessionId) {
    return new Response('Missing ?session=', { status: 400 })
  }

  const encoder = new TextEncoder()
  let streamClosed = false
  let aborted = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (streamClosed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          streamClosed = true
        }
      }

      const close = () => {
        if (streamClosed) return
        streamClosed = true
        try { controller.close() } catch {}
      }

      // Abort signal — fires when client disconnects (Continue button)
      req.signal.addEventListener('abort', () => {
        aborted = true
        console.log(`[order66] Client disconnected for ${sessionId} — aborting`)
        close()
      })

      try {
        // Order 66: Kill the bridge — process + disk mapping
        send({ phase: 'bridge-killing' })
        bridgeManager.kill(sessionId)
        // Also nuke the disk mapping so it can't resurrect on restart
        try {
          const { unlinkSync, existsSync } = require('fs')
          const { join } = require('path')
          const mappingPath = join(process.cwd(), 'public', sessionId, 'logs', 'BRIDGE.json')
          if (existsSync(mappingPath)) unlinkSync(mappingPath)
        } catch {}
        // Phase 2 (2026-04-30): wipe accumulated screenshots from MCP
        // `screenshot` tool. Ralph wants compaction to be a clean slate —
        // screenshots are session-scoped evidence, not durable state.
        try {
          const { rmSync } = require('fs')
          const { join } = require('path')
          const screensDir = join(process.cwd(), 'public', sessionId, 'screenshots')
          rmSync(screensDir, { recursive: true, force: true })
        } catch {}
        console.log(`[order66] Bridge killed for ${sessionId}`)

        // ── Two Sages in parallel ─────────────────────────────────
        // Shared progress callback → SSE events
        const onProgress = (event: ProgressEvent) => {
          if (aborted || streamClosed) return
          // 2026-05-03 (Ralph): pass-through with field-defaults rather than
          // hand-picking. The previous version stripped every field except
          // {agent, phase, stage, detail} — which silently dropped `progress`
          // (added 2026-05-03 for per-pass bar advance) and any future
          // fields. Forward the whole event; nullify only the optional
          // fields the overlay expects to be either set or null.
          send({
            ...event,
            stage: event.stage || null,
            detail: event.detail || null,
          })
        }

        send({ phase: 'compaction-started' })

        // Sage-240/40 and Sage-Portrait write to different files (SESSION.md
        // vs user.md), so they're parallel-safe.
        //
        // 3s stagger is for `claude --print` OAuth-lock contention only —
        // two simultaneous spawns starve one process's auth handshake. NOT
        // for audio. The audio bug was React reconciliation cost from the
        // live feed; that fix lives in CompactionOverlay.tsx's throttled
        // flush. Stagger length here is incidental.
        const sage240Promise = runSage240_40(sessionId, onProgress)
        await new Promise((r) => setTimeout(r, 3000))
        const portraitPromise = runSagePortrait(sessionId, onProgress)
        const [sage240Result, portraitResult] = await Promise.all([
          sage240Promise,
          portraitPromise,
        ])

        if (aborted) { close(); return }

        // ── Results ────────────────────────────────────────────────
        send({
          phase: 'compaction-complete',
          // Keep the legacy `sage` field so older clients don't break.
          // It mirrors Portrait's stats (the user.md signal).
          sage: {
            userMemoryUpdated: portraitResult.stats.userMemoryUpdated,
            sessionMdSize: portraitResult.stats.sessionMdSize,
          },
          sagePortrait: {
            userMemoryUpdated: portraitResult.stats.userMemoryUpdated,
            sessionMdSize: portraitResult.stats.sessionMdSize,
            triageLog: portraitResult.stats.triageLog,
          },
          sage240_40: {
            triggered: sage240Result.stats.triggered,
            sessionMdSize: sage240Result.stats.sessionMdSize,
            sessionMdSizeAfter: sage240Result.stats.sessionMdSizeAfter,
            bytesCut: sage240Result.stats.bytesCut,
            snapshotPath: sage240Result.stats.snapshotPath,
          },
        })

        // Bridge auto-spawns on next chat message via getOrSpawn()
        send({ phase: 'bridge-ready' })
        console.log(
          `[order66] Complete for ${sessionId} — ` +
          `Portrait:${portraitResult.stats.userMemoryUpdated ? 'updated' : 'unchanged'}, ` +
          `240/40:${sage240Result.stats.triggered ? `cut ${sage240Result.stats.bytesCut}B` : 'skipped'}`,
        )

      } catch (err) {
        if (!aborted) {
          send({ phase: 'error', message: String(err) })
          console.error(`[order66] Error for ${sessionId}:`, err)
        }
      } finally {
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
