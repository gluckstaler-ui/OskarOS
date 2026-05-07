/**
 * SSE frame parser.
 *
 * Source: external/open-design/apps/web/src/providers/sse.ts
 * Ported 2026-05-02 (FEATURE-X §1.4 WP-2.2, Phase 2 Commit A foundation).
 *
 * Splits a single SSE "frame" (the chunk between two blank-line separators)
 * into its constituent fields per the WHATWG SSE spec subset that browsers
 * actually implement:
 *
 *   - `event: <name>`  — event name (defaults to `'message'`)
 *   - `id: <id>`       — last-event-id passthrough
 *   - `data: <json>`   — JSON payload; multi-line `data:` values are joined
 *                        with a newline before parsing
 *   - `: <comment>`    — comment line (kept and surfaced to consumers; keeps
 *                        keep-alive heartbeats observable in tests)
 *
 * Returns `null` ONLY when a `data:` block fails to JSON-parse — that's the
 * one case a consumer probably wants to surface as a hard error rather than
 * silently drop. Empty frames and pure-comment frames are returned with their
 * own discriminants so the consumer can decide what to do.
 *
 * Pair with `lib/types/chat-sse.ts` (WP-2.1) for typed-event narrowing:
 *
 *   const parsed = parseSseFrame(frame);
 *   if (parsed?.kind === 'event' && isChatSseEvent({ event: parsed.event, data: parsed.data })) {
 *     // typed ChatSseEvent here
 *   }
 */

export type ParsedSseFrame =
  | { kind: 'event'; event: string; data: Record<string, unknown>; id?: string }
  | { kind: 'comment'; comment: string }
  | { kind: 'empty' };

export function parseSseFrame(frame: string): ParsedSseFrame | null {
  const lines = frame.split('\n');
  const comments: string[] = [];
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith(':')) {
      comments.push(line.slice(1).trimStart());
    } else if (line.startsWith('event: ')) {
      event = line.slice(7).trim();
    } else if (line.startsWith('id: ')) {
      id = line.slice(4).trim();
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6));
    }
  }

  if (dataLines.length === 0) {
    if (comments.length > 0) {
      return { kind: 'comment', comment: comments.join('\n') };
    }
    return { kind: 'empty' };
  }

  try {
    return { kind: 'event', event, data: JSON.parse(dataLines.join('\n')), ...(id ? { id } : {}) };
  } catch {
    return null;
  }
}

/**
 * Stateful frame splitter for streaming consumers.
 *
 * Feed it raw text chunks from `Response.body.getReader()`; it accumulates
 * across chunk boundaries and emits each complete frame (terminated by a
 * blank line) through the provided `onFrame` callback.
 *
 * Why this exists: a single `Response.body` chunk can contain (a) a
 * partial frame, (b) multiple complete frames, or (c) a complete frame plus
 * the start of the next one. Without buffering across chunks, you drop
 * fields. With buffering, the parser stays pure (`parseSseFrame` itself
 * takes a complete frame).
 *
 * Usage:
 *
 *   const splitter = createSseFrameSplitter((parsed) => {
 *     if (parsed?.kind === 'event') handleTypedEvent(parsed);
 *   });
 *   const reader = response.body!.getReader();
 *   const decoder = new TextDecoder();
 *   while (true) {
 *     const { done, value } = await reader.read();
 *     if (done) { splitter.flush(); break; }
 *     splitter.feed(decoder.decode(value, { stream: true }));
 *   }
 */
export function createSseFrameSplitter(
  onFrame: (frame: ParsedSseFrame | null) => void,
) {
  let buffer = '';

  function emitCompleteFrames() {
    // Frames are separated by a blank line: `\n\n` (or `\r\n\r\n`). Normalize
    // CRLF first so we have one separator to split on.
    buffer = buffer.replace(/\r\n/g, '\n');

    let sepIdx = buffer.indexOf('\n\n');
    while (sepIdx !== -1) {
      const frame = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      if (frame.length > 0) {
        onFrame(parseSseFrame(frame));
      }
      sepIdx = buffer.indexOf('\n\n');
    }
  }

  return {
    feed(chunk: string) {
      buffer += chunk;
      emitCompleteFrames();
    },
    flush() {
      // If anything's left and it isn't just whitespace, treat it as a final
      // frame (some servers emit the last frame without a trailing blank
      // line on close).
      const tail = buffer.trim();
      if (tail.length > 0) {
        onFrame(parseSseFrame(buffer));
        buffer = '';
      }
    },
    /** Test/debug — peek at the unflushed remainder. */
    pending(): string {
      return buffer;
    },
  };
}
