'use client'

// ============================================================================
// React CRM — shared data layer (WP-CRM-REACT Step 3, Ralph 2026-05-29).
//
// The integration contract for the ported overview columns. Reuses the
// backend's Prospect type (type-only import — erased at compile, pulls in no
// server code) and fetches the SAME REST endpoints the vanilla crm.html uses.
// ============================================================================

import { useState, useEffect, useCallback } from 'react'
import type { Prospect } from '@/lib/crm-store'

export type { Prospect }

/** One CRM activity (timeline / feed row). Shape from GET /api/admin/crm/activities. */
export interface CrmActivity {
  id: string
  prospect_id: string
  timestamp: string
  type: string
  icon?: string
  color?: string
  duration_min?: number
  notes?: string
  subject?: string
  session_id?: string
  user_id?: string
  wa_message_id?: string
  wa_status?: string
  media_path?: string
  media_mime?: string
}

export interface CrmData {
  prospects: Prospect[]
  activities: CrmActivity[]
  loading: boolean
  /** Re-fetch prospects + activities. Awaitable — resolves once disk is read. */
  reload: (silent?: boolean) => Promise<void>
}

/**
 * Loads prospects + activities client-side (mirrors the vanilla crmLoad).
 * `reload()` re-fetches after a write (edit/activity) so the UI reflects disk.
 */
export function useCrmData(): CrmData {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [pRes, aRes] = await Promise.all([
        fetch('/api/admin/crm/prospects', { cache: 'no-store' }),
        fetch('/api/admin/crm/activities', { cache: 'no-store' }),
      ])
      const pData = await pRes.json().catch(() => ({}))
      const aData = await aRes.json().catch(() => ({}))
      if (Array.isArray(pData?.prospects)) setProspects(pData.prospects)
      if (Array.isArray(aData?.activities)) setActivities(aData.activities)
    } catch {
      /* offline / endpoint down — keep last loaded */
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Initial load + silent polling every 15s so new inbound WhatsApp (and any
  // other write to /api/admin/crm/activities) shows up without a manual reload.
  // `silent: true` skips the loading flicker — the UI only shows the loading
  // state on the first mount, not on every poll.
  useEffect(() => {
    load()
    const id = setInterval(() => { void load(true) }, 15_000)
    return () => clearInterval(id)
  }, [load])

  return { prospects, activities, loading, reload: load }
}
