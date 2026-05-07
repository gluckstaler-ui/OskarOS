import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  unescapeHtml,
  editTextInHtml,
  editImageInHtml
} from '../vibe-editor'

describe('vibe-editor', () => {
  describe('escapeHtml', () => {
    it('escapes ampersand', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry')
    })

    it('escapes less than', () => {
      expect(escapeHtml('a < b')).toBe('a &lt; b')
    })

    it('escapes greater than', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b')
    })

    it('escapes double quotes', () => {
      expect(escapeHtml('Say "hello"')).toBe('Say &quot;hello&quot;')
    })

    it('escapes single quotes', () => {
      expect(escapeHtml("It's fine")).toBe("It&#039;s fine")
    })

    it('escapes all special chars together', () => {
      expect(escapeHtml('<script>"alert(\'XSS\')&"</script>')).toBe(
        '&lt;script&gt;&quot;alert(&#039;XSS&#039;)&amp;&quot;&lt;/script&gt;'
      )
    })

    it('returns empty string unchanged', () => {
      expect(escapeHtml('')).toBe('')
    })

    it('returns plain text unchanged', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World')
    })
  })

  describe('unescapeHtml', () => {
    it('unescapes ampersand', () => {
      expect(unescapeHtml('Tom &amp; Jerry')).toBe('Tom & Jerry')
    })

    it('unescapes less than', () => {
      expect(unescapeHtml('a &lt; b')).toBe('a < b')
    })

    it('unescapes greater than', () => {
      expect(unescapeHtml('a &gt; b')).toBe('a > b')
    })

    it('unescapes double quotes', () => {
      expect(unescapeHtml('Say &quot;hello&quot;')).toBe('Say "hello"')
    })

    it('unescapes single quotes', () => {
      expect(unescapeHtml("It&#039;s fine")).toBe("It's fine")
    })

    it('roundtrips correctly', () => {
      const original = '<script>"alert(\'XSS\')&"</script>'
      expect(unescapeHtml(escapeHtml(original))).toBe(original)
    })
  })

  describe('editTextInHtml', () => {
    it('replaces text in element with data-editable', () => {
      const html = '<h1 data-editable="headline">Old Headline</h1>'
      const result = editTextInHtml(html, 'headline', 'New Headline')

      expect(result.html).toBe('<h1 data-editable="headline">New Headline</h1>')
      expect(result.oldValue).toBe('Old Headline')
    })

    it('handles single quotes in data-editable', () => {
      const html = "<h1 data-editable='headline'>Old</h1>"
      const result = editTextInHtml(html, 'headline', 'New')

      expect(result.html).toBe("<h1 data-editable='headline'>New</h1>")
      expect(result.oldValue).toBe('Old')
    })

    it('preserves other attributes', () => {
      const html = '<h1 class="title" data-editable="headline" id="main">Old</h1>'
      const result = editTextInHtml(html, 'headline', 'New')

      expect(result.html).toBe('<h1 class="title" data-editable="headline" id="main">New</h1>')
    })

    it('escapes HTML in new text to prevent XSS', () => {
      const html = '<p data-editable="content">Safe text</p>'
      const result = editTextInHtml(html, 'content', '<script>alert("XSS")</script>')

      expect(result.html).toBe('<p data-editable="content">&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;</p>')
    })

    it('only replaces first match (duplicate IDs)', () => {
      const html = `
        <h1 data-editable="title">First Title</h1>
        <h2 data-editable="title">Second Title</h2>
      `
      const result = editTextInHtml(html, 'title', 'Updated')

      expect(result.html).toContain('<h1 data-editable="title">Updated</h1>')
      expect(result.html).toContain('<h2 data-editable="title">Second Title</h2>')
      expect(result.oldValue).toBe('First Title')
    })

    it('returns null oldValue when element not found', () => {
      const html = '<h1 data-editable="headline">Text</h1>'
      const result = editTextInHtml(html, 'nonexistent', 'New')

      expect(result.html).toBe(html) // Unchanged
      expect(result.oldValue).toBeNull()
    })

    it('handles multiline content', () => {
      const html = `<p data-editable="content">Line 1
Line 2
Line 3</p>`
      const result = editTextInHtml(html, 'content', 'Single line')

      expect(result.html).toBe('<p data-editable="content">Single line</p>')
      expect(result.oldValue).toBe('Line 1\nLine 2\nLine 3')
    })

    it('handles various HTML tags', () => {
      const testCases = [
        { tag: 'h1', html: '<h1 data-editable="test">Old</h1>' },
        { tag: 'h2', html: '<h2 data-editable="test">Old</h2>' },
        { tag: 'p', html: '<p data-editable="test">Old</p>' },
        { tag: 'span', html: '<span data-editable="test">Old</span>' },
        { tag: 'div', html: '<div data-editable="test">Old</div>' },
        { tag: 'button', html: '<button data-editable="test">Old</button>' }
      ]

      for (const { tag, html } of testCases) {
        const result = editTextInHtml(html, 'test', 'New')
        expect(result.html).toBe(`<${tag} data-editable="test">New</${tag}>`)
        expect(result.oldValue).toBe('Old')
      }
    })

    it('handles special characters in element ID', () => {
      const html = '<h1 data-editable="hero.headline">Old</h1>'
      const result = editTextInHtml(html, 'hero.headline', 'New')

      expect(result.html).toBe('<h1 data-editable="hero.headline">New</h1>')
    })

    it('case insensitive tag matching', () => {
      const html = '<H1 data-editable="title">Old</H1>'
      const result = editTextInHtml(html, 'title', 'New')

      expect(result.html).toBe('<H1 data-editable="title">New</H1>')
    })
  })

  describe('editImageInHtml', () => {
    it('replaces src in img with data-usage before src', () => {
      const html = '<img data-usage="hero" src="old.jpg" />'
      const result = editImageInHtml(html, 'hero', 'new.jpg')

      expect(result.html).toBe('<img data-usage="hero" src="new.jpg" />')
      expect(result.oldSrc).toBe('old.jpg')
    })

    it('replaces src in img with src before data-usage', () => {
      const html = '<img src="old.jpg" data-usage="hero" />'
      const result = editImageInHtml(html, 'hero', 'new.jpg')

      expect(result.html).toBe('<img src="new.jpg" data-usage="hero" />')
      expect(result.oldSrc).toBe('old.jpg')
    })

    it('handles single quotes', () => {
      const html = "<img data-usage='hero' src='old.jpg' />"
      const result = editImageInHtml(html, 'hero', 'new.jpg')

      expect(result.html).toBe("<img data-usage='hero' src='new.jpg' />")
    })

    it('only replaces first match', () => {
      const html = `
        <img data-usage="hero" src="first.jpg" />
        <img data-usage="hero" src="second.jpg" />
      `
      const result = editImageInHtml(html, 'hero', 'new.jpg')

      expect(result.html).toContain('src="new.jpg"')
      expect(result.html).toContain('src="second.jpg"')
      expect(result.oldSrc).toBe('first.jpg')
    })

    it('returns null oldSrc when image not found', () => {
      const html = '<img data-usage="hero" src="img.jpg" />'
      const result = editImageInHtml(html, 'background', 'new.jpg')

      expect(result.html).toBe(html) // Unchanged
      expect(result.oldSrc).toBeNull()
    })

    it('preserves other attributes', () => {
      const html = '<img class="main" data-usage="hero" src="old.jpg" alt="Hero Image" />'
      const result = editImageInHtml(html, 'hero', 'new.jpg')

      expect(result.html).toBe('<img class="main" data-usage="hero" src="new.jpg" alt="Hero Image" />')
    })

    it('handles full URLs', () => {
      const html = '<img data-usage="hero" src="/images/old.jpg" />'
      const result = editImageInHtml(html, 'hero', '/session/2026-01-29-1/hero-v2.jpg')

      expect(result.html).toBe('<img data-usage="hero" src="/session/2026-01-29-1/hero-v2.jpg" />')
      expect(result.oldSrc).toBe('/images/old.jpg')
    })

    it('handles various usage values', () => {
      const usages = ['hero', 'background', 'portrait', 'icon', 'gallery-1', 'menu_image']

      for (const usage of usages) {
        const html = `<img data-usage="${usage}" src="old.jpg" />`
        const result = editImageInHtml(html, usage, 'new.jpg')

        expect(result.html).toBe(`<img data-usage="${usage}" src="new.jpg" />`)
        expect(result.oldSrc).toBe('old.jpg')
      }
    })

    it('handles special characters in usage value', () => {
      const html = '<img data-usage="hero.main" src="old.jpg" />'
      const result = editImageInHtml(html, 'hero.main', 'new.jpg')

      expect(result.html).toBe('<img data-usage="hero.main" src="new.jpg" />')
    })
  })
})
