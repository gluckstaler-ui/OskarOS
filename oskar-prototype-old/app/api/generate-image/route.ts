import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { generateImage, AspectRatio, ImageSize } from '@/lib/gemini'

export const maxDuration = 120 // 2 minutes for image generation

export interface ImageGenerationPayload {
  sessionId: string
  vibe: string
  purpose: string // hero, menu-bg, portrait, etc.
  prompt: string
  aspectRatio?: AspectRatio
  imageSize?: ImageSize
  referenceImages?: string[] // base64 encoded
}

export async function POST(req: NextRequest) {
  const requestId = Date.now()
  console.log(`=== Image Generation API called [${requestId}] ===`)

  try {
    const body = await req.json() as ImageGenerationPayload
    const { sessionId, vibe, purpose, prompt, aspectRatio, imageSize, referenceImages } = body

    if (!sessionId || !vibe || !purpose || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId, vibe, purpose, prompt' },
        { status: 400 }
      )
    }

    console.log(`[${requestId}] Generating image for ${vibe}/${purpose}`)
    console.log(`[${requestId}] Prompt: ${prompt.substring(0, 100)}...`)

    // Generate image via Gemini
    const imageBase64 = await generateImage({
      prompt,
      aspectRatio: aspectRatio || '16:9',
      imageSize: imageSize || '2K',
      referenceImages
    })

    // Determine version number by checking existing files
    const sessionDir = path.join(process.cwd(), 'public', sessionId)
    await mkdir(sessionDir, { recursive: true })

    // Find next version number
    const fs = await import('fs')
    const existingFiles = fs.existsSync(sessionDir)
      ? fs.readdirSync(sessionDir).filter(f => f.startsWith(`${vibe}-${purpose}-v`))
      : []
    const version = existingFiles.length + 1

    // Save image to session folder
    const filename = `${vibe}-${purpose}-v${version}.jpg`
    const filePath = path.join(sessionDir, filename)

    // Convert base64 to buffer and save
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    await writeFile(filePath, buffer)

    const publicPath = `/${sessionId}/${filename}`
    console.log(`[${requestId}] Image saved to: ${publicPath}`)

    return NextResponse.json({
      success: true,
      filename,
      path: publicPath,
      vibe,
      purpose,
      version,
      aspectRatio: aspectRatio || '16:9',
      imageSize: imageSize || '2K'
    })

  } catch (error) {
    console.error(`[${requestId}] Image generation error:`, error)
    return NextResponse.json(
      { error: `Failed to generate image: ${error}` },
      { status: 500 }
    )
  }
}
