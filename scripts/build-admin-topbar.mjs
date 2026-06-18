// ============================================================================
// scripts/build-admin-topbar.mjs — esbuild bundler for the admin TopBar island
//
// What it does
// ────────────
// Bundles `components/admin/admin-topbar-entry.tsx` (and every transitive
// dependency: TopBar, UsageBadge, Feather, React, React DOM, the slot
// fills) into a single ES module at `public/admin-topbar.js` that
// admin.html loads via `<script type="module" src="/admin-topbar.js">`.
//
// Why a separate bundle (not Next.js)
// ───────────────────────────────────
// admin.html is a static HTML page served from `public/` — not a Next.js
// route. Next's bundler outputs are stitched into its own page renderer
// and aren't drop-in script tags. esbuild gives us a single self-contained
// JS file we can include from a vanilla HTML page. The React component
// SOURCE is shared (same `components/TopBar.tsx` Studio + React-CRM
// import); only the bundling pathway differs.
//
// Usage
// ─────
//   npm run build:admin-topbar    # one-shot build
//
// Output (~ React + ReactDOM + TopBar = ~150 KB minified):
//   public/admin-topbar.js
// ============================================================================

import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const root = resolve(__dirname, '..')

await esbuild.build({
  entryPoints: [resolve(root, 'components/admin/admin-topbar-entry.tsx')],
  outfile: resolve(root, 'public/admin-topbar.js'),
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  platform: 'browser',
  minify: true,
  sourcemap: true,
  jsx: 'automatic',
  // Mirror tsconfig.json paths: `@/*` → `./*` from the project root.
  alias: { '@': root },
  // React in production mode (skips dev-mode warnings + invariants).
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  // 'use client' directives are Next.js Server Components markers; harmless
  // string literals to esbuild but suppress the warning anyway.
  logOverride: {
    'unsupported-jsx-comment': 'silent',
  },
})

console.log('[build-admin-topbar] wrote public/admin-topbar.js')
