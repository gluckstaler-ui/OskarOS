// ============================================================================
// instrumentation.ts — Next.js server-boot hook
// WP-CRM-F19 (Ralph 2026-05-25)
//
// Next.js calls this `register()` function exactly once when a new server
// instance starts (cold start, full restart). It is NOT called during hot
// module replacement, so the WhatsApp runtime singleton it boots survives
// every code edit in dev mode.
//
// We only boot the runtime in the Node.js server runtime (not Edge runtime),
// since Baileys requires Node's native modules (`fs`, `net`, etc).
//
// If saved creds exist, the runtime reconnects silently. If not, it stays
// idle until the user hits "Generate QR code" in Settings → WhatsApp.
// Either way, /api/admin/whatsapp/status starts returning meaningful data
// the moment the Next.js server is up — no second process to start.
// ============================================================================

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // Build phase: Next.js runs instrumentation during the production build
  // step too (e.g. for prerender data collection). We don't want to open a
  // WhatsApp socket while compiling — skip unless we're actually serving.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  // WP-CRM-F22 (2026-05-25): boot the CRM SQLite + event-log layer FIRST.
  // crm-boot opens db/crm.db, runs schema DDL, optionally bootstraps from
  // the legacy xlsx on first boot, and replays the event log to bring the
  // SQLite projection up to date. The WhatsApp runtime depends on it
  // (updateWaStatusByMessageId, appendActivity, etc. all read/write SQLite),
  // so the order matters.
  try {
    const { bootCrm } = await import('./lib/crm-boot')
    await bootCrm()
  } catch (err) {
    console.error('[instrumentation] crm-boot failed:', err)
  }

  try {
    const { getRuntime } = await import('./lib/wa-runtime')
    await getRuntime().boot()
  } catch (err) {
    console.error('[instrumentation] wa-runtime boot failed:', err)
  }
}
