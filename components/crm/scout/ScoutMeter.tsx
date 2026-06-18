'use client'
// ScoutMeter — the 5-segment meter used by ScoutRow's strip + ScoutDossier's
// rows. Tiny atom (kept as its own file so both consumers import the same
// thing instead of duplicating). WP-SCOUT-7.

interface Props {
  /** 'pal' for palate (phosphor green) · 'exe' for execution (amber). */
  cls: 'pal' | 'exe'
  /** 0-5 or null/undefined for "not scouted yet" (segments all off, value shows —). */
  n: number | null | undefined
  /** Click-to-set (Ralph 2026-06-10 · TASTED redesign) — segments become
   *  buttons, same interaction as Kanban's BUYING bars: click segment i sets
   *  i, clicking the current value steps down to i−1 (so 0 is reachable).
   *  Omit for read-only meters (PALAT — it's derived). */
  onSet?: (n: number) => void
}

export function ScoutMeter({ cls, n, onSet }: Props) {
  const segs = [1, 2, 3, 4, 5].map((i) => {
    const on = typeof n === 'number' && i <= n ? ' on' : ''
    return onSet ? (
      <button
        key={i}
        type="button"
        className={`scout-seg${on}`}
        onClick={() => onSet(typeof n === 'number' && n === i ? i - 1 : i)}
        title={`${i}/5`}
      />
    ) : (
      <i key={i} className={`scout-seg${on}`} />
    )
  })
  return (
    <span className={`scout-meter ${cls}`}>
      <span className="scout-segs">{segs}</span>
      <span className="n">
        {typeof n === 'number' ? n : '—'}<span className="mx">/5</span>
      </span>
    </span>
  )
}
