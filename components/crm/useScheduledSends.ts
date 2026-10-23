// ============================================================================
// useScheduledSends — client hook for /api/admin/crm/scheduled (Ralph 2026-08-22)
// Shared by the WhatsApp and email conversation panels; the Korrespondenz
// composer wired the same endpoints inline first (Composer.tsx).
// ============================================================================

'use client'

import { useCallback, useEffect, useState } from 'react'

export interface ScheduledSendRow {
  id: number
  prospect_id: string
  channel: 'email' | 'whatsapp'
  subject: string | null
  body: string
  send_at: string
  status: 'pending' | 'sending' | 'sent' | 'failed'
  error: string | null
}

// datetime-local wants "YYYY-MM-DDTHH:MM" in LOCAL time.
export function localStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function nextFullHour(): string {
  const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0)
  return localStamp(d)
}

export function useScheduledSends(channel: 'email' | 'whatsapp') {
  const [scheduled, setScheduled] = useState<ScheduledSendRow[]>([])

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/crm/scheduled?channel=${channel}`, { cache: 'no-store' })
      const data = (await res.json()) as { scheduled?: ScheduledSendRow[] }
      setScheduled(data.scheduled || [])
    } catch { /* list is cosmetic */ }
  }, [channel])

  useEffect(() => { void reload() }, [reload])

  // send_at: datetime-local value; throws with the route's error text.
  const schedule = useCallback(async (payload: {
    prospect_id: string
    to?: string
    subject?: string
    body: string
    in_reply_to?: string
    attachments?: string[]
    send_at: string
  }) => {
    const res = await fetch('/api/admin/crm/scheduled', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, channel, send_at: new Date(payload.send_at).toISOString() }),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    await reload()
  }, [channel, reload])

  const cancel = useCallback(async (id: number) => {
    await fetch('/api/admin/crm/scheduled', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {})
    await reload()
  }, [reload])

  return { scheduled, reload, schedule, cancel }
}
