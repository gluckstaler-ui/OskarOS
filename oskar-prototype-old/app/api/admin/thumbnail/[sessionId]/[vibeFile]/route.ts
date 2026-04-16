// ==========================================
// Admin API: Thumbnail Generator
// GET /api/admin/thumbnail/[sessionId]/[vibeFile]
// ==========================================

import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  getThumbnailPath,
  thumbnailExists,
  generateThumbnail
} from '@/lib/thumbnail-generator'

interface RouteParams {
  params: Promise<{
    sessionId: string
    vibeFile: string
  }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { sessionId, vibeFile } = await params

    // Validate inputs
    if (!sessionId || !vibeFile) {
      return NextResponse.json(
        { error: 'Missing sessionId or vibeFile' },
        { status: 400 }
      )
    }

    // Ensure vibeFile ends with .html (for URL cleanliness, allow .png too)
    let htmlFile = vibeFile
    if (vibeFile.endsWith('.png')) {
      htmlFile = vibeFile.replace(/\.png$/, '.html')
    } else if (!vibeFile.endsWith('.html')) {
      htmlFile = `${vibeFile}.html`
    }

    // Check if the source HTML exists
    const publicDir = join(process.cwd(), 'public')
    const htmlPath = join(publicDir, sessionId, htmlFile)

    if (!existsSync(htmlPath)) {
      return NextResponse.json(
        { error: `HTML file not found: ${htmlFile}` },
        { status: 404 }
      )
    }

    // Check if thumbnail already exists
    const thumbnailPath = getThumbnailPath(sessionId, htmlFile)

    if (!thumbnailExists(sessionId, htmlFile)) {
      // Generate thumbnail on-demand
      // Get base URL from request
      const protocol = request.headers.get('x-forwarded-proto') || 'http'
      const host = request.headers.get('host') || 'localhost:3000'
      const baseUrl = `${protocol}://${host}`

      try {
        await generateThumbnail(sessionId, htmlFile, baseUrl)
      } catch (genError) {
        console.error('[Thumbnail] Generation failed:', genError)
        return NextResponse.json(
          { error: 'Failed to generate thumbnail', details: String(genError) },
          { status: 500 }
        )
      }
    }

    // Read and return the thumbnail
    const imageBuffer = await readFile(thumbnailPath)

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        'Content-Length': imageBuffer.length.toString()
      }
    })

  } catch (error) {
    console.error('[Thumbnail API] Error:', error)
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    )
  }
}

// Also support checking thumbnail status without generating
export async function HEAD(request: NextRequest, { params }: RouteParams) {
  try {
    const { sessionId, vibeFile } = await params

    let htmlFile = vibeFile
    if (vibeFile.endsWith('.png')) {
      htmlFile = vibeFile.replace(/\.png$/, '.html')
    } else if (!vibeFile.endsWith('.html')) {
      htmlFile = `${vibeFile}.html`
    }

    const exists = thumbnailExists(sessionId, htmlFile)

    return new NextResponse(null, {
      status: exists ? 200 : 404,
      headers: {
        'X-Thumbnail-Exists': exists ? 'true' : 'false'
      }
    })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
