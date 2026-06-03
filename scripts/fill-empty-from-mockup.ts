// Fill EMPTY prospect fields from the territoryxfathom mockup (Ralph 2026-05-28).
// Rules (strict):
//   - match a DB prospect to a mockup lead by normalized company name;
//   - only fields that MAP between mockup and our schema;
//   - only when our DB field is EMPTY — never overwrite existing data;
//   - text fields only (skip numeric amount/confidence + booleans: their
//     "empty" is ambiguous and likely already set).
// Source: public/2026-01-27-debug/territoryxfathom/crm-data.js
// Run: OSKAR_NODE_ID=ralph-mac npx tsx scripts/fill-empty-from-mockup.ts [--apply]
import { readFileSync } from 'node:fs'
import { readSheet, writeSheet, type Prospect } from '../lib/crm-store'

// Load the mockup leads (browser IIFE assigns window.CRMData) via a window shim.
;(globalThis as Record<string, unknown>).window = {}
// eslint-disable-next-line no-eval
;(0, eval)(readFileSync('public/2026-01-27-debug/territoryxfathom/crm-data.js', 'utf-8'))
const mockLeads: Record<string, unknown>[] =
  ((globalThis as Record<string, unknown>).window as { CRMData: { leads: Record<string, unknown>[] } }).CRMData.leads

const deUml = (s: string) =>
  s.replace(/[äàá]/g, 'a').replace(/[öò]/g, 'o').replace(/[üù]/g, 'u').replace(/[èéê]/g, 'e').replace(/ç/g, 'c').replace(/ß/g, 'ss')
const norm = (s: string) =>
  deUml((s || '').toLowerCase()).replace(/\b(gmbh|ag|sagl|sa|srl)\b/g, '').replace(/[^a-z0-9]/g, '')

const clean = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '—' || s === '-' ? '' : s
}

const mockByCompany = new Map<string, Record<string, unknown>>()
for (const m of mockLeads) mockByCompany.set(norm(String(m.company)), m)

// mockup field -> our schema field (text only)
const MAP: Record<string, string> = {
  contact: 'contact_name',
  email: 'email',
  phone: 'phone',
  comment: 'notes',
  note: 'next_action_label',
  due: 'next_action_date',
  tag: 'tags',
  city: 'address_ort',
}

const APPLY = process.argv.includes('--apply')

async function main() {
  const rows = readSheet()
  const changes: string[] = []

  for (const p of rows) {
    const m = mockByCompany.get(norm(p.company))
    if (!m) continue
    for (const [mockField, dbField] of Object.entries(MAP)) {
      const val = clean(m[mockField])
      if (!val) continue
      const cur = (p as unknown as Record<string, unknown>)[dbField]
      if (cur === '' || cur === null || cur === undefined) {
        ;(p as unknown as Record<string, unknown>)[dbField] = val
        changes.push(`${p.id}  ${p.company.padEnd(28)}  ${dbField.padEnd(18)} <- ${val.slice(0, 50)}`)
      }
    }
  }

  console.log(changes.join('\n') || '(no empty matching fields)')
  console.log(`\n${changes.length} fields ${APPLY ? 'FILLED' : 'would be filled (dry-run; pass --apply to write)'}`)
  if (APPLY) await writeSheet(rows)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
