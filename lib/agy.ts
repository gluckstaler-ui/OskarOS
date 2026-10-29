// ============================================================================
// lib/agy.ts — the Antigravity CLI (`agy`, ~/.local/bin/agy) as Oskar's Gemini runtime (Ralph 2026-10-26).
// When the model switch is on GEMINI, the big brain (Consular, CD — lib/bridge-process-manager.ts) and the
// WebDev padawan (lib/webdev.ts) run Gemini 4 Argon through it instead of the Claude CLI.
//   · agy has no system-prompt flag: the prompt is the body of a custom agent file
//     `.agents/agents/<name>.md` in the workspace (git-ignored, removed when the run ends);
//   · the same file declares Oskar's MCP server for this session and role — agy 1.4.7 sends `${VAR}` in MCP
//     headers literally, so each agent carries its own URL (the one ensureMcpConfig builds for the Claude CLI);
//   · its stream-json (init / step_update / result) is translated into the Claude CLI's stream-json, so every
//     reader (bridge callers, tool collectors, WebDev's build_done parser) works unchanged;
//   · permissions come from ~/.gemini/antigravity-cli/settings.json (toolPermission always-proceed, Ralph);
//   · it signs in with Oskar's Vertex service account (agyEnv), because Oskar runs under cron and can't read the keychain.
// ============================================================================
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { ensureMcpConfig, MCP_SERVER_NAME, type AgentRole } from './mcp-config'
import { VERTEX_KEY_FILE, vertexAccount } from './vertex'

/** Environment for every agy run: it signs in with Oskar's Vertex service account (ADC, billed to the key's Cloud
 *  project), not with the subscription login. That login lives in the login keychain, which processes started by
 *  cron — Oskar — can't read ("Print mode: silent auth failed", 2026-10-26). Without the key file agy falls back
 *  to the keychain login. */
export function agyEnv(): Record<string, string> {
  const account = vertexAccount()
  if (!account) return {}
  return {
    AGY_ADC_AUTH: 'true',
    GOOGLE_APPLICATION_CREDENTIALS: VERTEX_KEY_FILE,
    GOOGLE_CLOUD_QUOTA_PROJECT: account.projectId,
    GOOGLE_CLOUD_LOCATION: 'eu',   // fastest of global/eu/us for Gemini 4 Argon (4 s vs 5–6.5 s, 2026-10-26)
  }
}

/** The folder agy runs in: the real path. Oskar's cwd is the link /Oskar, which agy's project (the real
 *  /System/Volumes/Data/Oskar) doesn't match — agy then looks for a project file that isn't there. */
export const agyCwd = (cwd: string): string => { try { return realpathSync(cwd) } catch { return cwd } }

/** A Claude CLI stream-json event, as the readers expect it. */
type ClaudeEvent = { type: string; [key: string]: any }

/** The built-in agy tools Oskar's agents get — a custom agent has only those listed (test 2026-10-26: without the
 *  list a WebDev build could read but not write). What the Claude agents have: files, shell, search, web pages,
 *  Oskar's MCP tools. Not the browser, scheduling or agy's own subagents. Only names agy's registry accepts:
 *  command_status, send_command_input and the MCP tools (call_mcp_tool, list_resources, read_resource) come
 *  with the others and are refused in this list ("not found in registry", agy exits 3). */
const AGY_TOOLS = [
  'view_file', 'list_dir', 'find_by_name', 'grep_search',
  'write_to_file', 'replace_file_content',
  'run_command', 'wait',
  'read_url_content', 'search_web',
]

/** Writes the agent file of one agy run → its name (for --agent) and path (to remove when the run ends). */
export function writeAgyAgent(o: { name: string; cwd: string; sessionId: string; role: AgentRole; systemPrompt: string }): { name: string; file: string } {
  const name = o.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const mcp = JSON.parse(readFileSync(ensureMcpConfig({ sessionId: o.sessionId, cwd: o.cwd, agentRole: o.role }), 'utf-8'))
  const server = mcp.mcpServers[MCP_SERVER_NAME] as { url: string; headers?: Record<string, string> }
  const q = (v: string) => JSON.stringify(v)   // a JSON string is a valid YAML double-quoted scalar
  const file = join(agyCwd(o.cwd), '.agents', 'agents', `${name}.md`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, [
    '---',
    `name: ${name}`,
    `description: ${q(`OskarOS ${o.role} for session ${o.sessionId}, started by Oskar`)}`,
    'tools:',
    ...AGY_TOOLS.map(t => `  - ${t}`),
    'mainAgent: true',
    'subagent: false',
    'mcpServers:',
    `  - name: ${MCP_SERVER_NAME}`,
    `    serverUrl: ${q(server.url)}`,
    ...(server.headers ? ['    headers:', ...Object.entries(server.headers).map(([k, v]) => `      ${k}: ${q(v)}`)] : []),
    '---',
    o.systemPrompt,
  ].join('\n'), 'utf-8')
  return { name, file }
}

/** Per-run state of the translation: the model to report, the tool steps already sent as tool_use, and who
 *  wants the conversation id (for --conversation) once init names it. */
export interface AgyStreamState { model: string; toolSteps: Set<string>; onConversation?: (id: string) => void }

const usage = (u?: { input_tokens?: number; output_tokens?: number; cache_read_tokens?: number }) =>
  u ? { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, cache_read_input_tokens: u.cache_read_tokens || 0 } : undefined

/** An agy tool step as the Claude tool_use the readers know: Oskar's MCP tools (call_mcp_tool) get the
 *  `mcp__<server>__<tool>` name, so the collectors (suggest_reply, build_done, …) find them. */
function toolUse(t: { name: string; parameters?: Record<string, unknown> }): { name: string; input: unknown } {
  if (t.name === 'call_mcp_tool') return { name: `mcp__${t.parameters?.ServerName || MCP_SERVER_NAME}__${t.parameters?.ToolName}`, input: t.parameters?.Arguments ?? {} }
  return { name: t.name, input: t.parameters ?? {} }
}

/** One agy stream-json event → the Claude stream-json events (init, assistant text and tool_use, user
 *  tool_result, result). */
export function fromAgyEvent(e: any, st: AgyStreamState): ClaudeEvent[] {
  if (e?.event === 'init') {
    const conv = String(e.conversation_id || '')
    if (conv) st.onConversation?.(conv)
    return [{ type: 'system', subtype: 'init', session_id: conv, model: e.init?.model || st.model, cwd: e.init?.cwd, tools: e.init?.tools, agent: e.init?.agent }]
  }
  if (e?.event === 'step_update') {
    const s = e.step_update || {}
    if (s.step_type === 'agent_response' && s.text_delta) {
      return [{ type: 'assistant', message: { role: 'assistant', model: st.model, content: [{ type: 'text', text: s.text_delta }], usage: usage(s.usage) } }]
    }
    if (s.step_type === 'tool' && s.tool_info) {
      const id = `agy_${s.conversation_id}_${s.step_index}`
      const out: ClaudeEvent[] = []
      if (!st.toolSteps.has(id)) {
        st.toolSteps.add(id)
        out.push({ type: 'assistant', message: { role: 'assistant', model: st.model, content: [{ type: 'tool_use', id, ...toolUse(s.tool_info) }] } })
      }
      if (s.state === 'DONE' || s.state === 'ERROR') {
        const err = s.tool_info.error?.message
        const output = s.tool_info.output
        out.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: err || (typeof output === 'string' ? output : JSON.stringify(output ?? '')), is_error: !!err }] } })
      }
      return out
    }
    return []
  }
  if (e?.event === 'result') {
    const r = e.result || {}
    const ok = r.status === 'SUCCESS'
    if (r.denied_actions?.length) console.warn(`[agy] refused without permission: ${JSON.stringify(r.denied_actions)}`)
    return [{ type: 'result', subtype: ok ? 'success' : 'error', is_error: !ok, result: ok ? (r.response || '') : (r.error || r.status || 'agy error'),
      session_id: r.conversation_id, num_turns: r.num_turns, duration_ms: Math.round((r.duration_seconds || 0) * 1000), usage: usage(r.usage), denied_actions: r.denied_actions }]
  }
  return []
}

/** For readers of raw stdout: feed agy's stdout chunks, get Claude stream-json lines back (call with '\n' at
 *  the end to flush the last line). */
export function agyToClaudeLines(st: AgyStreamState): (chunk: string) => string {
  let buffer = ''
  return (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    let out = ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { for (const ev of fromAgyEvent(JSON.parse(line), st)) out += JSON.stringify(ev) + '\n' }
      catch { out += line + '\n' }
    }
    return out
  }
}
