# Verification: Output Validation Workflow

Some native design-agent environments (like Claude.ai Artifacts) ship a `fork_verifier_agent` that spawns a subagent and screenshots an iframe. Most agent environments (Claude Code / Codex / Cursor / Trae / etc.) don't have this built in — drive Playwright manually and you cover the same verification surface.

## Verification Checklist

Run through this list every time you produce HTML:

### 1. Browser render check (mandatory)

The basics: **does the HTML even open**? On macOS:

```bash
open -a "Google Chrome" "/path/to/your/design.html"
```

Or screenshot it via Playwright (next section).

### 2. Console error check

The most common HTML failure is a JS error that produces a white screen. Run it through Playwright:

```bash
python ~/.claude/skills/claude-design/scripts/verify.py path/to/design.html
```

This script:
1. Opens the HTML in headless chromium
2. Saves a screenshot into the project directory
3. Captures console errors
4. Reports status

See `scripts/verify.py`.

### 3. Multi-viewport check

For responsive designs, capture multiple viewports:

```bash
python verify.py design.html --viewports 1920x1080,1440x900,768x1024,375x667
```

### 4. Interaction check

Tweaks, animations, button toggles — a static screenshot misses all of them. **Best to have the user click through it themselves**, or record video with Playwright:

```python
page.video.record('interaction.mp4')
```

### 5. Slide-by-slide check

For deck-style HTML, screenshot each slide:

```bash
python verify.py deck.html --slides 10  # capture the first 10 slides
```

Generates `deck-slide-01.png`, `deck-slide-02.png`, ... for fast browsing.

## Playwright Setup

First-time install:

```bash
# If not installed
npm install -g playwright
npx playwright install chromium

# Or the Python flavor
pip install playwright
playwright install chromium
```

If the user already has Playwright installed globally, just use it.

## Screenshot Best Practices

### Full-page screenshot

```python
page.screenshot(path='full.png', full_page=True)
```

### Viewport-only screenshot

```python
page.screenshot(path='viewport.png')  # default — visible area only
```

### Screenshot a specific element

```python
element = page.query_selector('.hero-section')
element.screenshot(path='hero.png')
```

### Retina-quality screenshot

```python
page = browser.new_page(device_scale_factor=2)  # retina
```

### Wait for animations to settle

```python
page.wait_for_timeout(2000)  # let animations settle for 2s
page.screenshot(...)
```

## Sharing Screenshots with the User

### Open the local file directly

```bash
open screenshot.png
```

The user views it in their own Preview / Figma / VSCode / browser.

### Upload to image hosting and share a link

For remote collaborators (Slack / Feishu / WeChat), have the user run their own image-host tool or MCP:

```bash
python ~/Documents/writing/tools/upload_image.py screenshot.png
```

Returns a permanent ImgBB link, paste it anywhere.

## When Verification Fails

### White screen

The console always has an error. Check:

1. The integrity hashes on the React+Babel script tags (see `react-setup.md`)
2. A `const styles = {...}` name collision
3. Components shared across files weren't exported to `window`
4. JSX syntax errors (babel.min.js doesn't surface them — swap in the unminified `babel.js`)

### Janky animation

- Record a clip in Chrome DevTools' Performance tab
- Look for layout thrashing (frequent reflows)
- Prefer `transform` and `opacity` (GPU-accelerated)

### Wrong fonts

- Check that the `@font-face` URL is reachable
- Check the fallback chain
- Chinese fonts load slowly — show fallback first, swap when loaded

### Layout broken

- Check that `box-sizing: border-box` is applied globally
- Check the `* margin: 0; padding: 0` reset
- Toggle gridlines in Chrome DevTools to see the actual layout

## Verification = the designer's second pair of eyes

**Always go through it yourself.** When AI writes code, you frequently get:

- Looks right but the interaction has a bug
- Static screenshot looks fine but the layout breaks on scroll
- Looks great wide, breaks narrow
- Dark mode never tested
- Some components don't react when tweaks change

**One minute of verification saves an hour of rework.**

## Common Verification Commands

```bash
# Basics: open + screenshot + capture errors
python verify.py design.html

# Multi-viewport
python verify.py design.html --viewports 1920x1080,375x667

# Multi-slide
python verify.py deck.html --slides 10

# Output to a specific directory
python verify.py design.html --output ./screenshots/

# headless=false — open a real browser so you can watch
python verify.py design.html --show
```
