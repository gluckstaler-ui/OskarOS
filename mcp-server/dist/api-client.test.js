/**
 * Tests for mcp-server/api-client.ts (Ralph 2026-05-04).
 *
 * The original bug: a route returning empty body + non-OK status caused
 * `parsed = undefined`, `JSON.stringify(undefined) = undefined`, and
 * `bodyStr.slice(0, 240)` then crashed with `Cannot read properties of
 * undefined (reading 'slice')`. This test locks in Commit A's defensive
 * fallback so the regression can't come back silently.
 *
 * Surfaced most often via the screenshot tool (Playwright timeouts ->
 * empty 500 from the route). Same crash bit any tool whose route
 * failed badly. The patch in api-client.ts:142 catches all of them.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { postJson } from './api-client.js';
describe('postJson — empty-body 500 defensive handling', () => {
    let originalFetch;
    beforeEach(() => {
        originalFetch = global.fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
    });
    it('returns mcp_server_error with <no body> sentinel when route returns empty 500', async () => {
        global.fetch = vi.fn(async () => new Response('', { status: 500 }));
        const r = await postJson('/api/mcp/screenshot', { sessionId: 'x' });
        expect(r.ok).toBe(false);
        expect(r.status).toBe(500);
        expect(r.mcpError?.code).toBe('mcp_server_error');
        // Defensive fallback: when JSON.stringify(undefined) returns undefined,
        // we substitute '<no body>' so the .slice() call below survives.
        expect(r.mcpError?.detail || r.error || '').toContain('<no body>');
    });
    it('returns mcp_not_found for 404 (specific 4xx subclass)', async () => {
        global.fetch = vi.fn(async () => new Response('', { status: 404 }));
        const r = await postJson('/api/mcp/whatever', {});
        expect(r.ok).toBe(false);
        expect(r.status).toBe(404);
        // 404 is classified more specifically than the generic mcp_route_error.
        expect(r.mcpError?.code).toBe('mcp_not_found');
    });
    it('returns mcp_route_error for 403 (generic 4xx)', async () => {
        global.fetch = vi.fn(async () => new Response('', { status: 403 }));
        const r = await postJson('/api/mcp/x', {});
        expect(r.ok).toBe(false);
        expect(r.status).toBe(403);
        expect(r.mcpError?.code).toBe('mcp_route_error');
    });
    it('returns mcp_validation_error for 400 with empty body', async () => {
        global.fetch = vi.fn(async () => new Response('', { status: 400 }));
        const r = await postJson('/api/mcp/x', {});
        expect(r.ok).toBe(false);
        expect(r.status).toBe(400);
        expect(r.mcpError?.code).toBe('mcp_validation_error');
    });
    it('does not crash when JSON.stringify(parsed) returns undefined', async () => {
        // The exact precondition for the original bug: parsed === undefined +
        // bodyStr = JSON.stringify(undefined) = undefined (the value, not "undefined").
        global.fetch = vi.fn(async () => new Response('', { status: 502 }));
        // Should not throw "Cannot read properties of undefined (reading 'slice')"
        await expect(postJson('/api/mcp/screenshot', {})).resolves.toBeDefined();
    });
    it('preserves the body when the route returns proper JSON 500', async () => {
        global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'Playwright timeout' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        }));
        const r = await postJson('/api/mcp/screenshot', {});
        expect(r.ok).toBe(false);
        expect(r.body?.error).toBe('Playwright timeout');
        expect(r.mcpError?.detail).toContain('Playwright timeout');
    });
    it('returns mcp_unavailable when fetch itself throws', async () => {
        global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
        const r = await postJson('/api/mcp/x', {});
        expect(r.ok).toBe(false);
        expect(r.status).toBe(0);
        expect(r.mcpError?.code).toBe('mcp_unavailable');
        expect(r.mcpError?.detail).toContain('ECONNREFUSED');
    });
});
//# sourceMappingURL=api-client.test.js.map