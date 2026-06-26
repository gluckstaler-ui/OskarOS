// Throwaway: open the META tab, expand a translation row, screenshot the
// per-language fields (EN read-only + DE/HR/IT editable).
import puppeteer from 'puppeteer'

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], defaultViewport: { width: 780, height: 1150 } })
const page = await browser.newPage()
await page.goto('http://localhost:3000/?session=2026-05-31-weingut-barbazza&tab=meta', { waitUntil: 'networkidle2', timeout: 40000 }).catch(() => {})
await new Promise(r => setTimeout(r, 3000))
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'META'); b && b.click() })
await new Promise(r => setTimeout(r, 1500))
// Expand the "The Cellar" row (nav.cellar) — a short, recognisable one.
const ok = await page.evaluate(() => {
  const r = [...document.querySelectorAll('button')].find(x => x.textContent.includes('The Cellar') && x.textContent.includes('nav.cellar'))
  if (!r) return false
  r.scrollIntoView({ block: 'start' }); r.click(); return true
})
await new Promise(r => setTimeout(r, 700))
await page.evaluate(() => { const r = [...document.querySelectorAll('button')].find(x => x.textContent.includes('The Cellar')); r && r.scrollIntoView({ block: 'center' }) })
await new Promise(r => setTimeout(r, 400))
console.log('  expanded a row:', ok)
const langs = await page.evaluate(() => [...document.querySelectorAll('textarea')].map(t => t.value).filter(v => /Keller|Podrum|Cantina|Cellar/.test(v)))
console.log('  language values visible:', JSON.stringify(langs))
await page.screenshot({ path: '.claude/meta-expanded.png' })
console.log('  screenshot -> .claude/meta-expanded.png')
await browser.close()
