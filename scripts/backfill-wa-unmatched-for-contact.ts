// ============================================================================
// scripts/backfill-wa-unmatched-for-contact.ts
//
// Ralph 2026-05-31 · One-off: catch up unmatched WhatsApp messages onto an
// EXISTING contact's prospect timeline. The same logic now runs automatically
// on POST /api/admin/crm/prospects/[id]/contacts (Marin-Tomasic regression
// fix), but this script handles contacts that were created BEFORE the auto-
// hook landed.
//
// Usage:
//   npx tsx scripts/backfill-wa-unmatched-for-contact.ts <prospect_id> <phone>
//   npx tsx scripts/backfill-wa-unmatched-for-contact.ts P032 "+41 79 953 14 72"
//
// Safe to re-run: appendActivity dedupes on (wa_message_id, prospect_id), and
// the buffer is rewritten only after successful activity inserts.
// ============================================================================

import { promoteUnmatchedForPhone } from '../lib/wa-inbound-dispatch'

const [, , prospectId, phone] = process.argv
if (!prospectId || !phone) {
  console.error('usage: tsx scripts/backfill-wa-unmatched-for-contact.ts <prospect_id> <phone>')
  process.exit(2)
}

// tsx in this project compiles to CJS → no top-level await; wrap.
;(async () => {
  const result = await promoteUnmatchedForPhone(phone, prospectId)
  console.log(JSON.stringify(result, null, 2))
  if (result.promoted === 0) {
    console.log('(no unmatched messages matched this phone — nothing to backfill)')
  }
})().catch(err => {
  console.error('[backfill] failed:', err)
  process.exit(1)
})
