// Compare the Company section visual treatment side-by-side.
//   reference — public/2026-01-27-debug/territoryxfathom/kanban.html
//   current   — /crm.html with an expanded prospect
//
// READ-ONLY. No DB mutations.

import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import { join } from 'path'

const OUT_DIR = join(process.cwd(), 'public', '2026-01-27-debug', 'screenshots')
mkdirSync(OUT_DIR, { recursive: true })
const BASE = 'http://localhost:3000'

async function shot(page, name) {
  const path = join(OUT_DIR, `wp121-company-${name}.png`)
  await page.screenshot({ path, fullPage: false })
  console.log(`[shot] ${name}`)
}

async function shotEl(page, selector, name) {
  const el = await page.$(selector)
  if (!el) {
    console.warn(`[shot] ${name} skipped — "${selector}" not found`)
    return
  }
  const path = join(OUT_DIR, `wp121-company-${name}.png`)
  await el.screenshot({ path })
  console.log(`[shot] ${name} (element ${selector})`)
}

async function captureReference(page) {
  console.log('\n── REFERENCE (territoryxfathom) ──')
  await page.goto(`${BASE}/2026-01-27-debug/territoryxfathom/kanban.html`, { waitUntil: 'networkidle' })
  // The territoryxfathom prototype renders the kanban with cards collapsed.
  // Open a card by simulating a click on the first lead row. We try a few
  // likely selectors — the source uses both `.crm-card` and inline handlers.
  // Wait for React to mount.
  await page.waitForTimeout(2500)
  // Click a lead card. Each card has CHF on it and has an onClick at the
  // root div. Find a div whose direct text contains "Bar Olimpia" or similar.
  const opened = await page.evaluate(() => {
    const allDivs = Array.from(document.querySelectorAll('div'))
    // Look for divs that look like a card: contain "CHF" + a company-name-looking text
    const cards = allDivs.filter(d => {
      const r = d.getBoundingClientRect()
      const txt = (d.textContent || '')
      return r.width > 180 && r.width < 380
        && r.height > 50 && r.height < 130
        && /CHF/.test(txt)
        && /\d/.test(txt)
        && r.x > 0 && r.y > 100
    })
    // Reject column headers (they say "X leads" + CHF total). Pick a card by
    // a strong lead-signature: contains "% " (confidence) OR matches a known
    // lead name visible in the kanban.
    const known = ['Bar Olimpia', 'Caffè Sant', 'Ristorante La Pergola', 'Hairsalon Capelli']
    const namedHit = cards.find(c => {
      const t = c.textContent || ''
      return known.some(n => t.includes(n)) && !/leads/.test(t)
    })
    const chosen = namedHit
      || cards.filter(c => !/leads/.test(c.textContent || '') && /%/.test(c.textContent || ''))[0]
      || cards.filter(c => !/leads/.test(c.textContent || ''))[0]
    if (!chosen) return null
    const r = chosen.getBoundingClientRect()
    chosen.click()
    return { x: r.x, y: r.y, w: r.width, h: r.height, text: (chosen.textContent || '').slice(0, 80) }
  })
  console.log('→ opened:', JSON.stringify(opened))
  await page.waitForTimeout(1500)
  await shot(page, 'reference-full')
  // Scroll the address container into view, then crop it.
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('*')).filter(el => {
      const t = (el.textContent || '').trim()
      return t === 'Strasse' && t.length < 20
    })
    if (labels.length) labels[0].scrollIntoView({ block: 'center', behavior: 'instant' })
  })
  await page.waitForTimeout(400)
  await shot(page, 'reference-scrolled')
  const addrCrop = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'))
    // Find the smallest ancestor that contains BOTH Strasse and Webpage labels.
    const strasse = all.find(el => (el.textContent || '').trim() === 'Strasse')
    if (!strasse) return null
    let node = strasse
    for (let i = 0; i < 8 && node && node.parentElement; i++) {
      const t = node.textContent || ''
      if (/Strasse/.test(t) && /Webpage/.test(t) && /UID|MWSt/.test(t)) {
        const r = node.getBoundingClientRect()
        return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }
      }
      node = node.parentElement
    }
    return null
  })
  if (addrCrop && addrCrop.y >= 0 && addrCrop.y + addrCrop.height <= 900) {
    console.log('→ address crop:', JSON.stringify(addrCrop))
    await page.screenshot({
      path: join(OUT_DIR, 'wp121-company-reference-addr-crop.png'),
      clip: addrCrop,
    })
    console.log('[shot] reference-addr-crop')
  } else if (addrCrop) {
    console.log('→ address found at', JSON.stringify(addrCrop), 'but outside viewport; using element shot')
    // Fall back to element screenshot via Playwright (no clip).
    const handle = await page.evaluateHandle(() => {
      const all = Array.from(document.querySelectorAll('*'))
      const strasse = all.find(el => (el.textContent || '').trim() === 'Strasse')
      if (!strasse) return null
      let node = strasse
      for (let i = 0; i < 8 && node && node.parentElement; i++) {
        const t = node.textContent || ''
        if (/Strasse/.test(t) && /Webpage/.test(t) && /UID|MWSt/.test(t)) return node
        node = node.parentElement
      }
      return null
    })
    const el = handle.asElement()
    if (el) {
      await el.screenshot({ path: join(OUT_DIR, 'wp121-company-reference-addr-crop.png') })
      console.log('[shot] reference-addr-crop (element)')
    }
  } else {
    console.log('→ no address container found; full shot only')
  }
}

async function captureCurrent(page) {
  console.log('\n── CURRENT (/crm.html) ──')
  await page.goto(`${BASE}/crm.html`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.crm-card[data-prospect-id]', { state: 'attached', timeout: 10000 })

  // P021 (Filomax Wolf) has address fields populated; use it so the
  // comparison shows actual filled values, not empty placeholders.
  await page.evaluate(async () => {
    const pid = 'P021'
    const activeView = document.querySelector('[id^="view-"]:not(.hidden)')?.id
    if (activeView === 'view-overview' && typeof window.crmOverviewSelect === 'function') {
      await window.crmOverviewSelect(pid)
    } else if (typeof window.crmOpenModal === 'function') {
      window.crmOpenModal(pid)
    }
  })
  await page.waitForSelector('#crm-people-section', { timeout: 5000 })
  await page.waitForFunction(() => {
    const list = document.getElementById('crm-people-list')
    return list && !list.textContent.includes('Loading contacts')
  }, { timeout: 5000 })

  // Scroll the Company card into view (the section header was removed,
  // so we now find it by the `.crm-company-card` class).
  await page.evaluate(() => {
    const card = document.querySelector('.crm-company-card')
    if (card) card.scrollIntoView({ block: 'center', behavior: 'instant' })
  })
  await page.waitForTimeout(300)
  await shot(page, 'current-full')

  const handle = await page.$('.crm-company-card')
  if (handle) {
    await handle.screenshot({ path: join(OUT_DIR, 'wp121-company-current-crop.png') })
    console.log('[shot] current-crop (element .crm-company-card)')
  } else {
    console.log('→ .crm-company-card not found')
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', err => console.log(`[page.error] ${err.message}`))

  await captureReference(page)
  await captureCurrent(page)

  await browser.close()
  console.log('\ndone.')
}

main().catch(err => {
  console.error('[wp121-company-compare] FAILED:', err)
  process.exit(1)
})
