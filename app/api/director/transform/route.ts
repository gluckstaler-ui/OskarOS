import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

type TextAction = 'punchier' | 'shorter' | 'longer' | 'sarcastic' | 'formal' | 'casual' | 'custom'
type ImageAction = 'variations' | 'zoom_out' | 'zoom_in' | 'change_style' | 'custom'

const TEXT_PROMPTS: Record<Exclude<TextAction, 'custom'>, string> = {
  punchier: 'Rewrite this text to be more punchy, impactful, and attention-grabbing. Keep it concise.',
  shorter: 'Make this text shorter while keeping the core message. Be concise.',
  longer: 'Expand this text with more detail while keeping the same tone and style.',
  sarcastic: 'Rewrite this text with a sarcastic, witty tone.',
  formal: 'Rewrite this text in a more formal, professional tone.',
  casual: 'Rewrite this text in a casual, friendly, conversational tone.'
}

/**
 * POST /api/director/transform
 * AI-powered text transformation for Director Mode
 */
export async function POST(request: NextRequest) {
  try {
    const { action, currentValue, elementType, instruction } = await request.json()

    if (!action || !currentValue) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // For now, only handle text transformations
    // Image transformations would need image generation API
    if (elementType === 'image') {
      return NextResponse.json({
        error: 'Image transformations not yet implemented',
        newValue: currentValue
      })
    }

    // Build the prompt
    let systemPrompt = 'You are a copywriting assistant. Output ONLY the rewritten text, nothing else. No quotes, no explanation, just the new text.'

    let userPrompt: string
    if (action === 'custom' && instruction) {
      userPrompt = `Apply this instruction to the text: "${instruction}"\n\nOriginal text: ${currentValue}`
    } else if (action in TEXT_PROMPTS) {
      userPrompt = `${TEXT_PROMPTS[action as Exclude<TextAction, 'custom'>]}\n\nOriginal text: ${currentValue}`
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const message = await anthropic.messages.create({
      // 2026-04-17: was 'claude-sonnet-4-20250514' (deprecated, retires Jun 15 2026).
      // Migrated to current Sonnet 4.6 per Ralph's "all sonnet/haiku → 4.6" pass.
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })

    // Extract text from response
    const textBlock = message.content.find(block => block.type === 'text')
    const newValue = textBlock?.type === 'text' ? textBlock.text.trim() : currentValue

    return NextResponse.json({ newValue })
  } catch (error) {
    console.error('Director transform error:', error)
    return NextResponse.json(
      { error: 'Failed to transform text', newValue: null },
      { status: 500 }
    )
  }
}
