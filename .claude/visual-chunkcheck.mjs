import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: 'new' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 1000 })
  await page.goto('http://localhost:3000/crm?view=scout&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.scout-lc-body', { timeout: 15000 })
  const found = await page.evaluate(async () => {
    const srcs = [...document.querySelectorAll('script[src]')].map(s => s.src)
    let hit = null, scanned = 0
    for (const src of srcs) {
      try {
        const t = await (await fetch(src)).text()
        scanned++
        if (t.includes('taste rehydration failed')) { hit = src; break }
      } catch { /* skip */ }
    }
    return { scanned, total: srcs.length, hit }
  })
  await sleep(4000)
  const spinners = await page.evaluate(() => document.querySelectorAll('.scout-tasting').length)
  console.log(JSON.stringify({ found, spinners }))
} finally { await browser.close() }
