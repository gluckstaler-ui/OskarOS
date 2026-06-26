// ============================================================================
// scripts/capture-worker-entry.ts — the Scout-capture worker.
//
// Runs captureUrl() in a FRESH node process. The long-running Next server CANNOT
// load puppeteer: turbopack compiles `import puppeteer` to an `externalImport`
// that throws `open EEXIST`, and webpack's external loader throws its own EEXIST.
// A fresh process loads puppeteer + sharp and writes files flawlessly (proven on
// the server box). So capture runs here, out of the bundler's reach.
//
// esbuild-bundled → scripts/capture-worker.cjs (puppeteer + sharp EXTERNAL, i.e.
// loaded via plain Node require at runtime). Invoked by lib/capture-spawn.ts with
// one JSON arg: { rawUrl, ctx, resultPath }. Writes the CaptureResult to
// resultPath; exits non-zero with the error on stderr if it throws.
// ============================================================================
import { writeFileSync } from 'node:fs'
import { captureUrl, type ScoutCaptureCtx } from '../lib/screenshot'

async function main() {
  const arg = process.argv[2]
  if (!arg) { process.stderr.write('capture-worker: missing payload arg\n'); process.exit(2) }
  const { rawUrl, ctx, resultPath } = JSON.parse(arg) as { rawUrl: string; ctx: ScoutCaptureCtx; resultPath: string }
  const result = await captureUrl(rawUrl, ctx)
  writeFileSync(resultPath, JSON.stringify(result))
}

main().catch((e) => {
  process.stderr.write('capture-worker fatal: ' + (e && e.stack ? e.stack : String(e)) + '\n')
  process.exit(1)
})
