// ==========================================
// Admin CRM API: Contact field update / delete
// PATCH  /api/admin/crm/contacts/[id]   { field, next }   one-field-at-a-time
// DELETE /api/admin/crm/contacts/[id]
// WP-121 (Ralph 2026-05-28)
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { updateContactField, removeContact } from '@/lib/crm-store'

const ALLOWED_FIELDS = new Set([
  'name', 'role', 'phone', 'email', 'linkedin', 'notes', 'title', 'is_decisive',
])

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({})) as {
      field?: string
      next?: unknown
    }
    if (!body.field || !ALLOWED_FIELDS.has(body.field)) {
      return NextResponse.json({ error: `unknown contact field "${body.field}"` }, { status: 400 })
    }
    // Cast is safe because we whitelisted against ALLOWED_FIELDS above.
    const contact = await updateContactField(
      id,
      body.field as 'name' | 'role' | 'phone' | 'email' | 'linkedin' | 'notes' | 'title' | 'is_decisive',
      body.next,
    )
    if (!contact) {
      return NextResponse.json({ error: `contact ${id} not found` }, { status: 404 })
    }
    return NextResponse.json({ contact })
  } catch (err) {
    console.error('[CRM] PATCH contact failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const removed = await removeContact(id)
    if (!removed) {
      return NextResponse.json({ error: `contact ${id} not found` }, { status: 404 })
    }
    return NextResponse.json({ contact: removed })
  } catch (err) {
    console.error('[CRM] DELETE contact failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
