// ============================================================
// _shell.js — shared utilities for admin.html + crm.html
// Ralph 2026-05-25 · TWO-PAGE SPLIT
// ============================================================
// Loaded by BOTH pages. Owns:
//   · OSKAR_PAGE detection (admin vs crm)
//   · cross-page navigation helper
//   · escapeHtml (used in 100+ places per page)
//   · theme toggle + billing-mode toggle (with localStorage so
//     state survives cross-page transitions — was a no-op before
//     the split, and the lack of persistence would be jarring
//     when clicking from admin.html → crm.html)
// Page-specific JS (crm*, settings*, wa*Poll*, loadSession*,
// renderAgent*, etc.) stays inline in each page.
// ============================================================

// ── PAGE IDENTITY ─────────────────────────────────────────────
// One JS source served from /admin.html and /crm.html. Detect
// which page we're on so foreign-view clicks route correctly.
const OSKAR_PAGE = window.location.pathname.endsWith('/crm.html') ? 'crm' : 'admin';
const OSKAR_OWN_VIEWS = OSKAR_PAGE === 'crm'
    ? ['overview', 'kanban']
    : ['sessions', 'analytics', 'settings'];
const OSKAR_FOREIGN_PAGE = OSKAR_PAGE === 'crm' ? '/admin.html' : '/crm';  // admin tabs → React /crm route (was '/crm.html'; migration step, see app/crm/page.tsx)
const OSKAR_DEFAULT_VIEW = OSKAR_PAGE === 'crm' ? 'overview' : 'sessions';

// Returns true if it took action (navigated away). switchView calls
// this as its first step so foreign-view onclick handlers (e.g.
// "Overview" pill in admin.html) navigate cross-page transparently.
function maybeNavigateAcrossPages(view) {
    if (OSKAR_OWN_VIEWS.includes(view)) return false;
    window.location.href = `${OSKAR_FOREIGN_PAGE}?view=${encodeURIComponent(view)}`;
    return true;
}

// ── UTILITIES ─────────────────────────────────────────────────
function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── THEME ─────────────────────────────────────────────────────
// Persist across page transitions. Was previously in-memory only,
// which meant toggling theme on admin.html then clicking Overview
// (→ crm.html) would reset to onyx. That's not seamless.
// Ralph 2026-05-29 · `?theme=polar|onyx` URL param overrides localStorage —
// lets Playwright screenshots target a specific theme without touching
// browser storage. Param is sticky (writes to localStorage too).
let currentTheme = (() => {
    try {
        const fromQuery = new URLSearchParams(location.search).get('theme');
        if (fromQuery === 'polar' || fromQuery === 'onyx') {
            try { localStorage.setItem('oskar-theme', fromQuery); } catch {}
            return fromQuery;
        }
        return localStorage.getItem('oskar-theme') === 'polar' ? 'polar' : 'onyx';
    } catch { return 'onyx'; }
})();

// Apply theme BEFORE first paint to avoid the onyx→polar flash.
// Runs synchronously since _shell.js is loaded without `defer`.
if (currentTheme === 'polar') {
    document.documentElement.setAttribute('data-theme', 'polar');
}

function toggleTheme() {
    if (currentTheme === 'onyx') {
        currentTheme = 'polar';
        document.documentElement.setAttribute('data-theme', 'polar');
        document.getElementById('theme-icon')?.setAttribute('data-lucide', 'sun');
    } else {
        currentTheme = 'onyx';
        document.documentElement.removeAttribute('data-theme');
        document.getElementById('theme-icon')?.setAttribute('data-lucide', 'moon');
    }
    try { localStorage.setItem('oskar-theme', currentTheme); } catch {}
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

// Sync the theme-icon glyph + lucide render once the DOM is ready
// (icon element lives in the header — exists only after body parse).
document.addEventListener('DOMContentLoaded', () => {
    const icon = document.getElementById('theme-icon');
    if (icon) icon.setAttribute('data-lucide', currentTheme === 'polar' ? 'sun' : 'moon');
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
});

// ── BILLING MODE ──────────────────────────────────────────────
// Same persistence story as theme.
let billingMode = (() => {
    try { return localStorage.getItem('oskar-billing') === 'api' ? 'api' : 'cli'; }
    catch { return 'cli'; }
})();

function setBillingMode(mode) {
    billingMode = mode;
    document.getElementById('billing-cli')?.classList.toggle('active', mode === 'cli');
    document.getElementById('billing-api')?.classList.toggle('active', mode === 'api');
    try { localStorage.setItem('oskar-billing', mode); } catch {}
    // Flip the usage badge's cost/context to the newly-selected mode (mirrors
    // the studio UsageBadge — CLI and API track separate cost/context blocks).
    if (typeof refreshUsageBadge === 'function') refreshUsageBadge();
}

// Re-apply billing mode active state on DOM ready (buttons exist
// only after body parse). Same pattern as theme above.
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('billing-cli')?.classList.toggle('active', billingMode === 'cli');
    document.getElementById('billing-api')?.classList.toggle('active', billingMode === 'api');
});

// ── ORDER 66 BUTTON — Consular hard compaction (WP-114/115) ───
// Shaped against db/SESSION.md — the Consular's single CRM-wide
// session log (§16.1 + the agent file's BOOT SEQUENCE), NOT a
// per-studio-session file. Sage-240/40 compresses it at ~240KB, so
// the ⚡ icon tracks that cut line when idle: green fresh · amber
// filling · red cut-due (full status in the hover title). Reads the
// cheap /consular/bloat endpoint. The mount (#order66-gauge) is a
// Studio-parity .os-order-pill button in crm.html's top bar; on
// admin.html it's absent and this is a no-op. The click handler
// (triggerConsularOrder66) runs Order 66 against the __crm__ session.
async function refreshOrder66Gauge() {
    if (order66Running) return; // mid-run — don't stomp the EXECUTING… label
    // Fetch the bloat data regardless of whether #order66-gauge is mounted —
    // the React TopBar (admin.html, app/crm) reads the same data via the
    // 'order66-bloat' CustomEvent dispatched below; subscribing is the
    // reuse pattern (Ralph 2026-06-09: no duplicate poller in the React
    // island). The legacy DOM mutation path stays for the vanilla #order66-gauge.
    let pct, color, bytes, cutBytes;
    try {
        const r = await fetch('/api/admin/crm/consular/bloat', { cache: 'no-store' });
        if (!r.ok) return;
        ({ pct, color, bytes, cutBytes } = await r.json());
    } catch { return; /* offline / endpoint down — keep last state */ }

    // Broadcast to any subscriber — React TopBar reads pct via this event.
    try {
        window.dispatchEvent(new CustomEvent('order66-bloat', { detail: { pct, color, bytes, cutBytes } }));
    } catch { /* CustomEvent unsupported — no-op */ }

    // Legacy DOM path — drive #order66-gauge if it's mounted (crm.html).
    const el = document.getElementById('order66-gauge');
    if (!el) return;
    const hex = color === 'red' ? '#ef4444' : color === 'amber' ? '#f59e0b' : '#10b981';
    const dot = el.querySelector('[data-gauge-dot]');
    if (dot) { dot.style.color = hex; dot.style.filter = color === 'red' ? `drop-shadow(0 0 3px ${hex})` : 'none'; }
    el.title = `Consular session log — ${(bytes / 1024).toFixed(0)}KB of ${(cutBytes / 1024).toFixed(0)}KB (Sage-240 cut). Order 66 ${pct >= 100 ? 'overdue' : pct >= 60 ? 'due soon' : 'not needed'}. · click to run Order 66`;
}

// Click → run Order 66 against the Consular session (db/SESSION.md).
// The 240/40 skips if the log is under 240KB; the Portrait repaints
// db/user.md. The button mirrors the studio TopBar (components/TopBar.tsx):
//   ORDER 66 (idle) → EXECUTING… (running, disabled) → RESPAWNED (complete,
//   3s) → ORDER 66. SSE progress also lands in the console.
// Verified e2e 2026-05-28 (240/40 early-aborts at 2KB).
let order66Running = false;

// Drive the button's three visual states. 'idle' restores the ⚡ bloat tint
// (via the next refreshOrder66Gauge); 'running'/'complete' clear the inline
// tint so the ⚡ inherits the pill's currentColor (red, then green). Also
// dispatches the 'order66-status' CustomEvent so React subscribers (admin
// island, React CRM) update their state in lockstep — single source of truth.
function setOrder66State(el, state) {
    // Broadcast to React subscribers FIRST (works whether or not `el` exists).
    try {
        window.dispatchEvent(new CustomEvent('order66-status', { detail: state }));
    } catch { /* CustomEvent unsupported — no-op */ }

    // Legacy DOM path — only when #order66-gauge is mounted.
    if (!el) return;
    const label = el.querySelector('[data-order66-label]');
    const dot = el.querySelector('[data-gauge-dot]');
    el.classList.remove('danger', 'complete');
    if (state === 'idle') {
        el.disabled = false;
        el.classList.add('danger');
        if (label) label.textContent = 'ORDER 66';
        // ⚡ bloat tint re-applied by refreshOrder66Gauge()
    } else {
        el.disabled = true;
        if (dot) { dot.style.color = ''; dot.style.filter = ''; } // inherit pill color
        if (state === 'running') {
            el.classList.add('danger');
            if (label) label.textContent = 'EXECUTING…';
        } else { // complete
            el.classList.add('complete');
            if (label) label.textContent = 'RESPAWNED';
        }
    }
}

function triggerConsularOrder66() {
    if (order66Running) return;
    if (!confirm("Run Order 66 — distill the Consular's memory?\n\nSage compresses the session log (skips if under 240KB) and repaints Filippo's portrait. ~30–60s.")) return;
    // `el` may be null on surfaces that use the React TopBar (no #order66-gauge
    // mount) — setOrder66State handles that by dispatching the event only and
    // skipping DOM mutation. The SSE + state transitions stay here so the
    // React island doesn't reimplement them (Ralph 2026-06-09: reuse, not port).
    const el = document.getElementById('order66-gauge');
    order66Running = true;
    setOrder66State(el, 'running');

    const finish = (es, ok) => {
        try { es.close(); } catch {} // EventSource auto-reconnects — must close
        order66Running = false;
        if (ok) {
            setOrder66State(el, 'complete');
            // Hold the green RESPAWNED beat, then settle back to idle + bloat tint.
            setTimeout(() => { setOrder66State(el, 'idle'); refreshOrder66Gauge(); }, 3000);
        } else {
            setOrder66State(el, 'idle');
            refreshOrder66Gauge();
        }
    };
    const es = new EventSource('/api/order66?session=__crm__');
    es.onmessage = (e) => {
        let ev; try { ev = JSON.parse(e.data); } catch { return; }
        if (ev.agent) console.log(`[Order66] ${ev.agent}: ${ev.phase}${ev.detail ? ' — ' + ev.detail : ''}`);
        else if (ev.phase) console.log(`[Order66] ${ev.phase}`);
        // Ralph 2026-05-29 · the chat log persists across reloads, but the
        // Consular's SESSION.md just got cut — refs in the chat now point at
        // lore that doesn't exist on his side. Drop the local thread when
        // Sage-240 actually triggered (skipped if SESSION.md was under 240KB).
        if (ev.phase === 'compaction-complete' && ev.sage240_40?.triggered) {
            if (typeof window.crmChatClear === 'function') {
                try { window.crmChatClear(); } catch {}
                console.log('[Order66] Cleared local chat log (mirrors Consular SESSION.md cut)');
            }
        }
        if (ev.phase === 'bridge-ready') finish(es, true);
        else if (ev.phase === 'error') finish(es, false);
    };
    es.onerror = () => finish(es, false);
}

document.addEventListener('DOMContentLoaded', () => {
    const gauge = document.getElementById('order66-gauge');
    if (gauge) gauge.addEventListener('click', triggerConsularOrder66);
    refreshOrder66Gauge();
    setInterval(refreshOrder66Gauge, 30000); // cheap fs.stat; 30s cadence
});

// ── CONSULAR USAGE BADGE — $spend · MODE · ↻reset · ●context% ──
// Mirrors the studio UsageBadge (components/UsageBadge.tsx) for the
// Consular's __crm__ session. Reads /api/sessions/__crm__/usage; the
// CLI/API toggle flips which per-mode cost/context block is shown
// (setBillingMode calls refreshUsageBadge). ↻ resets the counter.
// Mount (#crm-usage-badge) lives in crm.html's top bar; absent on
// admin.html → no-op.
// Token formatter — mirrors UsageBadge.formatTokensLocal (12500 → "12.5K").
function fmtTok(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
}
async function refreshUsageBadge() {
    const el = document.getElementById('crm-usage-badge');
    if (!el) return; // not mounted on this page
    try {
        const r = await fetch('/api/sessions/__crm__/usage', { cache: 'no-store' });
        if (!r.ok) return;
        const u = await r.json();
        const block = billingMode === 'api' ? u.api : u.cli;
        const costNum = block?.cost ?? u.totals?.cost ?? 0;
        const ctx = block?.latestContextPct ?? u.display?.latestContextPct ?? 0;
        // Match the studio UsageBadge thresholds: amber at 50%, red at 75%.
        const ctxHex = ctx >= 75 ? '#ef4444' : ctx >= 50 ? '#f59e0b' : '#10b981';
        // The gauge's core read: tokens used / model context window.
        const size = block?.latestContextSize ?? u.display?.latestContextSize ?? 0;
        const win = block?.latestContextWindow ?? u.display?.latestContextWindow ?? 200000;
        const cost = el.querySelector('[data-usage-cost]');
        const mode = el.querySelector('[data-usage-mode]');
        const dot = el.querySelector('[data-usage-dot]');
        const ctxEl = el.querySelector('[data-usage-ctx]');
        const tokEl = el.querySelector('[data-usage-tokens]');
        if (cost) { cost.textContent = '$ ' + Number(costNum).toFixed(2); cost.style.color = costNum > 0 ? '#10b981' : 'var(--text-muted)'; }
        if (mode) mode.textContent = billingMode.toUpperCase();
        if (dot) dot.style.background = ctxHex;
        if (ctxEl) { ctxEl.textContent = ctx + '%'; ctxEl.style.color = ctxHex; }
        if (tokEl) { tokEl.textContent = fmtTok(size) + '/' + fmtTok(win); tokEl.style.color = ctxHex; }
    } catch { /* offline / endpoint down — keep last rendered state */ }
}

// ↻ resets the displayed counter (bridge cost baseline preserved server-side).
async function resetConsularUsage() {
    if (!confirm('Reset the Consular usage counter?\n\nZeros the displayed $/token total for the __crm__ session. The bridge cost baseline is preserved so future turns still count correctly.')) return;
    try { await fetch('/api/sessions/__crm__/usage', { method: 'DELETE' }); } catch {}
    refreshUsageBadge();
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('[data-usage-reset]')?.addEventListener('click', resetConsularUsage);
    refreshUsageBadge();
    setInterval(refreshUsageBadge, 30000); // same cadence as the bloat gauge
});
