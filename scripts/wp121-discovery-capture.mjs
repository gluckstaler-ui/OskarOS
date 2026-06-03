// Read-only capture of the Discovery-move in crmExpandedCardHtml.
//
// Two variants demonstrate the relocated affordance:
//   variant A — prospect WITH linked session   → session badge in History header
//   variant B — prospect WITHOUT linked session → dashed "+ Start Discovery"
//
// IMPORTANT: this script makes NO writes. It only renders the page and
// captures screenshots. Prior failure mode (capture script POSTing to the
// real DB) is prevented by simply not firing any mutation handlers.

import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT_DIR = join(process.cwd(), 'public', '2026-01-27-debug', 'screenshots')
mkdirSync(OUT_DIR, { recursive: true })
const BASE = 'http://localhost:3000'

async function shot(page, name) {
  const path = join(OUT_DIR, `wp121-discovery-${name}.png`)
  await page.screenshot({ path, fullPage: false })
  console.log(`[shot] ${name} → ${path}`)
}

async function shotElement(page, selector, name) {
  const el = await page.$(selector)
  if (!el) {
    console.warn(`[shot] ${name} skipped — selector "${selector}" not found`)
    return
  }
  const path = join(OUT_DIR, `wp121-discovery-${name}.png`)
  await el.screenshot({ path })
  console.log(`[shot] ${name} (element ${selector}) → ${path}`)
}

async function captureProspect(page, prospectId, variantLabel) {
  console.log(`\n── ${variantLabel} (${prospectId}) ──`)
  const ok = await page.evaluate(async (pid) => {
    const activeView = document.querySelector('[id^="view-"]:not(.hidden)')?.id
    if (activeView === 'view-overview' && typeof window.crmOverviewSelect === 'function') {
      await window.crmOverviewSelect(pid)
      return 'overview'
    }
    if (typeof window.crmOpenModal === 'function') {
      window.crmOpenModal(pid)
      return 'kanban'
    }
    return null
  }, prospectId)
  if (!ok) throw new Error(`failed to open ${prospectId}`)
  console.log(`→ opened ${prospectId} via ${ok}`)

  await page.waitForSelector('#crm-people-section', { timeout: 5000 })
  await page.waitForFunction(() => {
    const list = document.getElementById('crm-people-list')
    return list && !list.textContent.includes('Loading contacts')
  }, { timeout: 5000 })
  // Give the lucide icons a beat to paint.
  await page.waitForTimeout(400)

  await shot(page, `${variantLabel}-full`)

  // Scroll the History header bar into view (it's below the People section
  // and currently below the viewport). The History wrapper holds the
  // relocated Discovery action; capturing it proves the move landed.
  await page.evaluate(() => {
    const h = document.getElementById('crm-modal-history')
    if (h) h.scrollIntoView({ block: 'center', behavior: 'instant' })
  })
  await page.waitForTimeout(300)
  await shot(page, `${variantLabel}-history-scrolled`)

  // Tight crop around the History header bar so the new action cluster
  // — [Discovery] [Send WhatsApp] [+ Log Activity] — is unambiguous.
  // The header bar lives in a flex container inside the History div, two
  // levels up from #crm-modal-history.
  await shotElement(
    page,
    '#crm-modal-history',
    `${variantLabel}-history-list-only`,
  )
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  page.on('pageerror', err => console.log(`[page.error] ${err.message}`))
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[page.error] ${msg.text()}`)
  })

  console.log('→ loading /crm.html')
  await page.goto(`${BASE}/crm.html`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.crm-card[data-prospect-id]', { state: 'attached', timeout: 10000 })

  // Variant A — prospect WITH linked session (session badge in History header)
  await captureProspect(page, 'P001', 'A-with-session')

  // Variant B — prospect WITHOUT linked session (dashed + Start Discovery)
  await captureProspect(page, 'P003', 'B-no-session')

  await browser.close()
  console.log('\ndone.')
}

main().catch(err => {
  console.error('[wp121-discovery-capture] FAILED:', err)
  process.exit(1)
})
