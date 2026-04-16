import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'

function getApiKey(): string {
  try {
    const raw = readFileSync(join(process.cwd(), '.api-key'), 'utf-8').trim()
    return raw.split('=')[1] || ''
  } catch {
    return ''
  }
}

// Quick edit prompts for text actions
const TEXT_ACTION_PROMPTS: Record<string, string> = {
  punchier: 'Make this text more punchy and impactful. Keep it short and memorable. Add urgency or emotion.',
  shorter: 'Make this text shorter while keeping the core message. Be concise.',
  longer: 'Expand this text with more detail while maintaining the tone and style.',
  sarcastic: 'Rewrite this text with a sarcastic, witty tone. Keep it playful.',
  formal: 'Rewrite this text in a more formal, professional tone.',
  casual: 'Rewrite this text in a casual, friendly tone. Make it conversational.'
}

// Quick edit prompts for image actions
const IMAGE_ACTION_PROMPTS: Record<string, string> = {
  variations: 'Create 3 alternative versions of this image description with different styles or moods.',
  zoom_out: 'Describe a wider view of this scene, showing more context and surroundings.',
  zoom_in: 'Describe a closer, more detailed view focusing on the main subject.',
  change_style: 'Describe this image in a completely different artistic style.'
}

interface QuickEditRequest {
  type: 'text' | 'image'
  action: string
  currentValue: string
  elementId: string
  customInstruction?: string
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = getApiKey()
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 503 })
    }
    const anthropic = new Anthropic({ apiKey })

    const body = await req.json() as QuickEditRequest
    const { type, action, currentValue, customInstruction } = body

    // Build the prompt based on action type
    let systemPrompt = ''
    let userPrompt = ''

    if (type === 'text') {
      systemPrompt = `You are a creative copywriter. You transform text based on specific instructions while maintaining the original meaning and brand voice. Only output the transformed text - no explanations, quotes, or formatting.`

      const actionPrompt = customInstruction || TEXT_ACTION_PROMPTS[action] || 'Improve this text.'
      userPrompt = `${actionPrompt}\n\nOriginal text:\n"${currentValue}"\n\nTransformed text:`
    } else if (type === 'image') {
      systemPrompt = `You are a creative director. You create detailed image descriptions for AI image generation. Output only the image description - no explanations or formatting.`

      const actionPrompt = customInstruction || IMAGE_ACTION_PROMPTS[action] || 'Create an improved version of this image description.'
      userPrompt = `${actionPrompt}\n\nOriginal description:\n"${currentValue}"\n\nNew description:`
    }

    console.log(`[QuickEdit] Calling Haiku API - Action: ${action}`)
    console.log(`[QuickEdit] Original text: "${currentValue}"`)
    console.log(`[QuickEdit] User prompt: "${userPrompt}"`)

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    })

    const result = message.content[0].type === 'text' ? message.content[0].text : ''
    console.log(`[QuickEdit] Raw API result: "${result}"`)

    // Clean up the result
    const cleanResult = result
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/^\*\*|[\*\*]$/g, '')

    console.log(`[QuickEdit] ✅ Cleaned result: "${cleanResult}"`)

    return NextResponse.json({
      success: true,
      result: cleanResult,
      action,
      type
    })

  } catch (error) {
    console.error('[QuickEdit] Error:', error)
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    )
  }
}
