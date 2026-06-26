// ============================================================================
// scripts/site-sync-harness.mjs — unit harness for Webserver Sync.
//
// Tests ONLY the logic OskarOS adds on top of node:fs / basic-ftp:
//   • compareManifests — the diff classifier (new / changed / unchanged, the
//     mtime tiebreak, pre-check, sort order)            — pure, hand-built maps
//   • makeIgnore       — hard-excludes + user patterns  — pure, predicate on paths
//   • isEssential      — the extension allowlist        — pure
//   • runSyncStream    — bytes land, per-file failure survives, one-sidecar
//     backup                                            — the REAL LocalTransport
//
// NO booted FTP server, NO credentials, NO site-specific host/path. A fake server
// passing proves only that the fake answers; testing through the real
// LocalTransport (two temp dirs) exercises the actual sync code instead.
//
// Node strips types from .ts on import but won't append `.ts` to the extensionless
// relative imports the source uses, so a tiny resolve hook does. Zero deps.
//   run:  node scripts/site-sync-harness.mjs
// ============================================================================
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import module from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = process.cwd()

// ── results ─────────────────────────────────────────────────────────────────
const results = []
const log = (pass, name, detail) => {
  results.push({ pass, name })
  console.log(`   ${pass ? '✔' : '✗ FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}
const section = (s) => console.log(`\n  ▸ ${s}`)

// ── load the real .ts source via an extensionless-resolve hook ──────────────
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) &&
        !/\.[mc]?[jt]s$|\.json$/.test(specifier) && context.parentURL) {
      const p = fileURLToPath(new URL(specifier, context.parentURL))
      if (fs.existsSync(p + '.ts')) return { url: pathToFileURL(p + '.ts').href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

// ── fixture helpers (generic — no real host / path / credential anywhere) ───
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sync-harness-${tag}-`))
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)
const seed = (root, files) => {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, body)
  }
}
const bytes = (n) => 'x'.repeat(n)               // file content of an exact size
const entry = (size, mtime) => ({ size, mtime }) // a ManifestEntry
const mfst = (obj) => new Map(Object.entries(obj))
const drain = async (stream) => {
  const reader = stream.getReader(), dec = new TextDecoder()
  let buf = ''
  for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }) }
  return buf.split('\n').filter(Boolean)
}

// ── modules under test ──────────────────────────────────────────────────────
const { compareManifests, makeIgnore } = await load('lib/site/compare.ts')
const { isEssential } = await load('lib/site/essential.ts')
const { LocalTransport } = await load('lib/site/local.ts')
const { runSyncStream } = await load('lib/sync/stream.ts')

console.log('\n══ SITE SYNC HARNESS ══')
try {
  // ── compareManifests — the diff classifier (pure: hand-built manifests) ────
  section('compare · new / changed(size) / changed(mtime) / unchanged · pre-check · sort')
  {
    // One base time; every fixture mtime is an offset of it (no magic absolutes).
    const T = 1_000_000, lastSync = T, before = T - 1, after = T + 1
    const source = mfst({
      'page.html': entry(4, before), // size differs from dest      → changed (essential)
      'add.html':  entry(3, before), // only on source              → new (essential)
      'style.css': entry(5, after),  // same size as dest, newer mtime → changed (essential)
      'notes.md':  entry(2, before), // only on source              → new (NON-essential)
      'same.js':   entry(5, before), // same size, mtime ≤ lastSync  → unchanged
    })
    const dest = mfst({
      'page.html': entry(2, before), // shorter than source
      'style.css': entry(5, before), // identical size to source
      'same.js':   entry(5, before), // identical
    })
    const rows = compareManifests({ source, dest, direction: 'up', lastSyncMs: lastSync })
    const by = Object.fromEntries(rows.map((r) => [r.path, r]))

    log(by['add.html']?.status === 'new', 'only-on-source → new', by['add.html']?.status)
    log(by['page.html']?.status === 'changed', 'size differs → changed', by['page.html']?.status)
    log(by['style.css']?.status === 'changed', 'same size but mtime newer than last sync → changed', by['style.css']?.status)
    log(!('same.js' in by), 'unchanged rows hidden by default')
    log(by['page.html']?.selected === true && by['add.html']?.selected === true, 'essential new/changed are pre-checked')
    log(by['notes.md']?.status === 'new' && by['notes.md']?.selected === false, 'non-essential new is present but not pre-checked')

    const order = rows.map((r) => r.path)
    const lastChangedEssential = Math.max(order.indexOf('page.html'), order.indexOf('style.css'))
    log(lastChangedEssential < order.indexOf('add.html') && order.indexOf('add.html') < order.indexOf('notes.md'),
      'sort: changed-essential < new-essential < new-non-essential', order.join(', '))
  }

  // ── makeIgnore — hard-excludes + user patterns (pure: predicate on paths) ──
  section('ignore · hard-excludes hold even when absent from site.ignore; user patterns; no prefix false-match')
  {
    const ignore = makeIgnore(['node_modules/', '*.tmp']) // user list does NOT contain logs/screenshots/config
    const excluded = ['logs/sync-log.md', 'screenshots/a.png', '_session-config.json', 'node_modules/x/y.js', 'draft.tmp']
    const kept = ['index.html', 'assets/app.css', 'logsheet.html'] // logsheet only PREFIX-matches "logs"
    log(excluded.every(ignore), 'logs/, screenshots/, _session-config.json + user node_modules/ & *.tmp all excluded',
      excluded.filter((p) => !ignore(p)).join(',') || 'all excluded')
    log(kept.every((p) => !ignore(p)), 'real files survive (incl. "logsheet.html", which must NOT match "logs")', kept.join(','))
  }

  // ── isEssential — the allowlist behavior (case-insensitive; unknown ext not) ──
  section('essential · extension allowlist, case-insensitive')
  log(isEssential('a/b/INDEX.HTML') && isEssential('x.CSS') && !isEssential('readme.md') && !isEssential('debug.log'),
    '.html/.css essential in any case; .md/.log not')

  // ── runSyncStream — bytes land · a bad file fails alone · one local sidecar ──
  section('sync · UP via the REAL LocalTransport: bytes land, missing file fails alone, backup is one local sidecar')
  {
    const localRoot = tmp('local')   // the session folder
    const remoteRoot = tmp('remote') // the "server" — a real fs dir, no network
    seed(remoteRoot, { 'page.html': bytes(9) })                  // prior remote copy → must be backed up on overwrite
    seed(localRoot, { 'page.html': bytes(4), 'app.js': bytes(7) }) // 'gone.css' is intentionally NOT seeded → it'll fail

    const transport = new LocalTransport(remoteRoot)
    await transport.connect()
    const lines = await drain(runSyncStream({
      sessionId: 'harness', direction: 'up', files: ['page.html', 'app.js', 'gone.css'],
      transport, localRoot, method: 'file', endpoint: 'local', docroot: remoteRoot,
    }))
    await transport.close()

    log(read(path.join(remoteRoot, 'page.html')) === bytes(4), 'page.html new bytes landed on the destination')
    log(read(path.join(remoteRoot, 'app.js')) === bytes(7), 'app.js bytes landed')
    log(lines.includes('SYNC_OK page.html') && lines.includes('SYNC_OK app.js'), 'SYNC_OK for the two good files')
    log(lines.some((l) => l.startsWith('SYNC_ERR gone.css')), 'the missing file gets its OWN SYNC_ERR', lines.find((l) => l.startsWith('SYNC_ERR')))
    log(lines.includes('SYNC_DONE ok=2 fail=1'), 'batch survived one failure (ok=2 fail=1)', lines.find((l) => l.startsWith('SYNC_DONE')))

    const sidecar = path.join(localRoot, 'logs', 'site-backups', 'page.html')
    log(read(sidecar) === bytes(9), 'overwriting page.html saved the prior REMOTE copy to a LOCAL sidecar', read(sidecar))
    log(!fs.existsSync(path.join(remoteRoot, 'page-bak.html')), 'NO server-side -bak written (backup is local-only)')
    log(!fs.existsSync(path.join(localRoot, 'logs', 'site-backups', 'app.js')), 'non-.html/.css (app.js) → no backup')
  }
} catch (fatal) {
  console.error('\n  ✗ FATAL:', fatal?.stack ?? fatal)
  results.push({ pass: false, name: 'harness ran without a fatal error' })
}

// ── tally ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass)
console.log(`\n  ${results.length - failed.length}/${results.length} green`)
if (failed.length) {
  console.log('  ✗ FAILURES:\n   - ' + failed.map((r) => r.name).join('\n   - '))
  process.exit(1)
}
console.log('  ALL GREEN ✔')
process.exit(0)
