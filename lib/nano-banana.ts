/**
 * Nano Banana 2 — Gemini Image Generation Wrapper
 *
 * Uses gemini-3.1-flash-image-preview (codename: Nano Banana 2).
 * Handles image generation, editing, and composition.
 *
 * IMPORTANT: Aspect ratio is a SEPARATE API field, NOT in the prompt text.
 * Allowed values: 1:1 | 9:16 | 16:9 | 3:4 | 4:3 | 3:2 | 2:3 | 5:4 | 4:5 | 21:9
 */

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY
const GEMINI_IMAGE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent'

// Allowed aspect ratios (API will reject others)
export const ALLOWED_ASPECT_RATIOS = [
  '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9'
] as const

export type AspectRatio = typeof ALLOWED_ASPECT_RATIOS[number]
export type ImageSize = '1K' | '2K' | '4K'

// Image operation types
export type ImageOperation = 'generate' | 'compose' | 'extract' | 'adjust'

// Default settings by usage type
export const USAGE_DEFAULTS: Record<string, { aspectRatio: AspectRatio; size: ImageSize }> = {
  'hero': { aspectRatio: '16:9', size: '2K' },
  'background': { aspectRatio: '16:9', size: '2K' },
  'portrait': { aspectRatio: '3:4', size: '1K' },
  'icon': { aspectRatio: '1:1', size: '1K' },
  'gallery': { aspectRatio: '4:3', size: '1K' },
  'menu-bg': { aspectRatio: '16:9', size: '2K' },
  'mobile-hero': { aspectRatio: '9:16', size: '2K' },
}

/**
 * Request for generating a new image
 */
export interface GenerateRequest {
  prompt: string
  aspectRatio?: AspectRatio
  size?: ImageSize
  referenceImages?: string[]  // base64 encoded images for style reference
}

/**
 * Request for composing/editing images
 */
export interface ComposeRequest {
  sourceImages: string[]  // base64 encoded source images
  sourceFilenames?: string[]  // original filenames for labeling (image_0 = first, etc.)
  instruction: string
  aspectRatio?: AspectRatio
  size?: ImageSize
}

/**
 * Request for extracting (background removal, etc)
 */
export interface ExtractRequest {
  sourceImage: string  // base64 encoded
  instruction: string  // e.g., "Extract the falcon to transparent background"
}

/**
 * Result from any image operation
 */
export interface ImageResult {
  success: boolean
  imageBase64?: string  // data:image/png;base64,... format
  description?: string  // Nano Banana's self-description of what it generated
  error?: string
}

/**
 * Task 2: appended to every image generation/edit/compose/extract prompt.
 * Asks Nano Banana to describe its own output so CD doesn't need to read the pixels.
 */
const TASK_2_SELF_DESCRIBE = `\n\nAfter completing the image, provide a grounded visual description (~100 words) of your actual output. Describe what you see in the final image — not what was requested, but what you produced. Include: subject matter, composition, lighting, dominant colors, mood, and any specific details that distinguish this image.`

/**
 * Image analysis result
 */
export interface AnalysisResult {
  elements: string[]
  description: string
  suggestedExtractions: string[]
  category?: string
  usefulness?: string
  colors?: string[]
}

/**
 * Validate aspect ratio is in allowed list
 */
function validateAspectRatio(aspectRatio: string): AspectRatio {
  if (!ALLOWED_ASPECT_RATIOS.includes(aspectRatio as AspectRatio)) {
    throw new Error(
      `Invalid aspect ratio: ${aspectRatio}. ` +
      `Allowed values: ${ALLOWED_ASPECT_RATIOS.join(', ')}`
    )
  }
  return aspectRatio as AspectRatio
}

/**
 * Generate a new image from prompt
 */
export async function generate(request: GenerateRequest): Promise<ImageResult> {
  if (!GEMINI_API_KEY) {
    return { success: false, error: 'GOOGLE_API_KEY not configured' }
  }

  try {
    const parts: any[] = []

    // Add reference images if provided
    if (request.referenceImages && request.referenceImages.length > 0) {
      for (const img of request.referenceImages) {
        parts.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: img.replace(/^data:image\/\w+;base64,/, '')
          }
        })
      }
    }

    // Add prompt + Task 2 self-description
    parts.push({ text: `Generate an image: ${request.prompt}${TASK_2_SELF_DESCRIBE}` })

    // Build generation config with person + celebrity generation enabled
    const generationConfig: any = {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {},
    }

    // Add aspect ratio and size
    if (request.aspectRatio) {
      generationConfig.imageConfig.aspectRatio = validateAspectRatio(request.aspectRatio)
    }
    if (request.size) {
      generationConfig.imageConfig.imageSize = request.size
    }

    const safetySettings = [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'OFF' },
    ]

    const response = await fetch(`${GEMINI_IMAGE_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig,
        safetySettings
      })
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error: `Gemini API error: ${error}` }
    }

    const data = await response.json()
    const candidate = data.candidates?.[0]
    let imageBase64: string | undefined
    let description: string | undefined

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData?.data && !imageBase64) {
          const mimeType = part.inlineData.mimeType || 'image/png'
          imageBase64 = `data:${mimeType};base64,${part.inlineData.data}`
        }
        if (part.text && !description) {
          description = part.text
        }
      }
    }

    if (imageBase64) {
      return { success: true, imageBase64, description }
    }

    return { success: false, error: 'No image in Gemini response' }
  } catch (error) {
    return { success: false, error: `Generation failed: ${error}` }
  }
}

/**
 * Compose/edit multiple images together
 */
export async function compose(request: ComposeRequest): Promise<ImageResult> {
  if (!GEMINI_API_KEY) {
    return { success: false, error: 'GOOGLE_API_KEY not configured' }
  }

  try {
    const parts: any[] = []

    // Label source images by filename so Gemini knows which is which
    let labeledInstruction = request.instruction
    if (request.sourceFilenames && request.sourceFilenames.length > 0) {
      labeledInstruction = `Source images (in order): ${request.sourceFilenames.join(', ')}.\n\n${request.instruction}`
    }

    // Text instruction FIRST + Task 2 self-description, then images
    parts.push({ text: labeledInstruction + TASK_2_SELF_DESCRIBE })

    // Add all source images in order (image_0, image_1, ...)
    for (const img of request.sourceImages) {
      parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: img.replace(/^data:image\/\w+;base64,/, '')
        }
      })
    }

    // Build generation config with person + celebrity generation enabled
    const generationConfig: any = {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {},
    }

    // Add aspect ratio and size
    if (request.aspectRatio) {
      generationConfig.imageConfig.aspectRatio = validateAspectRatio(request.aspectRatio)
    }
    if (request.size) {
      generationConfig.imageConfig.imageSize = request.size
    }

    const safetySettings = [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'OFF' },
    ]

    const response = await fetch(`${GEMINI_IMAGE_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig,
        safetySettings
      })
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error: `Gemini API error: ${error}` }
    }

    const data = await response.json()
    const candidate = data.candidates?.[0]
    let imageBase64: string | undefined
    let description: string | undefined

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData?.data && !imageBase64) {
          const mimeType = part.inlineData.mimeType || 'image/png'
          imageBase64 = `data:${mimeType};base64,${part.inlineData.data}`
        }
        if (part.text && !description) {
          description = part.text
        }
      }
    }

    if (imageBase64) {
      return { success: true, imageBase64, description }
    }

    return { success: false, error: 'No image in Gemini response' }
  } catch (error) {
    return { success: false, error: `Composition failed: ${error}` }
  }
}

/**
 * Extract element from image (background removal, etc)
 */
export async function extract(request: ExtractRequest): Promise<ImageResult> {
  if (!GEMINI_API_KEY) {
    return { success: false, error: 'GOOGLE_API_KEY not configured' }
  }

  try {
    const parts = [
      {
        inline_data: {
          mime_type: 'image/jpeg',
          data: request.sourceImage.replace(/^data:image\/\w+;base64,/, '')
        }
      },
      { text: request.instruction + TASK_2_SELF_DESCRIBE }
    ]

    const generationConfig: any = {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {},
    }

    const safetySettings = [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
      { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'OFF' },
    ]

    const response = await fetch(`${GEMINI_IMAGE_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig,
        safetySettings
      })
    })

    if (!response.ok) {
      const error = await response.text()
      return { success: false, error: `Gemini API error: ${error}` }
    }

    const data = await response.json()
    const candidate = data.candidates?.[0]
    let imageBase64: string | undefined
    let description: string | undefined

    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData?.data && !imageBase64) {
          const mimeType = part.inlineData.mimeType || 'image/png'
          imageBase64 = `data:${mimeType};base64,${part.inlineData.data}`
        }
        if (part.text && !description) {
          description = part.text
        }
      }
    }

    if (imageBase64) {
      return { success: true, imageBase64, description }
    }

    return { success: false, error: 'No image in Gemini response' }
  } catch (error) {
    return { success: false, error: `Extraction failed: ${error}` }
  }
}

/**
 * Analyze an image to identify elements and suggest uses
 */
export async function analyze(imageBase64: string): Promise<AnalysisResult> {
  if (!GEMINI_API_KEY) {
    return {
      elements: [],
      description: 'API key not configured',
      suggestedExtractions: []
    }
  }

  try {
    const parts = [
      {
        inline_data: {
          mime_type: 'image/jpeg',
          data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
        }
      },
      {
        text: `You are a Creative Director analyzing an image for a booking page project.

Analyze this image in DETAIL and respond in JSON format only:
{
  "elements": ["list", "of", "distinct", "elements", "people", "animals", "objects", "architectural features"],
  "description": "A detailed 3-4 sentence description of the image: what's in it, the mood, lighting, colors, composition, setting. Be vivid and specific.",
  "suggestedExtractions": ["Extract the [element] to neutral background", ...],
  "category": "hero|portrait|product|interior|atmosphere|branding|food|landscape",
  "usefulness": "How useful is this image for a landing page? What could it be used for?",
  "colors": ["#hex1", "#hex2", "#hex3"]
}

Be extremely specific:
- People: describe clothing, pose, age, expression (e.g., "man in white thobe with falcon on arm, sitting cross-legged")
- Animals: species, color, position, expression (e.g., "sleek black cat with golden eyes, seated regally")
- Setting: location type, lighting, time of day, atmosphere
- Objects: include cultural or unique items (e.g., "traditional brass dallah coffee pot")
- Composition: foreground/background, what draws the eye

Return ONLY valid JSON, no other text.`
      }
    ]

    const response = await fetch(`${GEMINI_IMAGE_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['TEXT'],
          temperature: 0.1,
          maxOutputTokens: 1024,
        }
      })
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Gemini API error: ${error}`)
    }

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }

    return {
      elements: [],
      description: 'Could not parse analysis',
      suggestedExtractions: []
    }
  } catch (error) {
    console.error('Analysis failed:', error)
    return {
      elements: [],
      description: `Analysis failed: ${error}`,
      suggestedExtractions: []
    }
  }
}

/**
 * Re-prompt with feedback (for when v1 wasn't right)
 */
export async function reprompt(
  originalPrompt: string,
  previousImage: string,
  feedback: string,
  aspectRatio?: AspectRatio,
  size?: ImageSize
): Promise<ImageResult> {
  // Compose a new prompt that includes the feedback
  const enhancedPrompt = `${originalPrompt}

FEEDBACK ON PREVIOUS ATTEMPT: ${feedback}

Please generate a new version that addresses this feedback.`

  return generate({
    prompt: enhancedPrompt,
    referenceImages: [previousImage],
    aspectRatio,
    size
  })
}

/**
 * Generate with usage-based defaults
 */
export async function generateForUsage(
  prompt: string,
  usage: keyof typeof USAGE_DEFAULTS,
  referenceImages?: string[]
): Promise<ImageResult> {
  const defaults = USAGE_DEFAULTS[usage] || { aspectRatio: '16:9', size: '2K' }

  return generate({
    prompt,
    aspectRatio: defaults.aspectRatio,
    size: defaults.size,
    referenceImages
  })
}
