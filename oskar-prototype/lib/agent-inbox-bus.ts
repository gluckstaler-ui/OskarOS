/**
 * agent-inbox-bus.ts — directed messaging between agents (Phase 3, 2026-04-30).
 *
 * Replaces "Ralph as the message bus" with a typed, polled inbox per agent.
 * CD, Jedi Code, WebDev, Sentinel Ti are all MCP clients of the orchestrator;
 * each has its own queue. `notify_agent(target, message)` enqueues onto the
 * target's queue; `agent_inbox()` drains the calling agent's queue.
 *
 * Polling is the contract:
 * - MCP `sendLoggingMessage` push notifications exist in the protocol but
 *   the Claude clients don't reliably surface them as model-context updates
 *   (proven during the Phase 2 image_ready notification debugging).
 * - Both CD and Jedi Code call `agent_inbox()` at the start of every turn
 *   per their boot rules.
 *
 * State pinned to globalThis (same pattern as event-bus, ask-user-bus,
 * build-escrow). Lost on Next.js process restart; messages enqueued during
 * a restart gap are lost. For durability we'd persist to disk — out of
 * scope for v1.
 *
 * ── Commit 1 (2026-05-01): instance-aware addressing ──────────────────────
 * Pre-Commit-1, the queue was keyed by (sessionId, role). Multiple clients
 * of the same role (e.g., two Jedi Code windows) shared one queue, and
 * `drainInbox` deletes on read → first-poller-wins → silent message loss.
 * Fix: queue keyed by (sessionId, role, instanceId). Each client gets its
 * own private queue. Role-only fan-out delivers to every live instance.
 * The HTTP transport route mints a "legacy-{session}-{role}" instance id
 * for clients that don't pass one, so old configs still work.
 *
 * ── Commit 2 (2026-05-01): threading + auto-replyTo + sticky-reply ────────
 * Adds messageId / threadId / replyTo / originator to every message, plus
 * a side-store of all message records so replies can resolve their parent
 * after drain. Auto-replyTo lives in the bus (not the proxy) — drainInbox
 * updates a per-(instance × sender-role) lastSeen map, and notify_agent
 * fills replyTo from it when the caller didn't pass one. This means:
 *   1. Agents don't manage threading flags. The bus does.
 *   2. Per-role auto-fill (Gap 2 fix): draining mixed senders doesn't cause
 *      a CD-bound reply to inherit a WebDev-message id.
 *   3. Sticky-reply only fires when target.role === parent.originator.role
 *      (Gap 1 fix): replying to CD's message but addressed to WebDev becomes
 *      fan-out, with replyTo recorded for thread tracking only.
 *   4. Permission table sharpens: same-role specific-instance notify is
 *      allowed only when replyTo verifies (parent exists, parent role +
 *      instance match).
 *
 * Routing rules (Commit 2):
 *   - target = `<role>:<instance>`         → sticky to that instance
 *   - target = `<role>` AND replyTo set
 *     AND parent.originator.role === target → sticky to parent's originator
 *                                              instance (sticky-reply)
 *   - target = `<role>` AND replyTo set
 *     AND parent.originator.role !== target → fan-out (replyTo recorded for
 *                                              thread, not routing)
 *   - target = `<role>` AND replyTo null    → fan-out
 *   - 0 live instances on fan-out           → error to sender (Commit 3
 *                                              will replace with orphan
 *                                              hold queue)
 */

import { randomUUID } from 'crypto'

export type AgentRole = 'cd' | 'webdev' | 'sentinel' | 'jedi-code'

export type Priority = 'low' | 'normal' | 'high'

export interface InboxMessage {
  id: string
  /** Who sent this. Set from request header — never from the body. */
  from: AgentRole
  /** Sender's instance id at notify time. */
  fromInstance: string
  /** What the sender wants to convey. Free-form; the receiver's reasoning loop interprets it. */
  message: string
  /** Sender-declared urgency. Receiver can rank/sort by this. */
  priority: Priority
  /** ISO timestamp when notify_agent was called. */
  sentAt: string
  /** Session this message belongs to — agents share sessions, not inboxes. */
  sessionId: string
  /**
   * Long-lived conversation identifier. Auto-assigned to the first message
   * in a chain; inherited by every reply (replyTo's threadId becomes ours).
   * Cross-role hops preserve threadId (so the chain stays observable),
   * even when sticky-reply doesn't apply.
   */
  threadId: string
  /**
   * Parent message id — null for thread roots. Replies set this so the bus
   * can route stickily and so observers can reconstruct the conversation.
   * Auto-filled by the bus from drainInbox's lastSeen map when the caller
   * didn't pass it explicitly.
   */
  replyTo: string | null
  /**
   * Commit 3 (2026-05-01): set when this message is an ORPHAN being shown
   * to a peer instance during agent_inbox(). The original recipient is dead
   * (sticky-target unreachable, OR role-only fan-out had 0 live instances
   * at notify time). Peer instances of the same role see this flag, decide
   * if they have context to handle it, and either:
   *   - call `claim_orphan(id)` → atomic ownership transfer (other peers
   *     stop seeing it on subsequent polls)
   *   - ignore → orphan sits until claimed or session ends
   * Absent on normal drained messages.
   */
  originallyFor?: { role: AgentRole; instanceId: string | null }
}

/**
 * Side-store record for replyTo lookups + thread reconstruction.
 *
 * The full InboxMessage is removed from a queue when drained, so the only
 * way to know "what was message X about" after that point is via this
 * record. Originally (Commit 2) the record only carried the routing
 * essentials (id, threadId, originator, sentAt). Punch-list #2 (CD,
 * 2026-05-01) extended it to carry the full message body + sender
 * metadata so `thread_history(threadId)` can reconstruct a full
 * conversation post-drain. Without body retention, agents reasoning over
 * multi-turn threads go blind because the inbox already drained earlier
 * messages.
 *
 * Memory implication: messageLog grows unbounded over a session lifetime.
 * For the OskarOS workload (a few thousand messages per session, max),
 * this is acceptable. LRU eviction is deferred until profiling shows it
 * matters.
 */
interface MessageRecord {
  id: string
  threadId: string
  originator: { role: AgentRole; instanceId: string }
  sentAt: string
  /** Sender role, redundant with originator.role but easier for callers. */
  from: AgentRole
  /** Full message body — needed for thread_history. */
  message: string
  /** Priority at notify time. Useful for thread observability. */
  priority: Priority
  /** Parent message id, or null for thread roots. */
  replyTo: string | null
  /** Session id, redundant with the map key but cheap and self-describing. */
  sessionId: string
}

// ── Permission table ────────────────────────────────────────────────────────
// `from` agent → set of agents they can notify. Same-role notification is
// banned by default (no self-blast); Commit 2 adds a narrow allowance for
// verified replies inside `notifyAgent` (see permissionAllowsSameRoleReply).

const NOTIFY_PERMISSIONS: Record<AgentRole, Set<AgentRole>> = {
  'cd': new Set(['jedi-code', 'webdev', 'sentinel']),
  'jedi-code': new Set(['cd', 'webdev', 'sentinel']),
  'webdev': new Set(['cd', 'jedi-code']),
  'sentinel': new Set(['cd', 'jedi-code']),
}

export function canNotify(from: AgentRole, target: AgentRole): boolean {
  return NOTIFY_PERMISSIONS[from]?.has(target) ?? false
}

const VALID_ROLES = new Set<AgentRole>(['cd', 'webdev', 'sentinel', 'jedi-code'])

function isRole(v: string): v is AgentRole {
  return VALID_ROLES.has(v as AgentRole)
}

// ── Globally pinned bus state ───────────────────────────────────────────────
//
// Four maps:
//   queues          — per-instance message queue (the inbox)
//   liveInstances   — per (sessionId, role) → set of currently-connected
//                     instance ids; used by role-only fan-out
//   messageLog      — per (sessionId, messageId) → MessageRecord; used to
//                     resolve replyTo's parent after drain
//   lastSeenByRole  — per (sessionId, instanceId) → Map<senderRole, msgId>;
//                     drainInbox updates this; notifyAgent reads from it for
//                     auto-replyTo. Per-role keying is the Gap 2 fix.

interface BusState {
  queues: Map<string, InboxMessage[]>      // key: `${session}|${role}|${instance}`
  liveInstances: Map<string, Set<string>>  // key: `${session}|${role}`
  messageLog: Map<string, MessageRecord>   // key: `${session}|${messageId}`
  lastSeenByRole: Map<string, Map<AgentRole, string>>  // key: `${session}|${instance}`
  /**
   * Commit 3: orphan messages addressed to a dead instance (or to a role
   * with zero live instances at notify time). Visible to every live peer
   * of that role on agent_inbox(); claimed atomically via claim_orphan().
   */
  orphans: Map<string, InboxMessage[]>     // key: `${session}|${role}`
}

const GLOBAL_KEY = Symbol.for('oskar.agent-inbox.state-v4') as unknown as string
const _g = globalThis as Record<string, unknown>
const state: BusState =
  (_g[GLOBAL_KEY] as BusState) ||
  ((_g[GLOBAL_KEY] = {
    queues: new Map<string, InboxMessage[]>(),
    liveInstances: new Map<string, Set<string>>(),
    messageLog: new Map<string, MessageRecord>(),
    lastSeenByRole: new Map<string, Map<AgentRole, string>>(),
    orphans: new Map<string, InboxMessage[]>(),
  }) as BusState)

function queueKey(sessionId: string, agent: AgentRole, instanceId: string): string {
  return `${sessionId}|${agent}|${instanceId}`
}

function liveKey(sessionId: string, agent: AgentRole): string {
  return `${sessionId}|${agent}`
}

function messageLogKey(sessionId: string, messageId: string): string {
  return `${sessionId}|${messageId}`
}

function lastSeenKey(sessionId: string, instanceId: string): string {
  return `${sessionId}|${instanceId}`
}

function orphanKey(sessionId: string, agent: AgentRole): string {
  return `${sessionId}|${agent}`
}

// ── Instance registry ───────────────────────────────────────────────────────

/**
 * Record that this (session, role, instance) tuple is currently connected.
 * Idempotent. Called by the HTTP transport route on every fresh
 * getOrCreateServer invocation. Role-only fan-out delivers a copy to every
 * registered instance of the target role.
 */
export function registerInstance(
  sessionId: string,
  agent: AgentRole,
  instanceId: string,
): void {
  const k = liveKey(sessionId, agent)
  let set = state.liveInstances.get(k)
  if (!set) {
    set = new Set<string>()
    state.liveInstances.set(k, set)
  }
  set.add(instanceId)
}

/**
 * Drop this instance from the live set. Called by the route when the
 * transport closes (clean shutdown OR reconnect race).
 *
 * Note: any messages still queued for this instance remain in the queue
 * map — they'll be drained if the instance reconnects with the SAME
 * instanceId before idle eviction hits. With a fresh instanceId per fork
 * (proxy default), reconnects normally generate a new id, so the old
 * queue's contents become orphaned. Orphan recovery is Commit 3.
 */
export function unregisterInstance(
  sessionId: string,
  agent: AgentRole,
  instanceId: string,
): void {
  const k = liveKey(sessionId, agent)
  const set = state.liveInstances.get(k)
  if (!set) return
  set.delete(instanceId)
  if (set.size === 0) state.liveInstances.delete(k)
}

/** Snapshot of the live instances for a given (session, role). */
export function liveInstancesOf(sessionId: string, agent: AgentRole): string[] {
  const set = state.liveInstances.get(liveKey(sessionId, agent))
  return set ? Array.from(set) : []
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface NotifyResult {
  ok: boolean
  /** Set on success — useful for the sender to log/correlate. */
  messageId?: string
  /** Thread id assigned/inherited. Useful for the sender to track conversations. */
  threadId?: string
  /**
   * Number of instances the message was delivered to. 1 for sticky-target,
   * N for role-only fan-out. Always 0 on error.
   */
  delivered?: number
  /** Permission failures + bad targets surface here. */
  error?: string
}

interface ParsedTarget {
  role: AgentRole
  /** Set if target was `role:instanceId`; null for role-only addressing. */
  instanceId: string | null
}

/**
 * Parse a target string. Accepts:
 *   "cd"                — role-only (fan-out)
 *   "cd:abc-123"        — sticky-target (specific instance)
 * Returns null on bad role.
 */
function parseTarget(target: string): ParsedTarget | null {
  const trimmed = target.trim()
  if (!trimmed) return null
  const colon = trimmed.indexOf(':')
  if (colon < 0) {
    if (!isRole(trimmed)) return null
    return { role: trimmed, instanceId: null }
  }
  const role = trimmed.slice(0, colon)
  const instanceId = trimmed.slice(colon + 1).trim()
  if (!isRole(role)) return null
  if (!instanceId) return null
  return { role, instanceId }
}

/**
 * Same-role specific-instance notify is normally banned (no self-blast).
 * Commit 2 narrows this to a single allowed case: a verified reply.
 *
 * Conditions for the allowance:
 *   1. There IS a replyTo (caller is genuinely replying)
 *   2. The parent message exists in messageLog
 *   3. The parent's originator role MATCHES the target role
 *   4. The parent's originator instanceId MATCHES the target instance
 *
 * That last condition is the trust root: the replier can only sticky-target
 * the exact instance that asked them something. Replier can't blast all
 * peer instances by faking a replyTo.
 */
function permissionAllowsSameRoleReply(
  sessionId: string,
  from: AgentRole,
  fromInstance: string,
  targetRole: AgentRole,
  targetInstance: string | null,
  replyTo: string | null,
): boolean {
  if (from !== targetRole) return false
  if (targetInstance === null) return false // self-blast still banned
  if (replyTo === null) return false        // no claim of "I'm replying"
  if (targetInstance === fromInstance) return false // self-loop still banned

  const parent = state.messageLog.get(messageLogKey(sessionId, replyTo))
  if (!parent) return false
  if (parent.originator.role !== targetRole) return false
  if (parent.originator.instanceId !== targetInstance) return false
  return true
}

/**
 * Resolve replyTo for this notify call.
 *
 *   undefined → look up auto-replyTo from drainInbox's per-role lastSeen
 *   null      → caller declares fresh thread
 *   string    → caller passed an explicit parent id
 */
function resolveReplyTo(
  sessionId: string,
  fromInstance: string,
  targetRole: AgentRole,
  explicit: string | null | undefined,
): string | null {
  if (explicit === null) return null
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  // undefined → auto-fill from lastSeen
  const map = state.lastSeenByRole.get(lastSeenKey(sessionId, fromInstance))
  return map?.get(targetRole) ?? null
}

export function notifyAgent(args: {
  sessionId: string
  from: AgentRole
  /** Sender's own instance id. Captured by the orchestrator from headers/query — never from agent args. */
  fromInstance: string
  /** Either `<role>` or `<role>:<instanceId>`. */
  target: string
  message: string
  priority?: Priority
  /**
   * Reply to a specific message id. Three-state semantics:
   *   undefined  → auto-fill from drainInbox's per-role lastSeen map
   *   null       → declared fresh thread (no parent)
   *   string     → explicit parent id (overrides auto-fill)
   */
  replyTo?: string | null
}): NotifyResult {
  const {
    sessionId, from, fromInstance, target, message,
    priority = 'normal', replyTo: replyToArg,
  } = args
  if (!message || !message.trim()) {
    return { ok: false, error: 'message must be non-empty' }
  }

  const parsed = parseTarget(target)
  if (!parsed) {
    return { ok: false, error: `invalid target "${target}" — expected <role> or <role>:<instanceId>` }
  }
  const { role: targetRole, instanceId: targetInstance } = parsed

  // Resolve replyTo BEFORE permission check — same-role-reply allowance
  // depends on a verified parent.
  const replyTo = resolveReplyTo(sessionId, fromInstance, targetRole, replyToArg)

  // ── Punch-list #6 (CD, 2026-05-01): stale/invalid replyTo rejection ────
  // Pre-#6, an unknown replyTo silently fell through to a fresh thread
  // (parent=null → new threadId, no error). That hid typos, hallucinated
  // ids, and cross-session id leakage. Fail loud instead: if replyTo is
  // set but the parent isn't in this session's messageLog, reject. This
  // applies to both explicit (caller passed it) and auto-filled cases —
  // auto-fill SHOULDN'T produce stale ids in current code (lastSeen and
  // messageLog are in sync), so a failure there indicates a real bug
  // worth surfacing.
  let parent: MessageRecord | null = null
  if (replyTo) {
    parent = state.messageLog.get(messageLogKey(sessionId, replyTo)) || null
    if (!parent) {
      return {
        ok: false,
        error:
          `replyTo "${replyTo}" not found in this session's message log — ` +
          `either a typo, a stale id from a different session, or a ` +
          `hallucinated id. Pass replyTo: null to declare a fresh thread, ` +
          `or omit replyTo to use the auto-fill from your most recent drain.`,
      }
    }
  }

  // ── Permission ─────────────────────────────────────────────────────────
  if (from === targetRole) {
    if (!permissionAllowsSameRoleReply(
      sessionId, from, fromInstance, targetRole, targetInstance, replyTo,
    )) {
      // Distinguish error messages so callers can debug
      if (targetInstance === null) {
        return { ok: false, error: 'cannot notify own role (role-only self-notify is banned)' }
      }
      return {
        ok: false,
        error:
          'same-role instance-specific notify only permitted as a verified reply ' +
          '(replyTo must point to a message originating from that exact instance)',
      }
    }
    // verified reply — permission granted, continue
  } else if (!canNotify(from, targetRole)) {
    return {
      ok: false,
      error: `agent "${from}" is not permitted to notify "${targetRole}"`,
    }
  }

  // ── Resolve threadId from parent (or fresh) ────────────────────────────
  // parent is already looked up above (guaranteed non-null when replyTo is set).
  const threadId: string = parent ? parent.threadId : randomUUID()

  // ── Determine routing: sticky-reply vs sticky-target vs fan-out ────────
  let routeMode: 'sticky-instance' | 'sticky-reply' | 'fanout'
  let routeInstance: string | null = null

  if (targetInstance !== null) {
    routeMode = 'sticky-instance'
    routeInstance = targetInstance
  } else if (parent && parent.originator.role === targetRole) {
    // Sticky-reply: target role-only AND parent is from this same role.
    // Parent's originator instance becomes the route. Gap-1 fix: only
    // applies when target.role matches parent.originator.role; otherwise
    // fall through to fan-out.
    routeMode = 'sticky-reply'
    routeInstance = parent.originator.instanceId
  } else {
    routeMode = 'fanout'
  }

  const id = randomUUID()
  const baseMsg: Omit<InboxMessage, 'id' | 'sessionId' | 'threadId' | 'replyTo' | 'sentAt'>
    & { sentAt: string } = {
    from,
    fromInstance,
    message: message.trim(),
    priority,
    sentAt: new Date().toISOString(),
  }

  const recordOnLog = () => {
    state.messageLog.set(messageLogKey(sessionId, id), {
      id,
      threadId,
      originator: { role: from, instanceId: fromInstance },
      sentAt: baseMsg.sentAt,
      from,
      message: baseMsg.message,
      priority,
      replyTo,
      sessionId,
    })
  }

  // ── Sticky paths: instance must be live, else orphan ───────────────────
  if (routeMode === 'sticky-instance' || routeMode === 'sticky-reply') {
    const inst = routeInstance!
    const liveSet = state.liveInstances.get(liveKey(sessionId, targetRole))
    if (liveSet && liveSet.has(inst)) {
      // Happy path: target instance is connected. Enqueue to its inbox.
      const k = queueKey(sessionId, targetRole, inst)
      const arr = state.queues.get(k) || []
      arr.push({
        ...baseMsg,
        id,
        sessionId,
        threadId,
        replyTo,
      })
      state.queues.set(k, arr)
      recordOnLog()
      return { ok: true, messageId: id, threadId, delivered: 1 }
    }
    // Orphan path: targeted instance is dead. Hold in role-level orphan
    // queue so any live peer of the same role can see + claim it.
    const ok = orphanKey(sessionId, targetRole)
    const orphanArr = state.orphans.get(ok) || []
    orphanArr.push({
      ...baseMsg,
      id,
      sessionId,
      threadId,
      replyTo,
      originallyFor: { role: targetRole, instanceId: inst },
    })
    state.orphans.set(ok, orphanArr)
    recordOnLog()
    return { ok: true, messageId: id, threadId, delivered: 0 }
  }

  // ── Fan-out: 0 live instances becomes orphan, not error ───────────────
  const live = liveInstancesOf(sessionId, targetRole)
  if (live.length === 0) {
    const ok = orphanKey(sessionId, targetRole)
    const orphanArr = state.orphans.get(ok) || []
    orphanArr.push({
      ...baseMsg,
      id,
      sessionId,
      threadId,
      replyTo,
      originallyFor: { role: targetRole, instanceId: null },
    })
    state.orphans.set(ok, orphanArr)
    recordOnLog()
    return { ok: true, messageId: id, threadId, delivered: 0 }
  }

  for (const inst of live) {
    const k = queueKey(sessionId, targetRole, inst)
    const arr = state.queues.get(k) || []
    arr.push({
      ...baseMsg,
      id,
      sessionId,
      threadId,
      replyTo,
    })
    state.queues.set(k, arr)
  }
  recordOnLog()
  return { ok: true, messageId: id, threadId, delivered: live.length }
}

/**
 * Drain THIS instance's pending messages AND peek at any orphans for the
 * role. Drained messages are atomic-ownership transferred; orphans are
 * peeked (visible to every live peer of the role) and stay in the orphan
 * queue until someone calls `claimOrphan(messageId)`.
 *
 * Sort: highest priority first; within priority, oldest first (FIFO).
 * Drained messages and orphans are interleaved by the same sort — the
 * caller can distinguish via the `originallyFor` field on each message.
 *
 * Commit 2: also updates the per-(instance × sender-role) lastSeen map
 * so the next notifyAgent from this instance auto-fills replyTo correctly.
 * Per-role keying ensures a CD-bound reply doesn't accidentally inherit
 * a WebDev message's id when both were drained in the same turn.
 *
 * Commit 3: if orphans exist for the role, they're returned alongside
 * drained messages (with `originallyFor` set). Drained messages are
 * removed from the queue; orphans are NOT — they stay for other peers
 * to see. The caller decides whether to `claimOrphan(id)` (taking
 * ownership and removing it from the orphan queue) or ignore.
 */
export function drainInbox(
  sessionId: string,
  agent: AgentRole,
  instanceId: string,
): InboxMessage[] {
  const k = queueKey(sessionId, agent, instanceId)
  const drained = state.queues.get(k) || []
  state.queues.delete(k)

  // Peek at the role-level orphan queue. Note: we do NOT delete; orphans
  // remain visible to every live peer until claimed.
  const orphans = state.orphans.get(orphanKey(sessionId, agent)) || []

  if (drained.length === 0 && orphans.length === 0) return []

  const all = [...drained, ...orphans]

  // Sort by priority then sentAt
  const order: Record<Priority, number> = { high: 0, normal: 1, low: 2 }
  all.sort((a, b) => {
    const pd = order[a.priority] - order[b.priority]
    if (pd !== 0) return pd
    return a.sentAt.localeCompare(b.sentAt)
  })

  // Update per-role lastSeen ONLY for actually-drained messages. Orphans
  // are peeked, not owned by this instance — they shouldn't seed
  // auto-replyTo until claimed.
  if (drained.length > 0) {
    const lk = lastSeenKey(sessionId, instanceId)
    let map = state.lastSeenByRole.get(lk)
    if (!map) {
      map = new Map<AgentRole, string>()
      state.lastSeenByRole.set(lk, map)
    }
    const bySentAt = [...drained].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    for (const m of bySentAt) {
      map.set(m.from, m.id)
    }
  }

  return all
}

/**
 * Atomic orphan claim. First instance to call wins; subsequent calls for
 * the same messageId return `{ok: false, error: 'already claimed or unknown'}`.
 *
 * On success: the orphan is removed from the role's orphan queue AND
 * enqueued onto the claiming instance's normal inbox queue (so the next
 * `drainInbox` from that instance returns it as a drained message — and
 * the lastSeen map gets updated, enabling auto-replyTo for the response).
 *
 * Permission: only callable by an instance whose role matches the orphan's
 * `originallyFor.role` (you can't claim someone else's orphan).
 */
export interface ClaimOrphanResult {
  ok: boolean
  error?: string
}

export function claimOrphan(args: {
  sessionId: string
  claimer: AgentRole
  claimerInstance: string
  messageId: string
}): ClaimOrphanResult {
  const { sessionId, claimer, claimerInstance, messageId } = args
  const ok = orphanKey(sessionId, claimer)
  const arr = state.orphans.get(ok)
  if (!arr || arr.length === 0) {
    return { ok: false, error: 'no orphans pending for your role' }
  }
  const idx = arr.findIndex((m) => m.id === messageId)
  if (idx < 0) {
    return { ok: false, error: `orphan "${messageId}" already claimed or unknown` }
  }
  const [orphan] = arr.splice(idx, 1)
  if (arr.length === 0) state.orphans.delete(ok)

  // Re-enqueue on claimer's inbox. Strip `originallyFor` so the next drain
  // sees it as a normal message; preserve the originallyFor info via the
  // message body if downstream consumers care (they shouldn't — the orphan
  // path is over once claimed).
  const claimedMsg: InboxMessage = {
    ...orphan,
    originallyFor: undefined,
  }
  const qk = queueKey(sessionId, claimer, claimerInstance)
  const qarr = state.queues.get(qk) || []
  qarr.push(claimedMsg)
  state.queues.set(qk, qarr)
  return { ok: true }
}

/** Diagnostics-only peek into the orphan queue for a role. */
export function pendingOrphansFor(sessionId: string, agent: AgentRole): InboxMessage[] {
  return [...(state.orphans.get(orphanKey(sessionId, agent)) || [])]
}

/** Read the current pending count without draining. Useful for diagnostics. */
export function pendingCount(
  sessionId: string,
  agent: AgentRole,
  instanceId: string,
): number {
  return (state.queues.get(queueKey(sessionId, agent, instanceId)) || []).length
}

/** Diagnostics-only peek into the message log. */
export function getMessageRecord(
  sessionId: string,
  messageId: string,
): MessageRecord | null {
  return state.messageLog.get(messageLogKey(sessionId, messageId)) || null
}

/** Diagnostics-only peek into the lastSeen map. */
export function getLastSeen(
  sessionId: string,
  instanceId: string,
  senderRole: AgentRole,
): string | null {
  return state.lastSeenByRole.get(lastSeenKey(sessionId, instanceId))?.get(senderRole) ?? null
}

// ── Punch-list #2 (CD, 2026-05-01): thread_history ──────────────────────────

/**
 * Public shape returned by `thread_history(threadId)`. One per message in
 * the thread, sorted chronologically (sentAt ascending).
 */
export interface ThreadHistoryEntry {
  id: string
  threadId: string
  from: AgentRole
  fromInstance: string
  message: string
  priority: Priority
  sentAt: string
  replyTo: string | null
}

/**
 * Reconstruct the full chronological message list for a thread.
 *
 * Uses messageLog (which Punch-list #2 extended to retain message bodies +
 * sender metadata, not just routing essentials). This is post-drain
 * observability: even after every queue is empty, the thread's history
 * is reconstructible.
 *
 * Filters by sessionId so cross-session threads don't leak. Returns an
 * empty array if the threadId has no messages in this session — same shape
 * as "drained, nothing left."
 *
 * Performance: scans messageLog. For sessions with thousands of messages
 * this is O(n) per call. Acceptable for current workload (a few thousand
 * tops). If profiling shows it matters, add a per-(session, threadId)
 * secondary index.
 */
export function threadHistory(
  sessionId: string,
  threadId: string,
): ThreadHistoryEntry[] {
  const out: ThreadHistoryEntry[] = []
  for (const rec of state.messageLog.values()) {
    if (rec.sessionId !== sessionId) continue
    if (rec.threadId !== threadId) continue
    out.push({
      id: rec.id,
      threadId: rec.threadId,
      from: rec.from,
      fromInstance: rec.originator.instanceId,
      message: rec.message,
      priority: rec.priority,
      sentAt: rec.sentAt,
      replyTo: rec.replyTo,
    })
  }
  out.sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  return out
}
