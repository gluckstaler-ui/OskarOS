// ============================================================================
// scripts/director-harness.mjs — end-to-end test harness for Director Mode text
// edits. Loads the real page in a headless browser (so its OWN JS + i18n run,
// exactly like the studio canvas iframe), simulates a user text edit, computes
// the SAME payload the client sends (buildSelectorPath + cleaned innerHTML),
// POSTs to the live /api/director/text-edit, then asserts:
//
//   • SURGICAL  — every byte outside the edited element's inner span is identical.
//   • APPLIED   — the edited element's inner became the new value.
//   • MARKUP    — inline tags (<em>/<br>) survive a rich edit (no flattening).
//   • I18N OK   — the inline I18N object still parses after the write
//                 (an unescaped apostrophe would silently kill the whole switcher).
//   • LANGUAGE  — editing while the page renders a NON-source language must NOT
//                 overwrite the English source baseline with the foreign text.
//
// Usage:  node scripts/director-harness.mjs       (dev server must be on :3000)
// Exit 0 = all green, 1 = a failure.
// ============================================================================
import puppeteer from 'puppeteer'
import fs from 'fs'
import { parse } from 'parse5'

const SESSION = '2026-05-31-weingut-barbazza'
const FILE = 'index.html'
const F = `public/${SESSION}/${FILE}`
const URL = `http://localhost:3000/${SESSION}/${FILE}`
const API = 'http://localhost:3000/api/director/text-edit'

// real client helpers, injected into the page verbatim
const HELPERS = `
function buildSelectorPath(el){const parts=[];let node=el;const body=el.ownerDocument.body;while(node&&node!==body){const tag=node.tagName.toLowerCase();const parent=node.parentElement;if(!parent)break;const sibs=Array.from(parent.children).filter(c=>c.tagName===node.tagName);parts.unshift(tag+':nth-of-type('+(sibs.indexOf(node)+1)+')');node=parent}return 'auto-body > '+parts.join(' > ')}
function cleanInner(el){const clone=el.cloneNode(true);clone.querySelectorAll('*').forEach(n=>{n.removeAttribute('style');n.removeAttribute('data-oskar-id');n.removeAttribute('data-oskar-editable')});return clone.innerHTML.trim()}
`

function* walk(n) { if (n.childNodes) for (const c of n.childNodes) { yield c; yield* walk(c) } }
function nodeByKey(doc, key) { for (const n of walk(doc)) if (n.attrs?.some(a => a.name === 'data-i18n' && a.value === key)) return n; return null }
function innerRange(html, key) {
  const doc = parse(html, { sourceCodeLocationInfo: true })
  const n = nodeByKey(doc, key); if (!n) return null
  const l = n.sourceCodeLocation
  return { start: l.startTag.endOffset, end: l.endTag.startOffset, inner: html.slice(l.startTag.endOffset, l.endTag.startOffset) }
}
function elementCount(html) { const doc = parse(html); let c = 0; for (const n of walk(doc)) if (n.tagName) c++; return c }
function parses(html) { try { parse(html); return true } catch { return false } }
// extract + eval the inline `var I18N = {…}` block — returns false if it throws
function i18nValid(html) {
  const m = html.match(/var\s+I18N\s*=\s*\{/); if (!m) return false
  let i = m.index + m[0].length - 1, depth = 0, inStr = false, q = ''
  for (; i < html.length; i++) { const c = html[i]
    if (inStr) { if (c === '\\') { i++; continue } if (c === q) inStr = false }
    else if (c === "'" || c === '"') { inStr = true; q = c }
    else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { i++; break } } }
  try { new Function('return (' + html.slice(m.index + m[0].length - 1, i) + ')')(); return true } catch { return false }
}

const pristine = fs.readFileSync(F, 'utf8')
const results = []
const log = (pass, name, detail) => { results.push({ pass, name }); console.log(`   ${pass ? '✔' : '✗ FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })

async function runCase({ title, key, switchTo, editJs, markup }) {
  console.log(`\n  ▸ ${title}`)
  fs.writeFileSync(F, pristine)
  const rng = innerRange(pristine, key)
  if (!rng) { log(false, `${title}: locate "${key}" in source`); return }
  const prefix = pristine.slice(0, rng.start), suffix = pristine.slice(rng.end)

  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => { try { localStorage.clear() } catch (e) {} })
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 40000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 1200))
  if (switchTo) { // click the real language button — render a non-source language
    await page.evaluate(l => document.querySelector('.langsw button[data-lang="' + l + '"]')?.click(), switchTo)
    await new Promise(r => setTimeout(r, 400))
  }

  const payload = await page.evaluate((HELPERS, key, editJs) => {
    eval(HELPERS)
    const el = document.querySelector('[data-i18n="' + key + '"]')
    if (!el) return { error: 'not in live DOM' }
    const base = cleanInner(el)                         // pre-edit snapshot (compare-and-swap key)
    const edit = new Function('el', editJs); edit(el)
    return { oskarId: buildSelectorPath(el), base, cur: cleanInner(el) }
  }, HELPERS, key, editJs).catch(e => ({ error: e.message }))
  await page.close()
  if (payload.error) { log(false, `${title}: simulate edit`, payload.error); return }

  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: SESSION, pageFilename: FILE, oskarId: payload.oskarId, newText: payload.cur, baseText: payload.base }) })
  const j = await res.json().catch(() => ({}))
  const after = fs.readFileSync(F, 'utf8')

  if (switchTo) {
    // Editing a TRANSLATED view must be refused (409) — never written to the
    // English source. Both the refusal AND byte-stability are the contract.
    log(res.status === 409 && j.reason === 'stale-or-transformed', `${title}: edit correctly REFUSED (409, no clobber)`, `got ${res.status} ${j.reason || ''}`)
    log(after === pristine, `${title}: source byte-UNCHANGED`,
      after === pristine ? '' : `English "${pristine.slice(rng.start, rng.end).slice(0,24)}" → "${(innerRange(after, key)?.inner||'').slice(0,24)}"`)
    fs.writeFileSync(F, pristine); return
  }

  log(res.ok, `${title}: POST accepted`, res.ok ? '' : (j.error || res.status))
  if (!res.ok) { fs.writeFileSync(F, pristine); return }
  log(after.startsWith(prefix) && after.endsWith(suffix), `${title}: SURGICAL (nothing outside the element changed)`,
    after.startsWith(prefix) ? (after.endsWith(suffix) ? '' : 'suffix changed') : 'prefix changed')
  log(parses(after) && elementCount(after) === elementCount(pristine), `${title}: page integrity`, `${elementCount(after)} vs ${elementCount(pristine)} els`)
  log(i18nValid(after), `${title}: I18N object still parses`)
  const newInner = innerRange(after, key)?.inner
  log(newInner === payload.cur, `${title}: edit applied`, `"${(newInner||'').slice(0,40)}"`)
  if (markup) log(markup.every(t => (newInner||'').includes(t)), `${title}: markup ${markup.join('/')} preserved`, newInner)
  fs.writeFileSync(F, pristine)
}

console.log('\n══ DIRECTOR MODE HARNESS ══')
await runCase({ title: 'EN · simple text (nav.cellar)', key: 'nav.cellar', editJs: `el.textContent='The Wine Cellar'` })
await runCase({ title: 'EN · rich markup (hero.h1b)', key: 'hero.h1b', editJs: `el.childNodes[0].textContent='established '`, markup: ['<em>', '1530'] })
await runCase({ title: 'DE · render German, then edit (i18n butcher probe)', key: 'nav.cellar', switchTo: 'de', editJs: `el.textContent='Weinkeller'` })

// Sequential: the SAME element edited twice must keep working — the 2nd edit's
// compare-and-swap base is the 1st edit's value, not the stale original. And a
// genuinely stale base must STILL be refused (proves the guard isn't a no-op).
async function runSequential() {
  console.log('\n  ▸ EN · same element edited TWICE + stale-base control')
  fs.writeFileSync(F, pristine)
  const key = 'nav.cellar'
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(() => { try { localStorage.clear() } catch (e) {} })
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 40000 }).catch(() => {})
  await new Promise(r => setTimeout(r, 1000))
  const sel = await page.evaluate((HELPERS, key) => { eval(HELPERS); const el = document.querySelector('[data-i18n="' + key + '"]'); return { oskarId: buildSelectorPath(el), base: cleanInner(el) } }, HELPERS, key)
  await page.close()
  const post = (newText, baseText) => fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: SESSION, pageFilename: FILE, oskarId: sel.oskarId, newText, baseText }) })
  const r1 = await post('Cellar A', sel.base)              // base = original
  const r2 = await post('Cellar B', 'Cellar A')            // base = 1st edit's value
  const after = fs.readFileSync(F, 'utf8')
  log(r1.ok, `twice: 1st edit applied`, r1.ok ? '' : String(r1.status))
  log(r2.ok, `twice: 2nd edit applied (NOT falsely refused)`, r2.ok ? '' : String(r2.status))
  log(innerRange(after, key)?.inner === 'Cellar B', `twice: source = "Cellar B"`, innerRange(after, key)?.inner)
  const r3 = await post('Cellar C', sel.base)              // stale original base → must refuse
  log(r3.status === 409, `twice: stale-base edit REFUSED (409)`, String(r3.status))
  fs.writeFileSync(F, pristine)
}
await runSequential()

fs.writeFileSync(F, pristine)
await browser.close()
const failed = results.filter(r => !r.pass)
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) { console.log('  ✗ FAILURES:\n   - ' + failed.map(r => r.name).join('\n   - ')); process.exit(1) }
console.log('  ALL GREEN ✔')
