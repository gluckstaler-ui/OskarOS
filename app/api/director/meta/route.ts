import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, readdir } from 'fs/promises'
import { join, normalize } from 'path'
import { JSDOM } from 'jsdom'

/*
 * GET  /api/director/meta?path=/<session>/index.html
 *   → { seo:{title,description,keywords}, languages:[…], rows:[{key,en,<lang>…}] }
 *     where <lang> = every translation language the page DECLARES (de/hr/it/cs/…),
 *     derived from its inline I18N object — never a fixed list.
 *
 * PATCH /api/director/meta
 *   { path, op:'seo', field:'title'|'description'|'keywords', value }
 *   { path, op:'cell'|'translation', key, lang, value }   // lang ∈ the page's declared langs
 *
 * Powers the Studio's META tab. English is the DOM baseline; the other languages
 * live in the inline `var I18N = {…}` object. Reads via JSDOM; writes are SURGICAL
 * string edits so the hand-formatted source file stays byte-identical except
 * for the one value changed (per Ralph's "edit the inline I18N block in place").
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The translation (non-English) languages a page actually declares — the
 *  object-valued top-level keys of its nested I18N block, in file order. DERIVED,
 *  never hardcoded: drop a `cs:{…}` block into the page and it becomes a column
 *  automatically. Replaces a frozen ['de','hr','it'] constant that ignored the
 *  file and silently hid any other language the page had — e.g. Czech. */
function flavorLangsOf(i18n: Record<string, unknown>): string[] {
  return Object.keys(i18n).filter((k) => i18n[k] !== null && typeof i18n[k] === 'object')
}

function resolve(path: string): string | null {
  // Confine to public/ — reject traversal.
  const publicDir = join(process.cwd(), 'public')
  const abs = normalize(join(publicDir, path))
  if (!abs.startsWith(publicDir)) return null
  return abs
}

/** List a session's editable .html pages (top-level + one level deep, skipping asset dirs). */
async function listHtmlPages(sessionDir: string): Promise<string[]> {
  const out: string[] = []
  const scan = async (dir: string, prefix: string, depth: number) => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      if (e.isDirectory()) {
        if (depth > 0 && !/^(assets|thumbnails|node_modules|font|fonts|video|img|images|css|js)$/i.test(e.name)) {
          await scan(join(dir, e.name), prefix + e.name + '/', depth - 1)
        }
      } else if (/\.html?$/i.test(e.name)) {
        out.push(prefix + e.name)
      }
    }
  }
  await scan(sessionDir, '', 1)
  // Top-level pages first, then deeper; index.html floats to the top of its level.
  return out.sort((a, b) =>
    (a.includes('/') ? 1 : 0) - (b.includes('/') ? 1 : 0) ||
    (/index\.html?$/i.test(b) ? 1 : 0) - (/index\.html?$/i.test(a) ? 1 : 0) ||
    a.localeCompare(b))
}

/** Find the `var|const|let I18N = { … }` object by brace-matching (string-aware). */
function findI18N(html: string): { start: number; end: number } | null {
  const m = html.match(/(?:var|const|let)\s+I18N\s*=\s*\{/)
  if (!m || m.index === undefined) return null
  const braceStart = m.index + m[0].length - 1
  return matchBraces(html, braceStart)
}

/** Classify the I18N shape.
 *  'flat'   = .dc cluster: { "Deutscher Quelltext": "English flavor", … } — German is the
 *             DOM-baked SOURCE, English is the editable flavor. data-i18n els key into '@<id>'.
 *  'nested' = legacy: { de:{key:val}, hr:{…}, it:{…} } — English is the DOM source.
 *  'none'   = no I18N object (rows, if any, come from data-i18n innerHTML alone). */
function schemaOf(i18n: Record<string, unknown>): 'flat' | 'nested' | 'none' {
  const keys = Object.keys(i18n)
  if (!keys.length) return 'none'
  if (keys.every((k) => typeof i18n[k] === 'string')) return 'flat'
  if (keys.some((k) => i18n[k] && typeof i18n[k] === 'object')) return 'nested'
  return 'none'
}

/** Given the index of a `{`, return [that index, index just past its match]. */
function matchBraces(html: string, braceStart: number): { start: number; end: number } | null {
  let depth = 0, inStr = false, q = ''
  for (let i = braceStart; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (c === '\\') { i++; continue }
      if (c === q) inStr = false
    } else if (c === "'" || c === '"') { inStr = true; q = c }
    else if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return { start: braceStart, end: i + 1 } }
  }
  return null
}

/** Parse the I18N object from our own controlled file. Shape is schema-dependent:
 *  flat → Record<string,string>; nested → Record<string,Record<string,string>>. */
function readI18N(html: string): Record<string, string | Record<string, string>> {
  const span = findI18N(html)
  if (!span) return {}
  try { return new Function('return (' + html.slice(span.start, span.end) + ')')() || {} }
  catch { return {} }
}

/** Locate a language sub-object `<lang>: { … }` within the I18N block. */
function findLangSpan(html: string, lang: string): { start: number; end: number } | null {
  const i18n = findI18N(html)
  if (!i18n) return null
  const region = html.slice(i18n.start, i18n.end)
  const m = region.match(new RegExp('[\'"]?' + lang + '[\'"]?\\s*:\\s*\\{'))
  if (!m || m.index === undefined) return null
  return matchBraces(html, i18n.start + m.index + m[0].length - 1)
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const escForQuote = (s: string, q: string) =>
  s.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q).replace(/\r?\n/g, '\\n')

/** Surgically set I18N[lang][key]; inserts the key if it doesn't exist yet. */
function setTranslation(html: string, lang: string, key: string, value: string): string | null {
  const span = findLangSpan(html, lang)
  if (!span) return null
  const langText = html.slice(span.start, span.end)
  const valRe = new RegExp('([\'"]' + reEsc(key) + '[\'"]\\s*:\\s*)([\'"])((?:\\\\.|(?!\\2)[^\\\\])*)(\\2)')
  let nextLangText: string
  if (valRe.test(langText)) {
    nextLangText = langText.replace(valRe, (_m, pre, oq, _v, cq) => pre + oq + escForQuote(value, oq) + cq)
  } else {
    // Insert right after the opening brace, matching the file's quote style.
    nextLangText = '{\n      \'' + key + '\':\'' + escForQuote(value, "'") + '\',' + langText.slice(1)
  }
  return html.slice(0, span.start) + nextLangText + html.slice(span.end)
}

/** Surgically set a TOP-LEVEL key in the flat I18N map (the .dc EN-flavor value).
 *  Inserts the key right after the opening brace if it doesn't exist yet. */
function setFlat(html: string, key: string, value: string): string | null {
  const span = findI18N(html)
  if (!span) return null
  const objText = html.slice(span.start, span.end)
  const valRe = new RegExp('([\'"]' + reEsc(key) + '[\'"]\\s*:\\s*)([\'"])((?:\\\\.|(?!\\2)[^\\\\])*)(\\2)')
  let next: string
  if (valRe.test(objText)) {
    next = objText.replace(valRe, (_m, pre, oq, _v, cq) => pre + oq + escForQuote(value, oq) + cq)
  } else {
    next = '{\n  "' + key.replace(/"/g, '\\"') + '": "' + escForQuote(value, '"') + '",' + objText.slice(1)
  }
  return html.slice(0, span.start) + next + html.slice(span.end)
}

/** Surgically remove a key's whole `'key':'value',` entry from a language sub-object. */
function deleteTranslation(html: string, lang: string, key: string): string {
  const span = findLangSpan(html, lang)
  if (!span) return html
  const langText = html.slice(span.start, span.end)
  // Entry + its leading whitespace/newline + optional trailing comma.
  const entryRe = new RegExp('\\s*[\'"]' + reEsc(key) + '[\'"]\\s*:\\s*([\'"])(?:\\\\.|(?!\\1)[^\\\\])*\\1\\s*,?')
  if (!entryRe.test(langText)) return html
  return html.slice(0, span.start) + langText.replace(entryRe, '') + html.slice(span.end)
}

/** Surgically rewrite (or CREATE) a <head> SEO field. Inserts before </head>
 *  when the tag doesn't exist yet, so a page with a bare <head> can be filled. */
function setSeo(html: string, field: string, value: string): string | null {
  if (field === 'title') {
    const v = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    if (/<title>[\s\S]*?<\/title>/.test(html)) {
      return html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + v + '</title>')
    }
    if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, '  <title>' + v + '</title>\n</head>')
    return null
  }
  const name = field === 'description' ? 'description' : field === 'keywords' ? 'keywords' : null
  if (!name) return null
  const v = value.replace(/"/g, '&quot;')
  const metaRe = new RegExp('(<meta\\s+name="' + name + '"\\s+content=")[^"]*(")', 'i')
  if (metaRe.test(html)) return html.replace(metaRe, '$1' + v + '$2')
  const tag = '<meta name="' + name + '" content="' + v + '">'
  if (/<\/title>/i.test(html)) return html.replace(/(<\/title>)/i, '$1\n' + tag)
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, '  ' + tag + '\n</head>')
  return null
}

/** Edit the GERMAN SOURCE of a flat-schema (.dc) row.
 *  - '@id' rows  → the source is the data-i18n element's innerHTML (key stays '@id').
 *  - text rows   → German is BOTH the I18N map key AND the DOM leaf text. Rename the
 *                  key (scoped to the I18N span) and update every `>German<` leaf in
 *                  the body. Both are identical source literals, so they stay in sync. */
function setGermanSource(html: string, key: string, value: string): string | null {
  if (key.startsWith('@')) return setEnglish(html, key.slice(1), value)
  const span = findI18N(html)
  if (!span) return null
  const obj = html.slice(span.start, span.end)
  const keyRe = new RegExp('([\'"])' + reEsc(key) + '\\1(\\s*:)')
  if (!keyRe.test(obj)) return null
  const obj2 = obj.replace(keyRe, (_m, q, colon) => q + escForQuote(value, q) + q + colon)
  let out = html.slice(0, span.start) + obj2 + html.slice(span.end)
  out = out.split('>' + key + '<').join('>' + value + '<')
  return out
}

/** Replace the inner HTML of the element carrying data-i18n="key" — i.e. the English source.
 *  Depth-matches the closing tag so nested same-tag content (e.g. the topline's inner spans) is handled. */
function setEnglish(html: string, key: string, value: string): string | null {
  const openRe = new RegExp('<([a-zA-Z][\\w-]*)\\b[^>]*\\bdata-i18n="' + reEsc(key) + '"[^>]*>')
  const m = openRe.exec(html)
  if (!m) return null
  const tag = m[1]
  const innerStart = m.index + m[0].length
  const tokenRe = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'gi')
  tokenRe.lastIndex = innerStart
  let depth = 1, t: RegExpExecArray | null, closeStart = -1
  while ((t = tokenRe.exec(html))) {
    if (t[1] === '/') { if (--depth === 0) { closeStart = t.index; break } }
    else depth++
  }
  if (closeStart === -1) return null
  return html.slice(0, innerStart) + value + html.slice(closeStart)
}

export async function GET(req: NextRequest) {
  // List mode: ?session=<id> returns the session's editable .html pages.
  const session = req.nextUrl.searchParams.get('session')
  if (session) {
    const dir = resolve('/' + session)
    if (!dir) return NextResponse.json({ error: 'Bad session' }, { status: 400 })
    return NextResponse.json({ files: await listHtmlPages(dir) })
  }
  const path = req.nextUrl.searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  const abs = resolve(path)
  if (!abs) return NextResponse.json({ error: 'Bad path' }, { status: 400 })

  let html: string
  try { html = await readFile(abs, 'utf-8') }
  catch { return NextResponse.json({ error: 'File not found' }, { status: 404 }) }

  const doc = new JSDOM(html).window.document
  const seo = {
    title: doc.querySelector('title')?.textContent ?? '',
    description: doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    keywords: doc.querySelector('meta[name="keywords"]')?.getAttribute('content') ?? '',
    canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
  }

  const i18n = readI18N(html)
  const schema = schemaOf(i18n)
  const rows: Array<Record<string, string | null>> = []

  if (schema === 'flat') {
    // .dc cluster: flat German→English map. German is the DOM-baked SOURCE,
    // English is the editable flavor. data-i18n elements key into '@<id>';
    // every other map entry is keyed by the German source text itself.
    const flat = i18n as Record<string, string>
    doc.querySelectorAll('[data-i18n]').forEach((el) => {
      const dk = el.getAttribute('data-i18n'); if (!dk) return
      const mk = '@' + dk
      rows.push({ key: mk, de: el.innerHTML.trim(), en: flat[mk] ?? null, hr: null, it: null })
    })
    Object.keys(flat).forEach((k) => {
      if (k.startsWith('@')) return
      rows.push({ key: k, de: k, en: flat[k] ?? null, hr: null, it: null })
    })
    return NextResponse.json({ seo, languages: ['de', 'en'], sourceLang: 'de', rows })
  }

  // Legacy/nested schema: EN is the DOM source; every other language lives in
  // I18N[lang][key]. The column set is DERIVED from the file (de/hr/it/cs/…),
  // not a fixed list — so a page's actual languages always show.
  const nested = i18n as Record<string, Record<string, string>>
  const flavorLangs = flavorLangsOf(i18n)
  const seen = new Set<string>()
  doc.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')
    if (!key || seen.has(key)) return
    seen.add(key)
    const row: Record<string, string | null> = { key, en: el.innerHTML.trim() }
    for (const l of flavorLangs) row[l] = nested[l]?.[key] ?? null
    rows.push(row)
  })

  return NextResponse.json({ seo, languages: ['en', ...flavorLangs], sourceLang: 'en', rows })
}

export async function PATCH(req: NextRequest) {
  let body: { path?: string; op?: string; field?: string; key?: string; lang?: string; value?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  const { path, op, value } = body
  if (!path) return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  const abs = resolve(path)
  if (!abs) return NextResponse.json({ error: 'Bad path' }, { status: 400 })

  let html: string
  try { html = await readFile(abs, 'utf-8') }
  catch { return NextResponse.json({ error: 'File not found' }, { status: 404 }) }

  // Languages the page actually declares — derived, so de/hr/it/cs/… all validate.
  const flavorLangs = flavorLangsOf(readI18N(html))
  let next: string | null = null
  let newKey: string | undefined            // set when a flat-schema German edit renames the key
  if (op === 'seo' && body.field && value !== undefined) {
    next = setSeo(html, body.field, value)
  } else if (op === 'cell' && body.key && body.lang && value !== undefined) {
    // Schema-aware translation edit. The panel sends this for every editable lang,
    // including the source language — BOTH are editable.
    const schema = schemaOf(readI18N(html))
    if (schema === 'flat') {
      if (body.lang === 'en') next = setFlat(html, body.key, value)
      else if (body.lang === 'de') {
        next = setGermanSource(html, body.key, value)
        if (next && !body.key.startsWith('@')) newKey = value   // text rows: German IS the key
      }
      else return NextResponse.json({ error: 'Bad lang' }, { status: 400 })
    } else if (body.lang === 'en') {
      next = setEnglish(html, body.key, value)
    } else if (flavorLangs.includes(body.lang)) {
      next = setTranslation(html, body.lang, body.key, value)
    } else {
      return NextResponse.json({ error: 'Bad lang' }, { status: 400 })
    }
  } else if (op === 'translation' && body.key && body.lang && value !== undefined && flavorLangs.includes(body.lang)) {
    next = setTranslation(html, body.lang, body.key, value)
  } else if (op === 'english' && body.key && value !== undefined) {
    next = setEnglish(html, body.key, value)
  } else if (op === 'delete' && body.key) {
    next = html
    for (const l of flavorLangs) next = deleteTranslation(next, l, body.key)
  } else {
    return NextResponse.json({ error: 'Bad op' }, { status: 400 })
  }

  if (next === null) return NextResponse.json({ error: 'Target not found in file' }, { status: 422 })
  await writeFile(abs, next, 'utf-8')
  return NextResponse.json({ ok: true, ...(newKey !== undefined ? { newKey } : {}) })
}
