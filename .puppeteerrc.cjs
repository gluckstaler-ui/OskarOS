// Puppeteer configuration.
//
// OskarOS launches an explicitly-resolved Chromium (lib/cli-paths.ts →
// findBinary('chromium'), used by lib/thumbnail-generator.ts and the
// /api/mcp/screenshot route) — it NEVER uses Puppeteer's bundled browser.
// So skip the ~150 MB browser download on `npm install`: it's wasted on every
// platform, and a FAILED download (restricted network on a WSL / CI box) would
// otherwise break `npm install` outright.
//
// WP-40 / WP-128, Ralph 2026-06-02.
module.exports = { skipDownload: true }
