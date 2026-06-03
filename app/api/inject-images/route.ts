import { NextRequest, NextResponse } from 'next/server'
import { readFile, readdir, access } from 'fs/promises'
import { randomUUID } from 'crypto'
import path from 'path'

// Backdoor endpoint to inject test images into the app state
// This allows automated testing without needing macOS file picker
// Usage: /api/inject-images or /api/inject-images?business=zurich

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
  while (counter < 100) {
    const newFilename = `${base}-${counter}${ext}`
    if (!await fileExists(path.join(dir, newFilename))) {
      return newFilename
    }
    counter++
  }

  // Fallback: use timestamp if we hit the limit
  return `${base}-${Date.now()}${ext}`
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const business = searchParams.get('business') || 'zurich'

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')
    const imagesDir = path.join(process.cwd(), '..', 'images')

    // Different test image sets per business
    const testSets: Record<string, Array<{file: string, source: 'uploads' | 'images', analysis: {elements: string[], description: string}}>> = {
      zurich: [
        {
          file: 'hero.jpeg',
          source: 'uploads',
          analysis: {
            elements: ['cat café interior', 'warm wood', 'Scandinavian furniture', 'fluffy cats', 'cat tree', 'plants', 'Zürich old town view'],
            description: 'Cozy Zürich cat café with warm wood paneling, Scandinavian mid-century furniture, fluffy cats lounging on a custom cat tree, and a view of the old town through large windows'
          }
        },
        {
          file: 'qamar.jpg',
          source: 'images',
          analysis: {
            elements: ['black cat', 'elegant pose', 'sitting', 'attentive golden eyes', 'sleek fur', 'mysterious'],
            description: 'Qamar - a sleek black cat with piercing golden eyes, sitting attentively and looking elegant. Mysterious and only appears when she chooses. Use this image directly for the cat portrait in the landing page.'
          }
        },
        {
          file: 'shams.jpg',
          source: 'images',
          analysis: {
            elements: ['orange cat', 'ginger tabby', 'sleeping', 'curled up', 'peaceful', 'fluffy'],
            description: 'Shams - a fluffy orange/ginger cat curled up sleeping peacefully. The warm sunshine of the café. Use this image directly for the cat portrait in the landing page.'
          }
        },
        {
          file: '1769267188312-shabby.jpeg',
          source: 'uploads',
          analysis: {
            elements: ['grey cat', 'fluffy', 'relaxed', 'judgmental expression', 'Persian mix'],
            description: 'Shabby - a fluffy grey Persian-mix cat with a judgmental expression. The resident critic who judges everyone from her favorite spot. Use this image directly for the cat portrait.'
          }
        },
        {
          file: '1769267188322-luna.jpeg',
          source: 'uploads',
          analysis: {
            elements: ['dark cat', 'mysterious', 'elegant', 'dusk lighting', 'observant'],
            description: 'Luna - a mysterious dark cat who only appears at dusk with an observant, elegant demeanor. Use this image directly for the cat portrait in the landing page.'
          }
        }
      ],
      falcamel: [
        {
          file: 'qamar.jpg',
          source: 'images',
          analysis: {
            elements: ['black cat', 'elegant pose'],
            description: 'A sleek black cat sits attentively, elegant and judgy'
          }
        },
        {
          file: 'shams.jpg',
          source: 'images',
          analysis: {
            elements: ['orange cat', 'sleeping', 'curled up'],
            description: 'A ginger cat curled up and sleeping peacefully'
          }
        },
        {
          file: 'hero.jpg',
          source: 'images',
          analysis: {
            elements: ['desert', 'Saudi interior', 'warm lighting', 'cafe atmosphere'],
            description: 'FalCaMel cafe interior with Saudi design elements'
          }
        }
      ]
    }

    const testImages = testSets[business] || testSets.zurich
    const injectedImages = []

    for (const img of testImages) {
      try {
        const sourceDir = img.source === 'uploads' ? uploadsDir : imagesDir
        const imagePath = path.join(sourceDir, img.file)
        const imageBuffer = await readFile(imagePath)
        const ext = img.file.split('.').pop()?.toLowerCase() || 'jpeg'

        // Copy to public/uploads - use original filename with collision handling
        const { writeFile, mkdir } = await import('fs/promises')
        await mkdir(uploadsDir, { recursive: true })

        // Use original filename, handle collisions with number suffix
        const newFilename = await getUniqueFilename(uploadsDir, img.file)
        const destPath = path.join(uploadsDir, newFilename)
        await writeFile(destPath, imageBuffer)

        injectedImages.push({
          // Ralph 2026-05-12 — was `upload-${Date.now()}`. THIS site was
          // worse than the upload route: it runs in a FOR LOOP over N
          // images within a SINGLE request. Iterations between awaits can
          // resolve in the same millisecond → identical IDs → AssetGrid
          // React duplicate-key warning. randomUUID() is collision-proof.
          id: `upload-${Date.now()}-${randomUUID().slice(0, 8)}`,
          filename: newFilename,
          path: `/uploads/${newFilename}`,
          originalName: img.file,
          uploadedAt: new Date().toISOString(),
          analysis: img.analysis
        })

      } catch (e) {
        console.log(`Could not load ${img.file}:`, e)
      }
    }

    return NextResponse.json({
      success: true,
      business,
      message: `Injected ${injectedImages.length} test images for ${business}`,
      images: injectedImages
    })

  } catch (error) {
    console.error('Inject images error:', error)
    return NextResponse.json(
      { error: `Failed to inject images: ${error}` },
      { status: 500 }
    )
  }
}
