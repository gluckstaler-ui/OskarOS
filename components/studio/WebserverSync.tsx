'use client'

// ============================================================================
// WebserverSync — the SYNC pane inside the session panel (4th tab, sibling to
// Meta). A faithful React port of
//   public/2026-05-31-weingut-barbazza/webserver-sync-prototype.html
// (primary source of truth — spec §5; where spec & prototype disagree the
// prototype wins, §10.1). Styling lives in WebserverSync.module.css, a 1:1
// port of the prototype's <style> block — color-coded rows, NO status pills
// (the prototype renders status by row COLOR, not tags).
//
// The prototype's hardcoded FILES array + fake setTimeout flows are replaced
// with REAL calls to the /api/site/* endpoints (built by a sibling agent):
//   POST /api/site/connect  { sessionId }                      → { ok, method, secure, docroot, error? }
//   POST /api/site/compare  { sessionId, direction }           → { ok, files[], error? }
//   POST /api/site/config   read {sessionId} | write {sessionId, site} → { ok, site }
//   POST /api/site/sync     { sessionId, direction, files[] }  → newline STREAM:
//        SYNC_FILE <p> / SYNC_OK <p> / SYNC_ERR <p> <reason> / SYNC_DONE ok=<n> fail=<m>
//
// State machine (spec §5.2): the power dot is the ONLY connect/disconnect
// control — it never opens the form. Card body toggles the form. Editing a
// connection field while connected → stale bar (doesn't disconnect). Mode
// switch while connected → auto-disconnect (different transport entirely).
// ============================================================================

import { useState, useCallback, useEffect, useMemo } from 'react'
import s from './WebserverSync.module.css'

// ── Config contract ─────────────────────────────────────────────────────────
// lib/session-config exports SessionConfig (not SiteConfig), so the site-shape
// is defined locally to match the /api/site/config contract.
interface SiteConfig {
  method: 'ftp' | 'file'
  domain: string
  host: string
  user: string
  password: string
  port: string
  docroot: string
}

// ── Server-driven compare rows ──────────────────────────────────────────────
interface CompareFile {
  path: string
  status: 'new' | 'changed' | 'unchanged'
  essential: boolean
  localSize?: number
  remoteSize?: number
}
type Direction = 'up' | 'down'
type SyncState = 'idle' | 'work' | 'ok' | 'err'
interface ViewRow {
  file: CompareFile
  sel: boolean
  sync: SyncState
  err?: string
}
type ConnStatus = 'off' | 'connecting' | 'on'

function fmtBytes(n?: number): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// Directory dimmed, filename normal (prototype cp()).
function PathCell({ path }: { path: string }) {
  const i = path.lastIndexOf('/')
  if (i < 0) return <span className={s.path}>{path}</span>
  return (
    <span className={s.path}>
      <span className={s.d}>{path.slice(0, i + 1)}</span>
      {path.slice(i + 1)}
    </span>
  )
}

// Default selection: essential && (new || changed). Non-essential NEVER
// pre-checked (prototype defSel).
function defSel(f: CompareFile): boolean {
  return !!f.essential && (f.status === 'new' || f.status === 'changed')
}
// Sort: essential before non-essential; active before unchanged; new before
// changed (prototype rank()).
function rank(f: CompareFile): number {
  return (f.essential ? 0 : 100) + (f.status === 'unchanged' ? 10 : 0) + (f.status === 'changed' ? 1 : 0)
}
// Row background class — color-coded, no pills (prototype rowCls()).
function rowClass(f: CompareFile): string {
  const ne = f.essential ? '' : ` ${s.ne}`
  if (f.status === 'unchanged') return `${s.row}${ne}`
  const k = f.essential
    ? (f.status === 'new' ? s.sNewE : s.sChgE)
    : (f.status === 'new' ? s.sNewN : s.sChgN)
  return `${s.row} ${k}${ne}`
}

const PowerSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
    <path d="M12 4v8" /><path d="M7.5 7a7 7 0 1 0 9 0" />
  </svg>
)
const LockSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
    <rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)
const EyeSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
  </svg>
)
const EyeOffSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
    <path d="M9.9 5.2A9.4 9.4 0 0 1 12 5c6.5 0 10 7 10 7a16.2 16.2 0 0 1-2.3 3.2M6.2 6.3A16 16 0 0 0 2 12s3.5 7 10 7a9.3 9.3 0 0 0 3.7-.8" />
  </svg>
)
const FolderSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
)

export function WebserverSync({ sessionId }: { sessionId: string }) {
  // ── connection state ──────────────────────────────────────────────────────
  // No fabricated default — `site` is null until this session's config loads
  // (or the user starts typing one). The form shows blanks, never a stand-in.
  const [site, setSite] = useState<SiteConfig | null>(null)
  const [status, setStatus] = useState<ConnStatus>('off')
  // secure / docroot / user / mode reflect the REAL connect result, not the form.
  const [secure, setSecure] = useState<'ftps' | 'plain' | null>(null)
  const [liveDocroot, setLiveDocroot] = useState<string>('')
  const [liveUser, setLiveUser] = useState<string>('')
  const [liveMode, setLiveMode] = useState<'ftp' | 'file'>('ftp')
  const [stale, setStale] = useState(false)
  const [connError, setConnError] = useState<string | null>(null)

  // ── form view ─────────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showPw, setShowPw] = useState(false)   // password reveal toggle (spec §5.1)
  // Real directory picker — browses the actual server via /api/site/list.
  const [pickerDirs, setPickerDirs] = useState<string[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerErr, setPickerErr] = useState<string | null>(null)

  // ── direction + changes ───────────────────────────────────────────────────
  const [direction, setDirection] = useState<Direction>('up')
  const [view, setView] = useState<ViewRow[]>([])
  const [showChanges, setShowChanges] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [summary, setSummary] = useState<{ ok: number; fail: number } | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const mode = site?.method ?? 'ftp'
  const selectedCount = view.filter(r => r.sel).length
  const canSync = status === 'on' && selectedCount > 0 && !syncing
  const liveDomain = site?.domain || 'not configured'

  // ── field setters ─────────────────────────────────────────────────────────
  // Editing a connection-identity field while connected → stale (prototype
  // markStale), NOT disconnect.
  const setField = useCallback((key: keyof SiteConfig, value: string) => {
    // Update the loaded config, or start a fresh blank one when this session has
    // none yet — empty fields, no fabricated values.
    setSite(prev => ({ method: 'ftp', domain: '', host: '', user: '', password: '', port: '', docroot: '', ...prev, [key]: value }))
    setStatus(st => { if (st === 'on') setStale(true); return st })
  }, [])

  // ── compare (real /api/site/compare) ──────────────────────────────────────
  const compare = useCallback(async (dir: Direction) => {
    setComparing(true)
    setSummary(null)
    try {
      const res = await fetch('/api/site/compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, direction: dir }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const files: CompareFile[] = (data.files || []) as CompareFile[]
      files.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
      setView(files.map(f => ({ file: f, sel: defSel(f), sync: 'idle' as SyncState })))
      setConnError(null)
      setShowChanges(true)
    } catch (e) {
      const msg = String((e as Error).message)
      setConnError(/no site config|requires a destination/i.test(msg) ? 'Not configured yet — set a folder and Save' : msg)
      setView([])
      setShowChanges(true)
    }
    setComparing(false)
  }, [sessionId])

  // ── connect (real /api/site/connect) ──────────────────────────────────────
  // doConnect persists the form first (so the server connects with the current
  // values), then runs connect. On success → status 'on' + auto-compare.
  const doConnect = useCallback(async () => {
    setConnError(null)
    setStale(false)
    setFormOpen(false)
    setStatus('connecting')
    try {
      // Persist current form values so connect uses them.
      await fetch('/api/site/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, site }),
      }).catch(() => {})
      const res = await fetch('/api/site/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setSecure(data.secure ?? null)
      setLiveDocroot(data.docroot || site?.docroot || '')
      setLiveUser(site?.user ?? '')
      setLiveMode(data.method === 'file' ? 'file' : 'ftp')
      setStatus('on')
      void compare(direction)
    } catch (e) {
      setConnError(String((e as Error).message))
      setStatus('off')
    }
  }, [sessionId, site, direction, compare])

  // Power dot OWNS connect/disconnect — never opens the form (spec §5.2).
  const togglePower = useCallback(() => {
    if (status === 'connecting') { setStatus('off'); return }        // abort
    if (status === 'on') {                                            // disconnect
      setStatus('off'); setStale(false); setShowChanges(false)
      setFormOpen(false); setSummary(null); setView([])
      return
    }
    void doConnect()                                                 // connect
  }, [status, doConnect])

  // Stale bar → re-apply edited settings.
  const reconnect = useCallback(() => { setStale(false); void doConnect() }, [doConnect])

  // Card body owns ONE action: toggle the settings form.
  const toggleForm = useCallback(() => { setFormOpen(o => !o); setPickerOpen(false) }, [])

  // Mode switch while connected/connecting → tear down (different transport).
  const setMode = useCallback((m: 'ftp' | 'file') => {
    if (m === (site?.method ?? 'ftp')) return
    // Tear down on any switch; FTP then waits for a connect, File auto-connects
    // via the always-on effect below (Local has no handshake).
    setStatus('off'); setShowChanges(false); setStale(false); setView([]); setSummary(null)
    setSite(prev => ({ domain: '', host: '', user: '', password: '', port: '', docroot: '', ...prev, method: m }))
    setPickerOpen(false)
  }, [site?.method])

  // Browse the REAL server directories at `path` via /api/site/list. Persists the
  // form first so the listing connects with the values currently in the form.
  const listDirs = useCallback(async (path: string): Promise<{ dirs: string[]; base: string }> => {
    setPickerLoading(true); setPickerErr(null)
    try {
      await fetch('/api/site/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, site }),
      }).catch(() => {})
      const rel = path.replace(/^\/+/, '')
      const res = await fetch(`/api/site/list?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(rel)}`)
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      const dirs = (data.entries ?? []).filter((e: { type: string }) => e.type === 'dir').map((e: { name: string }) => e.name as string)
      setPickerDirs(dirs)
      // File mode resolves "" → the user's home and clamps to it; adopt the path the
      // server actually browsed so the picker reflects the real folder, not the OS root.
      const base = typeof data.path === 'string' && data.path ? data.path : path
      return { dirs, base }
    } catch (e) {
      setPickerErr(String((e as Error).message)); setPickerDirs([]); return { dirs: [], base: path }
    } finally {
      setPickerLoading(false)
    }
  }, [sessionId, site])

  // Open the browser; if we're at the root and a domain is entered, jump straight
  // into the server folder that matches the domain (e.g. barbazza.wine).
  const openPicker = useCallback(() => {
    setPickerOpen(o => {
      const next = !o
      if (next) void (async () => {
        const startRaw = (site?.docroot ?? '').replace(/\/+$/, '')
        const { dirs, base } = await listDirs(startRaw || '/')
        // File mode: the server resolved our path to the user's home dir — adopt it
        // (the OS root is never a valid destination).
        if (mode === 'file' && base && base !== startRaw) setField('docroot', base)
        // Domain auto-jump: from the starting dir, dive into the folder matching the
        // domain (e.g. silke-lengler.ch) so the destination is pre-filled.
        const dom = (site?.domain ?? '').trim().toLowerCase()
        if (dom && (startRaw === '' || startRaw === '/')) {
          const short = dom.replace(/\.[^.]+$/, '')
          const hit = dirs.find(d => { const x = d.toLowerCase(); return x === dom || x === short })
            ?? dirs.find(d => { const x = d.toLowerCase(); return short.length >= 3 && x.includes(short) })
          if (hit) { const dest = (mode === 'file' ? base.replace(/\/+$/, '') : '') + '/' + hit; setField('docroot', dest); void listDirs(dest) }
        }
      })()
      return next
    })
  }, [site?.docroot, site?.domain, mode, listDirs, setField])

  // The docroot field IS the browse path — navigate into a subdir / up a level.
  // File mode clamps to the user's home server-side; adopt the path it returns so
  // the field can never claim to be somewhere the server refused to browse.
  const enterDir = useCallback((name: string) => {
    const cur = (site?.docroot ?? '/').replace(/\/+$/, '')
    const next = (cur === '' || cur === '/' ? '/' : cur + '/') + name
    setField('docroot', next)
    void listDirs(next).then(r => { if (mode === 'file' && r.base && r.base !== next) setField('docroot', r.base) })
  }, [site?.docroot, mode, setField, listDirs])

  const upDir = useCallback(() => {
    const cur = (site?.docroot ?? '/').replace(/\/+$/, '')
    const parent = cur.slice(0, cur.lastIndexOf('/')) || '/'
    setField('docroot', parent)
    void listDirs(parent).then(r => { if (mode === 'file' && r.base && r.base !== parent) setField('docroot', r.base) })
  }, [site?.docroot, mode, setField, listDirs])

  // Save the form to /api/site/config (write).
  const saveConfig = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/site/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, site }),
      })
      const data = await res.json().catch(() => ({}))
      if (data && data.site) setSite(data.site)
    } catch { /* non-fatal */ }
    setSaving(false)
    // Refresh the diff once saved — File is always live (given a real folder);
    // FTP only when connected.
    const dest = (site?.docroot ?? '').trim()
    // File mode is "always connected", so `status === 'on'` is ALWAYS true here —
    // it must NOT bypass the destination check, or Save would walk a "/" docroot
    // (the whole server fs → EACCES). Gate File strictly on a real folder.
    if (mode === 'file' ? (!!dest && dest !== '/') : status === 'on') void compare(direction)
  }, [sessionId, site, mode, status, compare, direction])

  // ── direction toggle → re-compare ─────────────────────────────────────────
  const toggleDir = useCallback(() => {
    const next: Direction = direction === 'up' ? 'down' : 'up'
    setDirection(next)
    if (status === 'on') void compare(next)
  }, [direction, status, compare])

  const toggleRow = useCallback((path: string) => {
    if (syncing) return
    setView(prev => prev.map(r => r.file.path === path ? { ...r, sel: !r.sel } : r))
  }, [syncing])

  const toggleFolder = useCallback((dir: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }, [])

  const deselectAll = useCallback(() => {
    setView(prev => prev.map(r => ({ ...r, sel: false })))
  }, [])

  const selectDefaults = useCallback(() => {
    setView(prev => prev.map(r => ({ ...r, sel: defSel(r.file) })))
  }, [])

  // ── sync (real streaming /api/site/sync) ──────────────────────────────────
  const runSync = useCallback(async (onlyFailed?: boolean) => {
    const moving = view.filter(r => onlyFailed ? r.sync === 'err' : r.sel)
    if (!moving.length || syncing) return
    setSyncing(true)
    setSummary(null)
    const movingPaths = new Set(moving.map(r => r.file.path))
    // Reset the rows we're about to move back to idle.
    setView(prev => prev.map(r => movingPaths.has(r.file.path) ? { ...r, sync: 'idle' as SyncState, err: undefined } : r))

    let okN = 0, failN = 0
    try {
      const res = await fetch('/api/site/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, direction, files: moving.map(r => r.file.path) }),
      })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      const handleLine = (raw: string) => {
        const line = raw.trim()
        if (!line) return
        const sp = line.indexOf(' ')
        const tag = sp < 0 ? line : line.slice(0, sp)
        const rest = sp < 0 ? '' : line.slice(sp + 1)
        if (tag === 'SYNC_FILE') {
          setView(prev => prev.map(r => r.file.path === rest ? { ...r, sync: 'work', err: undefined } : r))
        } else if (tag === 'SYNC_OK') {
          setView(prev => prev.map(r => r.file.path === rest ? { ...r, sync: 'ok' } : r))
        } else if (tag === 'SYNC_ERR') {
          const esp = rest.indexOf(' ')
          const p = esp < 0 ? rest : rest.slice(0, esp)
          const reason = esp < 0 ? '' : rest.slice(esp + 1)
          setView(prev => prev.map(r => r.file.path === p ? { ...r, sync: 'err', err: reason } : r))
        } else if (tag === 'SYNC_DONE') {
          rest.split(/\s+/).forEach(kv => {
            const [k, v] = kv.split('=')
            if (k === 'ok') okN = Number(v) || 0
            if (k === 'fail') failN = Number(v) || 0
          })
        }
      }
      // Streaming read loop — drive the per-row animation from REAL lines.
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          handleLine(buf.slice(0, nl))
          buf = buf.slice(nl + 1)
        }
      }
      if (buf.trim()) handleLine(buf)
    } catch (e) {
      setConnError(String((e as Error).message))
      failN = moving.length - okN
    }
    setSummary({ ok: okN, fail: failN })
    setSyncing(false)
  }, [view, syncing, sessionId, direction])

  // ── mount: prefill the form from /api/site/config (read) ──────────────────
  // PLACED LAST — every value/callback it touches is declared ABOVE it, so the
  // dep-array never references an undeclared const (TDZ-safe, the white-screen
  // pitfall). The effect only depends on sessionId.
  useEffect(() => {
    let alive = true
    void fetch('/api/site/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
      .then(r => r.json())
      .then(data => {
        if (!alive) return
        // This session's saved config, or null when it has none — the form shows
        // blanks, never a fabricated default or the previous session's values.
        setSite(data?.site ?? null)
      })
      .catch(() => { if (alive) setSite(null) })
    return () => { alive = false }
  }, [sessionId])

  // File (Local) transport has NO handshake — it is always connected. Whenever
  // File mode is active, flip the panel "on" and surface its changes. There is
  // no connect/disconnect for local, so the power dot is hidden (render below).
  useEffect(() => {
    if (mode !== 'file' || status === 'on') return
    setLiveMode('file'); setSecure(null); setStatus('on')
    // Local is connected instantly, but compare reads the SAVED config — persist
    // the form first so it reflects what's typed. Skip the diff until a real
    // destination is set (empty / "/" has nothing meaningful to compare, and "/"
    // would walk the whole filesystem on the server).
    const dest = (site?.docroot ?? '').trim()
    if (!dest || dest === '/') { setShowChanges(false); return }
    void (async () => {
      await fetch('/api/site/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, site }),
      }).catch(() => {})
      void compare(direction)
    })()
  }, [mode, status, site, sessionId, compare, direction])

  // ── derived connection-card render bits ───────────────────────────────────
  const connClass = (() => {
    if (mode === 'file') return `${s.conn} ${s.green}`   // Local — always connected
    if (status === 'connecting') {
      return `${s.conn} ${secure === 'plain' ? s.yellow : s.green} ${s.fast}`
    }
    if (status === 'on') {
      return `${s.conn} ${secure === 'ftps' ? s.green : s.yellow}`
    }
    return `${s.conn} ${s.err}`
  })()

  const powerCls = status === 'on' ? `${s.power} ${s.powerOn}`
    : status === 'connecting' ? `${s.power} ${s.powerBusy}`
    : `${s.power} ${s.powerOff}`

  // Badge + mark + lines.
  let markIcon = '⚲', badgeCls = s.badgeOff
  let badgeIcon: React.ReactNode = null, badgeLabel: React.ReactNode = 'offline'
  let line1: React.ReactNode = 'not connected', line2: React.ReactNode = null
  if (mode === 'file') {
    // Local — always connected, no handshake.
    markIcon = '🗂'; badgeCls = s.badgeFile; badgeLabel = 'Local'
    line1 = <b>{site?.docroot || '—'}</b>
  } else if (status === 'connecting') {
    badgeCls = secure === 'plain' ? s.badgeFtp : s.badgeFtps
    badgeLabel = 'connecting'; line1 = 'handshaking…'
  } else if (status === 'on') {
    markIcon = '🛰'
    if (secure === 'ftps') { badgeCls = s.badgeFtps; badgeLabel = 'FTPS'; badgeIcon = <LockSvg /> }
    else { badgeCls = s.badgeFtp; badgeLabel = 'FTP · plain' }
    line1 = liveUser || site?.user
    line2 = <>→ <b>{liveDocroot || site?.docroot}</b></>
  }

  const dirLabel = direction === 'up' ? 'Publish' : 'Download'
  const dirArrow = direction === 'up' ? '↑' : '↓'

  const groups = useMemo(() => {
    const map = new Map<string, ViewRow[]>()
    for (const r of view) {
      const i = r.file.path.lastIndexOf('/')
      const dir = i < 0 ? '' : r.file.path.slice(0, i)
      if (!map.has(dir)) map.set(dir, [])
      map.get(dir)!.push(r)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => {
        if (a === '' && b !== '') return -1
        if (b === '' && a !== '') return 1
        return a.localeCompare(b)
      })
  }, [view])

  return (
    <div className={s.pane}>
      {/* ===== CONNECTION accordion card ===== */}
      <div className={connClass}>
        {/* summary */}
        <div className={s.sumv} onClick={toggleForm}>
          <div className={s.mark}>{markIcon}</div>
          <div className={s.meta}>
            <div className={s.site}>
              <span>{liveDomain}</span>
              <span className={`${s.badge} ${badgeCls}`}>{badgeIcon}{badgeLabel}</span>
            </div>
            <div className={s.line}>{line1}</div>
            {line2 ? <div className={s.line}>{line2}</div> : null}
          </div>
          <span className={`${s.chev} ${formOpen ? s.chevOpen : ''}`}>▾</span>
          {/* Power dot is FTP-only — Local has no connect/disconnect. */}
          {mode === 'ftp' && (
            <div
              className={powerCls}
              onClick={(e) => { e.stopPropagation(); togglePower() }}
              title={status === 'on' ? 'Disconnect' : status === 'connecting' ? 'Abort' : 'Connect'}
            >
              {status === 'connecting' ? <span className={s.spin} /> : <PowerSvg />}
            </div>
          )}
        </div>

        {/* stale bar — FTP only (Local has no reconnect) */}
        {status === 'on' && stale && mode === 'ftp' && (
          <div className={s.stalebar} onClick={reconnect}>
            <span>↻</span> Settings changed — <b>reconnect to apply</b>
          </div>
        )}

        {/* form view (expanded) */}
        {formOpen && (
          <div className={s.formv}>
            <div className={s.modetog}>
              <div className={`${s.m} ${mode === 'ftp' ? s.mOn : ''}`} onClick={() => setMode('ftp')}>FTP / FTPS</div>
              <div className={`${s.m} ${mode === 'file' ? s.mOn : ''}`} onClick={() => setMode('file')}>File</div>
            </div>

            {/* Domain — both modes (drives the folder selector's auto-match) */}
            <div className={s.frow}>
              <div className={s.field}>
                <span className={s.cap}>Domain</span>
                <input className={s.input} value={site?.domain ?? ''} spellCheck={false}
                  onChange={e => setField('domain', e.target.value)} />
              </div>
              {mode === 'ftp' && (
                <div className={`${s.field} ${s.fieldPort}`}>
                  <span className={s.cap}>Port</span>
                  <input className={s.input} value={site?.port ?? ''} spellCheck={false}
                    onChange={e => setField('port', e.target.value)} />
                </div>
              )}
            </div>
            {mode === 'ftp' && (
              <>
                <div className={s.field} style={{ marginBottom: 9 }}>
                  <span className={s.cap}>Host</span>
                  <input className={s.input} value={site?.host ?? ''} spellCheck={false}
                    onChange={e => setField('host', e.target.value)} />
                </div>
                <div className={s.field} style={{ marginBottom: 9 }}>
                  <span className={s.cap}>FTP user</span>
                  <input className={s.input} value={site?.user ?? ''} spellCheck={false}
                    onChange={e => setField('user', e.target.value)} />
                </div>
                <div className={s.field}>
                  <span className={s.cap}>Password</span>
                  <div className={s.pwwrap}>
                    <input className={s.input} type={showPw ? 'text' : 'password'} value={site?.password ?? ''} spellCheck={false}
                      onChange={e => setField('password', e.target.value)} />
                    <button type="button" className={s.pweye} onClick={() => setShowPw(v => !v)}
                      title={showPw ? 'Hide password' : 'Show password'}
                      aria-label={showPw ? 'Hide password' : 'Show password'}>
                      {showPw ? <EyeOffSvg /> : <EyeSvg />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Publish/destination folder — REAL directory browser (server dirs
                via /api/site/list). Type a path or browse the actual tree. */}
            <div className={s.field} style={{ marginTop: 9 }}>
              <span className={s.cap}>{mode === 'file' ? 'Destination folder' : 'Publish folder'}</span>
              <div className={s.pwwrap}>
                <input className={s.input} value={site?.docroot ?? ''} placeholder="/" spellCheck={false}
                  onChange={e => setField('docroot', e.target.value)} />
                <button type="button" className={s.pweye} onClick={openPicker} title="Browse folders" aria-label="Browse folders">
                  <FolderSvg />
                </button>
              </div>
              {pickerOpen && (
                <div className={s.picker}>
                  <div className={s.pickerbar}>
                    <button type="button" onClick={upDir} disabled={pickerLoading || !((site?.docroot ?? '/').replace(/\/+$/, ''))}>↑ up</button>
                    <span className={s.pickerpath}>{site?.docroot || '/'}</span>
                    <button type="button" className={s.pickeruse} onClick={() => setPickerOpen(false)}>Done</button>
                  </div>
                  {pickerLoading ? <div className={s.p}>loading…</div>
                    : pickerErr ? <div className={s.p} style={{ color: 'var(--err-t)' }}>error · {pickerErr}</div>
                    : pickerDirs.length === 0 ? <div className={s.p}>— no subfolders here —</div>
                    : pickerDirs.map(d => (
                      <div key={d} className={s.p} onClick={() => enterDir(d)}><span style={{ color: 'var(--dim)' }}>📁</span> {d}</div>
                    ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 13, alignItems: 'center' }}>
              <button
                onClick={saveConfig}
                disabled={saving}
                style={{
                  fontFamily: 'var(--mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em',
                  textTransform: 'uppercase', borderRadius: 8, padding: '10px 14px',
                  cursor: saving ? 'default' : 'pointer', border: '1px solid var(--border-strong)',
                  background: 'var(--card)', color: 'var(--muted)',
                }}
              >{saving ? 'Saving…' : 'Save'}</button>
              <div className={s.formhint} style={{ flex: 1, marginTop: 0 }}>
                {mode === 'file'
                  ? <>Set a <b>destination folder</b>, then <b>Save</b> · tap the card to close</>
                  : <>Hit the <b>power dot</b> above to connect · tap the card to close</>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== action row: direction toggle + sync ===== */}
      <div className={`${s.actions} ${status !== 'on' ? s.actionsDis : ''}`}>
        <div className={`${s.dirtog} ${direction === 'up' ? s.dirtogOn : ''}`} onClick={toggleDir}>
          <span className={s.ar}>{dirArrow}</span>
          <span>{dirLabel}</span>
          <span className={s.sw} />
        </div>
        <button
          className={`${s.syncbtn} ${direction === 'down' ? s.syncbtnDl : ''}`}
          onClick={() => runSync(false)}
          disabled={!canSync}
        >
          {syncing
            ? <span className={s.spin} />
            : <>Sync <span className={s.n}>{selectedCount}</span> {dirArrow}</>}
        </button>
      </div>

      {/* ===== changes — color-coded, direction-driven ===== */}
      {showChanges && (
        <div className={s.changes}>
          <div className={s.chead}>
            <div className={s.ttl}>
              <b>{selectedCount}</b> to {direction === 'up' ? 'publish' : 'download'} ·{' '}
              {direction === 'up' ? 'local → server' : 'server → session'}
            </div>
            <div className={s.headActions}>
              <button className={s.selBtn} onClick={deselectAll} title="Deselect all">none</button>
              <span className={s.selDiv}>·</span>
              <button className={s.selBtn} onClick={selectDefaults} title="Restore default selection">reset</button>
              <button className={s.recomp} onClick={() => compare(direction)} title="Re-compare"
                disabled={comparing}>↻</button>
            </div>
          </div>
          <div className={s.legend}>
            <i><b style={{ background: 'rgba(96,165,250,.5)' }} />new</i>
            <i><b style={{ background: 'rgba(250,204,21,.5)' }} />changed</i>
            <i><b style={{ background: '#fff' }} />unchanged</i>
            <i><b style={{ background: '#dde4ec' }} />non-essential</i>
          </div>
          <div className={s.clist}>
            {view.length === 0 ? (
              <div className={s.gh}>
                {connError ? `error · ${connError}` : `nothing to ${direction === 'up' ? 'upload' : 'download'}`}
              </div>
            ) : groups.map(([dir, rows]) => (
              <div key={dir || '__root'}>
                {(dir || groups.length > 1) && (
                  <div className={s.dirHead} onClick={() => toggleFolder(dir)}>
                    <span className={s.dirChev}>{collapsed.has(dir) ? '▸' : '▾'}</span>
                    <span className={s.dirName}>{dir ? `${dir}/` : '/'}</span>
                    <span className={s.dirCount}>{rows.filter(r => r.sel).length}/{rows.length}</span>
                  </div>
                )}
                {!collapsed.has(dir) && rows.map(r => {
                  const { file: f } = r
                  const displayPath = dir ? f.path.slice(dir.length + 1) : f.path
                  const src = direction === 'up' ? f.localSize : f.remoteSize
                  const dst = direction === 'up' ? f.remoteSize : f.localSize
                  const cls = r.sync === 'work' ? `${rowClass(f)} ${s.rowWork}`
                    : r.sync === 'ok' ? `${rowClass(f)} ${s.rowOk}`
                    : r.sync === 'err' ? `${rowClass(f)} ${s.rowErr}`
                    : rowClass(f)
                  return (
                    <div key={f.path} className={cls}>
                      <div className={`${s.cb} ${r.sel ? s.cbOn : ''}`} onClick={() => toggleRow(f.path)} />
                      <PathCell path={displayPath} />
                      {r.sync === 'work' ? (
                        <span className={s.stat}><span className={s.mini} /></span>
                      ) : r.sync === 'ok' ? (
                        <span className={s.stat}>✓</span>
                      ) : r.sync === 'err' ? (
                        <span className={s.stat}>✕ {r.err || ''}</span>
                      ) : f.status === 'changed' ? (
                        <span className={s.sz}><b>{fmtBytes(src)}</b> ›{fmtBytes(dst)}</span>
                      ) : f.status === 'new' ? (
                        <span className={s.sz}><b>{fmtBytes(src)}</b></span>
                      ) : (
                        <span className={`${s.sz} ${s.szDim}`}>{fmtBytes(src)}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {summary && (
            <div className={s.synced}>
              {summary.fail > 0 ? (
                <>
                  <span style={{ color: 'var(--err-t)' }}>✕ {summary.fail} failed</span>
                  {' · '}<span className={s.sh}>⛉</span> {summary.ok} {direction === 'up' ? 'live' : 'pulled'}
                  {' · backup saved'}
                  <button
                    onClick={() => runSync(true)}
                    disabled={syncing}
                    style={{
                      marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
                      border: '1px solid var(--err-bd)', background: 'transparent', color: 'var(--err-t)',
                      borderRadius: 6, padding: '3px 8px', cursor: syncing ? 'default' : 'pointer',
                    }}
                  >↻ Retry {summary.fail}</button>
                </>
              ) : (
                <><span className={s.sh}>⛉</span> {summary.ok}{' '}
                  {direction === 'up' ? `live on ${liveDomain}` : 'pulled in'} · backup saved</>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default WebserverSync
