// ==========================================
// CRM bulk insert — single Excel write for N candidates
// POST /api/admin/crm/prospects/bulk
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { readSheet, writeSheet, type Prospect, type ProspectStage, type ProspectStatus } from '@/lib/crm-store'

interface BulkCandidate {
  company?: string
  contact_name?: string
  phone?: string
  email?: string
  website?: string
  amount_chf?: number
  confidence_pct?: number
  notes?: string
  tags?: string
}

interface BulkRequestBody {
  candidates: BulkCandidate[]
  defaults?: {
    stage?: ProspectStage
    status?: ProspectStatus
    confidence_pct?: number
    owner?: string
    batchTag?: string
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BulkRequestBody
    const candidates = body.candidates ?? []
    if (candidates.length === 0) {
      return NextResponse.json({ error: 'No candidates supplied' }, { status: 400 })
    }
    const defaults = body.defaults ?? {}

    const existing = readSheet()
    const usedIds = new Set(existing.map(p => p.id))
    let nextN = existing.length + 1
    const allocateId = (): string => {
      let id = `P${String(nextN).padStart(3, '0')}`
      while (usedIds.has(id)) {
        nextN += 1
        id = `P${String(nextN).padStart(3, '0')}`
      }
      usedIds.add(id)
      nextN += 1
      return id
    }

    const now = new Date().toISOString()
    const created: Prospect[] = []
    const errors: { row: number; error: string }[] = []
    const batchTag = defaults.batchTag ?? `bulk-import-${now.slice(0, 10)}`

    candidates.forEach((c, idx) => {
      const company = (c.company ?? '').trim()
      if (!company) {
        errors.push({ row: idx, error: 'Missing company' })
        return
      }
      const userTags = (c.tags ?? '').trim()
      const tags = userTags ? `${userTags}, ${batchTag}` : batchTag
      const row: Prospect = {
        id: allocateId(),
        company,
        contact_name: c.contact_name ?? '',
        phone: c.phone ?? '',
        email: c.email ?? '',
        website: c.website ?? '',
        stage: defaults.stage ?? 'Incoming',
        status: defaults.status ?? 'To do',
        amount_chf: Number(c.amount_chf ?? 0),
        confidence_pct: Number(c.confidence_pct ?? defaults.confidence_pct ?? 25),
        next_action_date: now.slice(0, 10),
        next_action_label: 'TODAY',
        tags,
        starred: false,
        owner: defaults.owner ?? 'Filippo',
        notes: c.notes ?? '',
        created_at: now,
        standby_plan: '',
        lost_reason: '',
        sub_stage: '',
        address_strasse: '',
        address_plz: '',
        address_ort: '',
        uid_number: '',
        intel_json: '{}',
      }
      created.push(row)
    })

    if (created.length === 0) {
      return NextResponse.json(
        { error: 'All candidates failed validation', errors },
        { status: 400 },
      )
    }

    // Single Excel write — never per-row, otherwise N candidates = N read+write cycles on a 50-row file.
    await writeSheet([...existing, ...created])

    return NextResponse.json({
      created: created.length,
      errors,
      ids: created.map(c => c.id),
    })
  } catch (err) {
    console.error('[CRM] bulk POST failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
