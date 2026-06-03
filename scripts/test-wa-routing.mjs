// ============================================================================
// scripts/test-wa-routing.mjs — e2e test for WhatsApp inbound routing
// WP-CRM-F19 (Ralph 2026-05-24)
//
// Run:  node scripts/test-wa-routing.mjs
//
// Prerequisites:
//   - Oskar dev server running (http://localhost:3000)
//   - Filomax Wolf prospect (P021) exists in prospects.xlsx with
//     phone "+41 78 749 52 00"
//
// What it does: builds synthetic Baileys-shaped messages and runs them
// through the exact routing function the bridge uses, then verifies the
// CRM activity log got the rows it should have got. Bridge doesn't need
// to be running — this tests the routing implementation directly.
// ============================================================================

import { dispatchInboundMessage } from '../lib/wa-routing.mjs'

const OSKAR = 'http://127.0.0.1:3000'
const FILOMAX_PHONE = '41787495200'   // P021 in CRM
const STRANGER_PHONE = '491701234999'  // not in CRM

const logger = (level, msg) => console.log(`  [${level}] ${msg}`)
const dedup = new Set()

let passed = 0
let failed = 0
const failures = []

function ok(name, cond, detail = '') {
    if (cond) {
        console.log(`✓ ${name}`)
        passed++
    } else {
        console.log(`✗ ${name}  ${detail}`)
        failed++
        failures.push(name)
    }
}

async function fetchActivities(prospectId) {
    const res = await fetch(`${OSKAR}/api/admin/crm/activities?prospect_id=${prospectId}`)
    if (!res.ok) throw new Error(`activities fetch failed: ${res.status}`)
    const data = await res.json()
    return data.activities ?? []
}

async function findActivityByWaId(prospectId, waId) {
    const acts = await fetchActivities(prospectId)
    return acts.find(a => a.wa_message_id === waId) ?? null
}

function makeMessage({ jid, senderPn, text, id, fromMe = false }) {
    return {
        key: {
            remoteJid: jid,
            ...(senderPn ? { senderPn } : {}),
            fromMe,
            id: id || `TEST_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        },
        message: text ? { conversation: text } : undefined,
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName: 'E2E Test',
    }
}

// ─── Test cases ─────────────────────────────────────────────────────────────

console.log('\n=== WhatsApp inbound routing · e2e ===\n')
console.log(`Oskar base URL: ${OSKAR}`)
console.log(`Target prospect: P021 (Filomax Wolf, ${FILOMAX_PHONE})\n`)

// 1. Standard @s.whatsapp.net inbound from a matched prospect.
{
    console.log('--- Test 1: @s.whatsapp.net direct from matched prospect ---')
    const waId = `E2E_DIRECT_${Date.now()}`
    const m = makeMessage({
        jid: `${FILOMAX_PHONE}@s.whatsapp.net`,
        text: 'E2E test 1 — standard @s.whatsapp.net route',
        id: waId,
    })
    const result = await dispatchInboundMessage(m, { oskarUrl: OSKAR, logger, dedup })
    ok('outcome=matched',     result.outcome === 'matched',  `(got ${result.outcome})`)
    ok('prospect=P021',       result.prospect_id === 'P021', `(got ${result.prospect_id})`)
    const row = await findActivityByWaId('P021', waId)
    ok('activity row exists', !!row)
    ok('row type=WhatsApp In', row?.type === 'WhatsApp In', `(got ${row?.type})`)
    ok('row body matches',    row?.notes?.includes('E2E test 1'), '')
    console.log()
}

// 2. LID-routed inbound — primary remoteJid is @lid, real phone in senderPn.
//    This is the case that was being silently dropped before today's fix.
{
    console.log('--- Test 2: @lid routed (LID is the bug we fixed) ---')
    const waId = `E2E_LID_${Date.now()}`
    const m = makeMessage({
        jid: '126139246858419:45@lid',
        senderPn: `${FILOMAX_PHONE}@s.whatsapp.net`,
        text: 'E2E test 2 — LID routed message',
        id: waId,
    })
    const result = await dispatchInboundMessage(m, { oskarUrl: OSKAR, logger, dedup })
    ok('outcome=matched (LID resolved via senderPn)', result.outcome === 'matched', `(got ${result.outcome})`)
    ok('phone resolved to digits',                    result.phone === FILOMAX_PHONE, `(got ${result.phone})`)
    const row = await findActivityByWaId('P021', waId)
    ok('activity row exists', !!row)
    ok('row notes match',     row?.notes?.includes('E2E test 2'), '')
    console.log()
}

// 3. fromMe=true should be skipped (it's our own outbound; tracked separately).
{
    console.log('--- Test 3: fromMe=true should skip ---')
    const m = makeMessage({
        jid: `${FILOMAX_PHONE}@s.whatsapp.net`,
        text: 'should never appear in CRM',
        id: `E2E_FROMME_${Date.now()}`,
        fromMe: true,
    })
    const result = await dispatchInboundMessage(m, { oskarUrl: OSKAR, logger, dedup })
    ok('outcome=skipped', result.outcome === 'skipped', `(got ${result.outcome})`)
    ok('reason mentions fromMe', (result.reason || '').includes('fromMe'), `(got reason=${result.reason})`)
    console.log()
}

// 4. Group message (@g.us) should be skipped.
{
    console.log('--- Test 4: group message (@g.us) should skip ---')
    const m = makeMessage({
        jid: '123456789@g.us',
        senderPn: `${FILOMAX_PHONE}@s.whatsapp.net`,
        text: 'group chatter',
        id: `E2E_GROUP_${Date.now()}`,
    })
    const result = await dispatchInboundMessage(m, { oskarUrl: OSKAR, logger, dedup })
    ok('outcome=skipped', result.outcome === 'skipped', `(got ${result.outcome})`)
    ok('reason mentions group', (result.reason || '').includes('group'), `(got reason=${result.reason})`)
    console.log()
}

// 5. Empty message (e.g. protocol-message system event) should be skipped.
// Bypass makeMessage's `||` fallback by constructing manually.
{
    console.log('--- Test 5: empty content + no wa_message_id should skip ---')
    const m = {
        key: { remoteJid: `${FILOMAX_PHONE}@s.whatsapp.net`, fromMe: false, id: '' },
        message: undefined,
        messageTimestamp: Math.floor(Date.now() / 1000),
    }
    const result = await dispatchInboundMessage(m, { oskarUrl: OSKAR, logger, dedup })
    ok('outcome=skipped', result.outcome === 'skipped', `(got ${result.outcome})`)
    console.log()
}

// 6. Phone not in CRM should land in unmatched.jsonl (outcome='unmatched').
{
    console.log('--- Test 6: phone not in CRM → unmatched ---')
    const m = makeMessage({
        jid: `${STRANGER_PHONE}@s.whatsapp.net`,
        text: 'message from stranger',
        id: `E2E_UNMATCHED_${Date.now()}`,
    })
    const result = await dispatchInboundMessage(m, { oskarUrl: OSKAR, logger, dedup })
    ok('outcome=unmatched', result.outcome === 'unmatched', `(got ${result.outcome})`)
    ok('phone propagated',  result.phone === STRANGER_PHONE, `(got ${result.phone})`)
    console.log()
}

// 7a. Media path threaded through end-to-end. The bridge downloads media
//     before calling dispatchInboundMessage and passes the saved
//     mediaPath + mediaMime. wa-inbound persists them on the activity row.
{
    console.log('--- Test 7a: media_path + media_mime persisted on the row ---')
    const waId = `E2E_MEDIA_${Date.now()}`
    const m = {
        key: { remoteJid: `${FILOMAX_PHONE}@s.whatsapp.net`, fromMe: false, id: waId },
        message: { imageMessage: { caption: 'check out this photo', mimetype: 'image/jpeg' } },
        messageTimestamp: Math.floor(Date.now() / 1000),
    }
    const result = await dispatchInboundMessage(m, {
        oskarUrl: OSKAR, logger, dedup,
        mediaPath: '/_whatsapp/media/2026-05-24/test-photo.jpg',
        mediaMime: 'image/jpeg',
    })
    ok('outcome=matched',         result.outcome === 'matched', `(got ${result.outcome})`)
    const row = await findActivityByWaId('P021', waId)
    ok('activity row exists',     !!row)
    ok('media_path persisted',    row?.media_path === '/_whatsapp/media/2026-05-24/test-photo.jpg', `(got ${row?.media_path})`)
    ok('media_mime persisted',    row?.media_mime === 'image/jpeg', `(got ${row?.media_mime})`)
    ok('caption persisted as notes', (row?.notes || '').includes('check out this photo'), `(got "${row?.notes}")`)
    console.log()
}

// 7a.2 Plain documentMessage (PDF without caption wrapper).
{
    console.log('--- Test 7a.2: plain documentMessage (PDF) ---')
    const waId = `E2E_DOC_${Date.now()}`
    const m = {
        key: { remoteJid: `${FILOMAX_PHONE}@s.whatsapp.net`, fromMe: false, id: waId },
        message: { documentMessage: { mimetype: 'application/pdf', fileName: 'contract.pdf' } },
        messageTimestamp: Math.floor(Date.now() / 1000),
    }
    // Verify detection at the helper level
    const { mediaInfoFromMessage } = await import('../lib/wa-routing.mjs')
    const info = mediaInfoFromMessage(m)
    ok('detected as document', info?.kind === 'document', `(got ${info?.kind})`)
    ok('mime=application/pdf',  info?.mime === 'application/pdf', `(got ${info?.mime})`)
    ok('fileName extracted',    info?.fileName === 'contract.pdf', `(got ${info?.fileName})`)
    // End-to-end persistence
    const result = await dispatchInboundMessage(m, {
        oskarUrl: OSKAR, logger, dedup,
        mediaPath: '/_whatsapp/media/2026-05-24/contract.pdf',
        mediaMime: 'application/pdf',
    })
    ok('outcome=matched',       result.outcome === 'matched', `(got ${result.outcome})`)
    const row = await findActivityByWaId('P021', waId)
    ok('media_path persisted',  row?.media_path === '/_whatsapp/media/2026-05-24/contract.pdf')
    ok('media_mime persisted',  row?.media_mime === 'application/pdf')
    console.log()
}

// 7a.3 documentWithCaptionMessage envelope (iOS WhatsApp wraps documents
//      in this when they have a caption). Without unwrapping, the inner
//      documentMessage is invisible to the bridge → media is lost.
{
    console.log('--- Test 7a.3: documentWithCaptionMessage envelope (iOS shape) ---')
    const { mediaInfoFromMessage, textFromMessage } = await import('../lib/wa-routing.mjs')
    const m = {
        key: { remoteJid: `${FILOMAX_PHONE}@s.whatsapp.net`, fromMe: false, id: `E2E_DOCWRAP_${Date.now()}` },
        message: {
            documentWithCaptionMessage: {
                message: {
                    documentMessage: {
                        mimetype: 'application/pdf',
                        fileName: 'invoice-2026.pdf',
                        caption: 'Hier ist die Rechnung',
                    },
                },
            },
        },
    }
    const info = mediaInfoFromMessage(m)
    ok('unwrap detects document', info?.kind === 'document', `(got ${info?.kind})`)
    ok('unwrap finds mime',       info?.mime === 'application/pdf', `(got ${info?.mime})`)
    ok('unwrap finds fileName',   info?.fileName === 'invoice-2026.pdf', `(got ${info?.fileName})`)
    ok('unwrap finds caption text', textFromMessage(m) === 'Hier ist die Rechnung', `(got "${textFromMessage(m)}")`)
    console.log()
}

// 7a.4 viewOnceMessage envelope (disappearing-media wrapper).
{
    console.log('--- Test 7a.4: viewOnceMessage envelope (disappearing media) ---')
    const { mediaInfoFromMessage } = await import('../lib/wa-routing.mjs')
    const m = {
        key: { remoteJid: `${FILOMAX_PHONE}@s.whatsapp.net`, fromMe: false, id: `E2E_VIEWONCE_${Date.now()}` },
        message: {
            viewOnceMessage: {
                message: {
                    imageMessage: { mimetype: 'image/jpeg', caption: 'view-once snap' },
                },
            },
        },
    }
    const info = mediaInfoFromMessage(m)
    ok('viewOnce unwrap → image', info?.kind === 'image', `(got ${info?.kind})`)
    ok('viewOnce mime',           info?.mime === 'image/jpeg', `(got ${info?.mime})`)
    console.log()
}

// 7b. The actual Baileys 6.17 shape: messages.upsert delivers @lid in
//     remoteJid with NO senderPn on the key. The phone has to be resolved
//     via the lidLookup function the bridge populates from CB:message raw
//     frames. This is the exact scenario that was failing on Ralph's
//     bridge — Baileys logs the @lid as remoteJid, strips sender_pn from
//     the upsert payload, and my handler couldn't recover the phone
//     without this lookup.
{
    console.log('--- Test 7b: @lid via lidLookup (real Baileys 6.17 shape) ---')
    const waId = `E2E_LIDLOOKUP_${Date.now()}`
    const m = {
        // EXACTLY mimic the key Baileys 6.17 delivers — no senderPn here.
        key: { remoteJid: '126139246858419@lid', fromMe: false, id: waId },
        message: { conversation: 'E2E test 7b — LID via runtime lookup' },
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName: 'Filomax LID test',
    }
    const lookup = (jid) => {
        // Simulate the lidPhoneMap populated by the bridge's CB:message tap.
        if (jid === '126139246858419@lid') return `${FILOMAX_PHONE}@s.whatsapp.net`
        return undefined
    }
    const result = await dispatchInboundMessage(m, {
        oskarUrl: OSKAR, logger, dedup, lidLookup: lookup,
    })
    ok('outcome=matched',            result.outcome === 'matched',        `(got ${result.outcome})`)
    ok('phone resolved via lookup',  result.phone === FILOMAX_PHONE,      `(got ${result.phone})`)
    const row = await findActivityByWaId('P021', waId)
    ok('activity row exists',        !!row)
    console.log()
}

// 8. Same wa_message_id replayed → dedup (no second activity row).
{
    console.log('--- Test 7: dedup on replayed wa_message_id ---')
    const waId = `E2E_DEDUP_${Date.now()}`
    const m = makeMessage({
        jid: `${FILOMAX_PHONE}@s.whatsapp.net`,
        text: 'replay-once message',
        id: waId,
    })
    const r1 = await dispatchInboundMessage(m, { oskarUrl: OSKAR, logger, dedup })
    const r2 = await dispatchInboundMessage(m, { oskarUrl: OSKAR, logger, dedup })
    ok('1st = matched',  r1.outcome === 'matched',  `(got ${r1.outcome})`)
    ok('2nd = deduped',  r2.outcome === 'deduped',  `(got ${r2.outcome})`)
    const rows = (await fetchActivities('P021')).filter(a => a.wa_message_id === waId)
    ok('exactly 1 row on disk', rows.length === 1, `(got ${rows.length})`)
    console.log()
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n=== Summary ===')
console.log(`✓ ${passed} passed`)
console.log(`✗ ${failed} failed`)
if (failed) {
    console.log('\nFailures:')
    failures.forEach(f => console.log(`  - ${f}`))
}
process.exit(failed ? 1 : 0)
