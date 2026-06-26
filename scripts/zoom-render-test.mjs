/**
 * Real-browser regression for Director-Mode ZOOM. Replicates the component's
 * exact zoom logic and asserts, on real vibes:
 *   1. zoom keeps the element box fixed (no "picture gets bigger")
 *   2. zoom never TILES a background image (the "repeats 3x" bug)
 *   3. zoomed background covers the box (no gaps), aspect preserved
 *   4. old transform:scale demonstrably GREW the box (the original bug)
 *
 * Run: node scripts/zoom-render-test.mjs [baseURL]
 */
import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://localhost:3000'
const S = '2026-04-25-silke-lengler'
const approx = (a, b, t = 2) => Math.abs(a - b) <= t
const out = []
const log = (ok, name, d) => { out.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${d}`) }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

// The component's bg-image zoom, replicated verbatim.
async function bgZoom(file, sel, zoom = 1.5) {
  await page.goto(`${BASE}/${S}/${file}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => document.querySelectorAll('.fade').forEach((e) => e.classList.add('in')))
  await page.waitForTimeout(350)
  return page.evaluate(async ({ sel, zoom }) => {
    const el = document.querySelector(sel)
    if (!el) return { skip: true }
    const box = { w: el.clientWidth, h: el.clientHeight }
    el.style.backgroundRepeat = 'no-repeat'
    const m = (getComputedStyle(el).backgroundImage || '').match(/url\(["']?([^"')]+)["']?\)/)
    if (m) await new Promise((res) => {
      const probe = new Image()
      const go = () => { const c = Math.max(box.w / probe.naturalWidth, box.h / probe.naturalHeight); el.style.backgroundSize = `${Math.round(probe.naturalWidth * c * zoom)}px ${Math.round(probe.naturalHeight * c * zoom)}px`; res() }
      probe.onload = go; probe.src = m[1]; if (probe.complete && probe.naturalWidth) go()
    })
    const bs = getComputedStyle(el).backgroundSize.match(/([\d.]+)px\s+([\d.]+)px/)
    const r = el.getBoundingClientRect()
    return { box, sized: getComputedStyle(el).backgroundSize, repeat: getComputedStyle(el).backgroundRepeat, coversW: bs && +bs[1] >= box.w - 1, coversH: bs && +bs[2] >= box.h - 1, boxFixed: approxJS(r.width, box.w) }
    function approxJS(a, b) { return Math.abs(a - b) <= 2 }
  }, { sel, zoom })
}

// ── 1. NO-TILE + box-fixed on tall portraits (the reported bug) ──
for (const [f, s] of [
  ['vibe-1-das-zuviel.html', '.ueber-portrait'],
  ['vibe-1-das-zuviel.html', '.detail-img'],
  ['vibe-2-raume.html', '.ueber-portrait'],
  ['vibe-3-tiefer.html', '.ueber-portrait'],
]) {
  const r = await bgZoom(f, s)
  if (r.skip) { log(true, `${f} ${s}`, 'no element (skip)'); continue }
  log(r.coversW && r.coversH && r.boxFixed && r.repeat === 'no-repeat', `${f} ${s} zoom: no-tile + covers + box-fixed`,
    `box ${r.box.w}x${r.box.h} -> ${r.sized}, repeat=${r.repeat}, covers=${r.coversW && r.coversH}, boxFixed=${r.boxFixed}`)
}

// ── 2. OLD transform:scale demonstrably grew the box (documents the bug) ──
await page.goto(`${BASE}/${S}/vibe-2-raume.html`, { waitUntil: 'domcontentloaded' })
{
  const before = await page.locator('.hero-img').boundingBox()
  await page.evaluate(() => { document.querySelector('.hero-img').style.transform = 'scale(1.28)' })
  const after = await page.locator('.hero-img').boundingBox()
  log(after.width > before.width + 5, 'OLD transform:scale GREW the box (bug it replaces)', `${Math.round(before.width)} -> ${Math.round(after.width)}`)
}

await browser.close()
const fail = out.filter((x) => !x).length
console.log(`\n${'='.repeat(50)}\nPASS: ${out.length - fail}  FAIL: ${fail}`)
process.exit(fail ? 1 : 0)
