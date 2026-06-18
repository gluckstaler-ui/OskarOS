// ============================================================================
// lib/process-scheduling.ts — cross-platform priority elevation
// (Ralph 2026-06-05)
//
// Goal — push every process we control to the highest scheduling priority
// the OS will grant us. Apple Silicon Macs, modern x86 desktops, and CI
// runners all expose more Performance cores than Efficiency cores; the
// scheduler will prefer P-cores when a process is marked HIGH priority and
// there's load to justify it. Higher priority = higher chance of P-core
// scheduling = faster scout captures, faster route handlers, faster
// everything.
//
// Why no platform branches
// ────────────────────────
// Node's `os.setPriority(pid, niceness)` is a thin wrapper over the right
// syscall per platform:
//   - Unix (macOS, Linux, BSD): setpriority(2). Maps nice in [-20, 19].
//   - Windows: SetPriorityClass via the niceness → priority-class table
//     defined in `os.constants.priority` (e.g. -20 → REALTIME_PRIORITY_CLASS).
// One call, same semantics, no shell-outs. No taskpolicy / renice / wmic
// wrappers anywhere. Mac is not hardwired — there is literally no Mac code.
//
// Privilege handling
// ──────────────────
// Lowering nice below 0 (i.e. raising priority above NORMAL) requires
// CAP_SYS_NICE on Linux and root on most BSDs. macOS is usually more
// permissive but still rejects some negative values for unprivileged
// users. We try the tiers in order from most-aggressive to fallback, and
// keep whichever first one the OS accepts. The cost of a rejected attempt
// is a thrown EACCES, which we swallow and move on.
//
// Idempotency
// ───────────
// `os.setPriority(0, n)` is cheap and safe to call repeatedly — the OS
// just sets the value. No globalThis flag needed; calling it twice with
// the same value is a no-op at the kernel level.
// ============================================================================

import { setPriority, constants } from 'os'

/**
 * Push the targeted process to the highest priority the OS will grant.
 * Default pid = 0 (current process).
 *
 * Tries PRIORITY_HIGHEST first, falls back through HIGH / ABOVE_NORMAL /
 * NORMAL if the OS rejects each tier on permission grounds. Returns the
 * niceness that was actually applied, or null if even NORMAL was rejected
 * (in practice impossible — setting to 0 always succeeds for your own pid).
 *
 * Non-fatal: a failure to elevate is logged but never thrown. Wrong
 * scheduling is a performance hit, not a bug.
 */
export function elevatePriority(pid: number = 0): number | null {
  // os.constants.priority values:
  //   PRIORITY_LOW           19   (most polite, E-core bias on macOS)
  //   PRIORITY_BELOW_NORMAL  10
  //   PRIORITY_NORMAL         0   (kernel default)
  //   PRIORITY_ABOVE_NORMAL  -7
  //   PRIORITY_HIGH         -14
  //   PRIORITY_HIGHEST      -20   (P-core bias on macOS, REALTIME on Windows)
  const tiers = [
    constants.priority.PRIORITY_HIGHEST,
    constants.priority.PRIORITY_HIGH,
    constants.priority.PRIORITY_ABOVE_NORMAL,
    constants.priority.PRIORITY_NORMAL,
  ]
  for (const tier of tiers) {
    try {
      setPriority(pid, tier)
      return tier
    } catch {
      // EACCES / EPERM — try a lower-aggression tier. Process not found
      // (ESRCH) is also possible if the child exited before we got here;
      // bail rather than thrash through all tiers in that case.
      // We don't import errno; the catch handles both uniformly.
    }
  }
  return null
}

/**
 * Convenience: elevate the current Node process. Called by instrumentation.ts
 * at server boot. Equivalent to `elevatePriority(0)` but with a logging
 * side-effect that names the pid + applied tier, so the boot log makes it
 * obvious that scheduling was tuned.
 */
export function elevateCurrentProcess(): void {
  const applied = elevatePriority(0)
  if (applied !== null) {
    console.log(`[scheduling] process pid ${process.pid} → nice ${applied} (highest the OS granted).`)
  } else {
    console.warn(`[scheduling] could not adjust priority for pid ${process.pid}; running at OS default.`)
  }
}
