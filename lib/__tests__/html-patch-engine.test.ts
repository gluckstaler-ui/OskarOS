/**
 * html-patch-engine.test.ts — Phase 2 Tier A (2026-04-30).
 *
 * Per-edit-kind tests + script-refusal safety rail.
 */
import { describe, it, expect } from 'vitest'
import { applyPatchToHtml } from '../html-patch-engine'

const HTML = `<!doctype html>
<html><head><style>:root { --hero-bg: #000; }</style></head>
<body>
  <h1 class="title">Original</h1>
  <img id="hero" src="old.jpg" alt="hero">
  <script>const x = 1;</script>
  <div class="cta">Click me</div>
</body></html>`

describe('html-patch-engine', () => {
  describe('css-var-set', () => {
    it('sets a CSS variable on a matched element (with selector)', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'css-var-set',
        selector: 'h1.title',
        varName: '--hero-bg',
        value: '#fff',
      })
      expect(r.ok).toBe(true)
      expect(r.affected).toBe(1)
      expect(r.html).toContain('--hero-bg: #fff')
    })

    it('prepends -- if missing', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'css-var-set',
        selector: 'h1.title',
        varName: 'accent', // no leading --
        value: 'red',
      })
      expect(r.ok).toBe(true)
      expect(r.html).toContain('--accent: red')
    })

    // 2026-04-30 (Ralph bug A) — no-selector branch hits the :root block
    // in the inline <style>, no querySelectorAll involvement.
    it('with NO selector → updates existing var in :root block', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'css-var-set',
        varName: '--hero-bg',
        value: '#abcdef',
      })
      expect(r.ok).toBe(true)
      expect(r.affected).toBe(1)
      expect(r.html).toContain('--hero-bg: #abcdef')
      expect(r.html).not.toContain('--hero-bg: #000')
    })

    it('with NO selector → appends new var if absent', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'css-var-set',
        varName: '--brand-new',
        value: 'rebeccapurple',
      })
      expect(r.ok).toBe(true)
      expect(r.html).toContain('--brand-new: rebeccapurple')
    })

    it('with NO selector → errors when there is no inline <style>', () => {
      const r = applyPatchToHtml('<html><body>nothing</body></html>', {
        kind: 'css-var-set',
        varName: '--foo',
        value: 'bar',
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/<style>/i)
    })

    it('with NO selector → errors when :root block is missing', () => {
      const r = applyPatchToHtml(
        '<html><head><style>body{color:red}</style></head><body></body></html>',
        { kind: 'css-var-set', varName: '--foo', value: 'bar' },
      )
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/:root/)
    })
  })

  describe('text-replace', () => {
    it('replaces textContent', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'text-replace',
        selector: 'h1.title',
        text: 'New Title',
      })
      expect(r.ok).toBe(true)
      expect(r.html).toContain('>New Title<')
      expect(r.html).not.toContain('>Original<')
    })
  })

  describe('attr-set', () => {
    it('sets an attribute', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'attr-set',
        selector: '#hero',
        attr: 'src',
        value: 'new.jpg',
      })
      expect(r.ok).toBe(true)
      expect(r.html).toContain('src="new.jpg"')
    })
  })

  describe('class-toggle', () => {
    it('adds a class when not present', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'class-toggle',
        selector: 'h1.title',
        className: 'big',
        force: true,
      })
      expect(r.ok).toBe(true)
      expect(r.html).toContain('class="title big"')
    })

    it('removes a class with force=false', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'class-toggle',
        selector: 'h1.title',
        className: 'title',
        force: false,
      })
      expect(r.ok).toBe(true)
      expect(r.html).not.toContain('class="title"')
    })
  })

  describe('delete', () => {
    it('removes the matched node', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'delete',
        selector: '.cta',
      })
      expect(r.ok).toBe(true)
      expect(r.html).not.toContain('Click me')
    })
  })

  describe('insert', () => {
    it('inserts before the anchor', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'insert',
        anchor: 'h1.title',
        position: 'before',
        html: '<p class="kicker">Sub</p>',
      })
      expect(r.ok).toBe(true)
      // The kicker should appear before the H1.
      const html = r.html!
      expect(html.indexOf('kicker')).toBeLessThan(html.indexOf('Original'))
    })

    it('refuses inserted <script>', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'insert',
        anchor: 'body',
        position: 'append',
        html: '<script>alert(1)</script>',
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/script/i)
    })
  })

  describe('safety rails', () => {
    it('refuses selector that targets <script>', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'text-replace',
        selector: 'script',
        text: 'evil',
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/script/i)
    })

    it('returns error when selector matches no nodes', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'text-replace',
        selector: '.does-not-exist',
        text: 'hello',
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/matched no nodes/i)
    })

    it('returns error on invalid selector', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'text-replace',
        selector: '>>>not-valid',
        text: 'hello',
      })
      expect(r.ok).toBe(false)
    })

    it('records a diff that names the selector', () => {
      const r = applyPatchToHtml(HTML, {
        kind: 'text-replace',
        selector: 'h1.title',
        text: 'Updated',
      })
      expect(r.ok).toBe(true)
      expect(r.diff).toContain('h1.title')
    })
  })
})
