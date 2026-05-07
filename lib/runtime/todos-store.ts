/**
 * lib/runtime/todos-store.ts — TodoWrite persistence layer (WP-66, 2026-05-06).
 *
 * Storage: a `## Todos` section in SESSION.md (sibling to `## Workflow State`).
 * No new file format. Reuses CD's existing checkbox idiom and SESSION.md's
 * existing read/write primitives. Sage's section walker picks it up via
 * `parseTodosSection` in lib/session.ts.
 *
 * Lifecycle:
 *   1. CD calls TodoWrite({todos: [...]})
 *   2. MCP route lands here → `writeTodos(sessionId, items)`
 *   3. Section body in SESSION.md is find-replaced (full replace, matching
 *      OD's TodoWrite semantics — incremental updates would race).
 *   4. `todos_updated` event fires on the bus.
 *   5. Frontend SSE listener re-reads via `readTodos(sessionId)` → re-renders.
 *
 * On agent respawn / dev reload / Order 66: the panel reads the section
 * from disk on mount. State survives because SESSION.md is already
 * persisted.
 *
 * Single-writer (CD). User-add flows through normal chat → CD encodes as a
 * TodoWrite call.
 */

import { promises as fs } from 'fs'
import path from 'path'
import type { TodoItem, TodoStatus } from '@/lib/types/todos'
import { parseTodosSection } from '@/lib/session'
import { publish } from '@/lib/event-bus'
import { DISCOVERY_TODOS_SEED } from '@/lib/runtime/discovery-seed'

const TODOS_SECTION_HEADING = '## Todos'

/**
 * Resolve session path. Mirrors `lib/session.ts` getSessionPath() — kept
 * private here so todos-store has no implicit dependency on session.ts's
 * non-exported helper.
 */
function getSessionPath(sessionId: string): string {
  return path.join(process.cwd(), 'public', sessionId)
}

async function readSessionMd(sessionId: string): Promise<string | null> {
  const filePath = path.join(getSessionPath(sessionId), 'SESSION.md')
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

async function writeSessionMd(sessionId: string, content: string): Promise<void> {
  const filePath = path.join(getSessionPath(sessionId), 'SESSION.md')
  await fs.writeFile(filePath, content)
}

/**
 * Read the current todo list from SESSION.md's `## Todos` section.
 * Returns [] if the file doesn't exist or the section is empty.
 *
 * Auto-backfills missing IDs (Ralph 2026-05-06: "trash icon grayed out
 * for old todos"). Items without an ID can't be targeted by
 * `deleteCompletedTodo`, so the panel disables the delete button. If
 * any item lacks an ID we round-trip through `writeTodos` once — that
 * generates IDs + persists them. Next read sees the IDs and skips the
 * backfill. One-time migration per session, idempotent thereafter.
 */
export async function readTodos(sessionId: string): Promise<TodoItem[]> {
  const md = await readSessionMd(sessionId)
  if (!md) return []
  const items = parseTodosSection(md)
  if (items.length === 0) return items
  const needsBackfill = items.some((t) => !t.id)
  if (needsBackfill) {
    return await writeTodos(sessionId, items)
  }
  return items
}

/**
 * Render a TodoItem[] back to the `## Todos` section body. Inverse of
 * `parseTodosSection` in lib/session.ts.
 *
 * Format (per WP-66 spec):
 *
 *   - [/] (id:abc) Build vibe-3
 *   - [ ] Review vibe-2 hero
 *   - [x] ~~Read FEATURE-X.md~~
 *
 * Status mapping: pending → `[ ]`, in_progress → `[/]`, completed → `[x]`.
 * Completed content is wrapped in `~~strikethrough~~` (cosmetic; the
 * checkbox glyph is the state-of-truth).
 *
 * Empty list renders as `*No todos yet*` so a fresh session is readable.
 */
export function renderTodosSection(items: TodoItem[]): string {
  if (items.length === 0) return '*No todos yet*'
  return items
    .map((it) => {
      const glyph: Record<TodoStatus, string> = { pending: ' ', in_progress: '/', completed: 'x' }
      const idPart = it.id ? `(id:${it.id}) ` : ''
      const content = it.status === 'completed' ? `~~${it.content}~~` : it.content
      return `- [${glyph[it.status]}] ${idPart}${content}`
    })
    .join('\n')
}

/**
 * Find-replace the `## Todos` section body in SESSION.md. Preserves the
 * heading line + the trailing `---` separator + everything outside the
 * section. If the section doesn't exist yet (older session created before
 * WP-66), inserts it just below `## Workflow State`'s separator.
 */
function spliceTodosSection(sessionMd: string, newBody: string): string {
  // Match: heading + body up to the next `## ` (any depth). Capture the
  // heading-and-newline as a separate group so we can keep it as-is.
  const sectionRe = /(## Todos\s*\n)([\s\S]*?)(?=\n##\s|$)/
  if (sectionRe.test(sessionMd)) {
    return sessionMd.replace(sectionRe, `$1${newBody}\n`)
  }
  // Section missing — insert after `## Workflow State` (preserve format).
  // The Workflow State block ends at its first `\n---` separator. We
  // append a freshly-formatted ## Todos section right after it.
  const insert = `\n## Todos\n${newBody}\n\n---\n`
  const wsBlock = sessionMd.match(/(## Workflow State[\s\S]*?\n---)/)
  if (wsBlock) {
    return sessionMd.replace(wsBlock[0], `${wsBlock[0]}${insert}`)
  }
  // Last-resort fallback: prepend the section. Ugly but recovers state.
  return `${insert}${sessionMd}`
}

/**
 * Generate a short stable ID for a todo missing one. Format: `t-XXXXXX`
 * where XXXXXX is base36-random. Stable across reads (we only generate
 * once at write-time; persisted ID survives subsequent rewrites).
 */
function generateTodoId(): string {
  return `t-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Write the full todo list to SESSION.md's `## Todos` section + emit
 * `todos_updated` on the bus. Full-list replace semantics (matches OD's
 * TodoWrite — incremental updates would race).
 *
 * Auto-fills missing IDs so every persisted todo has a stable handle for
 * deletion / hot-swap / future surgical edits.
 *
 * Returns the persisted item array (deduped + with default status filled
 * in) so the caller can reflect it back to the agent without a re-read.
 */
export async function writeTodos(sessionId: string, items: TodoItem[]): Promise<TodoItem[]> {
  const md = (await readSessionMd(sessionId)) ?? ''
  // Sanitize input — defensive against malformed `TodoWrite` calls.
  const sanitized: TodoItem[] = items
    .filter((it) => it && typeof it.content === 'string' && it.content.trim().length > 0)
    .map((it) => ({
      id: it.id?.trim() || generateTodoId(),
      content: it.content.trim(),
      activeForm: it.activeForm?.trim() || undefined,
      status:
        it.status === 'completed' || it.status === 'in_progress' ? it.status : 'pending',
    }))

  const body = renderTodosSection(sanitized)
  const next = spliceTodosSection(md, body)
  await writeSessionMd(sessionId, next)

  // Broadcast — LiveOverlay's SSE consumer picks this up + re-reads.
  publish(sessionId, { type: 'todos_updated', count: sanitized.length })

  return sanitized
}

/**
 * Delete a SINGLE todo by id, but only if it's `completed`. Scoped
 * exception to the single-writer rule (Ralph 2026-05-06):
 *
 *   - Active queue (pending + in_progress) = CD-only writes. The user
 *     cannot mutate live commitments — that would race CD's TodoWrite.
 *   - Completed items = history. Letting the user prune history doesn't
 *     race anything, and the trash-on-hover affordance keeps the panel
 *     clean as the queue grows.
 *
 * Refuses non-completed deletions with a typed error so the caller can
 * surface a clear reason. On success, full-list rewrite via writeTodos
 * fires `todos_updated` and the LiveOverlay refetches.
 */
export type DeleteTodoResult =
  | { ok: true; remaining: TodoItem[] }
  | { ok: false; reason: 'not_found' | 'not_completed' }

export async function deleteCompletedTodo(
  sessionId: string,
  todoId: string,
): Promise<DeleteTodoResult> {
  const current = await readTodos(sessionId)
  const target = current.find((t) => t.id === todoId)
  if (!target) return { ok: false, reason: 'not_found' }
  if (target.status !== 'completed') return { ok: false, reason: 'not_completed' }
  const next = current.filter((t) => t.id !== todoId)
  // writeTodos handles the splice + broadcast.
  const persisted = await writeTodos(sessionId, next)
  return { ok: true, remaining: persisted }
}

/**
 * Seed the canonical Phase 1 (Discovery) todo list if SESSION.md has no
 * `## Todos` section yet. Idempotent — checks for the literal heading,
 * not the parsed list (so a user-pruned-to-empty section doesn't trigger
 * re-seeding).
 *
 * Lives at the GET endpoint for `/api/sessions/[id]/todos` — first read
 * on a fresh session triggers the seed, subsequent reads no-op. Returns
 * `true` if the seed was written this call, `false` otherwise.
 *
 * Anchored in code (not the agent prompt) per Ralph 2026-05-06: the
 * discovery seed is structural, deterministic, and shouldn't burn an
 * agent turn on every new session. Source list: `discovery-seed.ts`.
 */
export async function seedDiscoveryTodosIfMissing(
  sessionId: string,
): Promise<boolean> {
  const md = await readSessionMd(sessionId)
  // No SESSION.md → nothing to splice into; let session-create flow build
  // the file first. Don't synthesize the file from todos-store.
  if (md === null) return false
  // Section already present (even if empty / user-pruned) → respect that
  // intentional state, no seeding.
  if (md.includes(TODOS_SECTION_HEADING)) return false
  // Fresh — seed it.
  await writeTodos(sessionId, DISCOVERY_TODOS_SEED.map((it) => ({ ...it })))
  return true
}
