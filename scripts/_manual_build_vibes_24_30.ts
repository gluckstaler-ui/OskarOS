// Manual one-shot WebDev trigger for session 2026-01-27-31, vibes 24-30.
//
// CD finished rewriting these post-Order-66 (lore-anchored). Same code path as
// the chat-stream `## BUILD:` would take if it ever fired. Sequential within
// this script; runs in parallel with _manual_build_vibes_20_23.ts (one other
// active chain).

import { runWebDev } from '@/lib/run-webdev'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'

const SESSION_ID = '2026-01-27-31'
const SESSION_PATH = path.join(process.cwd(), 'public', SESSION_ID)
const BUILD_MD = path.join(SESSION_PATH, 'BUILD.md')
const TARGETS = ['vibe-24', 'vibe-25', 'vibe-26', 'vibe-27', 'vibe-28', 'vibe-29', 'vibe-30']

async function appendBuildLog(line: string) {
  try {
    const cur = await readFile(BUILD_MD, 'utf-8').catch(() => '# Build Log\n')
    await writeFile(BUILD_MD, cur + line)
  } catch (e) {
    console.error('BUILD.md append failed:', e)
  }
}

async function main() {
  console.log(`[manual-2] starting sequential build for ${TARGETS.join(', ')}`)
  console.log(`[manual-2] session: ${SESSION_PATH}`)
  console.log(`[manual-2] mode: cli, model: claude-sonnet-4-6`)
  console.log('---')

  for (const target of TARGETS) {
    const startISO = new Date().toISOString()
    console.log(`\n[manual-2] ${startISO}  start ${target}`)
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
      console.log(`[manual-2] ${endISO}  ✅ ${target} -> ${result.filename}`)
      await appendBuildLog(`**Result:** COMPLETE -> ${result.filename}\n`)
    } else {
      console.log(`[manual-2] ${endISO}  ❌ ${target} FAILED: ${result.error}`)
      await appendBuildLog(`**Result:** FAILED -- ${result.error}\n`)
    }
  }

  console.log('\n[manual-2] all targets done')
}

main().catch((err) => {
  console.error('[manual-2] fatal:', err)
  process.exit(1)
})
