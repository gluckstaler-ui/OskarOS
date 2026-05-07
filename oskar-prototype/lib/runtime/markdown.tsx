/**
 * Pocket-sized markdown renderer for OskarOS chat messages.
 *
 * Source: external/open-design/apps/web/src/runtime/markdown.tsx
 * Ported 2026-05-02 (FEATURE-X §1.4 WP-2.3, Phase 2 Commit A foundation).
 *
 * Why hand-rolled
 * ---------------
 * Chat output rarely uses the long tail of markdown features (no nested
 * blockquotes, no setext headings, no reference links). A walker + regex
 * pass keeps the bundle slim and makes the rendered tree fully typed React
 * — no `dangerouslySetInnerHTML`, so untrusted text can't smuggle markup
 * through.
 *
 * Coverage
 * --------
 * - Block-level: ATX headings (# … ###), fenced code (```), ordered (1.)
 *   and unordered (- / * / +) lists, paragraphs, horizontal rules, blank-
 *   line separation, blockquotes (with status-callout variants), and
 *   GFM-style pipe tables (Ralph 2026-05-06 — extended past OD).
 * - Inline: backtick code spans, **bold** / __bold__, *italic* / _italic_,
 *   bracketed [text](href) links, autolinked bare URLs, hard-break newlines
 *   inside paragraphs.
 *
 * What's NOT supported
 * --------------------
 * - Nested lists (single-depth only).
 * - Reference-style links / images.
 * - Setext headings (`====`/`----` underlines).
 * - Inline pipes inside table cells (escape with backtick code spans if
 *   needed; the table parser splits naively on `|`).
 *
 * OskarOS extension
 * -----------------
 * `renderMarkdown(input, { codeBlockOverride })` lets consumers (e.g. the
 * existing ConversationPanel) hook specific fenced-code languages — for
 * example to hide `image-analysis` blocks or to suppress `json` blocks that
 * contain `tool_use` payloads. When `codeBlockOverride` returns a non-null
 * ReactNode, that node replaces the default `<pre><code>` rendering. When
 * it returns `null` explicitly, the block is omitted entirely. When it
 * returns `undefined` (or no override is supplied), the default render runs.
 */
import { Fragment, type ReactNode } from 'react';

export interface RenderMarkdownOptions {
  /**
   * Language-specific code-block override.
   *
   * Return a ReactNode to replace the default render, `null` to suppress
   * the block, or `undefined` to fall through to the default.
   */
  codeBlockOverride?: (lang: string | null, body: string) => ReactNode | null | undefined;
}

export function renderMarkdown(input: string, options: RenderMarkdownOptions = {}): ReactNode {
  const blocks = parseBlocks(input);
  return (
    <>
      {blocks.map((b, i) => renderBlock(b, i, options))}
    </>
  );
}

/** Per-column alignment derived from the GFM separator row (`:---`, `---:`, `:---:`). */
export type TableAlign = 'left' | 'center' | 'right' | null;

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'code'; lang: string | null; body: string }
  | { kind: 'hr' }
  | { kind: 'bq'; text: string } // blockquote — added per CD's WP-2.3 design spec (FEATURE-X §1.4.3, 2026-05-02)
  | { kind: 'table'; header: string[]; align: TableAlign[]; rows: string[][] }; // GFM pipe tables — added per Ralph 2026-05-06

/**
 * Split a single line into cells by `|`, trimming surrounding whitespace.
 * Strips a leading and/or trailing pipe (both are optional in GFM).
 * Returns an empty array for lines with no pipes.
 * (Ralph 2026-05-06.)
 */
function parseTableRow(line: string): string[] {
  if (!line.includes('|')) return [];
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // NOTE: this minimal split treats every `|` as a delimiter. Inline-code
  // pipes (rare in chat) are not protected; if it becomes a problem we can
  // upgrade to backtick-aware splitting.
  return s.split('|').map((c) => c.trim());
}

function parseBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }
    // Fenced code block.
    const fence = /^```(\w[\w+-]*)?\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? null;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        buf.push(lines[i] ?? '');
        i++;
      }
      // Skip the closing fence (if present).
      if (i < lines.length) i++;
      out.push({ kind: 'code', lang, body: buf.join('\n') });
      continue;
    }
    // ATX heading.
    const heading = /^(#{1,4})\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length as 1 | 2 | 3 | 4;
      out.push({ kind: 'h', level, text: heading[2]! });
      i++;
      continue;
    }
    // Horizontal rule.
    if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      out.push({ kind: 'hr' });
      i++;
      continue;
    }
    // Blockquote — added per CD's WP-2.3 spec. Greedy collect of `> ...` lines
    // joined with newlines so renderInline preserves hard breaks. Empty
    // continuation `>` lines flush the block.
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) {
        buf.push((lines[i] ?? '').replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push({ kind: 'bq', text: buf.join('\n') });
      continue;
    }
    // GFM pipe table. Detected by header row + separator row of dashes.
    // Header:    | col | col | col |   (leading + trailing pipes optional)
    // Separator: | --- | :--- | ---: |  (must come immediately after header)
    // Body rows: greedy until a non-pipe line.
    // (Ralph 2026-05-06 — chat surface needs structured comparison data.)
    if (line.includes('|') && i + 1 < lines.length) {
      const nextLine = lines[i + 1] ?? '';
      const headerCells = parseTableRow(line);
      const sepCells = parseTableRow(nextLine);
      const isValidSep =
        sepCells.length > 0 &&
        sepCells.length === headerCells.length &&
        sepCells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
      if (headerCells.length > 0 && isValidSep) {
        const align: TableAlign[] = sepCells.map((c) => {
          const t = c.trim();
          const left = t.startsWith(':');
          const right = t.endsWith(':');
          if (left && right) return 'center';
          if (right) return 'right';
          if (left) return 'left';
          return null;
        });
        const rows: string[][] = [];
        i += 2; // consume header + separator
        while (i < lines.length) {
          const row = lines[i] ?? '';
          if (row.trim() === '' || !row.includes('|')) break;
          const cells = parseTableRow(row);
          if (cells.length === 0) break;
          // Pad / trim to header column count so the row count is stable.
          while (cells.length < headerCells.length) cells.push('');
          rows.push(cells.slice(0, headerCells.length));
          i++;
        }
        out.push({ kind: 'table', header: headerCells, align, rows });
        continue;
      }
    }
    // Unordered list. Group consecutive items.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      out.push({ kind: 'ul', items });
      continue;
    }
    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push({ kind: 'ol', items });
      continue;
    }
    // Paragraph: greedy until a blank line or another block-starter.
    const buf: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i] ?? '';
      if (next.trim() === '') break;
      if (/^```/.test(next)) break;
      if (/^#{1,4}\s+/.test(next)) break;
      if (/^\s*[-*+]\s+/.test(next)) break;
      if (/^\s*\d+\.\s+/.test(next)) break;
      if (/^\s*>\s?/.test(next)) break;
      buf.push(next);
      i++;
    }
    out.push({ kind: 'p', text: buf.join('\n') });
  }
  return out;
}

function renderBlock(block: Block, key: number, options: RenderMarkdownOptions): ReactNode {
  if (block.kind === 'p') {
    return <p key={key} className="md-p">{renderInline(block.text)}</p>;
  }
  if (block.kind === 'h') {
    const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4');
    return <Tag key={key} className={`md-h md-h${block.level}`}>{renderInline(block.text)}</Tag>;
  }
  if (block.kind === 'ul') {
    return (
      <ul key={key} className="md-ul">
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }
  if (block.kind === 'ol') {
    return (
      <ol key={key} className="md-ol">
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ol>
    );
  }
  if (block.kind === 'code') {
    if (options.codeBlockOverride) {
      const override = options.codeBlockOverride(block.lang, block.body);
      if (override === null) return null; // explicit suppress
      if (override !== undefined) {
        return <Fragment key={key}>{override}</Fragment>;
      }
    }
    return (
      <pre key={key} className="md-code">
        <code data-lang={block.lang ?? undefined}>{block.body}</code>
      </pre>
    );
  }
  if (block.kind === 'hr') {
    return <hr key={key} className="md-hr" />;
  }
  if (block.kind === 'bq') {
    // Callout-variant detection per CD's WP-2.3 REVISED spec (Ralph 2026-05-02):
    // first-character glyph maps to a status data-kind so .md-bq[data-kind="..."]
    // CSS rules (in app/globals.css) can shift bg + border to status semantics.
    const trimmed = block.text.trimStart();
    let kind: 'warn' | 'success' | 'info' | 'error' | undefined;
    let bodyText = block.text;
    if (/^⚠️?\s+/.test(trimmed)) {
      kind = 'warn';
      bodyText = trimmed.replace(/^⚠️?\s+/, '');
    } else if (/^(✓|✅)\s+/.test(trimmed)) {
      kind = 'success';
      bodyText = trimmed.replace(/^(✓|✅)\s+/, '');
    } else if (/^ℹ️?\s+/.test(trimmed)) {
      kind = 'info';
      bodyText = trimmed.replace(/^ℹ️?\s+/, '');
    } else if (/^(✗|❌)\s+/.test(trimmed)) {
      kind = 'error';
      bodyText = trimmed.replace(/^(✗|❌)\s+/, '');
    }
    return (
      <blockquote
        key={key}
        className="md-bq"
        {...(kind ? { 'data-kind': kind } : {})}
      >
        {renderInline(bodyText)}
      </blockquote>
    );
  }
  if (block.kind === 'table') {
    // GFM pipe table — semantic <table>/<thead>/<tbody> with per-column
    // text-align driven by the separator-row syntax. Styled via .md-table
    // in app/globals.css (Bento × Territory grammar — pill-bg headers,
    // border-card row separators, JetBrains Mono for header labels).
    // (Ralph 2026-05-06.)
    return (
      <table key={key} className="md-table">
        <thead>
          <tr>
            {block.header.map((cell, i) => (
              <th
                key={i}
                style={block.align[i] ? { textAlign: block.align[i]! } : undefined}
              >
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  style={block.align[c] ? { textAlign: block.align[c]! } : undefined}
                >
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return null;
}

// Inline pass: tokenize into runs of `code`, **bold**, *italic*, links,
// and plain text. We walk the string with a regex that matches whichever
// delimiter shows up next; everything between delimiters becomes a text
// span (which itself still gets autolink scanning).
function renderInline(text: string): ReactNode {
  const out: ReactNode[] = [];
  // Order matters: inline code first so its contents are not re-tokenized
  // as bold/italic.
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > lastIndex) {
      pushText(out, text.slice(lastIndex, m.index), key++);
    }
    if (m[1]) {
      out.push(
        <code key={key++} className="md-inline-code">
          {m[1].slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<strong key={key++}>{m[2].slice(2, -2)}</strong>);
    } else if (m[3]) {
      out.push(<strong key={key++}>{m[3].slice(2, -2)}</strong>);
    } else if (m[4]) {
      out.push(<em key={key++}>{m[4].slice(1, -1)}</em>);
    } else if (m[5]) {
      out.push(<em key={key++}>{m[5].slice(1, -1)}</em>);
    } else if (m[6] && m[7]) {
      out.push(
        <a
          key={key++}
          className="md-link"
          href={m[7]}
          target="_blank"
          rel="noreferrer noopener"
        >
          {m[6]}
        </a>,
      );
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    pushText(out, text.slice(lastIndex), key++);
  }
  return <Fragment>{out}</Fragment>;
}

// Walk a plain text run, autolinking bare URLs and preserving the rest as
// text nodes. Newlines inside a paragraph become explicit <br />s — the
// upstream parser has already left them in place because chat output
// often relies on hard line breaks rather than blank-line separation.
function pushText(out: ReactNode[], text: string, baseKey: number): void {
  if (!text) return;
  const urlRe = /(https?:\/\/[^\s)]+)/g;
  const segments: ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = urlRe.exec(text))) {
    if (m.index > lastIndex) {
      segments.push(...withBreaks(text.slice(lastIndex, m.index), `${baseKey}-${k++}`));
    }
    segments.push(
      <a
        key={`${baseKey}-${k++}`}
        className="md-link"
        href={m[1]}
        target="_blank"
        rel="noreferrer noopener"
      >
        {m[1]}
      </a>,
    );
    lastIndex = urlRe.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push(...withBreaks(text.slice(lastIndex), `${baseKey}-${k++}`));
  }
  out.push(<Fragment key={baseKey}>{segments}</Fragment>);
}

function withBreaks(text: string, baseKey: string): ReactNode[] {
  const parts = text.split('\n');
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push(<br key={`${baseKey}-br-${i}`} />);
    if (part) out.push(<Fragment key={`${baseKey}-t-${i}`}>{part}</Fragment>);
  });
  return out;
}
