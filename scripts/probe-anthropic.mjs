#!/usr/bin/env node
// Probe what /v1/messages actually returns for various inputs.
// Loads env from .env.local same way Next does. Never logs the key.
//
// Usage:
//   node scripts/probe-anthropic.mjs [scenario]
//   scenario: minimal | bad-model | the-real-call | overload-canary

import { readFileSync } from 'node:fs'
import path from 'node:path'

// Load .env.local manually (no dotenv dep).
try {
  const raw = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  console.error('no .env.local')
}

const key = process.env.ANTHROPIC_API_KEY
const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
const authToken = process.env.ANTHROPIC_AUTH_TOKEN

console.log('--- env probe ---')
console.log('ANTHROPIC_BASE_URL:', baseUrl, '(default if not in env)')
console.log('ANTHROPIC_API_KEY present:', !!key, key ? `len=${key.length} prefix=${key.slice(0, 6)}...` : '')
console.log('ANTHROPIC_AUTH_TOKEN present:', !!authToken, authToken ? `len=${authToken.length}` : '')
console.log('CLAUDE_CODE_OAUTH_TOKEN present:', !!process.env.CLAUDE_CODE_OAUTH_TOKEN)

if (!key && !authToken) {
  console.error('\nNo Anthropic credential in env. Cannot probe.')
  process.exit(1)
}

const scenario = process.argv[2] || 'minimal'

const scenarios = {
  minimal: {
    model: 'claude-opus-4-8',
    max_tokens: 32,
    messages: [{ role: 'user', content: 'say "ok" and nothing else' }],
  },
  'bad-model': {
    model: 'claude-opus-4-8[1m]', // invalid identifier — see error shape
    max_tokens: 32,
    messages: [{ role: 'user', content: 'say "ok"' }],
  },
  'overload-canary': {
    // Tiny request that any working endpoint should accept; if it
    // 529s, that's the upstream genuinely overloaded.
    model: 'claude-haiku-4-5',
    max_tokens: 8,
    messages: [{ role: 'user', content: '?' }],
  },
}

const body = scenarios[scenario]
if (!body) {
  console.error('unknown scenario:', scenario, 'options:', Object.keys(scenarios).join(', '))
  process.exit(1)
}

const headers = {
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'extended-cache-ttl-2025-04-11',
}
if (key) headers['x-api-key'] = key
if (authToken) headers['authorization'] = `Bearer ${authToken}`

console.log(`\n--- POST ${baseUrl}/v1/messages (${scenario}) ---`)
const t0 = Date.now()
const res = await fetch(`${baseUrl}/v1/messages`, {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
})
const ms = Date.now() - t0
console.log(`status: ${res.status} ${res.statusText} (${ms}ms)`)
console.log('--- response headers (subset) ---')
for (const h of ['content-type', 'retry-after', 'x-request-id', 'anthropic-ratelimit-requests-remaining', 'anthropic-organization-id', 'cf-ray', 'server']) {
  const v = res.headers.get(h)
  if (v) console.log(`  ${h}: ${v}`)
}

const text = await res.text()
console.log('--- response body ---')
try {
  const parsed = JSON.parse(text)
  // Redact any obvious secrets in passing
  console.log(JSON.stringify(parsed, null, 2).slice(0, 2000))
} catch {
  console.log(text.slice(0, 1000))
}
