import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: 'new' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1400, deviceScaleFactor: 2 })
  await page.goto('http://localhost:3000/crm?view=scout&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.scout-lc-body', { timeout: 15000 })
  // search down to the Balancd / Fröhls row (R1069 — the Scout card with the \n artifact)
  const typed = await page.evaluate(() => {
    const inp = [...document.querySelectorAll('input')].find(i => /such|search|filter/i.test(i.placeholder || '') || i.type === 'search') ||
                [...document.querySelectorAll('input[type="text"]')][0]
    if (!inp) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(inp, 'Fröhls')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })
  await sleep(900)
  await page.evaluate(() => document.querySelector('.scout-lc-body')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await page.waitForSelector('.scout-d-tasted', { timeout: 10000 })
  const pitch = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.scout-d-block')]
    const b = blocks.find(x => /WHAT TO PITCH/.test(x.querySelector('.scout-d-block-l')?.textContent || ''))
    if (!b) return null
    b.scrollIntoView({ block: 'center' })
    const rows = [...b.querySelectorAll('.scout-d-row')].map(r => ({
      text: r.querySelector('.scout-d-row-t')?.textContent?.trim().slice(0, 60),
      price: r.querySelector('.scout-d-row-price')?.textContent ?? null,
    }))
    return { rowCount: rows.length, rows, hasLiteralBackslashN: (b.textContent || '').includes('\\n') }
  })
  await sleep(300)
  const clip = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.scout-d-block')]
    const b = blocks.find(x => /WHAT TO PITCH/.test(x.querySelector('.scout-d-block-l')?.textContent || ''))
    const r = b.getBoundingClientRect()
    return { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: r.width + 12, height: r.height + 12 }
  })
  await page.screenshot({ path: '/tmp/pitch-fix.png', clip })
  console.log(JSON.stringify({ typed, pitch }))
} finally { await browser.close() }
