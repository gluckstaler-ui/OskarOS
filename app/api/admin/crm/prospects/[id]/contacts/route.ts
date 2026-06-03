// ==========================================
// Admin CRM API: Contacts list / create per prospect
// GET  /api/admin/crm/prospects/[id]/contacts
// POST /api/admin/crm/prospects/[id]/contacts
// WP-121 (Ralph 2026-05-28)
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { readContacts, addContact, type ContactRole } from '@/lib/crm-store'
import { promoteUnmatchedForPhone } from '@/lib/wa-inbound-dispatch'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const contacts = readContacts(id)
    return NextResponse.json({ contacts })
  } catch (err) {
    console.error('[CRM] GET contacts failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: prospect_id } = await params
    const body = await req.json().catch(() => ({})) as {
      name?: string
      role?: ContactRole | ''
      phone?: string
      email?: string
      linkedin?: string
      notes?: string
      title?: string
      is_decisive?: boolean
    }
    const contact = await addContact({ prospect_id, ...body })

    // Ralph 2026-05-31 · auto-rescan unmatched WhatsApp buffer for this phone.
    // The WA inbound dispatcher only matches against `prospects.phone`, so any
    // message that arrived from a contact's mobile (before the contact existed
    // in the CRM) was stashed in public/_whatsapp/unmatched.jsonl and stayed
    // there. Now that the contact exists, promote those messages onto this
    // prospect's timeline. Non-fatal — contact creation succeeds either way.
    let promoted_unmatched = { promoted: 0, activity_ids: [] as string[], prospect_id }
    if (contact?.phone) {
      try {
        promoted_unmatched = await promoteUnmatchedForPhone(contact.phone, prospect_id)
        if (promoted_unmatched.promoted > 0) {
          console.log(
            `[CRM] promoted ${promoted_unmatched.promoted} unmatched WA → ${prospect_id} on contact ${contact.id} (${contact.phone})`,
          )
        }
      } catch (err) {
        console.warn('[CRM] promoteUnmatchedForPhone failed (non-fatal):', err)
      }
    }
    return NextResponse.json({ contact, promoted_unmatched })
  } catch (err) {
    console.error('[CRM] POST contact failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
