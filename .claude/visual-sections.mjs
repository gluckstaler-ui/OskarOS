import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: 'new' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
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
  await page.waitForSelector('.scout-d-tasted', { timeout: 10000 })

  // type 4 into the EMPTY sections lamp — single action, no clearing race
  await page.evaluate(() => {
    const lamps = [...document.querySelectorAll('.scout-d-dl')]
    const sec = lamps.find(l => l.querySelector('.scout-d-dl-name')?.textContent === 'SECTIONS')
    sec?.querySelector('.scout-d-dl-val .scout-edsp')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForSelector('.scout-d-dl .scout-edin', { timeout: 5000 })
  await page.type('.scout-d-dl .scout-edin', '4')
  await page.keyboard.press('Enter')
  await sleep(1600)

  const state = await page.evaluate(() => ({
    label: document.querySelector('.scout-d-tasted .scout-d-stat-span .crm-opp-verdict-stat-label')?.textContent ?? '',
    chf: document.querySelector('.scout-d-tasted .crm-opp-verdict-stat-value')?.value ?? '',
  }))
  const clip = await page.evaluate(() => {
    const el = document.querySelector('.scout-d-tasted .scout-d-stat-span')
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return null
  })
  await sleep(300)
  const c2 = await page.evaluate(() => {
    const r = document.querySelector('.scout-d-tasted .scout-d-stat-span').getBoundingClientRect()
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 }
  })
  await page.screenshot({ path: '/tmp/chf-from-sections.png', clip: c2 })
  console.log(JSON.stringify(state))
} finally { await browser.close() }
