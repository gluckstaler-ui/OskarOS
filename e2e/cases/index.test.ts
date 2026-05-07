/**
 * Sanity tests for the UICase registry.
 *
 * Locks structural invariants:
 *   - flow union exhaustively covered by registry entries (one per flow)
 *   - 19 entries exactly (matches FEATURE-X §1.4.4 spec)
 *   - id uniqueness
 *   - byId / byCategory / byFlow / byTier indexers behave
 *   - tier distribution is sane (at least one critical, at least one merge)
 */
import { describe, expect, it } from 'vitest';
import { uiCases, caseIndex } from './index';
import type { CaseFlow } from './types';

const ALL_FLOWS: CaseFlow[] = [
  'discovery-question-form',
  'discovery-direction-pick',
  'todo-write-unfinished',
  'tool-card-render-cd-tools',
  'vibe-build-3',
  'vibe-build-failed',
  'hot-swap-success',
  'hot-swap-failed-image',
  'brand-asset-generation',
  'image-mode-evaluation',
  'mcp-bus-fanout',
  'mcp-bus-orphan-claim',
  'mcp-bus-thread-resume',
  'director-mode-revert',
  'director-mode-commit',
  'sage-cut-recovery',
  'order66-bridge-respawn',
  'order65-soft-compaction',
  'lint-brand-compliance-fail',
];

describe('uiCases registry', () => {
  it('contains exactly 19 cases', () => {
    expect(uiCases).toHaveLength(19);
  });

  it('every CaseFlow is covered by exactly one entry', () => {
    for (const flow of ALL_FLOWS) {
      const found = uiCases.filter((c) => c.flow === flow);
      expect(found, `flow ${flow}`).toHaveLength(1);
    }
  });

  it('every id is unique', () => {
    const ids = uiCases.map((c) => c.id);
    const uniq = new Set(ids);
    expect(uniq.size).toBe(ids.length);
  });

  it('contains at least one critical-tier case', () => {
    expect(uiCases.some((c) => c.tier === 'critical')).toBe(true);
  });

  it('contains at least one merge-tier case', () => {
    expect(uiCases.some((c) => c.tier === 'merge')).toBe(true);
  });
});

describe('caseIndex', () => {
  it('byId resolves a known case', () => {
    const c = caseIndex.byId('vibe-build-3');
    expect(c).toBeDefined();
    expect(c?.flow).toBe('vibe-build-3');
  });

  it('byId returns undefined for unknown ids', () => {
    expect(caseIndex.byId('does-not-exist')).toBeUndefined();
  });

  it('byCategory returns all cases in a category', () => {
    const chats = caseIndex.byCategory('chat');
    expect(chats.length).toBeGreaterThanOrEqual(4);
    expect(chats.every((c) => c.category === 'chat')).toBe(true);
  });

  it('byFlow returns the single case for a flow', () => {
    expect(caseIndex.byFlow('mcp-bus-fanout')?.id).toBe('mcp-bus-fanout');
  });

  it('byTier returns all cases at a tier', () => {
    const crit = caseIndex.byTier('critical');
    expect(crit.length).toBeGreaterThan(0);
    expect(crit.every((c) => c.tier === 'critical')).toBe(true);
  });
});
