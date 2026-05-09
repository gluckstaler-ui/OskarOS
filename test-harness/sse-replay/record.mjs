#!/usr/bin/env node
/**
 * SSE Replay Harness — Recorder
 *
 * Captures SSE event sequences from chat-stream and build routes,
 * strips volatile fields (timestamps, message IDs, UIDs), and writes
 * structural baselines to JSON files.
 *
 * Usage:
 *   SESSION_ID=2026-01-27-debug BASE_URL=http://localhost:3000 node record.mjs
 *
 * Produces:
 *   recorded-chat.json   — SSE event shape from /api/chat-stream
 *   recorded-build.json  — event-bus events from a build-vibe fire
 *
 * WP-67 merge gate (Feature-X §18.1 WP-67 line 2815).
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SESSION_ID = process.env.SESSION_ID || '2026-01-27-debug'
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

// Fields to strip from every event — volatile or unique per run
const VOLATILE_FIELDS = new Set([
  'ts', 'timestamp', 'messageId', 'id', 'requestId',
  'jobId', 'cliSessionId', 'originalStartedAt',
])

function scrub(obj) {
  if (Array.isArray(obj)) return obj.map(scrub)
  if (obj && typeof obj === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
      if (VOLATILE_FIELDS.has(k)) continue
      out[k] = scrub(v)
    }
    return out
  }
  return obj
}

/**
 * Record chat-stream SSE events.
 * Sends a minimal "ping" message and captures the response event shapes.
 */
async function recordChat() {
  console.log(`[record] Capturing chat-stream SSE for session ${SESSION_ID}...`)

  const resp = await fetch(`${BASE_URL}/api/chat-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: '__harness_ping__' }],
      currentMessage: '__harness_ping__',
      sessionId: SESSION_ID,
      executionMode: 'cli',
      cdModel: 'claude-opus-4-7[1m]',
      webDevModel: 'claude-sonnet-4-6',
    }),
  })

  if (!resp.ok) {
    console.error(`[record] chat-stream returned HTTP ${resp.status}`)
    process.exit(1)
  }

  const events = []
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        events.push(scrub(JSON.parse(data)))
      } catch {}
    }
  }

  // Also drain any remaining buffer
  if (buffer.startsWith('data:')) {
    const data = buffer.slice(5).trim()
    if (data && data !== '[DONE]') {
      try { events.push(scrub(JSON.parse(data))) } catch {}
    }
  }

  return events
}

/**
 * Record build-vibe event-bus events.
 * Opens an EventSource to /api/events, fires a build request,
 * captures events until completion or timeout.
 */
async function recordBuild() {
  console.log(`[record] Capturing build events for session ${SESSION_ID}...`)

  // We need to use raw TCP to capture SSE from /api/events
  // since EventSource is browser-only. Use fetch + ReadableStream.
  const eventSourceUrl = `${BASE_URL}/api/events?session=${encodeURIComponent(SESSION_ID)}`
  const events = []

  // Start listening to the event bus
  const esResp = await fetch(eventSourceUrl)
  if (!esResp.ok) {
    console.error(`[record] /api/events returned HTTP ${esResp.status}`)
    process.exit(1)
  }

  const esReader = esResp.body.getReader()
  const esDecoder = new TextDecoder()
  let esBuffer = ''

  // Drain initial handshake events in background
  const readOne = async () => {
    const { done, value } = await esReader.read()
    if (done) return null
    esBuffer += esDecoder.decode(value, { stream: true })
    const lines = esBuffer.split('\n')
    esBuffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      try {
        const evt = JSON.parse(data)
        events.push(scrub(evt))
      } catch {}
    }
    return true
  }

  // Read a few initial events (handshake)
  for (let i = 0; i < 5; i++) {
    const r = await Promise.race([
      readOne(),
      new Promise(r => setTimeout(() => r(null), 1000)),
    ])
    if (!r) break
  }

  // Fire the build request
  const buildResp = await fetch(`${BASE_URL}/api/mcp/build-vibe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      target: 'vibe-1',
      mode: 'cli',
      model: 'claude-sonnet-4-6',
    }),
  })

  if (!buildResp.ok) {
    console.error(`[record] build-vibe returned HTTP ${buildResp.status}`)
    const body = await buildResp.text()
    console.error(body.slice(0, 200))
    process.exit(1)
  }

  const buildResult = await buildResp.json()
  console.log(`[record] Build enqueued: ${JSON.stringify(buildResult)}`)

  // Drain events for up to 120 seconds looking for vibe_built or vibe_failed
  const deadline = Date.now() + 120_000
  let found = false
  while (Date.now() < deadline && !found) {
    const r = await Promise.race([
      readOne(),
      new Promise(r => setTimeout(() => r(null), 2000)),
    ])
    if (r === null) continue
    // Check if we got a terminal event
    const terminal = events.find(e => e.type === 'vibe_built' || e.type === 'vibe_failed')
    if (terminal) {
      found = true
      // Read a few more events for completeness
      for (let i = 0; i < 3; i++) {
        await Promise.race([
          readOne(),
          new Promise(r => setTimeout(() => r(null), 500)),
        ])
      }
    }
  }

  esReader.cancel().catch(() => {})

  // Filter to build-related events only
  const buildEvents = events.filter(e =>
    ['build_started', 'build_progress', 'vibe_built', 'vibe_failed', 'build_failed'].includes(e.type)
  )

  return buildEvents
}

// --- Main ---

const args = process.argv.slice(2)
const mode = args[0] || 'all' // 'chat' | 'build' | 'all'

async function main() {
  if (mode === 'chat' || mode === 'all') {
    try {
      const chatEvents = await recordChat()
      const outPath = join(__dirname, 'recorded-chat.json')
      writeFileSync(outPath, JSON.stringify(chatEvents, null, 2))
      console.log(`[record] Chat baseline: ${chatEvents.length} events → ${outPath}`)
    } catch (err) {
      console.error(`[record] Chat capture failed:`, err.message)
    }
  }

  if (mode === 'build' || mode === 'all') {
    try {
      const buildEvents = await recordBuild()
      const outPath = join(__dirname, 'recorded-build.json')
      writeFileSync(outPath, JSON.stringify(buildEvents, null, 2))
      console.log(`[record] Build baseline: ${buildEvents.length} events → ${outPath}`)
    } catch (err) {
      console.error(`[record] Build capture failed:`, err.message)
    }
  }
}

main().catch(err => {
  console.error('[record] Fatal:', err)
  process.exit(1)
})
