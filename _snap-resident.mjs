import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8766/vibe-24-locomotive.html', { waitUntil: 'networkidle' });
await page.locator('[data-shot="resident-sultan"]').scrollIntoViewIfNeeded();
// wait for all images to decode
await page.waitForLoadState('networkidle');
await page.waitForFunction(() => Array.from(document.images).every(i => i.complete && i.naturalWidth > 0));
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/vibe24-shots/04-residents.png' });
console.log('done');
await browser.close();
