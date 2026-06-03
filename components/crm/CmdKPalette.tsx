'use client'

// ============================================================================
// CmdKPalette — ⌘K / Ctrl+K quick switcher. Ports crm.html crmCmdKOpen/Render/
// Keydown/Pick: a search overlay over the prospect corpus (the comment in
// crm.html: "crm.html only indexes prospects"). Type to filter, ↑↓ to move,
// ↵ to open the lead, esc to close. onPick(id) hands the lead back to the host.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Prospect } from '@/lib/crm-store'

interface CmdKPaletteProps {
  prospects: Prospect[]
  onPick: (id: string) => void
  onClose: () => void
}

export function CmdKPalette({ prospects, onPick, onClose }: CmdKPaletteProps) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    if (!query) return prospects.slice(0, 50)
    return prospects
      .filter((p) =>
        [p.company, p.contact_name, p.notes, p.tags, p.stage]
          .filter(Boolean).join(' ').toLowerCase().includes(query),
      )
      .slice(0, 50)
  }, [prospects, q])

  useEffect(() => { setIdx(0) }, [q])

  const pick = (p: Prospect | undefined) => { if (p) { onPick(p.id); onClose() } }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh', background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="presentation"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); onClose() }
        else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
        else if (e.key === 'Enter') { e.preventDefault(); pick(results[idx]) }
      }}
    >
      <div
        className="bento-card"
        style={{ width: 'min(620px, 92vw)', maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search leads…  (company · contact · notes · tags)"
          style={{ width: '100%', padding: '14px 16px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-card)', color: 'var(--text-main)', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
        />
        <div style={{ overflowY: 'auto', minHeight: 0, padding: 6 }}>
          {results.length === 0 ? (
            <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>No matches</div>
          ) : (
            results.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p)}
                onMouseEnter={() => setIdx(i)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
                  padding: '9px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', textAlign: 'left',
                  background: i === idx ? 'var(--bg-card-hover, rgba(255,255,255,0.05))' : 'transparent',
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.company || 'Untitled'}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)', flexShrink: 0 }}>
                  {[p.contact_name, p.stage].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))
          )}
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-card)', fontSize: 10, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
          ↑↓ navigate · ↵ open · esc close
        </div>
      </div>
    </div>
  )
}
