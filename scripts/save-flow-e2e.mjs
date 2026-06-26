/**
 * Drives the REAL studio and watches whether edits actually persist:
 * captures JS errors, console errors, and every /api/director/* request+status,
 * then makes a text edit + a director-off save and checks the file on disk.
 */
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
import path from 'path'

const BASE = process.argv[2] || 'http://localhost:3000'
const SESSION = '2026-04-25-silke-lengler'
const shot = (p, n) => p.screenshot({ path: `public/${SESSION}/screenshots/save-e2e-${n}.png` }).catch(() => {})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } })

page.on('pageerror', (e) => console.log('  💥 PAGEERROR:', e.message.split('\n')[0].slice(0, 160)))
page.on('console', (m) => { if (m.type() === 'error') console.log('  🔴 console.error:', m.text().slice(0, 160)) })
const apiCalls = []
page.on('response', async (r) => {
  const u = r.url()
  if (u.includes('/api/director/') || u.includes('/api/vibe-edit')) {
    let body = ''
    try { body = JSON.stringify(await r.json()).slice(0, 120) } catch {}
    apiCalls.push(`${r.status()} ${u.replace(BASE, '')} ${body}`)
    console.log(`  📡 ${r.status()} ${u.replace(BASE, '')} ${body}`)
  }
})
page.on('requestfailed', (r) => { if (r.url().includes('/api/director')) console.log('  ❌ REQ FAILED:', r.url().replace(BASE, ''), r.failure()?.errorText) })

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate((s) => { localStorage.setItem('oskar-session-id', s); localStorage.setItem('oskar-layout-mode', 'gallery') }, SESSION)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  const card = page.getByText(/r[äa]ume/i).first()
  if (await card.count()) await card.click().catch(() => {})
  await page.waitForTimeout(1500)

  const dir = page.locator('button[aria-label*="Edit HTML"], button[title="Director Mode"]').first()
  await dir.click({ timeout: 5000 }).catch((e) => console.log('dir click err', e.message.slice(0, 80)))
  await page.waitForTimeout(1500)
  await shot(page, 'director-on')

  // Pick a leaf text element in the iframe and edit it.
  const frame = page.frameLocator('iframe').first()
  const target = frame.locator('h1, h2, .hero-headline, p').first()
  const exists = await target.count()
  console.log('editable target count:', exists)
  if (exists) {
    const oldText = (await target.textContent().catch(() => '')) || ''
    console.log('old text:', oldText.slice(0, 40))
    // Triple-click selects the element's text block; typing replaces it.
    await target.click({ clickCount: 3, timeout: 4000 }).catch((e) => console.log('target click err', e.message.slice(0, 80)))
    await page.waitForTimeout(250)
    await page.keyboard.type('E2E SAVE PROBE 123', { delay: 15 }).catch(() => {})
    await page.waitForTimeout(300)
    const domText = (await target.textContent().catch(() => '')) || ''
    console.log('DOM text after typing:', domText.slice(0, 40), '|| edit registered in DOM:', domText.includes('E2E SAVE PROBE 123'))
    // Blur the editing host (focusout on <body>) — triggers the text flush.
    await page.mouse.click(5, 5)
    await page.waitForTimeout(1800)
  }

  // Toggle director OFF → should trigger saveAll → save-edits
  await dir.click({ timeout: 4000 }).catch((e) => console.log('dir off err', e.message.slice(0, 80)))
  await page.waitForTimeout(2000)
  await shot(page, 'after-save')

  // Did the file change on disk?
  const filePath = path.join(process.cwd(), 'public', SESSION, 'vibe-2-raume.html')
  const onDisk = readFileSync(filePath, 'utf-8')
  console.log('\nfile contains probe text on disk?', onDisk.includes('E2E SAVE PROBE 123'))
  console.log('total /api/director calls observed:', apiCalls.length)
  if (apiCalls.length === 0) console.log('>>> NO SAVE REQUESTS FIRED — the client never POSTed. Save is broken client-side.')
} catch (e) {
  console.log('SCRIPT ERROR:', e.message)
} finally {
  await browser.close()
}
