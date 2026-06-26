/**
 * director-surgery.ts — byte-surgical HTML editor for Director Mode persistence.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 2026-06-19 — Ralph + CD. Replaces the jsdom-`serialize()` round-trip that
 * BOTH `/api/director/save-edits` and the legacy `/api/director/text-edit`
 * used to persist Director-Mode edits.
 *
 * Why this exists (the whack-a-mole we are ending):
 *   jsdom parses the WHOLE document, then `dom.serialize()` re-emits the WHOLE
 *   document. Even a one-attribute change rewrote every byte — normalizing
 *   void tags (`<br/>`→`<br>`), re-encoding entities, reordering nothing but
 *   touching everything, and (the real danger) round-tripping inlined
 *   `<script type="text/babel">` blocks and SVG. On dense vibes that silently
 *   "broke the pages."
 *
 * What this does instead:
 *   1. Parse ONCE with parse5 + `sourceCodeLocationInfo` to get exact byte
 *      offsets for every element, its start/end tags, and each attribute.
 *   2. Resolve the client's structural selector path
 *      (`body > section:nth-of-type(1) > img:nth-of-type(2)` — produced by
 *      `buildSelectorPath` in lib/director-css.ts; the text path adds an
 *      `auto-` prefix which we strip).
 *   3. Compute minimal string SPLICES (replace an attribute's span, insert a
 *      new attribute, replace the inner-text span between start/end tags).
 *   4. Apply splices to the ORIGINAL string, right-to-left. Every byte outside
 *      an edited span is preserved verbatim — scripts, SVG, comments, weird-
 *      but-valid markup, the doctype, all untouched.
 *
 * The selector resolver mirrors `buildSelectorPath` EXACTLY (nth-of-type among
 * same-tag element siblings, 1-based, rooted at <body>) so client and server
 * agree on which node a path names.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { parse } from 'parse5'

// ── Minimal parse5 shapes (avoid dragging the full tree-adapter types) ──────
interface P5Loc {
  startOffset: number
  endOffset: number
  startTag?: { startOffset: number; endOffset: number }
  endTag?: { startOffset: number; endOffset: number }
  attrs?: Record<string, { startOffset: number; endOffset: number }>
}
interface P5Node {
  nodeName: string
  tagName?: string
  attrs?: { name: string; value: string }[]
  childNodes?: P5Node[]
  sourceCodeLocation?: P5Loc | null
}

// ── Public types ────────────────────────────────────────────────────────────

/** One element's worth of edits. All fields optional except `selector`.
 *  `null` on style/imageSrc/preserveAspectRatio means "remove the attribute". */
export interface DirectorEdit {
  /** Structural selector path. `auto-` prefix (text path) is tolerated. */
  selector: string
  /** Full new value for the `style` attribute. '' or null → remove it. */
  style?: string | null
  /** New image URL. Surgery picks `src` (HTML <img>) vs `href`/`xlink:href`
   *  (SVG <image>) by the resolved element's tag. '' or null → remove. */
  imageSrc?: string | null
  /** SVG <image> preserveAspectRatio. null → remove. */
  preserveAspectRatio?: string | null
  /** Replace the element's inner content with this PLAIN text (escaped). */
  text?: string
  /** Replace the element's inner content with this RAW HTML (NOT escaped) —
   *  preserves inline markup (<em>/<br>/<span>) when editing rich elements. */
  innerHtml?: string
  /** Optimistic-concurrency guard: the element's pre-edit inner TEXT as the
   *  client saw it. If the source's current inner text doesn't match (the page's
   *  JS transformed the live DOM — i18n translation, templating — or a stale
   *  write), the edit is REFUSED rather than clobbering the source baseline.
   *  Compared normalized: tags stripped, whitespace collapsed, basic entities
   *  decoded. Omit to skip the check (back-compat). */
  expectText?: string
}

export interface EditResult {
  selector: string
  ok: boolean
  reason?: string
}

export interface SurgeryResult {
  html: string
  results: EditResult[]
  applied: number
}

// ── Escaping ────────────────────────────────────────────────────────────────

/** Escape a value destined for a double-quoted attribute. Only `&` and `"`
 *  are unsafe inside `attr="…"`; `<`/`>` are legal in attribute values and we
 *  leave them so CSS like `url("…")` stays readable after `&`/`"` escaping. */
function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** Escape text-node content. */
function escapeText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Normalize inner HTML to comparable plain text: strip tags (to a space so
 *  `a<br>b` doesn't fuse to `ab`), decode the basic entities, collapse
 *  whitespace. Lets a runtime, browser-serialized snapshot be compared to raw
 *  source bytes for the compare-and-swap guard. */
function normalizeText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Tree walking ────────────────────────────────────────────────────────────

function isElement(n: P5Node | undefined): n is P5Node {
  return !!n && typeof n.tagName === 'string'
}

function elementChildren(n: P5Node): P5Node[] {
  return (n.childNodes || []).filter(isElement)
}

// Inline-only tags that are SAFE to keep when replacing an element's text.
// Mirrors `isTextLeafElement` in lib/director-css.ts (client side) so client
// and server agree on what "a text leaf" is.
const INLINE_SAFE = new Set([
  'b', 'i', 'em', 'strong', 'span', 'u', 's', 'small', 'sub', 'sup',
  'mark', 'br', 'code', 'q', 'cite', 'time', 'abbr', 'kbd', 'samp', 'var', 'wbr',
])

/**
 * True when it is SAFE to replace this element's inner text — i.e. it holds
 * only text and inline-formatting children, never block-level structure.
 *
 * This is the guard that prevents the vibe-3-tiefer catastrophe (2026-06-19):
 * a text edit whose selector resolved to <body> (or any container) replaced
 * the whole subtree with its flattened textContent, stripping every tag. A
 * text-replace must NEVER touch <html>/<body>/<head> or any element with
 * block children.
 */
function isTextLeafNode(el: P5Node): boolean {
  const tag = (el.tagName || '').toLowerCase()
  if (tag === 'html' || tag === 'body' || tag === 'head') return false
  const kids = elementChildren(el)
  if (kids.length === 0) return true
  for (const c of kids) {
    if (!INLINE_SAFE.has((c.tagName || '').toLowerCase())) return false
    if (!isTextLeafNode(c)) return false
  }
  return true
}

function findFirst(n: P5Node, tag: string): P5Node | null {
  if (n.tagName === tag) return n
  for (const c of n.childNodes || []) {
    const hit = findFirst(c, tag)
    if (hit) return hit
  }
  return null
}

const STEP_RE = /^([a-z0-9:-]+)(?::nth-of-type\((\d+)\))?$/i

/** Resolve a `buildSelectorPath`-shaped selector to a parse5 element.
 *  Returns null if any step misses. Mirrors the client walk exactly. */
export function resolveSelector(doc: P5Node, selector: string): P5Node | null {
  const cleaned = selector.replace(/^auto-/, '').trim()
  const parts = cleaned.split('>').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return null
  // First part must be the body root.
  if (parts[0].toLowerCase() !== 'body') return null
  let current = findFirst(doc, 'body')
  if (!current) return null

  for (let i = 1; i < parts.length; i++) {
    const m = parts[i].match(STEP_RE)
    if (!m) return null
    const tag = m[1].toLowerCase()
    const n = m[2] ? parseInt(m[2], 10) : 1
    const sameTag = elementChildren(current).filter(
      (c) => (c.tagName || '').toLowerCase() === tag,
    )
    const next = sameTag[n - 1]
    if (!next) return null
    current = next
  }
  return current
}

// ── Splice planning ─────────────────────────────────────────────────────────

interface Splice {
  start: number
  end: number
  replacement: string
}

function attrLoc(el: P5Node, name: string): { startOffset: number; endOffset: number } | null {
  const attrs = el.sourceCodeLocation?.attrs
  if (!attrs) return null
  // parse5 keys attr locations by lowercase name.
  return attrs[name.toLowerCase()] || null
}

function hasAttr(el: P5Node, name: string): boolean {
  return (el.attrs || []).some((a) => a.name.toLowerCase() === name.toLowerCase())
}

/** Splice that sets (or replaces) one attribute on an element. */
function spliceSetAttr(el: P5Node, name: string, value: string): Splice | null {
  const escaped = escapeAttr(value)
  const loc = attrLoc(el, name)
  if (loc) {
    // Replace the whole `name="old"` span.
    return { start: loc.startOffset, end: loc.endOffset, replacement: `${name}="${escaped}"` }
  }
  // Attribute absent → insert right after the tag name inside the start tag.
  const startTag = el.sourceCodeLocation?.startTag
  if (!startTag || !el.tagName) return null
  const insertPos = startTag.startOffset + 1 + el.tagName.length
  return { start: insertPos, end: insertPos, replacement: ` ${name}="${escaped}"` }
}

/** Splice that removes one attribute (and its leading space) if present. */
function spliceRemoveAttr(el: P5Node, name: string, fullHtml: string): Splice | null {
  const loc = attrLoc(el, name)
  if (!loc) return null
  // Eat one leading whitespace char so we don't leave a double space.
  let start = loc.startOffset
  if (start > 0 && /\s/.test(fullHtml[start - 1])) start -= 1
  return { start, end: loc.endOffset, replacement: '' }
}

/** Splice that replaces the inner-text span (between start and end tags). */
function spliceText(el: P5Node, text: string, raw = false): Splice | null {
  const st = el.sourceCodeLocation?.startTag
  const et = el.sourceCodeLocation?.endTag
  if (!st || !et) return null // void element or unparseable — refuse text edit
  return { start: st.endOffset, end: et.startOffset, replacement: raw ? text : escapeText(text) }
}

const SVG_IMAGE = 'image'

/** Build the splices for one DirectorEdit against its resolved element. */
function planEdit(el: P5Node, edit: DirectorEdit, fullHtml: string): Splice[] {
  const out: Splice[] = []
  const tag = (el.tagName || '').toLowerCase()

  // style
  if (edit.style !== undefined) {
    if (edit.style === null || edit.style.trim() === '') {
      const s = spliceRemoveAttr(el, 'style', fullHtml)
      if (s) out.push(s)
    } else {
      const s = spliceSetAttr(el, 'style', edit.style)
      if (s) out.push(s)
    }
  }

  // imageSrc — pick the right attribute by tag
  if (edit.imageSrc !== undefined) {
    const isSvg = tag === SVG_IMAGE
    const remove = edit.imageSrc === null || edit.imageSrc === ''
    if (isSvg) {
      if (remove) {
        const a = spliceRemoveAttr(el, 'href', fullHtml)
        if (a) out.push(a)
        const b = spliceRemoveAttr(el, 'xlink:href', fullHtml)
        if (b) out.push(b)
      } else {
        const a = spliceSetAttr(el, 'href', edit.imageSrc!)
        if (a) out.push(a)
        // Only update xlink:href if it already exists (legacy renderers).
        if (hasAttr(el, 'xlink:href')) {
          const b = spliceSetAttr(el, 'xlink:href', edit.imageSrc!)
          if (b) out.push(b)
        }
      }
    } else {
      if (remove) {
        const a = spliceRemoveAttr(el, 'src', fullHtml)
        if (a) out.push(a)
      } else {
        const a = spliceSetAttr(el, 'src', edit.imageSrc!)
        if (a) out.push(a)
      }
    }
  }

  // preserveAspectRatio
  if (edit.preserveAspectRatio !== undefined) {
    if (edit.preserveAspectRatio === null) {
      const s = spliceRemoveAttr(el, 'preserveAspectRatio', fullHtml)
      if (s) out.push(s)
    } else {
      const s = spliceSetAttr(el, 'preserveAspectRatio', edit.preserveAspectRatio)
      if (s) out.push(s)
    }
  }

  // inner content — `innerHtml` (raw, preserves markup) takes precedence over
  // plain `text` (escaped).
  if (edit.innerHtml !== undefined) {
    const s = spliceText(el, edit.innerHtml, true)
    if (s) out.push(s)
  } else if (edit.text !== undefined) {
    const s = spliceText(el, edit.text)
    if (s) out.push(s)
  }

  return out
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Apply a batch of Director edits to `html` via byte-surgery. Returns the new
 * HTML and a per-edit result list. Edits whose selector misses, or whose
 * target lacks a needed source location, are reported `ok:false` and skipped —
 * other edits in the batch still apply.
 */
export function applyDirectorEdits(html: string, edits: DirectorEdit[]): SurgeryResult {
  const doc = parse(html, { sourceCodeLocationInfo: true }) as unknown as P5Node

  const results: EditResult[] = []
  const splices: Splice[] = []

  for (const edit of edits) {
    if (!edit.selector) {
      results.push({ selector: '<missing>', ok: false, reason: 'no-selector' })
      continue
    }
    const el = resolveSelector(doc, edit.selector)
    if (!el) {
      results.push({ selector: edit.selector, ok: false, reason: 'not-found' })
      continue
    }
    if (!el.sourceCodeLocation) {
      results.push({ selector: edit.selector, ok: false, reason: 'no-source-location' })
      continue
    }
    // COMPARE-AND-SWAP: refuse to write if the source's current inner text no
    // longer matches what the client edited. The page's JS may have transformed
    // the live DOM (i18n swaps English "The Cellar" for German "Keller"), so the
    // runtime content the client sends is NOT the source baseline — writing it
    // would clobber the source language. Mismatch ⇒ refuse, byte-stable.
    if (edit.expectText !== undefined && (edit.text !== undefined || edit.innerHtml !== undefined)) {
      const st = el.sourceCodeLocation.startTag
      const et = el.sourceCodeLocation.endTag
      const sourceInner = st && et ? html.slice(st.endOffset, et.startOffset) : ''
      if (normalizeText(sourceInner) !== normalizeText(edit.expectText)) {
        results.push({ selector: edit.selector, ok: false, reason: 'stale-or-transformed' })
        continue
      }
    }
    // HARD REFUSAL: a text/innerHtml replace on a container would flatten its
    // whole subtree (the vibe-3-tiefer page-nuke). Only leaf text holders may
    // have their inner replaced — guards BOTH the escaped `text` and raw
    // `innerHtml` paths.
    if ((edit.text !== undefined || edit.innerHtml !== undefined) && !isTextLeafNode(el)) {
      results.push({ selector: edit.selector, ok: false, reason: 'refused-non-leaf' })
      continue
    }
    const planned = planEdit(el, edit, html)
    if (planned.length === 0) {
      results.push({ selector: edit.selector, ok: false, reason: 'no-op' })
      continue
    }
    splices.push(...planned)
    results.push({ selector: edit.selector, ok: true })
  }

  // Apply splices right-to-left so earlier offsets stay valid. Guard against
  // overlap (shouldn't happen across distinct elements/attrs, but be safe).
  splices.sort((a, b) => b.start - a.start)
  let out = html
  let lastStart = Infinity
  for (const sp of splices) {
    if (sp.end > lastStart) {
      // Overlapping splice — skip it rather than corrupt the string.
      continue
    }
    out = out.slice(0, sp.start) + sp.replacement + out.slice(sp.end)
    lastStart = sp.start
  }

  const applied = results.filter((r) => r.ok).length
  return { html: out, results, applied }
}
