# Tweaks: Real-time Variant Controls

Tweaks are a core capability of this skill — they let the user switch between variants and adjust parameters live, without touching code.

**Cross-environment compatibility**: some native design-agent environments (Claude.ai Artifacts) rely on the host's postMessage to write tweak values back into source for persistence. This skill uses a **pure-frontend localStorage approach** — same effect (state survives reload) but persistence happens in the browser's localStorage instead of source files. This works in any agent environment (Claude Code / Codex / Cursor / Trae / etc.).

## When to Add Tweaks

- The user explicitly asks for "tunable params" / "switch between versions"
- The design has multiple variants worth comparing
- The user didn't ask, but you judge that **a few thoughtful tweaks would help them see the possibility space**

Default recommendation: **add 2-3 tweaks to every design** (color theme / type size / layout variants) even if the user didn't ask — showing the user what's possible is part of the design service.

## Implementation (pure-frontend version)

### Basic structure

```jsx
const TWEAK_DEFAULTS = {
  "primaryColor": "#D97757",
  "fontSize": 16,
  "density": "comfortable",
  "dark": false
};

function useTweaks() {
  const [tweaks, setTweaks] = React.useState(() => {
    try {
      const stored = localStorage.getItem('design-tweaks');
      return stored ? { ...TWEAK_DEFAULTS, ...JSON.parse(stored) } : TWEAK_DEFAULTS;
    } catch {
      return TWEAK_DEFAULTS;
    }
  });

  const update = (patch) => {
    const next = { ...tweaks, ...patch };
    setTweaks(next);
    try {
      localStorage.setItem('design-tweaks', JSON.stringify(next));
    } catch {}
  };

  const reset = () => {
    setTweaks(TWEAK_DEFAULTS);
    try {
      localStorage.removeItem('design-tweaks');
    } catch {}
  };

  return { tweaks, update, reset };
}
```

### Tweaks panel UI

Floating panel in the bottom-right corner, collapsible:

```jsx
function TweaksPanel() {
  const { tweaks, update, reset } = useTweaks();
  const [open, setOpen] = React.useState(false);

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      zIndex: 9999,
    }}>
      {open ? (
        <div style={{
          background: 'white',
          border: '1px solid #e5e5e5',
          borderRadius: 12,
          padding: 20,
          boxShadow: '0 10px 40px rgba(0,0,0,0.12)',
          width: 280,
          fontFamily: 'system-ui',
          fontSize: 13,
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
          }}>
            <strong>Tweaks</strong>
            <button onClick={() => setOpen(false)} style={{
              border: 'none', background: 'none', cursor: 'pointer', fontSize: 16,
            }}>×</button>
          </div>

          {/* Color */}
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div style={{ marginBottom: 4, color: '#666' }}>Primary color</div>
            <input
              type="color"
              value={tweaks.primaryColor}
              onChange={e => update({ primaryColor: e.target.value })}
              style={{ width: '100%', height: 32 }}
            />
          </label>

          {/* Font size slider */}
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div style={{ marginBottom: 4, color: '#666' }}>Font size ({tweaks.fontSize}px)</div>
            <input
              type="range"
              min={12} max={24} step={1}
              value={tweaks.fontSize}
              onChange={e => update({ fontSize: +e.target.value })}
              style={{ width: '100%' }}
            />
          </label>

          {/* Density select */}
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div style={{ marginBottom: 4, color: '#666' }}>Density</div>
            <select
              value={tweaks.density}
              onChange={e => update({ density: e.target.value })}
              style={{ width: '100%', padding: 6 }}
            >
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
          </label>

          {/* Dark mode toggle */}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16,
          }}>
            <input
              type="checkbox"
              checked={tweaks.dark}
              onChange={e => update({ dark: e.target.checked })}
            />
            <span>Dark mode</span>
          </label>

          <button onClick={reset} style={{
            width: '100%',
            padding: '8px 12px',
            background: '#f5f5f5',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 12,
          }}>Reset</button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          style={{
            background: '#1A1A1A',
            color: 'white',
            border: 'none',
            borderRadius: 999,
            padding: '10px 16px',
            fontSize: 12,
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >⚙ Tweaks</button>
      )}
    </div>
  );
}
```

### Applying Tweaks

Use Tweaks in your main component:

```jsx
function App() {
  const { tweaks } = useTweaks();

  return (
    <div style={{
      '--primary': tweaks.primaryColor,
      '--font-size': `${tweaks.fontSize}px`,
      background: tweaks.dark ? '#0A0A0A' : '#FAFAFA',
      color: tweaks.dark ? '#FAFAFA' : '#1A1A1A',
    }}>
      {/* Your content */}
      <TweaksPanel />
    </div>
  );
}
```

Use the variables in CSS:

```css
button.cta {
  background: var(--primary);
  color: white;
  font-size: var(--font-size);
}
```

## Typical Tweak Options

What tweaks to add for each design type:

### Universal
- Primary color (color picker)
- Font size (slider 12-24px)
- Typeface (select: display font vs body font)
- Dark mode (toggle)

### Slide deck
- Theme (light/dark/brand)
- Background style (solid/gradient/image)
- Type contrast (more decorative vs more restrained)
- Information density (minimal/standard/dense)

### Product prototype
- Layout variants (layout A / B / C)
- Animation speed (0.5x-2x)
- Data volume (mock data 5/20/100 entries)
- State (empty/loading/success/error)

### Animation
- Speed (0.5x-2x)
- Loop (once/loop/ping-pong)
- Easing (linear/easeOut/spring)

### Landing page
- Hero style (image/gradient/pattern/solid)
- CTA copy (a few variants)
- Structure (single column / two column / sidebar)

## Tweaks Design Principles

### 1. Meaningful options, not fiddly ones

Every tweak must surface a **real design choice**. Don't add tweaks no one would actually toggle (e.g. a `border-radius` 0-50px slider — every middle value looks ugly).

Good tweaks expose **discrete, considered variants**:
- "Corner style": none / subtle / large (three options)
- Not: "Corner radius": 0-50px slider

### 2. Less is more

A Tweaks panel should have **at most 5-6 options**. More than that and it becomes a "config page" — losing the point of fast variant exploration.

### 3. Defaults are the finished design

Tweaks are **icing on the cake**. The defaults must themselves be a complete, shippable design. What the user sees with the panel closed is the deliverable.

### 4. Group sensibly

When there are many options, group them:

```
---- Visual ----
Primary color | Font size | Dark mode

---- Layout ----
Density | Sidebar position

---- Content ----
Data volume | State
```

## Forward-compatible with Source-level Persistence Hosts

If you'll later upload the design to an environment that supports source-level tweaks (like Claude.ai Artifacts), keep an **EDITMODE marker block**:

```jsx
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "primaryColor": "#D97757",
  "fontSize": 16,
  "density": "comfortable",
  "dark": false
}/*EDITMODE-END*/;
```

The marker has **no effect** under the localStorage approach (it's just a comment), but hosts that support source write-back will read it and persist at the source level. Adding this is harmless in the current environment and keeps you forward-compatible.

## Common Issues

**The Tweaks panel obscures the design content**
→ Make it dismissible. Default closed, show a small button, only expand when the user clicks.

**The user keeps having to redo tweaks after switching**
→ localStorage already covers this. If state doesn't persist after reload, check that localStorage is available (incognito mode fails — wrap in try/catch).

**Multiple HTML pages should share tweaks**
→ Add the project name to the localStorage key: `design-tweaks-[projectName]`.

**I want tweaks to be coupled to each other**
→ Add logic in `update`:

```jsx
const update = (patch) => {
  let next = { ...tweaks, ...patch };
  // Coupling: when dark mode is on, auto-switch the text color
  if (patch.dark === true && !patch.textColor) {
    next.textColor = '#F0EEE6';
  }
  setTweaks(next);
  localStorage.setItem(...);
};
```
