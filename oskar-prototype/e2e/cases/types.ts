/**
 * UICase types — OskarOS-shaped e2e flow definitions.
 *
 * Source: external/open-design/e2e/cases/types.ts (OD's `UICase` shape)
 * Adapted 2026-05-02 (FEATURE-X §1.4 WP-3.1, Phase 3 Commit B testing infra).
 *
 * OD's shape is project-creation-centric (`kind: 'prototype' | 'deck' | …`,
 * `create.projectName`, `create.tab`). OskarOS doesn't have a project-creation
 * step — sessions are created by SessionStarter and the work units are
 * vibes / images / hot-swaps / director-edits. So the OskarOS UICase has:
 *
 *   - `category` — taxonomy of the surface under test (chat, build,
 *     image-pipeline, mcp-bus, director-mode, sage, order66, brand-lint)
 *   - `flow` — 19 concrete flows from FEATURE-X §1.4.4 (extensible)
 *   - `seed` — what session state needs to exist before the flow runs
 *     (no `create.projectName`/`create.tab` because there's no creation UI)
 *   - `mockStrategy` — see WP-3.3: mocks must mirror real route shapes
 *   - `prompt` / `secondaryPrompt` — user-typed inputs the flow exercises
 *   - `expectedEvents` — typed `OskarChatEventKind[]` that should fire on
 *     the event-bus during the flow (verified against `replayRecent`)
 *
 * The 19 flows are open to renaming / reordering; CD has been pinged for
 * confirmation. Adding flows is additive — never remove a green flow
 * without an explicit decision.
 */
import type { OskarChatEventKind } from '@/lib/types/chat-sse';

/**
 * Surface taxonomy. Used for filtering/grouping in the markdown reporter
 * (WP-3.2) and for picking which mocks to install per spec.
 */
export type CaseCategory =
  | 'chat'             // chat surface — markdown render, question-form, todo-write, tool-cards
  | 'build'            // vibe builds (single + batch + final)
  | 'image-pipeline'   // generate / edit / hot-swap / image-mode evaluation
  | 'mcp-bus'          // notify_agent / claim_orphan / thread_history / fan-out
  | 'director-mode'    // edits + revert + commit + push notification to CD
  | 'sage'             // 240/40 cut + recovery from snapshot
  | 'order66'          // bridge respawn + replay_events catch-up
  | 'brand-lint';      // lint_brand_compliance pass / fail

/**
 * The 19 OskarOS flows registered for Phase 3 e2e coverage. CD-confirmable;
 * extending the union is the contract for adding a flow.
 */
export type CaseFlow =
  // chat surface
  | 'discovery-question-form'
  | 'discovery-direction-pick'
  | 'todo-write-unfinished'
  | 'tool-card-render-cd-tools'
  // build pipeline
  | 'vibe-build-3'
  | 'vibe-build-failed'
  // image pipeline
  | 'hot-swap-success'
  | 'hot-swap-failed-image'
  | 'brand-asset-generation'
  | 'image-mode-evaluation'
  // mcp bus
  | 'mcp-bus-fanout'
  | 'mcp-bus-orphan-claim'
  | 'mcp-bus-thread-resume'
  // director mode
  | 'director-mode-revert'
  | 'director-mode-commit'
  // sage
  | 'sage-cut-recovery'
  // order66
  | 'order66-bridge-respawn'
  | 'order65-soft-compaction'
  // brand-lint
  | 'lint-brand-compliance-fail';

/**
 * Mock strategy. Spelled out so a glance at the case tells you whether the
 * harness will be deterministic, golden-recorded, or live.
 *
 * - 'mock'       — replayed SSE stream + stubbed routes; deterministic
 *                  runs in CI on every PR.
 * - 'golden'     — recorded once against a real run, replayed thereafter
 *                  with drift detection. Updated by CD/Ralph when the
 *                  doctrine intentionally shifts.
 * - 'live'       — real Claude-CLI subprocess + Nano + Playwright. Nightly
 *                  only. Expensive; flaky if used in PR gate.
 */
export type CaseMockStrategy = 'mock' | 'golden' | 'live';

/**
 * Seed state needed before the flow runs. The harness reads this and
 * provisions: localStorage, session folder fixtures, MCP-bus seed
 * messages, IMAGES.md, vibe HTMLs, etc.
 */
export interface CaseSeed {
  /** A pre-existing session id to load. Defaults to a fresh ephemeral session. */
  sessionId?: string;
  /** Files to drop into the session folder before the flow runs. */
  files?: Array<{ path: string; content: string }>;
  /** Pre-seed peer-agent inbox messages so the flow can drain them. */
  inboxMessages?: Array<{
    target: 'cd' | 'webdev' | 'sentinel' | 'jedi-code';
    message: string;
    priority?: 'low' | 'normal' | 'high';
    replyTo?: string | null;
  }>;
  /** Set localStorage keys before navigation. */
  localStorage?: Record<string, string>;
  /** Pre-publish event-bus events to seed `replayRecent` state. */
  preEvents?: Array<{ type: OskarChatEventKind; [key: string]: unknown }>;
}

/**
 * Expected event shape — used to assert that the right `OskarChatEventKind`
 * fired during the flow. Each entry is "expected at least once with this
 * shape"; supporting `at-least-N` / `at-most-N` is a future extension.
 */
export interface CaseExpectedEvent {
  type: OskarChatEventKind;
  /**
   * Minimum number of times this event must fire. Default 1.
   */
  min?: number;
  /**
   * Substring or regex match against JSON.stringify(payload). Optional;
   * keep loose for golden-recording compatibility.
   */
  payloadMatch?: string | RegExp;
}

export interface UICase {
  id: string;
  title: string;
  category: CaseCategory;
  flow: CaseFlow;
  /** Flag flips OFF when an e2e is being authored (skipped in PR gate). */
  automated: boolean;
  description: string;
  /** Free-form notes — design rationale, gotchas, future extensions. */
  notes?: string[];
  /**
   * Tier — controls when the case runs:
   *   - 'critical'      — runs on every push (must pass to commit)
   *   - 'merge'         — runs on every PR (must pass to merge)
   *   - 'nightly'       — full E2E with real backends (run pre-ship)
   *   - 'manual'        — author-driven verification only (typically
   *                       redesign-pass screenshots, captured by CD)
   */
  tier: 'critical' | 'merge' | 'nightly' | 'manual';
  mockStrategy: CaseMockStrategy;
  seed?: CaseSeed;
  /** First user message the flow types into the composer. */
  prompt?: string;
  /** Optional follow-up after the first round-trip completes. */
  secondaryPrompt?: string;
  /** Optional list of event-kinds asserted during the run. */
  expectedEvents?: CaseExpectedEvent[];
}

/**
 * Lightweight registry helper — not a class, just a discriminated lookup.
 */
export interface UICaseIndex {
  all: UICase[];
  byId(id: string): UICase | undefined;
  byCategory(category: CaseCategory): UICase[];
  byFlow(flow: CaseFlow): UICase | undefined;
  byTier(tier: UICase['tier']): UICase[];
}
