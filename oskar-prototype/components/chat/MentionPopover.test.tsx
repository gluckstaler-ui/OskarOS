/**
 * Tests for MentionPopover helpers — MENTION_QUERY_RE + filterMentionItems.
 *
 * Render-side smoke (component rendering through React) is covered by the
 * Playwright e2e flow `discovery-question-form` once that ships; vitest
 * here only locks the pure-function contracts that drive the composer.
 */
import { describe, expect, it } from 'vitest';
import {
  MENTION_QUERY_RE,
  filterMentionItems,
  type MentionItem,
} from './MentionPopover';

describe('MENTION_QUERY_RE', () => {
  it('matches @ at start of input', () => {
    const m = MENTION_QUERY_RE.exec('@vib');
    expect(m).not.toBeNull();
    expect(m![2]).toBe('vib');
  });

  it('matches @ after whitespace', () => {
    const m = MENTION_QUERY_RE.exec('hi @im');
    expect(m).not.toBeNull();
    expect(m![2]).toBe('im');
  });

  it('does NOT match @ embedded in word (email-like)', () => {
    const m = MENTION_QUERY_RE.exec('hello a@b.c');
    expect(m).toBeNull();
  });

  it('captures empty query when only @ typed', () => {
    const m = MENTION_QUERY_RE.exec('@');
    expect(m).not.toBeNull();
    expect(m![2]).toBe('');
  });

  it('does not match across whitespace inside the query', () => {
    const m = MENTION_QUERY_RE.exec('@foo bar');
    // Match should fail since the regex anchors at end with [^\s@]*
    expect(m).toBeNull();
  });
});

describe('filterMentionItems', () => {
  const items: MentionItem[] = [
    { path: 'public/2026/vibe-1.html' },
    { path: 'public/2026/vibe-2.html', label: 'Vibe 2 (Editorial)' },
    { path: 'public/2026/IMAGES.md' },
    { path: 'public/2026/CREATIVE-BRIEF.md' },
  ];

  it('returns all items for empty query', () => {
    expect(filterMentionItems(items, '')).toHaveLength(4);
  });

  it('matches case-insensitively against path', () => {
    const out = filterMentionItems(items, 'VIBE');
    expect(out).toHaveLength(2);
  });

  it('matches against label when path misses', () => {
    const out = filterMentionItems(items, 'editorial');
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe('Vibe 2 (Editorial)');
  });

  it('returns empty for no matches', () => {
    expect(filterMentionItems(items, 'nope')).toEqual([]);
  });
});
