/**
 * MentionPopover — @-mention typeahead for the chat composer.
 *
 * Source: external/open-design/apps/web/src/components/ChatComposer.tsx
 * (~80 LOC extracted from the larger composer; ~lines 472-514).
 * Ported 2026-05-02 (FEATURE-X §1.4 WP-3.4, Phase 3 Commit D).
 *
 * Adaptation
 * ----------
 * - `ProjectFile` shape replaced with OskarOS-shaped `MentionItem`. OskarOS
 *   uses session-scoped files (vibe HTML, brand assets, IMAGES.md, etc.)
 *   rather than OD project files. Source-list resolution is the consumer's
 *   responsibility — pass the right list in.
 * - Standalone component (not embedded in ChatComposer). Wired into the
 *   existing `components/ConversationPanel.tsx` composer in a follow-up
 *   integration step; this module ships the popover surface only.
 * - Class names follow OD: `.mention-popover` + `.mention-item` +
 *   `.mention-meta`. Style hook in `app/globals.css` under "MENTION POPOVER".
 *
 * Composer-side filter logic
 * --------------------------
 * The query regex that opens the popover lives in the composer (per OD's
 * pattern: `/(^|\s)@([^\s@]*)$/.exec(beforeCursorText)`). The popover
 * renders only the filtered list and emits `onPick(path)`; the composer
 * does the textarea splicing.
 */
'use client';

import * as React from 'react';
import { useEffect, useRef } from 'react';

export interface MentionItem {
  /** Display key — typically a relative path. */
  path: string;
  /** Human-readable label override. Defaults to `path`. */
  label?: string;
  /** Bytes. Optional — if present, rendered as a meta chip. */
  size?: number;
  /** Optional thumbnail / glyph url. */
  thumbnail?: string;
}

interface Props {
  items: MentionItem[];
  onPick: (path: string) => void;
  /** Optional: limit visible rows; useful for very large mention sources. */
  maxItems?: number;
}

export function MentionPopover({ items, onPick, maxItems = 12 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [items]);
  const visible = items.slice(0, maxItems);
  const hidden = items.length - visible.length;
  return (
    <div
      className="mention-popover"
      data-testid="mention-popover"
      ref={ref}
      role="listbox"
    >
      {visible.map((it) => (
        <button
          key={it.path}
          type="button"
          className="mention-item"
          onClick={() => onPick(it.path)}
          role="option"
        >
          <code>{it.label ?? it.path}</code>
          {it.size != null ? (
            <span className="mention-meta">{prettySize(it.size)}</span>
          ) : null}
        </button>
      ))}
      {hidden > 0 ? (
        <div className="mention-overflow">+{hidden} more — refine query</div>
      ) : null}
    </div>
  );
}

/**
 * Standard query regex used by composers: detects a fresh `@` at start or
 * after whitespace, captures the in-progress query. Exported so the consumer
 * (ConversationPanel composer) can stay in lockstep with this popover.
 */
export const MENTION_QUERY_RE = /(^|\s)@([^\s@]*)$/;

/**
 * Standard filter — case-insensitive substring on `path` then `label`.
 * Pulled out so it's shared between the composer and any test harness.
 */
export function filterMentionItems(
  items: MentionItem[],
  query: string,
): MentionItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((it) => {
    if (it.path.toLowerCase().includes(q)) return true;
    if (it.label && it.label.toLowerCase().includes(q)) return true;
    return false;
  });
}

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
