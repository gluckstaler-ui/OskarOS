// WP-117 follow-up — Overview restructure capture.
// READ-ONLY. Just loads /crm.html, switches to Overview, captures both themes.

import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT = join(process.cwd(), 'public', '2026-01-27-debug', 'screenshots')
mkdirSync(OUT, { recursive: true })
const BASE = 'http://localhost:3000'

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `wp117-${name}.png`), fullPage: false })
  console.log(`[shot] ${name}`)
}

async function setTheme(page, t) {
  await page.evaluate(theme => { try { localStorage.setItem('oskar-theme', theme) } catch {} }, t)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.crm-card[data-prospect-id]', { state: 'attached', timeout: 10000 })
}

async function gotoOverview(page) {
  await page.evaluate(() => {
    if (typeof window.switchView === 'function') window.switchView('overview')
  })
  await page.waitForTimeout(800)
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log(`[page.error] ${e.message}`))

  await page.goto(`${BASE}/crm.html`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.crm-card[data-prospect-id]', { state: 'attached', timeout: 10000 })

  console.log('── CLAUDE ──')
  await setTheme(page, 'onyx')
  await gotoOverview(page)
  await shot(page, 'claude-overview')

  console.log('── POLAR ──')
  await setTheme(page, 'polar')
  await gotoOverview(page)
  await shot(page, 'polar-overview')

  // also re-capture kanban in both themes to confirm no regression
  console.log('── KANBAN regression check ──')
  await page.evaluate(() => { if (typeof window.switchView === 'function') window.switchView('kanban') })
  await page.waitForTimeout(600)
  await shot(page, 'polar-kanban')
  await setTheme(page, 'onyx')
  await page.evaluate(() => { if (typeof window.switchView === 'function') window.switchView('kanban') })
  await page.waitForTimeout(600)
  await shot(page, 'claude-kanban')

  await browser.close()
  console.log('done.')
}

main().catch(err => { console.error('[wp117-capture] FAILED:', err); process.exit(1) })
