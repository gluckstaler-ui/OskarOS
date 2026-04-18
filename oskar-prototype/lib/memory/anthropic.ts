/**
 * Shared utility for memory agents (lumberjack + dreamer).
 *
 * Calls claude --print with OAuth (no API key needed).
 * --tools "" disables tools — these are text pipelines, the calling code
 * handles all file I/O.
 */

import { spawn, exec } from 'child_process'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// 2026-04-17: removed 'claude-haiku-4-5-20251001' from the union per Ralph's
// "all sonnet/haiku → 4.6" pass. Memory agents (dreamer, lumberjack) use
// Sonnet 4.6; Big CD uses Opus 4.7. No Haiku surface in OUR code.
// (Note: the Claude Code CLI itself spawns Haiku internally for sub-tasks
// like summarization — that's not our code, can't disable from here.)
export type MemoryModel = 'claude-sonnet-4-6' | 'claude-opus-4-7'

/**
 * Call claude --print. Returns null on failure (memory agents are best-effort).
 * Uses OAuth token. Tools disabled — pure text pipeline.
 */
export async function callAnthropic(
  model: MemoryModel,
  userMessage: string
): Promise<string | null> {
  const inputSize = userMessage.length
  console.log(`[memory/anthropic] Calling claude --print: model=${model} (input: ${inputSize} chars)`)

  return new Promise((resolve) => {
    const child = spawn('claude', [
      '--print',
      '--model', model,
      '--tools', '',
      '--no-session-persistence',
    ], {
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: '', // Force OAuth
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d: Buffer) => { stdout += d })
    child.stderr.on('data', (d: Buffer) => { stderr += d })

    child.stdin.write(userMessage)
    child.stdin.end()

    // 5 minute timeout
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      console.error('[memory/anthropic] Timeout (5m)')
      resolve(null)
    }, 5 * 60 * 1000)

    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      if (code !== 0) {
        console.error(`[memory/anthropic] Exit code: ${code}`)
        if (stderr) console.error(stderr.slice(0, 300))
        resolve(null)
        return
      }
      const trimmed = stdout.trim()
      if (trimmed) {
        console.log(`[memory/anthropic] Success: ${trimmed.length} chars (model=${model})`)
        resolve(trimmed)
      } else {
        console.warn('[memory/anthropic] Empty response')
        resolve(null)
      }
    })

    child.on('error', (err: Error) => {
      clearTimeout(timer)
      console.error(`[memory/anthropic] Spawn error: ${err.message}`)
      resolve(null)
    })
  })
}

/**
 * Call claude --print WITH tools enabled (Read + Edit).
 * For agents that need to edit files in place (Lumberjack).
 *
 * Uses exec + temp file instead of spawn + stdin piping.
 * Spawn with tool-enabled CLI hits a "duplicate tool_use ids" bug
 * in some runtimes (tsx). Shell pipe via exec is reliable.
 */
export async function callAnthropicAgent(
  model: MemoryModel,
  userMessage: string,
  cwd: string,
  timeoutMs: number = 10 * 60 * 1000
): Promise<string | null> {
  console.log(`[memory/anthropic] Calling claude agent: model=${model}, cwd=${cwd}`)

  const promptFile = path.join(tmpdir(), `lj-prompt-${Date.now()}.txt`)

  try {
    writeFileSync(promptFile, userMessage, 'utf-8')
  } catch (err) {
    console.error(`[memory/anthropic] Failed to write prompt file: ${err}`)
    return null
  }

  return new Promise((resolve) => {
    const cmd = [
      `cat "${promptFile}"`,
      '|',
      'claude --print',
      `--model ${model}`,
      '--tools "Read,Edit"',
      '--dangerously-skip-permissions',
      '--no-session-persistence',
    ].join(' ')

    exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      // Clean up temp file
      try { unlinkSync(promptFile) } catch {}

      if (err) {
        console.error(`[memory/anthropic] Agent error: exit=${err.code}`)
        if (stderr) console.error(stderr.slice(0, 500))
        resolve(null)
        return
      }

      const trimmed = (stdout || '').trim()
      console.log(`[memory/anthropic] Agent done: ${trimmed.length} chars summary`)
      resolve(trimmed || null)
    })
  })
}
