'use client'

// ============================================================================
// WaComposeModal — "Send WhatsApp via Oskar". Ports crm.html waOpenCompose +
// waAskConsular + waSubmitCompose (1:1 contract):
//   · ✨ Ask AI → POST /api/admin/crm/consular/ask {prospectId, prospectName,
//                draftText} → {imagePrompt (the Consular's draft), feedback}
//   · Send     → POST /api/admin/crm/activities/wa-outbound {prospect_id, body}
//                → {ok} (sends via the Oskar bridge, logs a WhatsApp Out activity)
// On send, onSent() lets the host refresh the lead's history/feed.
// ============================================================================

import { useState } from 'react'
import { X, MessageCircle, Sparkles } from 'lucide-react'

interface WaComposeModalProps {
  prospectId: string
  company: string
  phone: string
  contactName: string
  onClose: () => void
  onSent: () => void
}

export function WaComposeModal({ prospectId, company, phone, contactName, onClose, onSent }: WaComposeModalProps) {
  const first = (contactName || '').split(/\s+/)[0] || ''
  const initialDraft = `Hi ${first}`.trim() + `, quick follow-up on ${company || ''}.`
  const [body, setBody] = useState(initialDraft)
  const [sending, setSending] = useState(false)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [focused, setFocused] = useState(false)

  const askAI = async () => {
    setAsking(true)
    setError('')
    setFeedback('')
    try {
      const res = await fetch('/api/admin/crm/consular/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospectId, prospectName: company, draftText: body.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) { setError(data.error || `Ask AI failed (${res.status})`); return }
      if (typeof data.imagePrompt === 'string') setBody(data.imagePrompt)
      if (typeof data.feedback === 'string') setFeedback(data.feedback)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAsking(false)
    }
  }

  const send = async () => {
    const text = body.trim()
    if (!text) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/admin/crm/activities/wa-outbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospectId, body: text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) { setError(data.error || `Send failed (${res.status})`); setSending(false); return }
      onSent()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSending(false)
    }
  }

  const greenBtn: React.CSSProperties = {
    padding: '7px 18px', borderRadius: 8, border: 'none', color: '#fff', fontSize: 11.5, fontWeight: 700,
    letterSpacing: '0.02em', background: 'linear-gradient(135deg, #25D366, #128C7E)',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  }
  const ghostBtn: React.CSSProperties = {
    padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-card)', background: 'transparent',
    color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.45)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '15px 18px', borderBottom: '1px solid var(--border-card)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#25D366', flexShrink: 0 }} />
              <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono, monospace)', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-muted)', fontWeight: 700 }}>Send WhatsApp via Oskar</span>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {company}{phone ? <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{`  ·  ${phone}`}</span> : null}
            </div>
          </div>
          <button onClick={onClose} title="Close" style={{ flexShrink: 0, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', padding: 2 }}>
            <X width={15} height={15} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflowY: 'auto' }}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Type your message…"
            autoFocus
            style={{
              width: '100%', height: 200, padding: '11px 13px', borderRadius: 10, boxSizing: 'border-box',
              border: `1px solid ${focused ? '#25D366' : 'var(--border-card)'}`,
              background: 'var(--bg-app)', color: 'var(--text-main)', fontSize: 13.5, lineHeight: 1.6,
              resize: 'vertical', outline: 'none', fontFamily: 'inherit',
              boxShadow: focused ? '0 0 0 3px rgba(37,211,102,0.12)' : 'none',
              transition: 'border-color 0.12s, box-shadow 0.12s',
            }}
          />
          <div style={{ fontSize: 10.5, color: 'var(--text-dim, var(--text-muted))' }}>Sent via Oskar — auto-logged as a WhatsApp Out activity.</div>
          {(error || feedback) && (
            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: error ? 'var(--brand-red, #ff6a4d)' : 'var(--text-muted)' }}>
              {error ? error : `✨ ${feedback}`}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px', borderTop: '1px solid var(--border-card)' }}>
          <button
            onClick={askAI}
            disabled={asking || sending}
            title="Ask the Consular to draft this in Filippo's voice"
            style={{ ...ghostBtn, marginRight: 'auto', color: 'var(--text-main)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: asking || sending ? 'default' : 'pointer', opacity: asking || sending ? 0.55 : 1 }}
          >
            <Sparkles width={12} height={12} />{asking ? 'Drafting…' : 'Ask AI'}
          </button>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button
            onClick={send}
            disabled={sending || !body.trim()}
            style={{ ...greenBtn, cursor: sending || !body.trim() ? 'default' : 'pointer', opacity: sending || !body.trim() ? 0.55 : 1 }}
          >
            <MessageCircle width={13} height={13} />{sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
