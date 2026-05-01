/**
 * Cross-agent orchestration tools (Phase 3, 2026-04-30).
 *
 * The agents talk to each other through the orchestrator instead of through
 * Ralph's chat. Three tools:
 *
 *   notify_agent(target, message, priority?)
 *     Push a directed message onto the target agent's inbox queue.
 *     Permission table in lib/agent-inbox-bus.ts: CD ↔ Jedi Code is full
 *     bidirectional; WebDev/Sentinel can notify CD/Jedi-Code but not each
 *     other; Jedi Code (the architect) can notify any agent.
 *
 *   agent_inbox()
 *     Drain + return the calling agent's pending messages, sorted by
 *     priority (high/normal/low) and oldest-first within priority.
 *     Empties the queue — messages are delivered exactly once.
 *
 *   agent_status(target)
 *     Read-only view of the target agent's current state: pending inbox
 *     count, last activity timestamp. Useful before sending a message
 *     to know whether the target is active.
 *
 * Identity: the calling agent's role is taken from the ToolCallContext
 * (which the HTTP route built from the X-Oskar-Agent header). Spoofing the
 * `from` field in the tool args has no effect; the dispatcher overrides
 * it with ctx.agentRole.
 */

import { postJson } from './api-client.js'
import type { ToolCallContext } from './tools.js'

export const ORCHESTRATOR_TOOL_DEFINITIONS = [
  {
    name: 'notify_agent',
    description:
      'Send a directed message to another agent (CD, WebDev, Sentinel Ti, ' +
      'Jedi Code). The target reads it via agent_inbox() on their next turn. ' +
      'Use this instead of asking the user to relay information between ' +
      'agents.\n\n' +
      'Target syntax (Commit 1+, 2026-05-01):\n' +
      '  • "<role>"             — fan-out to every live instance of that role\n' +
      '  • "<role>:<instance>"  — sticky to that specific instance (only ' +
      'allowed for verified replies between same-role peers)\n\n' +
      'Threading (Commit 2): if you JUST drained an inbox message from the ' +
      'target role this turn, the bus auto-fills `replyTo` with that ' +
      'message\'s id. Replies route stickily to the originator — no ' +
      'cross-instance leakage. Pass `replyTo: null` to declare a fresh thread, ' +
      'or `replyTo: "<id>"` to override and reply to a specific message.\n\n' +
      'Permission table: CD ↔ Jedi Code is bidirectional; WebDev and Sentinel ' +
      'Ti can notify CD/Jedi Code; Jedi Code can notify any agent.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description:
            'Either "<role>" or "<role>:<instanceId>". Roles: cd, webdev, ' +
            'sentinel, jedi-code. Instance form is for verified replies only.',
        },
        message: {
          type: 'string',
          description: 'Free-form message text. The receiver\'s reasoning loop interprets it.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          description: 'Default `normal`. `high` means "address before lower-priority work".',
        },
        replyTo: {
          type: ['string', 'null'],
          description:
            'Parent message id. Three-state: omit to auto-fill from your most ' +
            'recent inbox drain (per-sender-role); pass null to declare a ' +
            'fresh thread; pass an explicit id to override.',
        },
      },
      required: ['target', 'message'],
    },
  },
  {
    name: 'agent_inbox',
    description:
      'Drain + return your pending messages from other agents. Returns up to ' +
      'all messages currently queued, sorted by priority then oldest-first. ' +
      'After this call your inbox is empty until new messages arrive. Per the ' +
      'BOOT SEQUENCE, call this at the start of every turn before responding ' +
      'to the user — peer-agent messages are part of your context.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'agent_status',
    description:
      'Read-only status of another agent: pending inbox count + last seen ' +
      'timestamp. Useful before notify_agent to check whether the target is ' +
      'active. Does NOT drain the target\'s inbox; only your own ' +
      'agent_inbox() does that.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['cd', 'webdev', 'sentinel', 'jedi-code'],
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'claim_orphan',
    description:
      'Claim an orphan message — a message addressed to a peer instance of ' +
      'your role that\'s no longer connected (e.g., a Claude Code window ' +
      'closed before its question was answered). Orphans appear in your ' +
      'agent_inbox() output with an `originallyFor` field. If you have ' +
      'context to handle one, call `claim_orphan({messageId})` to atomically ' +
      'take ownership — the orphan moves from the role-level orphan queue ' +
      'into your inbox (next drain returns it as a normal message). First ' +
      'claimer wins; subsequent claims for the same id return an error. ' +
      'If you DON\'T have context, ignore the orphan — some other peer ' +
      'instance (or no one) will claim it. Do NOT escalate to the user via ' +
      'snackbar by default; that produces noise scaling with instance count.',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: {
          type: 'string',
          description: 'The id of the orphan message to claim (from agent_inbox).',
        },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'thread_history',
    description:
      'Read the full chronological message list for a thread by threadId. ' +
      'After a drain, prior messages are gone from your inbox — but their ' +
      'records (with full bodies) are retained in the bus\'s messageLog. ' +
      'Use this to reconstruct multi-turn conversations: pass the threadId ' +
      'shown next to any message in agent_inbox output (`thread=<id>`). ' +
      'Returns every message in the thread for the current session, sorted ' +
      'oldest-first. Read-only; safe to call any time.',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: {
          type: 'string',
          description: 'The thread id to fetch. From any message\'s `thread=` field.',
        },
      },
      required: ['threadId'],
    },
  },
  {
    name: 'replay_events',
    description:
      'Drain events from this session\'s ring buffer. Use this on the FIRST ' +
      'turn after a respawn (e.g., after Order 66) to recover notifications ' +
      'that fired while your bridge was dead — `vibe_built`, `image_ready`, ' +
      '`director_save`, snackbar pushes, etc. Buffer holds the last 100 events ' +
      'per session. Pass `sinceTs` (ISO timestamp) to get only events newer ' +
      'than that; omit to get everything in the buffer. ' +
      '\n\n' +
      'Why this exists: live notifications from the orchestrator (sent via ' +
      'MCP `sendLoggingMessage`) require an open GET stream to land. After a ' +
      'respawn, your fresh transport may race the stream-open window and ' +
      'miss the first batch. `replay_events()` is the deterministic catch-up ' +
      'tool — it\'s synchronous, no transport timing involved.',
    inputSchema: {
      type: 'object',
      properties: {
        sinceTs: {
          type: 'string',
          description:
            'Optional ISO timestamp. Returns only events with `ts > sinceTs`. ' +
            'Useful for incremental polling: pass the latest `ts` you\'ve already seen.',
        },
      },
    },
  },
] as const

export type OrchestratorToolName = (typeof ORCHESTRATOR_TOOL_DEFINITIONS)[number]['name']

export async function callOrchestratorTool(
  name: OrchestratorToolName,
  args: Record<string, unknown>,
  ctx: ToolCallContext,
): Promise<{ text: string; isError: boolean }> {
  const sessionId = ctx.sessionId
  const instanceId = ctx.instanceId
  if (!sessionId) return { text: 'sessionId missing from tool context', isError: true }
  if (!instanceId) return { text: 'instanceId missing from tool context', isError: true }

  switch (name) {
    case 'notify_agent': {
      const target = String(args.target || '').trim()
      const message = String(args.message || '').trim()
      const priority = (args.priority as string) || 'normal'
      // replyTo three-state: undefined → auto-fill in bus; null → fresh
      // thread; string → explicit parent. JSON.stringify preserves the
      // distinction across the wire by including/omitting the field.
      const replyToArg = (() => {
        if (!('replyTo' in args)) return undefined
        if (args.replyTo === null) return null
        if (typeof args.replyTo === 'string') return args.replyTo
        return undefined
      })()
      if (!target) return { text: 'Error: `target` is required', isError: true }
      if (!message) return { text: 'Error: `message` is required', isError: true }
      const r = await postJson<{
        ok: boolean
        messageId?: string
        threadId?: string
        delivered?: number
        error?: string
      }>('/api/mcp/notify-agent', {
        sessionId,
        from: ctx.agentRole, // Identity from context, not from args
        fromInstance: instanceId,
        target,
        message,
        priority,
        replyTo: replyToArg,
      })
      if (!r.ok) return { text: r.error || 'notify_agent failed', isError: true }
      if (r.body?.error) return { text: r.body.error, isError: true }
      const fanoutNote = r.body?.delivered && r.body.delivered > 1
        ? ` (fan-out: ${r.body.delivered} live instances)`
        : ''
      const threadNote = r.body?.threadId ? `, thread=${r.body.threadId.slice(0, 8)}` : ''
      return {
        text:
          `notify_agent → ${target}: queued ` +
          `(messageId=${r.body?.messageId}${threadNote})${fanoutNote}`,
        isError: false,
      }
    }

    case 'agent_inbox': {
      const r = await postJson<{
        messages: {
          id: string
          from: string
          fromInstance: string
          message: string
          priority: string
          sentAt: string
          threadId?: string
          replyTo?: string | null
          originallyFor?: { role: string; instanceId: string | null }
        }[]
        count: number
        error?: string
      }>('/api/mcp/agent-inbox', { sessionId, agent: ctx.agentRole, instanceId })
      if (!r.ok) return { text: r.error || 'agent_inbox failed', isError: true }
      if (r.body?.error) return { text: r.body.error, isError: true }
      const msgs = r.body?.messages || []
      if (msgs.length === 0) {
        return { text: '(inbox empty — no pending messages from other agents)', isError: false }
      }
      const lines = msgs.map((m) => {
        const thread = m.threadId ? `, thread=${m.threadId.slice(0, 8)}` : ''
        const reply = m.replyTo ? `, replyTo=${m.replyTo.slice(0, 8)}` : ''
        const orphanTag = (m as { originallyFor?: { role: string; instanceId: string | null } })
          .originallyFor
          ? ` [ORPHAN — originallyFor=${(m as any).originallyFor.role}` +
            ((m as any).originallyFor.instanceId
              ? `:${((m as any).originallyFor.instanceId as string).slice(0, 8)}`
              : '') +
            '. Call claim_orphan(messageId) to take ownership]'
          : ''
        return (
          `[${m.priority}] ${m.from}:${m.fromInstance.slice(0, 8)} ` +
          `@ ${m.sentAt} (id=${m.id}${thread}${reply})${orphanTag}: ${m.message}`
        )
      })
      return { text: lines.join('\n---\n'), isError: false }
    }

    case 'thread_history': {
      const threadId = String(args.threadId || '').trim()
      if (!threadId) return { text: 'Error: `threadId` is required', isError: true }
      const r = await postJson<{
        messages: {
          id: string
          threadId: string
          from: string
          fromInstance: string
          message: string
          priority: string
          sentAt: string
          replyTo: string | null
        }[]
        count: number
        error?: string
      }>('/api/mcp/thread-history', { sessionId, threadId })
      if (!r.ok) return { text: r.error || 'thread_history failed', isError: true }
      if (r.body?.error) return { text: r.body.error, isError: true }
      const msgs = r.body?.messages || []
      if (msgs.length === 0) {
        return {
          text: `(thread ${threadId.slice(0, 8)} has no messages in this session)`,
          isError: false,
        }
      }
      const lines = msgs.map((m) => {
        const reply = m.replyTo ? `, replyTo=${m.replyTo.slice(0, 8)}` : ''
        return (
          `[${m.priority}] ${m.from}:${m.fromInstance.slice(0, 8)} ` +
          `@ ${m.sentAt} (id=${m.id.slice(0, 8)}${reply}): ${m.message}`
        )
      })
      return {
        text:
          `Thread ${threadId.slice(0, 8)} — ${msgs.length} message(s):\n` +
          lines.join('\n---\n'),
        isError: false,
      }
    }

    case 'claim_orphan': {
      const messageId = String(args.messageId || '').trim()
      if (!messageId) return { text: 'Error: `messageId` is required', isError: true }
      const r = await postJson<{ ok: boolean; error?: string }>(
        '/api/mcp/claim-orphan',
        {
          sessionId,
          claimer: ctx.agentRole,
          claimerInstance: instanceId,
          messageId,
        },
      )
      if (!r.ok) return { text: r.error || 'claim_orphan failed', isError: true }
      if (r.body?.error) return { text: r.body.error, isError: true }
      return {
        text:
          `claim_orphan: ${messageId} — ownership transferred to ` +
          `${ctx.agentRole}:${instanceId.slice(0, 8)}. ` +
          'Next agent_inbox() will return it as a normal drained message.',
        isError: false,
      }
    }

    case 'replay_events': {
      const sinceTs = typeof args.sinceTs === 'string' ? args.sinceTs : undefined
      const r = await postJson<{
        events: { type: string; ts: string; [k: string]: unknown }[]
        count: number
        error?: string
      }>('/api/mcp/replay-events', { sessionId, sinceTs })
      if (!r.ok) return { text: r.error || 'replay_events failed', isError: true }
      if (r.body?.error) return { text: r.body.error, isError: true }
      const events = r.body?.events || []
      if (events.length === 0) {
        return { text: '(no events to replay)', isError: false }
      }
      // Return the events as JSON so the agent can parse and act on each.
      return { text: JSON.stringify({ events, count: events.length }, null, 2), isError: false }
    }

    case 'agent_status': {
      // For v1 we only surface the inbox count — last-seen tracking can come
      // later. Same /api/mcp/agent-inbox call but without draining (peek mode).
      // Implementing a peek endpoint for v1 is overkill; respond with what
      // we know.
      const target = String(args.target || '').trim()
      if (!target) return { text: 'Error: `target` is required', isError: true }
      // No HTTP call — agent_status is informational. Return a stub that
      // tells the caller to use agent_inbox + notify_agent for real coordination.
      return {
        text:
          `agent_status: v1 only surfaces inbox-count for the calling agent (use agent_inbox for that). ` +
          `Cross-agent peek will land in v2 — for now, send a notify_agent({target:"${target}", priority:"low"}) ping ` +
          `and watch for a reply in your inbox if the agent is active.`,
        isError: false,
      }
    }

    default:
      return { text: `Unknown orchestrator tool: ${name as string}`, isError: true }
  }
}
