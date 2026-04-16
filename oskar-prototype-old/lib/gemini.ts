const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;

// Gemini model endpoint - using gemini-3-pro-image-preview for everything (text + image generation)
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent';

/**
 * Check if Gemini API is configured
 */
export function isGeminiConfigured(): boolean {
  return !!GEMINI_API_KEY
}

/**
 * Throw helpful error if API key missing
 */
function requireApiKey() {
  if (!GEMINI_API_KEY) {
    throw new Error(
      'GOOGLE_API_KEY not configured. Add GOOGLE_API_KEY=your-key to .env.local\n' +
      'Get a key at: https://aistudio.google.com/apikey'
    )
  }
}

export type ImageSize = '1K' | '2K' | '4K';
export type AspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';

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

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 8192,
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini Chat API error: ${error}`);
  }

  const data = await response.json();

  // Extract text from response
  const candidate = data.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text) {
        return part.text;
      }
    }
  }

  throw new Error('No text in Gemini response');
}

export async function generateImage(request: ImageGenerationRequest): Promise<string> {
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

  // Build the prompt with style guidance and aspect ratio instructions
  let fullPrompt = request.prompt;

  // Add style guidance
  if (request.style) {
    const styleGuides: Record<string, string> = {
      photorealistic: 'Create a photorealistic image with professional lighting and composition.',
      illustration: 'Create in a clean illustration style with bold colors.',
      vintage: 'Create in a vintage naturalist illustration style, like an old encyclopedia.',
      editorial: 'Create in an editorial photography style, magazine-quality.'
    };
    fullPrompt = `${styleGuides[request.style]} ${fullPrompt}`;
  }

  // Add aspect ratio to prompt (REST API doesn't support imageConfig parameter)
  if (request.aspectRatio) {
    const aspectDescriptions: Record<string, string> = {
      '1:1': 'square format',
      '16:9': 'wide landscape format (16:9)',
      '9:16': 'tall portrait format (9:16)',
      '4:3': 'landscape format (4:3)',
      '3:4': 'portrait format (3:4)',
      '3:2': 'classic photo format (3:2)',
      '2:3': 'vertical photo format (2:3)',
      '21:9': 'ultra-wide cinematic format'
    };
    const aspectDesc = aspectDescriptions[request.aspectRatio] || request.aspectRatio;
    fullPrompt = `Create a ${aspectDesc} image. ${fullPrompt}`;
  }

  parts.push({ text: `Generate an image: ${fullPrompt}` });

  // Build generation config with image settings
  // IMPORTANT: responseModalities must be uppercase "TEXT" and "IMAGE"
  // NOTE: imageConfig parameter is NOT supported in REST API, only in Python SDK
  const generationConfig: any = {
    responseModalities: ['TEXT', 'IMAGE'],
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini Image API error: ${error}`);
  }

  const data = await response.json();

  // Extract image from response
  const candidate = data.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.inlineData?.data) {
        return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
      }
    }
  }

  throw new Error('No image in Gemini response');
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
  instruction: string             // What to do
  imageSize?: ImageSize
  aspectRatio?: AspectRatio
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

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      }
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini Analysis API error: ${error}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

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

// Edit image with multiple sources and size/aspect support
export async function editImage(request: ImageEditRequest): Promise<string> {
  requireApiKey()

  const parts: any[] = []

  // Add all source images
  for (const img of request.sourceImages) {
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: img.replace(/^data:image\/\w+;base64,/, '')
      }
    })
  }

  // Build instruction with aspect ratio (REST API doesn't support imageConfig)
  let fullInstruction = request.instruction
  if (request.aspectRatio) {
    const aspectDescriptions: Record<string, string> = {
      '1:1': 'square format',
      '16:9': 'wide landscape format (16:9)',
      '9:16': 'tall portrait format (9:16)',
      '4:3': 'landscape format (4:3)',
      '3:4': 'portrait format (3:4)',
      '3:2': 'classic photo format (3:2)',
      '2:3': 'vertical photo format (2:3)',
      '21:9': 'ultra-wide cinematic format'
    }
    const aspectDesc = aspectDescriptions[request.aspectRatio] || request.aspectRatio
    fullInstruction = `Create a ${aspectDesc} image. ${fullInstruction}`
  }

  parts.push({ text: fullInstruction })

  // Build generation config
  // IMPORTANT: responseModalities must be uppercase "TEXT" and "IMAGE"
  // NOTE: imageConfig parameter is NOT supported in REST API, only in Python SDK
  const generationConfig: any = {
    responseModalities: ['TEXT', 'IMAGE'],
  }

  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Gemini Edit API error: ${error}`)
  }

  const data = await response.json()

  const candidate = data.candidates?.[0]
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.inlineData?.data) {
        return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`
      }
    }
  }

  throw new Error('No image in Gemini edit response')
}

// Legacy single-image edit function for backwards compatibility
export async function editImageLegacy(
  originalImage: string,
  instruction: string
): Promise<string> {
  return editImage({
    sourceImages: [originalImage],
    instruction
  })
}
