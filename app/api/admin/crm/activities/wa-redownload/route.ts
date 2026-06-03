// ============================================================================
// POST /api/admin/crm/activities/wa-redownload — recover lost media
// WP-CRM-F19 (Ralph 2026-05-25)
//
// Activity rows that arrived BEFORE the persistent-envelope store landed
// (or whose first-pass download silently failed) have a `wa_message_id` but
// no `media_path`. As long as the original envelope is on disk
// (public/_whatsapp/messages/<date>/<id>.json) AND WhatsApp's CDN still
// serves the encrypted blob (~30 days), we can recover the media:
//   1. Call the in-process runtime to replay the saved envelope through
//      downloadMediaMessage.
//   2. Runtime writes the decrypted blob to public/_whatsapp/media/<date>/
//      and returns its path + mime.
//   3. We patch the activity row's media_path + media_mime.
//
// Returns the updated activity on success so the UI can re-render the row
// without a full refresh. 404 if no row matches, 502 if the runtime can't
// recover the blob, 503 if the runtime isn't paired.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { updateMediaByMessageId } from '@/lib/crm-store'
import { getRuntime } from '@/lib/wa-runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { wa_message_id?: string }
    const wa_message_id = String(body.wa_message_id ?? '').trim()
    if (!wa_message_id) {
      return NextResponse.json({ error: 'wa_message_id required' }, { status: 400 })
    }

    const result = await getRuntime().redownloadMedia(wa_message_id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const updated = await updateMediaByMessageId(
      wa_message_id,
      result.media_path,
      result.media_mime,
    )
    if (!updated) {
      // Runtime fetched the media but no activity row references this
      // wa_message_id. Orphaned — media is on disk but unlinked. Caller
      // can either delete the orphan or create a row.
      return NextResponse.json(
        {
          ok: true,
          orphaned: true,
          media_path: result.media_path,
          media_mime: result.media_mime,
        },
        { status: 200 },
      )
    }

    return NextResponse.json({ ok: true, activity: updated })
  } catch (err) {
    console.error('[wa-redownload] POST failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
