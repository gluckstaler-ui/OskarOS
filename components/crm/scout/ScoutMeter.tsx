'use client'
// ScoutMeter — the 5-segment meter used by ScoutRow's strip + ScoutDossier's
// rows. Tiny atom (kept as its own file so both consumers import the same
// thing instead of duplicating). WP-SCOUT-7.

interface Props {
  /** 'pal' for palate (phosphor green) · 'exe' for execution (amber). */
  cls: 'pal' | 'exe'
  /** 1-5 or null/undefined for "not scouted yet" (segments all off, value shows —). */
  n: number | null | undefined
}

export function ScoutMeter({ cls, n }: Props) {
  return (
    <span className={`scout-meter ${cls}`}>
      <span className="scout-segs">
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={`scout-seg${typeof n === 'number' && i <= n ? ' on' : ''}`} />
        ))}
      </span>
      <span className="n">
        {typeof n === 'number' ? n : '—'}<span className="mx">/5</span>
      </span>
    </span>
  )
}
