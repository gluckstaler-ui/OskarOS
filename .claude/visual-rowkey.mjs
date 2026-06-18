import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: 'new' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1200, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3000/crm?view=scout&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.scout-lc-body', { timeout: 15000 })
  await page.evaluate(() => document.querySelector('.scout-lc-body')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await page.waitForSelector('.scout-dhdr', { timeout: 10000 })
  const cell = await page.evaluate(() => {
    const el = document.querySelector('.scout-profil')
    el?.scrollIntoView({ block: 'center' })
    return { text: el?.textContent?.trim().slice(0, 90), boldFirst: el?.firstElementChild?.tagName === 'B', key: el?.firstElementChild?.textContent }
  })
  await sleep(400)
  const clip = await page.evaluate(() => {
    const r = document.querySelector('.scout-dhdr').getBoundingClientRect()
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 260) }
  })
  await page.screenshot({ path: '/tmp/rowkey-header.png', clip })
  console.log(JSON.stringify(cell))
} finally { await browser.close() }
