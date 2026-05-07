// Retry chain for vibes 35, 36, 37 — these failed with CLI exit 1 / zero tokens
// at ~14:50 UTC during the original chain 4 run. Cause: Anthropic session/quota
// limit hit. After Ralph cleared his session, retry these from scratch.

import { runWebDev } from '@/lib/run-webdev'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'

const SESSION_ID = '2026-01-27-31'
const SESSION_PATH = path.join(process.cwd(), 'public', SESSION_ID)
const BUILD_MD = path.join(SESSION_PATH, 'BUILD.md')
const TARGETS = ['vibe-35', 'vibe-36', 'vibe-37']

async function appendBuildLog(line: string) {
  try {
    const cur = await readFile(BUILD_MD, 'utf-8').catch(() => '# Build Log\n')
    await writeFile(BUILD_MD, cur + line)
  } catch (e) {
    console.error('BUILD.md append failed:', e)
  }
}

async function main() {
  console.log(`[retry-35-37] starting sequential build for ${TARGETS.join(', ')}`)
  console.log(`[retry-35-37] session: ${SESSION_PATH}`)
  console.log(`[retry-35-37] mode: cli, model: claude-sonnet-4-6`)
  console.log('---')

  for (const target of TARGETS) {
    const startISO = new Date().toISOString()
    console.log(`\n[retry-35-37] ${startISO}  start ${target}`)
    await appendBuildLog(
      `\n## [${startISO}] BUILD: target="${target}" (manual retry)\n` +
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
      console.log(`[retry-35-37] ${endISO}  ✅ ${target} -> ${result.filename}`)
      await appendBuildLog(`**Result:** COMPLETE -> ${result.filename}\n`)
    } else {
      console.log(`[retry-35-37] ${endISO}  ❌ ${target} FAILED: ${result.error}`)
      await appendBuildLog(`**Result:** FAILED -- ${result.error}\n`)
    }
  }

  console.log('\n[retry-35-37] all targets done')
}

main().catch((err) => {
  console.error('[retry-35-37] fatal:', err)
  process.exit(1)
})
