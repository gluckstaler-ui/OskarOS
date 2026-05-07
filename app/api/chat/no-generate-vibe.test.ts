/**
 * Regression test: `generate_vibe` is dead (Ralph 2026-05-04).
 *
 * The tool was deleted in Commit C — it was confusing CD (sometimes she'd
 * pick generate_vibe, get the placeholder string, and never reach the
 * actual MCP build path). The real path is `build_vibe` / `build_all_vibes`
 * / `build_final` via MCP.
 *
 * This test asserts the tool name is gone from the route's source. Adding
 * it back without spec approval fails the test loud.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Resolve the route file relative to THIS test file, not process.cwd().
// vitest's cwd varies depending on how the suite is invoked (project
// root vs monorepo root); the test file's location is always stable.
const ROUTE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'route.ts')

describe('generate_vibe deletion (Commit C)', () => {
  it('app/api/chat/route.ts does not define generate_vibe in the TOOLS array', () => {
    const src = readFileSync(ROUTE_PATH, 'utf-8')
    // Match a tool definition object: `name: "generate_vibe"`. Comments
    // mentioning generate_vibe (e.g. "// generate_vibe was removed") are
    // permitted — those are intentional historical context.
    const defPattern = /name:\s*['"]generate_vibe['"]/
    expect(src).not.toMatch(defPattern)
  })

  it('app/api/chat/route.ts does not have a generate_vibe dispatcher case', () => {
    const src = readFileSync(ROUTE_PATH, 'utf-8')
    // Match `block.name === 'generate_vibe'` — the dispatcher condition
    // we removed. If this regex hits, the deleted code came back.
    const dispatcherPattern = /block\.name\s*===\s*['"]generate_vibe['"]/
    expect(src).not.toMatch(dispatcherPattern)
  })
})
