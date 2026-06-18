'use client'
// ============================================================================
// DecisionDeck — the sticky bottom action bar (WP-SCOUT-7, Ralph 2026-06-03).
//
// Visible only when ≥ 1 row is selected. Actions:
//   ◐ Scout N    — the Scout (Sonnet) tastes the selected raw + stale-era
//                  rows in parallel. N reflects the actionable count.
//                  (Label renamed Taste → Scout, Ralph 2026-06-11 — the
//                  button names the AGENT, matching ◎ Research = Consular.)
//   ◎ Research N — hand the N selected website-having rows to the Consular
//                  for the cold-lead teardown (WP-23, Ralph 2026-06-10).
//   → Promote    — mints prospects @ Incoming (WP-SCOUT-8), carries heat.
//   ✕ Discard    — one-click; stamps rejected_at, no prompt (§17 [SCOUT-F]).
//
// Net-new component; the styling reuses `.scout-deck` / `.scout-act` in
// app/crm/scout.css (kept 1:1 with the canonical mockup).
// ============================================================================

interface Props {
  selectedCount: number
  rawSelectedCount: number       // subset of selected that's still 'raw' (tastable)
  researchSelectedCount: number  // subset of selected that has a website (researchable)
  onTaste: () => void
  onResearch: () => void
  onPromote: () => void
  onDiscard: () => void
}

export function DecisionDeck({
  selectedCount, rawSelectedCount, researchSelectedCount,
  onTaste, onResearch, onPromote, onDiscard,
}: Props) {
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
        ◐ Scout {rawSelectedCount}
      </button>
      <button
        className="scout-act research"
        disabled={researchSelectedCount === 0}
        onClick={onResearch}
        title="Hand the selected rows to the Consular for the cold-lead teardown"
      >
        ◎ Research {researchSelectedCount}
      </button>
      <button className="scout-act promote" onClick={onPromote}>→ Promote</button>
      <button className="scout-act discard" onClick={onDiscard}>✕ Discard</button>
    </div>
  )
}
