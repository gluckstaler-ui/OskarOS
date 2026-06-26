// ============================================================================
// lib/site/essential.ts — the hardcoded "essential extension" allowlist.
//
// Spec §6: essentiality is a UI auto-select HINT, nothing more. There is NO
// config field, NO upload gate, NO red icon, NO "this can execute" modal
// (spec §10.6 — explicitly NOT implemented). `.php`/`.htaccess`/`.cgi` upload
// identically to `.html`; they just aren't pre-checked in the picker.
//
// Essential = the extension is in this set. Non-essential = everything else
// (`.md`, `.log`, etc.). The compare layer (lib/site/compare.ts) uses this to
// decide the default checkbox state: `essential && (new || changed)`.
// ============================================================================
import { extname } from 'node:path'

export const ESSENTIAL_EXTS = new Set<string>([
  '.html', '.htm', '.css', '.js', '.mjs',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.otf',
  '.json', '.pdf', '.mp4', '.webm', '.mp3',
  '.txt', '.xml', '.map', '.wasm',
])

/** True when the path's extension is in the essential allowlist (case-insensitive). */
export function isEssential(path: string): boolean {
  return ESSENTIAL_EXTS.has(extname(path).toLowerCase())
}
