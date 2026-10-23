// GET /api/admin/media/file?path=media/slug/file.ext — path-based media serving
// POSTMASTER PM-6 (spec §09). Serves email attachments stored by filename
// (not content-hashed like WhatsApp media). Path-traversal safe.

import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync, statSync } from 'fs'
import { join, resolve, normalize, extname } from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MEDIA_ROOT = resolve(process.cwd(), 'media')
const MAX_SIZE = 50 * 1024 * 1024

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip', '.txt': 'text/plain', '.csv': 'text/csv',
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('path') || ''

  if (!raw.startsWith('media/') || raw.includes('..') || raw.includes('\0')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 })
  }

  const abs = normalize(join(process.cwd(), raw))
  if (!abs.startsWith(MEDIA_ROOT)) {
    return NextResponse.json({ error: 'path outside media' }, { status: 403 })
  }

  if (!existsSync(abs)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const stat = statSync(abs)
  if (!stat.isFile() || stat.size > MAX_SIZE) {
    return NextResponse.json({ error: stat.isFile() ? 'file too large' : 'not a file' }, { status: 400 })
  }

  const bytes = readFileSync(abs)
  const mime = MIME[extname(abs).toLowerCase()] || 'application/octet-stream'
  const filename = abs.split('/').pop() || 'file'

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
