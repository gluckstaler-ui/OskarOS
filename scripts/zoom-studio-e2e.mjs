/**
 * Real STUDIO drive: load the app (fresh bundle from the dev server), open a
 * vibe in Director Mode, click an image's gear, drag the Zoom slider, and
 * measure the image element's on-screen box inside the iframe. Proves whether
 * the LIVE component zooms in place (box fixed) or grows the box.
 */
import { chromium } from 'playwright'
const BASE = process.argv[2] || 'http://localhost:3000'
const SESSION = '2026-04-25-silke-lengler'
const shot = (p, name) => p.screenshot({ path: `public/${SESSION}/screenshots/studio-e2e-${name}.png` }).catch(()=>{})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } })
page.on('console', m => { if (m.type() === 'error') console.log('  [browser-err]', m.text().slice(0,120)) })

try {
  // Seed session + gallery layout, then load the app fresh.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate((s) => {
    localStorage.setItem('oskar-session-id', s)
    localStorage.setItem('oskar-layout-mode', 'gallery')
  }, SESSION)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await shot(page, '1-loaded')

  // Click a vibe card (text "RÄUME"/"Räume" or first card).
  const card = page.getByText(/r[äa]ume/i).first()
  if (await card.count()) { await card.click().catch(()=>{}); }
  else { await page.locator('[class*="vibe"],[class*="card"]').first().click().catch(()=>{}) }
  await page.waitForTimeout(1500)
  await shot(page, '2-card')

  // Enable Director Mode (built-in toggle OR studio toggle).
  const dirBtn = page.locator('button[aria-label*="Edit HTML"], button[title="Director Mode"]').first()
  console.log('director buttons found:', await page.locator('button[aria-label*="Edit HTML"], button[title="Director Mode"]').count())
  await dirBtn.click({ timeout: 5000 }).catch((e)=>console.log('  dir click:', e.message.slice(0,80)))
  await page.waitForTimeout(1500)
  await shot(page, '3-director')

  // The vibe iframe.
  const frame = page.frameLocator('iframe').first()
  const imgInFrame = frame.locator('.hero-img, [data-oskar-bgimg], img').first()
  const box0 = await imgInFrame.boundingBox().catch(()=>null)
  console.log('target image box BEFORE:', box0 && `${Math.round(box0.width)}x${Math.round(box0.height)}`)

  // Hover to summon the gear, then click it.
  if (box0) await page.mouse.move(box0.x + box0.width/2, box0.y + box0.height/2)
  await page.waitForTimeout(600)
  const gear = page.locator('button[aria-label="Open image styling options"]').first()
  console.log('gear present:', await gear.count())
  await gear.click({ timeout: 4000 }).catch((e)=>console.log('  gear click:', e.message.slice(0,80)))
  await page.waitForTimeout(800)
  await shot(page, '4-popover')

  // Find the Zoom slider in the popover and crank it.
  // Sliders render as: <div>...label "Zoom"...<input type=range></div>
  const zoom = page.locator('input[type="range"]').filter({ has: page.locator('xpath=.') })
  // Identify the Zoom input by walking labels.
  const set = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('*')].filter(e => e.childElementCount === 0 && /^Zoom$/i.test(e.textContent.trim()))
    for (const lab of labels) {
      const container = lab.closest('div')?.parentElement || lab.parentElement
      const input = container?.querySelector('input[type=range]') || lab.parentElement?.querySelector('input[type=range]')
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, '1.6')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }
    }
    return false
  })
  console.log('zoom slider set:', set)
  await page.waitForTimeout(900)
  await shot(page, '5-zoomed')

  const box1 = await imgInFrame.boundingBox().catch(()=>null)
  console.log('target image box AFTER :', box1 && `${Math.round(box1.width)}x${Math.round(box1.height)}`)
  if (box0 && box1) {
    const grew = box1.width > box0.width + 4 || box1.height > box0.height + 4
    console.log(grew ? '\n>>> BUG REPRODUCED: box GREW on zoom' : '\n>>> OK: box stayed fixed (zoom-in-place)')
  } else {
    console.log('\n>>> inconclusive — could not measure (see screenshots)')
  }
} catch (e) {
  console.log('ERROR:', e.message)
} finally {
  await browser.close()
}
