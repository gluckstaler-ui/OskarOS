// WP-121 People — capture script. Walks the kanban expanded card through
// the four scenarios in the spec:
//   1. baseline (seeded contact from prospects.contact_*)
//   2. + Add Contact
//   3. inline edit (name + role)
//   4. ★ decisive toggle
//   5. × delete
// Saves PNGs to public/2026-01-27-debug/screenshots/wp121-*.png
//
// Usage: node scripts/wp121-capture.mjs
// Requires dev server on http://localhost:3000.

import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT_DIR = join(process.cwd(), 'public', '2026-01-27-debug', 'screenshots')
mkdirSync(OUT_DIR, { recursive: true })

const BASE = 'http://localhost:3000'

async function shot(page, name) {
  const path = join(OUT_DIR, `wp121-${name}.png`)
  await page.screenshot({ path, fullPage: false })
  console.log(`[shot] ${name} → ${path}`)
  return path
}

async function shotElement(page, selector, name) {
  const el = await page.$(selector)
  if (!el) {
    console.warn(`[shot] ${name} skipped — selector "${selector}" not found`)
    return null
  }
  const path = join(OUT_DIR, `wp121-${name}.png`)
  await el.screenshot({ path })
  console.log(`[shot] ${name} (element ${selector}) → ${path}`)
  return path
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  page.on('console', msg => {
    const t = msg.type()
    if (t === 'error' || t === 'warning') console.log(`[page.${t}] ${msg.text()}`)
  })
  page.on('pageerror', err => console.log(`[page.error] ${err.message}`))

  console.log('→ loading /crm.html')
  await page.goto(`${BASE}/crm.html`, { waitUntil: 'networkidle' })
  // Wait for at least one prospect card to exist in the DOM (kanban cards
  // are clipped by column overflow so `visible` check is too strict).
  await page.waitForSelector('.crm-card[data-prospect-id]', { state: 'attached', timeout: 10000 })

  // The page boots into Overview by default. Use the right entry point
  // for whichever view is active — crmOverviewSelect for Overview,
  // crmExpandCardInline for Kanban.
  const { prospectId, viewUsed } = await page.evaluate(async () => {
    const card = document.querySelector('.crm-card[data-prospect-id]')
    if (!card) return { prospectId: null, viewUsed: null }
    const pid = card.getAttribute('data-prospect-id')
    const activeView = document.querySelector('[id^="view-"]:not(.hidden)')?.id
    if (activeView === 'view-overview' && typeof window.crmOverviewSelect === 'function') {
      await window.crmOverviewSelect(pid)
      return { prospectId: pid, viewUsed: 'overview' }
    }
    if (typeof window.crmExpandCardInline === 'function') {
      window.crmExpandCardInline(pid)
      return { prospectId: pid, viewUsed: 'kanban' }
    }
    card.click()
    return { prospectId: pid, viewUsed: 'click' }
  })
  if (!prospectId) throw new Error('No prospect cards rendered')
  console.log(`→ expanded prospect ${prospectId} via ${viewUsed}`)

  // Give the expansion a beat to render, then debug-shot before waiting.
  await page.waitForTimeout(800)
  await shot(page, 'debug-after-expand')
  const debugInfo = await page.evaluate(() => ({
    activeView: document.querySelector('[id^="view-"]:not(.hidden)')?.id,
    hasOverlay: !!document.querySelector('.crm-expanded-overlay'),
    hasExpandedCard: !!document.querySelector('.crm-expanded-card'),
    hasPeopleSection: !!document.getElementById('crm-people-section'),
    bodyClasses: document.body.className,
  }))
  console.log('[debug]', JSON.stringify(debugInfo))

  // The expanded card mounts asynchronously; wait for the People section
  // to either show contacts or the "no contacts yet" stub.
  await page.waitForSelector('#crm-people-section', { timeout: 5000 })
  await page.waitForFunction(
    () => {
      const list = document.getElementById('crm-people-list')
      return list && !list.textContent.includes('Loading contacts')
    },
    { timeout: 5000 },
  )

  await shot(page, '01-expanded-card')
  await shotElement(page, '#crm-people-section', '02-people-section-seeded')

  // ── Scenario: + Add Contact ────────────────────────────────────────────
  console.log('→ clicking + Add Contact')
  await page.click('.crm-people-add')
  // Wait for the new row to appear (contact count went up by 1).
  await page.waitForFunction(
    () => document.querySelectorAll('#crm-people-list .crm-person').length >= 2,
    { timeout: 5000 },
  )
  await shotElement(page, '#crm-people-section', '03-people-section-after-add')

  // ── Scenario: inline edit name + role on the new row ───────────────────
  // Each field-edit may trigger a re-render that swaps the DOM node, so
  // we re-query the row + field BEFORE every interaction and we capture
  // the contact id once up front to stay anchored across re-renders.
  console.log('→ inline-editing the new contact')
  const newContactId = await page.evaluate(() => {
    const row = document.querySelector('#crm-people-list .crm-person:last-child')
    return row ? row.getAttribute('data-contact-id') : null
  })
  if (newContactId) {
    const rowSel = `#crm-people-list .crm-person[data-contact-id="${newContactId}"]`
    async function editField(fieldSel, value) {
      await page.click(`${rowSel} ${fieldSel}`)
      await page.fill(`${rowSel} ${fieldSel}`, value)
      await page.evaluate(([sel]) => {
        const el = document.querySelector(sel)
        if (el) el.blur()
      }, [`${rowSel} ${fieldSel}`])
      await page.waitForTimeout(300)
    }
    await editField('.crm-person-name-edit', 'Marco Rossi')
    await editField('.crm-person-detail-edit', 'junior associate')
    await page.selectOption(`${rowSel} .crm-person-role-select`, 'champion')
    await page.waitForTimeout(400)
  }
  await shotElement(page, '#crm-people-section', '04-people-section-after-edit')

  // ── Scenario: ★ decisive toggle ────────────────────────────────────────
  // The new row's contact id is captured above; queries below re-anchor.
  console.log('→ toggling ★ decisive on the new row')
  if (newContactId) {
    const rowSel = `#crm-people-list .crm-person[data-contact-id="${newContactId}"]`
    await page.click(`${rowSel} .crm-decisive-btn`)
    await page.waitForTimeout(400)
  }
  await shotElement(page, '#crm-people-section', '05-people-section-after-decisive')

  // ── Scenario: × delete the new row (confirm dialog handled) ────────────
  console.log('→ deleting the new row')
  page.once('dialog', d => d.accept())
  if (newContactId) {
    const rowSel = `#crm-people-list .crm-person[data-contact-id="${newContactId}"]`
    await page.click(`${rowSel} .crm-person-rm`)
    await page.waitForTimeout(400)
  }
  await shotElement(page, '#crm-people-section', '06-people-section-after-delete')

  await browser.close()
  console.log('done.')
}

main().catch(err => {
  console.error('[wp121-capture] FAILED:', err)
  process.exit(1)
})
