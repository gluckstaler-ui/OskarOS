// Throwaway: proves the client-language auto-detect in barbazza/index.html.
// Loads the page under different browser-language settings (fresh context =
// no saved choice) and reports the resulting <html lang> + a sample string.
import puppeteer from 'puppeteer'

const URL = 'http://localhost:3000/2026-05-31-weingut-barbazza/index.html'
const CASES = [
  { langs: ['de-DE', 'de', 'en'], expect: 'de' },
  { langs: ['hr-HR', 'hr'],       expect: 'hr' },
  { langs: ['it-IT', 'it'],       expect: 'it' },
  { langs: ['en-US', 'en'],       expect: 'en' },
  { langs: ['fr-FR', 'fr'],       expect: 'en' }, // unsupported -> English flavoring base
]

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
let allPass = true
for (const c of CASES) {
  const ctx = await browser.createBrowserContext()           // fresh localStorage
  const page = await ctx.newPage()
  await page.evaluateOnNewDocument((langs) => {
    Object.defineProperty(navigator, 'languages', { get: () => langs })
    Object.defineProperty(navigator, 'language',  { get: () => langs[0] })
  }, c.langs)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await new Promise(r => setTimeout(r, 350))
  const lang = await page.evaluate(() => document.documentElement.lang)
  const sample = await page.evaluate(() => {
    const el = document.querySelector('[data-i18n="nav.cellar"]')
    return el ? el.textContent.trim() : '(missing)'
  })
  const ok = lang === c.expect
  if (!ok) allPass = false
  console.log(`  browser=${JSON.stringify(c.langs).padEnd(22)} -> html.lang=${lang}  (want ${c.expect})  ${ok ? '✔' : '✗'}   nav.cellar="${sample}"`)
  await ctx.close()
}
await browser.close()
console.log(allPass ? '\n  ALL PASS ✔' : '\n  FAILURES ✗')
process.exit(allPass ? 0 : 1)
