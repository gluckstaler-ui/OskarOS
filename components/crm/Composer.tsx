// ==========================================
// Composer — the REAL compose surface in the lead detail.
// Consular 2026-08-15, built on Filippo's direct order; v2 same day on his
// corrections: taller body, brand colors (light orange-beige, no grey),
// ONE template per use-case with a DE/EN/IT language switch, and the
// ✨ Ask Consular button (same contract as the WhatsApp modal's Ask AI:
// POST /consular/ask → { imagePrompt, feedback }).
//
// Doctrine wired in:
//   · One truth: drafts live in the `suggestions` table (GET prefill,
//     POST durable save, autosave 1.2s, discard-with-memory).
//   · Send via the existing gated routes (email-outbound / wa-outbound).
//   · Templates from db/templates/*.md — grouped by base id, language
//     variants -de/-en/-it; {{placeholders}} never sent raw (yellow warning).
// ==========================================

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { renderEmailHtml } from '@/lib/email-html'
import { localStamp, nextFullHour } from './useScheduledSends'

interface Suggestion {
  prospect_id: string
  channel: 'email' | 'whatsapp'
  body: string
  subject?: string | null
  in_reply_to?: string | null
  created_at: string
}

interface Template {
  id: string
  name: string
  channel: 'email' | 'whatsapp'
  lang: string
  subject: string
  use: string
  body: string
}

interface ScheduledSend {
  id: number
  channel: 'email' | 'whatsapp'
  subject: string | null
  body: string
  send_at: string
  status: 'pending' | 'sending' | 'sent' | 'failed'
  error: string | null
}

interface ComposerProps {
  prospectId: string
  prospectName?: string | null
  prospectEmail?: string | null
  prospectPhone?: string | null
  onSent?: () => void
}

// ── Brand palette: what used to be GREY becomes light orange-beige, mixed
// per-theme from the app's own tokens so it reads in ONYX *and* POLAR
// (v3 2026-08-15 — v2 hardcoded light beige and was unreadable on POLAR).
// Text always rides --text-main; the beige lives in surfaces and borders.
const BEIGE = 'var(--brand-amber)'                                            // labels, active accents (orange, theme-tuned)
const BEIGE_DIM = 'var(--brand-amber-dim)'                                    // muted labels/hints (warm brown, both themes)
const BEIGE_BORDER = 'color-mix(in srgb, var(--brand-amber) 38%, transparent)' // warm borders
const BEIGE_BG = 'color-mix(in srgb, var(--brand-amber) 6%, var(--bg-card))'   // section tint
const TEXT = 'var(--text-main)'
const RED = 'var(--brand-red)'

const S = {
  wrap: {
    border: `1px solid ${BEIGE_BORDER}`,
    borderRadius: 8,
    margin: '10px 0 14px',
    background: BEIGE_BG,
    overflow: 'hidden',
  } as React.CSSProperties,
  head: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
    cursor: 'pointer', userSelect: 'none' as const,
    fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' as const,
    fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
    color: BEIGE,
  },
  badge: {
    background: RED, color: '#fff', borderRadius: 4, padding: '1px 7px',
    fontSize: 10, letterSpacing: '0.08em',
  } as React.CSSProperties,
  body: { padding: '0 12px 12px' } as React.CSSProperties,
  row: { display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' as const },
  input: {
    flex: 1, minWidth: 180, padding: '7px 10px', fontSize: 13.5,
    border: `1px solid ${BEIGE_BORDER}`, borderRadius: 6,
    color: TEXT, outline: 'none',
  } as React.CSSProperties,
  textarea: {
    width: '100%', minHeight: 460, resize: 'vertical' as const,
    padding: '12px 14px', fontSize: 14.5, lineHeight: 1.6,
    border: `1px solid ${BEIGE_BORDER}`, borderRadius: 6,
    color: TEXT, outline: 'none', fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  } as React.CSSProperties,
  btn: {
    padding: '7px 14px', fontSize: 12.5, borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${BEIGE_BORDER}`, background: 'transparent', color: TEXT,
  } as React.CSSProperties,
  btnPrimary: {
    padding: '7px 16px', fontSize: 12.5, borderRadius: 6, cursor: 'pointer',
    border: '1px solid #25D366', background: '#25D366', color: '#08240f', fontWeight: 700,
  } as React.CSSProperties,
  btnAsk: {
    padding: '7px 14px', fontSize: 12.5, borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${BEIGE}`, background: 'transparent', color: TEXT, fontWeight: 600,
  } as React.CSSProperties,
  toggle: (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
    border: active ? `1px solid ${RED}` : `1px solid ${BEIGE_BORDER}`,
    background: active ? 'rgba(232,51,28,0.12)' : 'transparent',
    color: active ? TEXT : BEIGE_DIM, fontWeight: active ? 700 : 400,
  }),
  langBtn: (active: boolean): React.CSSProperties => ({
    padding: '5px 9px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
    fontFamily: 'ui-monospace, SF Mono, Menlo, monospace', letterSpacing: '0.06em',
    border: active ? `1px solid ${BEIGE}` : `1px solid ${BEIGE_BORDER}`,
    background: active ? BEIGE : 'transparent',
    color: active ? '#1a1408' : BEIGE_DIM, fontWeight: active ? 700 : 400,
  }),
  hint: { fontSize: 11.5, color: BEIGE_DIM, marginTop: 6 } as React.CSSProperties,
}

const langOf = (t: Template): string => (t.lang || t.id.match(/-(de|en|it)$/)?.[1] || 'de')
const baseOf = (t: Template): string => t.id.replace(/-(de|en|it)$/, '')
const baseName = (t: Template): string => t.name.replace(/\s*\((DE|EN|IT)\)\s*$/i, '')

export function Composer({ prospectId, prospectName, prospectEmail, prospectPhone, onSent }: ComposerProps) {
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email')
  const [to, setTo] = useState(prospectEmail || '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [inReplyTo, setInReplyTo] = useState<string | null>(null)
  const [draft, setDraft] = useState<Suggestion | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [consularDraft, setConsularDraft] = useState<{ body: string; subject: string | null; created_at: string } | null>(null)
  const [tplBase, setTplBase] = useState('')
  const [tplLang, setTplLang] = useState<'de' | 'en' | 'it'>('de')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'sending' | 'asking' | 'error'>('idle')
  const [errText, setErrText] = useState('')
  const [feedback, setFeedback] = useState('')
  const [preview, setPreview] = useState(false)
  const [sendAt, setSendAt] = useState(() => nextFullHour())
  const [scheduled, setScheduled] = useState<ScheduledSend[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedFor = useRef<string>('')

  // ── Load the pending draft ───────────────────────────────────────────────
  const loadDraft = useCallback(async (ch: 'email' | 'whatsapp') => {
    try {
      const res = await fetch(`/api/admin/crm/suggestions?channel=${ch}`, { cache: 'no-store' })
      const data = (await res.json()) as { suggestions?: Suggestion[] }
      const mine = (data.suggestions || []).find((s) => s.prospect_id === prospectId) || null
      setDraft(mine)
      if (mine) {
        setBody(mine.body)
        setSubject(mine.subject || '')
        setInReplyTo(mine.in_reply_to || null)
        setOpen(true)
      }
    } catch { /* no prefill */ }
  }, [prospectId])

  useEffect(() => {
    if (loadedFor.current === prospectId + channel) return
    loadedFor.current = prospectId + channel
    void loadDraft(channel)
  }, [prospectId, channel, loadDraft])

  useEffect(() => {
    fetch('/api/admin/crm/templates', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { templates?: Template[] }) => setTemplates(d.templates || []))
      .catch(() => {})
  }, [])

  // The last Consular-authored draft (from the event log) — survives template
  // experiments and lives as its own entry in the template menu.
  useEffect(() => {
    fetch(`/api/admin/crm/suggestions/consular?prospect_id=${prospectId}&channel=${channel}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { draft?: { body: string; subject: string | null; created_at: string } | null }) => setConsularDraft(d.draft || null))
      .catch(() => {})
  }, [prospectId, channel])

  // ── Scheduled sends (Ralph 2026-08-22): delayed button-press, node-local ─
  const loadScheduled = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/crm/scheduled?prospect_id=${prospectId}`, { cache: 'no-store' })
      const data = (await res.json()) as { scheduled?: ScheduledSend[] }
      setScheduled(data.scheduled || [])
    } catch { /* list is cosmetic */ }
  }, [prospectId])

  useEffect(() => { void loadScheduled() }, [loadScheduled])

  const scheduleSend = useCallback(async () => {
    const text = body.trim()
    if (!text || !sendAt) return
    if (channel === 'email' && !to.trim()) { setStatus('error'); setErrText('Empfänger-Adresse fehlt'); return }
    setStatus('sending')
    try {
      const res = await fetch('/api/admin/crm/scheduled', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_id: prospectId, channel, to: to.trim(), subject: subject.trim(),
          body: text, in_reply_to: inReplyTo || undefined,
          send_at: new Date(sendAt).toISOString(),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      // Same aftermath as a real send: consume the draft, clear the surface.
      await fetch('/api/admin/crm/suggestions/discard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospectId, channel }),
      }).catch(() => {})
      setBody(''); setSubject(''); setDraft(null); setFeedback(''); setStatus('idle')
      void loadScheduled()
    } catch (err) {
      setStatus('error'); setErrText(String(err instanceof Error ? err.message : err))
    }
  }, [body, subject, to, channel, prospectId, inReplyTo, sendAt, loadScheduled])

  const cancelScheduled = useCallback(async (id: number) => {
    // Cancel never destroys text: the API returns the unsent payload and has
    // restored it to the draft slot when free. Put it back on the surface too,
    // unless the user is already typing something else here.
    try {
      const res = await fetch('/api/admin/crm/scheduled', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        restored?: { channel: string; body: string; subject: string | null } | null
      }
      if (data.restored && data.restored.channel === channel && !body.trim()) {
        setBody(data.restored.body)
        if (data.restored.subject) setSubject(data.restored.subject)
      }
    } catch { /* list refresh below still runs */ }
    void loadScheduled()
  }, [loadScheduled, channel, body])

  // ── Durable autosave ─────────────────────────────────────────────────────
  const persist = useCallback(async (b: string, subj: string) => {
    if (!b.trim()) return
    setStatus('saving')
    try {
      const res = await fetch('/api/admin/crm/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospectId, channel, body: b, subject: subj, in_reply_to: inReplyTo }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStatus('saved')
    } catch (err) {
      setStatus('error'); setErrText(String(err instanceof Error ? err.message : err))
    }
  }, [prospectId, channel, inReplyTo])

  const scheduleSave = useCallback((b: string, subj: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void persist(b, subj) }, 1200)
  }, [persist])

  // ── Templates: one per use-case, DE/EN/IT variants ──────────────────────
  const bases = templates
    .filter((t) => t.channel === channel)
    .reduce<{ base: string; name: string; langs: string[] }[]>((acc, t) => {
      const base = baseOf(t)
      const hit = acc.find((x) => x.base === base)
      if (hit) { if (!hit.langs.includes(langOf(t))) hit.langs.push(langOf(t)) }
      else acc.push({ base, name: baseName(t), langs: [langOf(t)] })
      return acc
    }, [])

  const applyTemplate = useCallback((base: string, lang: string) => {
    if (base === '__consular__') {
      if (!consularDraft) return
      if (body.trim() && !body.includes('{{') && body.trim() !== consularDraft.body.trim()) {
        const ok = window.confirm('Der aktuelle Entwurf wird durch den Consular-Entwurf ersetzt. Fortfahren?')
        if (!ok) return
      }
      setBody(consularDraft.body)
      if (channel === 'email' && consularDraft.subject) setSubject(consularDraft.subject)
      scheduleSave(consularDraft.body, consularDraft.subject || subject)
      return
    }
    const pool = templates.filter((t) => baseOf(t) === base)
    if (pool.length === 0) return
    const t = pool.find((x) => langOf(x) === lang) || pool[0]
    // Never bulldoze a real draft: a non-empty body that isn't itself a
    // template gets a confirm before being replaced (learned 2026-08-15,
    // the Feyer draft was silently overwritten by a template + autosave).
    if (body.trim() && !body.includes('{{')) {
      const ok = window.confirm('Der aktuelle Entwurf wird durch die Vorlage ersetzt. Fortfahren?')
      if (!ok) return
    }
    setBody(t.body)
    if (t.channel === 'email' && t.subject) setSubject(t.subject)
    setChannel(t.channel)
    scheduleSave(t.body, t.subject || subject)
  }, [templates, subject, body, channel, consularDraft, scheduleSave])

  // ── ✨ Ask Consular — same contract as the WhatsApp modal's Ask AI ──────
  const askConsular = useCallback(async () => {
    if (status === 'asking') return
    setStatus('asking'); setErrText(''); setFeedback('')
    try {
      const res = await fetch('/api/admin/crm/consular/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospectId,
          prospectName: prospectName || undefined,
          draftText: (channel === 'email' && subject.trim() ? `Betreff: ${subject.trim()}\n\n` : '') + body.trim(),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { imagePrompt?: string; feedback?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error || `Ask Consular failed (${res.status})`)
      if (typeof data.imagePrompt === 'string' && data.imagePrompt.trim()) {
        // If the Consular returned a leading subject line, split it back out.
        const m = data.imagePrompt.match(/^Betreff:\s*(.+)\n\n([\s\S]*)$/)
        if (m && channel === 'email') { setSubject(m[1].trim()); setBody(m[2]) }
        else setBody(data.imagePrompt)
        scheduleSave(m && channel === 'email' ? m[2] : data.imagePrompt, m && channel === 'email' ? m[1].trim() : subject)
      }
      if (typeof data.feedback === 'string') setFeedback(data.feedback)
      setStatus('idle')
    } catch (err) {
      setStatus('error'); setErrText(String(err instanceof Error ? err.message : err))
    }
  }, [prospectId, prospectName, body, subject, channel, status, scheduleSave])

  // ── Send / discard ───────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = body.trim()
    if (!text || status === 'sending') return
    if (channel === 'email' && !to.trim()) { setStatus('error'); setErrText('Empfänger-Adresse fehlt'); return }
    setStatus('sending')
    try {
      const url = channel === 'email'
        ? '/api/admin/crm/activities/email-outbound'
        : '/api/admin/crm/activities/wa-outbound'
      const payload = channel === 'email'
        ? { prospect_id: prospectId, to: to.trim(), subject: subject.trim(), body: text, in_reply_to: inReplyTo || undefined }
        : { prospect_id: prospectId, body: text }
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (channel === 'whatsapp' && draft) {
        await fetch('/api/admin/crm/suggestions/discard', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prospect_id: prospectId, channel }),
        }).catch(() => {})
      }
      setBody(''); setSubject(''); setDraft(null); setFeedback(''); setStatus('idle')
      onSent?.()
    } catch (err) {
      setStatus('error'); setErrText(String(err instanceof Error ? err.message : err))
    }
  }, [body, subject, to, channel, prospectId, inReplyTo, draft, status, onSent])

  const discard = useCallback(async () => {
    try {
      await fetch('/api/admin/crm/suggestions/discard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospectId, channel }),
      })
    } catch { /* best-effort */ }
    setBody(''); setSubject(''); setDraft(null); setFeedback(''); setStatus('idle')
    onSent?.()
  }, [prospectId, channel, onSent])

  const draftDate = draft ? new Date(draft.created_at).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' }) : ''

  // The planen button is a TOGGLE (Ralph 2026-08-22): no pending schedule →
  // arm one; pending schedule → the same button disarms it. The armed pending
  // lives in the button; everything else (other channel, extras, failed, sent)
  // renders in the list below.
  const pendingMine = scheduled.find((s) => s.channel === channel && s.status === 'pending')
  const scheduledRest = scheduled.filter((s) => s !== pendingMine)

  return (
    <div style={S.wrap}>
      <div style={S.head} onClick={() => setOpen((o) => !o)}>
        <span>{open ? '▾' : '▸'} Korrespondenz</span>
        {draft && <span style={S.badge}>Entwurf · {draftDate}</span>}
        {scheduled.some((s) => s.status === 'pending') && (
          <span style={{ ...S.badge, background: BEIGE, color: '#1a1408' }}>
            ⏱ {scheduled.filter((s) => s.status === 'pending').length} geplant
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: BEIGE_DIM }}>{channel === 'email' ? '✉' : '💬'}</span>
      </div>
      {open && (
        <div style={S.body}>
          <div style={S.row}>
            <button style={S.toggle(channel === 'email')} onClick={() => setChannel('email')}>E-Mail</button>
            <button style={S.toggle(channel === 'whatsapp')} onClick={() => setChannel('whatsapp')} disabled={!prospectPhone}
              title={prospectPhone ? '' : 'Kein Telefon auf dem Lead'}>WhatsApp</button>
            <select
              style={{ ...S.input, flex: '0 1 auto', maxWidth: 260 }}
              value={tplBase}
              onChange={(e) => { setTplBase(e.target.value); if (e.target.value) applyTemplate(e.target.value, tplLang) }}
            >
              <option value="">Vorlage…</option>
              {consularDraft && (
                <option value="__consular__">
                  {'✨ Consular-Entwurf · ' + new Date(consularDraft.created_at).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' })}
                </option>
              )}
              {bases.map((b) => (
                <option key={b.base} value={b.base}>{b.name}</option>
              ))}
            </select>
            {(['de', 'en', 'it'] as const).map((l) => (
              <button
                key={l}
                style={S.langBtn(tplLang === l)}
                onClick={() => { setTplLang(l); if (tplBase) applyTemplate(tplBase, l) }}
              >{l.toUpperCase()}</button>
            ))}
          </div>
          {channel === 'email' && (
            <>
              <div style={S.row}>
                <input className="crm-composer-field" style={S.input} value={to} onChange={(e) => setTo(e.target.value)} placeholder="An (E-Mail-Adresse)" />
              </div>
              <div style={S.row}>
                <input
                  className="crm-composer-field"
                  style={S.input}
                  value={subject}
                  onChange={(e) => { setSubject(e.target.value); scheduleSave(body, e.target.value) }}
                  placeholder="Betreff"
                />
              </div>
            </>
          )}
          {preview && channel === 'email' ? (
            <div
              className="crm-composer-field"
              style={{ ...S.textarea, minHeight: 200, overflow: 'auto' }}
              dangerouslySetInnerHTML={{ __html: renderEmailHtml(body) }}
            />
          ) : (
          <textarea
            className="crm-composer-field"
            style={S.textarea}
            value={body}
            onChange={(e) => { setBody(e.target.value); scheduleSave(e.target.value, subject) }}
            placeholder={channel === 'email'
              ? 'Der Text der E-Mail. **fett** und [Text](https://…) werden beim Senden formatiert; Links werden klickbar. Speichert automatisch als Entwurf.'
              : 'WhatsApp-Nachricht. Speichert automatisch als Entwurf.'}
          />
          )}
          <div style={{ ...S.row, marginTop: 10, marginBottom: 0 }}>
            <button style={S.btnPrimary} onClick={() => void send()} disabled={status === 'sending'}>
              {status === 'sending' ? 'Sendet…' : channel === 'email' ? 'E-Mail senden' : 'WhatsApp senden'}
            </button>
            <button style={S.btnAsk} onClick={() => void askConsular()} disabled={status === 'asking'}>
              {status === 'asking' ? '✨ Consular arbeitet…' : '✨ Ask Consular'}
            </button>
            <button style={S.btn} onClick={() => void persist(body, subject)}>Entwurf speichern</button>
            {channel === 'email' && (
              <button style={S.btn} onClick={() => setPreview((v) => !v)}>{preview ? '✎ Bearbeiten' : '👁 Vorschau'}</button>
            )}
            {(draft || body.trim()) && (
              <button style={{ ...S.btn, opacity: 0.8 }} onClick={() => void discard()}>Verwerfen</button>
            )}
            <span style={{ ...S.hint, marginLeft: 'auto', marginTop: 0 }}>
              {status === 'saving' && 'speichert…'}
              {status === 'saved' && '✓ Entwurf gesichert'}
              {status === 'error' && <span style={{ color: RED }}>Fehler: {errText}</span>}
            </span>
          </div>
          <div style={{ ...S.row, marginTop: 8, marginBottom: 0 }}>
            <input
              type="datetime-local"
              className="crm-composer-field"
              style={{ ...S.input, flex: '0 1 auto' }}
              value={sendAt}
              min={localStamp(new Date())}
              onChange={(e) => setSendAt(e.target.value)}
              disabled={!!pendingMine}
            />
            {pendingMine ? (
              <button
                style={{ ...S.btn, borderColor: RED, color: TEXT, fontWeight: 700 }}
                onClick={() => void cancelScheduled(pendingMine.id)}
                title="Geplanten Versand abbrechen"
              >⏱ Geplant · {new Date(pendingMine.send_at).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — abbrechen</button>
            ) : (
              <button
                style={{ ...S.btnPrimary, opacity: body.trim() && sendAt ? 1 : 0.5 }}
                onClick={() => void scheduleSend()}
                disabled={status === 'sending' || !body.trim() || !sendAt}
                title="Sendet automatisch zum gewählten Zeitpunkt — von diesem Rechner"
              >{channel === 'email' ? '⏱ E-Mail planen' : '⏱ WhatsApp planen'}</button>
            )}
          </div>
          {scheduledRest.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {scheduledRest.map((s) => (
                <div key={s.id} style={{ ...S.hint, display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ color: s.status === 'failed' ? RED : s.status === 'sent' ? '#25D366' : BEIGE }}>
                    {s.status === 'failed' ? '✗' : s.status === 'sent' ? '✓' : '⏱'}
                  </span>
                  <span>
                    {s.channel === 'email' ? '✉' : '💬'}{' '}
                    {new Date(s.send_at).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    {' — '}
                    {(s.channel === 'email' && s.subject ? s.subject + ': ' : '') + s.body.slice(0, 60)}{s.body.length > 60 ? '…' : ''}
                  </span>
                  {s.status === 'failed' && <span style={{ color: RED }}>Fehler: {s.error}</span>}
                  {s.status !== 'sending' && (
                    <button
                      style={{ ...S.btn, padding: '1px 8px', fontSize: 11, marginLeft: 'auto' }}
                      onClick={() => void cancelScheduled(s.id)}
                      title={s.status === 'pending' ? 'Geplanten Versand abbrechen' : 'Eintrag entfernen'}
                    >✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
          {feedback && (
            <div style={{ ...S.hint, borderLeft: `3px solid ${BEIGE}`, paddingLeft: 8, marginTop: 8 }}>✨ {feedback}</div>
          )}
          {body.includes('{{') && (
            <div style={{ ...S.hint, color: '#e8a516' }}>⚠ Vorlage enthält noch {'{{platzhalter}}'} — vor dem Senden ersetzen.</div>
          )}
        </div>
      )}
    </div>
  )
}
