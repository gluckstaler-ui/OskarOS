# React + Babel Project Conventions

Hard rules for HTML+React+Babel prototypes. Break them and it blows up.

## Pinned Script Tags (use these exact versions)

Drop these three script tags in `<head>` with **pinned versions + integrity hashes**:

```html
<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>
```

**Don't** use unpinned versions like `react@18` or `react@latest` — you'll hit version drift and cache problems.

**Don't** drop `integrity` — it's your defense if the CDN is hijacked or tampered with.

## File Layout

```
project-name/
├── index.html               # main HTML
├── components.jsx           # components (loaded via type="text/babel")
├── data.js                  # data
└── styles.css               # extra CSS (optional)
```

How to load them in HTML:

```html
<!-- React + Babel first -->
<script src="https://unpkg.com/react@18.3.1/..."></script>
<script src="https://unpkg.com/react-dom@18.3.1/..."></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/..."></script>

<!-- Then your component files -->
<script type="text/babel" src="components.jsx"></script>
<script type="text/babel" src="pages.jsx"></script>

<!-- Finally, the entry point -->
<script type="text/babel">
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<App />);
</script>
```

**Don't** use `type="module"` — it conflicts with Babel.

## Three Non-negotiable Rules

### Rule 1: `styles` objects must have unique names

**Wrong** (guaranteed to break with multiple components):
```jsx
// components.jsx
const styles = { button: {...}, card: {...} };

// pages.jsx  ← same-name collision!
const styles = { container: {...}, header: {...} };
```

**Right**: prefix the styles object uniquely per file.

```jsx
// terminal.jsx
const terminalStyles = {
  screen: {...},
  line: {...}
};

// sidebar.jsx
const sidebarStyles = {
  container: {...},
  item: {...}
};
```

**Or use inline styles** (recommended for small components):
```jsx
<div style={{ padding: 16, background: '#111' }}>...</div>
```

This rule is **non-negotiable**. Every time you write `const styles = {...}` you must rename to something specific — otherwise loading multiple components blows up the whole stack.

### Rule 2: Scope is not shared — export by hand

**Key insight**: every `<script type="text/babel">` is compiled by Babel independently, and **scope does not cross between them**. A `Terminal` component defined in `components.jsx` is **undefined by default** in `pages.jsx`.

**The fix**: at the bottom of each component file, export anything you want to share onto `window`:

```jsx
// at the end of components.jsx
function Terminal(props) { ... }
function Line(props) { ... }
const colors = { green: '#...', red: '#...' };

Object.assign(window, {
  Terminal, Line, colors,
  // list everything you want to use elsewhere
});
```

Now `pages.jsx` can use `<Terminal />` directly — JSX looks up `window.Terminal`.

### Rule 3: Don't use `scrollIntoView`

`scrollIntoView` pushes the entire HTML container upward and breaks the web harness layout. **Never use it.**

Alternatives:
```js
// Scroll to a position inside a container
container.scrollTop = targetElement.offsetTop;

// Or use element.scrollTo
container.scrollTo({
  top: targetElement.offsetTop - 100,
  behavior: 'smooth'
});
```

## Calling the Claude API (from inside the HTML)

Some native design-agent environments (Claude.ai Artifacts) provide a zero-config `window.claude.complete`, but most agent environments (Claude Code / Codex / Cursor / Trae / etc.) **do not**.

If your HTML prototype needs to call an LLM for a demo (e.g. a chat interface), two options:

### Option A: don't actually call — mock it

Recommended for demos. Write a fake helper that returns a canned response:
```jsx
window.claude = {
  async complete(prompt) {
    await new Promise(r => setTimeout(r, 800)); // simulated latency
    return "This is a mock response. Replace with the real API for production.";
  }
};
```

### Option B: call the Anthropic API for real

Requires an API key — the user has to paste their key into the HTML for it to work. **Never hardcode a key in the HTML.**

```html
<input id="api-key" placeholder="Paste your Anthropic API key" />
<script>
window.claude = {
  async complete(prompt) {
    const key = document.getElementById('api-key').value;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    return data.content[0].text;
  }
};
</script>
```

**Note**: calling the Anthropic API directly from the browser hits CORS. If the user's preview environment can't bypass CORS, this path is dead — fall back to Option A or tell the user they need a proxy backend.

### Option C: use the agent's LLM to generate mock data

For a local demo only, you can call the agent's LLM ability inline (or use a multi-model skill the user has installed) to generate mock response data, then hardcode it into the HTML. The HTML then runs without depending on any API at runtime.

## Standard HTML Starter Template

Copy this template as your React prototype skeleton:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Prototype Name</title>

  <!-- React + Babel pinned -->
  <script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>

  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; width: 100%; }
    body {
      font-family: -apple-system, 'SF Pro Text', sans-serif;
      background: #FAFAFA;
      color: #1A1A1A;
    }
    #root { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>

  <!-- Your component files -->
  <script type="text/babel" src="components.jsx"></script>

  <!-- Entry point -->
  <script type="text/babel">
    const { useState, useEffect } = React;

    function App() {
      return (
        <div style={{padding: 40}}>
          <h1>Hello</h1>
        </div>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);
  </script>
</body>
</html>
```

## Common Errors and Fixes

**`styles is not defined` or `Cannot read property 'button' of undefined`**
→ One file defines `const styles` and another file shadowed it. Rename each to a specific name.

**`Terminal is not defined`**
→ Cross-file scope doesn't carry. At the end of the file that defines `Terminal`, add `Object.assign(window, {Terminal})`.

**Whole page is white, no console errors**
→ Usually a JSX syntax error that babel.min.js silently swallowed. Temporarily swap `babel.min.js` for the unminified `babel.js` to see the real error.

**ReactDOM.createRoot is not a function**
→ Wrong version. Confirm you're on react-dom@18.3.1 (not 17 or anything else).

**`Objects are not valid as a React child`**
→ You rendered an object instead of JSX/string. Usually `{someObj}` where you meant `{someObj.name}`.

## How to Split Larger Projects

**Single files >1000 lines** are unmaintainable. Split like this:

```
project/
├── index.html
├── src/
│   ├── primitives.jsx      # primitives: Button, Card, Badge...
│   ├── components.jsx      # business components: UserCard, PostList...
│   ├── pages/
│   │   ├── home.jsx        # home page
│   │   ├── detail.jsx      # detail page
│   │   └── settings.jsx    # settings page
│   ├── router.jsx          # simple router (React state switching)
│   └── app.jsx             # entry component
└── data.js                 # mock data
```

Load them in order in HTML:
```html
<script type="text/babel" src="src/primitives.jsx"></script>
<script type="text/babel" src="src/components.jsx"></script>
<script type="text/babel" src="src/pages/home.jsx"></script>
<script type="text/babel" src="src/pages/detail.jsx"></script>
<script type="text/babel" src="src/pages/settings.jsx"></script>
<script type="text/babel" src="src/router.jsx"></script>
<script type="text/babel" src="src/app.jsx"></script>
```

**Every file** ends with `Object.assign(window, {...})` to export what should be shared.
