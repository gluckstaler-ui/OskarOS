/**
 * UICase registry — 19 OskarOS-specific e2e flows.
 *
 * Source: external/open-design/e2e/cases/index.ts (registry pattern)
 * Authored 2026-05-02 (FEATURE-X §1.4 WP-3.1, Phase 3 Commit B).
 *
 * Adding a flow: extend the union in `types.ts`, append a UICase here, and
 * write a Playwright spec under `e2e/specs/<flow>.spec.ts` that reads the
 * case, applies the seed, and runs assertions. The markdown reporter
 * (WP-3.2) walks `uiCases` and links each entry to its spec output.
 *
 * NOTE — `automated: false` means the harness is not yet authored. Cases
 * land in two passes: (1) entry registered + tier set + mockStrategy set
 * + seed sketched (this file); (2) Playwright spec written + `automated`
 * flipped to true. Phase 3 ships at least 5 of the 19 with `automated:
 * true`; the rest are tracked debt.
 */
import type { UICase, UICaseIndex } from './types';

export const uiCases: UICase[] = [
  /* ────────────────────────────────────────────────────────────────────── *
   *   chat surface                                                         *
   * ────────────────────────────────────────────────────────────────────── */

  {
    id: 'discovery-question-form',
    title: 'CD emits <question-form> on discovery → user answers → CD reads structured response',
    category: 'chat',
    flow: 'discovery-question-form',
    automated: false,
    description:
      'Doctrine-bearing happy path for the four-channel chat surface. Validates that CD emits <question-form>, the new QuestionFormView renders interactively, the submission round-trips a "[form answers — <id>]" prose block back to CD, and CD parses it correctly.',
    tier: 'merge',
    mockStrategy: 'mock',
    seed: {
      preEvents: [],
    },
    prompt: 'I want to design a brand for my coffee shop in Berlin.',
    expectedEvents: [
      { type: 'cd_snackbar', min: 0 }, // none required, but allowed
    ],
    notes: [
      'Must verify the form is NOT eaten by the markdown renderer (coordinate with WP-2.4 + WP-2.3).',
      'Locked-form re-render after page reload is part of this flow.',
    ],
  },

  {
    id: 'discovery-direction-pick',
    title: 'Direction-cards picker — palette swatches + type sample render correctly per card',
    category: 'chat',
    flow: 'discovery-direction-pick',
    automated: false,
    description:
      'Validates the second discovery batch (after the basics form): CD emits a question-form with type="direction-cards" and 4-5 named directions; user clicks a card; the selected card highlights with the OskarOS accent border + Selected pill.',
    tier: 'merge',
    mockStrategy: 'mock',
    prompt: 'Pick a direction for me — show me 4 options.',
    notes: [
      'Visual: palette row, display+body type sample, mood blurb, refs line all render.',
      'Per CD: failure to maintain visual hierarchy on this card triggers QuestionForm redesign.',
    ],
  },

  {
    id: 'todo-write-unfinished',
    title: 'CD emits TodoWrite mid-task → UnfinishedTodosPanel renders → "Continue" re-prompts',
    category: 'chat',
    flow: 'todo-write-unfinished',
    automated: false,
    description:
      'Validates the WP-2.8 redesigned panel: agent-Order positioning, sparkle icon, pulse animation on in_progress glyph, "+N more" inline expand, transparent Continue button. After clicking Continue, CD receives a synthesized re-prompt with the unfinished items.',
    tier: 'merge',
    mockStrategy: 'mock',
    seed: {
      inboxMessages: [],
    },
    prompt: 'Build me three vibes for the Berlin café.',
    notes: [
      'Verify pulse respects prefers-reduced-motion.',
      'Verify panel auto-collapses when all items complete.',
    ],
  },

  {
    id: 'tool-card-render-cd-tools',
    title: 'All 13 ToolCards render with correct tier + tokens + theme awareness',
    category: 'chat',
    flow: 'tool-card-render-cd-tools',
    automated: false,
    description:
      'Visual regression baseline for WP-2.7. Spawns a chat session that exercises one call to each of the 13 tool surfaces (CD: 8, WebDev: 1, Sentinel: 1, cross-agent: 3); captures screenshots in both ONYX and POLAR; diffs against baselines under e2e/baselines/toolcards/.',
    tier: 'manual',
    mockStrategy: 'golden',
    notes: [
      'Per CD WP-2.7b: this is the baseline-capture pass. First run authors the goldens; subsequent runs diff.',
      '13 tools × 2 themes = 26 baselines.',
      'Pre-req: WP-2.7a CD pre-pass green (one card OK before all 13 ship).',
    ],
  },

  /* ────────────────────────────────────────────────────────────────────── *
   *   build pipeline                                                       *
   * ────────────────────────────────────────────────────────────────────── */

  {
    id: 'vibe-build-3',
    title: 'build_all_vibes spawns 3 builds → all complete → vibe-built fires for each',
    category: 'build',
    flow: 'vibe-build-3',
    automated: false,
    description:
      'Critical-path build orchestration smoke. CD calls build_all_vibes; WebDev runs three subprocess builds; each emits report_build_complete via MCP tool; event-bus publishes vibe_built × 3; user sees three vibe cards land.',
    tier: 'critical',
    mockStrategy: 'mock',
    expectedEvents: [
      { type: 'vibe_built', min: 3 },
      { type: 'build_started', min: 1 },
    ],
    notes: [
      'Mock the WebDev subprocess; assert the bus messages are typed correctly.',
    ],
  },

  {
    id: 'vibe-build-failed',
    title: 'WebDev subprocess errors → report_build_failed → vibe_failed event → no orphan ToolCard',
    category: 'build',
    flow: 'vibe-build-failed',
    automated: false,
    description:
      'Failure-mode coverage: WebDev exits non-zero. The fallback chain (parseTrailingJson + tool_result-scrape + disk-mtime fallback) must NOT silently mask the failure. _debug-webdev-fallback.log must record the recovery attempt; the user sees a failed-build card, not a stuck spinner.',
    tier: 'critical',
    mockStrategy: 'mock',
    expectedEvents: [{ type: 'vibe_failed', min: 1 }],
    notes: [
      'This is the test that GATES removing the fallback chain — see Phase 2 punch-list.',
    ],
  },

  /* ────────────────────────────────────────────────────────────────────── *
   *   image pipeline                                                       *
   * ────────────────────────────────────────────────────────────────────── */

  {
    id: 'hot-swap-success',
    title: 'CD picks approved image → hotswap tool → vibe HTML mutated → assets-panel updates',
    category: 'image-pipeline',
    flow: 'hot-swap-success',
    automated: false,
    description:
      'Happy path: CD calls hotswap(vibe, slot); html-patch-engine swaps src + reconciles USED tags in IMAGES.md; assets_updated + hotswap_complete events fire.',
    tier: 'critical',
    mockStrategy: 'mock',
    expectedEvents: [
      { type: 'hotswap_complete', min: 1 },
      { type: 'assets_updated', min: 1 },
    ],
  },

  {
    id: 'hot-swap-failed-image',
    title: 'hotswap target slot missing → typed error → no partial state',
    category: 'image-pipeline',
    flow: 'hot-swap-failed-image',
    automated: false,
    description:
      'Failure-mode: bad slot id or missing source filename. Tool returns typed error; html-patch-engine does NOT touch disk; IMAGES.md unchanged; user sees error chip.',
    tier: 'merge',
    mockStrategy: 'mock',
    expectedEvents: [{ type: 'hotswap_failed', min: 1 }],
  },

  {
    id: 'brand-asset-generation',
    title: 'generate_image with refs → Nano returns → IMAGES.md INGESTED entry → image_ready event',
    category: 'image-pipeline',
    flow: 'brand-asset-generation',
    automated: false,
    description:
      'End-to-end image-mode: prompt + refs (existing session-folder filenames) → /api/edit-image internals → file lands in session folder → IMAGES.md gets a new INGESTED entry → image_ready event fires.',
    tier: 'merge',
    mockStrategy: 'mock',
    expectedEvents: [{ type: 'image_ready', min: 1 }],
    notes: [
      'Concurrency: 3 parallel calls produce 3 distinct files with no IMAGES.md race.',
    ],
  },

  {
    id: 'image-mode-evaluation',
    title: 'Image-mode upload → CD evaluates via submit_image_verdict → status pill renders',
    category: 'image-pipeline',
    flow: 'image-mode-evaluation',
    automated: false,
    description:
      'User drops 3 images → CD reads each, calls submit_image_verdict for each (pass/advisory/rewrite). The verdict ToolCard renders with verdict pill (✓/≈/✗) + note + filename.',
    tier: 'merge',
    mockStrategy: 'mock',
  },

  /* ────────────────────────────────────────────────────────────────────── *
   *   mcp bus                                                              *
   * ────────────────────────────────────────────────────────────────────── */

  {
    id: 'mcp-bus-fanout',
    title: 'notify_agent role-only → fan-out to all live instances → each delivers once',
    category: 'mcp-bus',
    flow: 'mcp-bus-fanout',
    automated: false,
    description:
      'Bus addressing v2 invariant: when target is "<role>" only, the message lands in every queue keyed by (sessionId, role, instanceId). Two CD instances both receive the message; neither sees the other CD\'s message.',
    tier: 'critical',
    mockStrategy: 'mock',
    notes: [
      'Phase 3 hardening — already shipped behavior, regression test only.',
    ],
  },

  {
    id: 'mcp-bus-orphan-claim',
    title: 'Bridge dies mid-stream → orphan inbox accumulates → fresh instance claims via claim_orphan',
    category: 'mcp-bus',
    flow: 'mcp-bus-orphan-claim',
    automated: false,
    description:
      'Order 66 path: agent bridge dies; messages keep arriving and route to the orphan queue; respawned instance calls claim_orphan and drains the catch-up. No message loss.',
    tier: 'critical',
    mockStrategy: 'mock',
  },

  {
    id: 'mcp-bus-thread-resume',
    title: 'thread_history(threadId) returns full chronological log after partial drain',
    category: 'mcp-bus',
    flow: 'mcp-bus-thread-resume',
    automated: false,
    description:
      'After a drain pulls messages out of the queue, the threadId still resolves to the full chronological list via the messageLog side-store. Used to reconstruct multi-turn conversations.',
    tier: 'merge',
    mockStrategy: 'mock',
  },

  /* ────────────────────────────────────────────────────────────────────── *
   *   director mode                                                        *
   * ────────────────────────────────────────────────────────────────────── */

  {
    id: 'director-mode-revert',
    title: 'apply_patch records diff → revert restores → director-original survives',
    category: 'director-mode',
    flow: 'director-mode-revert',
    automated: false,
    description:
      'apply_patch mutates a vibe HTML; the diff is captured for revert; user clicks revert in Director Mode UI; original content restored byte-for-byte.',
    tier: 'merge',
    mockStrategy: 'mock',
  },

  {
    id: 'director-mode-commit',
    title: 'Director toggle OFF after edits → director_save event → CD receives diff',
    category: 'director-mode',
    flow: 'director-mode-commit',
    automated: false,
    description:
      'Push notification path: Director Mode commits 3 edits, fires a single director_save event with {vibe, diff, savedAt}. CD\'s notification channel receives it (no vibe_diff polling needed for this case).',
    tier: 'merge',
    mockStrategy: 'mock',
    expectedEvents: [{ type: 'director_save', min: 1 }],
  },

  /* ────────────────────────────────────────────────────────────────────── *
   *   sage                                                                 *
   * ────────────────────────────────────────────────────────────────────── */

  {
    id: 'sage-cut-recovery',
    title: 'Sage 240/40 destructive cut → 24h snapshot retention → recoverable from .sage-snapshots/',
    category: 'sage',
    flow: 'sage-cut-recovery',
    automated: false,
    description:
      'Mitigation regression: Sage cuts wrong tissue (heuristic), but the pre-prune snapshot under .sage-snapshots/<ts>/ contains the lost content. Recovery script restores from snapshot; SESSION.md byte-equivalent to pre-cut.',
    tier: 'critical',
    mockStrategy: 'mock',
    notes: [
      'NOT a fix for Sage 240/40 root cause — that\'s WP-F2 deterministic cut.',
      'This test ensures the mitigation never silently regresses.',
    ],
  },

  /* ────────────────────────────────────────────────────────────────────── *
   *   order66                                                              *
   * ────────────────────────────────────────────────────────────────────── */

  {
    id: 'order66-bridge-respawn',
    title: 'Order 66 → all bridges die → respawn → replay_events catch-up → no missed events',
    category: 'order66',
    flow: 'order66-bridge-respawn',
    automated: false,
    description:
      'Cinematic compaction overlay completes; all agent bridges respawn; replayRecent (per-session ring buffer) delivers events that fired during the dead window so vibe_built / image_ready / director_save are not lost.',
    tier: 'critical',
    mockStrategy: 'mock',
    notes: [
      'Audio playback regression — verified separately. This case covers the bridge / event-bus contract only.',
    ],
  },

  {
    id: 'order65-soft-compaction',
    title: 'Order 65 soft compaction → CD context summarized → continue without restart',
    category: 'order66',
    flow: 'order65-soft-compaction',
    automated: false,
    description:
      'Lighter cousin of Order 66: CD summarizes its working context in-place; bus stays warm; UI shows a brief snackbar; no respawn.',
    tier: 'merge',
    mockStrategy: 'mock',
  },

  /* ────────────────────────────────────────────────────────────────────── *
   *   brand-lint                                                           *
   * ────────────────────────────────────────────────────────────────────── */

  {
    id: 'lint-brand-compliance-fail',
    title: 'lint_brand_compliance flags missing data-slot AND broken src — exact 2-rule scope',
    category: 'brand-lint',
    flow: 'lint-brand-compliance-fail',
    automated: false,
    description:
      'V1 scope assertion. Fixture vibe HTML has one <img> missing data-slot and one <img src="ghost.jpg"> where ghost.jpg is missing on disk. Linter returns exactly 2 violations. Adding a third rule fails this test (locks v1 scope).',
    tier: 'critical',
    mockStrategy: 'mock',
    notes: [
      'Mirrors lib/__tests__/brand-lint-scope.test.ts but at e2e level.',
    ],
  },
];

/* ────────────────────────────────────────────────────────────────────── *
 *   Index helpers                                                        *
 * ────────────────────────────────────────────────────────────────────── */

export const caseIndex: UICaseIndex = {
  all: uiCases,
  byId(id) {
    return uiCases.find((c) => c.id === id);
  },
  byCategory(category) {
    return uiCases.filter((c) => c.category === category);
  },
  byFlow(flow) {
    return uiCases.find((c) => c.flow === flow);
  },
  byTier(tier) {
    return uiCases.filter((c) => c.tier === tier);
  },
};

/**
 * Defensive sanity invariant — the union in types.ts MUST stay in lockstep
 * with this registry. Keep this short list at the module scope so a missing
 * flow surfaces as an unused-import / dead-code warning rather than a
 * silent loss of coverage.
 */
const FLOW_COUNT_EXPECTED = 19;
if (uiCases.length !== FLOW_COUNT_EXPECTED) {
  // eslint-disable-next-line no-console
  console.warn(
    `[uiCases] expected ${FLOW_COUNT_EXPECTED} cases, registry holds ${uiCases.length}. ` +
      `If you added a flow, bump FLOW_COUNT_EXPECTED. If you removed one, decide first.`,
  );
}
