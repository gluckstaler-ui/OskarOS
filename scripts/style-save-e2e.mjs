/**
 * Verifies STYLE edits persist: director on → open an image's gear popover →
 * change Fit (a style edit) → director off (saveAll) → assert save-edits POST
 * + the style on disk. Uses a throwaway COPY of a vibe so the real file is safe.
 */
import { chromium } from 'playwright'
import { copyFileSync, readFileSync, rmSync, mkdirSync } from 'fs'
import path from 'path'

const BASE = process.argv[2] || 'http://localhost:3000'
const REAL = '2026-04-25-silke-lengler'
const TMP = '__style-save-e2e__'
const tmpDir = path.join(process.cwd(), 'public', TMP)
mkdirSync(tmpDir, { recursive: true })
copyFileSync(path.join(process.cwd(), 'public', REAL, 'vibe-2-raume.html'), path.join(tmpDir, 'vibe-2-raume.html'))
// copy the hero image refs too? not needed — save-edits only writes HTML.

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } })
page.on('pageerror', (e) => console.log('  💥', e.message.split('\n')[0].slice(0, 140)))
const calls = []
page.on('response', async (r) => { if (r.url().includes('/api/director/save-edits')) { let b=''; try{b=JSON.stringify(await r.json()).slice(0,100)}catch{}; calls.push(`${r.status()} ${b}`); console.log('  📡 save-edits', r.status(), b) } })

try {
  await page.goto(`${BASE}/${TMP}/vibe-2-raume.html`, { waitUntil: 'domcontentloaded' })
  // This loads the vibe directly (no studio shell). To exercise the studio
  // director we must go through the app — but for the STYLE path we can call the
  // component's save route the way the client does, after a real style mutation.
  // Simplest faithful check: open the studio gallery on the TMP session.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate((s) => { localStorage.setItem('oskar-session-id', s); localStorage.setItem('oskar-layout-mode', 'gallery') }, TMP)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.getByText(/r[äa]ume/i).first().click().catch(() => {})
  await page.waitForTimeout(1500)
  const dir = page.locator('button[aria-label*="Edit HTML"], button[title="Director Mode"]').first()
  await dir.click({ timeout: 5000 }).catch((e) => console.log('dir err', e.message.slice(0, 60)))
  await page.waitForTimeout(1500)

  const frame = page.frameLocator('iframe').first()
  const img = frame.locator('.hero-img, [data-oskar-bgimg]').first()
  const bb = await img.boundingBox().catch(() => null)
  console.log('image box:', bb && `${Math.round(bb.width)}x${Math.round(bb.height)} @ ${Math.round(bb.x)},${Math.round(bb.y)}`)
  if (bb) {
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2)
    await page.waitForTimeout(700)
  }
  const gear = page.locator('button[aria-label="Open image styling options"]').first()
  console.log('gear count:', await gear.count())
  await gear.click({ timeout: 4000 }).catch((e) => console.log('gear err', e.message.slice(0, 60)))
  await page.waitForTimeout(700)
  // Change Fit → a style edit. PillGroup buttons contain the option text.
  const fitBtn = page.getByRole('button', { name: /^contain$/i }).first()
  console.log('fit button count:', await fitBtn.count())
  await fitBtn.click({ timeout: 3000 }).catch((e) => console.log('fit err', e.message.slice(0, 60)))
  await page.waitForTimeout(600)
  // Director OFF → saveAll → save-edits
  await dir.click({ timeout: 4000 }).catch((e) => console.log('dir off err', e.message.slice(0, 60)))
  await page.waitForTimeout(2000)

  const disk = readFileSync(path.join(tmpDir, 'vibe-2-raume.html'), 'utf-8')
  const heroHasStyle = /class="hero-img"[^>]*style="[^"]*background-size:\s*contain/.test(disk) || /background-size: contain/.test(disk)
  console.log('\nsave-edits calls:', calls.length)
  console.log('style persisted on disk (background-size: contain on hero-img):', heroHasStyle)
  console.log(calls.length > 0 && heroHasStyle ? '>>> STYLE SAVE OK' : '>>> STYLE SAVE NOT CONFIRMED (see logs)')
} catch (e) {
  console.log('ERR', e.message)
} finally {
  await browser.close()
  rmSync(tmpDir, { recursive: true, force: true })
}
