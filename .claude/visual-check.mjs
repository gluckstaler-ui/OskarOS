import puppeteer from 'puppeteer'

const browser = await puppeteer.launch({ headless: 'new' })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1400, deviceScaleFactor: 2 })

  // SCOUT — polar (the mockup's theme)
  await page.goto('http://localhost:3000/crm?view=scout&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.scout-lc-body', { timeout: 15000 })
  await page.evaluate(() => {
    const chip = document.querySelector('.scout-sc-verdict .scout-vchip')
    const body = chip && chip.closest('.scout-lc-body')
    if (body instanceof HTMLElement) body.click()
  })
  await page.waitForSelector('.scout-d-tasted', { timeout: 10000 })
  await page.evaluate(() => document.querySelector('.scout-d-tasted')?.closest('section')?.scrollIntoView({ block: 'start' }))
  await new Promise(r => setTimeout(r, 600))
  const clip = await page.evaluate(() => {
    const sec = document.querySelector('.scout-d-tasted')?.closest('section')
    const r = sec.getBoundingClientRect()
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 1300) }
  })
  await page.screenshot({ path: '/tmp/tasted-polar.png', clip })

  // KANBAN — open first lead, wait for the opp card properly
  await page.goto('http://localhost:3000/crm?view=kanban&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise(r => setTimeout(r, 1200))
  await page.evaluate(() => {
    const zone = document.querySelector('.crm-card .crm-card-header-zone') || document.querySelector('.crm-card')
    if (zone instanceof HTMLElement) zone.click()
  })
  let kanban = true
  try {
    await page.waitForSelector('.crm-opp-card', { timeout: 8000 })
  } catch { kanban = false }
  if (kanban) {
    await page.evaluate(() => document.querySelector('.crm-opp-card')?.scrollIntoView({ block: 'start' }))
    await new Promise(r => setTimeout(r, 500))
    const kclip = await page.evaluate(() => {
      const r = document.querySelector('.crm-opp-card').getBoundingClientRect()
      return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 1300) }
    })
    await page.screenshot({ path: '/tmp/kanban-opp.png', clip: kclip })
  } else {
    await page.screenshot({ path: '/tmp/kanban-opp.png' })
  }
  console.log(JSON.stringify({ kanban }))
} finally {
  await browser.close()
}
