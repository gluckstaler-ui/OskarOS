import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: 'new' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
try {
  const page = await browser.newPage()
  const logs = []
  page.on('console', (m) => { const t = m.text(); if (/rehydrat|ScoutPool|error/i.test(t)) logs.push(t.slice(0, 160)) })
  await page.setViewport({ width: 1500, height: 1200 })
  await page.goto('http://localhost:3000/crm?view=scout&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.scout-lc-body', { timeout: 15000 })
  await sleep(3000)
  const probe = await page.evaluate(async () => {
    const r = await fetch('/api/mcp/job-status', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: '__scout__' }),
    })
    const j = await r.json()
    return { status: r.status, body: JSON.stringify(j).slice(0, 300) }
  })
  const state = await page.evaluate(() => ({
    spinners: document.querySelectorAll('.scout-tasting').length,
    rows: document.querySelectorAll('.scout-lc').length,
  }))
  console.log(JSON.stringify({ probe, state, logs }))
} finally { await browser.close() }
