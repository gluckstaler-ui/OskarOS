// Throwaway: deep-link the studio to barbazza + META tab, screenshot it.
import puppeteer from 'puppeteer'

const URL = 'http://localhost:3000/?session=2026-05-31-weingut-barbazza&tab=meta'
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1500, height: 1000 } })
const page = await browser.newPage()
const errs = []
page.on('pageerror', e => errs.push(String(e.message)))
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()) })

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 40000 }).catch(e => console.log('goto:', e.message))
await new Promise(r => setTimeout(r, 3000))

// Click the META toggle if it's present (in case the saved tab didn't stick).
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'META')
  if (b) { b.click(); return true }
  return false
})
await new Promise(r => setTimeout(r, 1800))

const body = await page.evaluate(() => document.body.innerText)
const has = (s) => body.includes(s)
console.log('  META button present/clicked :', clicked)
console.log('  panel shows "Search terms"  :', has('Search terms'))
console.log('  panel shows "Translations"  :', has('Translations'))
console.log('  panel shows "Search Console":', has('Search Console'))
console.log('  page errors                 :', errs.length ? errs.slice(0, 4) : 'none')
await page.screenshot({ path: '.claude/meta-tab.png' })
console.log('  screenshot -> .claude/meta-tab.png')
await browser.close()
