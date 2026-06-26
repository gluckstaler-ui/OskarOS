/**
 * E2E Director-Mode harness — drives the LIVE running server over HTTP.
 *
 * For every root vibe: copy it into a throwaway session, then exercise the
 * REAL routes the browser calls (/api/director/text-edit, /api/director/save-edits)
 * with payloads built by the REAL client selector logic (buildSelectorPath over
 * a jsdom DOM). After each edit, read the file back and assert it is NOT
 * destroyed and the edit landed. Also fires the body-nuke attack and asserts
 * the live server refuses it.
 *
 * Run: node scripts/e2e-director-harness.mjs [baseURL]
 */
import { JSDOM } from 'jsdom'
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'fs'
import path from 'path'

const BASE = process.argv[2] || 'http://localhost:3000'
const SRC = path.join(process.cwd(), 'public', '2026-04-25-silke-lengler')
const SESSION = '__e2e-director-harness__'
const DIR = path.join(process.cwd(), 'public', SESSION)

// ── client selector logic, verbatim from lib/director-css.ts ───────────────
function buildSelectorPath(el) {
  const parts = []
  let node = el
  const body = el.ownerDocument?.body
  while (node && node !== body) {
    const tag = node.tagName.toLowerCase()
    const parent = node.parentElement
    if (!parent) break
    const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName)
    const idx = siblings.indexOf(node)
    parts.unshift(`${tag}:nth-of-type(${idx + 1})`)
    node = parent
  }
  return 'body > ' + parts.join(' > ')
}

let pass = 0, fail = 0
const failures = []
function check(cond, msg) { if (cond) pass++; else { fail++; failures.push(msg) } }

function skeletonIntact(before, after) {
  const c = (s, re) => (s.match(re) || []).length
  for (const re of [/<html/i, /<\/html>/i, /<body/i, /<\/body>/i]) if (!re.test(after)) return false
  for (const re of [/<section\b/gi, /<script\b/gi, /<\/script>/gi]) if (c(after, re) !== c(before, re)) return false
  // scripts byte-identical
  const sc = (s) => Array.from(s.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)).map((m) => m[1]).join('||')
  if (sc(after) !== sc(before)) return false
  // no escaped-arrow leakage
  if (/=&gt;/.test(after) && !/=&gt;/.test(before)) return false
  return true
}

async function post(route, body) {
  const res = await fetch(`${BASE}/api/director/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  let json = null; try { json = await res.json() } catch {}
  return { status: res.status, json }
}

async function run() {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })

  const vibes = readdirSync(SRC).filter((f) => /^vibe-.*\.html$/.test(f))
  console.log(`Harness: ${vibes.length} root vibes against ${BASE}\n`)

  for (const name of vibes) {
    const original = readFileSync(path.join(SRC, name), 'utf-8')
    const filePath = path.join(DIR, name)
    const reset = () => writeFileSync(filePath, original, 'utf-8')
    const dom = new JSDOM(original)
    const doc = dom.window.document

    // ── STYLE edits across element types ──
    const styleEls = [...doc.querySelectorAll('h1,h2,h3,p,section,div[class],a,li,img,dt,dd')].slice(0, 30)
    let styleTested = 0
    for (const el of styleEls) {
      const sel = buildSelectorPath(el)
      if (doc.querySelector(sel) !== el) continue
      reset()
      const { json } = await post('save-edits', { sessionId: SESSION, pageFilename: name, edits: [{ selector: sel, style: 'outline: 3px solid magenta' }] })
      const after = readFileSync(filePath, 'utf-8')
      check(json?.applied === 1, `${name} STYLE ${sel}: not applied`)
      check(skeletonIntact(original, after), `${name} STYLE ${sel}: SKELETON DESTROYED`)
      check(after.includes('outline: 3px solid magenta'), `${name} STYLE ${sel}: edit missing`)
      styleTested++
    }
    check(styleTested > 0, `${name}: no style elements round-tripped`)

    // ── TEXT edits on leaves ──
    const leaves = [...doc.querySelectorAll('h1,h2,h3,p,a,dt,dd,span,.label')].filter((el) => el.children.length === 0 && (el.textContent || '').trim()).slice(0, 20)
    let textTested = 0
    for (const el of leaves) {
      const sel = buildSelectorPath(el)
      if (doc.querySelector(sel) !== el) continue
      reset()
      const { json } = await post('text-edit', { sessionId: SESSION, pageFilename: name, oskarId: 'auto-' + sel, newText: 'E2E-EDIT-OK' })
      const after = readFileSync(filePath, 'utf-8')
      check(json?.success === true, `${name} TEXT ${sel}: not saved`)
      check(skeletonIntact(original, after), `${name} TEXT ${sel}: SKELETON DESTROYED`)
      check(after.includes('E2E-EDIT-OK'), `${name} TEXT ${sel}: text missing`)
      textTested++
    }
    check(textTested > 0, `${name}: no text leaves round-tripped`)

    // ── IMAGE src swap (if any <img>) ──
    const img = doc.querySelector('img')
    if (img) {
      const sel = buildSelectorPath(img)
      if (doc.querySelector(sel) === img) {
        reset()
        await post('save-edits', { sessionId: SESSION, pageFilename: name, edits: [{ selector: sel, src: 'e2e-swapped.jpg' }] })
        const after = readFileSync(filePath, 'utf-8')
        check(skeletonIntact(original, after), `${name} IMG ${sel}: SKELETON DESTROYED`)
        check(after.includes('e2e-swapped.jpg'), `${name} IMG ${sel}: src not swapped`)
      }
    }

    // ── MULTI-edit save batch ──
    const batchEls = [...doc.querySelectorAll('h1,h2,p,section,div[class]')].slice(0, 8)
    const edits = []
    for (const el of batchEls) { const sel = buildSelectorPath(el); if (doc.querySelector(sel) === el) edits.push({ selector: sel, style: 'opacity: 0.9' }) }
    if (edits.length >= 2) {
      reset()
      const { json } = await post('save-edits', { sessionId: SESSION, pageFilename: name, edits })
      const after = readFileSync(filePath, 'utf-8')
      check(json?.applied === edits.length, `${name} MULTI: applied ${json?.applied}/${edits.length}`)
      check(skeletonIntact(original, after), `${name} MULTI: SKELETON DESTROYED`)
    }

    // ── THE ATTACK: body-level text edit must be REFUSED by the live server ──
    reset()
    const nuke = await post('text-edit', { sessionId: SESSION, pageFilename: name, oskarId: 'auto-body', newText: 'flatten everything' })
    const afterNuke = readFileSync(filePath, 'utf-8')
    check(nuke.status === 404, `${name} BODY-NUKE: server did NOT refuse (status ${nuke.status}) — STALE SERVER?`)
    check(afterNuke === original, `${name} BODY-NUKE: FILE WAS DESTROYED by live server`)
  }

  rmSync(DIR, { recursive: true, force: true })
  console.log(`\n${'='.repeat(50)}`)
  console.log(`PASS: ${pass}   FAIL: ${fail}`)
  if (fail) { console.log('\nFAILURES:'); failures.slice(0, 40).forEach((f) => console.log('  ✗ ' + f)) }
  else console.log('ALL GREEN — director save/edit/text/img/multi + body-nuke-refusal verified against the live server.')
  process.exit(fail ? 1 : 0)
}
run().catch((e) => { console.error(e); rmSync(DIR, { recursive: true, force: true }); process.exit(2) })
