/**
 * Tests for SketchEditor persistence helpers (toSketchDocument /
 * fromSketchDocument).
 *
 * The interactive canvas is best covered by Playwright (DPR + ResizeObserver
 * + pointer events all need a real browser); unit-level coverage here locks
 * the JSON envelope contract — the version field, malformed-input
 * resilience, and round-trip equality.
 */
import { describe, expect, it } from 'vitest';
import {
  toSketchDocument,
  fromSketchDocument,
  type SketchItem,
} from './SketchEditor';

describe('SketchDocument round-trip', () => {
  const items: SketchItem[] = [
    {
      kind: 'pen',
      points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 8 }],
      color: '#000',
      size: 2,
    },
    { kind: 'rect', x: 10, y: 10, w: 50, h: 30, color: '#333', size: 2 },
    { kind: 'arrow', x1: 0, y1: 0, x2: 50, y2: 50, color: '#900', size: 3 },
    { kind: 'text', x: 5, y: 30, text: 'hi', color: '#000', size: 16 },
  ];

  it('toSketchDocument wraps items with version=1', () => {
    const doc = toSketchDocument(items);
    expect(doc.version).toBe(1);
    expect(doc.items).toBe(items);
  });

  it('fromSketchDocument reverses toSketchDocument', () => {
    const doc = toSketchDocument(items);
    const round = fromSketchDocument(JSON.parse(JSON.stringify(doc)));
    expect(round).toEqual(items);
  });

  it('fromSketchDocument returns null for non-objects', () => {
    expect(fromSketchDocument(null)).toBeNull();
    expect(fromSketchDocument('str')).toBeNull();
    expect(fromSketchDocument(42)).toBeNull();
  });

  it('fromSketchDocument returns null for unknown version', () => {
    expect(fromSketchDocument({ version: 2, items: [] })).toBeNull();
    expect(fromSketchDocument({ items: [] })).toBeNull();
  });

  it('fromSketchDocument returns null when items is not an array', () => {
    expect(fromSketchDocument({ version: 1, items: 'nope' })).toBeNull();
    expect(fromSketchDocument({ version: 1 })).toBeNull();
  });
});
