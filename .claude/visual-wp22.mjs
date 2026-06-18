import puppeteer from 'puppeteer'
const browser = await puppeteer.launch({ headless: 'new' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1400, deviceScaleFactor: 2 })

  // SCOUT — open dossier, read tone class, click the VERDICT kicker, re-read
  await page.goto('http://localhost:3000/crm?view=scout&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.scout-lc-body', { timeout: 15000 })
  await page.evaluate(() => {
    const chip = document.querySelector('.scout-sc-verdict .scout-vchip')
    const body = chip && chip.closest('.scout-lc-body')
    if (body instanceof HTMLElement) body.click()
  })
  await page.waitForSelector('.scout-d-tasted .crm-opp-verdict', { timeout: 10000 })
  const toneBefore = await page.evaluate(() =>
    [...document.querySelector('.scout-d-tasted .crm-opp-verdict').classList].find(c => c.startsWith('crm-opp-verdict--')))
  await page.click('.scout-d-tasted .crm-opp-verdict-tag')
  await sleep(1500)
  const toneAfter = await page.evaluate(() =>
    [...document.querySelector('.scout-d-tasted .crm-opp-verdict').classList].find(c => c.startsWith('crm-opp-verdict--')))
  await page.evaluate(() => document.querySelector('.scout-d-tasted')?.closest('section')?.scrollIntoView({ block: 'start' }))
  await sleep(400)
  const c1 = await page.evaluate(() => {
    const r = document.querySelector('.scout-d-tasted').closest('section').getBoundingClientRect()
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 700) }
  })
  await page.screenshot({ path: '/tmp/wp22-scout.png', clip: c1 })

  // collapsed-row sections fact (re-open pool view fresh)
  await page.goto('http://localhost:3000/crm?view=scout&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('.scout-lc-body', { timeout: 15000 })
  const sectionsFact = await page.evaluate(() =>
    [...document.querySelectorAll('.scout-q-fact')].some(el => /Sections/.test(el.textContent || '')))

  // KANBAN — PALAT label, conditional prose cards, kicker affordance
  await page.goto('http://localhost:3000/crm?view=kanban&theme=polar', { waitUntil: 'networkidle2', timeout: 30000 })
  await sleep(1200)
  await page.evaluate(() => {
    const zone = document.querySelector('.crm-card .crm-card-header-zone') || document.querySelector('.crm-card')
    if (zone instanceof HTMLElement) zone.click()
  })
  await page.waitForSelector('.crm-opp-card', { timeout: 8000 })
  const kanban = await page.evaluate(() => ({
    palatLabel: [...document.querySelectorAll('.crm-opp-verdict-stat-label')].some(el => /PALAT/.test(el.textContent || '')),
    kickerCursor: getComputedStyle(document.querySelector('.crm-opp-verdict-tag')).cursor,
    proseCards: document.querySelectorAll('.crm-opp-prose .crm-opp-prose-card').length,
  }))
  await page.evaluate(() => document.querySelector('.crm-opp-card').scrollIntoView({ block: 'start' }))
  await sleep(400)
  const c2 = await page.evaluate(() => {
    const r = document.querySelector('.crm-opp-card').getBoundingClientRect()
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: Math.min(r.height, 1300) }
  })
  await page.screenshot({ path: '/tmp/wp22-kanban.png', clip: c2 })

  console.log(JSON.stringify({ toneBefore, toneAfter, sectionsFact, kanban }))
} finally { await browser.close() }
