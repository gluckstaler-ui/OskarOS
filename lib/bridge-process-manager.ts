import { spawn, ChildProcess } from 'child_process'
import { findBinary, safePath } from './cli-paths'
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import crypto from 'crypto'
import { ensureMcpConfig, CD_ALLOWED_TOOLS, type AgentRole } from './mcp-config'

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
  /**
   * OS pid of the spawned `claude --print` process. WP-115 (Ralph 2026-05-29):
   * Order 66's bridgeManager.kill() used to only consult the in-memory
   * `processes` Map. After a Next.js dev reload (or any Node restart) the
   * Map is wiped but the actual claude child keeps running, orphaned. kill()
   * silently failed. Persisting the pid lets kill() fall back to a SIGTERM
   * by PID when the in-memory record is gone. Optional — old BRIDGE.json
   * files without it parse cleanly; we just can't kill orphans on first
   * encounter (next spawn writes the pid in, and from then on it's clean).
   */
  pid?: number
  /**
   * Agent role this bridge was spawned for ('cd' | 'consular' | etc).
   * Diagnostic value mostly — `__crm__` SHOULD always be 'consular', and
   * seeing 'cd' here flags a misrouted callCDBridge('__crm__', ...) call
   * from upstream. Optional for back-compat with older mappings.
   */
  agentRole?: AgentRole
}

function getBridgeMappingPath(sessionId: string): string {
  return join(process.cwd(), 'public', sessionId, 'logs', 'BRIDGE.json')
}

function saveBridgeMapping(
  sessionId: string,
  cliSessionId: string,
  model: string,
  pid?: number,
  agentRole?: AgentRole,
): void {
  const mappingPath = getBridgeMappingPath(sessionId)
  try {
    mkdirSync(dirname(mappingPath), { recursive: true })
    const mapping: BridgeMapping = {
      cliSessionId,
      model,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      ...(pid !== undefined ? { pid } : {}),
      ...(agentRole ? { agentRole } : {}),
    }
    writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), 'utf-8')
    console.log(`[Bridge] Saved mapping: ${sessionId} → ${cliSessionId}${pid ? ` (pid ${pid})` : ''}${agentRole ? ` (${agentRole})` : ''}`)
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
  /**
   * Opt-in to the 1M re-roll loop (Ralph 2026-05-28). ONLY the interactive
   * CD chat route (app/api/chat-stream) sets this. The one-shot CD helpers
   * (cd-bridge-call → proofread/verdict/upload-eval/ask-cd) deliberately do
   * NOT — they're short tasks that don't need 1M, and the re-roll must not
   * touch them. Absent/false ⇒ straight pass-through, exactly as before.
   */
  ensure1M?: boolean
  /**
   * MCP role + spawn-time tool allowlist (Ralph 2026-05-29, WP-112). Both
   * default to CD, so every existing caller (chat-stream, cd-bridge-call,
   * WebDev/Sentinel via their own paths) is unchanged. The Consular bridge
   * (`__crm__` session) passes `agentRole:'consular'` + `CONSULAR_ALLOWED_TOOLS`
   * so the subprocess gets the `crm_query` SQL tool instead of CD's surface.
   */
  agentRole?: AgentRole
  allowedTools?: string
  /**
   * Worker-pool opt-in (Ralph 2026-06-01). When true, this call is routed
   * through a per-session **pool of ephemeral worker bridges** instead of
   * the single persistent main bridge — so N parallel one-shot calls
   * (upload-eval, verdict, proofread) run on N parallel CLI subprocesses
   * instead of stacking serially on one stdin/stdout.
   *
   * Trade-offs:
   *   - main bridge keeps --resume semantics (CD chat history survives turns)
   *   - workers spawn fresh each time, no --resume, no shared context
   *   - workers DO inline the session's CREATIVE-BRIEF / IMAGES.md context
   *     via buildCDContext, so they answer with the same knowledge — they
   *     just don't carry chat-turn history
   *   - 1M re-roll loop is skipped on workers (only chat needs it)
   *
   * Default false ⇒ existing behavior exactly preserved (chat unchanged).
   */
  useWorker?: boolean
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
  /**
   * 'main' — the persistent per-session bridge used by chat (with --resume).
   * 'worker' — an ephemeral bridge from the per-session worker pool used by
   * one-shot helpers (upload-eval, verdict, proofread). Ralph 2026-06-01.
   */
  kind: 'main' | 'worker'
  /**
   * True while this bridge is processing a sendMessage turn. Worker-pool
   * acquisition checks this to find an idle worker. Always false on the
   * main bridge (it's serialized externally by withSessionLock instead).
   * Ralph 2026-06-01.
   */
  busy: boolean
}

/**
 * Per-session worker bridge pool. Ralph 2026-06-01.
 *
 * Holds up to MAX_WORKERS_PER_SESSION ephemeral bridges that can be reused
 * across one-shot calls. `waiters` is a FIFO queue of acquirers waiting when
 * the pool is full + all-busy; they're handed an idle worker as soon as one
 * is released.
 */
interface WorkerPool {
  workers: BridgeProcess[]
  waiters: Array<{ resolve: (bp: BridgeProcess) => void; reject: (err: Error) => void }>
}

const MAX_WORKERS_PER_SESSION = 5

function findClaudeBinary(): string {
  // Consolidated into lib/cli-paths.ts (WP-40, 2026-06-02). findBinary returns
  // the bare 'claude' as a last resort, which the spawn resolves via the PATH
  // from safePath() — no separate `which` shell-out needed.
  return findBinary('claude')
}

class BridgeProcessManagerImpl {
  private processes = new Map<string, BridgeProcess>()
  /**
   * Per-session worker pools (Ralph 2026-06-01). One-shot calls
   * (upload-eval, verdict, proofread) opt into the pool via
   * BridgeOptions.useWorker — they get a fresh ephemeral CLI subprocess
   * that's reused across calls, so N parallel one-shots run on N parallel
   * stdin/stdout streams instead of stacking on the main bridge.
   *
   * The main bridge in `this.processes` is untouched — chat keeps its
   * --resume semantics + withSessionLock serialization (chat is sequential
   * anyway).
   */
  private workerPools = new Map<string, WorkerPool>()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    // Kill idle processes every 5 minutes
    this.cleanupInterval = setInterval(() => this.killIdle(30 * 60 * 1000), 5 * 60 * 1000)
  }

  // ──────────────────────────────────────────────────────────────────────
  // Worker pool (Ralph 2026-06-01)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Get an idle worker from the per-session pool, or spawn a new one (up
   * to MAX_WORKERS_PER_SESSION). If the pool is full and all workers are
   * busy, queue the caller until one becomes idle.
   *
   * Workers always spawn fresh — no --resume, no main-bridge mapping,
   * no on-disk persistence. They're recycled in-process; killed when
   * the session is killed or after an idle timeout (killIdle).
   */
  private async acquireWorker(sessionId: string, options: BridgeOptions): Promise<BridgeProcess> {
    let pool = this.workerPools.get(sessionId)
    if (!pool) {
      pool = { workers: [], waiters: [] }
      this.workerPools.set(sessionId, pool)
    }
    // Prune dead workers (process may have closed since the last call).
    pool.workers = pool.workers.filter((w) => !w.dead)

    const idle = pool.workers.find((w) => !w.busy)
    if (idle) {
      idle.busy = true
      idle.lastActivity = Date.now()
      return idle
    }
    if (pool.workers.length < MAX_WORKERS_PER_SESSION) {
      const fresh = this.spawnFreshWorker(sessionId, options)
      fresh.busy = true
      pool.workers.push(fresh)
      return fresh
    }
    // Pool full + all busy → wait for a release.
    return new Promise<BridgeProcess>((resolve, reject) => {
      pool!.waiters.push({ resolve, reject })
    })
  }

  /**
   * Release a worker back to the pool. If a waiter is queued, hand the
   * worker directly to them (stays busy). Otherwise mark idle so the next
   * acquireWorker can pick it up. Dead workers are dropped from the pool.
   */
  private releaseWorker(sessionId: string, bp: BridgeProcess): void {
    const pool = this.workerPools.get(sessionId)
    if (!pool) return
    if (bp.dead) {
      pool.workers = pool.workers.filter((w) => w !== bp)
      bp.busy = false
      return
    }
    const waiter = pool.waiters.shift()
    if (waiter) {
      bp.lastActivity = Date.now()
      waiter.resolve(bp) // stays busy — handed off
      return
    }
    bp.busy = false
  }

  /**
   * Spawn a fresh ephemeral worker bridge for a session. Always starts a
   * new CLI session (no --resume) and never touches `this.processes` or
   * the on-disk BRIDGE.json mapping — workers are in-process only.
   */
  private spawnFreshWorker(sessionId: string, options: BridgeOptions): BridgeProcess {
    const claudePath = findClaudeBinary()
    const cliSessionId = crypto.randomUUID()

    const systemFile = join(tmpdir(), `claude-worker-system-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
    writeFileSync(systemFile, options.systemPrompt, 'utf-8')

    const mcpConfigFile = ensureMcpConfig({ sessionId, cwd: options.cwd, agentRole: options.agentRole ?? 'cd' })

    const args = [
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      ...(options.model && options.model !== 'auto' ? ['--model', options.model] : []),
      '--permission-mode', 'bypassPermissions',
      '--system-prompt-file', systemFile,
      '--mcp-config', mcpConfigFile,
      '--allowed-tools', options.allowedTools ?? CD_ALLOWED_TOOLS,
      '--session-id', cliSessionId,
    ]
    console.log(`[Bridge] Spawning worker for ${sessionId} (CLI: ${cliSessionId})`)

    const child = spawn(claudePath, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: '',
        HOME: process.env.HOME,
        PATH: safePath(),
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
        CLAUDE_CODE_ENVIRONMENT_KIND: 'bridge',
      },
    })

    const bp: BridgeProcess = {
      child,
      cliSessionId,
      lastActivity: Date.now(),
      buffer: '',
      dead: false,
      systemPromptFile: systemFile,
      wasResumed: false,
      spawnedModel: options.model,
      actualModel: null,
      kind: 'worker',
      busy: false,
    }

    child.on('error', (err) => {
      console.error(`[Bridge:worker:${sessionId}] error:`, err.message)
      bp.dead = true
    })
    child.on('close', (code) => {
      console.log(`[Bridge:worker:${sessionId}] closed (code ${code})`)
      bp.dead = true
    })
    child.stderr?.on('data', (data) => {
      const msg = data.toString().trim()
      if (msg) console.error(`[Bridge:worker:${sessionId}] stderr: ${msg.slice(0, 300)}`)
    })

    return bp
  }

  /**
   * Get existing process or spawn a new one for this session.
   */
  private getOrSpawn(sessionId: string, options: BridgeOptions, forceFresh = false): BridgeProcess {
    const existing = this.processes.get(sessionId)
    if (existing && !existing.dead && !forceFresh) {
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
      // forceFresh (1M re-roll) deliberately wants a brand-new CLI session
      // so the model assignment gets re-rolled — never resume. Ralph 2026-05-28.
      if (!forceFresh) {
        const modelChanged = existing.spawnedModel !== options.model
        if (!modelChanged) {
          resumeId = existing.cliSessionId
        } else {
          console.log(
            `[Bridge] In-memory model "${existing.spawnedModel}" differs from requested "${options.model}" — dropping --resume to avoid thinking-block signature mismatch`,
          )
        }
      }
      this.cleanup(sessionId)
    }

    // If no in-memory record (server restart), check disk for saved mapping.
    // forceFresh skips this too: a re-roll must not resume the just-killed
    // session whose mapping we wrote one spawn ago.
    if (!resumeId && !forceFresh) {
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
    const mcpConfigFile = ensureMcpConfig({ sessionId, cwd: options.cwd, agentRole: options.agentRole ?? 'cd' })

    // Bug M (Ralph 2026-05-04): when options.model is 'auto', OMIT --model
    // so Claude Code uses its own settings (~/.claude/settings.json or
    // env). Critical for Z.ai-piped Claude Code: the user has configured
    // GLM as the default model; forcing --model claude-opus-4-8 would
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
      '--allowed-tools', options.allowedTools ?? CD_ALLOWED_TOOLS,
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
        PATH: safePath(),
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
      kind: 'main',
      busy: false,
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

    // Persist mapping to disk so we can resume after server restart AND
    // so Order 66 / kill() can SIGTERM by PID when the in-memory record
    // was lost across a Next.js dev reload (WP-115).
    saveBridgeMapping(sessionId, cliSessionId, options.model, child.pid, options.agentRole ?? 'cd')

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
    // ── Worker-pool path (Ralph 2026-06-01) ─────────────────────────────
    // One-shot callers (upload-eval, verdict, proofread) set useWorker:true
    // to route through the per-session worker pool. Each call gets its own
    // CLI subprocess, so N parallel one-shots run on N parallel stdin/stdout
    // streams. No --resume, no 1M re-roll, no withSessionLock — the pool's
    // busy-flag handles concurrency.
    //
    // The main-bridge path below is untouched: chat still spawns/reuses a
    // single persistent bridge per session, withSessionLock serializes turns
    // (chat is sequential anyway), --resume keeps history, 1M re-roll runs.
    if (options.useWorker === true) {
      const bp = await this.acquireWorker(sessionId, options)
      try {
        const msg = JSON.stringify({
          type: 'user',
          message: { role: 'user', content },
          parent_tool_use_id: null,
          session_id: bp.cliSessionId,
        })
        if (!bp.child.stdin?.writable) {
          bp.dead = true
          throw new Error(`Bridge worker stdin not writable for ${sessionId}`)
        }
        bp.child.stdin.write(msg + '\n')
        yield* this.readResponse(bp)
      } finally {
        this.releaseWorker(sessionId, bp)
      }
      return
    }

    // ── 1M re-roll loop (Ralph 2026-05-28) ──────────────────────────────
    // After Order 66 the bridge sometimes comes up on a sub-1M model even
    // though we requested 1M Opus. This manager IS the CLI path, so the
    // re-roll lives here and applies to nothing else — and within the CLI
    // path it's gated on opts.ensure1M, which ONLY the interactive CD chat
    // (chat-stream) sets. The one-shot CD helpers don't, so proofread/verdict
    // /upload-eval/ask-cd never re-roll. On an opted-in FRESH spawn where the
    // caller asked for a 1M model, we read the model the wire actually served
    // and, if it's <1M, kill + respawn fresh + replay the same message — up
    // to MAX_SPAWNS, then give up gracefully at whatever we got.
    //
    // We trust the WIRE model (assistant.message.model), not init: init only
    // echoes our request (`claude-opus-4-8[1m]`) and does NOT reveal a
    // demotion — verified empirically via scripts/probe-cli-1m.mjs. init is
    // used only as an EARLY abort when it explicitly names a sub-1M model.
    //
    // Events are buffered until the model is known, so a demoted attempt's
    // output never leaks to the client — only the kept attempt streams.
    const hadLive = this.hasProcess(sessionId)   // live process pre-turn?
    const MAX_SPAWNS = 4
    const BACKOFF_MS = [1500, 3000, 4500]

    let attempt = 0
    while (true) {
      attempt++
      // Re-roll attempts (>1) force a brand-new CLI session; attempt 1 keeps
      // normal reuse/resume semantics.
      const bp = this.getOrSpawn(sessionId, options, attempt > 1)
      bp.lastActivity = Date.now()
      updateBridgeMappingActivity(sessionId)

      // Eligible to re-roll only when: the caller OPTED IN (only the
      // interactive CD chat route does — this is the CLI-route fence,
      // enforced explicitly), the caller wants a 1M model, this turn began
      // with no live process (a genuine fresh start, e.g. post-Order-66),
      // the spawn was NOT a --resume (resuming would churn live context +
      // risk thinking-block signature mismatch), and attempts remain.
      const eligible =
        options.ensure1M === true && !hadLive && !bp.wasResumed && attempt <= MAX_SPAWNS

      // Send the (same) user message via stdin.
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

      // Not eligible → behave exactly as before: straight pass-through.
      if (!eligible) {
        yield* this.readResponse(bp)
        return
      }

      // Eligible → buffer the turn, then judge on the REAL window Anthropic
      // reports at the result event (result.modelUsage[model].contextWindow).
      // We do NOT trust the model NAME via a lookup table: the upstream
      // sometimes serves a degraded 200K window under the 1M model name, so a
      // name→window map would be fooled into keeping a 200K turn. The reported
      // window is the only truth, and it only arrives at turn end — so a fresh
      // bridge's first turn buffers fully before it streams. Ralph 2026-05-29.
      const buffered: BridgeEvent[] = []
      let decided = false
      let reroll = false
      let keptModel: string | null = null
      let servedWindow: number | null = null

      for await (const ev of this.readResponse(bp)) {
        if (decided) { yield ev; continue }
        buffered.push(ev)

        if (ev.type !== 'result') continue

        // Turn finished — read the window the model ACTUALLY served on.
        const mu = (ev as any).modelUsage as Record<string, { contextWindow?: number }> | undefined
        keptModel = mu && Object.keys(mu).length > 0 ? Object.keys(mu)[0] : null
        const reported = keptModel ? mu?.[keptModel]?.contextWindow : undefined
        servedWindow = typeof reported === 'number' ? reported : null
        decided = true
        // Refuse ONLY when the wire EXPLICITLY reports a sub-1M window. If it
        // reports nothing, fail open — never loop on a non-signal.
        reroll = servedWindow !== null && servedWindow < 1_000_000 && attempt < MAX_SPAWNS

        if (!reroll) {
          for (const b of buffered) yield b
          buffered.length = 0
          if (servedWindow !== null && servedWindow < 1_000_000) {
            void this.warn(
              sessionId,
              `Couldn't secure 1M context after ${MAX_SPAWNS} tries — running at ${Math.round(servedWindow / 1000)}K.`,
            )
          }
        } else {
          break // discard buffer (never yielded); kill + respawn below
        }
      }

      // readResponse ended before a result event (e.g. the process died early).
      // Fail open: release whatever we buffered and stop. Never re-roll on a
      // non-signal death — that could loop on a broken spawn.
      if (!decided) {
        for (const b of buffered) yield b
        return
      }

      if (!reroll) return // streamed to completion (≥1M, no-signal, or gave up)

      // Re-roll: the wire served a sub-1M window. Kill + try a fresh session.
      void this.warn(
        sessionId,
        `Served ${servedWindow ? Math.round(servedWindow / 1000) + 'K' : 'a sub-1M'} window (need 1M) — re-rolling… (attempt ${attempt + 1}/${MAX_SPAWNS})`,
      )
      console.log(
        `[Bridge] ${sessionId} served ${keptModel ?? '<unknown>'} @ ${servedWindow ?? '?'} window (<1M) on attempt ${attempt}; re-rolling`,
      )
      this.kill(sessionId)
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1] ?? 4500))
      // loop → respawn fresh, resend the same message
    }
  }

  /**
   * Best-effort UI notice via the event bus (cd_snackbar). Non-fatal:
   * swallowed if the bus isn't loaded. Used by the 1M re-roll loop to tell
   * the user it's retrying / gave up. Ralph 2026-05-28.
   */
  private async warn(sessionId: string, text: string): Promise<void> {
    try {
      const { publish } = await import('./event-bus')
      publish(sessionId, { type: 'cd_snackbar', text, severity: 'info', sticky: false } as any)
    } catch {
      /* non-fatal */
    }
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
          // Z.ai serves glm-4.7 for claude-opus-4-8 requests; the init
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
   *
   * Disk-fallback (WP-115, Ralph 2026-05-29): when the in-memory record was
   * lost across a Next.js dev reload, fall back to the BRIDGE.json's saved
   * `pid` and SIGTERM by PID. Without this fallback, Order 66 would
   * silently no-op against orphaned bridges (the symptom: gauge clicks
   * "succeed" but the claude --print child keeps running and the next
   * sendMessage call goes through to a stale process).
   */
  kill(sessionId: string): void {
    // Tear down the worker pool first (Ralph 2026-06-01) — Order 66 must
    // reach workers too, otherwise idle workers survive the kill and
    // serve stale state into the next session.
    const pool = this.workerPools.get(sessionId)
    if (pool) {
      for (const w of pool.workers) {
        try { w.child.kill('SIGTERM') } catch { /* already dead */ }
        if (w.systemPromptFile) { try { unlinkSync(w.systemPromptFile) } catch {} }
        w.dead = true
      }
      // Reject any pending waiters so their acquireWorker promise
      // settles instead of hanging forever. The caller (e.g.
      // runUploadEval) catches and surfaces as `verdict:'error'`.
      const waiters = pool.waiters.slice()
      pool.waiters.length = 0
      this.workerPools.delete(sessionId)
      const killErr = new Error(`Bridge worker pool for session ${sessionId} killed`)
      for (const w of waiters) w.reject(killErr)
    }

    const bp = this.processes.get(sessionId)
    if (bp) {
      console.log(`[Bridge] Killing session ${sessionId} (in-memory pid ${bp.child.pid ?? '?'})`)
      bp.child.kill('SIGTERM')
      this.cleanup(sessionId)
      return
    }

    // No in-memory record — try the disk mapping.
    const mapping = loadBridgeMapping(sessionId)
    if (!mapping?.pid) {
      // Nothing to kill; absent disk pid is the common case for sessions
      // that never ran on this Node instance (or have already been killed).
      return
    }
    try {
      // Probe liveness without sending a signal — kill(pid, 0) throws if
      // the process is dead or owned by another user.
      process.kill(mapping.pid, 0)
    } catch {
      console.log(`[Bridge] Disk-mapped pid ${mapping.pid} for ${sessionId} is already gone`)
      return
    }
    console.log(`[Bridge] Killing orphaned bridge for ${sessionId} via disk pid ${mapping.pid} (${mapping.agentRole ?? 'unknown role'})`)
    try {
      process.kill(mapping.pid, 'SIGTERM')
    } catch (err) {
      console.error(`[Bridge] Failed to SIGTERM pid ${mapping.pid}:`, err)
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
    // Same idle-pruning for worker pools (Ralph 2026-06-01) — don't let
    // workers accumulate across long-running sessions.
    for (const [sessionId, pool] of this.workerPools) {
      const survivors: BridgeProcess[] = []
      for (const w of pool.workers) {
        if (w.dead) continue
        if (!w.busy && now - w.lastActivity > maxIdleMs) {
          console.log(`[Bridge:worker:${sessionId}] Idle cleanup (idle ${Math.round((now - w.lastActivity) / 1000)}s)`)
          try { w.child.kill('SIGTERM') } catch { /* dead */ }
          if (w.systemPromptFile) { try { unlinkSync(w.systemPromptFile) } catch {} }
          w.dead = true
          continue
        }
        survivors.push(w)
      }
      pool.workers = survivors
      if (pool.workers.length === 0 && pool.waiters.length === 0) {
        this.workerPools.delete(sessionId)
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
