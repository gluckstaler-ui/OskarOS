// WP-121 — capture both CRM views (overview + kanban) in BOTH themes
// (claude warm + polar light) to verify the palette swap landed and
// nothing in the polar branch broke. READ-ONLY: no DB writes.

import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT_DIR = join(process.cwd(), 'public', '2026-01-27-debug', 'screenshots')
mkdirSync(OUT_DIR, { recursive: true })
const BASE = 'http://localhost:3000'

async function shot(page, name) {
  const path = join(OUT_DIR, `wp121-theme-${name}.png`)
  await page.screenshot({ path, fullPage: false })
  console.log(`[shot] ${name}`)
}

async function setTheme(page, theme) {
  await page.evaluate(t => {
    try { localStorage.setItem('oskar-theme', t) } catch {}
  }, theme)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.crm-card[data-prospect-id]', { state: 'attached', timeout: 10000 })
}

async function switchToView(page, view) {
  // The kanban + overview pills live in the top nav. Use the global
  // switchView() function exported by crm.html.
  await page.evaluate(v => {
    if (typeof window.switchView === 'function') window.switchView(v)
  }, view)
  await page.waitForTimeout(800)
}

async function debugTheme(page, label) {
  const info = await page.evaluate(() => ({
    htmlDataTheme: document.documentElement.getAttribute('data-theme'),
    bgApp: getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim(),
    bgCard: getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim(),
    textMain: getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim(),
    storedTheme: (() => { try { return localStorage.getItem('oskar-theme') } catch { return null } })(),
  }))
  console.log(`  [debug ${label}]`, JSON.stringify(info))
}

async function captureBoth(page, themeLabel) {
  await switchToView(page, 'overview')
  await page.waitForTimeout(500)
  await debugTheme(page, themeLabel + '/overview')
  await shot(page, `${themeLabel}-overview`)

  await switchToView(page, 'kanban')
  await page.waitForTimeout(800)
  await debugTheme(page, themeLabel + '/kanban')
  await shot(page, `${themeLabel}-kanban`)
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', err => console.log(`[page.error] ${err.message}`))

  console.log('→ loading /crm.html')
  await page.goto(`${BASE}/crm.html`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.crm-card[data-prospect-id]', { state: 'attached', timeout: 10000 })

  // CLAUDE (warm) — currentTheme defaults to onyx (no localStorage value)
  console.log('\n── CLAUDE (warm) ──')
  await setTheme(page, 'onyx')
  await captureBoth(page, 'claude')

  // POLAR (light) — switch via localStorage
  console.log('\n── POLAR (light) ──')
  await setTheme(page, 'polar')
  await captureBoth(page, 'polar')

  await browser.close()
  console.log('\ndone.')
}

main().catch(err => {
  console.error('[wp121-theme-capture] FAILED:', err)
  process.exit(1)
})
