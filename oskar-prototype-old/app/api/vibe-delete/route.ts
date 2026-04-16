import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function POST(req: NextRequest) {
  try {
    const { sessionId, filename } = await req.json()

    if (!sessionId || !filename) {
      return NextResponse.json({ error: 'Missing sessionId or filename' }, { status: 400 })
    }

    // Sanitize inputs to prevent path traversal
    const safeSession = sessionId.replace(/[^a-zA-Z0-9_-]/g, '')
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, '')

    const filePath = path.join(process.cwd(), 'public', safeSession, safeFilename)

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    fs.unlinkSync(filePath)
    console.log(`🗑️ Deleted vibe file: ${safeSession}/${safeFilename}`)

    return NextResponse.json({ success: true, deleted: safeFilename })
  } catch (error) {
    console.error('Vibe delete error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
