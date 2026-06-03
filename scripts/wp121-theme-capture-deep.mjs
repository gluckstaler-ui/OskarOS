// WP-121 — DEEP theme capture. The shallow version only showed kanban
// thumbnails and the flight-plan rail; it never opened a card, so the
// People row + Company card + History action cluster (the surfaces that
// actually got palette-edited) were never proven.
//
// Per-theme: open a prospect, screenshot top of card, scroll to People,
// scroll to Company, scroll to History. Both views × both themes = 8 shots.
// READ-ONLY.

import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT_DIR = join(process.cwd(), 'public', '2026-01-27-debug', 'screenshots')
mkdirSync(OUT_DIR, { recursive: true })
const BASE = 'http://localhost:3000'

async function shot(page, name) {
  const path = join(OUT_DIR, `wp121-deep-${name}.png`)
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

async function debugTheme(page) {
  return page.evaluate(() => ({
    htmlDataTheme: document.documentElement.getAttribute('data-theme'),
    bgApp: getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim(),
    bgCard: getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim(),
  }))
}

async function openProspectInOverview(page, pid) {
  await page.evaluate(p => {
    if (typeof window.crmOverviewSelect === 'function') window.crmOverviewSelect(p)
  }, pid)
  await page.waitForSelector('#crm-people-section', { timeout: 5000 })
  await page.waitForFunction(() => {
    const list = document.getElementById('crm-people-list')
    return list && !list.textContent.includes('Loading contacts')
  }, { timeout: 5000 })
  await page.waitForTimeout(500)
}

async function openProspectInKanban(page, pid) {
  await page.evaluate(p => {
    if (typeof window.crmOpenModal === 'function') window.crmOpenModal(p)
  }, pid)
  await page.waitForSelector('.crm-expanded-overlay #crm-people-section, .crm-expanded-card #crm-people-section', { timeout: 5000 })
  await page.waitForFunction(() => {
    const list = document.getElementById('crm-people-list')
    return list && !list.textContent.includes('Loading contacts')
  }, { timeout: 5000 })
  await page.waitForTimeout(500)
}

async function scrollToSelector(page, selector) {
  await page.evaluate(sel => {
    const el = document.querySelector(sel)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, selector)
  await page.waitForTimeout(400)
}

async function switchToView(page, view) {
  await page.evaluate(v => {
    if (typeof window.switchView === 'function') window.switchView(v)
  }, view)
  await page.waitForTimeout(800)
}

async function captureTheme(page, themeLabel) {
  console.log(`\n── ${themeLabel.toUpperCase()} ──`)
  console.log('  ' + JSON.stringify(await debugTheme(page)))

  // OVERVIEW
  await switchToView(page, 'overview')
  await page.waitForTimeout(400)
  await openProspectInOverview(page, 'P021') // Filomax Wolf — populated address
  await scrollToSelector(page, '.crm-expanded-card, .crm-expanded-overlay')
  await shot(page, `${themeLabel}-overview-card-top`)
  await scrollToSelector(page, '#crm-people-section')
  await shot(page, `${themeLabel}-overview-people`)
  await scrollToSelector(page, '.crm-company-card')
  await shot(page, `${themeLabel}-overview-company`)
  await scrollToSelector(page, '#crm-modal-history')
  await shot(page, `${themeLabel}-overview-history`)

  // KANBAN
  await switchToView(page, 'kanban')
  await page.waitForTimeout(600)
  // In kanban, opening a card renders an inline overlay over the columns.
  await openProspectInKanban(page, 'P021')
  await scrollToSelector(page, '.crm-expanded-overlay, .crm-expanded-card')
  await shot(page, `${themeLabel}-kanban-card-top`)
  await scrollToSelector(page, '.crm-company-card')
  await shot(page, `${themeLabel}-kanban-company`)
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', err => console.log(`[page.error] ${err.message}`))

  await page.goto(`${BASE}/crm.html`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.crm-card[data-prospect-id]', { state: 'attached', timeout: 10000 })

  await setTheme(page, 'onyx')      // claude warm
  await captureTheme(page, 'claude')

  await setTheme(page, 'polar')
  await captureTheme(page, 'polar')

  await browser.close()
  console.log('\ndone.')
}

main().catch(err => {
  console.error('[wp121-theme-capture-deep] FAILED:', err)
  process.exit(1)
})
