/**
 * mcp-tool-collector — capture `tool_use` events from an agent's stream.
 *
 * Phase 2 (2026-04-30) replaced text-output parsers (`## SEVERITY`, trailing
 * JSON manifests, Ask-CD `## IMAGE PROMPT` headers) with structured MCP
 * tool calls. Every wrapping function (`callCDBridge`, `runWebDev`,
 * `runSentinelTi`) iterates the agent's stream once. This module's job is
 * trivial: filter `tool_use` blocks by name, expose their typed `input`
 * args, do nothing else. The MCP server's tool handler ACKs the call so
 * the agent continues; the structured data is already in the stream.
 *
 * Two shapes:
 *
 *  - `makeToolCollector(names)` — incremental collector. Callers consume
 *    events one at a time (so they can ALSO do per-event work like
 *    forwarding text to a live feed) and pull the accumulated calls at
 *    the end. Used by Sentinel Ti's parallel narrative+scores architecture
 *    and by callCDBridge's existing event loop.
 *
 *  - `collectFromStreamJsonLines(lines, names)` — single-shot helper for
 *    raw `claude --print` stdout. Useful when there's no separate event
 *    iteration loop already in flight (e.g. WebDev's debug-log writer).
 *
 * Last-write-wins: if an agent calls `submit_critique` twice in one
 * stream, the second call's args replace the first. Per spec, agents
 * should call once per response — but the collector is tolerant.
 *
 * Tool names normalized: the Claude CLI prefixes MCP tool names with
 * `mcp__<server>__`. Both forms ("submit_critique" or
 * "mcp__oskar-orchestrator__submit_critique") match the same expected
 * name. Callers pass the bare tool name.
 */

import type { BridgeEvent } from './bridge-process-manager'

/** Map of tool name → typed args object (caller validates the shape). */
export type ToolCalls = Record<string, unknown>

/** Single tool_use observation. Same shape across CLI and Bridge streams. */
export interface ToolUseObservation {
  name: string
  input: unknown
  id?: string
}

/**
 * Strip the `mcp__<server>__` prefix Claude CLI adds to MCP tool names.
 * The agent might call `submit_critique`; the CLI relays it as
 * `mcp__oskar-orchestrator__submit_critique`. Either form maps to the
 * bare tool name in the expected-set.
 */
export function stripMcpPrefix(name: string): string {
  const m = name.match(/^mcp__[^_]+__(.+)$/)
  return m ? m[1] : name
}

/**
 * Incremental collector. Call `consume(event)` once per event from the
 * agent's stream. At end-of-stream, read `getToolCalls()`.
 */
export interface ToolCollector {
  /** Returns true if THIS event contained at least one matched tool_use. */
  consume(event: BridgeEvent): boolean
  /** All matched tool calls captured so far. Mutates as more events arrive. */
  getToolCalls(): ToolCalls
}

export function makeToolCollector(expectedTools: readonly string[]): ToolCollector {
  const out: ToolCalls = {}
  const expected = new Set(expectedTools)
  return {
    consume(event: BridgeEvent): boolean {
      // BridgeEvent is loosely typed (extra fields tolerated). The shape we
      // care about: { type: 'assistant', message: { content: [...blocks...] } }
      // where blocks include `{ type: 'tool_use', name, input, id }`.
      if (event?.type !== 'assistant') return false
      const message = (event as { message?: unknown }).message
      const blocks = (message as { content?: unknown })?.content
      if (!Array.isArray(blocks)) return false
      let matched = false
      for (const block of blocks) {
        if (!block || typeof block !== 'object') continue
        const b = block as { type?: string; name?: string; input?: unknown }
        if (b.type !== 'tool_use') continue
        if (typeof b.name !== 'string') continue
        const name = stripMcpPrefix(b.name)
        if (!expected.has(name)) continue
        out[name] = b.input
        matched = true
      }
      return matched
    },
    getToolCalls(): ToolCalls {
      return out
    },
  }
}

/**
 * Single-shot helper for raw stream-json stdout (one JSON event per line).
 * Used by spawn-and-wait paths that aren't already iterating event-by-event
 * (WebDev CLI mode, Sentinel Ti when a fresh capture pass is needed).
 *
 * Tolerant: skips empty lines and JSON-parse failures (the CLI sometimes
 * emits non-JSON status text mixed into stdout).
 */
export function collectFromStreamJsonLines(
  lines: readonly string[],
  expectedTools: readonly string[],
): ToolCalls {
  const collector = makeToolCollector(expectedTools)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let evt: BridgeEvent
    try {
      evt = JSON.parse(line) as BridgeEvent
    } catch {
      continue
    }
    collector.consume(evt)
  }
  return collector.getToolCalls()
}

/**
 * Convenience: collect from a single concatenated stdout string.
 */
export function collectFromStdout(
  stdout: string,
  expectedTools: readonly string[],
): ToolCalls {
  return collectFromStreamJsonLines(stdout.split('\n'), expectedTools)
}
