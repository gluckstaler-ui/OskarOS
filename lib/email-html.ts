// ==========================================
// email-html — plain-text → simple HTML for outgoing mail and previews.
// Consular 2026-08-15 (Filippo: "emails need links when they go out and
// while being displayed; we also need bold").
//
// Conventions (kept deliberately small — this is correspondence, not CMS):
//   **bold**                → <strong>bold</strong>
//   [label](https://…)      → <a href="…">label</a>
//   https://… / www.…       → auto-linked
//   bare domains (x.ch etc) → auto-linked (whitelisted TLDs only, so
//                             "Fr. 1'000.–" and version numbers stay text)
//   newlines                → <br> inside paragraphs, blank line = new <p>
// Everything is HTML-escaped FIRST; the markup is applied on escaped text,
// so user content can never inject tags.
// ==========================================

const TLDS = ['ch', 'com', 'dev', 'net', 'org', 'swiss', 'it', 'de', 'eu', 'wine', 'earth']

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function linkify(escaped: string): string {
  let out = escaped
  // [label](url) — url must look like a URL; label already escaped
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
  // explicit http(s) URLs
  out = out.replace(/(?<!["'=(\]>])\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?]/g, (m) => `<a href="${m}">${m}</a>`)
  // www. URLs
  out = out.replace(/(?<![/"'=\w])\bwww\.[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s<>()]*)?/gi, (m) => `<a href="https://${m}">${m}</a>`)
  // bare domains with whitelisted TLDs (e.g. silke-lengler.ch, paradiso.dev/pfad)
  const tld = TLDS.join('|')
  const bare = new RegExp(String.raw`(?<![/@.\w'"=-])\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:${tld}))(\/[^\s<>()]*)?\b`, 'gi')
  out = out.replace(bare, (m, _d, _p, offset: number, full: string) => {
    // don't double-link inside an <a …> we just created
    const before = full.slice(Math.max(0, offset - 60), offset)
    if (/href="[^"]*$|>[^<]*$/.test(before) && before.lastIndexOf('<a') > before.lastIndexOf('</a>')) return m
    return `<a href="https://${m}">${m}</a>`
  })
  return out
}

/** Full text → HTML email body (paragraphs, bold, links). */
export function renderEmailHtml(text: string): string {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const htmlParas = paragraphs.map((p) => {
    let h = escapeHtml(p)
    h = linkify(h)
    h = h.replace(/\*\*([^*\n][^*]*?)\*\*/g, '<strong>$1</strong>')
    return `<p style="margin:0 0 1em 0; line-height:1.55;">${h.replace(/\n/g, '<br>')}</p>`
  })
  return `<div style="font-family: Helvetica, Arial, sans-serif; font-size: 15px; color: #1a1a1a; max-width: 640px;">${htmlParas.join('')}</div>`
}
