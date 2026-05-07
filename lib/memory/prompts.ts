import { readFileSync } from 'fs'
import path from 'path'

function loadAgentPrompt(filename: string): string {
  const mdPath = path.join(process.cwd(), 'agents', filename)
  return readFileSync(mdPath, 'utf-8')
}

/**
 * Load the full production dreamer agent file as the prompt.
 * The dreamer is a complete, self-contained agent — identity, dark side,
 * philosophy, instructions. Do NOT extract a subsection.
 * The model needs its full soul to paint portraits.
 *
 * 2026-04-21: preferred callers should use loadSagePortrait() or
 * loadSage240_40(). This full file is kept for backward compat — order65,
 * order66, and the legacy runDreamer() path still load it. New code should
 * pick a variant.
 */
export function loadDreamerAgentFile(): string {
  return loadAgentPrompt('dreamer-agent-production.md')
}

/**
 * Load the Sage — Portrait agent file.
 *
 * 2026-04-21: split out of dreamer-agent-production.md. This variant owns
 * Jobs 1–3: painting user.md, writing the triage log, and (rarely)
 * appending to CD-MEMORY.md. It does NOT run the 240/40 SESSION.md
 * compression rule — that job belongs to the sibling Sage variant
 * (`loadSage240_40`). The two agents have disjoint file-write domains so
 * they can run in parallel without contention.
 */
export function loadSagePortrait(): string {
  return loadAgentPrompt('sage-portrait.md')
}

/**
 * Load the Sage — 240/40 agent file.
 *
 * 2026-04-21: split out of dreamer-agent-production.md. This variant owns
 * Job 4 only: SESSION.md compression via the 240/40 rule. On wake it
 * checks whether SESSION.md exceeds 240 kb and, if so, folds two ~20 kb
 * resolved-dialogue blocks into bulleted LEDGER narratives. It does NOT
 * touch user.md or CD-MEMORY.md — that's the Portrait sibling's job.
 */
export function loadSage240_40(): string {
  return loadAgentPrompt('sage-240-40.md')
}

// ─────────────────────────────────────────────────────────────────────────────
// Lumberjack — single agent file.
//
// 2026-04-21: scrapped the 7-stage multi-call design. One CLI invocation,
// one agent file (`lumberjack-padawan.md`). The padawan spec IS the prompt
// — patterns P1–P6 + LEDGER live inside it, and the model runs them in
// sequence within a single conversation. Same pattern as Dreamer.
//
// The multi-stage approach tried to shard the work across 7 CLI subprocesses
// to constrain each one. It produced 3 MB log files (each Edit tool_result
// carries a 340 KB `originalFile` snapshot — 9 edits × 340 KB per stage),
// duplicated context across stages, and ate ~$1/stage. A single invocation
// with the full padawan.md is cheaper, simpler, and proven to work via
// `docs/debug-lumberjack.sh --single`.
//
// Stage files under `agents/lumberjack-stages/` are left on disk for
// reference but no code loads them anymore.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load the full lumberjack-padawan.md agent file as the prompt.
 * Same soul-loading pattern as `loadDreamerAgentFile()` — we pass the whole
 * agent file to the CLI as the system prompt so the model gets its full
 * identity, dark-side warnings, patterns, and execution order.
 */
export function loadLumberjackPadawan(): string {
  return loadAgentPrompt('lumberjack-padawan.md')
}
