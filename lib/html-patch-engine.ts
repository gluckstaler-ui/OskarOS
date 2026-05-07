/**
 * html-patch-engine.ts — JSDOM-based HTML patcher (Phase 2 Tier A — 2026-04-30).
 *
 * Powers the `apply_patch` MCP tool. CD calls it to make surgical edits to
 * built vibe HTML without going through a full WebDev rebuild.
 *
 * Doctrine:
 *   - The schema IS the safety envelope. Each `kind` is a typed operation
 *     with typed params; anything not expressible as a kind goes through
 *     `build_vibe`. There are no string-pattern shortcuts.
 *   - Hard refusal: any selector that matches `<script>` or its descendants.
 *     CD does not write JavaScript surgically — it can only patch presentation.
 *   - Result records the diff so Director Mode revert keeps working.
 */

import { JSDOM } from 'jsdom'

// ── Edit kinds (the typed safety envelope) ─────────────────────────────────

export type ApplyPatchEdit =
  // 2026-04-30 (Ralph bug A): css-var-set with NO selector → edit the
  // `:root { --foo: bar }` block in the inline <style>. With selector →
  // set the inline style.setProperty on matched elements.
  | { kind: 'css-var-set'; varName: string; value: string; selector?: string }
  | { kind: 'text-replace'; selector: string; text: string }
  | { kind: 'attr-set'; selector: string; attr: string; value: string }
  | { kind: 'class-toggle'; selector: string; className: string; force?: boolean }
  | { kind: 'delete'; selector: string }
  | {
      kind: 'insert'
      anchor: string
      position: 'before' | 'after' | 'append' | 'prepend'
      html: string
    }

export interface ApplyPatchResult {
  ok: boolean
  error?: string
  /** Number of nodes affected. */
  affected: number
  /** Unified-diff-style preview (for revert + log). */
  diff: string
  /** New HTML (only set if ok=true). */
  html?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function refuseScript(selector: string): string | null {
  // Belt-and-braces: if the selector contains `script` as a tag name, refuse
  // before we even hit the DOM.
  if (/\bscript\b/i.test(selector)) {
    return `Refused: selector "${selector}" targets a <script> tag (apply_patch cannot mutate scripts).`
  }
  return null
}

function isInsideScript(node: Element): boolean {
  let p: Element | null = node
  while (p) {
    if (p.tagName === 'SCRIPT') return true
    p = p.parentElement
  }
  return false
}

/**
 * css-var-set with no selector — edit `--{varName}: ...` inside the first
 * `:root { ... }` block of the first inline `<style>`. Adds the var if it
 * doesn't exist. JSDOM doesn't expose stylesheet-rule mutation reliably
 * across versions, so we operate on the textContent of the <style> tag.
 */
function applyCssVarSetToRoot(
  html: string,
  varName: string,
  value: string,
): ApplyPatchResult {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const style = doc.querySelector('style')
  if (!style) {
    return {
      ok: false,
      affected: 0,
      diff: '',
      error: 'No inline <style> found. Pass an explicit selector if the var lives elsewhere.',
    }
  }
  const css = style.textContent || ''
  const name = varName.startsWith('--') ? varName : `--${varName}`
  // Match :root block — first one wins. Body captures everything between
  // the braces (non-greedy).
  const rootRe = /:root\s*\{([\s\S]*?)\}/
  const m = css.match(rootRe)
  if (!m) {
    return {
      ok: false,
      affected: 0,
      diff: '',
      error: 'No `:root { ... }` block found in inline <style>. Pass an explicit selector to target a different rule.',
    }
  }
  const before = m[1]
  // varName exists → replace its value; else append.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const varRe = new RegExp(`(${escaped}\\s*:\\s*)([^;]+)(;?)`, 'i')
  let after: string
  if (varRe.test(before)) {
    after = before.replace(varRe, `$1${value}$3`)
  } else {
    // Append before the closing brace, preserving the formatting.
    after = before.trimEnd() + `\n  ${name}: ${value};\n`
  }
  const newCss = css.replace(rootRe, `:root {${after}}`)
  style.textContent = newCss
  return {
    ok: true,
    affected: 1,
    diff: [
      `--- :root { ${name} } (before)`,
      before.length > 200 ? before.slice(0, 200) + '…' : before,
      `+++ :root { ${name} } (after)`,
      after.length > 200 ? after.slice(0, 200) + '…' : after,
    ].join('\n'),
    html: dom.serialize(),
  }
}

function quickDiff(before: string, after: string, selector: string): string {
  // Lightweight unified-diff substitute — we don't need exact `diff` output,
  // just enough to log + drive Director-mode revert. The full diff is the
  // before/after html stored elsewhere (LINEAGE.json).
  const beforeShort = before.length > 200 ? before.slice(0, 200) + '…' : before
  const afterShort = after.length > 200 ? after.slice(0, 200) + '…' : after
  return [
    `--- ${selector} (before)`,
    beforeShort,
    `+++ ${selector} (after)`,
    afterShort,
  ].join('\n')
}

// ── Main entrypoint ────────────────────────────────────────────────────────

export function applyPatchToHtml(
  html: string,
  edit: ApplyPatchEdit,
): ApplyPatchResult {
  // 2026-04-30 (Ralph bug A): branch on kind BEFORE running querySelectorAll.
  // The previous version unconditionally read `edit.selector` for every kind
  // — fine for kinds that need a selector, but `css-var-set` should be able
  // to target the `:root` block in the inline <style> with no selector. The
  // failure mode was: `kind:'css-var-set'` without selector → sel=undefined
  // → "Selector undefined matched no nodes." Same trap was lurking for
  // `insert` if anchor was missing — explicit branching closes both.

  // ── css-var-set with no selector: text-edit the :root block ────────────
  if (edit.kind === 'css-var-set' && !edit.selector) {
    return applyCssVarSetToRoot(html, edit.varName, edit.value)
  }

  const dom = new JSDOM(html)
  const doc = dom.window.document

  // 1. Selector-level script refusal (insert uses `anchor`, others use `selector`).
  const sel = edit.kind === 'insert' ? edit.anchor : edit.selector!
  if (!sel) {
    return {
      ok: false,
      affected: 0,
      diff: '',
      error: `Edit kind "${edit.kind}" requires ${edit.kind === 'insert' ? '`anchor`' : '`selector`'}.`,
    }
  }
  const refusal = refuseScript(sel)
  if (refusal) return { ok: false, affected: 0, diff: '', error: refusal }

  // 2. Resolve selector(s).
  let nodes: Element[]
  try {
    nodes = Array.from(doc.querySelectorAll(sel)) as Element[]
  } catch (err) {
    return {
      ok: false,
      affected: 0,
      diff: '',
      error: `Invalid selector "${sel}": ${(err as Error).message}`,
    }
  }
  if (nodes.length === 0) {
    return {
      ok: false,
      affected: 0,
      diff: '',
      error: `Selector "${sel}" matched no nodes.`,
    }
  }
  for (const n of nodes) {
    if (isInsideScript(n)) {
      return {
        ok: false,
        affected: 0,
        diff: '',
        error: `Refused: selector "${sel}" matches a node inside <script>.`,
      }
    }
  }

  // 3. Capture "before" snippet for diff (first match only — keeps log small).
  const beforeSnippet = nodes[0].outerHTML

  // 4. Apply.
  switch (edit.kind) {
    case 'css-var-set': {
      // With selector → set inline style.setProperty on matched elements.
      const name = edit.varName.startsWith('--') ? edit.varName : `--${edit.varName}`
      for (const n of nodes) {
        const html = n as HTMLElement
        html.style.setProperty(name, edit.value)
      }
      break
    }
    case 'text-replace': {
      for (const n of nodes) n.textContent = edit.text
      break
    }
    case 'attr-set': {
      for (const n of nodes) n.setAttribute(edit.attr, edit.value)
      break
    }
    case 'class-toggle': {
      for (const n of nodes) {
        if (typeof edit.force === 'boolean') {
          n.classList.toggle(edit.className, edit.force)
        } else {
          n.classList.toggle(edit.className)
        }
      }
      break
    }
    case 'delete': {
      for (const n of nodes) n.remove()
      break
    }
    case 'insert': {
      // Use the FIRST anchor match — multi-anchor insert is undefined behavior.
      const anchor = nodes[0]
      const tmpl = doc.createElement('template')
      tmpl.innerHTML = edit.html
      const frag = (tmpl as HTMLTemplateElement).content
      // Refuse <script> tags inside inserted HTML.
      if (frag.querySelector('script')) {
        return {
          ok: false,
          affected: 0,
          diff: '',
          error: 'Refused: inserted HTML contains a <script> tag.',
        }
      }
      switch (edit.position) {
        case 'before':
          anchor.parentNode?.insertBefore(frag.cloneNode(true), anchor)
          break
        case 'after':
          if (anchor.nextSibling) {
            anchor.parentNode?.insertBefore(frag.cloneNode(true), anchor.nextSibling)
          } else {
            anchor.parentNode?.appendChild(frag.cloneNode(true))
          }
          break
        case 'append':
          anchor.appendChild(frag.cloneNode(true))
          break
        case 'prepend':
          if (anchor.firstChild) {
            anchor.insertBefore(frag.cloneNode(true), anchor.firstChild)
          } else {
            anchor.appendChild(frag.cloneNode(true))
          }
          break
      }
      break
    }
  }

  // 5. Capture "after" snippet (only meaningful for non-delete).
  const afterSnippet =
    edit.kind === 'delete'
      ? '(deleted)'
      : edit.kind === 'insert'
        ? '(inserted)'
        : nodes[0].outerHTML

  return {
    ok: true,
    affected: nodes.length,
    diff: quickDiff(beforeSnippet, afterSnippet, sel),
    html: dom.serialize(),
  }
}
