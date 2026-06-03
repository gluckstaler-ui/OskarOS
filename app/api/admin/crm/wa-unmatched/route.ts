// ============================================================================
// GET  /api/admin/crm/wa-unmatched — surface inbound WhatsApp from unknown
// DELETE /api/admin/crm/wa-unmatched?wa_message_id=... — dismiss one entry
//
// WP-CRM-F19 follow-up (Ralph 2026-05-25): the wa-inbound route stashes
// messages from non-prospect phones into public/_whatsapp/unmatched.jsonl.
// Until now there was no UI for that file. This endpoint surfaces them so
// the Overview rail can show "💬 WhatsApp (N new)" with the real count,
// and the triage rows can be rendered + dismissed/matched/created-as-lead.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'

const UNMATCHED_PATH = join(process.cwd(), 'public', '_whatsapp', 'unmatched.jsonl')

interface UnmatchedMessage {
  phone?: string
  push_name?: string | null
  body?: string
  wa_message_id?: string | null
  media_path?: string | null
  media_mime?: string | null
  timestamp?: string
}

async function readUnmatched(): Promise<UnmatchedMessage[]> {
  if (!existsSync(UNMATCHED_PATH)) return []
  const content = await readFile(UNMATCHED_PATH, 'utf8')
  const messages: UnmatchedMessage[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      messages.push(JSON.parse(trimmed))
    } catch {
      // skip corrupted line
    }
  }
  // newest first
  messages.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
  return messages
}

export async function GET() {
  try {
    const messages = await readUnmatched()
    return NextResponse.json({ messages, count: messages.length })
  } catch (err) {
    console.error('[wa-unmatched] GET failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Dismiss = remove one entry from the JSONL file by wa_message_id. Used when
// the user creates a lead from the message OR explicitly dismisses it.
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('wa_message_id')
    if (!id) {
      return NextResponse.json({ error: 'wa_message_id required' }, { status: 400 })
    }
    const messages = await readUnmatched()
    const remaining = messages.filter(m => m.wa_message_id !== id)
    const removed = messages.length - remaining.length
    if (removed === 0) {
      return NextResponse.json({ error: `wa_message_id ${id} not found` }, { status: 404 })
    }
    const out = remaining.map(m => JSON.stringify(m)).join('\n') + (remaining.length ? '\n' : '')
    await writeFile(UNMATCHED_PATH, out, 'utf8')
    return NextResponse.json({ removed, remaining: remaining.length })
  } catch (err) {
    console.error('[wa-unmatched] DELETE failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
