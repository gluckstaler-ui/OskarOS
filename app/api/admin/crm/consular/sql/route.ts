// ============================================================================
// POST /api/admin/crm/consular/sql — WP-110 · the Consular's SQL tool route
//
// The MCP tool `crm_query` (mcp-server/tools-consular.ts) POSTs the agent's
// SQL here; this route runs lib/consular/sql-tool.ts against the live CRM DB
// (reads raw SELECT, writes through the event log) and returns the result.
//
// Status mapping (so the MCP api-client classifies correctly):
//   · 200 — read rows OR write applied
//   · 400 — seatbelt rejection (→ mcp_validation_error → agent fixes the SQL)
//   · 500 — internal failure
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { consularSql } from '@/lib/consular/sql-tool'

export async function POST(req: NextRequest) {
  let sql: unknown
  try {
    const body = await req.json()
    sql = body?.sql
  } catch {
    return NextResponse.json({ ok: false, kind: 'rejected', error: 'body must be JSON: { "sql": "…" }' }, { status: 400 })
  }
  if (typeof sql !== 'string' || !sql.trim()) {
    return NextResponse.json({ ok: false, kind: 'rejected', error: 'missing "sql" string' }, { status: 400 })
  }

  try {
    const result = await consularSql(sql)
    // A seatbelt rejection is a 400 so the agent reads it as "fix your args".
    const status = result.kind === 'rejected' ? 400 : 200
    return NextResponse.json(result, { status })
  } catch (err) {
    console.error('[consular/sql] internal failure:', err)
    return NextResponse.json(
      { ok: false, kind: 'rejected', error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
