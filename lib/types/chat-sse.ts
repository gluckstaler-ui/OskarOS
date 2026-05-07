/**
 * Typed SSE contract for the OskarOS chat surface.
 *
 * Source: external/open-design/packages/contracts/src/sse/{common.ts, chat.ts}
 * Ported 2026-05-02 (FEATURE-X §1.4 WP-2.1, Phase 2 Commit A foundation).
 *
 * Why this exists
 * ---------------
 * The chat-stream endpoint (`/api/chat-stream`) emits a sequence of typed
 * SSE frames as the CD agent streams stream-json. Today consumers parse those
 * frames inline with ad-hoc string checks. This file gives the channel a
 * single discriminated union (`ChatSseEvent`) so producers and consumers can
 * agree on shape — and so the SSE frame parser (WP-2.2), the `<question-form>`
 * parser (WP-2.4), the AssistantMessage scaffold (WP-2.5), and the e2e mocks
 * (WP-3.3) all key off the same types.
 *
 * Two layers
 * ----------
 * 1. **Daemon-tier** — `start | agent | stdout | stderr | error | end`. These
 *    mirror OD's chat protocol and carry the agent stream verbatim. Inlined
 *    from OD with minimal adaptation (SseErrorPayload moved into this file
 *    so the contract is self-contained — no upstream `errors.ts` dependency).
 *
 * 2. **OskarOS-domain-tier** — `vibe_built | image_ready | director_save`
 *    (and a handful of peers). These are the same event-kinds emitted by
 *    `lib/event-bus.ts` over `/api/events`. Adding them here lets the chat
 *    SSE surface OPTIONALLY carry them (e.g. when CD is reading-back what
 *    happened mid-stream) without consumers having to multiplex two
 *    transports. Producers may still publish exclusively via event-bus; the
 *    chat-stream contract is the union that captures both worlds.
 *
 * Design rationale
 * ----------------
 * - Self-contained: no imports from OD, no imports from `lib/event-bus.ts`.
 *   The event-kind list is intentionally re-stated as string literals so the
 *   typed contract drift from event-bus's `SessionEventKind` is explicit and
 *   visible. (Per CD's review pass: avoid silent coupling between transports.)
 * - Discriminated by `event` field. Narrow with `if (frame.event === 'agent')`.
 * - `DaemonAgentPayload` is the inner stream-json union (text_delta,
 *   thinking_delta, tool_use, tool_result, usage, raw, status). All currently
 *   used by `app/api/chat-stream/route.ts`.
 */

/* ────────────────────────────────────────────────────────────────────────── *
 *   Errors                                                                   *
 * ────────────────────────────────────────────────────────────────────────── */

export const API_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'VALIDATION_FAILED',
  'AGENT_UNAVAILABLE',
  'AGENT_EXECUTION_FAILED',
  'PROJECT_NOT_FOUND',
  'FILE_NOT_FOUND',
  'ARTIFACT_NOT_FOUND',
  'UPSTREAM_UNAVAILABLE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
  retryable?: boolean;
  requestId?: string;
  taskId?: string;
}

export interface SseErrorPayload {
  message: string;
  error?: ApiError;
}

/* ────────────────────────────────────────────────────────────────────────── *
 *   Generic SSE transport envelope                                           *
 * ────────────────────────────────────────────────────────────────────────── */

export interface SseTransportEvent<Name extends string, Payload> {
  id?: string;
  event: Name;
  data: Payload;
}

export type SseEventName<Event> = Event extends SseTransportEvent<infer Name, unknown> ? Name : never;

export type SseEventPayload<Event, Name extends string> = Event extends SseTransportEvent<Name, infer Payload>
  ? Payload
  : never;

/* ────────────────────────────────────────────────────────────────────────── *
 *   Chat SSE — daemon-tier (verbatim port from OD)                           *
 * ────────────────────────────────────────────────────────────────────────── */

export const CHAT_SSE_PROTOCOL_VERSION = 1;

export interface ChatSseStartPayload {
  runId?: string;
  agentId?: string;
  bin: string;
  protocolVersion?: typeof CHAT_SSE_PROTOCOL_VERSION;
  /** Legacy daemon-internal absolute cwd. Kept for compatibility during W2 adoption. */
  cwd?: string | null;
  projectId?: string | null;
  model?: string | null;
  reasoning?: string | null;
}

export interface ChatSseChunkPayload {
  chunk: string;
}

export interface ChatSseEndPayload {
  code: number | null;
  signal?: string | null;
  status?: 'succeeded' | 'failed' | 'canceled';
}

export type DaemonAgentPayload =
  | { type: 'status'; label: string; model?: string; ttftMs?: number; detail?: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'usage'; usage?: { input_tokens?: number; output_tokens?: number }; costUsd?: number; durationMs?: number }
  | { type: 'raw'; line: string };

/* ────────────────────────────────────────────────────────────────────────── *
 *   Chat SSE — OskarOS-domain-tier                                           *
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The OskarOS-specific event kinds that may ride over the chat SSE channel.
 *
 * These mirror — but don't import — `SessionEventKind` from `lib/event-bus.ts`.
 * Re-stating the strings is deliberate (CD's review pass): if event-bus adds
 * a kind, this list does NOT silently grow. Adding a chat-side kind requires
 * an explicit edit here, which surfaces in code review.
 */
export type OskarChatEventKind =
  | 'vibe_built'
  | 'vibe_failed'
  | 'image_ready'
  | 'image_failed'
  | 'hotswap_complete'
  | 'hotswap_failed'
  | 'assets_updated'
  | 'build_started'
  | 'build_failed'
  | 'cd_snackbar'
  | 'cd_ask_user'
  | 'director_save'
  | 'agent_inbox_message';

export interface OskarChatEventPayload {
  kind: OskarChatEventKind;
  /** ISO timestamp — same shape as `SessionEvent.ts`. */
  ts: string;
  /** Severity hint for snackbar/inline banner rendering. */
  level?: 'info' | 'warn' | 'error';
  /** Free-form, kind-specific. Producers may attach `vibe`, `slot`, `filename`, `target`, etc. */
  [key: string]: unknown;
}

/* ────────────────────────────────────────────────────────────────────────── *
 *   Chat SSE — full discriminated union                                      *
 * ────────────────────────────────────────────────────────────────────────── */

export type ChatSseEvent =
  | SseTransportEvent<'start', ChatSseStartPayload>
  | SseTransportEvent<'agent', DaemonAgentPayload>
  | SseTransportEvent<'stdout', ChatSseChunkPayload>
  | SseTransportEvent<'stderr', ChatSseChunkPayload>
  | SseTransportEvent<'error', SseErrorPayload>
  | SseTransportEvent<'end', ChatSseEndPayload>
  // OskarOS extensions — optional carriage of session-event-bus kinds
  | SseTransportEvent<'oskar', OskarChatEventPayload>;

/* ────────────────────────────────────────────────────────────────────────── *
 *   Type guards (cheap, exhaustive)                                          *
 * ────────────────────────────────────────────────────────────────────────── */

export function isChatSseEvent(value: unknown): value is ChatSseEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as { event?: unknown; data?: unknown };
  if (typeof v.event !== 'string') return false;
  if (v.data === undefined) return false;
  return (
    v.event === 'start' ||
    v.event === 'agent' ||
    v.event === 'stdout' ||
    v.event === 'stderr' ||
    v.event === 'error' ||
    v.event === 'end' ||
    v.event === 'oskar'
  );
}

export function isAgentFrame(
  frame: ChatSseEvent
): frame is SseTransportEvent<'agent', DaemonAgentPayload> {
  return frame.event === 'agent';
}

export function isOskarFrame(
  frame: ChatSseEvent
): frame is SseTransportEvent<'oskar', OskarChatEventPayload> {
  return frame.event === 'oskar';
}
