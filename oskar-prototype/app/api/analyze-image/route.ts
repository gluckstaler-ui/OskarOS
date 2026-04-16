import { NextRequest, NextResponse } from 'next/server'
import { analyzeImage } from '@/lib/gemini'

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json()

    if (!imageBase64) {
      return NextResponse.json(
        { error: 'imageBase64 is required' },
        { status: 400 }
      )
    }

    console.log('Analyzing image...')
    const analysis = await analyzeImage(imageBase64)
    console.log('Analysis complete:', analysis.elements.length, 'elements found')

    return NextResponse.json(analysis)

  } catch (error) {
    console.error('Image analysis error:', error)
    return NextResponse.json(
      { error: `Failed to analyze image: ${error}` },
      { status: 500 }
    )
  }
}
