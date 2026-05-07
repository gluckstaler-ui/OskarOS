import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve('public/2026-01-27-31/vibe-20-pentagram.html');
const url = 'file://' + file;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

const errors = [];
const consoleMsgs = [];
page.on('console', m => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', r => errors.push(`requestfailed: ${r.url()} — ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle' });

// Verify CSS variables resolve
const vars = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return {
    ink: cs.getPropertyValue('--brand-ink').trim(),
    paper: cs.getPropertyValue('--brand-paper').trim(),
    accent: cs.getPropertyValue('--brand-accent').trim(),
    rule: cs.getPropertyValue('--brand-rule').trim(),
    mute: cs.getPropertyValue('--brand-mute').trim(),
  };
});

// Verify hero h1 exists and is large
const heroInfo = await page.evaluate(() => {
  const h1 = document.querySelector('.hero__title');
  if (!h1) return null;
  const s = getComputedStyle(h1);
  return {
    text: h1.textContent,
    fontSize: s.fontSize,
    fontFamily: s.fontFamily,
    fontWeight: s.fontWeight,
  };
});

// Verify all images loaded
const images = await page.evaluate(() => {
  return Array.from(document.images).map(img => ({
    src: img.getAttribute('src'),
    naturalW: img.naturalWidth,
    naturalH: img.naturalHeight,
    complete: img.complete,
  }));
});

// Section anchors
const sections = await page.evaluate(() => {
  const ids = ['top', 'argument', 'rule', 'residents', 'race', 'menu', 'location', 'booking'];
  return ids.map(id => ({ id, found: !!document.getElementById(id) }));
});

await page.screenshot({ path: 'public/2026-01-27-31/vibe-20-hero.png', fullPage: false });

// Scroll to residents and screenshot
await page.evaluate(() => document.getElementById('residents').scrollIntoView({ behavior: 'instant', block: 'start' }));
await page.waitForTimeout(200);
await page.screenshot({ path: 'public/2026-01-27-31/vibe-20-residents.png', fullPage: false });

await browser.close();

console.log('=== CSS VARIABLES ===');
console.log(vars);
console.log('=== HERO ===');
console.log(heroInfo);
console.log('=== IMAGES ===');
images.forEach(i => console.log(`${i.complete && i.naturalW > 0 ? 'OK ' : 'FAIL '} ${i.src} (${i.naturalW}x${i.naturalH})`));
console.log('=== SECTIONS ===');
sections.forEach(s => console.log(`${s.found ? 'OK ' : 'MISSING '} #${s.id}`));
console.log('=== CONSOLE ===');
consoleMsgs.forEach(m => console.log(m));
console.log('=== ERRORS ===');
errors.forEach(e => console.log(e));
console.log(errors.length === 0 ? 'NO ERRORS' : `${errors.length} ERRORS`);
