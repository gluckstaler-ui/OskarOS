import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: 'new' })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1400, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3000/crm?view=scout&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.scout-lc-body', { timeout: 15000 })
  await page.evaluate(() => {
    const chip = document.querySelector('.scout-sc-verdict .scout-vchip')
    const body = chip && chip.closest('.scout-lc-body')
    if (body instanceof HTMLElement) body.click()
  })
  await page.waitForSelector('.scout-d-tasted .crm-opp-verdict-stat-value', { timeout: 10000 })

  const before = await page.evaluate(() =>
    document.querySelector('.scout-d-tasted .crm-opp-verdict-stat-value')?.value ?? '')

  // type 1200 into CHF EST. and blur → saves → label should derive ÷300
  await page.click('.scout-d-tasted .crm-opp-verdict-stat-value', { clickCount: 3 })
  await page.type('.scout-d-tasted .crm-opp-verdict-stat-value', '1200')
  await page.evaluate(() => document.querySelector('.scout-d-tasted .crm-opp-verdict-stat-value')?.blur())
  await new Promise(r => setTimeout(r, 1500))

  const label = await page.evaluate(() =>
    document.querySelector('.scout-d-tasted .scout-d-stat-span .crm-opp-verdict-stat-label')?.textContent ?? '')

  // screenshot just the stat span
  const clip = await page.evaluate(() => {
    const el = document.querySelector('.scout-d-tasted .scout-d-stat-span')
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 }
  })
  await new Promise(r => setTimeout(r, 300))
  const clip2 = await page.evaluate(() => {
    const el = document.querySelector('.scout-d-tasted .scout-d-stat-span')
    const r = el.getBoundingClientRect()
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 }
  })
  await page.screenshot({ path: '/tmp/chf-label.png', clip: clip2 })

  // restore: clear the field (blank = delete intent → null)
  await page.click('.scout-d-tasted .crm-opp-verdict-stat-value', { clickCount: 3 })
  await page.keyboard.press('Backspace')
  await page.evaluate(() => document.querySelector('.scout-d-tasted .crm-opp-verdict-stat-value')?.blur())
  await new Promise(r => setTimeout(r, 1200))
  const restored = await page.evaluate(() =>
    document.querySelector('.scout-d-tasted .scout-d-stat-span .crm-opp-verdict-stat-label')?.textContent ?? '')

  console.log(JSON.stringify({ before, label, restored }))
} finally { await browser.close() }
