/**
 * lib/runtime/discovery-seed.ts — canonical Phase 1 (Discovery) todo seed.
 *
 * Anchored 2026-05-06 (Ralph). When a fresh session boots and SESSION.md
 * has no `## Todos` section yet, `seedDiscoveryTodosIfMissing()` writes
 * this list. CD then works through it: marks items in_progress as it asks
 * the relevant questions, completed once captured to CREATIVE-BRIEF.md.
 *
 * Why code (not the agent prompt):
 *   - Structural, not tasteful — every session ships the same list.
 *   - Saves CD's first turn from being TodoWrite boilerplate.
 *   - Deterministic — a fresh Claude on a new session sees the seeded
 *     list immediately, no doctrine-drift between instances.
 *   - Single source of truth — updates here propagate to every session
 *     instead of every agent-prompt rewrite.
 *
 * The list maps 1:1 to the question groups in `agents/creative-director-
 * agent.md` § "PHASE 1: DISCOVERY → Questions to explore" plus the
 * pre-Phase-2 gate that uses `confirm_understanding`.
 *
 * To extend (e.g. add Phase 2 starter todos): export a separate seed
 * (PHASE_2_TODOS_SEED) from this file. Don't pile every phase into the
 * discovery seed — CD should drive phase-2 transitions via fresh
 * TodoWrite calls, not pre-seeded structure.
 */

import type { TodoItem } from '@/lib/types/todos'

export const DISCOVERY_TODOS_SEED: ReadonlyArray<Omit<TodoItem, 'id'>> = [
  {
    content:
      'Establish the basics — name, location, what people actually do here',
    activeForm: 'Establishing the basics',
    status: 'pending',
  },
  {
    content:
      'Find the weird detail — what surprises people, what they almost don\'t mention',
    activeForm: 'Finding the weird detail',
    status: 'pending',
  },
  {
    content:
      'Lock the signature experience — the moment customers remember',
    activeForm: 'Locking the signature experience',
    status: 'pending',
  },
  {
    content:
      'Name the enemy — what the industry does wrong, what you\'d never do',
    activeForm: 'Naming the enemy',
    status: 'pending',
  },
  {
    content:
      'Profile a real customer — one specific person, not a demographic',
    activeForm: 'Profiling a real customer',
    status: 'pending',
  },
  {
    content:
      'Catalog the offerings — bookable units, prices, signature thing',
    activeForm: 'Cataloging the offerings',
    status: 'pending',
  },
  {
    content:
      'Confirm understanding — summarize and get user\'s "go" before vibes',
    activeForm: 'Confirming understanding',
    status: 'pending',
  },
]
