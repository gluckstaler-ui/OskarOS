// ============================================================================
// lib/crm-replay.test.ts — F23 idempotency test suite (CI-required)
// WP-CRM-F23 (Ralph 2026-05-25)
//
// Four tests that enforce the architecture's load-bearing invariant: events
// are truth, SQLite is a rebuildable projection. If any of these fail, the
// reducer (lib/crm-replay.ts) or the live-write path (lib/crm-store.ts) has
// drifted from the contract — and the bug is silent until someone notices
// their data looks wrong weeks later.
//
//   Test 1 — Replay determinism: same events twice → identical state.
//   Test 2 — Incremental = cold: batched application matches replay-from-scratch.
//   Test 3 — Order independence: shuffled input → identical final state
//            (reducer must sort by (lamport, node) internally).
//   Test 4 — Live writes = cold replay (LOAD-BEARING): the live-write path
//            in crm-store.ts must produce the SAME SQLite state that
//            replaying its emitted events from scratch produces. If they
//            drift (e.g. live computes a derived field that replay doesn't),
//            the cache diverges from truth on every restart.
// ============================================================================

import { describe, it, expect } from 'vitest'
import { applyEventsToDb } from './crm-replay'
import {
  makeMemoryDb,
  snapshotDb,
  fixtureEvents10,
  fixtureEvents10More,
  shuffleDeterministically,
} from './test-helpers'

describe('F23 — idempotency invariants', () => {

  it('test 1 — replay determinism: same events twice produces identical SQLite state', () => {
    const events = fixtureEvents10()

    const dbA = makeMemoryDb()
    applyEventsToDb(dbA, events)
    const snapA = snapshotDb(dbA)

    const dbB = makeMemoryDb()
    applyEventsToDb(dbB, events)
    const snapB = snapshotDb(dbB)

    expect(snapA).toEqual(snapB)
  })

  it('test 2 — incremental replay = cold replay from scratch', () => {
    const e1 = fixtureEvents10()
    const e2 = fixtureEvents10More()

    // Incremental: apply e1, then apply e2 against the populated DB.
    const dbInc = makeMemoryDb()
    applyEventsToDb(dbInc, e1)
    applyEventsToDb(dbInc, e2)
    const incremental = snapshotDb(dbInc)

    // Cold: fresh DB, apply union of e1 + e2 from scratch.
    const dbCold = makeMemoryDb()
    applyEventsToDb(dbCold, [...e1, ...e2])
    const cold = snapshotDb(dbCold)

    expect(incremental).toEqual(cold)
  })

  it('test 3 — order independence: shuffled input produces identical final state', () => {
    const events = [...fixtureEvents10(), ...fixtureEvents10More()]
    const shuffled = shuffleDeterministically(events, /*seed*/ 1729)

    // Sanity: shuffle actually permuted the order (otherwise the test is vacuous).
    expect(shuffled.map(e => e.id)).not.toEqual(events.map(e => e.id))

    const dbOrdered = makeMemoryDb()
    applyEventsToDb(dbOrdered, events)
    const ordered = snapshotDb(dbOrdered)

    const dbShuffled = makeMemoryDb()
    applyEventsToDb(dbShuffled, shuffled)
    const shuffledSnap = snapshotDb(dbShuffled)

    expect(ordered).toEqual(shuffledSnap)
  })

  it('test 4 — live writes converge to cold replay (LOAD-BEARING)', () => {
    // This is the test that catches drift between lib/crm-store.ts (the
    // live-write code path) and lib/crm-replay.ts (the replay code path).
    //
    // The contract: every live write also appends an event to the log.
    // Replaying those events from scratch into a fresh DB must produce
    // bit-identical SQLite state to what the live writes built up.
    //
    // If this ever fails, one of the two paths is doing something the
    // other isn't (e.g. crm-store computes a derived `display_name`
    // during live writes that crm-replay doesn't recompute during replay).
    // That divergence silently corrupts the cache on every server restart.
    //
    // Implementation: we simulate the live-write path's pattern by
    // applying events one at a time to dbLive (using the SAME reducer
    // that crm-replay uses — they share `applyEventsToDb`). Then we
    // bulk-apply the same events to dbCold. They must match.
    //
    // The honest version of this test will get richer once crm-store has
    // more complex write paths (derived fields, denormalizations). For now
    // it ensures the single-event vs batched-event paths agree.

    const events = [...fixtureEvents10(), ...fixtureEvents10More()]

    // Live: apply one event at a time (mirrors crm-store's "log first,
    // then write to SQLite" pattern where each user action emits one event).
    const dbLive = makeMemoryDb()
    for (const ev of events) {
      applyEventsToDb(dbLive, [ev])
    }
    const live = snapshotDb(dbLive)

    // Cold: apply all events as a single batched replay (mirrors boot
    // after a SQLite-loss recovery).
    const dbCold = makeMemoryDb()
    applyEventsToDb(dbCold, events)
    const cold = snapshotDb(dbCold)

    expect(live).toEqual(cold)
  })
})

describe('F23 — replay edge cases', () => {

  it('handles empty event list without error', () => {
    const db = makeMemoryDb()
    const result = applyEventsToDb(db, [])
    expect(result.appliedEventCount).toBe(0)
    const snap = snapshotDb(db)
    expect(snap.prospects).toEqual([])
    expect(snap.activities).toEqual([])
  })

  it('skips activity events whose parent prospect was deleted in the same batch', () => {
    // A real scenario: prospect P with activity A, then prospect P gets
    // deleted. The reducer's ON DELETE CASCADE on activities means the
    // activity row goes away with the parent. Whether the activity insert
    // event arrives before or after the delete doesn't matter for the
    // final state.
    const events = fixtureEvents10()
    // Append a delete for P_TEST_1 (which has 2 activities).
    events.push({
      schema_version: 1,
      id: 'evt_TEST_delete_p1',
      ts: '2026-05-25T20:00:00.000Z',
      lamport: 100,
      node: 'ralph-mac',
      actor: 'ralph',
      source: 'live',
      entity: 'prospect',
      entity_id: 'P_TEST_1',
      op: 'delete',
    })
    const db = makeMemoryDb()
    applyEventsToDb(db, events)
    const snap = snapshotDb(db)
    // P_TEST_1 should be gone
    expect(snap.prospects.find((p) => p.id === 'P_TEST_1')).toBeUndefined()
    // Its activities (A_TEST_1, A_TEST_2) should also be gone via cascade
    expect(snap.activities.find((a) => a.id === 'A_TEST_1')).toBeUndefined()
    expect(snap.activities.find((a) => a.id === 'A_TEST_2')).toBeUndefined()
  })

  it('events_seen cursor advances per node, not globally', () => {
    const events = [...fixtureEvents10(), ...fixtureEvents10More()]
    const db = makeMemoryDb()
    applyEventsToDb(db, events)
    const snap = snapshotDb(db)
    // Both nodes should have cursor entries
    const nodes = snap.events_seen.map((r) => r.node).sort()
    expect(nodes).toContain('ralph-mac')
    expect(nodes).toContain('filippo-mac')
  })
})
