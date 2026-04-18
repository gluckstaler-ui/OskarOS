import { NextRequest, NextResponse } from 'next/server'
import { readdir, stat } from 'fs/promises'
import path from 'path'

/**
 * GET /api/sessions/[id]/images
 * Lists every image file in the session folder for use by pickers
 * (Studio Mode slot swap, etc.).
 *
 * Returns: { images: [{ filename, url, size }] }
 * Sorted newest-first by mtime.
 */

const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif)$/i

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params
    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
    }

    const sessionPath = path.join(process.cwd(), 'public', sessionId)

    let entries: string[]
    try {
      entries = await readdir(sessionPath)
    } catch {
      return NextResponse.json({ images: [] })
    }

    const files = entries.filter((f) => IMAGE_EXT.test(f))

    // Gather mtime for sorting; ignore anything that stat() can't read.
    const detailed = await Promise.all(
      files.map(async (filename) => {
        try {
          const s = await stat(path.join(sessionPath, filename))
          return {
            filename,
            url: `/${sessionId}/${filename}`,
            size: s.size,
            mtime: s.mtimeMs,
          }
        } catch {
          return null
        }
      })
    )

    const images = detailed
      .filter((x): x is NonNullable<typeof x> => x !== null)
      // Newest first — generated images typically show up at the top
      .sort((a, b) => b.mtime - a.mtime)
      .map(({ mtime: _m, ...rest }) => rest)

    return NextResponse.json({ images })
  } catch (error) {
    console.error('[sessions/images] GET failed:', error)
    return NextResponse.json(
      { error: `Failed to list images: ${error}` },
      { status: 500 }
    )
  }
}
