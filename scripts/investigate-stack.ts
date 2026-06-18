// scripts/investigate-stack.ts — §Scout investigation: take the sites the
// current detector labels "custom / unknown", fetch each, and detect the TRUE
// stack from the generator meta tag, response headers, and platform-specific
// asset paths the current detectStack() misses. Read-only (network GETs).
//   tsx scripts/investigate-stack.ts   (reads /tmp/stack-unknown.txt)
import { readFileSync } from 'fs'

interface Probe { url: string; status: number | string; verdict: string; generator: string; server: string; xpb: string; evidence: string[] }

// Extended detector — everything detectStack() knows PLUS the platforms that
// dominate the Swiss/DACH SME long tail (TYPO3, Contao, site builders, SSGs).
function detect(html: string, hdr: Record<string, string>): { verdict: string; generator: string; evidence: string[] } {
  const h = html.toLowerCase()
  const gen = (html.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/i)?.[1] || '').trim()
  const ev: string[] = []
  const add = (label: string, cond: boolean) => { if (cond) ev.push(label) }

  add('WordPress', /wp-content|wp-includes|wp-json|\/wp-/.test(h))
  add('·Elementor', /elementor/.test(h))
  add('·Divi', /et_pb_|et-core/.test(h))
  add('TYPO3', /typo3conf|typo3temp|\/fileadmin\/|data-namespace-typo3/.test(h))
  add('Joomla', /com_content|com_contact|\/media\/jui\/|option=com_|\/media\/system\/js\//.test(h))
  add('Contao', /contao|\/tl_files\/|tl_page|\/bundles\/contao/.test(h))
  add('Drupal', /sites\/default\/files|drupal-settings-json|\/core\/misc\/|\/sites\/all\//.test(h))
  add('Wix', /wix\.com|_wixcss|parastorage|wixstatic/.test(h))
  add('Squarespace', /squarespace|static1\.squarespace|sqsp\.net/.test(h))
  add('Jimdo', /jimdo|jimdofree|jimdo-/.test(h))
  add('Webflow', /webflow|website-files\.com|assets\.website-files/.test(h))
  add('Framer', /framerusercontent|framerstatic|framer\.com/.test(h))
  add('Weebly', /weebly|editmysite/.test(h))
  add('Webnode', /webnode/.test(h))
  add('one.com-WB', /(cdn|app)\.one\.com|one-com|simplesite/.test(h))
  add('IONOS-MyWebsite', /ionos|1and1|mywebsite\.|s\d+\.ionos/.test(h))
  add('GoDaddy-WB', /img\.cdn\.godaddy|websitebuilder|aboutus\.godaddy/.test(h))
  add('Google-Sites', /sites\.google\.com|gstatic\.com\/sites/.test(h))
  add('Hugo', /hugo/.test(gen.toLowerCase()))
  add('Gatsby', /___gatsby|\/gatsby/.test(h))
  add('Hostpoint-Sites', /sites\.hostpoint|hostpoint.*sitebuilder/.test(h))
  add('Next.js', /_next\/static|__next_data__/.test(h))
  add('Nuxt', /_nuxt|__nuxt/.test(h))
  add('Vue', /vue(\.runtime)?\.(min\.)?js|data-v-[0-9a-f]{8}/.test(h))
  add('React', /data-reactroot|react-dom/.test(h))
  add('Bootstrap', /bootstrap(\.min)?\.(css|js)/.test(h))
  add('jQuery', /jquery(-\d|\.min)?\.js/.test(h))

  // headers
  const xg = hdr['x-generator'] || ''
  const xpb = hdr['x-powered-by'] || ''
  const setc = hdr['set-cookie'] || ''
  if (xg) ev.push(`hdr:x-generator=${xg}`)
  if (/typo3/i.test(setc) || /fe_typo_user/i.test(setc)) ev.push('cookie:TYPO3')
  if (/joomla|^[0-9a-f]{32}=/i.test(setc) && /joomla/i.test(setc)) ev.push('cookie:Joomla')

  // verdict: generator meta wins; else strongest CMS/builder hit; else framework; else genuine custom
  const cmsOrder = ['TYPO3', 'Joomla', 'Contao', 'Drupal', 'WordPress', 'Wix', 'Squarespace', 'Jimdo', 'Webflow', 'Framer', 'Weebly', 'Webnode', 'one.com-WB', 'IONOS-MyWebsite', 'GoDaddy-WB', 'Google-Sites', 'Hostpoint-Sites', 'Hugo', 'Gatsby', 'Next.js', 'Nuxt']
  let verdict = ''
  if (gen) verdict = `generator: ${gen}`
  else { const f = cmsOrder.find((c) => ev.includes(c)); verdict = f || (ev.length ? `JS/site (${ev.join(',')})` : 'genuinely custom/static') }
  return { verdict, generator: gen, evidence: ev }
}

async function probe(rawUrl: string): Promise<Probe> {
  const url = /^https?:\/\//.test(rawUrl) ? rawUrl : 'https://' + rawUrl
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'Mozilla/5.0 (OskarOS Scout investigate)' } })
    const hdr: Record<string, string> = {}
    r.headers.forEach((v, k) => { hdr[k] = v })
    const html = (await r.text()).slice(0, 300_000)
    const d = detect(html, hdr)
    return { url: rawUrl, status: r.status, verdict: d.verdict, generator: d.generator, server: hdr['server'] || '', xpb: hdr['x-powered-by'] || '', evidence: d.evidence }
  } catch (e) {
    return { url: rawUrl, status: 'ERR', verdict: `fetch failed: ${e instanceof Error ? e.message : String(e)}`, generator: '', server: '', xpb: '', evidence: [] }
  }
}

async function main() {
  const urls = readFileSync('/tmp/stack-unknown.txt', 'utf-8').split('\n').map((s) => s.trim()).filter(Boolean)
  const results = await Promise.all(urls.map(probe))
  const tally: Record<string, number> = {}
  for (const r of results) {
    const key = r.verdict.startsWith('generator:') ? r.verdict : r.verdict.split(' ')[0]
    tally[key] = (tally[key] || 0) + 1
    console.log(`\n${r.url}  [${r.status}]`)
    console.log(`  TRUE STACK → ${r.verdict}`)
    if (r.server || r.xpb) console.log(`  hdr: server=${r.server || '-'}  x-powered-by=${r.xpb || '-'}`)
    if (r.evidence.length) console.log(`  evidence: ${r.evidence.join(' · ')}`)
  }
  console.log('\n════ TALLY (true stack of the 20 "custom/unknown") ════')
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(2)} × ${k}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
