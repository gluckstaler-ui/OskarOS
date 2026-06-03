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
          enum: ['cd', 'webdev', 'sentinel', 'jedi-code', 'consular'],
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
    name: 'build_wireframes',
    description:
      'Phase 2 build for webpages. Fires N wireframes (one per slug passed) ' +
      'derived solely from Discovery + the Pass-1 Reasoning section in each ' +
      'vibe-{n}-{slug}.md spec (no school anchor; subject-matched SVG ' +
      'placeholders). Same fire-and-forget contract as build_vibe — returns ' +
      'immediately with one jobId per slug, then CD polls job_status(jobId) ' +
      'for completion. Backend wiring is a separate WP.',
    inputSchema: {
      type: 'object',
      properties: {
        slugs: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Vibe slugs to build wireframes for. Each slug references an ' +
            'existing vibe-{n}-{slug}.md spec in the current session. ' +
            'Example: ["vibe-1-grandmas-cliff", "vibe-2-decompression-chamber", "vibe-3-the-deployment"]. ' +
            'WebDev reads each spec end-to-end and renders one HTML wireframe per slug.',
        },
      },
      required: ['slugs'],
    },
  },
  {
    name: 'tc_design_directions',
    description:
      'Present 6 strategic bets at the end of Phase 1 Discovery / start of Phase 2. ' +
      'User picks 4 to keep, kills 2. The 4 picks become the slugs passed to ' +
      'build_wireframes. Each tile renders a Convention↔Disruption axis, the ' +
      'bet name in the display font, the bet description in the body font, the ' +
      'audience line, palette strip with role labels, and a mutex block. ' +
      'Response arrives as a user message with { picks, kill_why, survivors, killed }. ' +
      'Shape mirrors docs/tc-design-directions-mockup.html.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Session slug.' },
        directions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string', description: 'Stable id, e.g. "bet-1".' },
              filename: { type: 'string', description: 'vibe-x.md filename this bet seeds, e.g. "vibe-1-hospitality.md".' },
              bet_name: { type: 'string', description: 'The wager — e.g. "The Hospitality Play". NOT a school name.' },
              bet_audience: { type: 'string', description: 'One sentence describing the audience this bet filters for.' },
              axis_linear: {
                type: 'object',
                description: 'Convention↔Disruption spectrum with a 0..1 marker.',
                properties: {
                  poles: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '[Convention-pole label, Disruption-pole label]. Usually ["Convention","Disruption"].',
                  },
                  position: {
                    type: 'number',
                    description: '0..1 — marker position. 0 = pure Convention, 1 = pure Disruption.',
                  },
                },
                required: ['poles', 'position'],
              },
              axis_hook: {
                type: 'string',
                description: 'Warmth | Pride | Nostalgia | Exclusivity | Humor. Model-only; not rendered on the tile.',
              },
              the_bet: {
                type: 'string',
                description: 'What becomes true if this wager wins. One-two sentences in the bet\'s body voice.',
              },
              mutex: {
                type: 'string',
                description: 'What UNIQUELY differentiates this bet from the other five. The mutually-exclusive check.',
              },
              palette: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    hex: { type: 'string' },
                    role: { type: 'string', description: 'Short role label, e.g. "Cream", "Cedar", "Ink".' },
                  },
                  required: ['hex', 'role'],
                },
                description: 'Exactly 4 swatches.',
              },
              fonts: {
                type: 'object',
                properties: {
                  display: { type: 'string', description: 'CSS font-family value, e.g. \'Playfair Display\' or \'"Space Mono", monospace\'.' },
                  display_label: { type: 'string', description: 'Short label, e.g. "Playfair Display" or "Manrope (Söhne-like)".' },
                  body: { type: 'string' },
                  body_label: { type: 'string' },
                },
                required: ['display', 'display_label', 'body', 'body_label'],
              },
            },
            required: ['slug', 'bet_name', 'the_bet', 'mutex', 'palette', 'fonts', 'axis_linear'],
          },
          description: 'Exactly 6 strategic bets.',
        },
        preamble: {
          type: 'object',
          description: 'CD-speaking preamble — the cyan-bordered callout above the bet grid.',
          properties: {
            label: { type: 'string', description: 'Mono-caps role tag — e.g. "CD speaking · why six".' },
            body: { type: 'string', description: 'Prose explanation of the bet set — what axes pivot, why these six. 2-4 sentences.' },
          },
          required: ['label', 'body'],
        },
        prompt: {
          type: 'string',
          description: '@deprecated — flat-string preamble. Use `preamble: {label, body}` instead.',
        },
      },
      required: ['slug', 'directions'],
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
  // ──────────────────────────────────────────────────────────────────────
  // WP-68 — User-impersonation tools (test-agent allowlist only)
  // ──────────────────────────────────────────────────────────────────────
  // These are the ONLY tools that mint `from: 'user'` against the agent
  // bus. Production agents (CD, WebDev, Sentinel, Jedi-Code) MUST NOT have
  // these in their `--allowed-tools` lists. Whitelist on the test agent
  // (COO Claude) only.
  //
  // Why MCP, not curl-from-Bash: permission gating + semantic discipline.
  // `notify_agent`'s permission table is agent-to-agent only — no "user"
  // entry. The HTTP `/api/mcp/notify-agent` route accepts `from: 'user'`
  // (page.tsx:2419 pushUserMessageToCD uses it directly) but no MCP tool
  // exposes that capability with allowlist gating until now.
  {
    name: 'send_user_input',
    description:
      'TEST-AGENT TOOL — impersonate the user sending input to CD. ' +
      'NEVER available to production agents.\n\n' +
      'Two modes:\n' +
      '  • mode: "chat"       — POST to /api/chat-stream as the user; ' +
      'turn-initiating; blocks until CD finishes and SSE stream ends. ' +
      'Returns the final text + cards CD fired + jobs CD started during ' +
      'the turn.\n' +
      '  • mode: "inbox-note" — POST to /api/mcp/notify-agent with ' +
      'from:"user", target:"cd"; non-blocking; CD picks it up at the start ' +
      'of its NEXT turn via agent_inbox(). Use this for between-turn ' +
      'signals while CD is mid-stream — same channel page.tsx ' +
      'pushUserMessageToCD uses today.\n\n' +
      'The `from: "user"` tag is enforced server-side by this tool. The ' +
      'calling agent cannot fake a different identity. Whitelist gates ' +
      'WHO can invoke; the route gates WHAT the invocation says.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'OskarOS session id (e.g. "2026-01-27-debug"). The session must already exist; use start_session via /api/test-backdoor to create one.',
        },
        message: {
          type: 'string',
          description: 'The user message text. For card responses (discovery questions, design directions), format as a normal user reply — CD reads this just like a typed chat message.',
        },
        mode: {
          type: 'string',
          enum: ['chat', 'inbox-note'],
          description: '"chat" for turn-initiating messages (blocks ~30-60s for CD turn); "inbox-note" for between-turn signals (returns ~50ms).',
        },
        attachments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Filenames already uploaded via /api/test-backdoor upload_image. The chat-stream sees these as sourceImages.',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          description: 'Inbox-note mode only. Default "high" for user impersonation (matches page.tsx pushUserMessageToCD behavior).',
        },
      },
      required: ['sessionId', 'message', 'mode'],
    },
  },
  {
    name: 'respond_to_card',
    description:
      'TEST-AGENT TOOL — resolve a user-action card CD fired. NEVER ' +
      'available to production agents.\n\n' +
      'Cards split into two resolution paths:\n' +
      '  • ask_user cards — Promise-based; resolves via ' +
      '/api/mcp/ask-user-response/[requestId]. Use type:"ask_user" with the ' +
      'requestId you saw in cardsFired[] of the prior send_user_input ' +
      'response.\n' +
      '  • All other cards (discovery_questions, design_directions, ' +
      'confirm_understanding, image_prompt, image_verdict, ' +
      'descent_selection) — user response is a normal chat message; this ' +
      'tool formats the response and dispatches via send_user_input(' +
      'mode:"chat") under the hood. CD reads it as a regular user reply ' +
      'next turn.\n\n' +
      'The discriminated union on `response` catches dispatch-shape errors ' +
      'at the tool boundary instead of at silent runtime failure. Sending ' +
      '`{type:"image_prompt", verdict:"approve"}` (verdict belongs on ' +
      'image_verdict) fails validation here, not after the message lands.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'OskarOS session id.' },
        requestId: {
          type: 'string',
          description: 'For ask_user cards only — the requestId from cardsFired[]. Other card types ignore this field.',
        },
        response: {
          type: 'object',
          description:
            'Discriminated union by `type`:\n' +
            '  • {type:"ask_user", choice: string}\n' +
            '  • {type:"discovery_questions", answers: string[], freeformText?: string}\n' +
            '  • {type:"design_directions", picks: string[], freeformText?: string}\n' +
            '  • {type:"confirm_understanding", action: "commit" | "discuss"}\n' +
            '  • {type:"image_prompt", prompt: string, action: "approve" | "modify" | "reject"}\n' +
            '  • {type:"image_verdict", verdict: "approve" | "reject" | "regenerate", notes?: string}\n' +
            '  • {type:"descent_selection", picks: string[]}',
          properties: {
            type: {
              type: 'string',
              enum: [
                'ask_user',
                'discovery_questions',
                'design_directions',
                'confirm_understanding',
                'image_prompt',
                'image_verdict',
                'descent_selection',
              ],
            },
          },
          required: ['type'],
        },
      },
      required: ['sessionId', 'response'],
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

    case 'tc_design_directions': {
      // Doctrine: Design Directions are TRACK-AGNOSTIC. Never re-add a
      // `track` field here — see INSTITUTIONAL-MEMORY.md "Doctrine drift:
      // track grafted onto tc_design_directions (2nd time)" 2026-05-14.
      const slug = String(args.slug || '').trim()
      const directions = Array.isArray(args.directions) ? args.directions : []
      if (!slug || directions.length === 0) {
        return { text: 'Error: slug and non-empty directions are required', isError: true }
      }
      const r = await postJson<{ ok: boolean; directionCount?: number; error?: string }>(
        '/api/mcp/present-design-directions',
        { sessionId, slug, directions, prompt: args.prompt, preamble: args.preamble },
      )
      if (!r.ok) return { text: `tc_design_directions failed: ${r.error}`, isError: true }
      if (r.body?.error) return { text: `tc_design_directions error: ${r.body.error}`, isError: true }
      return {
        text:
          `Design Directions card surfaced (${r.body?.directionCount ?? directions.length} candidates). ` +
          `Wait for the user's response — it arrives as a user message with { picks, freeformText }.`,
        isError: false,
      }
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

    case 'send_user_input': {
      // WP-68. Test-agent allowlist only. The tool mints `from: 'user'`
      // server-side; the calling agent's identity (ctx.agentRole) is NOT
      // propagated as the inbox `from` field — that's the whole point of
      // user-impersonation. Permission gating is via --allowed-tools, not
      // via runtime role-check (the agent has the tool ⟹ it's authorized).
      const message = String(args.message || '').trim()
      const mode = String(args.mode || '').trim()
      const attachments = Array.isArray(args.attachments)
        ? (args.attachments as unknown[]).map((a) => String(a || '').trim()).filter(Boolean)
        : []
      const priority = (args.priority as string) || 'high'
      if (!message) return { text: 'Error: `message` is required', isError: true }
      if (mode !== 'chat' && mode !== 'inbox-note') {
        return { text: 'Error: `mode` must be "chat" or "inbox-note"', isError: true }
      }

      if (mode === 'inbox-note') {
        // Between-turn signal — non-blocking. Hits the same notify-agent
        // route page.tsx:2419 pushUserMessageToCD uses, with from='user'.
        const r = await postJson<{
          ok: boolean
          messageId?: string
          error?: string
        }>('/api/mcp/notify-agent', {
          sessionId,
          from: 'user',
          // fromInstance is the impersonation source; tag it as "test-backdoor"
          // so cd-side audit can distinguish UI-typed from agent-impersonated
          // input if it ever wants to.
          fromInstance: `test-backdoor-${instanceId}`,
          target: 'cd',
          message,
          priority,
          replyTo: null,
        })
        if (!r.ok) return { text: r.error || 'send_user_input(inbox-note) failed', isError: true }
        if (r.body?.error) return { text: r.body.error, isError: true }
        return {
          text: `send_user_input → cd inbox: queued (messageId=${r.body?.messageId})`,
          isError: false,
        }
      }

      // mode === 'chat' — turn-initiating; blocks on SSE stream completion.
      // We POST to /api/chat-stream with the same body shape the UI uses.
      // Since SSE is a long-lived stream, we drain it inside this tool and
      // return a structured summary. The agent doesn't see raw SSE chunks.
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
      try {
        const streamRes = await fetch(`${baseUrl}/api/chat-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            // Minimal payload — chat-stream resolves the full message
            // history from SESSION.md when this is set.
            messages: [{ role: 'user', content: message }],
            sourceImages: attachments.map((filename) => ({ filename })),
            isResume: false,
          }),
        })
        if (!streamRes.ok || !streamRes.body) {
          return {
            text: `send_user_input(chat) failed: HTTP ${streamRes.status}`,
            isError: true,
          }
        }
        // Drain the SSE stream, collecting events.
        const reader = streamRes.body.getReader()
        const decoder = new TextDecoder()
        let finalText = ''
        const cardsFired: { requestId: string; type: string }[] = []
        const jobsStarted: { jobId: string; kind: string }[] = []
        const eventLog: { type: string }[] = []
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const payload = line.slice(6).trim()
            if (!payload || payload === '[heartbeat]') continue
            try {
              const evt = JSON.parse(payload) as { type?: string; [k: string]: unknown }
              if (evt.type) eventLog.push({ type: evt.type })
              // Capture ask_user-style cards (Promise-resolved via ask-user-response)
              if (evt.type === 'cd_ask_user' && typeof evt.requestId === 'string') {
                cardsFired.push({ requestId: evt.requestId, type: 'ask_user' })
              }
              // Capture event-bus cards (resolved via chat reply)
              for (const cardType of [
                'discovery_questions',
                'design_directions',
                'confirm_understanding',
                'image_prompt',
                'image_verdict',
                'descent_selection',
              ]) {
                if (evt.type === cardType) {
                  cardsFired.push({
                    requestId: typeof evt.requestId === 'string' ? evt.requestId : '',
                    type: cardType,
                  })
                }
              }
              // Capture jobs.
              if (evt.type === 'build_started' && typeof evt.jobId === 'string') {
                jobsStarted.push({ jobId: evt.jobId, kind: String(evt.kind || 'build') })
              }
              // Final text accumulates from text deltas + done event.
              if (evt.type === 'text' && typeof evt.content === 'string') {
                finalText += evt.content
              }
              if (evt.type === 'done' && typeof evt.finalText === 'string' && !finalText) {
                finalText = evt.finalText
              }
            } catch {
              // Non-JSON SSE line — ignore (heartbeats, comments, etc.)
            }
          }
        }
        // Ralph 2026-05-10 (COO test harness): mirror the user prompt +
        // assistant reply onto /api/events so the browser's chat panel
        // shows MCP-injected turns. The chat-stream's response chunks
        // are consumed only by this proxy; without this echo the browser
        // sees nothing for MCP-driven test runs.
        try {
          await postJson('/api/mcp/echo-chat', {
            sessionId,
            userText: message,
            assistantText: finalText,
          })
        } catch {
          // Best-effort — never fail the tool just because the echo
          // didn't land. The MCP caller still gets the finalText below.
        }
        return {
          text: JSON.stringify(
            {
              mode: 'chat',
              finalText,
              cardsFired,
              jobsStarted,
              eventCount: eventLog.length,
            },
            null,
            2,
          ),
          isError: false,
        }
      } catch (err) {
        return {
          text: `send_user_input(chat) error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        }
      }
    }

    case 'respond_to_card': {
      // WP-68. Test-agent allowlist only. Dispatches by response.type:
      //  - ask_user → POST /api/mcp/ask-user-response/[requestId] (Promise resolver)
      //  - all others → format as user message + send_user_input(chat) under the hood
      const requestId = String(args.requestId || '').trim()
      const response = args.response as Record<string, unknown> | undefined
      if (!response || typeof response !== 'object') {
        return { text: 'Error: `response` object is required', isError: true }
      }
      const type = String(response.type || '').trim()
      if (!type) return { text: 'Error: `response.type` is required', isError: true }

      // ask_user — Promise resolver
      if (type === 'ask_user') {
        if (!requestId) {
          return { text: 'Error: `requestId` required for type:"ask_user"', isError: true }
        }
        const choice = String(response.choice || '').trim()
        if (!choice) return { text: 'Error: `response.choice` required', isError: true }
        const r = await postJson<{ ok: boolean; error?: string }>(
          `/api/mcp/ask-user-response/${encodeURIComponent(requestId)}`,
          { value: choice },
        )
        if (!r.ok) return { text: r.error || 'respond_to_card(ask_user) failed', isError: true }
        if (r.body?.error) return { text: r.body.error, isError: true }
        return { text: `respond_to_card(ask_user) delivered: requestId=${requestId}`, isError: false }
      }

      // Other card types → format as chat message and dispatch via send_user_input
      let formattedMessage = ''
      switch (type) {
        case 'discovery_questions': {
          const answers = Array.isArray(response.answers)
            ? (response.answers as unknown[]).map((a) => String(a || '').trim())
            : []
          if (answers.length === 0) {
            return { text: 'Error: `response.answers` (non-empty array) required', isError: true }
          }
          formattedMessage = answers.map((a, i) => `${i + 1}. ${a}`).join('\n\n')
          if (typeof response.freeformText === 'string' && response.freeformText.trim()) {
            formattedMessage += `\n\n${response.freeformText.trim()}`
          }
          break
        }
        case 'design_directions': {
          const picks = Array.isArray(response.picks)
            ? (response.picks as unknown[]).map((p) => String(p || '').trim())
            : []
          if (picks.length === 0) {
            return { text: 'Error: `response.picks` (non-empty array) required', isError: true }
          }
          formattedMessage = `I pick: ${picks.join(', ')}.`
          if (typeof response.freeformText === 'string' && response.freeformText.trim()) {
            formattedMessage += ` ${response.freeformText.trim()}`
          }
          break
        }
        case 'confirm_understanding': {
          const action = String(response.action || '').trim()
          if (action !== 'commit' && action !== 'discuss') {
            return { text: 'Error: `response.action` must be "commit" or "discuss"', isError: true }
          }
          formattedMessage = action === 'commit'
            ? 'Yes, that summary is right. Build it.'
            : 'Let\'s discuss before building.'
          break
        }
        case 'image_prompt': {
          const prompt = String(response.prompt || '').trim()
          const action = String(response.action || '').trim()
          if (!prompt) return { text: 'Error: `response.prompt` required', isError: true }
          if (action !== 'approve' && action !== 'modify' && action !== 'reject') {
            return { text: 'Error: `response.action` must be approve|modify|reject', isError: true }
          }
          formattedMessage =
            action === 'approve'
              ? `Approved prompt: ${prompt}`
              : action === 'modify'
                ? `Modified prompt: ${prompt}`
                : `Rejecting that direction. Try: ${prompt}`
          break
        }
        case 'image_verdict': {
          const verdict = String(response.verdict || '').trim()
          if (verdict !== 'approve' && verdict !== 'reject' && verdict !== 'regenerate') {
            return {
              text: 'Error: `response.verdict` must be approve|reject|regenerate',
              isError: true,
            }
          }
          const notes = typeof response.notes === 'string' ? response.notes.trim() : ''
          formattedMessage =
            verdict === 'approve'
              ? `Approved.${notes ? ' ' + notes : ''}`
              : verdict === 'reject'
                ? `Rejected.${notes ? ' Notes: ' + notes : ''}`
                : `Please regenerate.${notes ? ' Notes: ' + notes : ''}`
          break
        }
        case 'descent_selection': {
          const picks = Array.isArray(response.picks)
            ? (response.picks as unknown[]).map((p) => String(p || '').trim())
            : []
          if (picks.length === 0) {
            return { text: 'Error: `response.picks` (non-empty array) required', isError: true }
          }
          formattedMessage =
            picks.length === 1
              ? `My pick: ${picks[0]}.`
              : `My picks: ${picks.join(', ')}.`
          break
        }
        default:
          return {
            text: `Error: unknown response.type "${type}". Valid: ask_user, discovery_questions, design_directions, confirm_understanding, image_prompt, image_verdict, descent_selection`,
            isError: true,
          }
      }

      // Dispatch the formatted message via the same chat-stream path as
      // send_user_input(chat). Reuse the implementation by recursing
      // through the orchestrator dispatcher.
      return await callOrchestratorTool(
        'send_user_input' as OrchestratorToolName,
        { sessionId, message: formattedMessage, mode: 'chat' },
        ctx,
      )
    }

    // ─────────────────────────────────────────────────────────────────────
    // Phase 2 build dispatch (Ralph 2026-05-10 — WP-69 backend wiring).
    // build_wireframes lives in the orchestrator-tool surface (not tools-cd)
    // because Phase 2 wireframes are CD-fired but conceptually align with
    // the orchestrator's other multi-job dispatch tools (notify_agent /
    // claim_orphan also enqueue work into other agents' lanes).
    // ─────────────────────────────────────────────────────────────────────
    case 'build_wireframes': {
      const slugs = Array.isArray(args.slugs)
        ? (args.slugs as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : []
      if (slugs.length === 0) {
        return { text: 'Error: `slugs` must be a non-empty array of vibe-slug strings', isError: true }
      }
      const r = await postJson<{
        slugCount: number
        jobs?: { jobId: string; target: string; status: string; deduped?: boolean; originalStartedAt?: string }[]
        error?: string
      }>('/api/mcp/build-wireframes', { sessionId, slugs })
      if (!r.ok) return { text: r.error || 'build_wireframes failed', isError: true }
      if (Array.isArray(r.body?.jobs) && r.body.jobs.length > 0) {
        const lines = r.body.jobs.map((j) => {
          const dedupNote = j.deduped ? ` (deduped, since ${j.originalStartedAt})` : ''
          return `  - ${j.target}: jobId=${j.jobId}${dedupNote}`
        })
        return {
          text:
            `build_wireframes enqueued ${r.body.slugCount} wireframe(s). Per-slug jobIds:\n` +
            lines.join('\n') +
            `\nPoll job_status(jobId) for each; do other work between polls.`,
          isError: false,
        }
      }
      return { text: `build_wireframes error: ${r.body?.error || 'unknown'}`, isError: true }
    }

    default:
      return { text: `Unknown orchestrator tool: ${name as string}`, isError: true }
  }
}
