import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: 'new' })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1200, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3000/crm?view=scout&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.scout-lc-body', { timeout: 15000 })
  const clip = await page.evaluate(() => {
    const chip = document.querySelector('.scout-sc-verdict .scout-vchip')
    const row = chip && chip.closest('.scout-lc-body')
    if (!row) return null
    row.scrollIntoView({ block: 'center' })
    const r = row.getBoundingClientRect()
    return { x: Math.max(0, r.x), y: Math.max(0, r.y - 10), width: r.width, height: r.height + 20 }
  })
  await new Promise(r => setTimeout(r, 400))
  const c2 = await page.evaluate(() => {
    const chip = document.querySelector('.scout-sc-verdict .scout-vchip')
    const row = chip.closest('.scout-lc-body')
    const r = row.getBoundingClientRect()
    return { x: Math.max(0, r.x), y: Math.max(0, r.y - 10), width: r.width, height: r.height + 20 }
  })
  await page.screenshot({ path: '/tmp/scout-row.png', clip: c2 })
  console.log('ok')
} finally { await browser.close() }
