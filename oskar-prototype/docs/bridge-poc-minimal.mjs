#!/usr/bin/env node
/**
 * Minimal bridge test — just try to get ONE response via stream-json input
 */

import { spawn } from 'child_process'

const child = spawn('/opt/homebrew/bin/claude', [
  '--print',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--model', 'claude-sonnet-4-6',
  '--permission-mode', 'bypassPermissions',
], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    ANTHROPIC_API_KEY: '',
  }
})

child.stdout.on('data', (d) => console.log('[stdout]', d.toString().slice(0, 500)))
child.stderr.on('data', (d) => console.error('[stderr]', d.toString().slice(0, 500)))
child.on('close', (code) => console.log(`[exit] code=${code}`))
child.on('error', (e) => console.error(`[error] ${e.message}`))

// Try the simple role-based format
const msg = { role: 'user', content: 'Say hello in exactly 3 words.' }
console.log('[sending]', JSON.stringify(msg))
child.stdin.write(JSON.stringify(msg) + '\n')

// Safety timeout
setTimeout(() => {
  console.log('[timeout] 60s — killing')
  child.kill()
  process.exit(1)
}, 60000)
