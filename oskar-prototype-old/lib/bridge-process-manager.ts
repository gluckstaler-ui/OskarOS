import { spawn, ChildProcess, execSync } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import crypto from 'crypto'

// ==========================================
// Bridge Process Manager
// ==========================================
// Manages persistent Claude CLI processes using stream-json I/O.
// One process per OskarOS session, stays alive across messages.

export interface BridgeOptions {
  model: string
  systemPrompt: string  // full system prompt text
  cwd: string
}

export interface BridgeEvent {
  type: string
  [key: string]: any
}

interface BridgeProcess {
  child: ChildProcess
  cliSessionId: string
  lastActivity: number
  buffer: string
  dead: boolean
  systemPromptFile: string | null
}

function findClaudeBinary(): string {
  const paths = [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ]
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  try {
    return execSync('which claude', { encoding: 'utf-8' }).trim()
  } catch {
    throw new Error('Claude CLI not found')
  }
}

class BridgeProcessManagerImpl {
  private processes = new Map<string, BridgeProcess>()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    // Kill idle processes every 5 minutes
    this.cleanupInterval = setInterval(() => this.killIdle(30 * 60 * 1000), 5 * 60 * 1000)
  }

  /**
   * Get existing process or spawn a new one for this session.
   */
  private getOrSpawn(sessionId: string, options: BridgeOptions): BridgeProcess {
    const existing = this.processes.get(sessionId)
    if (existing && !existing.dead) {
      return existing
    }

    // If previous process died, try to resume its CLI session
    const resumeId = existing?.cliSessionId
    if (existing) {
      this.cleanup(sessionId)
    }

    const claudePath = findClaudeBinary()
    const cliSessionId = resumeId || crypto.randomUUID()

    // Write system prompt to temp file
    const systemFile = join(tmpdir(), `claude-bridge-system-${Date.now()}.txt`)
    writeFileSync(systemFile, options.systemPrompt, 'utf-8')

    const args = [
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', options.model,
      '--permission-mode', 'bypassPermissions',
      '--session-id', cliSessionId,
      '--system-prompt-file', systemFile,
    ]

    // If resuming a dead process, add --resume
    if (resumeId) {
      args.push('--resume', resumeId)
      console.log(`[Bridge] Resuming session ${sessionId} (CLI: ${cliSessionId})`)
    } else {
      console.log(`[Bridge] Spawning new session ${sessionId} (CLI: ${cliSessionId})`)
    }

    const child = spawn(claudePath, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: '',
        HOME: process.env.HOME,
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:' + (process.env.PATH || ''),
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
        CLAUDE_CODE_ENVIRONMENT_KIND: 'bridge',
      }
    })

    const bp: BridgeProcess = {
      child,
      cliSessionId,
      lastActivity: Date.now(),
      buffer: '',
      dead: false,
      systemPromptFile: systemFile,
    }

    child.on('error', (err) => {
      console.error(`[Bridge] Process error for ${sessionId}:`, err.message)
      bp.dead = true
    })

    child.on('close', (code) => {
      console.log(`[Bridge] Process closed for ${sessionId} (code ${code})`)
      bp.dead = true
    })

    child.stderr?.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg) console.error(`[Bridge:${sessionId}] stderr: ${msg.slice(0, 300)}`)
    })

    this.processes.set(sessionId, bp)
    return bp
  }

  /**
   * Send a message to the bridge process and yield response events.
   */
  async *sendMessage(
    sessionId: string,
    content: string,
    options: BridgeOptions
  ): AsyncGenerator<BridgeEvent> {
    const bp = this.getOrSpawn(sessionId, options)
    bp.lastActivity = Date.now()

    // Send message via stdin
    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: bp.cliSessionId,
    })

    if (!bp.child.stdin?.writable) {
      bp.dead = true
      throw new Error(`Bridge process stdin not writable for ${sessionId}`)
    }

    bp.child.stdin.write(msg + '\n')

    // Yield events from stdout until we get a 'result' event
    yield* this.readResponse(bp)
  }

  /**
   * Read JSON events from stdout until a 'result' event signals response complete.
   */
  private async *readResponse(bp: BridgeProcess): AsyncGenerator<BridgeEvent> {
    const eventQueue: BridgeEvent[] = []
    let resolve: (() => void) | null = null
    let done = false

    const onData = (chunk: Buffer) => {
      bp.buffer += chunk.toString()
      const lines = bp.buffer.split('\n')
      bp.buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line) as BridgeEvent
          eventQueue.push(event)
          if (event.type === 'result') {
            done = true
          }
        } catch {
          // Non-JSON line — wrap as raw text
          eventQueue.push({ type: 'raw', content: line })
        }
        if (resolve) {
          resolve()
          resolve = null
        }
      }
    }

    const onClose = () => {
      bp.dead = true
      done = true
      if (resolve) {
        resolve()
        resolve = null
      }
    }

    bp.child.stdout!.on('data', onData)
    bp.child.on('close', onClose)

    try {
      while (!done || eventQueue.length > 0) {
        if (eventQueue.length > 0) {
          const event = eventQueue.shift()!
          yield event
          if (event.type === 'result') return
        } else if (!done) {
          // Wait for more data
          await new Promise<void>((r) => { resolve = r })
        } else {
          return
        }
      }
    } finally {
      bp.child.stdout!.removeListener('data', onData)
      bp.child.removeListener('close', onClose)
    }
  }

  /**
   * Check if a session has an active bridge process.
   */
  hasProcess(sessionId: string): boolean {
    const bp = this.processes.get(sessionId)
    return !!bp && !bp.dead
  }

  /**
   * Kill a specific session's process.
   */
  kill(sessionId: string): void {
    const bp = this.processes.get(sessionId)
    if (bp) {
      console.log(`[Bridge] Killing session ${sessionId}`)
      bp.child.kill('SIGTERM')
      this.cleanup(sessionId)
    }
  }

  /**
   * Kill processes idle for longer than maxIdleMs.
   */
  killIdle(maxIdleMs: number): void {
    const now = Date.now()
    for (const [sessionId, bp] of this.processes) {
      if (bp.dead || now - bp.lastActivity > maxIdleMs) {
        console.log(`[Bridge] Idle cleanup: ${sessionId} (idle ${Math.round((now - bp.lastActivity) / 1000)}s)`)
        bp.child.kill('SIGTERM')
        this.cleanup(sessionId)
      }
    }
  }

  private cleanup(sessionId: string): void {
    const bp = this.processes.get(sessionId)
    if (bp?.systemPromptFile) {
      try { unlinkSync(bp.systemPromptFile) } catch {}
    }
    this.processes.delete(sessionId)
  }
}

// Module-level singleton — survives across Next.js requests
export const bridgeManager = new BridgeProcessManagerImpl()
