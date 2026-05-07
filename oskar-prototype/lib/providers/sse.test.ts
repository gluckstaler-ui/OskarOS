/**
 * Vitest companion for `lib/providers/sse.ts`.
 *
 * Covers:
 *   - basic event frames
 *   - comments
 *   - id passthrough
 *   - multi-line data
 *   - CRLF normalization
 *   - malformed JSON returns null
 *   - empty frame
 *   - createSseFrameSplitter chunk-boundary buffering (both halves of a frame
 *     arriving in separate `feed()` calls; multiple frames in one `feed()`)
 */
import { describe, expect, it } from 'vitest';
import { parseSseFrame, createSseFrameSplitter, type ParsedSseFrame } from './sse';

describe('parseSseFrame', () => {
  it('parses a basic event frame', () => {
    const frame = ['event: agent', 'data: {"type":"text_delta","delta":"hi"}'].join('\n');
    expect(parseSseFrame(frame)).toEqual({
      kind: 'event',
      event: 'agent',
      data: { type: 'text_delta', delta: 'hi' },
    });
  });

  it('passes id through when present', () => {
    const frame = ['id: 42', 'event: start', 'data: {"bin":"claude"}'].join('\n');
    expect(parseSseFrame(frame)).toEqual({
      kind: 'event',
      event: 'start',
      data: { bin: 'claude' },
      id: '42',
    });
  });

  it('defaults event name to "message" when omitted', () => {
    expect(parseSseFrame('data: {"x":1}')).toEqual({
      kind: 'event',
      event: 'message',
      data: { x: 1 },
    });
  });

  it('joins multi-line data with newlines before parsing', () => {
    const frame = ['event: agent', 'data: {"type":"text_delta",', 'data: "delta":"line1\\nline2"}'].join('\n');
    expect(parseSseFrame(frame)).toEqual({
      kind: 'event',
      event: 'agent',
      data: { type: 'text_delta', delta: 'line1\nline2' },
    });
  });

  it('normalizes trailing CR on each line', () => {
    const frame = ['event: agent\r', 'data: {"ok":true}\r'].join('\n');
    expect(parseSseFrame(frame)).toEqual({
      kind: 'event',
      event: 'agent',
      data: { ok: true },
    });
  });

  it('returns comment kind for pure-comment frames', () => {
    expect(parseSseFrame(': keep-alive')).toEqual({
      kind: 'comment',
      comment: 'keep-alive',
    });
  });

  it('returns empty kind for blank frames', () => {
    expect(parseSseFrame('')).toEqual({ kind: 'empty' });
  });

  it('returns null when data is malformed JSON', () => {
    const frame = ['event: agent', 'data: {not-json}'].join('\n');
    expect(parseSseFrame(frame)).toBeNull();
  });
});

describe('createSseFrameSplitter', () => {
  it('emits a frame split across multiple feeds', () => {
    const frames: (ParsedSseFrame | null)[] = [];
    const sp = createSseFrameSplitter((f) => frames.push(f));
    sp.feed('event: agent\n');
    sp.feed('data: {"type":"text_delta","delta":"a"}');
    expect(frames).toHaveLength(0); // no terminator yet
    sp.feed('\n\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      kind: 'event',
      event: 'agent',
      data: { type: 'text_delta', delta: 'a' },
    });
  });

  it('emits multiple frames from one feed', () => {
    const frames: (ParsedSseFrame | null)[] = [];
    const sp = createSseFrameSplitter((f) => frames.push(f));
    sp.feed(
      [
        'event: start',
        'data: {"bin":"claude"}',
        '',
        'event: agent',
        'data: {"type":"text_delta","delta":"hi"}',
        '',
        '',
      ].join('\n'),
    );
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ kind: 'event', event: 'start' });
    expect(frames[1]).toMatchObject({ kind: 'event', event: 'agent' });
  });

  it('handles CRLF separators across chunk boundaries', () => {
    const frames: (ParsedSseFrame | null)[] = [];
    const sp = createSseFrameSplitter((f) => frames.push(f));
    sp.feed('event: agent\r\ndata: {"ok":true}\r');
    sp.feed('\n\r\n');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      kind: 'event',
      event: 'agent',
      data: { ok: true },
    });
  });

  it('flush() drains a final unterminated frame', () => {
    const frames: (ParsedSseFrame | null)[] = [];
    const sp = createSseFrameSplitter((f) => frames.push(f));
    sp.feed('event: end\ndata: {"code":0}');
    expect(frames).toHaveLength(0);
    sp.flush();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      kind: 'event',
      event: 'end',
      data: { code: 0 },
    });
  });

  it('flush() is a no-op when buffer is empty', () => {
    const frames: (ParsedSseFrame | null)[] = [];
    const sp = createSseFrameSplitter((f) => frames.push(f));
    sp.flush();
    expect(frames).toHaveLength(0);
  });

  it('emits null for a frame whose data is malformed', () => {
    const frames: (ParsedSseFrame | null)[] = [];
    const sp = createSseFrameSplitter((f) => frames.push(f));
    sp.feed('event: agent\ndata: {nope}\n\n');
    expect(frames).toEqual([null]);
  });
});
