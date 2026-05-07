/**
 * /api/mcp/lint-brand — Phase 2 Tier A (2026-04-30).
 *
 * Lints a vibe HTML file for the v1 rule set defined in
 * lib/brand-lint-rules.ts. Two rules in v1; expanding requires updating
 * the v1-scope assertion test (lib/__tests__/brand-lint-scope.test.ts).
 */

import { NextResponse } from 'next/server'
import { join } from 'path'
import { existsSync } from 'fs'
import { lintHtmlFile } from '@/lib/brand-lint-rules'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const sessionId = String(body.sessionId || '').trim()
  const file = String(body.file || '').trim()
  if (!sessionId || !file) {
    return NextResponse.json({ error: 'sessionId + file required' }, { status: 400 })
  }
  if (!/\.html?$/i.test(file)) {
    return NextResponse.json({ error: 'file must be .html' }, { status: 400 })
  }

  const sessionDir = join(process.cwd(), 'public', sessionId)
  const abs = join(sessionDir, file)
  if (!existsSync(abs)) {
    return NextResponse.json({ error: `file not found: ${file}` }, { status: 404 })
  }

  try {
    const result = await lintHtmlFile(abs)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: `lint failed: ${(err as Error).message}` },
      { status: 500 },
    )
  }
}
