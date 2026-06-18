import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: 'new' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1200, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3000/crm?view=scout&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.scout-lc .scout-chk', { timeout: 15000 })
  const selected = await page.evaluate(() => {
    // only row-level checkboxes (inside a .scout-lc article), never a header select-all
    const checks = [...document.querySelectorAll('.scout-lc .scout-chk')]
    let n = 0
    for (const c of checks) { if (n >= 3) break; c.click(); n++ }
    return n
  })
  await sleep(800)
  const deck = await page.evaluate(() => {
    const d = document.querySelector('.scout-deck')
    if (!d) return null
    const research = [...d.querySelectorAll('.scout-act')].find(b => /Research/.test(b.textContent || ''))
    return {
      sum: d.querySelector('.sum')?.textContent ?? '',
      researchLabel: research?.textContent?.trim() ?? null,
      researchDisabled: research?.hasAttribute('disabled') ?? null,
    }
  })
  if (deck) {
    const clip = await page.evaluate(() => {
      const r = document.querySelector('.scout-deck').getBoundingClientRect()
      return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: r.width + 12, height: r.height + 12 }
    })
    await page.screenshot({ path: '/tmp/research-deck.png', clip })
  }
  console.log(JSON.stringify({ selected, deck }))
} finally { await browser.close() }
