// ============================================================================
// lib/capture-spawn.ts — captureUrl that runs in a CHILD process.
//
// The Next server must NOT import lib/screenshot directly: turbopack
// (externalImport) and webpack both throw `open EEXIST` loading puppeteer in the
// long-running server. A fresh node process loads it cleanly (proven on the box),
// so we spawn scripts/capture-worker.cjs and read back the result. Same signature
// as the original captureUrl → callers (taste/route.ts) are unchanged.
// ============================================================================
import { execFile } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ScoutCaptureCtx, CaptureResult } from './screenshot'

// re-export the types so callers import everything from here (NOT from screenshot,
// which would pull puppeteer back into the bundle). Type-only → erased at build.
export type { ScoutCaptureCtx, CaptureResult } from './screenshot'

const WORKER = join(process.cwd(), 'scripts', 'capture-worker.cjs')

export function captureUrl(rawUrl: string, ctx: ScoutCaptureCtx): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const resultPath = join(tmpdir(), `scout-capture-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    const env = {
      ...process.env,
      // Chrome's vendored .so live in ~/lib on the server; the Next process env
      // doesn't carry LD_LIBRARY_PATH, so set it for the worker. Harmless on macOS.
      LD_LIBRARY_PATH: [join(process.env.HOME || '', 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    }
    execFile(process.execPath, [WORKER, JSON.stringify({ rawUrl, ctx, resultPath })],
      { cwd: process.cwd(), env, timeout: 150_000, maxBuffer: 16 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        try {
          const data = readFileSync(resultPath, 'utf8')
          try { unlinkSync(resultPath) } catch { /* best-effort */ }
          resolve(JSON.parse(data) as CaptureResult)
        } catch {
          reject(new Error('capture-worker produced no result (' + (err ? err.message : 'exit') + '): ' + String(stderr || '').slice(-600)))
        }
      })
  })
}
