import path from 'path'

// The CRM Consular's "session" is the db/ root, not public/{id}/ — per §16.1
// its portrait + log live at db/user.md + db/SESSION.md. This sentinel id lets
// the existing session-id-based Sage (runSagePortrait / runSage240_40) operate
// on db/ unchanged: WP-114's path-parameterization, done in one place. Real
// session ids are `YYYY-MM-DD-(n)` or named; none start with `__`, so no
// collision with a live session.
export const CRM_SESSION_ID = '__crm__'

// Session base path — matches existing getSessionPath() in session.ts
export function getSessionDir(sessionId: string): string {
  if (sessionId === CRM_SESSION_ID) return path.join(process.cwd(), 'db')
  return path.join(process.cwd(), 'public', sessionId)
}

export function getLogsDir(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'logs')
}

// Lumberjack's cleaned output — Lumberjack writes, Sage reads, CD agent reads
export function getSessionMdPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'SESSION.md')
}

// Long-term memory — dreamer writes, CD agent reads
// Per-session: one user per session, one user.md per session.
export function getUserMemoryPath(sessionId: string): string {
  return path.join(getSessionDir(sessionId), 'user.md')
}

// CRM Flight Deck — the Consular writes its curated picks here as JSON; the
// consular chat route reads it after each turn and returns it to the live React
// <FlightDeck> panel. File-as-API: no MCP tool, no iframe — the same direct
// pattern as SESSION.md. Under db/ (private), not public/.
export function getCrmDeckPath(): string {
  return path.join(getSessionDir(CRM_SESSION_ID), 'flight-deck.json')
}

// Raw monthly log — app writes, lumberjack tails
export function getRawLogPath(sessionId: string): string {
  const now = new Date()
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  return path.join(getLogsDir(sessionId), `SESSION-${month}.md`)
}

export function getDreamLogPath(sessionId: string): string {
  return path.join(getLogsDir(sessionId), '.last-dream-log.md')
}

// Templates are in ./templates.ts — import from there for seeds
