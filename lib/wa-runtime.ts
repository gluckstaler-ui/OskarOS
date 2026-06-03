// ============================================================================
// lib/wa-runtime.ts — WhatsApp Multi-Device runtime, embedded in Next.js
// WP-CRM-F19 (Ralph 2026-05-25)
//
// Replaces the standalone oskar-wa-bridge.mjs subprocess. The Baileys socket
// now lives as a singleton inside the Next.js server process, initialized
// via instrumentation.ts on server boot.
//
// Why merge: the previous architecture had two Node processes (Next.js +
// bridge) coupled via HTTP loopback. Every inbound message round-tripped
// `bridge → fetch(localhost:3000/api/...) → Next.js → Excel`. The HTTP layer
// added latency, a failure mode (one process up, other down), a dedup-lost-
// on-POST-failure race, and a security surface (open localhost endpoints
// for sending WhatsApp). All of that is gone now — the runtime calls
// crm-store functions directly.
//
// HMR safety: the singleton is parked on globalThis so module hot-reloads
// in dev don't tear down the live WhatsApp connection. Only a full Next.js
// server restart (Ctrl-C → npm run dev) re-creates it; saved creds make
// that a silent reconnect, not a re-pair.
// ============================================================================
import { join, dirname } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'fs'
import QRCode from 'qrcode'
import pino from 'pino'
import {
  // @ts-expect-error — Baileys ships .d.ts files but the default export
  // shape is awkward in strict TS. Runtime is fine.
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  BufferJSON,
  type WAMessage,
  type WASocket,
  type AuthenticationState,
} from '@whiskeysockets/baileys'
import {
  dispatchInboundMessage,
  lidBase,
  mediaInfoFromMessage,
  skipReason,
} from './wa-routing.mjs'
import { dispatchInboundToCrm, type InboundPayload } from './wa-inbound-dispatch'
import { updateWaStatusByMessageId } from './crm-store'

// ─── Paths ──────────────────────────────────────────────────────────────────
//
// Post WP-CRM-F20: all WhatsApp state lives at db/whatsapp/* (outside
// public/, never statically served). Media is content-hashed at media/
// (sibling of db/, also outside public/). Auth-gated /api/admin/media/[hash]
// route is the only way to fetch media from the UI.

const PROJECT_ROOT = process.cwd()
const AUTH_DIR     = join(PROJECT_ROOT, 'db', 'whatsapp', 'auth')
const META_PATH    = join(PROJECT_ROOT, 'db', 'whatsapp', 'auth', 'meta.json')
const MEDIA_DIR    = join(PROJECT_ROOT, 'media')                              // content-hashed, flat
const MESSAGES_DIR = join(PROJECT_ROOT, 'db', 'whatsapp', 'messages')
const MESSAGES_TTL_DAYS = 30

mkdirSync(AUTH_DIR, { recursive: true })

// ─── MIME → file extension ──────────────────────────────────────────────────
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
}
function extFromMime(mime: string | undefined): string | null {
  if (!mime) return null
  return MIME_EXT[mime] || MIME_EXT[mime.split(';')[0].trim()] || null
}
function extFromFilename(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string') return null
  const m = name.match(/\.([A-Za-z0-9]{2,5})$/)
  return m ? m[1].toLowerCase() : null
}
function safeWaId(id: string | undefined | null): string {
  return String(id ?? '').replace(/[^A-Za-z0-9_.-]/g, '_')
}

// ─── Status types ───────────────────────────────────────────────────────────
export type ConnState = 'idle' | 'pairing' | 'connected' | 'error'

export type RuntimeStatusPayload =
  | { status: 'installed-not-paired' }
  | { status: 'pairing'; qr: string }
  | {
      status: 'connected'
      phone: string
      deviceId: string
      linkedSince: string | null
      lastActivityAt: string | null
      inboundToday: number
      outboundToday: number
    }
  | { status: 'error'; reason: string; logs: string[] }

// ─── The runtime ────────────────────────────────────────────────────────────
class WaRuntime {
  private sock: WASocket | null = null
  private latestQr: string | null = null
  private latestQrDataUrl: string | null = null
  private connState: ConnState = 'idle'
  private lastError: string | null = null
  private recentLogs: string[] = []
  private dedupSet: Set<string> = new Set()
  private lidPhoneMap: Map<string, string> = new Map()
  private starting: Promise<void> | null = null   // ensures concurrent start() calls coalesce
  private booted = false

  private logger = pino({ level: process.env.OSKAR_WA_DEBUG ? 'debug' : 'warn' })

  // ─── Logging ──────────────────────────────────────────────────────────
  private pushLog(level: string, msg: string) {
    const entry = `[${new Date().toISOString().slice(11, 19)}] ${level.toUpperCase()} ${msg}`
    this.recentLogs.push(entry)
    if (this.recentLogs.length > 100) this.recentLogs.shift()
    // In dev we also dump to stdout so the npm-run-dev terminal shows it.
    console.log(`[wa-runtime] ${entry}`)
  }

  getLogs(): string[] {
    return this.recentLogs.slice(-100)
  }

  // ─── Meta (linked-since / counters) ───────────────────────────────────
  private readMeta(): Record<string, unknown> {
    if (!existsSync(META_PATH)) return {}
    try { return JSON.parse(readFileSync(META_PATH, 'utf-8')) } catch { return {} }
  }
  private writeMeta(patch: Record<string, unknown>) {
    const current = this.readMeta()
    const merged = { ...current, ...patch }
    mkdirSync(dirname(META_PATH), { recursive: true })
    writeFileSync(META_PATH, JSON.stringify(merged, null, 2), 'utf-8')
  }

  // ─── Envelope persistence (BufferJSON round-trip) ─────────────────────
  private persistMessage(m: WAMessage) {
    try {
      const waId = m?.key?.id
      if (!waId) return
      const safeId = safeWaId(waId)
      const day = new Date().toISOString().slice(0, 10)
      const dirAbs = join(MESSAGES_DIR, day)
      const fileAbs = join(dirAbs, `${safeId}.json`)
      if (existsSync(fileAbs)) return
      mkdirSync(dirAbs, { recursive: true })
      writeFileSync(fileAbs, JSON.stringify(m, BufferJSON.replacer, 2), 'utf-8')
    } catch (err) {
      this.pushLog('warn', `persistMessage(${m?.key?.id ?? '?'}) failed: ${String((err as Error)?.message ?? err)}`)
    }
  }

  private loadPersistedMessage(waId: string): WAMessage | null {
    try {
      if (!existsSync(MESSAGES_DIR)) return null
      const safeId = safeWaId(waId)
      const dates = readdirSync(MESSAGES_DIR).sort().reverse()
      for (const day of dates) {
        const fileAbs = join(MESSAGES_DIR, day, `${safeId}.json`)
        if (existsSync(fileAbs)) {
          const raw = readFileSync(fileAbs, 'utf-8')
          return JSON.parse(raw, BufferJSON.reviver) as WAMessage
        }
      }
    } catch (err) {
      this.pushLog('warn', `loadPersistedMessage(${waId}) failed: ${String((err as Error)?.message ?? err)}`)
    }
    return null
  }

  private pruneOldMessages() {
    try {
      if (!existsSync(MESSAGES_DIR)) return
      const cutoff = Date.now() - MESSAGES_TTL_DAYS * 24 * 60 * 60 * 1000
      const days = readdirSync(MESSAGES_DIR)
      let dropped = 0
      for (const day of days) {
        const dayMs = Date.parse(`${day}T00:00:00Z`)
        if (!Number.isFinite(dayMs)) continue
        if (dayMs < cutoff) {
          rmSync(join(MESSAGES_DIR, day), { recursive: true, force: true })
          dropped++
        }
      }
      if (dropped > 0) this.pushLog('info', `pruned ${dropped} envelope day-dirs older than ${MESSAGES_TTL_DAYS}d`)
    } catch (err) {
      this.pushLog('warn', `pruneOldMessages failed: ${String((err as Error)?.message ?? err)}`)
    }
  }

  // ─── Media download (used by both receive path and recovery path) ─────
  private async maybeDownloadMedia(m: WAMessage): Promise<{ mediaPath: string; mediaMime: string } | null> {
    const info = mediaInfoFromMessage(m)
    if (!info) return null
    if (!this.sock) {
      this.pushLog('warn', 'maybeDownloadMedia: no socket — cannot reupload via WA')
      return null
    }
    const waId = m.key?.id || `unknown_${Date.now()}`
    const ext = extFromMime(info.mime) || extFromFilename(info.fileName) || 'bin'
    try {
      const buf = await downloadMediaMessage(
        m,
        'buffer',
        {},
        { logger: this.logger, reuploadRequest: this.sock.updateMediaMessage },
      )
      if (!buf || !buf.length) {
        this.pushLog('warn', `media download empty for ${waId}`)
        return null
      }
      // F20: content-hashed media. The URL the UI uses to fetch this is
      // the auth-gated /api/admin/media/<hash> route, NOT a direct static
      // URL. media/<sha256>.<ext> lives outside public/.
      // Bucket by sender number (Ralph 2026-05-31): matched lead → media/<phone>/,
      // unknown sender → media/unmatched/<phone>/ (moved to media/<phone>/ once the
      // number is matched, via promoteUnmatchedForPhone → moveMediaByHashes).
      let bucket: string | undefined
      try {
        const jid = m.key?.remoteJid || ''
        const rawPhone = jid.includes('@') ? jid.split('@')[0] : jid
        const { normalizeWhatsAppNumber, readSheet } = await import('./crm-store')
        const phone = normalizeWhatsAppNumber(rawPhone)
        if (phone) {
          const matched = readSheet().some((p) => normalizeWhatsAppNumber(p.phone) === phone)
          bucket = matched ? phone : `unmatched/${phone}`
        }
      } catch (e) {
        this.pushLog('warn', `media bucket resolve failed (filing flat): ${String((e as Error)?.message ?? e)}`)
      }
      const { writeRuntimeMedia } = await import('./media-store')
      const { hash, url, stored } = writeRuntimeMedia(buf, ext, bucket)
      this.pushLog('info',
        `media ${stored ? 'saved' : 'dedup'}: ${url} (${buf.length} bytes, ${info.mime}, wa_id=${waId})`,
      )
      return { mediaPath: url, mediaMime: info.mime }
    } catch (err) {
      this.pushLog('warn', `media download failed for ${waId}: ${String((err as Error)?.message ?? err)}`)
      return null
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────
  /**
   * Boot the runtime. Idempotent + concurrent-safe: parallel calls share
   * the same in-flight startup promise. Called on every server start by
   * instrumentation.ts; also called explicitly when the user hits
   * "Generate QR code" (forceQr=true wipes creds first).
   */
  async start(opts: { forceQr?: boolean } = {}): Promise<void> {
    const forceQr = !!opts.forceQr

    if (this.sock && !forceQr) {
      this.pushLog('debug', 'start(): socket already up — skipping')
      return
    }
    if (this.starting && !forceQr) {
      return this.starting
    }

    this.starting = (async () => {
      try {
        if (forceQr) {
          this.pushLog('info', 'force-QR requested — clearing existing creds')
          if (this.sock) {
            try { (this.sock as { end?: () => void })?.end?.() } catch { /* ignore */ }
            this.sock = null
          }
          rmSync(AUTH_DIR, { recursive: true, force: true })
          mkdirSync(AUTH_DIR, { recursive: true })
        }

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR) as {
          state: AuthenticationState
          saveCreds: () => Promise<void>
        }

        let waVersion: [number, number, number] | undefined
        try {
          const { version, isLatest } = await fetchLatestBaileysVersion()
          waVersion = version
          this.pushLog('info', `using WhatsApp Web v${version.join('.')} (latest: ${isLatest})`)
        } catch (err) {
          this.pushLog('warn', `version fetch failed (${String((err as Error)?.message ?? err)}) — using Baileys default`)
        }

        this.sock = makeWASocket({
          version: waVersion,
          auth: state,
          logger: this.logger,
          browser: Browsers.appropriate('Oskar CRM'),
          printQRInTerminal: false,
          syncFullHistory: false,
        })

        this.latestQr = null
        this.latestQrDataUrl = null

        this.wireSocketEvents(state, saveCreds)
      } finally {
        this.starting = null
      }
    })()

    return this.starting
  }

  /**
   * Boot-time call from instrumentation.ts. Prunes expired envelopes and
   * silently reconnects if saved creds exist. Never throws.
   */
  async boot(): Promise<void> {
    if (this.booted) return
    this.booted = true
    this.pushLog('info', 'wa-runtime boot')
    this.pruneOldMessages()
    if (existsSync(join(AUTH_DIR, 'creds.json'))) {
      this.pushLog('info', 'found saved creds → attempting silent reconnect')
      try { await this.start() } catch (err) {
        this.pushLog('error', `boot socket failed: ${String((err as Error)?.message ?? err)}`)
      }
    } else {
      this.pushLog('info', 'no saved creds — runtime idle until /pair is called')
    }
  }

  /**
   * Disconnect + wipe creds. Re-pair required after this.
   */
  async disconnect(): Promise<void> {
    if (this.sock) {
      try { await this.sock.logout() } catch (err) {
        this.pushLog('warn', `logout error (proceeding): ${String((err as Error)?.message ?? err)}`)
      }
      this.sock = null
    }
    rmSync(AUTH_DIR, { recursive: true, force: true })
    mkdirSync(AUTH_DIR, { recursive: true })
    this.writeMeta({ linkedSince: null })
    this.connState = 'idle'
    this.latestQr = null
    this.latestQrDataUrl = null
    this.pushLog('info', 'disconnected by user')
  }

  // ─── Status (consumed by /api/admin/whatsapp/status) ──────────────────
  getStatus(): RuntimeStatusPayload {
    const meta = this.readMeta() as {
      linkedSince?: string
      lastActivityAt?: string
      inboundToday?: number
      outboundToday?: number
    }

    if (this.connState === 'error') {
      return { status: 'error', reason: this.lastError ?? 'unknown', logs: this.recentLogs.slice(-20) }
    }

    if (this.connState === 'connected' && this.sock?.user) {
      const fullJid = this.sock.user.id
      const phone = fullJid.split('@')[0].split(':')[0]
      return {
        status: 'connected',
        phone,
        deviceId: fullJid,
        linkedSince: meta.linkedSince ?? null,
        lastActivityAt: meta.lastActivityAt ?? null,
        inboundToday: meta.inboundToday ?? 0,
        outboundToday: meta.outboundToday ?? 0,
      }
    }

    if (this.connState === 'pairing' && this.latestQrDataUrl) {
      return { status: 'pairing', qr: this.latestQrDataUrl }
    }

    return { status: 'installed-not-paired' }
  }

  isConnected(): boolean {
    return this.connState === 'connected' && !!this.sock
  }

  // ─── Outbound send ────────────────────────────────────────────────────
  async sendMessage(phone: string, text: string): Promise<{ ok: boolean; wa_message_id?: string; error?: string }> {
    if (!this.sock || !this.isConnected()) {
      return { ok: false, error: 'bridge not connected' }
    }
    const cleanPhone = String(phone ?? '').replace(/\D+/g, '')
    const cleanText = String(text ?? '').trim()
    if (!cleanPhone || !cleanText) {
      return { ok: false, error: 'phone and body required' }
    }
    const jid = `${cleanPhone}@s.whatsapp.net`
    try {
      const result = await this.sock.sendMessage(jid, { text: cleanText })
      const wa_message_id = result?.key?.id ?? undefined
      const today = new Date().toISOString().slice(0, 10)
      const meta = this.readMeta() as { outboundDate?: string; outboundToday?: number }
      const last = meta.outboundDate === today ? (meta.outboundToday ?? 0) : 0
      this.writeMeta({
        outboundDate: today,
        outboundToday: last + 1,
        lastActivityAt: new Date().toISOString(),
      })
      this.pushLog('info', `outbound → ${cleanPhone}: ${cleanText.slice(0, 60)}`)
      return { ok: true, wa_message_id }
    } catch (err) {
      const msg = String((err as Error)?.message ?? err)
      this.pushLog('error', `send failed: ${msg}`)
      return { ok: false, error: msg }
    }
  }

  // ─── Re-download (recover lost media) ─────────────────────────────────
  async redownloadMedia(waMessageId: string): Promise<
    | { ok: true; media_path: string; media_mime: string }
    | { ok: false; error: string; status: number }
  > {
    if (!this.sock || !this.isConnected()) {
      return { ok: false, error: 'bridge not connected', status: 503 }
    }
    const m = this.loadPersistedMessage(waMessageId)
    if (!m) {
      this.pushLog('warn', `redownload: no envelope found for ${waMessageId}`)
      return {
        ok: false,
        error: 'no persisted envelope for this message (likely older than the envelope store)',
        status: 404,
      }
    }
    const media = await this.maybeDownloadMedia(m)
    if (!media) {
      return {
        ok: false,
        error: 'media download failed (CDN may have expired the blob)',
        status: 502,
      }
    }
    this.pushLog('info', `redownloaded media for ${waMessageId}: ${media.mediaPath}`)
    return { ok: true, media_path: media.mediaPath, media_mime: media.mediaMime }
  }

  // ─── Socket event wiring (extracted for readability) ──────────────────
  private wireSocketEvents(state: AuthenticationState, saveCreds: () => Promise<void>) {
    if (!this.sock) return

    this.sock.ev.on('creds.update', async (update: Record<string, unknown>) => {
      Object.assign(state.creds as object, update)
      const updMe = (update as { me?: { id?: string } }).me?.id ?? 'null'
      const stMe = state.creds.me?.id ?? 'null'
      this.pushLog('info', `creds.update — update.me=${updMe}, state.me=${stMe}, registered=${state.creds.registered}`)
      await saveCreds()
    })

    this.sock.ev.on('connection.update', async (update: {
      connection?: 'connecting' | 'open' | 'close'
      qr?: string
      lastDisconnect?: { error?: { output?: { statusCode?: number }, data?: unknown, message?: string } }
    }) => {
      const { connection, qr, lastDisconnect } = update

      if (qr) {
        this.connState = 'pairing'
        this.latestQr = qr
        try {
          this.latestQrDataUrl = await QRCode.toDataURL(qr, {
            margin: 1,
            width: 280,
            color: { dark: '#000000', light: '#ffffff' },
          })
          this.pushLog('info', 'new QR generated')
        } catch (err) {
          this.pushLog('error', `QR render failed: ${String((err as Error)?.message ?? err)}`)
        }
      }

      if (connection === 'connecting') this.pushLog('info', 'connecting…')

      if (connection === 'open') {
        this.connState = 'connected'
        this.latestQr = null
        this.latestQrDataUrl = null
        this.lastError = null
        const meta = this.readMeta() as { linkedSince?: string }
        if (!meta.linkedSince) this.writeMeta({ linkedSince: new Date().toISOString() })
        const me = this.sock?.user
        this.pushLog('info', `connected as ${me?.id ?? '(unknown)'}`)
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode
        const reason = statusCode
          ? (DisconnectReason as Record<number, string>)[statusCode] || `code ${statusCode}`
          : 'unknown'
        this.lastError = reason

        if (statusCode === DisconnectReason.loggedOut) {
          this.pushLog('warn', `socket closed: ${reason} — wiping creds, re-pair required`)
          this.connState = 'error'
          this.sock = null
          rmSync(AUTH_DIR, { recursive: true, force: true })
          mkdirSync(AUTH_DIR, { recursive: true })
          this.writeMeta({ linkedSince: null })
          return
        }

        if (statusCode === DisconnectReason.restartRequired) {
          this.pushLog('info', 'pair handshake complete (restartRequired) — reconnecting')
        } else {
          this.pushLog('warn', `socket closed: ${reason}`)
        }

        this.connState = 'idle'
        this.sock = null
        setTimeout(() => {
          this.start().catch(err => this.pushLog('error', `reconnect failed: ${String((err as Error)?.message ?? err)}`))
        }, 2000)
      }
    })

    // Raw protocol-frame tap to learn LID→phone mappings before Baileys
    // emits messages.upsert. Pattern explained at length in lib/wa-routing.mjs.
    type RawNode = { attrs?: { from?: string; sender_pn?: string } }
    ;(this.sock as unknown as { ws: { prependListener: (event: string, cb: (node: RawNode) => void) => void } })
      .ws.prependListener('CB:message', (node) => {
        try {
          const from = node?.attrs?.from
          const senderPn = node?.attrs?.sender_pn
          if (!from || !senderPn) return
          if (typeof from !== 'string' || !from.endsWith('@lid')) return
          const lid = lidBase(from)
          if (!lid) return
          if (!this.lidPhoneMap.has(lid)) {
            this.pushLog('info', `LID→phone learned: ${lid}@lid → ${senderPn}`)
          }
          this.lidPhoneMap.set(lid, senderPn)
        } catch (err) {
          this.pushLog('warn', `CB:message tap failed: ${String((err as Error)?.message ?? err)}`)
        }
      })

    this.sock.ev.on('messages.upsert', async ({ messages, type }: { messages: WAMessage[]; type: string }) => {
      this.pushLog('info', `messages.upsert · type=${type} · count=${messages.length}`)
      for (const m of messages) {
        // Always persist the envelope — even for messages we'll skip below.
        // Replay-from-envelope (redownloadMedia, future schema migrations)
        // depends on having every received envelope on disk.
        this.persistMessage(m)
        // Ralph 2026-05-26 · skip-check runs BEFORE maybeDownloadMedia so we
        // don't waste bandwidth + disk decrypting media for messages that
        // dispatchInboundMessage will reject anyway. The skip cases are
        // status@broadcast (WhatsApp Stories), groups, broadcasts, and
        // fromMe. Without this gate, every story image with a media node
        // got downloaded to /media/<hash>.jpg then orphaned (4 such files
        // accumulated on May 25 before this fix). The envelope is still
        // persisted above, so if we ever decide the skip-rule is wrong,
        // backfill is possible by re-running dispatch over the day's dir.
        const skip = skipReason(m)
        let media: { mediaPath: string; mediaMime: string } | null = null
        if (!skip && !m.key?.fromMe) {
          media = await this.maybeDownloadMedia(m)
        }
        // dispatchInboundMessage handles skip-rules + dedup + LID resolution.
        // We inject a `dispatcher` callback so it calls dispatchInboundToCrm
        // directly instead of round-tripping through HTTP. The HTTP path
        // still exists at /api/admin/crm/activities/wa-inbound for the
        // e2e test suite (scripts/test-wa-routing.mjs).
        const result = await dispatchInboundMessage(m, {
          logger: (level: string, msg: string) => this.pushLog(level, msg),
          dedup: this.dedupSet,
          lidLookup: (jid: string) => this.lidPhoneMap.get(lidBase(jid) ?? ''),
          mediaPath: media?.mediaPath,
          mediaMime: media?.mediaMime,
          dispatcher: async (payload: InboundPayload) => dispatchInboundToCrm(payload),
        })
        if (result.outcome === 'matched') {
          const today = new Date().toISOString().slice(0, 10)
          const meta = this.readMeta() as { inboundDate?: string; inboundToday?: number }
          const last = meta.inboundDate === today ? (meta.inboundToday ?? 0) : 0
          this.writeMeta({
            inboundDate: today,
            inboundToday: last + 1,
            lastActivityAt: new Date().toISOString(),
          })
        }
      }
    })

    this.sock.ev.on('messages.update', async (updates: Array<{
      key?: { id?: string }
      update?: { status?: number }
    }>) => {
      for (const u of updates) {
        const wa_message_id = u.key?.id
        if (!wa_message_id) continue
        const statusInt = u.update?.status
        if (statusInt === undefined || statusInt === null) continue
        // Status enum: 0 ERROR | 1 PENDING | 2 SERVER_ACK | 3 DELIVERY_ACK | 4 READ | 5 PLAYED
        const status =
          statusInt === 0 ? 'failed'
          : statusInt === 2 ? 'sent'
          : statusInt === 3 ? 'delivered'
          : statusInt === 4 || statusInt === 5 ? 'read'
          : null
        if (!status) continue
        try {
          await updateWaStatusByMessageId(wa_message_id, status)
        } catch (err) {
          this.pushLog('warn', `wa-status update failed: ${String((err as Error)?.message ?? err)}`)
        }
      }
    })
  }
}

// ─── Singleton (HMR-safe via globalThis) ────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __waRuntime: WaRuntime | undefined
}

export function getRuntime(): WaRuntime {
  if (!globalThis.__waRuntime) {
    globalThis.__waRuntime = new WaRuntime()
  }
  return globalThis.__waRuntime
}
