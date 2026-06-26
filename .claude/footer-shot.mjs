// Throwaway: screenshot the barbazza footer (map + social + rating), EN and DE.
import puppeteer from 'puppeteer'

const URL = 'http://localhost:3000/2026-05-31-weingut-barbazza/index.html'
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1300, height: 900 } })
const page = await browser.newPage()
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 }).catch(e => console.log('goto:', e.message))
await new Promise(r => setTimeout(r, 2500))
await page.evaluate(() => document.querySelector('footer.site')?.scrollIntoView({ block: 'start' }))
await new Promise(r => setTimeout(r, 2500)) // let the map iframe load

const info = await page.evaluate(() => ({
  hasMap: !!document.querySelector('footer.site .fmap'),
  social: [...document.querySelectorAll('footer.site .fsocial a')].map(a => a.getAttribute('href')),
  rating: document.querySelector('footer.site .frating')?.innerText.replace(/\s+/g, ' ').trim(),
}))
console.log('  footer:', JSON.stringify(info))
await page.screenshot({ path: '.claude/footer.png' })

// Switch to German to confirm the rating line localizes.
await page.evaluate(() => { const b = [...document.querySelectorAll('.langsw button[data-lang]')].find(x => x.getAttribute('data-lang') === 'de'); b && b.click() })
await new Promise(r => setTimeout(r, 600))
await page.evaluate(() => document.querySelector('footer.site')?.scrollIntoView({ block: 'start' }))
await new Promise(r => setTimeout(r, 400))
const ratingDe = await page.evaluate(() => document.querySelector('footer.site .frating')?.innerText.replace(/\s+/g, ' ').trim())
console.log('  rating DE:', ratingDe)
await page.screenshot({ path: '.claude/footer-de.png' })
await browser.close()
