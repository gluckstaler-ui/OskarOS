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
 */
export function loadDreamerAgentFile(): string {
  return loadAgentPrompt('dreamer-agent-production.md')
}

// ─────────────────────────────────────────────────────────────────────────────
// Lumberjack — 7 stage prompts loaded from agents/lumberjack-stages/.
//
// Previously these were inline string literals in lib/memory/lumberjack.ts.
// Editing lumberjack-padawan.md did NOTHING because the agent didn't load it.
// Now Lumberjack matches the same load-from-disk pattern as Dreamer + CD,
// so iteration on prompts is just edit-the-.md.
// ─────────────────────────────────────────────────────────────────────────────

export type LumberjackStageId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'LEDGER'

const LUMBERJACK_STAGE_FILES: Record<LumberjackStageId, string> = {
  P1: 'lumberjack-stages/P1-boot-sequences.md',
  P2: 'lumberjack-stages/P2-fix-blocks.md',
  P3: 'lumberjack-stages/P3-navigation-chains.md',
  P4: 'lumberjack-stages/P4-agent-monologue.md',
  P5: 'lumberjack-stages/P5-rate-limits.md',
  P6: 'lumberjack-stages/P6-image-flow.md',
  LEDGER: 'lumberjack-stages/LEDGER-ledger.md',
}

/**
 * Load a single Lumberjack stage prompt with template substitution.
 *
 * Template variables (resolved here):
 *   {{sessionPath}}      — absolute path to the session's SESSION.md
 *   {{readInstructions}} — the shared read-instructions block (loaded from
 *                          lumberjack-stages/_read-instructions.md, with
 *                          its own {{sessionPath}} resolved)
 *
 * Editing any stage's .md changes its prompt on the next agent call.
 * No rebuild needed.
 */
export function loadLumberjackStage(
  stageId: LumberjackStageId,
  sessionPath: string,
): string {
  const stageRaw = loadAgentPrompt(LUMBERJACK_STAGE_FILES[stageId])
  const readRaw = loadAgentPrompt('lumberjack-stages/_read-instructions.md')
  const readInstructions = readRaw.replaceAll('{{sessionPath}}', sessionPath)
  return stageRaw
    .replaceAll('{{readInstructions}}', readInstructions)
    .replaceAll('{{sessionPath}}', sessionPath)
}
