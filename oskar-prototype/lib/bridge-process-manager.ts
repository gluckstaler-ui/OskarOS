import { spawn, ChildProcess, execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import crypto from 'crypto'
import { ensureMcpConfig, CD_ALLOWED_TOOLS } from './mcp-config'

// ==========================================
// Bridge Mapping Persistence
// ==========================================
// Saves cliSessionId to disk so we can --resume after server restart.
// File: public/{sessionId}/logs/BRIDGE.json

interface BridgeMapping {
  cliSessionId: string
  model: string
  createdAt: string
  lastActivity: string
}

function getBridgeMappingPath(sessionId: string): string {
  return join(process.cwd(), 'public', sessionId, 'logs', 'BRIDGE.json')
}

function saveBridgeMapping(sessionId: string, cliSessionId: string, model: string): void {
  const mappingPath = getBridgeMappingPath(sessionId)
  try {
    mkdirSync(dirname(mappingPath), { recursive: true })
    const mapping: BridgeMapping = {
      cliSessionId,
      model,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    }
    writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), 'utf-8')
    console.log(`[Bridge] Saved mapping: ${sessionId} → ${cliSessionId}`)
  } catch (err) {
    console.error(`[Bridge] Failed to save mapping for ${sessionId}:`, err)
  }
}

function loadBridgeMapping(sessionId: string): BridgeMapping | null {
  const mappingPath = getBridgeMappingPath(sessionId)
  try {
    if (!existsSync(mappingPath)) return null
    const raw = readFileSync(mappingPath, 'utf-8')
    const mapping = JSON.parse(raw) as BridgeMapping
    console.log(`[Bridge] Loaded mapping from disk: ${sessionId} → ${mapping.cliSessionId}`)
    return mapping
  } catch (err) {
    console.error(`[Bridge] Failed to load mapping for ${sessionId}:`, err)
    return null
  }
}

function updateBridgeMappingActivity(sessionId: string): void {
  const mappingPath = getBridgeMappingPath(sessionId)
  try {
    if (!existsSync(mappingPath)) return
    const raw = readFileSync(mappingPath, 'utf-8')
    const mapping = JSON.parse(raw) as BridgeMapping
    mapping.lastActivity = new Date().toISOString()
    writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), 'utf-8')
  } catch {
    // Non-critical — don't crash if activity update fails
  }
}

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
  wasResumed: boolean  // true if spawned with --resume (has full history)
  /**
   * The --model arg this subprocess was spawned with. CLI subprocesses are
   * model-locked at spawn — chat-stream consults this to detect when the
   * user's CD-model toggle requires a respawn. Ralph 2026-05-04.
   */
  spawnedModel: string
  /**
   * The model field from Claude CLI's system/init event — i.e. the TRUTH
   * on the wire after Claude CLI has resolved its own settings (default
   * model, base-URL pipes, etc). Differs from spawnedModel when we passed
   * 'auto' (so Claude CLI uses its own default). Cached so chat-stream
   * can replay it as model_info on resumed turns where init doesn't
   * re-fire. Ralph 2026-05-04 (Bug M).
   */
  actualModel: string | null
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

    // If previous process died in memory, consider re-using its CLI
    // session id via --resume. BUT drop resume if the model changed:
    // thinking blocks in the prior conversation were signed by the dead
    // process's model, and Anthropic / Z.ai reject mismatched
    // signatures with "Invalid signature in thinking block". Same logic
    // as the disk-mapping check below; this branch handles the
    // same-Node-process model-toggle case (where chat-stream killed
    // the old bridge and is now respawning in this same call).
    let resumeId: string | undefined
    if (existing) {
      const modelChanged = existing.spawnedModel !== options.model
      if (!modelChanged) {
        resumeId = existing.cliSessionId
      } else {
        console.log(
          `[Bridge] In-memory model "${existing.spawnedModel}" differs from requested "${options.model}" — dropping --resume to avoid thinking-block signature mismatch`,
        )
      }
      this.cleanup(sessionId)
    }

    // If no in-memory record (server restart), check disk for saved mapping.
    if (!resumeId) {
      const diskMapping = loadBridgeMapping(sessionId)
      if (diskMapping) {
        // Drop resume on model change. Thinking blocks in the disk-loaded
        // conversation history are SIGNED by whichever model produced
        // them. If the user toggled CD's model since the last turn (or
        // the request resolves to a different endpoint, e.g. Anthropic
        // → Z.ai/GLM via base-URL pipe), those signatures don't validate
        // against the new endpoint and the upstream API rejects with
        // "messages.N.content.0: Invalid signature in thinking block".
        // Cost of dropping resume: one fresh CLI history. Benefit: no
        // signature errors. Ralph 2026-05-04 → bug observed 2026-05-XX.
        if (diskMapping.model !== options.model) {
          console.log(
            `[Bridge] Disk model "${diskMapping.model}" differs from requested "${options.model}" — dropping --resume to avoid thinking-block signature mismatch`,
          )
        } else {
          resumeId = diskMapping.cliSessionId
          console.log(`[Bridge] Recovered CLI session from disk: ${resumeId}`)
        }
      }
    }

    const claudePath = findClaudeBinary()
    const cliSessionId = resumeId || crypto.randomUUID()

    // Write system prompt to temp file
    const systemFile = join(tmpdir(), `claude-bridge-system-${Date.now()}.txt`)
    writeFileSync(systemFile, options.systemPrompt, 'utf-8')

    // Per-session MCP config — extracted to lib/mcp-config.ts (Phase 2,
    // 2026-04-30) so WebDev and Sentinel Ti reuse the same generator.
    // Server name + paths defined there.
    const mcpConfigFile = ensureMcpConfig({ sessionId, cwd: options.cwd, agentRole: 'cd' })

    // Bug M (Ralph 2026-05-04): when options.model is 'auto', OMIT --model
    // so Claude Code uses its own settings (~/.claude/settings.json or
    // env). Critical for Z.ai-piped Claude Code: the user has configured
    // GLM as the default model; forcing --model claude-opus-4-7 would
    // override that and make their Z.ai-routed requests fail (or worse,
    // silently route the wrong model). The system/init event then
    // reports the truth Claude Code actually used; the input-bar badge
    // displays it.
    const args = [
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      ...(options.model && options.model !== 'auto'
        ? ['--model', options.model]
        : []),
      '--permission-mode', 'bypassPermissions',
      '--system-prompt-file', systemFile,
      '--mcp-config', mcpConfigFile,
      // CD's tool whitelist (orchestration + submit_*). Tightens safety
      // beyond bypassPermissions: WebDev's report_* and Sentinel's
      // submit_critique are NOT in this list, so CD calling them would
      // be denied.
      '--allowed-tools', CD_ALLOWED_TOOLS,
    ]

    // --resume and --session-id can't be combined. Use one or the other.
    if (resumeId) {
      args.push('--resume', resumeId)
      console.log(`[Bridge] Resuming session ${sessionId} (CLI: ${resumeId})`)
    } else {
      args.push('--session-id', cliSessionId)
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
      wasResumed: !!resumeId,
      spawnedModel: options.model,
      actualModel: null,
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

    // Persist mapping to disk so we can resume after server restart
    saveBridgeMapping(sessionId, cliSessionId, options.model)

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
    updateBridgeMappingActivity(sessionId)

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
          if ((event.type === 'init') || (event.type === 'system' && (event as any).subtype === 'init')) {
            console.log(`[Bridge] Init event:`, JSON.stringify(event).slice(0, 500))
            // Bug M (Ralph 2026-05-04): cache the model Claude CLI is
            // actually running. Survives across resumed turns where
            // init doesn't re-fire — chat-stream replays this as the
            // model_info config-seed so the badge stays accurate.
            const modelVal = (event as any).model
            if (typeof modelVal === 'string' && modelVal.length > 0) {
              bp.actualModel = modelVal
            }
          }
          // Wire truth from assistant events — overrides init's claim.
          // Z.ai serves glm-4.7 for claude-opus-4-7 requests; the init
          // event doesn't know this but message.model does.
          if (event.type === 'assistant' && typeof (event as any).message?.model === 'string' && (event as any).message.model.length > 0) {
            bp.actualModel = (event as any).message.model
          }
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
   * Return the --model arg the live bridge process was spawned with, or
   * null if no process exists. Used by chat-stream to detect when the
   * user's CD-model toggle requires a respawn (CLI subprocesses can't
   * change model mid-flight). Ralph 2026-05-04.
   */
  getProcessModel(sessionId: string): string | null {
    const bp = this.processes.get(sessionId)
    if (!bp || bp.dead) return null
    return bp.spawnedModel
  }

  /**
   * Return the model Claude CLI is ACTUALLY running, captured from its
   * system/init event. Differs from spawnedModel when we passed 'auto'
   * (Claude CLI then uses its own settings, e.g. GLM if base-URL-piped
   * to Z.ai). Returns null until Claude CLI has emitted at least one
   * init event for this process. Ralph 2026-05-04 (Bug M).
   */
  getProcessActualModel(sessionId: string): string | null {
    const bp = this.processes.get(sessionId)
    if (!bp || bp.dead) return null
    return bp.actualModel
  }

  /**
   * Check if the session's bridge was resumed (has full history in context).
   * Returns false for new sessions or if process doesn't exist.
   */
  wasResumed(sessionId: string): boolean {
    const bp = this.processes.get(sessionId)
    return !!bp && bp.wasResumed
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

// Global singleton — survives Next.js HMR module reloads in dev.
// Without globalThis, each route gets a different module instance
// and order66 can't see (or kill) the bridge that chat-stream owns.
const globalForBridge = globalThis as unknown as { __bridgeManager?: BridgeProcessManagerImpl }
if (!globalForBridge.__bridgeManager) {
  globalForBridge.__bridgeManager = new BridgeProcessManagerImpl()
}
export const bridgeManager = globalForBridge.__bridgeManager
