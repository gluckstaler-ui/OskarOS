/**
 * Drives the STUDIO (3-panel) surface — the one the user actually uses — opens
 * a vibe via the CanvasPanel tabs, enables Director, edits text, and checks
 * whether anything persists. Captures errors + every /api/director call.
 * Uses a throwaway COPY so the real vibe is never touched.
 */
import { chromium } from 'playwright'
import { copyFileSync, readFileSync, mkdirSync, rmSync } from 'fs'
import path from 'path'

const BASE = process.argv[2] || 'http://localhost:3000'
const REAL = '2026-04-25-silke-lengler'
const TMP = '__studio-save-e2e__'
const tmp = path.join(process.cwd(), 'public', TMP)
mkdirSync(tmp, { recursive: true })
copyFileSync(path.join(process.cwd(), 'public', REAL, 'vibe-1-das-zuviel.html'), path.join(tmp, 'vibe-1-das-zuviel.html'))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true })
const page = await ctx.newPage()
const shot = (n) => page.screenshot({ path: `public/${REAL}/screenshots/studio-save-${n}.png` }).catch(() => {})
page.on('pageerror', (e) => console.log('  💥 PAGEERROR:', e.message.split('\n')[0].slice(0, 160)))
page.on('console', (m) => { if (m.type() === 'error' && !/shorthand|same key/.test(m.text())) console.log('  🔴', m.text().slice(0, 150)) })
const api = []
page.on('response', async (r) => { if (r.url().includes('/api/director/') || r.url().includes('/api/vibe-edit')) { let b = ''; try { b = JSON.stringify(await r.json()).slice(0, 110) } catch {}; api.push(r.status()); console.log('  📡', r.status(), r.url().replace(BASE, ''), b) } })

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate((s) => { localStorage.setItem('oskar-session-id', s); localStorage.setItem('oskar-layout-mode', '3-panel') }, TMP)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await shot('1-studio')

  // Select the vibe via the CanvasPanel tab strip (uppercase vibe name button).
  const tab = page.getByRole('button', { name: /zuviel|das zuviel|raume|tiefer/i }).first()
  console.log('vibe tabs:', await page.getByRole('button', { name: /zuviel|raume|tiefer|stille/i }).count())
  await tab.click({ timeout: 5000 }).catch((e) => console.log('  tab click:', e.message.slice(0, 80)))
  await page.waitForTimeout(1500)
  await shot('2-vibe')

  const dir = page.locator('button[title="Director Mode"], button[aria-label*="Edit HTML"]').first()
  console.log('director btn:', await dir.count())
  await dir.click({ timeout: 5000 }).catch((e) => console.log('  dir click:', e.message.slice(0, 80)))
  await page.waitForTimeout(1500)
  await shot('3-director')

  const frame = page.frameLocator('iframe').first()
  const target = frame.locator('h1, h2, .hero-headline, p').first()
  console.log('editable target:', await target.count())
  const before = (await target.textContent().catch(() => '')) || ''
  await target.click({ clickCount: 3, timeout: 4000 }).catch((e) => console.log('  target click:', e.message.slice(0, 80)))
  await page.waitForTimeout(250)
  await page.keyboard.type('STUDIO SAVE PROBE 999', { delay: 15 }).catch(() => {})
  await page.waitForTimeout(300)
  const after = (await target.textContent().catch(() => '')) || ''
  console.log('edit registered in DOM:', after.includes('STUDIO SAVE PROBE 999'), '| was:', before.slice(0, 30))
  // Blur the editing host: click the toolbar area outside the iframe.
  await page.mouse.click(8, 8)
  await page.waitForTimeout(1200)
  // Also toggle director off (the studio's primary "save" gesture).
  await dir.click({ timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(2000)
  await shot('4-saved')

  const disk = readFileSync(path.join(tmp, 'vibe-1-das-zuviel.html'), 'utf-8')
  console.log('\n=== RESULT ===')
  console.log('api calls:', api.length)
  console.log('probe text on disk:', disk.includes('STUDIO SAVE PROBE 999'))
  console.log(api.length === 0 ? '>>> STUDIO: NO save request fired at all' : (disk.includes('STUDIO SAVE PROBE 999') ? '>>> STUDIO SAVE OK' : '>>> STUDIO: request fired but not persisted'))
} catch (e) {
  console.log('ERR', e.message)
} finally {
  await browser.close()
  rmSync(tmp, { recursive: true, force: true })
}
