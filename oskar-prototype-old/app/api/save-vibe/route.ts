import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export async function POST(req: NextRequest) {
  try {
    const { name, html } = await req.json()

    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), 'public', 'generated-vibes')
    await mkdir(outputDir, { recursive: true })

    // Generate filename
    const filename = `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.html`
    const filePath = path.join(outputDir, filename)

    // Write file
    await writeFile(filePath, html, 'utf-8')

    return NextResponse.json({
      success: true,
      filePath: `/generated-vibes/${filename}`
    })
  } catch (error) {
    console.error('Error saving vibe:', error)
    return NextResponse.json(
      { error: 'Failed to save vibe' },
      { status: 500 }
    )
  }
}
