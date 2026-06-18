// scripts/verify-bubble.ts — proof that assistant chat bubbles now stop ~20px
// before the panel border (was ~100px). Loads live /crm, forces the welcome
// bubble to its max width, measures the gap from its right edge to the .fp-right
// border. Read-only (screenshot → /tmp).
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
    await page.waitForSelector('.fp-right', { timeout: 30000 })
    await page.waitForFunction(
      () => [...document.querySelectorAll('p')].some((p) => (p.textContent || '').includes('Creative Director')),
      { timeout: 30000 },
    )

    const result = await page.evaluate(() => {
      const p = [...document.querySelectorAll('p')].find((e) => (e.textContent || '').includes('Creative Director'))
      if (!p) return { err: 'welcome bubble not found' }
      const box = p.parentElement as HTMLElement // the styled bubble div (maxWidth)
      box.style.minWidth = '0'
      p.textContent = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod. '.repeat(12)
      const panel = box.closest('.fp-right') as HTMLElement | null
      const b = box.getBoundingClientRect()
      const pr = panel?.getBoundingClientRect()
      return {
        maxWidth: getComputedStyle(box).maxWidth,
        bubbleWidthPx: Math.round(b.width),
        panelWidthPx: pr ? Math.round(pr.width) : null,
        gapToBorderPx: pr ? Math.round(pr.right - b.right) : null,
      }
    })

    await page.screenshot({ path: '/tmp/crm-bubble.png' })
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await browser.close()
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
