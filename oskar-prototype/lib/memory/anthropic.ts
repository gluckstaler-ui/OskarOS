/**
 * Shared utility for memory agents (lumberjack + dreamer).
 *
 * Calls claude --print with OAuth (no API key needed).
 * --tools "" disables tools — these are text pipelines, the calling code
 * handles all file I/O.
 */

import { spawn, exec } from 'child_process'
import { writeFileSync, unlinkSync, createWriteStream, appendFileSync, type WriteStream } from 'fs'
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
 *
 * `logPath` (optional): when set, the FULL raw stdout + stderr + exit metadata
 * is written to that path after the process closes (success OR failure). Order
 * 65 / Order 66 sages pass `public/{sessionId}/logs/_debug-sage-*.log` so
 * failed runs leave a forensic trail instead of just `## ERROR: Agent call
 * failed.` in the summary file. Mirrors what webdev does at its own
 * `_debug-webdev-*.log`.
 */
export async function callAnthropic(
  model: MemoryModel,
  userMessage: string,
  systemPrompt?: string,
  logPath?: string,
  // 2026-04-29: Ralph wants live UI visibility into Sage runs. Each parsed
  // stream-json event is forwarded here (when set) with a one-line preview,
  // so dreamer.ts can fan it out as a ProgressEvent and the
  // CompactionOverlay shows the agent's actual work in real time.
  onStreamEvent?: (preview: { type: string; detail: string }) => void,
): Promise<string | null> {
  const inputSize = userMessage.length
  const sysSize = systemPrompt?.length || 0
  console.log(
    `[memory/anthropic] Calling claude --print: model=${model} (user: ${inputSize} chars` +
    (sysSize ? `, system: ${sysSize} chars` : '') + ')',
  )

  // Optional system prompt — set as a file so it takes the system-prompt
  // slot in the CLI (priority 1) instead of the default OskarOS-aware
  // CLAUDE.md auto-discovery (priority 2). Without this, calls that pipe
  // a long structured user message can be misread as creative input —
  // e.g. an inlined SESSION.md chunk becomes "more text to continue."
  // (Ralph 2026-04-25 — Sage callers need this badly.)
  let sysFile: string | undefined
  if (systemPrompt) {
    sysFile = path.join(tmpdir(), `mem-sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`)
    try { writeFileSync(sysFile, systemPrompt, 'utf-8') }
    catch (err) {
      console.error(`[memory/anthropic] Failed to write system prompt file: ${err}`)
      sysFile = undefined
    }
  }

  // 2026-04-29: write the user message to a temp file and feed it via shell
  // stdin redirection (`< file`). Replaces the earlier `child.stdin.write +
  // .end()` pattern, which silently dropped large payloads — Sage Portrait's
  // 400-550KB user message hit Node's pipe buffer limit, returned false from
  // .write() without draining, and .end() raced the CLI's stdin EOF. The CLI
  // saw partial input, exited inside ~2s after just emitting the system init
  // event, and the close handler's trailer write got lost in the dying
  // WriteStream. Symptom Ralph saw: every Sage Portrait debug log was 8 lines
  // long with only the init JSON. With shell redirection the OS handles
  // backpressure for us — no JS-side write/drain dance, works for any size.
  const userFile = path.join(tmpdir(), `mem-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.txt`)
  try { writeFileSync(userFile, userMessage, 'utf-8') }
  catch (err) {
    console.error(`[memory/anthropic] Failed to write user message file: ${err}`)
    if (sysFile) { try { unlinkSync(sysFile) } catch {} }
    return null
  }

  return new Promise((resolve) => {
    // 2026-04-29: switched to `--verbose --output-format stream-json` so the
    // CLI emits one JSON event per line as it works, instead of buffering
    // the whole response until completion. Two wins:
    //   1. We can pipe each chunk to the debug log file LIVE — even when the
    //      5-min SIGTERM kill fires, the log keeps every event the model
    //      produced before death (proven failure mode for Sage Portrait at
    //      550K user chars).
    //   2. The CLI's internal buffer no longer stalls on large prompts (same
    //      pattern callAnthropicAgent uses; comment in that function explains
    //      the 220KB stall it diagnosed back in 2026-04-20).
    // The agent's text result is extracted from the final `type:"result"`
    // line via parseStreamJsonResult — same helper callAnthropicAgent uses.
    const claudeArgs = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--model', model,
      '--tools', '',
      '--no-session-persistence',
      ...(sysFile ? ['--system-prompt-file', sysFile] : []),
    ]
    // Shell-quote each arg so paths / model names with spaces or quotes
    // survive. Then redirect stdin from the temp file. Pure POSIX shell.
    const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
    const cmd = `claude ${claudeArgs.map(shQuote).join(' ')} < ${shQuote(userFile)}`

    const child = spawn('sh', ['-c', cmd], {
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: '', // Force OAuth
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    // 2026-04-29: Ralph wants LIVE visibility into Sage runs, not a
    // post-mortem file. Three writes per chunk:
    //   1. Timestamped audit log (`logPath`)         — long-term forensic record
    //   2. Stable "-current" sibling file            — `tail -f` target Ralph can watch
    //   3. Console.error per stream-json event       — visible in `npm run dev` terminal
    //
    // The "-current" file: same dir + filename pattern as logPath but with
    // `-current` instead of the ISO timestamp. Overwritten on each call so
    // tailing it always shows the freshest run.
    //   logPath: .../_debug-sage-portrait-2026-04-29T16-06-02-241Z.log
    //   currentPath: .../_debug-sage-portrait-current.log
    //
    // Console logging parses each \n-delimited JSON event so the dev
    // terminal shows a one-line summary instead of a wall of base64.
    let logStream: WriteStream | undefined
    let currentStream: WriteStream | undefined
    let currentPath: string | undefined
    if (logPath) {
      try {
        const header =
          `# memory/anthropic raw log (streaming)\n` +
          `# model: ${model}\n` +
          `# user_chars: ${inputSize}\n` +
          `# system_chars: ${sysSize}\n` +
          `# user_file: ${userFile}\n` +
          `# started_at: ${new Date().toISOString()}\n\n` +
          `## STDOUT (one stream-json event per line)\n`
        writeFileSync(logPath, header, 'utf-8')
        logStream = createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' })

        // Strip the trailing `-{ISO}.log` to derive the "-current" file.
        // Pattern: `-2026-04-29T16-06-02-241Z.log` → `-current.log`
        currentPath = logPath.replace(/-\d{4}-\d{2}-\d{2}T[\d-]+Z\.log$/, '-current.log')
        if (currentPath !== logPath) {
          writeFileSync(currentPath, header, 'utf-8')
          currentStream = createWriteStream(currentPath, { flags: 'a', encoding: 'utf-8' })
        }
      } catch (logErr) {
        console.error(`[memory/anthropic] Failed to open debug log at ${logPath}: ${logErr}`)
      }
    }

    // Tag console output with the agent's name so multiple parallel runs
    // (Sage 240/40 cuts + Sage Portrait) are distinguishable in the terminal.
    const agentTag = logPath
      ? logPath.split('/').pop()!.replace(/^_debug-/, '').replace(/-\d{4}.*$/, '')
      : 'memory'
    let stdoutBuffer = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d
      if (logStream) logStream.write(d)
      if (currentStream) currentStream.write(d)

      // Parse \n-delimited JSON events and log a one-line summary per event
      // to the dev-server console. Visible LIVE in `npm run dev` terminal.
      stdoutBuffer += d.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const evt = JSON.parse(line)
          // 2026-04-29: Ralph wants the FULL text in the live UI feed, not a
          // 120-char preview. We send the whole text/thinking content; the
          // UI renders it with `white-space: pre-wrap`. Cap at 8KB per event
          // so a runaway response doesn't blow out the React state — that
          // covers any realistic Block paragraph (the ones we've seen are
          // 4-5KB max) without truncating real model output.
          const cap = (s: string) => s.length > 8000 ? s.slice(0, 8000) + '\n…[truncated]' : s
          let detail = ''
          if (evt.type === 'system') detail = `init session=${evt.session_id?.slice(0, 8)}`
          else if (evt.type === 'rate_limit_event') detail = `rate=${evt.rate_limit_info?.status} overage=${evt.rate_limit_info?.overageStatus}`
          else if (evt.type === 'assistant' && evt.message?.content) {
            const block = evt.message.content[0]
            if (block?.type === 'text') detail = cap(block.text || '')
            else if (block?.type === 'thinking') detail = `[thinking]\n${cap(block.thinking || '')}`
            else detail = `block=${block?.type || 'unknown'}`
          }
          else if (evt.type === 'result') {
            // Metadata only. The `result` field is identical to the final
            // assistant text block — including it here would duplicate the
            // Block in the live feed (Ralph caught this 2026-04-30).
            detail = `subtype=${evt.subtype} duration=${evt.duration_ms}ms cost=$${evt.total_cost_usd?.toFixed(4)}`
          }
          else detail = `type=${evt.type}`
          // Console gets a one-line summary (full text would be unreadable).
          const consolePreview = detail.split('\n')[0].slice(0, 160)
          console.error(`[${agentTag}] ${evt.type}: ${consolePreview}${detail.length > consolePreview.length ? '…' : ''}`)
          // UI overlay gets the full detail — pre-wrap rendering shows it cleanly.
          if (onStreamEvent) {
            try { onStreamEvent({ type: evt.type, detail }) }
            catch {}
          }
        } catch {
          // Non-JSON line — log raw, capped.
          console.error(`[${agentTag}] raw: ${line.slice(0, 200)}`)
        }
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d
      const text = d.toString()
      if (logStream) logStream.write(`\n[STDERR] ${text}`)
      if (currentStream) currentStream.write(`\n[STDERR] ${text}`)
      // Stderr is rare and important — never silent.
      console.error(`[${agentTag}] STDERR: ${text.trim().slice(0, 300)}`)
    })

    // 10 minute timeout (was 5min — large Sage Portrait payloads need more).
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      console.error('[memory/anthropic] Timeout (10m)')
      // Don't resolve here — let `close` handler do the bookkeeping
      // (finalize log, parse partial stream-json, etc) once the kill takes
      // effect. The close handler resolves the promise.
    }, 10 * 60 * 1000)

    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      if (sysFile) { try { unlinkSync(sysFile) } catch {} }
      // Clean up the user-message temp file too — it can be hundreds of KB.
      try { unlinkSync(userFile) } catch {}

      // Finalize streaming logs SYNCHRONOUSLY. The earlier version used
      // `logStream.end(trailer)` which is async and races process teardown
      // (Next.js dev hot-reload, parent process restart, etc.) — Ralph saw
      // 8-line portrait logs with no trailer because the WriteStream's
      // pending buffer never reached disk. `appendFileSync` is durable.
      if (logStream) { try { logStream.end() } catch {} }
      if (currentStream) { try { currentStream.end() } catch {} }
      const trailer =
        `\n\n## TRAILER\n` +
        `# exit_code: ${code ?? 'null'}\n` +
        `# stdout_chars: ${stdout.length}\n` +
        `# stderr_chars: ${stderr.length}\n` +
        `# finished_at: ${new Date().toISOString()}\n\n` +
        `## STDERR (full)\n${stderr}\n`
      if (logPath) {
        try { appendFileSync(logPath, trailer, 'utf-8') }
        catch (logErr) { console.error(`[memory/anthropic] Failed to finalize debug log: ${logErr}`) }
      }
      if (currentPath) {
        try { appendFileSync(currentPath, trailer, 'utf-8') }
        catch {}
      }
      console.error(`[${agentTag}] CLOSED exit=${code} stdout=${stdout.length}B stderr=${stderr.length}B`)

      if (code !== 0) {
        console.error(`[memory/anthropic] Exit code: ${code}`)
        if (stderr) console.error(stderr.slice(0, 300))
        resolve(null)
        return
      }
      // Parse the agent's text output from the final `type:"result"` event in
      // the stream-json output. Falls back to last non-empty line if no
      // result event is present (defensive — should always be there on success).
      const result = parseStreamJsonResult(stdout)
      if (result) {
        console.log(`[memory/anthropic] Success: ${result.length} chars (model=${model})`)
        resolve(result)
      } else {
        console.warn('[memory/anthropic] No result event in stream — falling back to raw stdout')
        const trimmed = stdout.trim()
        resolve(trimmed || null)
      }
    })

    child.on('error', (err: Error) => {
      clearTimeout(timer)
      try { unlinkSync(userFile) } catch {}
      console.error(`[memory/anthropic] Spawn error: ${err.message}`)
      resolve(null)
    })
  })
}

/**
 * Call claude --print WITH tools enabled (Read + Edit).
 * For agents that need to edit files in place (Lumberjack, Dreamer).
 *
 * IDENTITY ARCHITECTURE — the prompt is loaded as the SYSTEM PROMPT
 * (`--system-prompt-file`), not as a stdin user message. This matters:
 *
 *   Priority 1 (system prompt) ← Lumberjack identity lives HERE
 *   Priority 2 (CLAUDE.md auto-discovery)
 *   Priority 3 (user messages / stdin)
 *
 * Before this fix, the prompt was piped via stdin, meaning the CLI treated
 * "You are Lumberjack" as a user asking it to roleplay. That left the
 * system-prompt slot empty, so the CLI's default system prompt (which
 * auto-discovers parent CLAUDE.md files) filled in. Lumberjack's identity
 * got shadowed by the OskarOS orchestrator's CLAUDE.md, leading to stages
 * responding as "one of the three agents" (CD/COO/WebDev) instead of
 * cleaning SESSION.md. P1/P5/P6 drifted; P3/P4 hung; only P2 survived.
 *
 * With --system-prompt-file, the CLI's default system prompt is REPLACED
 * entirely — no CLAUDE.md auto-discovery, no identity drift. Per CLI docs:
 *   "--exclude-dynamic-system-prompt-sections … ignored with --system-prompt"
 * which confirms that --system-prompt[-file] replaces the default outright.
 *
 * Matches the pattern bridge-process-manager.ts uses for the main bridge
 * (line 158: `'--system-prompt-file', systemFile`).
 *
 * Note on stdin vs positional user message: we send a trivial trigger
 * ("Execute your task.") as a positional arg. The agent's system prompt
 * contains the task description + expected output format, so the trigger
 * is essentially the "go" signal.
 *
 * Uses exec + temp file instead of spawn with streaming stdin. Spawn with
 * tool-enabled CLI has historically hit a "duplicate tool_use ids" bug in
 * some runtimes (tsx); shell exec is reliable.
 */
export async function callAnthropicAgent(
  model: MemoryModel,
  systemPrompt: string,
  cwd: string,
  timeoutMs: number = 10 * 60 * 1000
): Promise<string | null> {
  console.log(`[memory/anthropic] Calling claude agent: model=${model}, cwd=${cwd}, systemPrompt=${systemPrompt.length} chars`)

  const promptFile = path.join(tmpdir(), `lj-prompt-${Date.now()}.txt`)

  try {
    writeFileSync(promptFile, systemPrompt, 'utf-8')
  } catch (err) {
    console.error(`[memory/anthropic] Failed to write prompt file: ${err}`)
    return null
  }

  return new Promise((resolve) => {
    // IDENTITY FIX: Lumberjack's prompt is the SYSTEM PROMPT, not a user
    // message. --system-prompt-file replaces the CLI's default system prompt
    // entirely, excluding parent CLAUDE.md auto-discovery that would
    // otherwise inject "you are part of the OskarOS three-agent system"
    // ambient context and shadow Lumberjack's identity.
    //
    // 2026-04-20: added --verbose + --output-format stream-json. Without
    // these the CLI buffered internally when the system prompt was large
    // (220KB+ with SESSION.md inlined) and hit our 5-min exec timeout on
    // every single stage, even when the same invocation via the
    // debug-lumberjack.sh script (which uses stream-json) completed in
    // ~2.5 min. Every stage timed out → "0/7 completed, all FAILED".
    //
    // Stream-json emits one JSON event per line so stdout never blocks.
    // We parse the final line with `type:"result"` to extract the agent's
    // text response. The rest of the stream (tool_use events etc.) is
    // ignored — it's already logged by the CLI's own mechanism if needed.
    const cmd = [
      'claude --print',
      '--verbose',
      '--output-format stream-json',
      `--model ${model}`,
      '--tools "Read,Edit"',
      `--system-prompt-file "${promptFile}"`,
      '--dangerously-skip-permissions',
      '--no-session-persistence',
      '"Execute the task described in your system prompt."',
    ].join(' ')

    exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      // Clean up temp file
      try { unlinkSync(promptFile) } catch {}

      if (err) {
        // ExecException includes `killed?: boolean | undefined` per Node docs,
        // but the @types/node typings don't expose it cleanly on that interface.
        // Cast via `unknown` to get at the runtime field without a TS2352.
        const killed = (err as unknown as { killed?: boolean }).killed
        console.error(`[memory/anthropic] Agent error: exit=${err.code} killed=${killed}`)
        if (stderr) console.error(stderr.slice(0, 500))
        // Even on timeout, try to salvage a partial result from stdout —
        // the CLI may have emitted a completed result event just before
        // the kill signal arrived.
        const partial = parseStreamJsonResult(stdout || '')
        if (partial) {
          console.log(`[memory/anthropic] Agent partial: ${partial.length} chars recovered from killed process`)
          resolve(partial)
          return
        }
        resolve(null)
        return
      }

      const result = parseStreamJsonResult(stdout || '')
      if (result) {
        console.log(`[memory/anthropic] Agent done: ${result.length} chars summary`)
        resolve(result)
      } else {
        console.warn('[memory/anthropic] Agent done but no result event found in stream')
        // Fall back to raw stdout so we don't drop a response that isn't
        // in the expected shape. Extract the last non-empty line.
        const lines = (stdout || '').trim().split('\n').filter((l) => l.trim())
        const last = lines[lines.length - 1]?.trim()
        resolve(last || null)
      }
    })
  })
}

/**
 * Parse Claude CLI stream-json output to extract the agent's final text.
 *
 * Stream format (one JSON event per line):
 *   {"type":"system","subtype":"init",...}
 *   {"type":"assistant","message":{...}}
 *   {"type":"user","message":{...tool_result...}}
 *   {"type":"result","subtype":"success","result":"the text","duration_ms":...}
 *
 * We want the `result` field on the final `type:"result"` line. Scanning
 * backwards is faster (the result is always last) and still correct if the
 * stream was truncated mid-event.
 */
function parseStreamJsonResult(output: string): string | null {
  const lines = output.trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed.type === 'result' && typeof parsed.result === 'string') {
        return parsed.result
      }
    } catch {
      // Incomplete JSON (stream was truncated mid-line) — keep scanning.
    }
  }
  return null
}
