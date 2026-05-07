// Manual one-shot WebDev trigger for session 2026-01-27-31, vibes 20-23.
//
// Why this exists: chat-stream's `## BUILD:` regex only fires after a CD turn
// closes. CD's turn from 15:30:28 (Order 66 reply) is still open because CD
// keeps tool-calling (Write VIBE-N.md, sequentially). Until the turn closes,
// no build trigger can fire. This script bypasses chat-stream and calls the
// same runWebDev() function the trigger would have called.
//
// Sequential, sonnet-4-6, cli mode — same combo that built vibes 1-7 cleanly
// today. Only targets 20-23 (lore-anchored post-Order-66 specs); 24-30 are
// still rot specs CD will rewrite.
//
// Run: cd oskar-prototype && npx tsx scripts/_manual_build_vibes_20_23.ts

import { runWebDev } from '@/lib/run-webdev'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'

const SESSION_ID = '2026-01-27-31'
const SESSION_PATH = path.join(process.cwd(), 'public', SESSION_ID)
const BUILD_MD = path.join(SESSION_PATH, 'BUILD.md')
const TARGETS = ['vibe-20', 'vibe-21', 'vibe-22', 'vibe-23']

async function appendBuildLog(line: string) {
  try {
    const cur = await readFile(BUILD_MD, 'utf-8').catch(() => '# Build Log\n')
    await writeFile(BUILD_MD, cur + line)
  } catch (e) {
    console.error('BUILD.md append failed:', e)
  }
}

async function main() {
  console.log(`[manual] starting sequential build for ${TARGETS.join(', ')}`)
  console.log(`[manual] session: ${SESSION_PATH}`)
  console.log(`[manual] mode: cli, model: claude-sonnet-4-6`)
  console.log('---')

  for (const target of TARGETS) {
    const startISO = new Date().toISOString()
    console.log(`\n[manual] ${startISO}  start ${target}`)
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
      console.log(`[manual] ${endISO}  ✅ ${target} -> ${result.filename}`)
      await appendBuildLog(`**Result:** COMPLETE -> ${result.filename}\n`)
    } else {
      console.log(`[manual] ${endISO}  ❌ ${target} FAILED: ${result.error}`)
      await appendBuildLog(`**Result:** FAILED -- ${result.error}\n`)
    }
  }

  console.log('\n[manual] all targets done')
}

main().catch((err) => {
  console.error('[manual] fatal:', err)
  process.exit(1)
})
