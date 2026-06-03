#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// probe-cli-1m.mjs — does re-rolling the bridge actually re-roll the model?
// ─────────────────────────────────────────────────────────────────────────
//
// THE QUESTION (Ralph 2026-05-28): after Order 66, the CD bridge sometimes
// comes up on a <1M-context model instead of the requested 1M Opus. We want
// to know whether KILLING + RESPAWNING the bridge re-rolls that outcome
// (→ a retry loop is worth building) or whether it's sticky (→ a retry loop
// is theater and the real lever is elsewhere).
//
// HOW: this faithfully replicates the bridge's spawn from
// lib/bridge-process-manager.ts — same binary, same `--model
// claude-opus-4-8[1m]` CLI alias, same OAuth env (ANTHROPIC_API_KEY='' +
// CLAUDE_CODE_OAUTH_TOKEN, which is where the 1M-vs-200K capacity behavior
// lives). It does N fresh spawns, sends a single "." each time, and reads:
//   • init.model        — what Claude Code RESOLVED to (its belief)
//   • message.model     — what the upstream API actually SERVED (wire truth)
//   • result.subtype    — success / error shape (catches overload/limit)
// then kills the child and respawns. Each spawn gets a brand-new session-id,
// so this is exactly what a re-roll loop would do.
//
// READING THE RESULT:
//   VARIES  (>1 distinct wire model across spawns) → re-roll works, build it.
//   STABLE  (1 distinct wire model)                → re-roll won't help.
//
// CAVEAT: a STABLE reading only reflects CURRENT capacity. If you're not
// hitting the demotion right now, of course it's stable. Re-run this when
// you actually see the 200K demotion — that's the only meaningful sample.
//
// Usage:  node scripts/probe-cli-1m.mjs [count]      (default 10)
//
import { readFileSync, existsSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

// ── Load .env.local the same way Next does (never logs the value) ──────────
try {
  const raw = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  console.error('(no .env.local — relying on ambient env / CLI keychain auth)')
}

// ── Find the claude binary (same order as bridge-process-manager) ──────────
function findClaude() {
  for (const p of ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude']) {
    if (existsSync(p)) return p
  }
  try { return execSync('which claude', { encoding: 'utf-8' }).trim() } catch {}
  throw new Error('claude binary not found')
}

const CLAUDE = findClaude()
const MODEL = 'claude-opus-4-8[1m]'   // exactly what the bridge requests
const COUNT = Math.max(1, parseInt(process.argv[2] || '10', 10))
const PER_SPAWN_TIMEOUT_MS = 30_000

// Bridge env, replicated from bridge-process-manager.ts getOrSpawn().
// ANTHROPIC_API_KEY:'' is load-bearing — it forces OAuth-token auth (the
// subscription path where the 1M capacity behavior lives), not API-key auth.
function childEnv() {
  return {
    ...process.env,
    ANTHROPIC_API_KEY: '',
    HOME: process.env.HOME,
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || ''),
    CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
    CLAUDE_CODE_ENVIRONMENT_KIND: 'bridge',
  }
}

// One fresh spawn → send "." → read init + wire model → kill.
function probeOnce(n) {
  return new Promise((resolve) => {
    const sessionId = randomUUID()
    const args = [
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', MODEL,
      '--session-id', sessionId,
    ]
    const t0 = Date.now()
    const child = spawn(CLAUDE, args, { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv() })

    let buffer = ''
    let initModel = null
    let wireModel = null
    let resultSubtype = null
    let isError = null
    let settled = false
    const stderr = []

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill('SIGTERM') } catch {}
      resolve({ n, sessionId, initModel, wireModel, resultSubtype, isError, ms: Date.now() - t0, stderr: stderr.join('').trim().slice(0, 200) })
    }

    const timer = setTimeout(finish, PER_SPAWN_TIMEOUT_MS)

    child.stderr?.on('data', (c) => stderr.push(c.toString()))

    child.stdout?.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const s = line.trim()
        if (!s) continue
        let ev
        try { ev = JSON.parse(s) } catch { continue }
        // init: Claude Code's resolved-model belief
        if ((ev.type === 'init') || (ev.type === 'system' && ev.subtype === 'init')) {
          if (typeof ev.model === 'string' && ev.model) initModel = ev.model
        }
        // assistant: the upstream-served model (wire truth)
        if (ev.type === 'assistant' && typeof ev.message?.model === 'string' && ev.message.model) {
          wireModel = ev.message.model
        }
        // result: turn complete — capture shape and stop
        if (ev.type === 'result') {
          resultSubtype = ev.subtype ?? null
          isError = ev.is_error ?? null
          finish()
          return
        }
      }
    })

    child.on('error', (err) => { stderr.push(String(err.message)); finish() })
    child.on('close', () => finish())

    // Send one "." through the stream-json envelope (bridge format), stdin
    // stays open like the real bridge. We read until the result event.
    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: '.' },
      parent_tool_use_id: null,
      session_id: sessionId,
    })
    try { child.stdin?.write(msg + '\n') } catch { /* close handler resolves */ }
  })
}

// 1M-class detector — robust to [1m] aliases and date-stamped variants.
const is1M = (m) => !!m && /opus-4-7|opus-4-6|sonnet-4-6/.test(m)

console.log(`\n=== CLI 1M re-roll probe — ${COUNT} fresh spawns, --model ${MODEL} ===`)
console.log(`binary: ${CLAUDE}`)
console.log(`OAuth token present: ${!!process.env.CLAUDE_CODE_OAUTH_TOKEN}  (ANTHROPIC_API_KEY forced empty)\n`)

const rows = []
for (let i = 1; i <= COUNT; i++) {
  const r = await probeOnce(i)
  rows.push(r)
  const flag = r.wireModel ? (is1M(r.wireModel) ? '1M ' : '<1M') : '?? '
  console.log(
    `#${String(i).padStart(2)}  ${flag}  init=${r.initModel ?? '—'}  wire=${r.wireModel ?? '—'}  ` +
    `result=${r.resultSubtype ?? '—'}${r.isError ? ' ERR' : ''}  ${(r.ms / 1000).toFixed(1)}s` +
    (r.stderr ? `\n        stderr: ${r.stderr}` : '')
  )
  await new Promise((res) => setTimeout(res, 300)) // small gap, like a backoff
}

const distinctInit = [...new Set(rows.map((r) => r.initModel).filter(Boolean))]
const distinctWire = [...new Set(rows.map((r) => r.wireModel).filter(Boolean))]
const got1M = rows.filter((r) => is1M(r.wireModel)).length
const failed = rows.filter((r) => !r.wireModel).length

console.log(`\n--- summary (${COUNT} spawns) ---`)
console.log(`distinct init models: { ${distinctInit.join(', ') || '—'} }`)
console.log(`distinct wire models: { ${distinctWire.join(', ') || '—'} }`)
console.log(`1M wire: ${got1M}/${COUNT}   <1M wire: ${COUNT - got1M - failed}/${COUNT}   no-model: ${failed}/${COUNT}`)
console.log('')
if (distinctWire.length > 1) {
  console.log('VERDICT: VARIES → re-rolling changes the served model. A retry-until-1M loop is viable. Build it.')
} else if (distinctWire.length === 1) {
  console.log(`VERDICT: STABLE → every spawn served ${distinctWire[0]}. Re-rolling will NOT change the outcome under current conditions.`)
  console.log('         (A clean 1M reading now does NOT prove the loop is useless — re-run when you actually hit the 200K demotion.)')
} else {
  console.log('VERDICT: INCONCLUSIVE → no wire model captured. Check stderr above (auth? binary? timeout?).')
}
console.log('')
