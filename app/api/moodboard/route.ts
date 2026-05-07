import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, readFile } from 'fs/promises'
import path from 'path'

// Gemini API setup for image generation
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || ''
const GEMINI_IMAGE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent'

interface MoodboardConcept {
  name: string
  visualStyle: string
  colorPalette: string[]
  headline: string
  oneWord: string
}

interface MoodboardRequest {
  concepts: MoodboardConcept[]
  sourceImages?: string[] // Paths to source images for style reference
  businessContext: string // Brief description of the business
}

export async function POST(req: NextRequest) {
  const requestId = Date.now()
  console.log(`=== Moodboard API called [${requestId}] ===`)

  try {
    const body: MoodboardRequest = await req.json()
    const { concepts, sourceImages, businessContext } = body

    if (!concepts || concepts.length !== 4) {
      return NextResponse.json(
        { error: 'Exactly 4 concepts required for moodboard quadrants' },
        { status: 400 }
      )
    }

    // Build the prompt for 4-quadrant moodboard
    const quadrantDescriptions = concepts.map((c, i) => {
      const position = ['top-left', 'top-right', 'bottom-left', 'bottom-right'][i]
      return `${position.toUpperCase()}: "${c.name}" - ${c.visualStyle}. Key word: ${c.oneWord}. Colors: ${c.colorPalette.join(', ')}`
    }).join('\n')

    const prompt = `Create a single cohesive moodboard image divided into 4 equal quadrants (2x2 grid).
Each quadrant represents a distinct brand direction for: ${businessContext}

The 4 quadrants should be:
${quadrantDescriptions}

IMPORTANT:
- Each quadrant should be visually distinct but professionally executed
- Use the specified color palettes for each quadrant
- Include abstract patterns, textures, or lifestyle imagery (no text)
- Make it clear where one quadrant ends and another begins
- This is a brand moodboard, so focus on atmosphere, texture, and color`

    console.log(`[${requestId}] Generating moodboard with prompt:`, prompt.substring(0, 200) + '...')

    // Load source images if provided
    const parts: any[] = []
    if (sourceImages && sourceImages.length > 0) {
      for (const srcPath of sourceImages.slice(0, 2)) { // Limit to 2 source images
        try {
          const fullPath = path.join(process.cwd(), 'public', srcPath)
          const imageBuffer = await readFile(fullPath)
          const base64 = imageBuffer.toString('base64')
          const ext = srcPath.split('.').pop()?.toLowerCase() || 'jpeg'
          const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg'
          parts.push({
            inline_data: {
              mime_type: mimeType,
              data: base64
            }
          })
        } catch (e) {
          console.log(`[${requestId}] Could not load source image: ${srcPath}`)
        }
      }
    }

    // Add the prompt
    parts.push({ text: prompt })

    // Call Gemini API
    const response = await fetch(`${GEMINI_IMAGE_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
          imageConfig: {
            imageSize: '1K',
            aspectRatio: '1:1'
          }
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
          { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'OFF' },
        ]
      })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`[${requestId}] Gemini API error:`, error)
      return NextResponse.json(
        { error: `Gemini API error: ${error}` },
        { status: 500 }
      )
    }

    const data = await response.json()

    // Extract generated image
    let generatedImageData: string | null = null
    let textResponse = ''

    const candidate = data.candidates?.[0]
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text) {
          textResponse += part.text
        }
        if (part.inlineData?.data) {
          generatedImageData = part.inlineData.data
        }
      }
    }

    if (!generatedImageData) {
      console.error(`[${requestId}] No image generated. Text response:`, textResponse)
      return NextResponse.json(
        { error: 'No moodboard image generated', details: textResponse },
        { status: 500 }
      )
    }

    // Save the moodboard image
    const outputDir = path.join(process.cwd(), 'public', 'generated-images')
    await mkdir(outputDir, { recursive: true })

    const filename = `moodboard-${requestId}.jpg`
    const outputPath = path.join(outputDir, filename)
    const imageBuffer = Buffer.from(generatedImageData, 'base64')
    await writeFile(outputPath, imageBuffer)

    const publicPath = `/generated-images/${filename}`
    console.log(`[${requestId}] Moodboard saved to: ${publicPath}`)

    // Return moodboard data with positions
    const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
    const moodboardData = {
      id: `moodboard-${requestId}`,
      imagePath: publicPath,
      concepts: concepts.map((c, i) => ({
        ...c,
        position: positions[i]
      })),
      generatedAt: new Date().toISOString()
    }

    return NextResponse.json(moodboardData)

  } catch (error) {
    console.error(`[${requestId}] Moodboard generation error:`, error)
    return NextResponse.json(
      { error: `Failed to generate moodboard: ${error}` },
      { status: 500 }
    )
  }
}
