/**
 * Vitest companion for `lib/runtime/markdown.tsx`.
 *
 * Coverage focus
 * --------------
 * Block-level: headings, paragraphs, fenced code, ordered/unordered lists,
 * horizontal rule, blank-line separation.
 * Inline: code spans, bold/italic (both delimiter pairs), bracket links,
 * autolinks, hard-break newlines.
 * Safety: no `dangerouslySetInnerHTML` anywhere in the output.
 * OskarOS extension: codeBlockOverride hook for per-language replacement
 * and suppression.
 *
 * We use a tiny `walk()` helper to traverse the React tree as plain JS rather
 * than reaching for a DOM library — keeps the test runner light and the
 * assertions explicit about what's being inspected.
 */
import React, { type ReactNode, isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

interface NodeShape {
  type: string;
  props: Record<string, unknown>;
  children: NodeShape[];
  text?: string;
}

function walk(node: ReactNode): NodeShape[] {
  const out: NodeShape[] = [];
  const visit = (n: ReactNode) => {
    if (n === null || n === undefined || n === false) return;
    if (typeof n === 'string' || typeof n === 'number') {
      out.push({ type: '#text', props: {}, children: [], text: String(n) });
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (isValidElement(n)) {
      const el = n as React.ReactElement<{ children?: ReactNode }>;
      const t = typeof el.type === 'string' ? el.type : (el.type as { displayName?: string; name?: string }).name ?? 'Fragment';
      const childrenList: NodeShape[] = [];
      const inner: NodeShape[] = [];
      const pushedBefore = out.length;
      // Walk children directly using a sub-collector.
      const subOut: NodeShape[] = [];
      const subVisit = (m: ReactNode) => {
        if (m === null || m === undefined || m === false) return;
        if (typeof m === 'string' || typeof m === 'number') {
          subOut.push({ type: '#text', props: {}, children: [], text: String(m) });
          return;
        }
        if (Array.isArray(m)) { m.forEach(subVisit); return; }
        if (isValidElement(m)) {
          subOut.push(walkOne(m));
        }
      };
      const kids = (el.props as { children?: ReactNode })?.children;
      if (kids !== undefined) subVisit(kids);
      out.push({
        type: t,
        props: { ...(el.props as Record<string, unknown>), children: undefined },
        children: subOut,
      });
      void childrenList; void inner; void pushedBefore;
    }
  };
  const walkOne = (el: React.ReactElement): NodeShape => {
    const t = typeof el.type === 'string' ? el.type : (el.type as { displayName?: string; name?: string }).name ?? 'Fragment';
    const subOut: NodeShape[] = [];
    const subVisit = (m: ReactNode) => {
      if (m === null || m === undefined || m === false) return;
      if (typeof m === 'string' || typeof m === 'number') {
        subOut.push({ type: '#text', props: {}, children: [], text: String(m) });
        return;
      }
      if (Array.isArray(m)) { m.forEach(subVisit); return; }
      if (isValidElement(m)) subOut.push(walkOne(m));
    };
    const kids = (el.props as { children?: ReactNode })?.children;
    if (kids !== undefined) subVisit(kids);
    return {
      type: t,
      props: { ...(el.props as Record<string, unknown>), children: undefined },
      children: subOut,
    };
  };
  visit(node);
  return out;
}

function flatText(nodes: NodeShape[]): string {
  let s = '';
  for (const n of nodes) {
    if (n.type === '#text') s += n.text ?? '';
    else s += flatText(n.children);
  }
  return s;
}

function findAll(nodes: NodeShape[], type: string): NodeShape[] {
  const out: NodeShape[] = [];
  for (const n of nodes) {
    if (n.type === type) out.push(n);
    out.push(...findAll(n.children, type));
  }
  return out;
}

describe('renderMarkdown — block-level', () => {
  it('renders paragraphs', () => {
    const tree = walk(renderMarkdown('hello world'));
    expect(findAll(tree, 'p')).toHaveLength(1);
    expect(flatText(tree)).toBe('hello world');
  });

  it('renders heading levels 1-4', () => {
    const tree = walk(renderMarkdown('# H1\n\n## H2\n\n### H3\n\n#### H4'));
    expect(findAll(tree, 'h1')).toHaveLength(1);
    expect(findAll(tree, 'h2')).toHaveLength(1);
    expect(findAll(tree, 'h3')).toHaveLength(1);
    expect(findAll(tree, 'h4')).toHaveLength(1);
  });

  it('renders fenced code with language attribute', () => {
    const tree = walk(renderMarkdown('```ts\nconst x = 1;\n```'));
    const pre = findAll(tree, 'pre');
    expect(pre).toHaveLength(1);
    const code = findAll(pre, 'code');
    expect(code).toHaveLength(1);
    expect((code[0]!.props as { 'data-lang'?: string })['data-lang']).toBe('ts');
    expect(flatText(code[0]!.children)).toBe('const x = 1;');
  });

  it('renders unordered lists', () => {
    const tree = walk(renderMarkdown('- one\n- two\n- three'));
    const ul = findAll(tree, 'ul');
    expect(ul).toHaveLength(1);
    expect(findAll(ul, 'li')).toHaveLength(3);
  });

  it('renders ordered lists', () => {
    const tree = walk(renderMarkdown('1. first\n2. second'));
    const ol = findAll(tree, 'ol');
    expect(ol).toHaveLength(1);
    expect(findAll(ol, 'li')).toHaveLength(2);
  });

  it('renders horizontal rule', () => {
    const tree = walk(renderMarkdown('above\n\n---\n\nbelow'));
    expect(findAll(tree, 'hr')).toHaveLength(1);
  });

  it('renders blockquote (CD WP-2.3 extension)', () => {
    const tree = walk(
      renderMarkdown(
        "> Grandma's Waiting. She's already made too much food. Don't be late.",
      ),
    );
    const bq = findAll(tree, 'blockquote');
    expect(bq).toHaveLength(1);
    expect(flatText(bq[0]!.children)).toContain("Grandma's Waiting");
  });

  it('renders multi-line blockquote with hard breaks', () => {
    const tree = walk(renderMarkdown('> line one\n> line two\n> line three'));
    const bq = findAll(tree, 'blockquote');
    expect(bq).toHaveLength(1);
    // Hard breaks inside blockquote => <br>
    expect(findAll(bq, 'br').length).toBeGreaterThan(0);
  });

  it('blockquote terminates a paragraph', () => {
    const tree = walk(renderMarkdown('Plain prose\n> quoted line'));
    expect(findAll(tree, 'p')).toHaveLength(1);
    expect(findAll(tree, 'blockquote')).toHaveLength(1);
  });

  it('callout variant: warn (⚠) sets data-kind and strips the glyph', () => {
    const tree = walk(renderMarkdown('> ⚠ Watch out for this.'));
    const bq = findAll(tree, 'blockquote');
    expect(bq).toHaveLength(1);
    expect((bq[0]!.props as { 'data-kind'?: string })['data-kind']).toBe('warn');
    expect(flatText(bq[0]!.children)).toBe('Watch out for this.');
  });

  it('callout variant: success (✓) sets data-kind and strips the glyph', () => {
    const tree = walk(renderMarkdown('> ✓ Built clean.'));
    const bq = findAll(tree, 'blockquote');
    expect((bq[0]!.props as { 'data-kind'?: string })['data-kind']).toBe('success');
    expect(flatText(bq[0]!.children)).toBe('Built clean.');
  });

  it('callout variant: info (ℹ) sets data-kind and strips the glyph', () => {
    const tree = walk(renderMarkdown('> ℹ Just so you know.'));
    const bq = findAll(tree, 'blockquote');
    expect((bq[0]!.props as { 'data-kind'?: string })['data-kind']).toBe('info');
    expect(flatText(bq[0]!.children)).toBe('Just so you know.');
  });

  it('callout variant: error (✗) sets data-kind and strips the glyph', () => {
    const tree = walk(renderMarkdown('> ✗ Build failed.'));
    const bq = findAll(tree, 'blockquote');
    expect((bq[0]!.props as { 'data-kind'?: string })['data-kind']).toBe('error');
    expect(flatText(bq[0]!.children)).toBe('Build failed.');
  });

  it('plain blockquote has NO data-kind attribute', () => {
    const tree = walk(renderMarkdown('> just a quote'));
    const bq = findAll(tree, 'blockquote');
    expect((bq[0]!.props as { 'data-kind'?: string })['data-kind']).toBeUndefined();
  });
});

describe('renderMarkdown — inline', () => {
  it('renders inline code', () => {
    const tree = walk(renderMarkdown('use `npm install`'));
    const codes = findAll(tree, 'code');
    expect(codes).toHaveLength(1);
    expect(flatText(codes[0]!.children)).toBe('npm install');
  });

  it('renders bold (** and __)', () => {
    const tree = walk(renderMarkdown('a **strong** and __also strong__'));
    expect(findAll(tree, 'strong')).toHaveLength(2);
  });

  it('renders italic (* and _)', () => {
    const tree = walk(renderMarkdown('a *em* and _also em_'));
    expect(findAll(tree, 'em')).toHaveLength(2);
  });

  it('renders bracketed links', () => {
    const tree = walk(renderMarkdown('see [docs](https://example.com)'));
    const links = findAll(tree, 'a');
    expect(links).toHaveLength(1);
    expect((links[0]!.props as { href: string }).href).toBe('https://example.com');
    expect(flatText(links[0]!.children)).toBe('docs');
  });

  it('autolinks bare URLs', () => {
    const tree = walk(renderMarkdown('visit https://oskaros.dev for more'));
    const links = findAll(tree, 'a');
    expect(links).toHaveLength(1);
    expect((links[0]!.props as { href: string }).href).toBe('https://oskaros.dev');
  });

  it('renders hard-break newlines as <br>', () => {
    const tree = walk(renderMarkdown('line one\nline two'));
    expect(findAll(tree, 'br')).toHaveLength(1);
  });
});

describe('renderMarkdown — safety', () => {
  it('never produces dangerouslySetInnerHTML', () => {
    const tree = walk(renderMarkdown('# Title\n\n<script>alert(1)</script>\n\n**bold**'));
    const stack: NodeShape[] = [...tree];
    while (stack.length) {
      const n = stack.pop()!;
      expect((n.props as { dangerouslySetInnerHTML?: unknown }).dangerouslySetInnerHTML).toBeUndefined();
      stack.push(...n.children);
    }
  });

  it('treats raw HTML as text, not markup', () => {
    const tree = walk(renderMarkdown('<script>alert(1)</script>'));
    // Nothing was rendered as <script>; the literal text is paragraph content.
    expect(findAll(tree, 'script')).toHaveLength(0);
    expect(flatText(tree)).toContain('<script>');
  });
});

describe('renderMarkdown — codeBlockOverride', () => {
  it('falls through when override returns undefined', () => {
    const tree = walk(
      renderMarkdown('```json\n{}\n```', {
        codeBlockOverride: () => undefined,
      }),
    );
    expect(findAll(tree, 'pre')).toHaveLength(1);
  });

  it('suppresses the block when override returns null', () => {
    const tree = walk(
      renderMarkdown('```json\n{"tool_use":1}\n```\n\nafter', {
        codeBlockOverride: (lang, body) => (lang === 'json' && body.includes('tool_use') ? null : undefined),
      }),
    );
    expect(findAll(tree, 'pre')).toHaveLength(0);
    expect(flatText(tree)).toContain('after');
  });

  it('replaces the block when override returns a node', () => {
    const tree = walk(
      renderMarkdown('```image-analysis\nfoo\n```', {
        codeBlockOverride: (lang) =>
          lang === 'image-analysis' ? <div className="img-analysis-pill">analyzed</div> : undefined,
      }),
    );
    expect(findAll(tree, 'pre')).toHaveLength(0);
    const pills = findAll(tree, 'div').filter(
      (n) => (n.props as { className?: string }).className === 'img-analysis-pill',
    );
    expect(pills).toHaveLength(1);
  });
});
