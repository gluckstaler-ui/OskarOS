// ==========================================
// CRM bulk parse — preview text/file, return columns + existing identities for client-side mapping & dup-detect
// POST /api/admin/crm/parse
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { readSheet } from '@/lib/crm-store'
import { parseText, detectDuplicates } from '@/lib/crm-parsers'
import { read, utils } from 'xlsx'

interface ParseRequestBody {
  text?: string
  fileBase64?: string
  fileType?: 'csv' | 'tsv' | 'xlsx'
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
      } else {
        text = buf.toString('utf8')
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
