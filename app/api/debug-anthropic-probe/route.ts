import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import path from 'path'

/**
 * Dev-only probe: hit Anthropic /v1/messages with the SAME credential
 * resolution path /api/chat uses, return raw status + body. Used to
 * verify the actual error shape when investigating 529s, 401s, etc.
 *
 * Usage:
 *   GET /api/_debug-anthropic-probe?scenario=minimal
 *   GET /api/_debug-anthropic-probe?scenario=bad-model
 *
 * NEVER returns the API key, only metadata about which credential is in
 * use (length, prefix). Safe to leave in dev; 404 in prod.
 */

function getApiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const raw = readFileSync(path.join(process.cwd(), '.api-key'), 'utf-8').trim()
    return raw.split('=')[1] || ''
  } catch {
    return ''
  }
}

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('not found', { status: 404 })
  }
  const url = new URL(req.url)
  const scenario = url.searchParams.get('scenario') || 'minimal'

  const key = getApiKey()
  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'

  const credInfo = {
    apiKeyPresent: !!key,
    apiKeyLen: key.length,
    apiKeyPrefix: key.slice(0, 6),
    baseUrl,
    authTokenPresent: !!process.env.ANTHROPIC_AUTH_TOKEN,
    oauthTokenPresent: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
  }

  if (!key && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return NextResponse.json({ credInfo, error: 'no credential' }, { status: 200 })
  }

  const scenarios: Record<string, any> = {
    minimal: {
      model: 'claude-opus-4-8',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'reply with the word ok and nothing else' }],
    },
    'bad-model': {
      model: 'claude-bogus-99',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'hi' }],
    },
    'cli-suffix-model': {
      // What the CLI uses; should 400/404 from API directly.
      model: 'claude-opus-4-8[1m]',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'hi' }],
    },
    'malformed': {
      // Missing max_tokens; should 400 invalid_request_error.
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'hi' }],
    },
    'cached': {
      // Same shape /api/chat sends in API mode — system block +
      // cache_control on system (1h TTL). If 529 fires HERE while
      // minimal succeeds, the issue is cache-pool saturation, not
      // API capacity.
      model: 'claude-opus-4-8',
      max_tokens: 32,
      system: [{
        type: 'text',
        text: 'You are a creative director. ' + 'Respond concisely. '.repeat(200),
        cache_control: { type: 'ephemeral', ttl: '1h' },
      }],
      messages: [{ role: 'user', content: 'reply ok' }],
    },
  }
  const body = scenarios[scenario]
  if (!body) {
    return NextResponse.json({ credInfo, error: `unknown scenario: ${scenario}`, options: Object.keys(scenarios) }, { status: 400 })
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'extended-cache-ttl-2025-04-11',
  }
  if (key) headers['x-api-key'] = key
  if (process.env.ANTHROPIC_AUTH_TOKEN) headers['authorization'] = `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}`

  const t0 = Date.now()
  let res: Response
  try {
    res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch (err: any) {
    return NextResponse.json({ credInfo, scenario, error: 'fetch threw', detail: err?.message }, { status: 200 })
  }
  const ms = Date.now() - t0

  const respHeaders: Record<string, string> = {}
  for (const h of [
    'content-type', 'retry-after', 'x-request-id',
    'anthropic-ratelimit-requests-remaining',
    'anthropic-organization-id',
    'cf-ray', 'server', 'cache-control',
  ]) {
    const v = res.headers.get(h)
    if (v) respHeaders[h] = v
  }

  const text = await res.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch {}

  return NextResponse.json(
    {
      credInfo,
      scenario,
      latencyMs: ms,
      status: res.status,
      statusText: res.statusText,
      respHeaders,
      bodyParsed: parsed,
      bodyTextHead: parsed ? null : text.slice(0, 1000),
    },
    { status: 200 },
  )
}
