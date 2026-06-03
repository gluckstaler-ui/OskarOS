'use client'
// ============================================================================
// DecisionDeck — the sticky bottom action bar (WP-SCOUT-7, Ralph 2026-06-03).
//
// Visible only when ≥ 1 row is selected. Three actions:
//   ◐ Taste N   — enabled only for selected RAW rows (greenfield/scouted
//                 rows are ignored). N reflects the actionable count.
//   → Promote   — mints prospects @ Incoming (WP-SCOUT-8), carries heat.
//   ✕ Discard   — one-click; stamps rejected_at, no prompt (§17 [SCOUT-F]).
//
// Net-new component; the styling reuses `.scout-deck` / `.scout-act` in
// app/crm/scout.css (kept 1:1 with the canonical mockup).
// ============================================================================

interface Props {
  selectedCount: number
  rawSelectedCount: number      // subset of selected that's still 'raw' (tastable)
  onTaste: () => void
  onPromote: () => void
  onDiscard: () => void
}

export function DecisionDeck({ selectedCount, rawSelectedCount, onTaste, onPromote, onDiscard }: Props) {
  if (selectedCount === 0) return null
  return (
    <div className="scout-deck">
      <span className="sum"><b>{selectedCount}</b> selected</span>
      <span className="vr" />
      <button
        className="scout-act taste"
        disabled={rawSelectedCount === 0}
        onClick={onTaste}
      >
        ◐ Taste {rawSelectedCount}
      </button>
      <button className="scout-act promote" onClick={onPromote}>→ Promote</button>
      <button className="scout-act discard" onClick={onDiscard}>✕ Discard</button>
    </div>
  )
}
