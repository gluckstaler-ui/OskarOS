// Manual one-shot WebDev trigger for session 2026-01-27-31, vibes 31-33.
//
// Third parallel chain. Sequential within this script; runs in parallel with
// _manual_build_vibes_20_23.ts and _manual_build_vibes_24_30.ts.
//
// VIBE-34.md not on disk at launch time — Ralph will tell us when it appears
// or we trigger it separately.

import { runWebDev } from '@/lib/run-webdev'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'

const SESSION_ID = '2026-01-27-31'
const SESSION_PATH = path.join(process.cwd(), 'public', SESSION_ID)
const BUILD_MD = path.join(SESSION_PATH, 'BUILD.md')
const TARGETS = ['vibe-31', 'vibe-32', 'vibe-33']

async function appendBuildLog(line: string) {
  try {
    const cur = await readFile(BUILD_MD, 'utf-8').catch(() => '# Build Log\n')
    await writeFile(BUILD_MD, cur + line)
  } catch (e) {
    console.error('BUILD.md append failed:', e)
  }
}

async function main() {
  console.log(`[manual-3] starting sequential build for ${TARGETS.join(', ')}`)
  console.log(`[manual-3] session: ${SESSION_PATH}`)
  console.log(`[manual-3] mode: cli, model: claude-sonnet-4-6`)
  console.log('---')

  for (const target of TARGETS) {
    const startISO = new Date().toISOString()
    console.log(`\n[manual-3] ${startISO}  start ${target}`)
    await appendBuildLog(
      `\n## [${startISO}] BUILD: target="${target}" (manual trigger)\n` +
        `**Status:** BUILDING\n**Mode:** cli\n**Model:** claude-sonnet-4-6\n`,
    )

    const result = await runWebDev({
      mode: 'cli',
      model: 'claude-sonnet-4-6',
      sessionId: SESSION_ID,
      sessionPath: SESSION_PATH,
      target,
    })

    const endISO = new Date().toISOString()
    if (result.status === 'complete') {
      console.log(`[manual-3] ${endISO}  ✅ ${target} -> ${result.filename}`)
      await appendBuildLog(`**Result:** COMPLETE -> ${result.filename}\n`)
    } else {
      console.log(`[manual-3] ${endISO}  ❌ ${target} FAILED: ${result.error}`)
      await appendBuildLog(`**Result:** FAILED -- ${result.error}\n`)
    }
  }

  console.log('\n[manual-3] all targets done')
}

main().catch((err) => {
  console.error('[manual-3] fatal:', err)
  process.exit(1)
})
