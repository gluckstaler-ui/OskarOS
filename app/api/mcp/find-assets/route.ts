/**
 * /api/mcp/find-assets — Phase 2 Tier A (2026-04-30).
 *
 * Keyword search over filenames + Nano descriptions in IMAGES.md.
 * Returns ranked results — no ML embedding in v1; defer until proven need.
 *
 * Ranking: filename match scores 3, single-word description match scores 2,
 * partial description match scores 1. Cross-source matches add bonus 1.
 */

import { NextResponse } from 'next/server'
import { parseImagesMd } from '@/lib/session'

interface FindHit {
  filename: string
  score: number
  snippet: string
}

function scoreEntry(filename: string, desc: string, terms: string[]): { score: number; snippet: string } {
  let score = 0
  let filenameHits = 0
  let descHits = 0
  const lowerName = filename.toLowerCase()
  const lowerDesc = (desc || '').toLowerCase()
  for (const t of terms) {
    if (!t) continue
    if (lowerName.includes(t)) {
      score += 3
      filenameHits++
    }
    // Word-boundary match in description scores 2; substring scores 1.
    const wordRe = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    if (wordRe.test(lowerDesc)) {
      score += 2
      descHits++
    } else if (lowerDesc.includes(t)) {
      score += 1
      descHits++
    }
  }
  // Cross-source bonus: matched in BOTH filename + description.
  if (filenameHits > 0 && descHits > 0) score += 1

  // Bug 13 fix (Ralph 2026-04-30): snip on word boundaries so snippets
  // don't end mid-word ("the w…"). After picking a window around the first
  // term match, expand backwards/forwards to the nearest whitespace and
  // drop any partial token at either edge.
  let snippet = ''
  if (desc) {
    const firstTerm = terms.find((t) => lowerDesc.includes(t))
    if (firstTerm) {
      const idx = lowerDesc.indexOf(firstTerm)
      let start = Math.max(0, idx - 20)
      let end = Math.min(desc.length, idx + 60)
      // Walk start LEFT to a whitespace boundary (or document start).
      while (start > 0 && !/\s/.test(desc[start - 1])) start++
      // Walk end LEFT to a whitespace boundary so we don't cut mid-word.
      while (end < desc.length && !/\s/.test(desc[end])) end--
      // Trim leading/trailing whitespace inside the slice for cleanliness.
      snippet = desc.slice(start, end).trim()
      if (start > 0) snippet = '…' + snippet
      if (end < desc.length) snippet = snippet + '…'
    } else {
      // No match — clamp at last word boundary in the first 80 chars.
      const window = desc.slice(0, 80)
      const lastSpace = window.lastIndexOf(' ')
      snippet = lastSpace > 30 ? window.slice(0, lastSpace) + '…' : window
    }
  }
  return { score, snippet }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const query = String(body.query || '').trim()
  const limit = Math.max(1, Math.min(50, Number(body.limit) || 10))
  // WP-IMG-7 (2026-05-06): provenance filter. Accepts:
  //   - exact match: 'image_ops:crop'
  //   - namespace prefix: 'image_ops:'  (matches any image_ops:* op)
  //   - bare namespace: 'image_ops'     (alias for the prefix above)
  // When no `query` is passed, the filter alone returns matching entries
  // (previously requiring a query meant `find_assets(filter:...)` was
  // dead-letter for use cases like "list every image_ops slice output").
  const filter = body.filter && typeof body.filter === 'object' ? body.filter : null
  const provFilter: string | null = filter?.provenance
    ? String(filter.provenance).trim().toLowerCase()
    : null

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  if (!query && !provFilter) return NextResponse.json({ hits: [] })

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

  let parsed: Awaited<ReturnType<typeof parseImagesMd>>
  try {
    parsed = await parseImagesMd(sessionId)
  } catch {
    return NextResponse.json({ hits: [] })
  }

  const matchesProvenance = (entryProv: string | undefined): boolean => {
    if (!provFilter) return true
    if (!entryProv) return false
    const ep = entryProv.toLowerCase()
    // Exact match
    if (ep === provFilter) return true
    // Prefix match — accept both `image_ops:` and `image_ops` shapes
    const prefix = provFilter.endsWith(':') ? provFilter : `${provFilter}:`
    return ep.startsWith(prefix)
  }

  const hits: FindHit[] = []
  for (const entry of parsed.values()) {
    if (!matchesProvenance(entry.provenance)) continue
    if (terms.length === 0) {
      // Filter-only — return all entries that match the provenance filter.
      hits.push({ filename: entry.filename, score: 1, snippet: entry.cdAnalysis?.slice(0, 80) ?? '' })
      continue
    }
    const { score, snippet } = scoreEntry(entry.filename, entry.cdAnalysis || '', terms)
    if (score > 0) hits.push({ filename: entry.filename, score, snippet })
  }
  hits.sort((a, b) => b.score - a.score || a.filename.localeCompare(b.filename))

  return NextResponse.json({ hits: hits.slice(0, limit) })
}
