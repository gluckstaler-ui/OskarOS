import { chromium } from 'playwright';
import fs from 'fs';

const OUT = '/tmp/feyer-shots';
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ['01', '01 - La Stanza.dc.html'],
  ['02', '02 - Brockmann x Linear.dc.html'],
  ['03', '03 - Kenya Hara.dc.html'],
  ['04', '04 - Studio Dumbar.dc.html'],
  ['05', '05 - Active Theory.dc.html'],
  ['07', '07 - La Prova.dc.html'],
];

const base = 'https://paradiso.dev/FEYER/';

const browser = await chromium.launch();

for (const [id, file] of PAGES) {
  const url = base + encodeURIComponent(file);
  // desktop
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) { errs.push('goto: ' + e.message); }
  await page.waitForTimeout(6000);
  await page.mouse.move(720, 450);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${id}-hero.png` });

  // scroll through, capture viewport slices
  const h = await page.evaluate(() => document.body.scrollHeight);
  const steps = Math.min(5, Math.max(1, Math.round(h / 900) - 1));
  for (let i = 1; i <= steps; i++) {
    await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), i * 900);
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${OUT}/${id}-s${i}.png` });
  }
  // bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${id}-bottom.png` });

  console.log(id, 'height=', h, 'errs=', JSON.stringify(errs.slice(0, 5)));
  await ctx.close();

  // mobile
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  try { await mp.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); } catch {}
  await mp.waitForTimeout(5000);
  await mp.screenshot({ path: `${OUT}/${id}-m.png` });
  await mctx.close();
}

await browser.close();
console.log('done');
