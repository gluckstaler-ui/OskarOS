#!/usr/bin/env node
// ============================================================================
// scripts/test-wa-persistence.mjs — envelope persistence smoke test
// WP-CRM-F19 (Ralph 2026-05-25)
//
// The bridge persists every inbound WAMessage to disk so media can be
// re-downloaded later from WhatsApp's CDN. The risky bit is Buffer round-
// trip: per-message media keys live inside the envelope as Buffer fields,
// and Baileys's BufferJSON.replacer/reviver pair is what makes them
// survive JSON.stringify/parse.
//
// This script:
//   1. Builds a synthetic WAMessage shaped like a real image message
//      (mediaKey + fileEncSha256 + fileSha256 as Buffers).
//   2. Writes it through JSON.stringify(..., BufferJSON.replacer).
//   3. Reads it back through JSON.parse(..., BufferJSON.reviver).
//   4. Asserts every Buffer field equals the original byte-for-byte.
//
// If this passes, the persistent envelope store can recover media for any
// message inside WhatsApp's CDN retention window (~30 days).
// ============================================================================
import { BufferJSON } from '@whiskeysockets/baileys'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let passed = 0
let failed = 0

function ok(label, cond) {
    if (cond) { console.log(`✓ ${label}`); passed++ }
    else      { console.log(`✗ ${label}`); failed++ }
}

// ─── Test 1: in-memory round trip ──────────────────────────────────────────
console.log('\n--- Test 1: BufferJSON in-memory round trip ---')

const mediaKey = Buffer.from([0x01, 0x02, 0x03, 0xFF, 0xAB, 0xCD, 0xEF])
const fileSha = Buffer.alloc(32, 0x55)
const fileEncSha = Buffer.alloc(32, 0x77)

const original = {
    key: { id: 'TEST_ROUND_TRIP_1', remoteJid: '41787495200@s.whatsapp.net', fromMe: false },
    messageTimestamp: 1234567890,
    message: {
        imageMessage: {
            url: 'https://mmg.whatsapp.net/d/f/abc',
            mimetype: 'image/jpeg',
            fileSha256: fileSha,
            fileEncSha256: fileEncSha,
            mediaKey: mediaKey,
            fileLength: 12345,
            caption: 'hello'
        }
    }
}

const stringified = JSON.stringify(original, BufferJSON.replacer)
const restored = JSON.parse(stringified, BufferJSON.reviver)

ok('top-level fields survive',
    restored.key.id === 'TEST_ROUND_TRIP_1' &&
    restored.messageTimestamp === 1234567890)
ok('caption survives', restored.message.imageMessage.caption === 'hello')
ok('mediaKey is a Buffer after parse',  Buffer.isBuffer(restored.message.imageMessage.mediaKey))
ok('fileSha256 is a Buffer after parse', Buffer.isBuffer(restored.message.imageMessage.fileSha256))
ok('fileEncSha256 is a Buffer after parse', Buffer.isBuffer(restored.message.imageMessage.fileEncSha256))
ok('mediaKey bytes match', restored.message.imageMessage.mediaKey.equals(mediaKey))
ok('fileSha256 bytes match', restored.message.imageMessage.fileSha256.equals(fileSha))
ok('fileEncSha256 bytes match', restored.message.imageMessage.fileEncSha256.equals(fileEncSha))

// ─── Test 2: disk round trip ───────────────────────────────────────────────
console.log('\n--- Test 2: disk round trip (write → read) ---')

const tmpRoot = join(tmpdir(), 'wa-persistence-test-' + Date.now())
const day = '2026-05-25'
const dirAbs = join(tmpRoot, day)
mkdirSync(dirAbs, { recursive: true })
const fileAbs = join(dirAbs, 'TEST_ROUND_TRIP_1.json')

writeFileSync(fileAbs, JSON.stringify(original, BufferJSON.replacer, 2), 'utf-8')
ok('file written to disk', existsSync(fileAbs))

const raw = readFileSync(fileAbs, 'utf-8')
const fromDisk = JSON.parse(raw, BufferJSON.reviver)

ok('disk: mediaKey bytes intact', Buffer.isBuffer(fromDisk.message.imageMessage.mediaKey) &&
    fromDisk.message.imageMessage.mediaKey.equals(mediaKey))
ok('disk: fileSha256 bytes intact', fromDisk.message.imageMessage.fileSha256.equals(fileSha))
ok('disk: caption intact', fromDisk.message.imageMessage.caption === 'hello')

// Clean up
rmSync(tmpRoot, { recursive: true, force: true })

// ─── Summary ───────────────────────────────────────────────────────────────
console.log(`\n=== Summary ===`)
console.log(`✓ ${passed} passed`)
console.log(`✗ ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
