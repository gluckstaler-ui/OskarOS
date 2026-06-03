/**
 * scripts/sage-sunday-cron.ts — the AUTONOMOUS Sage Sunday entrypoint.
 *
 * This is what the crontab runs at Monday 02:00. It needs NO server: it loads
 * Sage in-process and drives the sweep directly. Self-contained on purpose —
 * a cron job that depends on a running dev server isn't a cron job.
 *
 * The crontab supplies the two things cron's bare environment lacks:
 *   - .env.local  → via `tsx --env-file=.env.local` (CLAUDE_CODE_OAUTH_TOKEN, so
 *                   `claude --print` authenticates exactly like the dev server).
 *   - PATH        → so `claude` and `node` resolve. Point it at wherever claude
 *                   lives on the host (macOS: /opt/homebrew/bin; Linux: usually
 *                   /usr/local/bin or your npm-global / nvm bin).
 *
 * Crontab line (Monday 02:00, full Portrait + 240/40) — set the cd path + PATH
 * for the host. The `command -v claude` form auto-derives the bin dir (WP-40):
 *   0 2 * * 1 cd /path/to/oskar-prototype && \
 *     PATH="$(dirname "$(command -v claude)"):/usr/local/bin:/usr/bin:/bin" \
 *     node_modules/.bin/tsx --env-file=.env.local scripts/sage-sunday-cron.ts \
 *     >> logs/sage-sunday.log 2>&1
 *
 * --skip-portrait → 240/40 only (testing). The weekly cron omits it (runs both).
 */

import { runSageSweep } from '@/lib/memory/sage-sweep'

async function main() {
  const skipPortrait = process.argv.includes('--skip-portrait')
  const header = `=== sage-sunday ${new Date().toISOString()} (${skipPortrait ? '240-only' : 'full'}) ===`
  console.log(header)

  const result = await runSageSweep({ skipPortrait })

  const ok = result.results.filter((r) => r.ok).length
  const cut = result.results.filter((r) => r.cutTriggered).length
  const failed = result.results.filter((r) => !r.ok)
  console.log(
    `[sage-sunday] candidates=${result.candidates} processed=${result.processed} ` +
      `ok=${ok} cut=${cut} failed=${failed.length} ` +
      `skippedActive=[${result.skippedActive.join(', ')}]`,
  )
  if (failed.length) {
    for (const f of failed) console.log(`[sage-sunday]   FAIL ${f.session}: ${f.error}`)
  }

  // Non-zero exit if any session errored, so cron's log makes failures obvious.
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error('[sage-sunday] fatal:', e)
  process.exit(1)
})
