/**
 * /api/order66 — SSE endpoint (hard compaction)
 *
 * Kills the bridge FIRST, then runs LJ + Sage.
 * Bridge must be respawned after — next chat message auto-spawns via getOrSpawn().
 *
 * Flow:
 *   1. Kill current bridge process
 *   2. Fire Lumberjack + Sage IN PARALLEL (they write to different files)
 *   3. Stream real-time ProgressEvents to the overlay
 *   4. When both complete, signal bridge-ready (next chat message auto-spawns)
 *   5. If client disconnects (Continue button), abort in-flight work
 */

import { NextRequest } from 'next/server'
import { runLumberjack } from '@/lib/memory/lumberjack'
import { runDreamerOrder66 } from '@/lib/memory/dreamer'
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
        console.log(`[order66] Bridge killed for ${sessionId}`)

        // ── LJ + Sage in parallel ─────────────────────────────────
        // Shared progress callback → SSE events
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

        // Stagger starts by 3s — two simultaneous `claude --print`
        // processes fight over the CLI's OAuth lock and one starves.
        // Sage kicks off 3s after LJ. Still parallel once both are running.
        const ljPromise = runLumberjack(sessionId, onProgress)
        await new Promise(r => setTimeout(r, 3000))
        const sagePromise = runDreamerOrder66(sessionId, onProgress)

        const [ljResult, sageResult] = await Promise.all([
          ljPromise,
          sagePromise,
        ])

        if (aborted) { close(); return }

        // ── Phase 3: Results ──────────────────────────────────────
        send({
          phase: 'compaction-complete',
          lumberjack: {
            status: ljResult.status,
            inputSize: ljResult.inputSize,
            outputSize: ljResult.outputSize,
            compression: ljResult.compressionRatio,
            stagesCompleted: ljResult.stagesCompleted,
            stagesFailed: ljResult.stagesFailed,
          },
          sage: {
            userMemoryUpdated: sageResult.stats.userMemoryUpdated,
            sessionMdSize: sageResult.stats.sessionMdSize,
          },
        })

        // Bridge auto-spawns on next chat message via getOrSpawn()
        // No need to explicitly spawn here
        send({ phase: 'bridge-ready' })
        console.log(`[order66] Complete for ${sessionId} — LJ:${ljResult.status}, Sage:${sageResult.stats.userMemoryUpdated ? 'updated' : 'unchanged'}`)

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
