/**
 * agent-inbox-bus — Commit 1 (instance-aware addressing).
 *
 * Tests the new behavior: per-(session, role, instanceId) queues, instance
 * registry, role-only fan-out to all live instances, sticky-target routing
 * to one instance.
 *
 * Each test uses a unique sessionId so global state from other tests
 * doesn't leak across (the bus is globalThis-pinned by design — that's
 * how it survives HMR — so cross-test isolation is by sessionId scoping).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claimOrphan,
  drainInbox,
  getLastSeen,
  getMessageRecord,
  liveInstancesOf,
  notifyAgent,
  pendingCount,
  pendingOrphansFor,
  registerInstance,
  threadHistory,
  unregisterInstance,
} from './agent-inbox-bus'

let sessionCounter = 0
function freshSession() {
  sessionCounter++
  return `test-bus-${Date.now()}-${sessionCounter}`
}

describe('agent-inbox-bus — Commit 1: instance-aware queues', () => {
  let session: string

  beforeEach(() => {
    session = freshSession()
  })

  afterEach(() => {
    // Clean up registered instances so global state stays bounded.
    for (const role of ['cd', 'webdev', 'sentinel', 'jedi-code'] as const) {
      for (const inst of liveInstancesOf(session, role)) {
        unregisterInstance(session, role, inst)
      }
    }
  })

  describe('per-instance queue isolation', () => {
    it('two jedi-code instances each get their own queue', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'jedi-code', 'jc-B')

      const r = notifyAgent({
        sessionId: session,
        from: 'cd',
        fromInstance: 'cd-1',
        target: 'jedi-code',
        message: 'hello both',
      })
      expect(r.ok).toBe(true)
      expect(r.delivered).toBe(2)

      // Both instances see the message
      const aMsgs = drainInbox(session, 'jedi-code', 'jc-A')
      const bMsgs = drainInbox(session, 'jedi-code', 'jc-B')
      expect(aMsgs).toHaveLength(1)
      expect(bMsgs).toHaveLength(1)
      expect(aMsgs[0].message).toBe('hello both')
      expect(bMsgs[0].message).toBe('hello both')
      // Same logical send → same messageId across copies
      expect(aMsgs[0].id).toBe(bMsgs[0].id)
    })

    it('drain by one instance does NOT empty the other instance queue', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'jedi-code', 'jc-B')

      notifyAgent({
        sessionId: session,
        from: 'cd',
        fromInstance: 'cd-1',
        target: 'jedi-code',
        message: 'fan out',
      })

      // A drains; B still has the message
      drainInbox(session, 'jedi-code', 'jc-A')
      expect(pendingCount(session, 'jedi-code', 'jc-B')).toBe(1)

      // Now B drains; both empty
      drainInbox(session, 'jedi-code', 'jc-B')
      expect(pendingCount(session, 'jedi-code', 'jc-A')).toBe(0)
      expect(pendingCount(session, 'jedi-code', 'jc-B')).toBe(0)
    })
  })

  describe('sticky-target addressing', () => {
    it('target "role:instanceId" routes to that instance only', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'jedi-code', 'jc-B')

      const r = notifyAgent({
        sessionId: session,
        from: 'cd',
        fromInstance: 'cd-1',
        target: 'jedi-code:jc-A',
        message: 'just for A',
      })
      expect(r.ok).toBe(true)
      expect(r.delivered).toBe(1)

      expect(pendingCount(session, 'jedi-code', 'jc-A')).toBe(1)
      expect(pendingCount(session, 'jedi-code', 'jc-B')).toBe(0)
    })

    it('Commit 3: sticky-target to dead instance routes to orphan queue (not its own bucket)', () => {
      // Commit 1 enqueued blindly into the dead instance's bucket.
      // Commit 3 routes it to the role-level orphan queue so peers can
      // see + claim. The dead bucket stays empty.
      const r = notifyAgent({
        sessionId: session,
        from: 'cd',
        fromInstance: 'cd-1',
        target: 'jedi-code:dead-instance',
        message: 'will be orphaned',
      })
      expect(r.ok).toBe(true)
      expect(r.delivered).toBe(0)
      expect(pendingCount(session, 'jedi-code', 'dead-instance')).toBe(0)
      expect(pendingOrphansFor(session, 'jedi-code')).toHaveLength(1)
    })
  })

  describe('role-only with no live instances', () => {
    it('Commit 3: routes to orphan queue instead of erroring (delivered=0)', () => {
      // No registerInstance for jedi-code in this session — Commit 1 errored,
      // Commit 3 holds the message in the role's orphan queue so any peer
      // that later registers can claim it.
      const r = notifyAgent({
        sessionId: session,
        from: 'cd',
        fromInstance: 'cd-1',
        target: 'jedi-code',
        message: 'into the void',
      })
      expect(r.ok).toBe(true)
      expect(r.delivered).toBe(0)
    })
  })

  describe('instance registry lifecycle', () => {
    it('registerInstance is idempotent', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'jedi-code', 'jc-A')
      expect(liveInstancesOf(session, 'jedi-code')).toEqual(['jc-A'])
    })

    it('unregisterInstance drops the instance from fan-out', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'jedi-code', 'jc-B')
      unregisterInstance(session, 'jedi-code', 'jc-A')

      const r = notifyAgent({
        sessionId: session,
        from: 'cd',
        fromInstance: 'cd-1',
        target: 'jedi-code',
        message: 'after A left',
      })
      expect(r.delivered).toBe(1)
      expect(pendingCount(session, 'jedi-code', 'jc-A')).toBe(0)
      expect(pendingCount(session, 'jedi-code', 'jc-B')).toBe(1)
    })
  })

  describe('permission table preserved', () => {
    it('webdev cannot notify webdev (no self-role notify)', () => {
      registerInstance(session, 'webdev', 'wd-A')
      const r = notifyAgent({
        sessionId: session,
        from: 'webdev',
        fromInstance: 'wd-1',
        target: 'webdev',
        message: 'self-blast',
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/cannot notify own role/)
    })

    it('sentinel cannot notify webdev (not in NOTIFY_PERMISSIONS)', () => {
      registerInstance(session, 'webdev', 'wd-A')
      const r = notifyAgent({
        sessionId: session,
        from: 'sentinel',
        fromInstance: 'sn-1',
        target: 'webdev',
        message: 'unauthorized',
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/not permitted/)
    })

    it('cd → jedi-code is allowed (bidirectional pair)', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      const r = notifyAgent({
        sessionId: session,
        from: 'cd',
        fromInstance: 'cd-1',
        target: 'jedi-code',
        message: 'allowed',
      })
      expect(r.ok).toBe(true)
    })

    it('jedi-code → jedi-code:other-instance is DENIED without a verified replyTo (Commit 2)', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'jedi-code', 'jc-B')
      const r = notifyAgent({
        sessionId: session,
        from: 'jedi-code',
        fromInstance: 'jc-A',
        target: 'jedi-code:jc-B',
        message: 'no replyTo, should fail',
        replyTo: null, // explicit fresh thread — no parent to verify
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/verified reply/)
    })
  })

  describe('message envelope', () => {
    it('captures fromInstance from caller, message from sender', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      notifyAgent({
        sessionId: session,
        from: 'cd',
        fromInstance: 'cd-instance-xyz',
        target: 'jedi-code',
        message: 'check envelope',
        priority: 'high',
      })
      const msgs = drainInbox(session, 'jedi-code', 'jc-A')
      expect(msgs).toHaveLength(1)
      const m = msgs[0]
      expect(m.from).toBe('cd')
      expect(m.fromInstance).toBe('cd-instance-xyz')
      expect(m.priority).toBe('high')
      expect(m.message).toBe('check envelope')
      expect(m.sessionId).toBe(session)
      expect(m.id).toBeTruthy()
      expect(m.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  describe('Commit 2: threading + auto-replyTo + sticky-reply', () => {
    it('thread root gets a fresh threadId', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      const r = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code',
        message: 'root',
        replyTo: null,
      })
      expect(r.ok).toBe(true)
      expect(r.threadId).toBeTruthy()
      const msgs = drainInbox(session, 'jedi-code', 'jc-A')
      expect(msgs[0].threadId).toBe(r.threadId)
      expect(msgs[0].replyTo).toBeNull()
    })

    it('reply inherits the parent threadId', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'cd', 'cd-1')

      const a = notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code', message: 'q',
      })
      drainInbox(session, 'jedi-code', 'jc-A')

      // A replies to CD — replyTo auto-fills from lastSeen
      const b = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'cd', message: 'a',
      })
      expect(b.ok).toBe(true)
      expect(b.threadId).toBe(a.threadId)

      const cdMsgs = drainInbox(session, 'cd', 'cd-1')
      expect(cdMsgs[0].threadId).toBe(a.threadId)
      expect(cdMsgs[0].replyTo).toBe(a.messageId)
    })

    it('auto-replyTo: drain triggers per-role lastSeen update', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'cd', 'cd-1')

      notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code', message: 'hello',
      })
      const msgs = drainInbox(session, 'jedi-code', 'jc-A')
      expect(getLastSeen(session, 'jc-A', 'cd')).toBe(msgs[0].id)
    })

    it('auto-replyTo per-role isolation: webdev message in inbox does NOT taint cd-bound reply', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'cd', 'cd-1')
      registerInstance(session, 'webdev', 'wd-1')

      // Both CD and WebDev send to Jedi Code
      const fromCd = notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code', message: 'cd-msg',
      })
      const fromWd = notifyAgent({
        sessionId: session, from: 'webdev', fromInstance: 'wd-1',
        target: 'jedi-code', message: 'wd-msg',
      })
      drainInbox(session, 'jedi-code', 'jc-A')

      // Per-role lastSeen tracked separately
      expect(getLastSeen(session, 'jc-A', 'cd')).toBe(fromCd.messageId)
      expect(getLastSeen(session, 'jc-A', 'webdev')).toBe(fromWd.messageId)

      // Reply to CD — should auto-fill from CD's lastSeen, NOT WebDev's
      notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'cd', message: 'reply to cd',
      })
      const cdMsgs = drainInbox(session, 'cd', 'cd-1')
      expect(cdMsgs[0].replyTo).toBe(fromCd.messageId)
    })

    it('sticky-reply: target role-only, parent role matches → routes to parent originator', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'jedi-code', 'jc-B') // unrelated peer
      registerInstance(session, 'cd', 'cd-1')

      // Jedi Code A asks CD; CD replies to jedi-code role (with auto-replyTo)
      notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'cd', message: 'q from A',
      })
      drainInbox(session, 'cd', 'cd-1')

      const reply = notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code', message: 'reply to A only',
        // replyTo auto-fills from CD's lastSeen of jedi-code (A's question)
      })
      expect(reply.ok).toBe(true)
      expect(reply.delivered).toBe(1) // sticky, not fan-out

      expect(pendingCount(session, 'jedi-code', 'jc-A')).toBe(1)
      expect(pendingCount(session, 'jedi-code', 'jc-B')).toBe(0)
    })

    it('Gap 1: replyTo set but target role mismatches parent role → fan-out (not sticky)', () => {
      registerInstance(session, 'cd', 'cd-1')
      registerInstance(session, 'webdev', 'wd-1')
      registerInstance(session, 'webdev', 'wd-2')
      registerInstance(session, 'jedi-code', 'jc-A')

      // CD sends to Jedi Code A; A drains it
      notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code', message: 'q',
      })
      drainInbox(session, 'jedi-code', 'jc-A')

      // A now sends to webdev role — auto-replyTo would point at CD's
      // message id, but target is webdev not cd. Should fan-out, not sticky.
      const r = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'webdev', message: 'fan-out check',
        // replyTo auto-fills from jc-A's lastSeen for webdev role —
        // but jc-A has never received a webdev message, so it's null.
      })
      expect(r.ok).toBe(true)
      expect(r.delivered).toBe(2) // fan-out to both webdev instances

      // Both webdevs received it
      expect(pendingCount(session, 'webdev', 'wd-1')).toBe(1)
      expect(pendingCount(session, 'webdev', 'wd-2')).toBe(1)
    })

    it('Gap 1 with explicit replyTo to wrong-role parent: still fan-out, threadId still inherited', () => {
      registerInstance(session, 'cd', 'cd-1')
      registerInstance(session, 'webdev', 'wd-1')
      registerInstance(session, 'webdev', 'wd-2')
      registerInstance(session, 'jedi-code', 'jc-A')

      const cdMsg = notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code', message: 'cd asks jedi',
      })
      drainInbox(session, 'jedi-code', 'jc-A')

      // jc-A sends to webdev BUT explicitly references CD's message as parent.
      // Since target.role (webdev) !== parent.originator.role (cd), this falls
      // through to fan-out — but threadId still inherits.
      const r = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'webdev', message: 'cross-role hop',
        replyTo: cdMsg.messageId,
      })
      expect(r.ok).toBe(true)
      expect(r.delivered).toBe(2) // fan-out to both webdevs
      expect(r.threadId).toBe(cdMsg.threadId) // same thread

      const wd1 = drainInbox(session, 'webdev', 'wd-1')
      expect(wd1[0].replyTo).toBe(cdMsg.messageId) // recorded for thread tracking
      expect(wd1[0].threadId).toBe(cdMsg.threadId)
    })

    it('same-role reply: jc-A → jc-B:specific-instance ALLOWED with verified replyTo', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'jedi-code', 'jc-B')

      // jc-B sends a sticky-target message to jc-A — first we need a parent.
      // But same-role notify itself requires a verified reply, so we set up
      // the chain via CD as a relay: CD → jc-A is a normal cross-role notify.
      // Then jc-A wants to ASK jc-B something — actually, the precondition
      // we need is "jc-B sent jc-A a message". Same-role-direct isn't allowed
      // without a verified reply, so we can't bootstrap purely between Jedi
      // Code instances. The valid path: jc-B replies to a message from jc-A —
      // and jc-A's first message to jc-B has to itself be a verified reply.
      // There's no way to start a same-role chain from scratch in v1 — by
      // design. Document the expected behavior: replies only make sense for
      // existing chains.
      //
      // For this test: assume jc-B sent jc-A SOMETHING earlier (we manually
      // construct the scenario by having jc-A drain a message from CD-1 and
      // then trying to reply same-role; the same-role rule requires the
      // parent's originator to MATCH target role+instance, not just any
      // verified parent). So this scenario should still FAIL.
      //
      // The correct scenario: messageLog already has a record from jc-B → ...
      // Pre-seed via direct notify: jc-B → cd is allowed (cross-role). That
      // creates a record with originator=jedi-code:jc-B. Then jc-A can claim
      // a reply to that record — but only if target instance matches origin,
      // which it does (jc-B). Verified.

      registerInstance(session, 'cd', 'cd-1')

      // jc-B sends to CD (cross-role, allowed). Creates message record.
      const jcb = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-B',
        target: 'cd', message: 'jc-B asks cd',
        replyTo: null,
      })
      // jc-A picks up jc-B's record from messageLog (simulating having seen
      // it via some channel — in real life this would be by drain or by
      // observing the conversation). Now jc-A "replies" to jc-B by passing
      // the message id explicitly.
      const r = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'jedi-code:jc-B', message: 'verified same-role reply',
        replyTo: jcb.messageId,
      })
      expect(r.ok).toBe(true)
      expect(r.delivered).toBe(1)
      expect(pendingCount(session, 'jedi-code', 'jc-B')).toBe(1)
    })

    it('same-role reply: replyTo points to a DIFFERENT instance → DENIED', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'jedi-code', 'jc-B')
      registerInstance(session, 'jedi-code', 'jc-C')
      registerInstance(session, 'cd', 'cd-1')

      const jcc = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-C',
        target: 'cd', message: 'jc-C asks cd',
        replyTo: null,
      })
      // jc-A tries to sticky-reply to jc-B but cites jc-C's message as parent.
      // Should fail — parent's instance is jc-C, target is jc-B.
      const r = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'jedi-code:jc-B', message: 'spoofed reply',
        replyTo: jcc.messageId,
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/verified reply/)
    })

    it('explicit replyTo: null suppresses auto-fill, declares fresh thread', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'cd', 'cd-1')

      // CD sends to Jedi Code, A drains it. lastSeen now has cd's id.
      notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code', message: 'q',
      })
      drainInbox(session, 'jedi-code', 'jc-A')

      // A explicitly sends a fresh thread to CD — replyTo: null
      const r = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'cd', message: 'fresh thread',
        replyTo: null,
      })
      const cdMsgs = drainInbox(session, 'cd', 'cd-1')
      expect(cdMsgs[0].replyTo).toBeNull()
      // New thread id (not inherited)
      expect(cdMsgs[0].threadId).toBe(r.threadId)
    })

    it('explicit replyTo: <id> overrides auto-fill', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'cd', 'cd-1')

      const old = notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code', message: 'older',
      })
      const newer = notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code', message: 'newer',
      })
      drainInbox(session, 'jedi-code', 'jc-A')

      // Auto-fill would point at `newer`. Override to reference `old`.
      const r = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'cd', message: 'reply to older',
        replyTo: old.messageId,
      })
      expect(r.threadId).toBe(old.threadId)
      const cdMsgs = drainInbox(session, 'cd', 'cd-1')
      expect(cdMsgs[0].replyTo).toBe(old.messageId)
      // Sanity: the threads of old and newer were different (each was a fresh root)
      expect(old.threadId).not.toBe(newer.threadId)
    })

    it('messageLog persists records across drain', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      const r = notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code', message: 'check log',
      })
      drainInbox(session, 'jedi-code', 'jc-A')
      // Even after drain, the record is still there for parent lookup
      const rec = getMessageRecord(session, r.messageId!)
      expect(rec).toBeTruthy()
      expect(rec!.originator.role).toBe('cd')
      expect(rec!.originator.instanceId).toBe('cd-1')
      expect(rec!.threadId).toBe(r.threadId)
    })

    it('full chain A → CD → A: A receives reply with same threadId', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'cd', 'cd-1')

      const q = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'cd', message: 'question',
        replyTo: null,
      })
      drainInbox(session, 'cd', 'cd-1')

      const a = notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code', message: 'answer',
      })
      expect(a.threadId).toBe(q.threadId)
      expect(a.delivered).toBe(1) // sticky-reply, not fan-out

      const aMsgs = drainInbox(session, 'jedi-code', 'jc-A')
      expect(aMsgs).toHaveLength(1)
      expect(aMsgs[0].threadId).toBe(q.threadId)
      expect(aMsgs[0].replyTo).toBe(q.messageId)
    })
  })

  describe('Commit 3: orphan handling', () => {
    it('sticky-target to dead instance creates orphan, not silent loss', () => {
      // No registerInstance for the target — sticky to "dead-jc" goes to orphan.
      registerInstance(session, 'cd', 'cd-1')
      const r = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code:dead-jc',
        message: 'asked for someone gone',
      })
      expect(r.ok).toBe(true)
      expect(r.delivered).toBe(0)

      const orphans = pendingOrphansFor(session, 'jedi-code')
      expect(orphans).toHaveLength(1)
      expect(orphans[0].originallyFor).toEqual({ role: 'jedi-code', instanceId: 'dead-jc' })
      expect(orphans[0].id).toBe(r.messageId)
    })

    it('role-only fan-out with 0 live instances becomes orphan', () => {
      registerInstance(session, 'cd', 'cd-1')
      const r = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'webdev',
        message: 'no webdevs around',
      })
      expect(r.ok).toBe(true)
      expect(r.delivered).toBe(0)

      const orphans = pendingOrphansFor(session, 'webdev')
      expect(orphans).toHaveLength(1)
      expect(orphans[0].originallyFor).toEqual({ role: 'webdev', instanceId: null })
    })

    it('agent_inbox returns orphans to live peers of the same role with originallyFor flag', () => {
      // CD asks dead jc-X
      registerInstance(session, 'cd', 'cd-1')
      const r = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code:dead-jc',
        message: 'asked dead instance',
      })

      // Live peer jc-A polls — sees the orphan
      registerInstance(session, 'jedi-code', 'jc-A')
      const msgs = drainInbox(session, 'jedi-code', 'jc-A')
      expect(msgs).toHaveLength(1)
      expect(msgs[0].id).toBe(r.messageId)
      expect(msgs[0].originallyFor).toEqual({ role: 'jedi-code', instanceId: 'dead-jc' })

      // Orphan still pending — peer didn't claim
      expect(pendingOrphansFor(session, 'jedi-code')).toHaveLength(1)
    })

    it('drainInbox does NOT update lastSeen for orphan messages (only drained ones)', () => {
      registerInstance(session, 'cd', 'cd-1')
      registerInstance(session, 'jedi-code', 'jc-A')

      // Orphan-bound message
      notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code:dead-jc',
        message: 'orphan',
      })

      drainInbox(session, 'jedi-code', 'jc-A')
      // Peer saw the orphan but didn't own it — lastSeen for cd should be null
      expect(getLastSeen(session, 'jc-A', 'cd')).toBeNull()
    })

    it('claimOrphan moves orphan into claimer inbox; subsequent claim from another peer fails', () => {
      registerInstance(session, 'cd', 'cd-1')
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'jedi-code', 'jc-B')

      const r = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code:dead-jc',
        message: 'who claims me',
      })

      // jc-A claims first
      const c1 = claimOrphan({
        sessionId: session,
        claimer: 'jedi-code',
        claimerInstance: 'jc-A',
        messageId: r.messageId!,
      })
      expect(c1.ok).toBe(true)

      // jc-B tries to claim same orphan — already gone
      const c2 = claimOrphan({
        sessionId: session,
        claimer: 'jedi-code',
        claimerInstance: 'jc-B',
        messageId: r.messageId!,
      })
      expect(c2.ok).toBe(false)
      expect(c2.error).toMatch(/already claimed|unknown|no orphans pending/)

      // jc-A's next drain returns it as a normal drained message (no originallyFor)
      const aMsgs = drainInbox(session, 'jedi-code', 'jc-A')
      expect(aMsgs).toHaveLength(1)
      expect(aMsgs[0].id).toBe(r.messageId)
      expect(aMsgs[0].originallyFor).toBeUndefined()

      // lastSeen now updated for jc-A (claimed orphan acted like a normal drain)
      expect(getLastSeen(session, 'jc-A', 'cd')).toBe(r.messageId)
    })

    it('claimOrphan with wrong role finds nothing (cannot steal another role\'s orphan)', () => {
      registerInstance(session, 'cd', 'cd-1')
      const r = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'webdev',
        message: 'webdev orphan',
      })

      // CD-1 attempts to claim webdev's orphan
      const c = claimOrphan({
        sessionId: session,
        claimer: 'cd',
        claimerInstance: 'cd-1',
        messageId: r.messageId!,
      })
      expect(c.ok).toBe(false)
      // The webdev orphan queue is still intact
      expect(pendingOrphansFor(session, 'webdev')).toHaveLength(1)
    })

    it('orphans are visible to ALL live peers until claimed (no first-poller-wins)', () => {
      registerInstance(session, 'cd', 'cd-1')
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'jedi-code', 'jc-B')

      notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code:dead-jc',
        message: 'visible to both',
      })

      const aMsgs = drainInbox(session, 'jedi-code', 'jc-A')
      const bMsgs = drainInbox(session, 'jedi-code', 'jc-B')
      // Both peers see the same orphan
      expect(aMsgs).toHaveLength(1)
      expect(bMsgs).toHaveLength(1)
      expect(aMsgs[0].id).toBe(bMsgs[0].id)
      expect(aMsgs[0].originallyFor).toBeTruthy()
      expect(bMsgs[0].originallyFor).toBeTruthy()
    })

    it('claim_orphan succeeds atomically when called concurrently (only first claimant wins)', () => {
      // Synchronous-but-realistic concurrent test: two claims fired in
      // sequence. The first removes the orphan from the queue; the second
      // can't find it. This matches what would happen under Node\'s
      // single-threaded event loop even if requests arrived "concurrently."
      registerInstance(session, 'cd', 'cd-1')
      registerInstance(session, 'jedi-code', 'jc-A')
      registerInstance(session, 'jedi-code', 'jc-B')

      const r = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code:dead',
        message: 'race target',
      })

      const a = claimOrphan({
        sessionId: session, claimer: 'jedi-code',
        claimerInstance: 'jc-A', messageId: r.messageId!,
      })
      const b = claimOrphan({
        sessionId: session, claimer: 'jedi-code',
        claimerInstance: 'jc-B', messageId: r.messageId!,
      })
      expect(a.ok).toBe(true)
      expect(b.ok).toBe(false)
    })
  })

  describe('Punch-list #6 (CD): stale/invalid replyTo rejection', () => {
    it('explicit replyTo with bogus uuid → typed error, no fresh-thread fall-through', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      const r = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code',
        message: 'with bogus parent',
        replyTo: '00000000-0000-0000-0000-000000000000',
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/not found in this session/)
    })

    it('explicit replyTo with id from another session → rejected (cross-session isolation)', () => {
      registerInstance(session, 'jedi-code', 'jc-A')

      // Create a real message in a DIFFERENT session
      const otherSession = `${session}-other`
      registerInstance(otherSession, 'jedi-code', 'other-jc')
      const realInOther = notifyAgent({
        sessionId: otherSession,
        from: 'cd', fromInstance: 'cd-other',
        target: 'jedi-code',
        message: 'lives elsewhere',
      })
      // Try to use that messageId as replyTo in OUR session
      const r = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code',
        message: 'attempting cross-session reply',
        replyTo: realInOther.messageId,
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/not found in this session/)

      // Cleanup the other session's instance so it doesn't leak
      unregisterInstance(otherSession, 'jedi-code', 'other-jc')
    })

    it('explicit replyTo with valid id still succeeds (no regression)', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      const old = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code',
        message: 'parent',
      })
      const r = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code',
        message: 'reply with valid parent id',
        replyTo: old.messageId,
      })
      expect(r.ok).toBe(true)
      expect(r.threadId).toBe(old.threadId)
    })

    it('explicit replyTo: null still creates a fresh thread (declared intent path)', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      const r = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code',
        message: 'fresh declared',
        replyTo: null,
      })
      expect(r.ok).toBe(true)
      expect(r.threadId).toBeTruthy()
    })

    it('omitting replyTo still works (auto-fill or fresh, no rejection)', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      const r = notifyAgent({
        sessionId: session,
        from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code',
        message: 'no replyTo arg at all',
      })
      expect(r.ok).toBe(true)
    })
  })

  describe('Punch-list #2 (CD): thread_history', () => {
    it('returns full chronological message list for a thread', () => {
      registerInstance(session, 'cd', 'cd-1')
      registerInstance(session, 'jedi-code', 'jc-A')

      const m1 = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'cd', message: 'q1', replyTo: null,
      })
      drainInbox(session, 'cd', 'cd-1')

      const m2 = notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code', message: 'a1',
      })
      drainInbox(session, 'jedi-code', 'jc-A')

      const m3 = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'cd', message: 'q2',
      })
      drainInbox(session, 'cd', 'cd-1')

      // Even though all queues are now empty, thread_history reconstructs the chain.
      const hist = threadHistory(session, m1.threadId!)
      expect(hist).toHaveLength(3)
      expect(hist.map((h) => h.message)).toEqual(['q1', 'a1', 'q2'])
      expect(hist.map((h) => h.id)).toEqual([m1.messageId, m2.messageId, m3.messageId])
      expect(hist.map((h) => h.replyTo)).toEqual([null, m1.messageId, m2.messageId])
    })

    it('messages survive even when sender instance dies', () => {
      registerInstance(session, 'cd', 'cd-1')
      registerInstance(session, 'jedi-code', 'jc-DOOMED')

      const m1 = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-DOOMED',
        target: 'cd', message: 'last words',
      })
      // jc-DOOMED dies before reply arrives
      unregisterInstance(session, 'jedi-code', 'jc-DOOMED')

      // Thread history still has the message
      const hist = threadHistory(session, m1.threadId!)
      expect(hist).toHaveLength(1)
      expect(hist[0].from).toBe('jedi-code')
      expect(hist[0].fromInstance).toBe('jc-DOOMED')
      expect(hist[0].message).toBe('last words')
    })

    it('returns empty array for unknown threadId (no error — agents may probe)', () => {
      const hist = threadHistory(session, 'totally-bogus-thread-id')
      expect(hist).toEqual([])
    })

    it('does not leak across sessions', () => {
      registerInstance(session, 'cd', 'cd-1')
      registerInstance(session, 'jedi-code', 'jc-A')
      const m = notifyAgent({
        sessionId: session, from: 'jedi-code', fromInstance: 'jc-A',
        target: 'cd', message: 'session A only',
      })
      const otherSession = `${session}-other`
      const hist = threadHistory(otherSession, m.threadId!)
      expect(hist).toEqual([])
    })

    it('orphan messages are visible in thread_history', () => {
      // Orphans get recorded in messageLog — same as regular messages.
      // They just don't have a live target queue.
      registerInstance(session, 'cd', 'cd-1')
      const r = notifyAgent({
        sessionId: session, from: 'cd', fromInstance: 'cd-1',
        target: 'jedi-code:dead-jc',
        message: 'to a ghost',
      })
      const hist = threadHistory(session, r.threadId!)
      expect(hist).toHaveLength(1)
      expect(hist[0].message).toBe('to a ghost')
    })
  })

  describe('invalid target parsing', () => {
    it('rejects empty target', () => {
      registerInstance(session, 'jedi-code', 'jc-A')
      const r = notifyAgent({
        sessionId: session,
        from: 'cd',
        fromInstance: 'cd-1',
        target: '',
        message: 'no target',
      })
      expect(r.ok).toBe(false)
    })

    it('rejects unknown role', () => {
      const r = notifyAgent({
        sessionId: session,
        from: 'cd',
        fromInstance: 'cd-1',
        target: 'mystery',
        message: 'whoami',
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/invalid target/)
    })

    it('rejects role:emptyInstance shape', () => {
      const r = notifyAgent({
        sessionId: session,
        from: 'cd',
        fromInstance: 'cd-1',
        target: 'jedi-code:',
        message: 'malformed',
      })
      expect(r.ok).toBe(false)
    })
  })
})
