import { describe, it, expect } from 'vitest'
import { applyDirectorEdits, resolveSelector } from '../director-surgery'
import { parse } from 'parse5'

// A representative vibe: nested sections, duplicate-tag siblings, an <img>
// with attributes, an SVG <image>, an inlined babel script with `<`/`>`/`&`
// that jsdom-serialize would have mangled, comments, and a doctype.
const FIXTURE = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<style>.hero{color:red}</style>
</head>
<body>
  <section class="hero" data-x="1">
    <h1 data-editable="t1">Hello</h1>
    <p class="lead">Intro text</p>
    <p class="lead">Second para</p>
    <img src="a.jpg" data-usage="portrait" class="por">
  </section>
  <section>
    <svg viewBox="0 0 10 10"><image href="b.jpg" width="10" height="10"></image></svg>
    <div style="padding:8px" class="box">styled</div>
  </section>
  <!-- a comment that must survive -->
  <script type="text/babel">const x = a < b && c > d; const s = "a&b"; /* keep me */</script>
</body>
</html>`

// Selector paths exactly as the client's buildSelectorPath would emit them.
const SEL = {
  h1: 'body > section:nth-of-type(1) > h1:nth-of-type(1)',
  p2: 'body > section:nth-of-type(1) > p:nth-of-type(2)',
  p1: 'body > section:nth-of-type(1) > p:nth-of-type(1)',
  img: 'body > section:nth-of-type(1) > img:nth-of-type(1)',
  svgImage: 'body > section:nth-of-type(2) > svg:nth-of-type(1) > image:nth-of-type(1)',
  box: 'body > section:nth-of-type(2) > div:nth-of-type(1)',
}

/** The invariant that ends the whack-a-mole: the babel script, the comment,
 *  the SVG, and the doctype are byte-identical after any edit. */
function assertUntouchedRegionsSurvive(html: string) {
  expect(html).toContain('const x = a < b && c > d; const s = "a&b"; /* keep me */')
  expect(html).toContain('<!-- a comment that must survive -->')
  expect(html).toContain('<!DOCTYPE html>')
  expect(html).toContain('<svg viewBox="0 0 10 10">')
}

describe('resolveSelector', () => {
  const doc = parse(FIXTURE, { sourceCodeLocationInfo: true }) as never

  it('resolves a nested element by nth-of-type', () => {
    const el = resolveSelector(doc, SEL.p2)
    expect(el).toBeTruthy()
    // second .lead paragraph
    expect((el as { attrs: { name: string; value: string }[] }).attrs.find((a) => a.name === 'class')?.value).toBe('lead')
  })

  it('tolerates the auto- prefix used by the text-edit path', () => {
    const el = resolveSelector(doc, 'auto-' + SEL.h1)
    expect(el).toBeTruthy()
    expect((el as { tagName: string }).tagName).toBe('h1')
  })

  it('resolves an SVG <image> deep in the tree', () => {
    const el = resolveSelector(doc, SEL.svgImage)
    expect((el as { tagName: string } | null)?.tagName).toBe('image')
  })

  it('returns null for a miss', () => {
    expect(resolveSelector(doc, 'body > section:nth-of-type(9)')).toBeNull()
  })
})

describe('applyDirectorEdits — surgical correctness', () => {
  it('sets a NEW style attribute and changes ONLY that span', () => {
    const { html, applied } = applyDirectorEdits(FIXTURE, [
      { selector: SEL.h1, style: 'color:blue' },
    ])
    expect(applied).toBe(1)
    // Inserted right after the tag name, every other byte identical.
    const expected = FIXTURE.replace(
      '<h1 data-editable="t1">',
      '<h1 style="color:blue" data-editable="t1">',
    )
    expect(html).toBe(expected)
    assertUntouchedRegionsSurvive(html)
  })

  it('replaces an EXISTING style attribute in place', () => {
    const { html } = applyDirectorEdits(FIXTURE, [
      { selector: SEL.box, style: 'padding:20px;color:green' },
    ])
    const expected = FIXTURE.replace(
      'style="padding:8px"',
      'style="padding:20px;color:green"',
    )
    expect(html).toBe(expected)
  })

  it('removes a style attribute (empty string) including its leading space', () => {
    const { html } = applyDirectorEdits(FIXTURE, [{ selector: SEL.box, style: '' }])
    const expected = FIXTURE.replace(' style="padding:8px"', '')
    expect(html).toBe(expected)
    expect(html).not.toContain('style="padding:8px"')
  })

  it('escapes quotes in a style value (url("…")) so the attribute stays valid', () => {
    const { html } = applyDirectorEdits(FIXTURE, [
      { selector: SEL.h1, style: 'background-image: url("hero.jpg")' },
    ])
    expect(html).toContain('style="background-image: url(&quot;hero.jpg&quot;)"')
    assertUntouchedRegionsSurvive(html)
  })

  it('swaps <img> src and nothing else', () => {
    const { html } = applyDirectorEdits(FIXTURE, [{ selector: SEL.img, imageSrc: 'c.jpg' }])
    const expected = FIXTURE.replace('src="a.jpg"', 'src="c.jpg"')
    expect(html).toBe(expected)
    // data-usage + class on the img untouched
    expect(html).toContain('<img src="c.jpg" data-usage="portrait" class="por">')
  })

  it('swaps SVG <image> href (not src)', () => {
    const { html } = applyDirectorEdits(FIXTURE, [{ selector: SEL.svgImage, imageSrc: 'd.jpg' }])
    const expected = FIXTURE.replace('href="b.jpg"', 'href="d.jpg"')
    expect(html).toBe(expected)
  })

  it('replaces inner text, preserving the element\'s attributes', () => {
    const { html } = applyDirectorEdits(FIXTURE, [{ selector: SEL.h1, text: 'Hi there' }])
    const expected = FIXTURE.replace(
      '<h1 data-editable="t1">Hello</h1>',
      '<h1 data-editable="t1">Hi there</h1>',
    )
    expect(html).toBe(expected)
  })

  it('escapes HTML-special chars in replacement text', () => {
    const { html } = applyDirectorEdits(FIXTURE, [{ selector: SEL.h1, text: 'a < b & c' }])
    expect(html).toContain('<h1 data-editable="t1">a &lt; b &amp; c</h1>')
  })

  it('targets the correct nth-of-type sibling, leaving the other untouched', () => {
    const { html } = applyDirectorEdits(FIXTURE, [{ selector: SEL.p2, text: 'CHANGED' }])
    expect(html).toContain('<p class="lead">Intro text</p>') // first p untouched
    expect(html).toContain('<p class="lead">CHANGED</p>')    // second p changed
    expect(html).not.toContain('Second para')
  })

  it('applies MULTIPLE edits in one batch with correct offsets', () => {
    const { html, applied } = applyDirectorEdits(FIXTURE, [
      { selector: SEL.h1, text: 'New Title' },
      { selector: SEL.img, imageSrc: 'c.jpg', style: 'opacity:.5' },
      { selector: SEL.p1, text: 'New intro' },
    ])
    expect(applied).toBe(3)
    expect(html).toContain('<h1 data-editable="t1">New Title</h1>')
    expect(html).toContain('<p class="lead">New intro</p>')
    expect(html).toContain('<img style="opacity:.5" src="c.jpg" data-usage="portrait" class="por">')
    assertUntouchedRegionsSurvive(html)
  })

  it('reports not-found without mutating the file', () => {
    const { html, applied, results } = applyDirectorEdits(FIXTURE, [
      { selector: 'body > section:nth-of-type(9) > h1:nth-of-type(1)', text: 'x' },
    ])
    expect(applied).toBe(0)
    expect(results[0].ok).toBe(false)
    expect(results[0].reason).toBe('not-found')
    expect(html).toBe(FIXTURE)
  })

  it('NEVER mangles an inlined babel script (the core regression)', () => {
    // Edit several things, then confirm the script block is byte-identical.
    const { html } = applyDirectorEdits(FIXTURE, [
      { selector: SEL.h1, text: 'X' },
      { selector: SEL.box, style: '' },
      { selector: SEL.img, imageSrc: 'z.jpg' },
    ])
    expect(html).toContain('<script type="text/babel">const x = a < b && c > d; const s = "a&b"; /* keep me */</script>')
  })
})

describe('applyDirectorEdits — text-leaf safety (the vibe-3-tiefer page-nuke guard)', () => {
  it('REFUSES a text-replace on <body> and leaves the file untouched', () => {
    const { html, applied, results } = applyDirectorEdits(FIXTURE, [
      { selector: 'body', text: 'this would flatten the whole page' },
    ])
    expect(applied).toBe(0)
    expect(results[0].ok).toBe(false)
    expect(results[0].reason).toBe('refused-non-leaf')
    expect(html).toBe(FIXTURE)
  })

  it('REFUSES a text-replace on a container <section> (has block children)', () => {
    const { html, applied, results } = applyDirectorEdits(FIXTURE, [
      { selector: 'body > section:nth-of-type(1)', text: 'nuke' },
    ])
    expect(applied).toBe(0)
    expect(results[0].reason).toBe('refused-non-leaf')
    expect(html).toBe(FIXTURE)
  })

  it('still ALLOWS text-replace on a leaf with inline-only children', () => {
    // <h1> with an <em> inside is still a leaf — safe.
    const withEm = FIXTURE.replace(
      '<h1 data-editable="t1">Hello</h1>',
      '<h1 data-editable="t1">Hello <em>world</em></h1>',
    )
    const { applied } = applyDirectorEdits(withEm, [
      { selector: 'body > section:nth-of-type(1) > h1:nth-of-type(1)', text: 'Replaced' },
    ])
    expect(applied).toBe(1)
  })

  it('a STYLE edit on a container is still allowed (only text-replace is gated)', () => {
    const { applied } = applyDirectorEdits(FIXTURE, [
      { selector: 'body > section:nth-of-type(1)', style: 'background:red' },
    ])
    expect(applied).toBe(1)
  })
})
