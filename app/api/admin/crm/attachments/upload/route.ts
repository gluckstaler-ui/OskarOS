// ==========================================
// POSTMASTER · outbound attachment upload (PM-5, spec §08/§09)
// POST /api/admin/crm/attachments/upload  (multipart)
//   fields: prospect_id, files[]
//   → { paths: ["media/{client-slug}/name.ext", …] }
//
// Compose file picker → media/{client-slug}/ so the email-outbound route can
// attach them by path. Filenames sanitized (client-controlled → traversal
// surface) and de-duped; the same media dir inbound attachments land in.
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { getDb } from '@/lib/crm-boot'
import { slugify, sanitizeFilename } from '@/lib/mail-eyes'

const MEDIA_DIR = join(process.cwd(), 'media')

function uniqueName(dir: string, name: string, size: number): string {
  let candidate = name, i = 1
  for (;;) {
    const p = join(dir, candidate)
    if (!existsSync(p)) return candidate
    try { if (statSync(p).size === size) return candidate } catch { /* suffix */ }
    const dot = name.lastIndexOf('.')
    candidate = dot > 0 ? `${name.slice(0, dot)}-${i}${name.slice(dot)}` : `${name}-${i}`
    i++
  }
}

export async function POST(req: NextRequest) {
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'multipart body required' }, { status: 400 }) }

  const prospectId = String(form.get('prospect_id') || '').trim()
  if (!prospectId) return NextResponse.json({ error: 'prospect_id required' }, { status: 400 })

  const prospect = getDb().prepare(`SELECT company FROM prospects WHERE id = ?`).get(prospectId) as
    | { company: string } | undefined
  if (!prospect) return NextResponse.json({ error: `unknown prospect: ${prospectId}` }, { status: 404 })

  const slug = slugify(prospect.company || prospectId)
  const dir = join(MEDIA_DIR, slug)
  mkdirSync(dir, { recursive: true })

  const paths: string[] = []
  for (const entry of form.getAll('files')) {
    if (typeof entry === 'string') continue
    const bytes = Buffer.from(await entry.arrayBuffer())
    const name = uniqueName(dir, sanitizeFilename(entry.name || 'attachment'), bytes.length)
    writeFileSync(join(dir, name), bytes)
    paths.push(`media/${slug}/${name}`)
  }
  return NextResponse.json({ paths })
}
