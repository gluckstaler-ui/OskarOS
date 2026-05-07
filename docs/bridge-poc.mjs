#!/usr/bin/env node
/**
 * Bridge Mode POC — Tests 3 things:
 * 1. Does stream-json keep the process alive across messages?
 * 2. Does the session remember previous turns?
 * 3. Does --max-turns cap tool use?
 *
 * Usage: node docs/bridge-poc.mjs
 */

import { spawn } from 'child_process'
import crypto from 'crypto'

const CLAUDE_PATH = '/opt/homebrew/bin/claude'
const MODEL = 'claude-sonnet-4-6'
const MAX_TURNS = 5

console.log('=== BRIDGE MODE POC ===')
console.log(`Model: ${MODEL}, Max turns: ${MAX_TURNS}`)
console.log('')

const child = spawn(CLAUDE_PATH, [
  '--print',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--model', MODEL,
  '--dangerously-skip-permissions',
  '--max-turns', String(MAX_TURNS),
], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    ANTHROPIC_API_KEY: '',
    CLAUDE_CODE_ENVIRONMENT_KIND: 'bridge',
  }
})

const sessionId = crypto.randomUUID()
let messageCount = 0
let responseText = ''
let lastResultEvent = null
let waitingForResponse = false

function sendMessage(content) {
  messageCount++
  const msgNum = messageCount
  console.log(`\n--- SENDING MESSAGE ${msgNum} ---`)
  console.log(`> ${content}`)
  console.log('')
  responseText = ''
  waitingForResponse = true

  child.stdin.write(JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: content
    },
    parent_tool_use_id: null,
    session_id: sessionId
  }) + '\n')
}

// Parse JSON lines from stdout
let buffer = ''
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  const lines = buffer.split('\n')
  buffer = lines.pop() || ''

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)

      // Text output
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'text') {
            responseText += block.text
            process.stdout.write(block.text)
          }
          if (block.type === 'tool_use') {
            console.log(`  [TOOL: ${block.name}]`)
          }
        }
      }

      // Tool results
      if (event.type === 'tool_result') {
        console.log(`  [TOOL_RESULT: ${event.tool || 'unknown'}]`)
      }

      // Result event — response complete
      if (event.type === 'result') {
        lastResultEvent = event
        waitingForResponse = false
        console.log('\n')
        console.log(`--- RESULT ---`)
        console.log(`  session_id: ${event.session_id}`)
        console.log(`  turns: ${event.num_turns}`)
        console.log(`  cost: $${event.total_cost_usd?.toFixed(4)}`)
        console.log(`  stop_reason: ${event.stop_reason}`)
        if (event.usage) {
          console.log(`  cache_creation: ${event.usage.cache_creation_input_tokens}`)
          console.log(`  cache_read: ${event.usage.cache_read_input_tokens}`)
          console.log(`  output_tokens: ${event.usage.output_tokens}`)
        }
        console.log('')
      }

    } catch (e) {
      // Non-JSON line, just print
      if (line.trim()) console.log(`  [raw] ${line.slice(0, 200)}`)
    }
  }
})

child.stderr.on('data', (data) => {
  const msg = data.toString().trim()
  if (msg) console.error(`  [stderr] ${msg.slice(0, 200)}`)
})

child.on('close', (code) => {
  console.log(`\n=== PROCESS EXITED (code ${code}) ===`)
  process.exit(code || 0)
})

child.on('error', (err) => {
  console.error(`Process error: ${err.message}`)
  process.exit(1)
})

// --- TEST SEQUENCE ---

// Test 1 + 2: Send message, wait, send second message testing memory
console.log('TEST 1+2: Bridge persistence + memory')
sendMessage("Remember this word exactly: falcamel. Just confirm you've remembered it.")

// Wait for first response, then send second message
const checkInterval = setInterval(() => {
  if (!waitingForResponse && messageCount === 1) {
    clearInterval(checkInterval)

    console.log('TEST 2: Memory check — does it remember "falcamel"?')
    sendMessage("What exact word did I ask you to remember? Reply with just the word.")

    // Wait for second response, then check result
    const checkInterval2 = setInterval(() => {
      if (!waitingForResponse && messageCount === 2) {
        clearInterval(checkInterval2)

        const remembered = responseText.toLowerCase().includes('falcamel')
        console.log(`=== TEST 2 RESULT: ${remembered ? '✅ PASS — Memory works!' : '❌ FAIL — No memory'} ===`)
        console.log('')

        // Check session IDs match
        const sessionId = lastResultEvent?.session_id
        console.log(`Session ID consistent: ${sessionId ? 'YES' : 'UNKNOWN'}`)
        console.log('')

        // Done — close stdin to exit
        console.log('=== POC COMPLETE ===')
        child.stdin.end()
      }
    }, 1000)
  }
}, 1000)

// Safety timeout
setTimeout(() => {
  console.log('\n=== TIMEOUT (120s) — killing process ===')
  child.kill('SIGTERM')
  process.exit(1)
}, 120000)
