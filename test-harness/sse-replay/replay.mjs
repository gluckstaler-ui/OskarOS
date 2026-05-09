#!/usr/bin/env node
/**
 * SSE Replay Harness — Replayer
 *
 * Re-fires the same requests as record.mjs, captures new SSE streams,
 * and diffs against the recorded baselines. Structural match = pass.
 *
 * Usage:
 *   SESSION_ID=2026-01-27-debug BASE_URL=http://localhost:3000 node replay.mjs
 *
 * Exit codes:
 *   0 — all baselines match
 *   1 — structural diff found (prints diff)
 *   2 — missing baseline file
 *
 * WP-67 merge gate.
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SESSION_ID = process.env.SESSION_ID || '2026-01-27-debug'
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

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
 * Extract event types and structural keys from an event list.
 * Returns a normalized form suitable for comparison.
 */
function normalize(events) {
  return events.map(e => {
    // Keep type + all non-volatile payload fields, sorted for stable comparison
    const sorted = {}
    for (const k of Object.keys(e).sort()) {
      sorted[k] = e[k]
    }
    return sorted
  })
}

function diffEvents(baseline, actual, label) {
  const bNorm = normalize(baseline)
  const aNorm = normalize(actual)

  if (bNorm.length !== aNorm.length) {
    console.error(`\n[${label}] FAIL: event count mismatch — baseline ${bNorm.length}, actual ${aNorm.length}`)
    // Show first divergence
    const minLen = Math.min(bNorm.length, aNorm.length)
    for (let i = 0; i < Math.max(bNorm.length, aNorm.length); i++) {
      const b = i < bNorm.length ? bNorm[i] : null
      const a = i < aNorm.length ? aNorm[i] : null
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        console.error(`  Event [${i}]:`)
        if (b) console.error(`    baseline: ${JSON.stringify(b)}`)
        else console.error(`    baseline: (none)`)
        if (a) console.error(`    actual:   ${JSON.stringify(a)}`)
        else console.error(`    actual:   (none)`)
      }
    }
    return false
  }

  let match = true
  for (let i = 0; i < bNorm.length; i++) {
    if (JSON.stringify(bNorm[i]) !== JSON.stringify(aNorm[i])) {
      if (match) console.error(`\n[${label}] FAIL: structural diff at event [${i}]`)
      console.error(`  baseline: ${JSON.stringify(bNorm[i])}`)
      console.error(`  actual:   ${JSON.stringify(aNorm[i])}`)
      match = false
    }
  }

  if (match) {
    console.log(`[${label}] PASS: ${bNorm.length} events match baseline`)
  }
  return match
}

// --- Capture helpers (same as record.mjs) ---

async function captureChat() {
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
    console.error(`[replay] chat-stream HTTP ${resp.status}`)
    return null
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
      try { events.push(scrub(JSON.parse(data))) } catch {}
    }
  }
  return events
}

async function captureBuild() {
  const esResp = await fetch(`${BASE_URL}/api/events?session=${encodeURIComponent(SESSION_ID)}`)
  if (!esResp.ok) return null

  const esReader = esResp.body.getReader()
  const esDecoder = new TextDecoder()
  let esBuffer = ''
  const events = []

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
      try { events.push(scrub(JSON.parse(data))) } catch {}
    }
    return true
  }

  // Drain handshake
  for (let i = 0; i < 5; i++) {
    await Promise.race([readOne(), new Promise(r => setTimeout(() => r(null), 1000))])
  }

  // Fire build
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
  if (!buildResp.ok) return null

  // Wait for terminal event
  const deadline = Date.now() + 120_000
  let found = false
  while (Date.now() < deadline && !found) {
    const r = await Promise.race([readOne(), new Promise(r => setTimeout(() => r(null), 2000))])
    if (r === null) continue
    if (events.find(e => e.type === 'vibe_built' || e.type === 'vibe_failed')) {
      found = true
      for (let i = 0; i < 3; i++) {
        await Promise.race([readOne(), new Promise(r => setTimeout(() => r(null), 500))])
      }
    }
  }
  esReader.cancel().catch(() => {})

  return events.filter(e =>
    ['build_started', 'build_progress', 'vibe_built', 'vibe_failed', 'build_failed'].includes(e.type)
  )
}

// --- Main ---

const args = process.argv.slice(2)
const mode = args[0] || 'all'

async function main() {
  let pass = true

  if (mode === 'chat' || mode === 'all') {
    const baselinePath = join(__dirname, 'recorded-chat.json')
    if (!existsSync(baselinePath)) {
      console.error(`[replay] Missing baseline: ${baselinePath}`)
      console.error('Run record.mjs first.')
      process.exit(2)
    }
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'))
    const actual = await captureChat()
    if (!actual) {
      console.error('[replay] Chat capture failed')
      pass = false
    } else {
      if (!diffEvents(baseline, actual, 'chat')) pass = false
    }
  }

  if (mode === 'build' || mode === 'all') {
    const baselinePath = join(__dirname, 'recorded-build.json')
    if (!existsSync(baselinePath)) {
      console.error(`[replay] Missing baseline: ${baselinePath}`)
      console.error('Run record.mjs first.')
      process.exit(2)
    }
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'))
    const actual = await captureBuild()
    if (!actual) {
      console.error('[replay] Build capture failed')
      pass = false
    } else {
      if (!diffEvents(baseline, actual, 'build')) pass = false
    }
  }

  process.exit(pass ? 0 : 1)
}

main().catch(err => {
  console.error('[replay] Fatal:', err)
  process.exit(1)
})
