import { readFileSync } from 'fs'
import path from 'path'

function loadAgentPrompt(filename: string): string {
  const mdPath = path.join(process.cwd(), 'agents', filename)
  return readFileSync(mdPath, 'utf-8')
}

// Lumberjack no longer uses a single prompt template.
// It runs 7 separate stage calls with focused prompts built in lumberjack.ts.

/**
 * Load the full production dreamer agent file as the prompt.
 * The dreamer is a complete, self-contained agent — identity, dark side,
 * philosophy, instructions. Do NOT extract a subsection.
 * The model needs its full soul to paint portraits.
 */
export function loadDreamerAgentFile(): string {
  return loadAgentPrompt('dreamer-agent-production.md')
}
