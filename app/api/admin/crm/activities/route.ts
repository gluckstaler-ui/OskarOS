// ==========================================
// Admin CRM API: Activities — List + Append
// GET  /api/admin/crm/activities?prospect_id=P011
// POST /api/admin/crm/activities
//
// WP-CRM-A2 (Ralph 2026-05-22) — persistence backing for the Activities
// sheet inside docs/crm-feature/prospects.xlsx.
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { readActivities, appendActivity, type ActivityType } from '@/lib/crm-store'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const prospect_id = searchParams.get('prospect_id') || undefined
    const activities = readActivities(prospect_id)
    return NextResponse.json({ activities, count: activities.length })
  } catch (err) {
    console.error('[CRM] GET activities failed:', err)
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('EBUSY') || msg.includes('resource busy')) {
      return NextResponse.json(
        { error: 'Excel file is currently open — please close it and try again' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface PostBody {
  prospect_id: string
  type: ActivityType
  icon?: string
  color?: string
  duration_min?: number
  notes?: string
  session_id?: string
  subject?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PostBody
    if (!body.prospect_id || !body.type) {
      return NextResponse.json(
        { error: 'prospect_id and type are required' },
        { status: 400 }
      )
    }
    const row = await appendActivity({
      prospect_id: body.prospect_id,
      type: body.type,
      icon: body.icon ?? '',
      color: body.color ?? '',
      duration_min: body.duration_min ?? 0,
      notes: body.notes ?? '',
      session_id: body.session_id ?? '',
      subject: body.subject ?? '',
    })
    return NextResponse.json({ activity: row }, { status: 201 })
  } catch (err) {
    console.error('[CRM] POST activity failed:', err)
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('EBUSY') || msg.includes('resource busy')) {
      return NextResponse.json(
        { error: 'Excel file is currently open — please close it and try again' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
