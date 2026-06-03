// ⚠ RETIRED 2026-05-29 — this module is NO LONGER WIRED into mcp-server/tools.ts.
// The `crm_query` SQL MCP tool is disabled: a bridged agent already has shell +
// HTTP, so advertising a full-SQL MCP tool was a redundant, wider attack
// surface. The Consular reads/writes the CRM through the HTTP route instead:
// POST /api/admin/crm/consular/sql (event-logged). Kept for revival, not
// deleted — to bring it back, uncomment the wiring in tools.ts + the entry in
// lib/mcp-config.ts CONSULAR_ALLOWED_TOOLS.
/**
 * Consular-side MCP tools (WP-110, 2026-05-29).
 *
 * The Consular reaches the CRM through ONE tool — `crm_query` — with full
 * read + write authority. SQL, no narrower (agents/CONSULAR-agent.md §YOUR
 * TOOLS). This module is a thin client: it forwards the SQL to the Next.js
 * route `/api/admin/crm/consular/sql`, which runs lib/consular/sql-tool.ts
 * (raw SELECT for reads; event-logged crm-store writers for writes — never a
 * raw exec, so the log stays the source of truth and the change syncs).
 *
 * The seatbelts live server-side; this description tells the agent the
 * contract so it writes SQL that passes them on the first try.
 */
import { postJson } from './api-client.js';
export const CONSULAR_TOOL_DEFINITIONS = [
    {
        name: 'crm_query',
        description: 'Run ONE SQL statement against the CRM database — your single tool, full ' +
            'read and write authority.\n' +
            'READ: `SELECT explicit, columns FROM prospects WHERE …` — name the columns ' +
            'you need (no `SELECT *`). Tables: prospects, activities, contacts.\n' +
            'WRITE (routed through the event log so it survives reload + syncs):\n' +
            "  · move stage / write research fields → UPDATE prospects SET stage='Closing' WHERE id='P012'\n" +
            "  · log a note / lore → INSERT INTO activities (prospect_id, type, notes) VALUES ('P012','note','…')\n" +
            "  · edit a note → UPDATE activities SET notes='…' WHERE id='A042'\n" +
            'RULES (rejected otherwise): one statement per call — no multi-statement ' +
            'batches; no DDL (CREATE/ALTER/DROP) or PRAGMA/transaction control; no ' +
            '`SELECT *`; UPDATE/DELETE MUST have a WHERE that targets rows by id ' +
            "(`WHERE id='P012'` or `WHERE id IN ('P012','P013')`); values must be literals " +
            '(quote strings, escape an inner quote as \'\'), not SQL functions. Write atomically: ' +
            'one INSERT per note, one UPDATE per change.',
        inputSchema: {
            type: 'object',
            properties: {
                sql: {
                    type: 'string',
                    description: 'A single SQL statement. SELECT with explicit columns for reads; ' +
                        'UPDATE/INSERT/DELETE (with a WHERE id=… for UPDATE/DELETE) for writes.',
                },
            },
            required: ['sql'],
        },
    },
];
export async function callConsularTool(name, args, _ctx) {
    if (name !== 'crm_query') {
        return { text: `Unknown consular tool: ${name}`, isError: true };
    }
    const sql = typeof args.sql === 'string' ? args.sql : '';
    if (!sql.trim()) {
        return { text: 'Error: `sql` (a single SQL statement string) is required.', isError: true };
    }
    const r = await postJson('/api/admin/crm/consular/sql', { sql });
    // Non-2xx → r.ok false. A seatbelt rejection is a 400 (mcp_validation_error:
    // retry with corrected SQL); surface the reason verbatim so the agent fixes it.
    if (!r.ok) {
        const reason = r.body?.error || r.error || 'query failed';
        return { text: `crm_query rejected: ${reason}`, isError: true };
    }
    const body = r.body;
    if (!body)
        return { text: 'crm_query: empty response from route', isError: true };
    if (body.kind === 'read') {
        const rows = body.rows || [];
        return {
            text: `${rows.length} row(s):\n${JSON.stringify(rows, null, 1)}`,
            isError: false,
        };
    }
    // write
    const ids = body.affectedIds?.length ? ` [${body.affectedIds.join(', ')}]` : '';
    return {
        text: `${body.statementType || 'WRITE'} ok — ${body.changes ?? 0} row(s) changed${ids} (${body.ms ?? '?'}ms)`,
        isError: false,
    };
}
//# sourceMappingURL=tools-consular.js.map