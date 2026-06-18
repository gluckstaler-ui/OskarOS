// scripts/probe-sites.ts — DEEP fingerprint of specific sites: dump the real
// artifacts (final URL, all headers, every meta, every CSS/JS asset path, HTML
// comments, footer credits) so we can name the actual builder/CMS — no "static"
// hand-waving. Read-only network GETs.
//   tsx scripts/probe-sites.ts <url> [url...]
async function probe(raw: string) {
  const url = /^https?:\/\//.test(raw) ? raw : 'https://' + raw
  const out: string[] = [`\n================ ${raw} ================`]
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (OskarOS Scout deep)' } })
    const html = await r.text()
    const hdr: Record<string, string> = {}; r.headers.forEach((v, k) => { hdr[k] = v })
    const metas = [...html.matchAll(/<meta[^>]+>/gi)].map((m) => m[0]).filter((m) => /name=|property=|generator|application/i.test(m)).slice(0, 14)
    const css = [...new Set([
      ...[...html.matchAll(/<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi)].map((m) => m[1]),
      ...[...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]),
    ])].slice(0, 14)
    const js = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 16)
    const comments = [...html.matchAll(/<!--([\s\S]{0,180}?)-->/g)].map((m) => m[1].replace(/\s+/g, ' ').trim()).filter((c) => c && !/\[if |endif|googleoff|googleon/i.test(c)).slice(0, 8)
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
    const credit = [...html.matchAll(/((?:powered by|made with|created with|built with|webdesign|web design|realisiert|réalis|umsetzung|erstellt|gestaltung|programmierung|konzept|©)[^<]{0,70})/gi)].map((m) => m[1].replace(/\s+/g, ' ').trim()).slice(0, 6)

    out.push(`final: ${r.url}  [${r.status}]  len=${html.length}`)
    out.push(`server=${hdr['server'] || '-'}  x-powered-by=${hdr['x-powered-by'] || '-'}  x-generator=${hdr['x-generator'] || '-'}`)
    if (hdr['set-cookie']) out.push(`set-cookie: ${hdr['set-cookie'].slice(0, 140)}`)
    if (hdr['link']) out.push(`link-hdr: ${hdr['link'].slice(0, 180)}`)
    out.push(`title: ${title || '-'}`)
    out.push('metas:'); metas.forEach((m) => out.push('  ' + m.replace(/\s+/g, ' ').slice(0, 160)))
    out.push('css:'); css.forEach((c) => out.push('  ' + c.slice(0, 130)))
    out.push('js:'); js.forEach((s) => out.push('  ' + s.slice(0, 130)))
    if (comments.length) { out.push('comments:'); comments.forEach((c) => out.push('  ' + c.slice(0, 150))) }
    if (credit.length) { out.push('credits:'); credit.forEach((c) => out.push('  ' + c.slice(0, 130))) }
  } catch (e) {
    out.push(`  ERR ${e instanceof Error ? e.message : String(e)}`)
  }
  console.log(out.join('\n'))
}
async function main() { await Promise.all(process.argv.slice(2).map(probe)) }
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
