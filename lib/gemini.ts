import { VERTEX_KEY_FILE, vertexAccount, vertexHeaders } from '@/lib/vertex'

// Gemini model endpoint - Nano Banana 2.1 for image generation (2026-10-22), Google's named replacement
// for the earlier Nano Banana preview, at half the price per image.
// OSKAR_IMAGE_MODEL overrides it (e.g. gemini-3-pro-image for Nano Banana Pro).
const IMAGE_MODEL = process.env.OSKAR_IMAGE_MODEL || 'gemini-nano-banana-2.1';
// Text-only calls (chat, analyzeImage, describeGeneratedImage) use a text model:
// 3 s instead of 15-25 s on the image model (Vertex test 2026-10-22). OSKAR_TEXT_MODEL overrides.
const TEXT_MODEL = process.env.OSKAR_TEXT_MODEL || 'gemini-3.8-flash';

/**
 * Vertex AI (Agent Platform), 2026-10-22: every call in this file goes to Vertex on the service-account key's
 * Cloud project (billed to its billing account and credits). Gemini runs only through Vertex, never through the
 * AI Studio key (Ralph 2026-10-26); without the key file the calls fail with the setup hint.
 * The key and its project come from lib/vertex.ts (shared with video, lib/omni.ts).
 * Setup and the tested request rules: docs/ops/vertex-setup.md.
 */
const VERTEX_LOCATION = 'global'
// A 429 on Vertex means Google's shared capacity for the model is busy, not a project quota
// (all quotas at 0 % on 2026-10-22); it comes in bursts. Waits 2, 4, 8, 16 s.
const VERTEX_429_ATTEMPTS = 5

let vertexModelsUrl: string | null | undefined

/** Base URL of the Vertex models, or null when there is no Vertex key. */
function vertex(): string | null {
  if (vertexModelsUrl !== undefined) return vertexModelsUrl
  const account = vertexAccount()
  if (!account) {
    vertexModelsUrl = null
    console.warn(`[gemini] no Vertex key at ${VERTEX_KEY_FILE}: Gemini calls fail (setup: docs/ops/vertex-setup.md)`)
    return null
  }
  vertexModelsUrl = `https://aiplatform.googleapis.com/v1/projects/${account.projectId}/locations/${VERTEX_LOCATION}/publishers/google/models`
  console.log(`[gemini] route: Vertex AI, project ${account.projectId}, ${VERTEX_LOCATION}, images ${IMAGE_MODEL}, text ${TEXT_MODEL}`)
  return vertexModelsUrl
}

/**
 * Every adjustable safety filter set to OFF (the most permissive threshold;
 * BLOCK_NONE still rates content, OFF skips the filter). Active categories per
 * the generateContent reference, 2026-10-22. HARM_CATEGORY_CIVIC_INTEGRITY is
 * deprecated and left out; unset categories default to OFF on Gemini 2.5+.
 * Not adjustable by any setting: child-safety and recitation protections,
 * which surface as PROHIBITED_CONTENT / IMAGE_PROHIBITED_CONTENT / IMAGE_RECITATION.
 * (personGeneration exists only on Vertex AI; the Gemini API rejects the field.)
 */
const SAFETY_OFF = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_JAILBREAK', threshold: 'OFF' },
]

/**
 * Block reasons no retry can fix (non-adjustable filters or a blocked prompt).
 * IMAGE_SAFETY, IMAGE_OTHER and NO_IMAGE are left to the retry loops: the
 * image-output check is probabilistic and often passes on the next attempt.
 */
function hardBlockReason(data: any): string | null {
  const promptBlock = data?.promptFeedback?.blockReason
  if (promptBlock) return `prompt blocked: ${promptBlock}`
  const finish = data?.candidates?.[0]?.finishReason
  if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'IMAGE_PROHIBITED_CONTENT' ||
      finish === 'BLOCKLIST' || finish === 'SPII') return `blocked: ${finish}`
  if (finish === 'RECITATION' || finish === 'IMAGE_RECITATION') return `recitation/copyright filter: ${finish}`
  return null
}

/** Prepay balance exhausted → every key on the billing account answers 402. Not retryable. */
function paymentRequiredError(status: number): Error | null {
  if (status !== 402) return null
  return new Error(
    'Google image credit used up (HTTP 402 Payment Required). The Gemini API prepay balance of the ' +
    'billing account behind GOOGLE_API_KEY is empty — top up or enable auto-reload at https://aistudio.google.com/billing'
  )
}

/** Vertex has four image-output categories the Gemini API doesn't know; all OFF as well. */
const VERTEX_IMAGE_SAFETY_OFF = [
  { category: 'HARM_CATEGORY_IMAGE_HATE', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_IMAGE_HARASSMENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT', threshold: 'OFF' },
]

/**
 * The same request, in the shape Vertex accepts (each rule tested against
 * gemini-nano-banana-2.1 on 2026-10-22):
 * - every content needs a role, otherwise 400 "Please use a valid role";
 * - responseModalities ['TEXT'] alone is rejected (400 invalid argument); text is the default;
 * - thoughts are returned by default, including a draft image before the final one → off;
 * - people incl. children and prominent people allowed (only Vertex has these fields).
 */
function toVertexBody(body: any): any {
  const generationConfig = { ...body.generationConfig, thinkingConfig: { includeThoughts: false } }
  const modalities = generationConfig.responseModalities
  if (modalities?.length === 1 && modalities[0] === 'TEXT') delete generationConfig.responseModalities
  if (generationConfig.imageConfig) {
    generationConfig.imageConfig = {
      ...generationConfig.imageConfig,
      personGeneration: 'ALLOW_ALL',
      prominentPeople: 'ALLOW_PROMINENT_PEOPLE',
    }
  }
  return {
    ...body,
    contents: body.contents.map((c: any) => ({ role: 'user', ...c })),
    generationConfig,
    safetySettings: [...(body.safetySettings || []), ...VERTEX_IMAGE_SAFETY_OFF],
  }
}

/** POST a generateContent body to Vertex. */
async function postGenerateContent(body: any, model: string = IMAGE_MODEL): Promise<Response> {
  const modelsUrl = vertex()
  if (!modelsUrl) throw new Error(`Vertex key not found at ${VERTEX_KEY_FILE} (setup: docs/ops/vertex-setup.md)`)
  const payload = JSON.stringify(toVertexBody(body))
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${modelsUrl}/${model}:generateContent`, {
      method: 'POST',
      headers: await vertexHeaders(),
      body: payload,
    })
    if (response.status !== 429 || attempt >= VERTEX_429_ATTEMPTS) return response
    const wait = 2000 * 2 ** (attempt - 1)
    console.warn(`[gemini] Vertex 429, shared capacity busy (attempt ${attempt}/${VERTEX_429_ATTEMPTS}), waiting ${wait / 1000}s...`)
    await new Promise(r => setTimeout(r, wait))
  }
}

/** The answer parts of the first candidate, without thought parts (draft images, thinking text). */
function answerParts(data: any): any[] {
  return (data?.candidates?.[0]?.content?.parts || []).filter((p: any) => !p.thought)
}

/**
 * Check if Gemini API is configured
 */
export function isGeminiConfigured(): boolean {
  return !!vertex()
}

/**
 * Throw helpful error if API key missing
 */
function requireApiKey() {
  if (!isGeminiConfigured()) {
    throw new Error(
      `No Vertex key at ${VERTEX_KEY_FILE}. Setup: docs/ops/vertex-setup.md`
    )
  }
}

export type ImageSize = '1K' | '2K' | '4K';
export type AspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';

/**
 * Aspect ratios the Gemini image API will accept. Kept in sync with the
 * error the API throws ("aspect_ratio must be one of ..."). The app's own
 * `AspectRatio` type is a subset of this — but upstream callers (CD
 * proposals parsed from IMAGES.md, chat-stream regex-parsed prompts) type
 * as raw strings, so an invalid value can slip through. Anything not in
 * this set gets dropped just before the API call (Gemini then picks its
 * own default — effectively "auto"). This stops one bad prompt from
 * killing the whole generation pipeline.
 */
const VALID_GEMINI_ASPECT_RATIOS = new Set<string>([
  '1:1', '1:4', '1:8', '2:3', '3:2', '3:4',
  '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9',
])

/**
 * Returns the aspect ratio unchanged if Gemini accepts it, otherwise
 * returns undefined (caller should omit the field → Gemini uses default).
 * Warns once per invalid value to make future debugging cheap.
 */
function sanitizeAspectRatio(ar: string | undefined | null): string | undefined {
  if (!ar) return undefined
  if (VALID_GEMINI_ASPECT_RATIOS.has(ar)) return ar
  console.warn(
    `[gemini] Dropping invalid aspect_ratio "${ar}" — not in Gemini's allowed set. ` +
    `Valid: ${[...VALID_GEMINI_ASPECT_RATIOS].join(', ')}. Falling back to API default.`
  )
  return undefined
}

export interface ImageGenerationRequest {
  prompt: string;
  referenceImages?: string[]; // base64 encoded images
  style?: 'photorealistic' | 'illustration' | 'vintage' | 'editorial';
  imageSize?: ImageSize; // defaults to '1K'
  aspectRatio?: AspectRatio; // defaults to '1:1'
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
}

export async function chat(
  messages: ChatMessage[],
  systemPrompt: string
): Promise<string> {
  requireApiKey()

  // Build conversation history
  const contents: any[] = [];

  // Add system prompt as first user message (Gemini doesn't have system role)
  contents.push({
    role: 'user',
    parts: [{ text: `System Instructions:\n${systemPrompt}\n\nPlease acknowledge and begin.` }]
  });
  contents.push({
    role: 'model',
    parts: [{ text: 'Understood. I am the Creative Director for OskarOS. I will help discover your brand and create compelling booking pages. Let me begin.' }]
  });

  // Add conversation messages
  for (const msg of messages) {
    const parts: any[] = [];

    // Add images if present
    if (msg.images && msg.images.length > 0) {
      for (const img of msg.images) {
        parts.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: img.replace(/^data:image\/\w+;base64,/, '')
          }
        });
      }
    }

    // Add text
    if (msg.content) {
      parts.push({ text: msg.content });
    }

    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts
    });
  }

  const response = await postGenerateContent({
    contents,
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 8192,
    },
    safetySettings: SAFETY_OFF
  }, TEXT_MODEL);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini Chat API error: ${error}`);
  }

  const data = await response.json();

  // Extract text from response
  for (const part of answerParts(data)) {
    if (part.text) {
      return part.text;
    }
  }

  throw new Error('No text in Gemini response');
}

const TASK_2_SELF_DESCRIBE = `\n\nAfter completing the image, provide a grounded visual description (~100 words) of your actual output. Describe what you see in the final image — not what was requested, but what you produced. Include: subject matter, composition, lighting, dominant colors, mood, and any specific details that distinguish this image.`

export async function generateImage(request: ImageGenerationRequest): Promise<{ imageUrl: string; geminiText?: string }> {
  requireApiKey()

  const parts: any[] = [];

  // Add reference images if provided
  if (request.referenceImages && request.referenceImages.length > 0) {
    for (const img of request.referenceImages) {
      parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: img.replace(/^data:image\/\w+;base64,/, '')
        }
      });
    }
  }

  // Build the prompt with style guidance
  let fullPrompt = request.prompt;

  if (request.style) {
    const styleGuides: Record<string, string> = {
      photorealistic: 'Create a photorealistic image with professional lighting and composition.',
      illustration: 'Create in a clean illustration style with bold colors.',
      vintage: 'Create in a vintage naturalist illustration style, like an old encyclopedia.',
      editorial: 'Create in an editorial photography style, magazine-quality.'
    };
    fullPrompt = `${styleGuides[request.style]} ${fullPrompt}`;
  }

  // Task 1 (user's prompt) + Task 2 (self-describe)
  parts.push({ text: `Generate an image: ${fullPrompt}${TASK_2_SELF_DESCRIBE}` });

  const generationConfig: any = {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: {},
  };

  const sanitizedAR = sanitizeAspectRatio(request.aspectRatio)
  if (sanitizedAR) {
    generationConfig.imageConfig.aspectRatio = sanitizedAR;
  }
  if (request.imageSize) {
    generationConfig.imageConfig.imageSize = request.imageSize;
  }

  // Retry up to 3 times — Gemini sometimes returns text-only instead of an image
  const MAX_RETRIES = 3;
  let lastTextResponse = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await postGenerateContent({
      contents: [{ parts }],
      generationConfig,
      safetySettings: SAFETY_OFF
    });

    if (!response.ok) {
      const paymentError = paymentRequiredError(response.status);
      if (paymentError) throw paymentError;
      const error = await response.text();
      if (response.status === 429 && attempt < MAX_RETRIES) {
        console.warn(`[Gemini] Rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${attempt * 2}s...`);
        await new Promise(r => setTimeout(r, attempt * 2000));
        continue;
      }
      throw new Error(`Gemini Image API error: ${error}`);
    }

    const data = await response.json();
    const answer = answerParts(data);
    let imageUrl: string | null = null;
    let geminiText: string | undefined;

    for (const part of answer) {
      if (part.inlineData?.data && !imageUrl) {
        imageUrl = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
      }
      if (part.text && !geminiText) {
        geminiText = part.text;
      }
    }
    if (!imageUrl) {
      const textParts = answer.filter((p: any) => p.text).map((p: any) => p.text);
      if (textParts.length > 0) lastTextResponse = textParts.join(' ').slice(0, 200);
    }

    if (imageUrl) {
      if (attempt > 1) console.log(`[Gemini] Image generated on attempt ${attempt}/${MAX_RETRIES}`);
      return { imageUrl, geminiText };
    }

    const blockReason = hardBlockReason(data);
    if (blockReason) {
      throw new Error(`Gemini blocked image generation (${blockReason}). Try rephrasing the prompt.`);
    }

    if (attempt < MAX_RETRIES) {
      console.warn(`[Gemini] No image in response (attempt ${attempt}/${MAX_RETRIES}), retrying...${lastTextResponse ? ` Model said: "${lastTextResponse.slice(0, 100)}"` : ''}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  throw new Error(`No image in Gemini response after ${MAX_RETRIES} attempts.${lastTextResponse ? ` Model said: "${lastTextResponse.slice(0, 150)}"` : ''} Try rephrasing the prompt.`);
}

// Image analysis result interface
export interface ImageAnalysisResult {
  elements: string[]
  description: string
  suggestedExtractions: string[]
  category?: string
  usefulness?: string
  colors?: string[]
}

// Edit request interface with multiple sources
export interface ImageEditRequest {
  sourceImages: string[]          // base64 encoded source images
  sourceFilenames?: string[]      // original filenames for labeling (image_0 = first, etc.)
  instruction: string             // What to do
  imageSize?: ImageSize
  aspectRatio?: AspectRatio
}

export interface CallGeminiRequest {
  prompt: string
  sourceImages?: { data: string; mimeType: string }[]
  sourceFilenames?: string[]
  aspectRatio?: string
  imageSize?: ImageSize
  style?: string
}

export async function callGemini(request: CallGeminiRequest): Promise<{ imageUrl: string; geminiText?: string }> {
  requireApiKey()

  const hasSourceImages = request.sourceImages && request.sourceImages.length > 0
  const parts: any[] = []

  // Build prompt text
  let fullPrompt = request.prompt
  if (!hasSourceImages && request.style) {
    const styleGuides: Record<string, string> = {
      photorealistic: 'Create a photorealistic image with professional lighting and composition.',
      illustration: 'Create in a clean illustration style with bold colors.',
      vintage: 'Create in a vintage naturalist illustration style, like an old encyclopedia.',
      editorial: 'Create in an editorial photography style, magazine-quality.'
    }
    if (styleGuides[request.style]) {
      fullPrompt = `${styleGuides[request.style]} ${fullPrompt}`
    }
  }

  // Label source images by filename when there are multiple
  if (hasSourceImages && request.sourceFilenames && request.sourceFilenames.length > 1) {
    fullPrompt = `Source images (in order): ${request.sourceFilenames.join(', ')}.\n\n${fullPrompt}`
  }

  const prefix = hasSourceImages ? '' : 'Generate an image: '
  parts.push({ text: `${prefix}${fullPrompt}${TASK_2_SELF_DESCRIBE}` })

  // Append source images AFTER text
  if (hasSourceImages) {
    for (const img of request.sourceImages!) {
      parts.push({
        inline_data: {
          mime_type: img.mimeType,
          data: img.data,
        }
      })
    }
  }

  const generationConfig: any = {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: {},
  }

  const sanitizedAR = sanitizeAspectRatio(request.aspectRatio)
  if (sanitizedAR) {
    generationConfig.imageConfig.aspectRatio = sanitizedAR
  }
  if (request.imageSize) {
    generationConfig.imageConfig.imageSize = request.imageSize
  }

  const MAX_RETRIES = 3
  let lastTextResponse = ''
  const label = hasSourceImages ? 'edit' : 'generate'

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await postGenerateContent({
      contents: [{ parts }],
      generationConfig,
      safetySettings: SAFETY_OFF,
    })

    if (!response.ok) {
      const paymentError = paymentRequiredError(response.status)
      if (paymentError) throw paymentError
      const error = await response.text()
      if (response.status === 429 && attempt < MAX_RETRIES) {
        console.warn(`[Gemini ${label}] Rate limited (attempt ${attempt}/${MAX_RETRIES}), waiting ${attempt * 2}s...`)
        await new Promise(r => setTimeout(r, attempt * 2000))
        continue
      }
      if (attempt < MAX_RETRIES) {
        console.warn(`[Gemini ${label}] API error attempt ${attempt}/${MAX_RETRIES}: ${error.slice(0, 200)}`)
        await new Promise(r => setTimeout(r, 1000 * attempt))
        continue
      }
      throw new Error(`Gemini ${label} API error after ${MAX_RETRIES} attempts: ${error.slice(0, 300)}`)
    }

    const data = await response.json()
    const candidate = data.candidates?.[0]
    const answer = answerParts(data)

    // Diagnostic: log exactly what Gemini returned when no image
    if (!answer.some((p: any) => p.inlineData?.data)) {
      console.warn(`[Gemini ${label}] attempt ${attempt}/${MAX_RETRIES} — no image. finishReason=${candidate?.finishReason || 'none'}, parts=${candidate?.content?.parts?.length || 0}, promptFeedback=${JSON.stringify(data.promptFeedback || null)}, safetyRatings=${JSON.stringify(candidate?.safetyRatings?.map((r: any) => `${r.category}:${r.probability}`) || [])}`)
    }

    const blockReason = hardBlockReason(data)
    if (blockReason) {
      throw new Error(`Gemini blocked image ${label} (${blockReason}; ratings: ${JSON.stringify(candidate?.safetyRatings?.map((r: any) => `${r.category}:${r.probability}`) || [])}). Try rephrasing the prompt.`)
    }

    let imageUrl: string | null = null
    let geminiText: string | undefined

    for (const part of answer) {
      if (part.inlineData?.data && !imageUrl) {
        imageUrl = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`
      }
      if (part.text && !geminiText) {
        geminiText = part.text
      }
    }

    if (imageUrl) {
      if (attempt > 1) console.log(`[Gemini ${label}] Image produced on attempt ${attempt}/${MAX_RETRIES}`)
      return { imageUrl, geminiText }
    }

    const textParts = answer.filter((p: any) => p.text).map((p: any) => p.text)
    if (textParts.length > 0) lastTextResponse = textParts.join(' ').slice(0, 200)
    console.warn(`[Gemini ${label}] No image attempt ${attempt}/${MAX_RETRIES}.${lastTextResponse ? ` Model said: "${lastTextResponse.slice(0, 100)}"` : ''}`)

    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * attempt))
    }
  }

  throw new Error(`No image in Gemini ${label} response after ${MAX_RETRIES} attempts.${lastTextResponse ? ` Model said: "${lastTextResponse.slice(0, 150)}"` : ''} Try rephrasing the prompt.`)
}

// Analyze an image to identify its elements
export async function analyzeImage(imageBase64: string): Promise<ImageAnalysisResult> {
  requireApiKey()

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
  "colors": ["#hex1", "#hex2", "#hex3"] // dominant colors
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

  const response = await postGenerateContent({
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096, // thinking counts toward this on Gemini 3.x (500-650 tokens here); 1024 cut the JSON off
    },
    safetySettings: SAFETY_OFF
  }, TEXT_MODEL)

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini Analysis API error: ${error}`)
  }

  const data = await response.json()
  const text = answerParts(data).find((p: any) => p.text)?.text || ''

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0])
    } catch (e) {
      console.error('Failed to parse analysis JSON:', e)
    }
  }

  // Return default if parsing fails
  return {
    elements: [],
    description: 'Could not analyze image',
    suggestedExtractions: []
  }
}

// Thin wrapper — other routes import this name
export async function editImageWithText(request: ImageEditRequest): Promise<{ imageUrl: string; geminiText?: string }> {
  return callGemini({
    prompt: request.instruction,
    sourceImages: request.sourceImages.map(img => ({
      data: img.replace(/^data:image\/\w+;base64,/, ''),
      mimeType: 'image/jpeg',
    })),
    sourceFilenames: request.sourceFilenames,
    imageSize: request.imageSize,
    aspectRatio: request.aspectRatio,
  })
}

/**
 * WP-6B Turn 2: Describe a generated image.
 *
 * Used as fallback when Turn 1 (generate/edit) didn't return a text description.
 * TEXT-only response — no image generation, cheap and fast.
 *
 * Returns a grounded ~100-word visual description of the actual pixels,
 * NOT a restatement of the prompt.
 */
export async function describeGeneratedImage(
  imageBase64: string,
  context?: { prompt?: string; mode?: string; sourceFilenames?: string[] }
): Promise<string | null> {
  if (!isGeminiConfigured()) return null

  try {
    const parts: any[] = [
      {
        inline_data: {
          mime_type: 'image/jpeg',
          data: imageBase64.replace(/^data:image\/\w+;base64,/, '')
        }
      },
      {
        text: `Describe this image in ~100 words. This is an AI-generated image${context?.mode ? ` (${context.mode} mode)` : ''}${context?.sourceFilenames?.length ? ` using source images: ${context.sourceFilenames.join(', ')}` : ''}.

Describe what you SEE in the final image — not what was requested. Include:
- Subject matter and composition
- Lighting and dominant colors
- Mood and atmosphere
- Any specific distinguishing details
${context?.sourceFilenames?.length ? `\nWhen referencing source material, use the original filenames (${context.sourceFilenames.join(', ')}), not generic labels.` : ''}

Be vivid and specific. This description will be used for future edits and version tracking.`
      }
    ]

    const response = await postGenerateContent({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ['TEXT'],
        temperature: 0.2,
        maxOutputTokens: 2048, // incl. thinking (Gemini 3.x)
      },
      safetySettings: SAFETY_OFF
    }, TEXT_MODEL)

    if (!response.ok) {
      console.error(`[Turn 2] Gemini API error: ${response.status}`)
      return null
    }

    const data = await response.json()
    const text = answerParts(data).find((p: any) => p.text)?.text
    if (text?.trim()) {
      console.log(`[Turn 2] Description: ${text.trim().length} chars`)
      return text.trim()
    }

    return null
  } catch (err) {
    console.error('[Turn 2] describeGeneratedImage failed:', err)
    return null
  }
}

