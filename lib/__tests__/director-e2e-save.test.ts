// @vitest-environment node
//
// TRUE end-to-end: the CLIENT builds a selector with the real buildSelectorPath
// (run over a jsdom DOM, exactly like the browser does), then the SERVER applies
// it with the real applyDirectorEdits (parse5). This is the contract the unit
// tests bypassed by hand-writing selectors. It catches client/server selector
// disagreement and offset-splice corruption on REAL vibe markup.
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync, readdirSync } from 'fs'
import path from 'path'
import { buildSelectorPath } from '../director-css'
import { applyDirectorEdits, type DirectorEdit } from '../director-surgery'

const SESSION_DIR = path.join(process.cwd(), 'public', '2026-04-25-silke-lengler')

// Every root-level vibe HTML in the live session — the real markup users edit.
function rootVibeFiles(): string[] {
  return readdirSync(SESSION_DIR)
    .filter((f) => /^vibe-.*\.html$/.test(f))
    .map((f) => path.join(SESSION_DIR, f))
}

/** Structural integrity: the document skeleton + scripts survived. */
function assertNotDestroyed(before: string, after: string, file: string) {
  const tag = (s: string, re: RegExp) => (s.match(re) || []).length
  // Skeleton intact
  for (const re of [/<html/i, /<\/html>/i, /<head>/i, /<\/head>/i, /<body/i, /<\/body>/i]) {
    expect(after, `${file}: missing ${re}`).toMatch(re)
  }
  // Same number of sections, divs, and (crucially) scripts — nothing dropped/duplicated
  for (const re of [/<section\b/gi, /<\/section>/gi, /<script\b/gi, /<\/script>/gi, /<div\b/gi]) {
    expect(tag(after, re), `${file}: count drift for ${re}`).toBe(tag(before, re))
  }
  // Every <script> body byte-identical (the babel/IO engine must never be touched)
  const scripts = (s: string) => Array.from(s.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)).map((m) => m[1])
  expect(scripts(after), `${file}: script body changed`).toEqual(scripts(before))
  // Size sanity: a surgical edit changes a handful of bytes, never shreds the file
  expect(Math.abs(after.length - before.length), `${file}: size delta too large`).toBeLessThan(2000)
}

describe('Director save E2E — real buildSelectorPath → real surgery, per root vibe', () => {
  const files = rootVibeFiles()
  it('has vibes to test', () => expect(files.length).toBeGreaterThan(0))

  // Direct nuke-state guard: a de-tagged vibe (the page-nuke) has a <body>
  // immediately followed by text and almost no elements. Every root vibe must
  // be well-formed DOM, not a flattened text blob.
  for (const file of files) {
    const name = path.basename(file)
    it(`${name}: is well-formed (not de-tagged / page-nuked)`, () => {
      const html = readFileSync(file, 'utf-8')
      const dom = new JSDOM(html)
      const body = dom.window.document.body
      expect(body, `${name}: no <body>`).toBeTruthy()
      // A real vibe has structural children, not just a flattened text node.
      expect(body.children.length, `${name}: body has no element children — de-tagged?`).toBeGreaterThan(2)
      // No <script> source leaked into the body as ESCAPED text. A de-tagged
      // page flattens its script to text and HTML-escapes the arrows (`=>` →
      // `=&gt;`); a real page keeps script content raw, so this never appears.
      expect(html, `${name}: escaped arrow — script flattened to text`).not.toMatch(/=&gt;/)
    })
  }

  for (const file of files) {
    const name = path.basename(file)

    it(`${name}: STYLE edit on every stylable element round-trips intact`, () => {
      const html = readFileSync(file, 'utf-8')
      const dom = new JSDOM(html)
      const doc = dom.window.document
      // A spread of element types a user would actually click + style.
      const candidates = [
        ...doc.querySelectorAll('h1, h2, h3, p, section, div[class], a, li, img, dt, dd'),
      ].slice(0, 40) as Element[]

      let tested = 0
      for (const el of candidates) {
        const selector = buildSelectorPath(el as unknown as HTMLElement)
        // Client self-check: its own selector must point back to the same node.
        let back: Element | null = null
        try { back = doc.querySelector(selector) } catch { back = null }
        if (back !== el) continue // skip nodes the selector can't round-trip in the browser
        tested++
        const edit: DirectorEdit = { selector, style: 'outline: 2px solid red' }
        const { html: out, applied, results } = applyDirectorEdits(html, [edit])
        expect(applied, `${name} ${selector}: not applied (${results[0]?.reason})`).toBe(1)
        assertNotDestroyed(html, out, `${name} ${selector}`)
        expect(out).toContain('outline: 2px solid red')
      }
      // Sanity: SOME element round-tripped (sparse pages may have few; 0 means
      // a client/server selector mismatch worth knowing about).
      expect(tested, `${name}: no elements round-tripped`).toBeGreaterThan(0)
    })

    it(`${name}: TEXT edit on leaf text holders round-trips intact`, () => {
      const html = readFileSync(file, 'utf-8')
      const dom = new JSDOM(html)
      const doc = dom.window.document
      const leaves = [...doc.querySelectorAll('h1, h2, h3, p, a, dt, dd, .label, span')]
        .filter((el) => el.children.length === 0 && (el.textContent || '').trim().length > 0)
        .slice(0, 25) as Element[]

      let tested = 0
      for (const el of leaves) {
        const selector = buildSelectorPath(el as unknown as HTMLElement)
        if (doc.querySelector(selector) !== el) continue
        tested++
        const { html: out, applied } = applyDirectorEdits(html, [{ selector, text: 'EDITED TEXT' }])
        expect(applied, `${name} ${selector}: text not applied`).toBe(1)
        assertNotDestroyed(html, out, `${name} ${selector}`)
      }
      expect(tested, `${name}: no leaves round-tripped`).toBeGreaterThan(0)
    })

    it(`${name}: a MULTI-edit save batch (several elements at once) round-trips intact`, () => {
      const html = readFileSync(file, 'utf-8')
      const dom = new JSDOM(html)
      const doc = dom.window.document
      const els = [...doc.querySelectorAll('h1, h2, p, section, div[class], img')].slice(0, 12) as Element[]
      const edits: DirectorEdit[] = []
      for (const el of els) {
        const selector = buildSelectorPath(el as unknown as HTMLElement)
        if (doc.querySelector(selector) !== el) continue
        edits.push({ selector, style: 'opacity: 0.95' })
      }
      if (edits.length < 2) return
      const { html: out, applied } = applyDirectorEdits(html, edits)
      expect(applied).toBe(edits.length)
      assertNotDestroyed(html, out, name)
    })
  }
})
