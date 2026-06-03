#!/usr/bin/env node
// ============================================================================
// scripts/migrate-whatsapp-state.mjs — relocate WhatsApp protocol state
// WP-CRM-F20 (Ralph 2026-05-25)
//
// Moves the WhatsApp Multi-Device protocol state OUT of public/ (where it
// was statically served by Next.js at HTTPS URLs) and into db/whatsapp/
// (gitignored, never served).
//
// SOURCE                                 → DEST
// public/_whatsapp/auth/                 → db/whatsapp/auth/
// public/_whatsapp/messages/             → db/whatsapp/messages/
// public/_whatsapp/unmatched.jsonl       → db/whatsapp/unmatched.jsonl
//
// After running this, public/_whatsapp/ contains only `media/` (which the
// content-hash migration handles separately) plus .DS_Store. The caller
// removes the whole public/_whatsapp/ directory after BOTH migrations succeed.
//
// Idempotent: if the destination already exists, the source is skipped
// with a warning. Re-running is safe.
// ============================================================================

import { existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const moves = [
  { from: 'public/_whatsapp/auth',           to: 'db/whatsapp/auth' },
  { from: 'public/_whatsapp/messages',       to: 'db/whatsapp/messages' },
  { from: 'public/_whatsapp/unmatched.jsonl', to: 'db/whatsapp/unmatched.jsonl' },
]

let moved = 0
let skipped = 0

for (const { from, to } of moves) {
  const src = join(ROOT, from)
  const dst = join(ROOT, to)
  if (!existsSync(src)) {
    console.log(`  [skip] ${from} — source does not exist`)
    skipped++
    continue
  }
  if (existsSync(dst)) {
    console.log(`  [skip] ${from} → ${to} — destination already exists`)
    skipped++
    continue
  }
  mkdirSync(dirname(dst), { recursive: true })
  renameSync(src, dst)
  const kind = statSync(dst).isDirectory() ? 'dir' : 'file'
  console.log(`  [moved] ${from} → ${to} (${kind})`)
  moved++
}

console.log(`\n[migrate-whatsapp-state] done — moved=${moved}, skipped=${skipped}`)
