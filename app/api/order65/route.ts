/**
 * /api/order65 — SSE endpoint (soft compaction)
 *
 * Runs the two Sage agents WITHOUT killing the bridge.
 * The bridge stays alive — compaction happens alongside the live session.
 *
 * Order 65 runs:
 *   - Sage-240/40   — SESSION.md compression (only if >240KB)
 *   - Sage-Portrait — user.md painting (parallel with 240/40)
 *
 * Flow:
 *   1. Start Sage-240/40 + Sage-Portrait in parallel (different files, safe)
 *   2. Stream real-time ProgressEvents to the overlay
 *   3. When both complete, signal done
 *   4. If client disconnects (Continue button), abort in-flight work
 */

import { NextRequest } from 'next/server'
import { runSagePortrait, runSage240_40 } from '@/lib/memory/dreamer'
import type { ProgressEvent } from '@/lib/memory/dreamer'

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
        console.log(`[order65] Client disconnected for ${sessionId} — aborting`)
        close()
      })

      try {
        // Order 65: Bridge NOT killed — session stays alive during compaction

        // ── Two Sages in parallel ─────────────────────────────────
        const onProgress = (event: ProgressEvent) => {
          if (aborted || streamClosed) return
          send({
            agent: event.agent,
            phase: event.phase,
            stage: event.stage || null,
            detail: event.detail || null,
          })
        }

        send({ phase: 'compaction-started' })

        // Different files (SESSION.md vs user.md) — parallel-safe.
        //
        // 3s stagger is for `claude --print` OAuth-lock contention only —
        // two simultaneous spawns starve one process's auth handshake. NOT
        // for audio. The audio bug was React reconciliation cost from the
        // live feed; that fix lives in CompactionOverlay.tsx's throttled
        // flush.
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
          // Legacy field — mirrors Portrait for older clients.
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

        send({ phase: 'bridge-ready' })
        console.log(
          `[order65] Complete for ${sessionId} — ` +
          `Portrait:${portraitResult.stats.userMemoryUpdated ? 'updated' : 'unchanged'}, ` +
          `240/40:${sage240Result.stats.triggered ? `cut ${sage240Result.stats.bytesCut}B` : 'skipped'}`,
        )

      } catch (err) {
        if (!aborted) {
          send({ phase: 'error', message: String(err) })
          console.error(`[order65] Error for ${sessionId}:`, err)
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
