import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, access } from 'fs/promises'
import path from 'path'
import { editImage, generateImage, ImageSize, AspectRatio } from '@/lib/gemini'

// Check if file exists
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

// Get unique filename by appending -2, -3, etc. if collision
async function getUniqueFilename(dir: string, baseName: string, ext: string): Promise<string> {
  const firstTry = `${baseName}.${ext}`
  if (!await fileExists(path.join(dir, firstTry))) {
    return firstTry
  }

  let counter = 2
  while (counter < 100) {
    const filename = `${baseName}-${counter}.${ext}`
    if (!await fileExists(path.join(dir, filename))) {
      return filename
    }
    counter++
  }

  // Fallback to timestamp only if 100+ collisions
  return `${baseName}-${Date.now()}.${ext}`
}

export async function POST(req: NextRequest) {
  try {
    const {
      sourceImagePaths,   // Array of paths like ["/uploads/steve.jpg"]
      instruction,
      filename,
      imageSize,
      aspectRatio,
      operation,          // 'generate' for pure generation, anything else uses edit
      sessionId           // Optional: if provided, save to session folder
    } = await req.json()

    if (!instruction) {
      return NextResponse.json(
        { error: 'instruction is required' },
        { status: 400 }
      )
    }

    // Load source images from disk (only needed for edit operations)
    const sourceImages: string[] = []
    if (sourceImagePaths && sourceImagePaths.length > 0 && operation !== 'generate') {
      for (const sourcePath of sourceImagePaths) {
        try {
          const fullPath = path.join(process.cwd(), 'public', sourcePath)
          const imageBuffer = await readFile(fullPath)
          const base64 = imageBuffer.toString('base64')
          const mimeType = sourcePath.endsWith('.png') ? 'image/png' : 'image/jpeg'
          sourceImages.push(`data:${mimeType};base64,${base64}`)
        } catch (readError) {
          console.error(`Failed to read source image ${sourcePath}:`, readError)
        }
      }
    }

    let imageUrl: string

    // Pure generation: no source images, just create from prompt
    if (operation === 'generate') {
      console.log(`Generating new image from prompt: "${instruction.substring(0, 80)}..."`)
      imageUrl = await generateImage({
        prompt: instruction,
        style: 'photorealistic',
        imageSize: (imageSize as ImageSize) || '1K',
        aspectRatio: (aspectRatio as AspectRatio) || '16:9'
      })
    } else {
      // Edit/compose: transform existing images
      console.log(`Editing image with ${sourceImages.length} sources: "${instruction.substring(0, 50)}..."`)
      imageUrl = await editImage({
        sourceImages,
        instruction,
        imageSize: (imageSize as ImageSize) || '1K',
        aspectRatio: (aspectRatio as AspectRatio) || '16:9'
      })
    }

    // Save to disk
    let savedPath: string | null = null
    const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/)
    if (base64Match) {
      const extension = base64Match[1] === 'jpeg' ? 'jpg' : base64Match[1]
      const base64Data = base64Match[2]

      // Determine output directory based on sessionId
      let outputDir: string
      let publicPathPrefix: string

      if (sessionId) {
        outputDir = path.join(process.cwd(), 'public', sessionId)
        publicPathPrefix = `/${sessionId}`
        console.log(`📁 Saving generated image to session folder: ${sessionId}`)
      } else {
        outputDir = path.join(process.cwd(), 'public', 'generated-images')
        publicPathPrefix = '/generated-images'
        console.log(`📁 No session - saving to generated-images`)
      }

      await mkdir(outputDir, { recursive: true })

      const baseFilename = filename?.replace(/\.[^/.]+$/, '') || 'edited-image'
      const safeFilename = baseFilename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
      const finalFilename = await getUniqueFilename(outputDir, safeFilename, extension)
      const filePath = path.join(outputDir, finalFilename)

      const imageBuffer = Buffer.from(base64Data, 'base64')
      await writeFile(filePath, imageBuffer)

      savedPath = `${publicPathPrefix}/${finalFilename}`
      console.log(`Edited image saved to: ${savedPath}`)
    }

    return NextResponse.json({
      imageUrl,
      savedPath,
      filename: filename || 'edited-image.jpg'
    })

  } catch (error) {
    console.error('Image edit error:', error)
    return NextResponse.json(
      { error: `Failed to edit image: ${error}` },
      { status: 500 }
    )
  }
}
