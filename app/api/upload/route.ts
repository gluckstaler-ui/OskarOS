import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, access } from 'fs/promises'
import { randomUUID } from 'crypto'
import path from 'path'

// Check if file exists
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

// Get unique filename by appending number if collision
async function getUniqueFilename(dir: string, filename: string): Promise<string> {
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)

  // First try the original name
  if (!await fileExists(path.join(dir, filename))) {
    return filename
  }

  // If exists, append numbers until we find a unique name
  let counter = 1
  while (counter < 100) {  // Safety limit
    const newFilename = `${base}-${counter}${ext}`
    if (!await fileExists(path.join(dir, newFilename))) {
      return newFilename
    }
    counter++
  }

  // Fallback: use timestamp if we hit the limit
  return `${base}-${Date.now()}${ext}`
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const sessionId = formData.get('sessionId') as string | null

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Read file as buffer
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Determine output directory based on sessionId
    // If sessionId provided, save to session folder (flat structure per spec)
    // Otherwise, save to /uploads/ as staging area
    let outputDir: string
    let publicPath: string

    if (sessionId) {
      outputDir = path.join(process.cwd(), 'public', sessionId)
      console.log(`📁 Saving to session folder: ${sessionId}`)
    } else {
      outputDir = path.join(process.cwd(), 'public', 'uploads')
      console.log(`📁 No session - saving to uploads staging area`)
    }

    await mkdir(outputDir, { recursive: true })

    // Use original filename, handle collisions by appending number
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '-')
    const filename = await getUniqueFilename(outputDir, safeName)
    const filePath = path.join(outputDir, filename)

    // Save file
    await writeFile(filePath, buffer)
    publicPath = sessionId ? `/${sessionId}/${filename}` : `/uploads/${filename}`
    console.log(`File uploaded to: ${publicPath}`)

    // CD agent analyzes images — not Gemini automatically
    // Images are saved to disk, CD reads and analyzes them during discovery

    return NextResponse.json({
      // Ralph 2026-05-12 — was `upload-${Date.now()}`. Date.now() is
      // millisecond-resolution: 20 parallel uploads (or the auto-generated
      // image_ready cascade firing 20 inject-images calls) land in the
      // same millisecond and produce duplicate IDs, which AssetGrid uses
      // as React keys. The "Encountered two children with the same key"
      // warning fired exactly when N images landed at the same time.
      // randomUUID() is collision-proof; timestamp prefix kept for
      // sort/grep ergonomics.
      id: `upload-${Date.now()}-${randomUUID().slice(0, 8)}`,
      filename,
      path: publicPath,
      originalName: file.name,
      size: file.size,
      type: file.type,
      uploadedAt: new Date().toISOString()
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: `Failed to upload: ${error}` },
      { status: 500 }
    )
  }
}
