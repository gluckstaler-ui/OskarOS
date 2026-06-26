// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, readFile, rm } from 'fs/promises'
import path from 'path'
import { POST as saveEditsPOST } from '../../app/api/director/save-edits/route'
import { POST as textEditPOST } from '../../app/api/director/text-edit/route'

// Real on-disk round-trip: write a vibe under public/<session>/, hit the route
// handler the browser actually calls, read the file back, assert the edit
// landed AND that the inlined babel script / siblings survived byte-for-byte.

const SESSION = '__test-director-routes__'
const SESSION_DIR = path.join(process.cwd(), 'public', SESSION)

const VIBE = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><style>.hero{color:red}</style></head>
<body>
  <section class="hero">
    <h1 data-editable="t1">Original Title</h1>
    <p class="lead">First</p>
    <p class="lead">Second</p>
    <img src="a.jpg" data-usage="portrait" class="por">
  </section>
  <section>
    <svg viewBox="0 0 10 10"><image href="b.jpg" width="10" height="10"></image></svg>
  </section>
  <script type="text/babel">const x = a < b && c > d; const s = "a&b";</script>
</body>
</html>`

const SEL = {
  h1: 'body > section:nth-of-type(1) > h1:nth-of-type(1)',
  img: 'body > section:nth-of-type(1) > img:nth-of-type(1)',
  svgImage: 'body > section:nth-of-type(2) > svg:nth-of-type(1) > image:nth-of-type(1)',
}

function req(url: string, payload: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function writeVibe(rel: string) {
  const full = path.join(SESSION_DIR, rel)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, VIBE, 'utf-8')
  return full
}

beforeAll(async () => {
  await mkdir(SESSION_DIR, { recursive: true })
})
afterAll(async () => {
  await rm(SESSION_DIR, { recursive: true, force: true })
})

describe('/api/director/save-edits (e2e)', () => {
  it('persists a style edit and preserves the babel script', async () => {
    await writeVibe('vibe-1.html')
    const res = await saveEditsPOST(
      req('http://t/api/director/save-edits', {
        sessionId: SESSION,
        pageFilename: 'vibe-1.html',
        edits: [{ selector: SEL.h1, style: 'color:blue' }],
      }) as never,
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.applied).toBe(1)

    const out = await readFile(path.join(SESSION_DIR, 'vibe-1.html'), 'utf-8')
    expect(out).toContain('<h1 style="color:blue" data-editable="t1">Original Title</h1>')
    expect(out).toContain('<script type="text/babel">const x = a < b && c > d; const s = "a&b";</script>')
  })

  it('swaps an <img> src', async () => {
    await writeVibe('vibe-2.html')
    const res = await saveEditsPOST(
      req('http://t/api/director/save-edits', {
        sessionId: SESSION,
        pageFilename: 'vibe-2.html',
        edits: [{ selector: SEL.img, src: 'new.jpg' }],
      }) as never,
    )
    expect((await res.json()).applied).toBe(1)
    const out = await readFile(path.join(SESSION_DIR, 'vibe-2.html'), 'utf-8')
    expect(out).toContain('<img src="new.jpg" data-usage="portrait" class="por">')
  })

  it('swaps an SVG <image> href (not src)', async () => {
    await writeVibe('vibe-3.html')
    const res = await saveEditsPOST(
      req('http://t/api/director/save-edits', {
        sessionId: SESSION,
        pageFilename: 'vibe-3.html',
        edits: [{ selector: SEL.svgImage, src: 'svg-new.jpg' }],
      }) as never,
    )
    expect((await res.json()).applied).toBe(1)
    const out = await readFile(path.join(SESSION_DIR, 'vibe-3.html'), 'utf-8')
    expect(out).toContain('href="svg-new.jpg"')
    expect(out).not.toContain('src="svg-new.jpg"')
  })

  it('④ writes to a SUBFOLDER vibe via its pageFilename path', async () => {
    await writeVibe('Old_Vibes/vibe-9.html')
    const res = await saveEditsPOST(
      req('http://t/api/director/save-edits', {
        sessionId: SESSION,
        pageFilename: 'Old_Vibes/vibe-9.html',
        edits: [{ selector: SEL.h1, style: 'color:green' }],
      }) as never,
    )
    expect((await res.json()).applied).toBe(1)
    const out = await readFile(path.join(SESSION_DIR, 'Old_Vibes/vibe-9.html'), 'utf-8')
    expect(out).toContain('style="color:green"')
  })

  it('reports not-found and leaves the file untouched', async () => {
    await writeVibe('vibe-4.html')
    const res = await saveEditsPOST(
      req('http://t/api/director/save-edits', {
        sessionId: SESSION,
        pageFilename: 'vibe-4.html',
        edits: [{ selector: 'body > section:nth-of-type(9) > h1:nth-of-type(1)', style: 'x:y' }],
      }) as never,
    )
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.applied).toBe(0)
    const out = await readFile(path.join(SESSION_DIR, 'vibe-4.html'), 'utf-8')
    expect(out).toBe(VIBE)
  })
})

describe('/api/director/text-edit (e2e)', () => {
  it('② persists a text edit keyed by the auto- selector path (the regression)', async () => {
    await writeVibe('vibe-5.html')
    const res = await textEditPOST(
      req('http://t/api/director/text-edit', {
        sessionId: SESSION,
        pageFilename: 'vibe-5.html',
        oskarId: 'auto-' + SEL.h1, // exactly what the client sends
        newText: 'Brand New Title',
        tagName: 'h1',
      }) as never,
    )
    const json = await res.json()
    expect(json.success).toBe(true)

    const out = await readFile(path.join(SESSION_DIR, 'vibe-5.html'), 'utf-8')
    // text changed, the element's attribute preserved, script intact
    expect(out).toContain('<h1 data-editable="t1">Brand New Title</h1>')
    expect(out).toContain('<script type="text/babel">const x = a < b && c > d; const s = "a&b";</script>')
  })

  it('escapes HTML-special characters in the new text', async () => {
    await writeVibe('vibe-6.html')
    await textEditPOST(
      req('http://t/api/director/text-edit', {
        sessionId: SESSION,
        pageFilename: 'vibe-6.html',
        oskarId: 'auto-' + SEL.h1,
        newText: '5 < 10 & rising',
      }) as never,
    )
    const out = await readFile(path.join(SESSION_DIR, 'vibe-6.html'), 'utf-8')
    expect(out).toContain('<h1 data-editable="t1">5 &lt; 10 &amp; rising</h1>')
  })

  it('④ persists a text edit to a SUBFOLDER vibe', async () => {
    await writeVibe('Old_Vibes/vibe-10.html')
    const res = await textEditPOST(
      req('http://t/api/director/text-edit', {
        sessionId: SESSION,
        pageFilename: 'Old_Vibes/vibe-10.html',
        oskarId: 'auto-' + SEL.h1,
        newText: 'Archived Edit',
      }) as never,
    )
    expect((await res.json()).success).toBe(true)
    const out = await readFile(path.join(SESSION_DIR, 'Old_Vibes/vibe-10.html'), 'utf-8')
    expect(out).toContain('<h1 data-editable="t1">Archived Edit</h1>')
  })

  it('REFUSES a body-level text edit (the page-nuke) — 404, file untouched', async () => {
    await writeVibe('vibe-8.html')
    const res = await textEditPOST(
      req('http://t/api/director/text-edit', {
        sessionId: SESSION,
        pageFilename: 'vibe-8.html',
        oskarId: 'auto-body',
        newText: 'Silke Lengler Praxis Methode …(flattened textContent)…',
      }) as never,
    )
    expect(res.status).toBe(404)
    const out = await readFile(path.join(SESSION_DIR, 'vibe-8.html'), 'utf-8')
    expect(out).toBe(VIBE) // byte-identical — nothing was stripped
  })

  it('404s for a selector that does not resolve', async () => {
    await writeVibe('vibe-7.html')
    const res = await textEditPOST(
      req('http://t/api/director/text-edit', {
        sessionId: SESSION,
        pageFilename: 'vibe-7.html',
        oskarId: 'auto-body > section:nth-of-type(9) > h1:nth-of-type(1)',
        newText: 'nope',
      }) as never,
    )
    expect(res.status).toBe(404)
    const out = await readFile(path.join(SESSION_DIR, 'vibe-7.html'), 'utf-8')
    expect(out).toBe(VIBE)
  })
})
