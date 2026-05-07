/**
 * /api/lumberjack-watch — live-watch endpoint for the single-agent Lumberjack.
 *
 * Spawns `claude --print` with the lumberjack-padawan.md system prompt and
 * inlined SESSION.md, then streams every stream-json event from the CLI as
 * SSE events to the browser. Lets you WATCH the agent work — see each
 * Read/Edit tool_use fire, see the final report land.
 *
 * Different purpose from /api/order65 and /api/order66:
 *   - order65/66 run LJ + Sage together as part of a full compaction cycle
 *     (they emit HIGH-LEVEL phase events: "started", "compacting 30s",
 *     "completed")
 *   - lumberjack-watch runs ONLY lumberjack, and emits EVERY stream-json
 *     event verbatim so you can see the agent's actual moves.
 *
 * Usage from the browser:
 *   new EventSource('/api/lumberjack-watch?session=2026-01-27-31')
 *   → events: {kind:'init',...} {kind:'tool_use', name:'Edit', ...}
 *     {kind:'tool_result', is_error:false} {kind:'text', text:'...'}
 *     {kind:'result', duration_ms:..., num_turns:..., result:'...'}
 *
 * The accompanying page `public/lumberjack-watch.html` pretty-prints these
 * events in real time.
 */

import { NextRequest } from 'next/server'
import { readFile, stat, writeFile } from 'fs/promises'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import path from 'path'
import { loadLumberjackPadawan } from '@/lib/memory/prompts'
import { getSessionMdPath } from '@/lib/memory/paths'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LUMBERJACK_MODEL = 'claude-sonnet-4-6'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session')
  if (!sessionId) {
    return new Response('Missing ?session=', { status: 400 })
  }

  const encoder = new TextEncoder()
  let streamClosed = false

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

      let child: ReturnType<typeof spawn> | null = null
      let promptFile = ''

      // If the client hits the Stop button in the browser, disconnect fires
      // the abort signal — kill the CLI subprocess so we stop burning tokens.
      req.signal.addEventListener('abort', () => {
        send({ kind: 'aborted', reason: 'client disconnected' })
        if (child && !child.killed) {
          try { child.kill('SIGTERM') } catch {}
        }
        close()
      })

      try {
        // ── Preflight ────────────────────────────────────────────────────
        const sessionPath = getSessionMdPath(sessionId)
        let inputSize = 0
        try {
          const s = await stat(sessionPath)
          inputSize = s.size
        } catch {
          send({ kind: 'error', message: `SESSION.md not found for ${sessionId}` })
          close()
          return
        }
        if (inputSize === 0) {
          send({ kind: 'error', message: 'SESSION.md empty' })
          close()
          return
        }

        // ── Build the prompt: padawan.md + inlined SESSION.md ────────────
        const padawan = loadLumberjackPadawan()
        const currentFile = await readFile(sessionPath, 'utf-8')
        const enrichedPrompt =
          padawan +
          '\n\n## CURRENT SESSION.md CONTENT\n\n' +
          `File: ${sessionPath}\n` +
          `Size: ${currentFile.length} bytes\n\n` +
          'The complete live content is below. Do NOT call the Read tool — ' +
          'the content here IS the current state. Use ONLY the Edit tool to ' +
          'write changes back to the file path above.\n\n' +
          '```markdown\n' +
          currentFile +
          '\n```\n'

        promptFile = path.join(tmpdir(), `lj-watch-${Date.now()}.txt`)
        writeFileSync(promptFile, enrichedPrompt, 'utf-8')

        send({
          kind: 'started',
          sessionId,
          inputSize,
          inputKb: +(inputSize / 1024).toFixed(1),
          promptBytes: enrichedPrompt.length,
          model: LUMBERJACK_MODEL,
        })

        // ── Spawn the CLI with stream-json output ────────────────────────
        // spawn (not exec) so we can read stdout line-by-line as events
        // arrive. Each CLI event becomes one SSE event to the browser.
        const args = [
          '--print',
          '--verbose',
          '--output-format', 'stream-json',
          '--model', LUMBERJACK_MODEL,
          '--tools', 'Read,Edit',
          '--system-prompt-file', promptFile,
          '--dangerously-skip-permissions',
          '--no-session-persistence',
          'Execute the task described in your system prompt.',
        ]
        child = spawn('claude', args, {
          cwd: process.cwd(),
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        })

        // Buffer stdout across chunk boundaries so we only parse complete lines.
        let buf = ''
        child.stdout!.on('data', (chunk: Buffer) => {
          buf += chunk.toString('utf-8')
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line) continue
            handleCliLine(line, send)
          }
        })

        child.stderr!.on('data', (chunk: Buffer) => {
          // Forward stderr for visibility; rarely populated in normal runs.
          send({ kind: 'stderr', text: chunk.toString('utf-8').slice(0, 400) })
        })

        child.on('close', async (code) => {
          // Flush any leftover unterminated line
          if (buf.trim()) handleCliLine(buf.trim(), send)

          // Persist a debug-log receipt too so the run is findable later.
          try {
            const finalSize = await stat(sessionPath).then((s) => s.size).catch(() => 0)
            const ratio =
              inputSize > 0 ? ((1 - finalSize / inputSize) * 100).toFixed(0) : '0'
            send({
              kind: 'exit',
              code,
              inputSize,
              outputSize: finalSize,
              compressionRatio: ratio,
            })
          } catch {
            send({ kind: 'exit', code })
          }
          try { if (promptFile) unlinkSync(promptFile) } catch {}
          close()
        })

        child.on('error', (err) => {
          send({ kind: 'error', message: `spawn error: ${err.message}` })
          try { if (promptFile) unlinkSync(promptFile) } catch {}
          close()
        })
      } catch (err) {
        send({ kind: 'error', message: String(err) })
        try { if (promptFile) unlinkSync(promptFile) } catch {}
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

/**
 * Transform one CLI stream-json line into a compact SSE event. We intentionally
 * DROP the `tool_use_result.originalFile` sidecar field that the CLI emits —
 * it's a 340 KB snapshot of the pre-edit file on every Edit success, and it
 * was what bloated the debug logs to 3 MB. The model doesn't need it for
 * progress; the browser definitely doesn't.
 */
function handleCliLine(line: string, send: (e: Record<string, unknown>) => void) {
  let obj: any
  try {
    obj = JSON.parse(line)
  } catch {
    // Truncated / non-JSON line — forward as-is for debugging.
    send({ kind: 'raw', text: line.slice(0, 400) })
    return
  }

  const t = obj?.type
  if (t === 'system' && obj.subtype === 'init') {
    send({
      kind: 'init',
      model: obj.model,
      tools: obj.tools,
      sessionIdCli: obj.session_id,
    })
    return
  }
  // rate_limit_event and api_retry handlers REMOVED 2026-04-21.
  // The CLI emits rate_limit_event on every turn with status:"allowed" —
  // forwarding it made the UI flash a rate-limit warning constantly. Real
  // failures come through as result events with is_error:true (handled
  // below). If a future need arises for live retry visibility, surface
  // it conditional on errorStatus ≥ 400, not unconditionally.
  if (t === 'rate_limit_event' || (t === 'system' && obj.subtype === 'api_retry')) {
    return
  }
  if (t === 'assistant') {
    const content = obj?.message?.content || []
    for (const c of content) {
      if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
        send({ kind: 'text', text: c.text })
      } else if (c.type === 'thinking') {
        // Keep thinking short — it's often long and repetitive
        send({ kind: 'thinking', preview: (c.thinking || '').slice(0, 200) })
      } else if (c.type === 'tool_use') {
        const input = c.input || {}
        send({
          kind: 'tool_use',
          id: c.id,
          name: c.name,
          // Summarize known tools compactly; pass raw input for others
          summary: summarizeToolUse(c.name, input),
        })
      }
    }
    return
  }
  if (t === 'user') {
    // User messages in the stream are tool_result payloads from the CLI
    // reporting back to itself. We care about whether each one errored.
    const content = obj?.message?.content || []
    for (const c of content) {
      if (c.type === 'tool_result') {
        const body = typeof c.content === 'string' ? c.content : JSON.stringify(c.content)
        send({
          kind: 'tool_result',
          id: c.tool_use_id,
          isError: !!c.is_error,
          // First 200 chars — enough for "updated successfully" or error
          // message, nothing near the 340 KB `originalFile` sidecar we drop.
          preview: (body || '').slice(0, 200),
        })
      }
    }
    return
  }
  if (t === 'result') {
    send({
      kind: 'result',
      isError: !!obj.is_error,
      durationMs: obj.duration_ms,
      numTurns: obj.num_turns,
      costUsd: obj.total_cost_usd,
      result: typeof obj.result === 'string' ? obj.result : '',
    })
    return
  }
  // Any other event — forward its type for visibility
  send({ kind: 'other', type: t })
}

function summarizeToolUse(name: string, input: Record<string, any>): string {
  if (name === 'Read') {
    const fp = (input.file_path || '').split('/').pop() || '?'
    const parts = [fp]
    if (input.offset != null) parts.push(`offset=${input.offset}`)
    if (input.limit != null) parts.push(`limit=${input.limit}`)
    return parts.join(' ')
  }
  if (name === 'Edit') {
    const fp = (input.file_path || '').split('/').pop() || '?'
    const oldStr = String(input.old_string || '').replace(/\n/g, '\\n').slice(0, 80)
    return `${fp}  old="${oldStr}"`
  }
  // Generic fallback
  const keys = Object.keys(input).slice(0, 3)
  return `${keys.map((k) => `${k}=${String(input[k]).slice(0, 40)}`).join(' ')}`
}
