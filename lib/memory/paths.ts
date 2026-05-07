import path from 'path'

// Session base path — matches existing getSessionPath() in session.ts
export function getSessionDir(sessionId: string): string {
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
