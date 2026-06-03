import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('http://localhost:3000/crm.html', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const info = await page.evaluate(() => {
  const g = document.getElementById('order66-gauge')
  if (!g) return { exists: false }
  const r = g.getBoundingClientRect()
  const cs = getComputedStyle(g)
  const inner = g.querySelector('.pill-btn')
  const innerCS = inner ? getComputedStyle(inner) : null
  return {
    exists: true,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    visible: r.width > 0 && r.height > 0,
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
    bg: cs.backgroundColor, color: cs.color,
    innerBg: innerCS?.backgroundColor, innerColor: innerCS?.color,
    innerDisplay: innerCS?.display,
    text: g.textContent.trim(),
  }
})
console.log(JSON.stringify(info, null, 2))
await page.screenshot({ path: '/tmp/gauge-shot.png', clip: { x: 0, y: 0, width: 1440, height: 80 } })
await browser.close()
