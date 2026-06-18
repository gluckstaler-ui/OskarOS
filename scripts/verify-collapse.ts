// scripts/verify-collapse.ts — proof that collapsing the deck widens the
// Consular chat (.fp-right) by ≥200px. Loads the LIVE /crm off the running dev
// server, measures .fp-right before/after the is-deck-collapsed class, and
// screenshots the collapsed state. Read-only — no repo/DB writes (screenshot → /tmp).
import puppeteer from 'puppeteer'
import { findBinary } from '@/lib/cli-paths'

const URL = 'http://localhost:3000/crm'

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: findBinary('chromium'),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForSelector('.fp-grid', { timeout: 30000 })
    await page.waitForSelector('.fp-right', { timeout: 30000 })

    const before = await page.evaluate(() =>
      Math.round(document.querySelector('.fp-right')!.getBoundingClientRect().width))

    // Simulate the COLLAPSE toggle: deckCollapsed=true → .fp-grid gets is-deck-collapsed.
    await page.evaluate(() => document.querySelector('.fp-grid')!.classList.add('is-deck-collapsed'))
    await new Promise((r) => setTimeout(r, 600)) // let the 280ms column transition settle

    const after = await page.evaluate(() => ({
      width: Math.round(document.querySelector('.fp-right')!.getBoundingClientRect().width),
      cols: getComputedStyle(document.querySelector('.fp-grid')!).gridTemplateColumns,
    }))

    await page.screenshot({ path: '/tmp/crm-collapsed.png' })
    console.log(JSON.stringify({ before, after, delta: after.width - before }, null, 2))
  } finally {
    await browser.close()
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
