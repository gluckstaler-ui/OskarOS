'use client'

// ============================================================================
// chat-image-upload.ts — paste/drop images into the chat (Ralph 2026-05-29).
//
// Shared by BOTH hosts that mount <ConversationPanel/> — the studio (CD) and
// the CRM (Consular). The composer stages File[]; on send the host calls this
// helper, which:
//   1. uploads each image to the session via the existing /api/upload route
//      (lands at public/<sessionId>/<file> — the same place CD's brand-asset
//      uploads go, but WITHOUT the cd-evaluate-upload asset pipeline; this is
//      "look at what I mean", not "ingest a brand asset"), and
//   2. returns the public URLs (for the in-bubble thumbnail via
//      ConversationMessage.images) plus an `agentRef` block that names the
//      on-disk paths so the agent opens them with its Read tool.
//
// Why files-not-base64: it's the ONE mechanism that works across every
// transport — CD-API (read_file), CD-CLI bridge (Read), and the Consular CLI
// bridge (Read). Matches the "files ARE the agent API" doctrine; reuses
// /api/upload (no new endpoint). The Consular's Read capability is gated in
// lib/mcp-config.ts CONSULAR_ALLOWED_TOOLS.
// ============================================================================

export interface ChatImageUploadResult {
  /**
   * Public URLs of UPLOADED IMAGES only (e.g. `/__crm__/foo.png`) — these go
   * into the visible bubble as <img> thumbnails. PDFs / non-images aren't in
   * here (a <img src=".pdf"> would just render broken).
   */
  urls: string[]
  /**
   * Instruction block appended to the AGENT payload (not the visible bubble)
   * naming the on-disk paths for ALL attached files — images AND PDFs alike.
   * Empty string when nothing uploaded, so callers can append unconditionally.
   */
  agentRef: string
}

/**
 * Upload composer-staged files to the session and produce thumbnail URLs (image
 * subset) + the agent Read-reference block (all files). Accepts images and
 * PDFs — both are formats the agent's Read tool can open natively. Best-effort
 * per file: a failed upload is logged and skipped rather than aborting the send.
 */
export async function uploadChatImages(
  files: File[],
  sessionId: string | null,
): Promise<ChatImageUploadResult> {
  const imageUrls: string[] = []   // bubble thumbnails (images only)
  const allUrls: string[] = []     // agent Read references (every uploaded file)

  for (const file of files) {
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (sessionId) fd.append('sessionId', sessionId)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (res.ok && typeof data?.path === 'string') {
        allUrls.push(data.path)
        // Only true images go into the bubble thumbnail set. A PDF rendered as
        // <img> would 404-by-decode; the agent still gets it via agentRef.
        if ((file.type || '').startsWith('image/')) imageUrls.push(data.path)
      } else {
        console.warn('[chat-image-upload] upload rejected:', data?.error || res.status)
      }
    } catch (err) {
      console.warn('[chat-image-upload] upload failed:', err)
    }
  }

  // Public URL `/__crm__/foo.png` → on-disk `public/__crm__/foo.png` (the
  // bridge/route run with cwd = project root, so this relative path resolves
  // for the Read tool). No-session uploads land at `/uploads/…` → `public/uploads/…`.
  const agentRef = allUrls.length
    ? `\n\n[The user attached ${allUrls.length} file${allUrls.length > 1 ? 's' : ''} to this message. ` +
      `Open ${allUrls.length > 1 ? 'them' : 'it'} with your Read tool — it supports both images and PDFs:]\n` +
      allUrls.map((u) => `- public${u}`).join('\n')
    : ''

  return { urls: imageUrls, agentRef }
}
