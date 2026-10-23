// Shared Markdown → HTML helpers for the generated pages (backlog, runbook). Paradiso style lives in the page CSS.
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function inline(s) {
  const codes = []
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000` })
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
  s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  s = s.replace(/\[TODO([^\]]*)\]/g, '<span class="flag todo">TODO$1</span>')
  s = s.replace(/⛔ (D-[A-Z]+)/g, '<span class="flag dec">⛔ $1</span>').replace(/🔒/g, '<span class="flag sudo">🔒 sudo</span>')
  const URL_RE = /(?<![="'>\w])((?:https?|vnc|ssh|fmp|smb|afp):\/\/[^\s<>"')\]]+|mailto:[^\s<>"')\]]+)/g
  const linkify = txt => txt.replace(URL_RE, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
  s = linkify(s)
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => URL_RE.test(codes[i] + '') && (URL_RE.lastIndex = 0, true) ? `<a href="${codes[i].match(URL_RE)[0]}" target="_blank" rel="noopener"><code>${codes[i]}</code></a>` : `<code>${codes[i]}</code>`)
}

/* paragraphs, nested lists, numbered lists, tables, fenced code, headings (### and ####) */
export function block(lines, { headings = true } = {}) {
  let out = '', i = 0
  const stack = [] // [{depth, type}]
  const close = (toDepth = -1) => { while (stack.length && stack[stack.length - 1].depth > toDepth) { const t = stack.pop().type; out += `</li></${t}>` } }
  while (i < lines.length) {
    const l = lines[i]
    if (/^\s*```/.test(l)) { close(); const buf = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++ } i++; out += `<pre><code>${esc(buf.join('\n'))}</code></pre>`; continue }
    if (/^\s*\|/.test(l)) {
      close(); const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i].trim()); i++ }
      const cells = r => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => inline(c.trim().replace(/\\\|/g, '|')).replace(/&lt;br&gt;/g, '<br>'))
      const head = cells(rows[0]); const body = rows.slice(2).map(cells)
      out += `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`; continue
    }
    const h = headings && /^(#{3,4})\s+(.*)$/.exec(l)
    if (h) { close(); const lvl = h[1].length + 1; const id = h[2].toLowerCase().replace(/[^a-z0-9äöü.]+/g, '-').replace(/^-|-$/g, ''); out += `<h${lvl} id="${id}">${inline(h[2])}</h${lvl}>`; i++; continue }
    const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(l)
    if (m) {
      const depth = Math.floor(m[1].length / 2), type = /\d/.test(m[2]) ? 'ol' : 'ul'
      const top = stack[stack.length - 1]
      if (top && depth === top.depth) out += '</li><li>'
      else if (!top || depth > top.depth) { out += `<${type}><li>`; stack.push({ depth, type }) }
      else { close(depth); out += '</li><li>' }
      out += inline(m[3]); i++; continue
    }
    if (/^\s*$/.test(l)) { close(); i++; continue }
    if (/^\s+\S/.test(l) && stack.length) { out += ' ' + inline(l.trim()); i++; continue }
    close(); out += `<p>${inline(l.trim())}</p>`; i++
  }
  close(); return out
}

/* split a markdown file into ## sections */
export function sections(md) {
  const out = []; let cur = { title: '', lines: [] }
  for (const l of md.split('\n')) { const h = /^## (.*)$/.exec(l); if (h) { out.push(cur); cur = { title: h[1], lines: [] } } else cur.lines.push(l) }
  out.push(cur); return out
}
