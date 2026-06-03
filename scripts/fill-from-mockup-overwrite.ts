// OVERWRITE matching prospects' fields with the mockup's values (Ralph 2026-05-28).
// "Fill it from the mockup" — replaces existing values where the mockup has a
// value. Only skips a field when the mockup value is itself blank/"—", so it
// never wipes DB data with an empty. Verified addresses (street/PLZ) and the
// People/contacts table are untouched (the mockup has no such fields).
// Source: public/2026-01-27-debug/territoryxfathom/crm-data.js
// Run: OSKAR_NODE_ID=ralph-mac npx tsx scripts/fill-from-mockup-overwrite.ts
import { readFileSync } from 'node:fs'
import { readSheet, writeSheet, type Prospect, type ProspectStage, type ProspectStatus } from '../lib/crm-store'

;(globalThis as Record<string, unknown>).window = {}
;(0, eval)(readFileSync('public/2026-01-27-debug/territoryxfathom/crm-data.js', 'utf-8'))
const mockLeads: Record<string, unknown>[] =
  ((globalThis as Record<string, unknown>).window as { CRMData: { leads: Record<string, unknown>[] } }).CRMData.leads

const deUml = (s: string) =>
  s.replace(/[äàá]/g, 'a').replace(/[öò]/g, 'o').replace(/[üù]/g, 'u').replace(/[èéê]/g, 'e').replace(/ç/g, 'c').replace(/ß/g, 'ss')
const norm = (s: string) =>
  deUml((s || '').split(',')[0].toLowerCase()).replace(/\b(gmbh|ag|sagl|sa|srl)\b/g, '').replace(/[^a-z0-9]/g, '')
const clean = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '—' || s === '-' ? '' : s
}

const STAGE: Record<string, ProspectStage> = { incoming: 'Incoming', contacted: 'Contacted', demo: 'Demo done', closing: 'Closing' }
const STATUS: Record<string, ProspectStatus> = { todo: 'To do', standby: 'Standby', awaiting: 'Awaiting reply', won: 'Won', lost: 'Lost', cancelled: 'Cancelled' }

const mockByCompany = new Map<string, Record<string, unknown>>()
for (const m of mockLeads) mockByCompany.set(norm(String(m.company)), m)

async function main() {
  const rows = readSheet()
  const changes: string[] = []
  let matched = 0

  for (const p of rows) {
    const m = mockByCompany.get(norm(p.company))
    if (!m) continue
    matched++
    const set = (field: keyof Prospect, val: unknown) => {
      if (val === '' || val === null || val === undefined) return
      if ((p as unknown as Record<string, unknown>)[field] === val) return
      ;(p as unknown as Record<string, unknown>)[field] = val
      changes.push(`${p.id} ${p.company.padEnd(26)} ${field} = ${String(val).slice(0, 38)}`)
    }
    set('contact_name', clean(m.contact))
    set('email', clean(m.email))
    set('phone', clean(m.phone))
    set('notes', clean(m.comment))
    set('next_action_label', clean(m.note))
    set('next_action_date', clean(m.due))
    set('tags', clean(m.tag))
    set('address_ort', clean(m.city))
    if (typeof m.amount === 'number' && m.amount > 0) set('amount_chf', m.amount)
    if (typeof m.prob === 'number' && m.prob > 0) set('confidence_pct', Math.round(m.prob * 100))
    if (typeof m.stage === 'string' && STAGE[m.stage]) set('stage', STAGE[m.stage])
    if (typeof m.status === 'string' && STATUS[m.status]) set('status', STATUS[m.status])
    if (typeof m.starred === 'boolean') set('starred', m.starred)
  }

  console.log(changes.join('\n'))
  console.log(`\n${matched} prospects matched the mockup; ${changes.length} fields overwritten.`)
  await writeSheet(rows)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
