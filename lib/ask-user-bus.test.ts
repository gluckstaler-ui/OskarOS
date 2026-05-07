/**
 * ask-user-bus tests — Phase 2 Tier S (2026-04-30).
 *
 * Covers:
 *   - registerAsk + deliverChoice happy path
 *   - Concurrency rejection (second ask_user while first is open)
 *   - Cancel sentinel on timeout
 *   - Unknown requestId on deliver returns false
 *   - Per-session isolation (two sessions can ask in parallel)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerAsk,
  deliverChoice,
  pendingAskCount,
  ASK_USER_CANCEL_SENTINEL,
} from './ask-user-bus'

beforeEach(() => {
  // Drain any leftover pending state by delivering arbitrary IDs (no-op
  // if not present) — Map state persists between tests in module scope.
})

describe('ask-user-bus', () => {
  it('registerAsk returns a requestId + a Promise that resolves on deliverChoice', async () => {
    const reg = registerAsk({ sessionId: 'sess-A', question: 'pick one' })
    expect(reg.ok).toBe(true)
    if (!reg.ok) throw new Error('unreachable')
    expect(reg.requestId).toMatch(/^[0-9a-f-]{36}$/)

    // Caller awaits the Promise; we resolve it from another part of the system.
    const promise = reg.promise
    queueMicrotask(() => deliverChoice(reg.requestId, 'B'))
    const choice = await promise
    expect(choice).toBe('B')
  })

  it('deliverChoice returns false for an unknown requestId', () => {
    expect(deliverChoice('not-a-real-id', 'X')).toBe(false)
  })

  it('rejects a second ask_user for the same session while one is open', async () => {
    const reg1 = registerAsk({ sessionId: 'sess-B', question: 'q1' })
    expect(reg1.ok).toBe(true)
    if (!reg1.ok) throw new Error('unreachable')

    const reg2 = registerAsk({ sessionId: 'sess-B', question: 'q2' })
    expect(reg2.ok).toBe(false)
    // Narrow the discriminated union — TS needs the explicit ok===false check.
    if (reg2.ok === true) throw new Error('unreachable')
    expect(reg2.error).toContain('already open')

    // Resolve reg1 to clean up; new ask should now succeed.
    deliverChoice(reg1.requestId, 'done')
    await reg1.promise
    const reg3 = registerAsk({ sessionId: 'sess-B', question: 'q3' })
    expect(reg3.ok).toBe(true)
    if (reg3.ok) deliverChoice(reg3.requestId, 'done')
  })

  it('two different sessions can have ask_user open in parallel', async () => {
    const a = registerAsk({ sessionId: 'parallel-X', question: 'qX' })
    const b = registerAsk({ sessionId: 'parallel-Y', question: 'qY' })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (!a.ok || !b.ok) throw new Error('unreachable')

    deliverChoice(a.requestId, 'choice-X')
    deliverChoice(b.requestId, 'choice-Y')
    expect(await a.promise).toBe('choice-X')
    expect(await b.promise).toBe('choice-Y')
  })

  it('returns the cancel sentinel on timeout', async () => {
    // Use a 50ms timeout for the test.
    const reg = registerAsk({ sessionId: 'sess-timeout', question: 'q', timeoutMs: 50 })
    expect(reg.ok).toBe(true)
    if (!reg.ok) throw new Error('unreachable')
    const choice = await reg.promise
    expect(choice).toBe(ASK_USER_CANCEL_SENTINEL)
  })

  it('after timeout, the requestId is forgotten — late deliverChoice returns false', async () => {
    const reg = registerAsk({ sessionId: 'sess-late', question: 'q', timeoutMs: 30 })
    if (!reg.ok) throw new Error('unreachable')
    await reg.promise // wait for timeout to fire
    expect(deliverChoice(reg.requestId, 'too late')).toBe(false)
  })

  it('pendingAskCount tracks open asks across sessions', async () => {
    const before = pendingAskCount()
    const a = registerAsk({ sessionId: 'count-A', question: 'qA' })
    const b = registerAsk({ sessionId: 'count-B', question: 'qB' })
    expect(pendingAskCount()).toBe(before + 2)
    if (a.ok) deliverChoice(a.requestId, 'x')
    if (b.ok) deliverChoice(b.requestId, 'y')
    expect(pendingAskCount()).toBe(before)
    if (a.ok) await a.promise
    if (b.ok) await b.promise
  })
})
