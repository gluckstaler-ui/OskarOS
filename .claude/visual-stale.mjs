import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: 'new' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1200, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3000/crm?view=scout&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.scout-chip', { timeout: 15000 })
  // click the Stale taste chip
  const staleCount = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.scout-chip')].find(c => /Stale taste/.test(c.textContent || ''))
    if (!chip) return null
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return chip.textContent.trim()
  })
  await sleep(1200)
  // select first 3 stale rows, read the deck
  const result = await page.evaluate(() => {
    const checks = [...document.querySelectorAll('.scout-lc .scout-chk')]
    let n = 0
    for (const c of checks) { if (n >= 3) break; c.click(); n++ }
    return n
  })
  await sleep(700)
  const deck = await page.evaluate(() => {
    const d = document.querySelector('.scout-deck')
    if (!d) return null
    const taste = [...d.querySelectorAll('.scout-act')].find(b => /Taste/.test(b.textContent || ''))
    return { tasteLabel: taste?.textContent?.trim(), tasteDisabled: taste?.hasAttribute('disabled') }
  })
  const clip = await page.evaluate(() => {
    const bar = document.querySelector('.scout-chip')?.closest('div')
    const r = bar.getBoundingClientRect()
    return { x: Math.max(0, r.x), y: Math.max(0, r.y - 4), width: Math.min(r.width, 1480), height: r.height + 8 }
  })
  await page.screenshot({ path: '/tmp/stale-chip.png', clip })
  console.log(JSON.stringify({ staleCount, selected: result, deck }))
} finally { await browser.close() }
