// ============================================================================
// lib/wa-routing.mjs — WhatsApp inbound routing logic (extracted from bridge)
// WP-CRM-F19 (Ralph 2026-05-24)
//
// One function `dispatchInboundMessage(m, deps)` that takes a Baileys-shaped
// message + dependencies and routes it to Oskar's wa-inbound endpoint.
// Pulled out of oskar-wa-bridge.mjs so the same code can be unit-tested
// without spinning up the Baileys WebSocket. The bridge imports this and
// calls it from its `messages.upsert` listener; the e2e test script in
// `scripts/test-wa-routing.mjs` calls it directly with synthetic messages.
// ============================================================================

const DEFAULT_OSKAR_URL = process.env.OSKAR_URL || 'http://127.0.0.1:3000'

/**
 * Resolve a phone number (international digits, no `+` no spaces) from a
 * Baileys WAMessageKey. Modern WhatsApp routes many chats through LID
 * (Linked Identity) addresses (`<digits>@lid`); the actual phone lives in
 * a `senderPn` / `participantPn` field on the key. Falls through the
 * possibilities in order until one yields ≥8 digits.
 *
 * Returns `null` if no plausible phone can be extracted.
 */
/**
 * Strip the `@lid` (and any device suffix `:N`) from a Linked Identity JID
 * to get the bare LID — used as a key in the lidPhoneMap, since the raw
 * frame's `from` includes the device id (`126139246858419:45@lid`) but
 * messages.upsert's `remoteJid` doesn't (`126139246858419@lid`).
 */
export function lidBase(jid) {
    if (!jid || typeof jid !== 'string') return null
    if (!jid.endsWith('@lid')) return null
    return jid.split('@')[0].split(':')[0]
}

export function phoneFromMessage(m, lidLookup) {
    // First try fields that may be present directly on the key (Baileys
    // 7.x exposes senderPn here; 6.17 does NOT, but we keep the path for
    // forward-compat + group messages).
    const candidates = [
        m?.key?.senderPn,
        m?.key?.participantPn,
        m?.key?.remoteJidAlt,
        m?.key?.remoteJid,
        m?.participant,
    ]
    for (const c of candidates) {
        if (!c || typeof c !== 'string') continue
        if (c.endsWith('@lid')) continue
        const digits = c.split('@')[0].split(':')[0].replace(/\D+/g, '')
        if (digits.length >= 8) return digits
    }
    // Baileys 6.17 fallback: messages.upsert strips sender_pn from the
    // event payload but it's present on the raw protocol frame. The
    // bridge captures LID→phone mappings off the raw frame via a
    // ws.on('CB:message') listener and exposes them via this lookup.
    const remoteJid = m?.key?.remoteJid
    if (remoteJid && remoteJid.endsWith('@lid') && typeof lidLookup === 'function') {
        const phoneJid = lidLookup(remoteJid)
        if (phoneJid && typeof phoneJid === 'string') {
            const digits = phoneJid.split('@')[0].split(':')[0].replace(/\D+/g, '')
            if (digits.length >= 8) return digits
        }
    }
    return null
}

/**
 * Walk through the common Baileys message envelopes (`ephemeralMessage`,
 * `viewOnceMessage`, `documentWithCaptionMessage`, etc.) to get to the
 * actual content node — image, video, audio, document, or text.
 *
 * Without this, document-with-caption messages sent from iOS WhatsApp
 * fall through every media-detection check because the documentMessage
 * lives one level deeper than the bridge looks. Same for view-once
 * media + ephemeral (disappearing-message) wrappers.
 */
export function getInnerMessage(m) {
    let msg = m?.message
    if (!msg) return null
    // Each iteration peels one envelope; loop until we hit raw content.
    // Bounded by depth=5 to avoid infinite loops on hostile payloads.
    for (let i = 0; i < 5; i++) {
        if (msg.ephemeralMessage?.message)            { msg = msg.ephemeralMessage.message;            continue }
        if (msg.viewOnceMessage?.message)             { msg = msg.viewOnceMessage.message;             continue }
        if (msg.viewOnceMessageV2?.message)           { msg = msg.viewOnceMessageV2.message;           continue }
        if (msg.viewOnceMessageV2Extension?.message)  { msg = msg.viewOnceMessageV2Extension.message;  continue }
        if (msg.documentWithCaptionMessage?.message)  { msg = msg.documentWithCaptionMessage.message;  continue }
        if (msg.editedMessage?.message)               { msg = msg.editedMessage.message;               continue }
        break
    }
    return msg
}

/**
 * Extract the human-readable text body from a Baileys message envelope.
 * Returns '' for non-text messages (audio/video without caption,
 * stickers, protocol messages, etc).
 */
export function textFromMessage(m) {
    const msg = getInnerMessage(m)
    if (!msg) return ''
    // Ralph 2026-05-26 · location messages have no `text` field. Synthesize
    // a "📍 Location shared" label + maps.google.com link so Filippo can
    // click straight to the pin. Lat/lng comes from degreesLatitude/Longitude
    // on the location node. Falls back to label-only if coords are missing
    // or non-numeric (defensive — shouldn't happen with real envelopes).
    // The UI's linkifier wraps the URL in an <a> tag at render time.
    if (msg.locationMessage || msg.liveLocationMessage) {
        const loc = msg.locationMessage || msg.liveLocationMessage
        const lat = loc?.degreesLatitude
        const lng = loc?.degreesLongitude
        if (typeof lat === 'number' && typeof lng === 'number') {
            return `📍 Location shared · https://maps.google.com/?q=${lat},${lng}`
        }
        return '📍 Location shared'
    }
    return (
        msg.conversation
        || msg.extendedTextMessage?.text
        || msg.imageMessage?.caption
        || msg.videoMessage?.caption
        || msg.documentMessage?.caption
        || ''
    )
}

/**
 * Returns metadata for the media node attached to a Baileys message, or
 * null if it carries no media. The bridge uses this to decide whether to
 * download anything before dispatching to wa-inbound. Caller still has to
 * actually download via `downloadMediaMessage` — this just shapes the meta.
 */
export function mediaInfoFromMessage(m) {
    const msg = getInnerMessage(m)
    if (!msg) return null
    if (msg.imageMessage)    return { kind: 'image',    mime: msg.imageMessage.mimetype    ?? 'image/jpeg',    node: msg.imageMessage,    fileName: msg.imageMessage.fileName    ?? null }
    if (msg.videoMessage)    return { kind: 'video',    mime: msg.videoMessage.mimetype    ?? 'video/mp4',     node: msg.videoMessage,    fileName: msg.videoMessage.fileName    ?? null }
    if (msg.audioMessage)    return { kind: 'audio',    mime: msg.audioMessage.mimetype    ?? 'audio/ogg',     node: msg.audioMessage,    fileName: null }
    if (msg.stickerMessage)  return { kind: 'sticker',  mime: msg.stickerMessage.mimetype  ?? 'image/webp',    node: msg.stickerMessage,  fileName: null }
    if (msg.documentMessage) return { kind: 'document', mime: msg.documentMessage.mimetype ?? 'application/octet-stream', node: msg.documentMessage, fileName: msg.documentMessage.fileName ?? null }
    return null
}

/**
 * Decide whether this message should produce a CRM activity row.
 * Returns a reason string when skipping (for diagnostic logging), or null
 * when the message should be processed.
 */
export function skipReason(m) {
    if (!m) return 'no message envelope'
    if (m.key?.fromMe) return 'fromMe (outbound, handled separately)'
    const remoteJid = m.key?.remoteJid ?? ''
    if (remoteJid.endsWith('@g.us')) return 'group (@g.us)'
    if (remoteJid.endsWith('@broadcast')) return 'broadcast'
    if (remoteJid === 'status@broadcast') return 'status broadcast'
    const text = textFromMessage(m)
    const wa_message_id = m.key?.id ?? ''
    if (!text && !wa_message_id) return 'no text and no wa_message_id'
    return null
}

/**
 * Route a single Baileys-shaped message to Oskar's wa-inbound endpoint.
 * Returns a result object describing what happened (for tests + logs).
 *
 * @param {object} m - Baileys WAMessage shape ({ key, message, messageTimestamp, pushName })
 * @param {object} deps
 * @param {string} [deps.oskarUrl]   - Oskar Next.js base URL (only used by the HTTP fallback)
 * @param {(level: string, msg: string) => void} [deps.logger]  - log sink
 * @param {Set<string>} [deps.dedup] - LRU-ish set of already-forwarded wa_message_ids
 * @param {(lidJid: string) => string | undefined} [deps.lidLookup] - resolves
 *     an `@lid` remoteJid to the real phone JID (`<digits>@s.whatsapp.net`).
 *     The runtime populates this from raw protocol-frame `sender_pn` attrs.
 * @param {string} [deps.mediaPath] - public URL path to downloaded media
 * @param {string} [deps.mediaMime] - MIME type of the downloaded media
 * @param {(payload: object) => Promise<{matched: boolean, stashed?: boolean, prospect_id?: string, activity_id?: string, error?: string}>} [deps.dispatcher]
 *     OPTIONAL direct-call dispatcher. If provided, called instead of doing
 *     an HTTP POST to wa-inbound. The in-process WhatsApp runtime passes
 *     `dispatchInboundToCrm` here so there's no HTTP loopback. The HTTP
 *     fallback exists for the e2e test script (scripts/test-wa-routing.mjs)
 *     which exercises the wire format.
 *
 * Bug fix 2026-05-25: the dedup.add() call previously happened BEFORE the
 * dispatch attempt, so a dispatch failure left the message marked as
 * forwarded — losing the row forever. Now we only add to dedup on
 * successful match/unmatched outcome.
 *
 * @returns {Promise<{outcome: string, prospect_id?: string, phone?: string, error?: string, body?: string, wa_message_id?: string}>}
 */
export async function dispatchInboundMessage(m, deps = {}) {
    const {
        oskarUrl = DEFAULT_OSKAR_URL,
        logger = () => {},
        dedup,
        lidLookup,
        mediaPath,
        mediaMime,
        dispatcher,
    } = deps

    const skip = skipReason(m)
    if (skip) {
        logger('debug', `skipped: ${skip}`)
        return { outcome: 'skipped', reason: skip }
    }

    const wa_message_id = m.key?.id ?? ''
    if (dedup && wa_message_id && dedup.has(wa_message_id)) {
        logger('debug', `skipped: already forwarded ${wa_message_id}`)
        return { outcome: 'deduped', wa_message_id }
    }

    const text = textFromMessage(m)
    const phone = phoneFromMessage(m, lidLookup)
    if (!phone) {
        const keyDump = JSON.stringify(m.key ?? {}).slice(0, 200)
        logger('warn', `no phone resolvable; key=${keyDump}`)
        return { outcome: 'no_phone', wa_message_id, key: m.key }
    }

    const payload = {
        phone,
        body: text,
        wa_message_id,
        timestamp: m.messageTimestamp ?? Math.floor(Date.now() / 1000),
        push_name: m.pushName ?? null,
        media_path: mediaPath ?? null,
        media_mime: mediaMime ?? null,
    }

    try {
        // Direct call path (production / in-process runtime).
        if (typeof dispatcher === 'function') {
            const body = await dispatcher(payload)
            if (body?.matched) {
                if (dedup && wa_message_id) dedup.add(wa_message_id)
                logger('info', `inbound → ${body.prospect_id} (${phone}): ${text.slice(0, 60)}`)
                return { outcome: 'matched', prospect_id: body.prospect_id, phone, wa_message_id, body: text }
            }
            if (dedup && wa_message_id) dedup.add(wa_message_id)
            logger('info', `inbound from ${phone} → unmatched (stashed)`)
            return { outcome: 'unmatched', phone, wa_message_id, body: text }
        }

        // HTTP fallback (e2e tests).
        const res = await fetch(`${oskarUrl}/api/admin/crm/activities/wa-inbound`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
        if (!res.ok) {
            const errText = await res.text().catch(() => '')
            logger('warn', `wa-inbound POST failed: ${res.status} ${errText.slice(0, 80)}`)
            return { outcome: 'post_failed', status: res.status, error: errText, phone, wa_message_id }
        }
        const body = await res.json()
        if (dedup && wa_message_id) dedup.add(wa_message_id)
        if (body.matched) {
            logger('info', `inbound → ${body.prospect_id} (${phone}): ${text.slice(0, 60)}`)
            return { outcome: 'matched', prospect_id: body.prospect_id, phone, wa_message_id, body: text }
        }
        logger('info', `inbound from ${phone} → unmatched (stashed)`)
        return { outcome: 'unmatched', phone, wa_message_id, body: text }
    } catch (err) {
        const msg = err?.message ?? String(err)
        logger('warn', `wa-inbound dispatch failed: ${msg}`)
        return { outcome: 'fetch_failed', error: msg, phone, wa_message_id }
    }
}
