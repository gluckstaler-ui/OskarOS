// ==========================================
// CRM bulk parse — preview text/file, return columns + existing identities for client-side mapping & dup-detect
// POST /api/admin/crm/parse
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { readSheet } from '@/lib/crm-store'
import { parseText, detectDuplicates } from '@/lib/crm-parsers'
import { read, utils } from 'xlsx'
import { JSDOM } from 'jsdom'

interface ParseRequestBody {
  text?: string
  fileBase64?: string
  // 'html' added 2026-06-03 (WP-SCOUT-6) — accept HTML address tables for
  // the Scout pool ingest. JSDOM extracts the largest <table>; group-divider
  // rows (any cell with colspan>1) are filtered before the result hits the
  // existing CSV-style parseText flow.
  fileType?: 'csv' | 'tsv' | 'xlsx' | 'html'
}

/**
 * Pull the largest <table> out of an HTML document and return its rows
 * as a CSV-formatted string the downstream tabular parser handles natively.
 * Filters out group-header dividers (rows where any cell has colspan>1)
 * — the Aargau samples used these as visual section breaks and pandas
 * pulled them in as bogus data rows.
 */
function htmlToCsv(html: string): string {
  const dom = new JSDOM(html)
  const tables = dom.window.document.querySelectorAll('table')
  if (tables.length === 0) return ''
  // Pick the table with the most rows — pages often have a small nav/header
  // table before the real data table.
  let best: Element | null = null
  let bestRows = 0
  tables.forEach((t) => {
    const r = t.querySelectorAll('tr').length
    if (r > bestRows) { best = t; bestRows = r }
  })
  if (!best) return ''
  const rows: string[][] = []
  const trs = (best as Element).querySelectorAll('tr')
  trs.forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll('th, td')) as Element[]
    if (cells.length === 0) return
    // colspan>1 → divider row (section header). Drop.
    if (cells.some((c) => parseInt(c.getAttribute('colspan') || '1', 10) > 1)) return
    const values = cells.map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())
    if (values.every((v) => !v)) return  // all-empty styling artefact
    rows.push(values)
  })
  if (rows.length === 0) return ''
  // Equalise column count so the CSV parser doesn't see ragged rows.
  const cols = Math.max(...rows.map((r) => r.length))
  const lines = rows.map((r) => {
    const padded = [...r, ...Array(cols - r.length).fill('')]
    return padded
      .map((v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
      .join(',')
  })
  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ParseRequestBody
    let text = body.text ?? ''

    if (body.fileBase64 && body.fileType) {
      const buf = Buffer.from(body.fileBase64, 'base64')
      if (body.fileType === 'xlsx') {
        const wb = read(buf, { type: 'buffer' })
        const sheetName = wb.SheetNames[0]
        const ws = wb.Sheets[sheetName]
        if (!ws) {
          return NextResponse.json({ error: 'XLSX file has no readable sheets' }, { status: 400 })
        }
        // sheet_to_csv preserves the structure; downstream parser handles the rest
        text = utils.sheet_to_csv(ws)
      } else if (body.fileType === 'html') {
        // WP-SCOUT-6 — extract <table> rows to CSV via JSDOM, then the
        // existing tabular pipeline handles columns/mapping/dedup.
        const html = buf.toString('utf8')
        text = htmlToCsv(html)
        if (!text.trim()) {
          return NextResponse.json({ error: 'No usable <table> found in the HTML file' }, { status: 400 })
        }
      } else {
        text = buf.toString('utf8')
      }
    } else if (body.text && /<table[\s>]/i.test(body.text)) {
      // Pasted HTML markup directly into the textarea — handle the same way
      // as an uploaded .html file. Quick sniff (looking for `<table`) so we
      // don't accidentally HTMLise CSV that happens to contain the word.
      text = htmlToCsv(body.text)
      if (!text.trim()) {
        return NextResponse.json({ error: 'No usable <table> found in the pasted HTML' }, { status: 400 })
      }
    }

    if (!text.trim()) {
      return NextResponse.json({ error: 'No text or file content provided' }, { status: 400 })
    }

    const result = parseText(text)
    const existing = readSheet().map(p => ({ id: p.id, phone: p.phone, email: p.email }))

    // For vCard mode the parser produces candidates directly — pre-detect dups so the client doesn't have to.
    let vcardDuplicates = null
    if (result.mode === 'vcard' && result.candidates) {
      vcardDuplicates = detectDuplicates(result.candidates, existing)
    }

    return NextResponse.json({
      result,
      existing,
      vcardDuplicates,
    })
  } catch (err) {
    console.error('[CRM] parse failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
