/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
      // HTTP/2 dev proxy (Caddy on :8443 -> next dev :3000). Without this,
      // Next's server-action origin check rejects POSTs that arrive via the
      // proxy host. Both allowed so :3000 still works directly. Ralph 2026-06-03.
      allowedOrigins: ['localhost:8443', 'localhost:3000'],
    },
  },
  // WP-CRM-F19 (2026-05-25): Baileys + pino are native-ish CJS modules with
  // dynamic requires. Bundling them via Next.js's webpack pipeline yields
  // build errors and runtime "cannot find module" failures. Marking them
  // external tells Next.js to leave them in node_modules and require() them
  // at runtime — the only way to embed the WhatsApp runtime in the Next.js
  // server process.
  serverExternalPackages: [
    '@whiskeysockets/baileys',
    'pino',
    'pino-pretty',
    'qrcode',
    // WP-CRM-F22 (2026-05-25): better-sqlite3 is a native-binding module;
    // proper-lockfile uses dynamic requires for graceful-fs fallback. Both
    // must be external for the embedded CRM store to load at runtime.
    'better-sqlite3',
    'proper-lockfile',
    // Scout capture (2026-06-19): puppeteer is the same kind of native package
    // as the rest of this list, and was the ONLY one missing. Without it,
    // turbopack compiles `import puppeteer` to externalImport('puppeteer-<hash>')
    // which throws `open EEXIST` in the long-running server (the Scout capture
    // bug). Chrome + the library work fine in a fresh process — it's purely this
    // externalization gap. Listing it makes Next require() it natively, no wrapper.
    'puppeteer',
  ],
}

module.exports = nextConfig
