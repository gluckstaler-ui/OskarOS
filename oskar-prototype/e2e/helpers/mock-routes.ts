/**
 * Playwright route-mocking helpers for OskarOS e2e flows.
 *
 * Source pattern: external/open-design/e2e/specs/app.spec.ts (~50 LOC extract)
 * Authored 2026-05-02 (FEATURE-X §1.4 WP-3.3, Phase 3 Commit B testing infra).
 *
 * Why this exists
 * ---------------
 * Real CD/WebDev/Sentinel runs spawn Claude CLI subprocesses, talk to Nano,
 * and write to disk. Deterministic e2e needs to swap those for typed mocks.
 * Per CD's WP-3.3 note: "mocks must accurately mirror real route shapes —
 * drift between mock and live API is the #1 e2e false-positive source.
 * Pin to typed contracts (WP-2.1) wherever possible."
 *
 * Strategy
 * --------
 * Every helper receives the Playwright `Page` and a small payload describing
 * what to return. They install `page.route(...)` handlers; the test calls
 * the helper before navigating, then drives the UI normally.
 *
 * Helpers reuse the typed SSE contract from `lib/types/chat-sse.ts` so a
 * mock's frame shape can't drift from the production parser without
 * surfacing a TypeScript error.
 */
import type { Page, Route } from '@playwright/test';
import type {
  ChatSseEvent,
  ChatSseStartPayload,
  ChatSseEndPayload,
  DaemonAgentPayload,
  OskarChatEventPayload,
} from '@/lib/types/chat-sse';

/**
 * Serialize a typed `ChatSseEvent` into an SSE wire frame.
 *
 * Each frame: `event: <name>\ndata: <json>\n\n`.
 * Pairs with the WP-2.2 parser; round-trips cleanly.
 */
export function frameSse(ev: ChatSseEvent): string {
  return `event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`;
}

/**
 * Build a deterministic chat-stream response body from a sequence of frames.
 *
 * Each frame ends with `\n\n` so the splitter sees a clean separator.
 * Final keep-alive comment forces the connection-close to be observable.
 */
export function buildChatStreamBody(frames: ChatSseEvent[]): string {
  return frames.map(frameSse).join('') + ':keepalive\n\n';
}

/**
 * Convenience builders for the most common frames in OskarOS e2e flows.
 */
export const sseFrames = {
  start(payload: ChatSseStartPayload): ChatSseEvent {
    return { event: 'start', data: payload };
  },
  textDelta(delta: string): ChatSseEvent {
    return { event: 'agent', data: { type: 'text_delta', delta } };
  },
  thinkingDelta(delta: string): ChatSseEvent {
    return { event: 'agent', data: { type: 'thinking_delta', delta } };
  },
  toolUse(input: { id: string; name: string; input: unknown }): ChatSseEvent {
    return {
      event: 'agent',
      data: {
        type: 'tool_use',
        id: input.id,
        name: input.name,
        input: input.input,
      } satisfies DaemonAgentPayload,
    };
  },
  toolResult(input: {
    toolUseId: string;
    content: string;
    isError?: boolean;
  }): ChatSseEvent {
    return {
      event: 'agent',
      data: {
        type: 'tool_result',
        toolUseId: input.toolUseId,
        content: input.content,
        ...(input.isError !== undefined ? { isError: input.isError } : {}),
      } satisfies DaemonAgentPayload,
    };
  },
  oskar(payload: OskarChatEventPayload): ChatSseEvent {
    return { event: 'oskar', data: payload };
  },
  end(payload: ChatSseEndPayload): ChatSseEvent {
    return { event: 'end', data: payload };
  },
} as const;

/* ────────────────────────────────────────────────────────────────────── *
 *   Route mockers                                                        *
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Mock the `/api/chat-stream` route with a deterministic frame sequence.
 *
 * Usage:
 *   await mockChatStreamRoute(page, [
 *     sseFrames.start({ bin: 'claude' }),
 *     sseFrames.textDelta('Hi there.'),
 *     sseFrames.toolUse({ id: 't1', name: 'TodoWrite', input: { todos: [...] } }),
 *     sseFrames.end({ code: 0, status: 'succeeded' }),
 *   ]);
 */
export async function mockChatStreamRoute(
  page: Page,
  frames: ChatSseEvent[],
): Promise<void> {
  await page.route('**/api/chat-stream**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
      },
      body: buildChatStreamBody(frames),
    });
  });
}

/**
 * Mock `/api/build-vibe` (and friends): typed ack of the build kick-off.
 */
export async function mockBuildVibeRoute(
  page: Page,
  payload: { jobId: string; vibe: string; status: 'queued' | 'running' },
): Promise<void> {
  await page.route('**/api/build-vibe**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

/**
 * Mock `/api/edit-image` (the Nano path) so generate_image tests stay fast.
 */
export async function mockGenerateImageRoute(
  page: Page,
  payload: {
    filename: string;
    savedPath: string;
    geminiText?: string;
  },
): Promise<void> {
  await page.route('**/api/edit-image**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
}

/**
 * Mock `/api/mcp/server` initialization handshake. Useful when a flow
 * needs the MCP transport to come up cleanly without a real server spawn.
 */
export async function mockMcpServerHandshake(
  page: Page,
  sessionId: string,
): Promise<void> {
  await page.route('**/api/mcp/server**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'mcp-session-id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: '2024-11-05', capabilities: {} },
      }),
    });
  });
}

/**
 * Seed localStorage before the page navigates. Used to skip onboarding,
 * pin a session id, set theme, etc.
 *
 * NOTE: page.addInitScript runs on EVERY frame in EVERY navigation; clear
 * with `page.context().clearCookies()` + `page.evaluate(() => localStorage.clear())`
 * between cases if you don't want bleed-through.
 */
export async function seedSessionLocalStorage(
  page: Page,
  entries: Record<string, string>,
): Promise<void> {
  await page.addInitScript((data: Record<string, string>) => {
    for (const [k, v] of Object.entries(data)) {
      try {
        window.localStorage.setItem(k, v);
      } catch {
        // ignore
      }
    }
  }, entries);
}

/**
 * Block all real network egress except a tight allowlist. Catches the
 * "I forgot to mock route X" failure-mode early with a clear log line
 * instead of a mysterious timeout.
 */
export async function blockUnmockedNetwork(
  page: Page,
  allow: RegExp[],
): Promise<void> {
  await page.route('**/*', async (route: Route) => {
    const url = route.request().url();
    if (allow.some((re) => re.test(url))) {
      await route.continue();
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(`[mock-routes] blocked unmocked request: ${url}`);
    await route.abort('blockedbyclient');
  });
}
