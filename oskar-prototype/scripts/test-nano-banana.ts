/**
 * Test Nano Banana Task 2 (self-description) — compose + generate
 *
 * Run: npx tsx scripts/test-nano-banana.ts
 */

import { readFileSync, writeFileSync } from 'fs'
import path from 'path'

// Load env manually
const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) process.env[match[1].trim()] = match[2].trim()
}

const IMAGES_DIR = '/Users/ralphlengler/OskarOS/images'
const OUTPUT_DIR = '/Users/ralphlengler/OskarOS/images'

// Gemini API
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent'

const TASK_2 = `\n\nTask 2 (Self-Descriptive Captioning): Additionally, generate a detailed visual analysis (approx. 100 words) that describes the final image you just created in Task 1. Do not repeat the generation prompt. Describe what you actually produced: subject matter, composition, lighting, dominant colors, mood, and specific details visible in the output.`

function loadImage(filename: string): string {
  const filepath = path.join(IMAGES_DIR, filename)
  const buffer = readFileSync(filepath)
  return buffer.toString('base64')
}

function saveImage(base64: string, filename: string): string {
  const data = base64.replace(/^data:image\/\w+;base64,/, '')
  const buffer = Buffer.from(data, 'base64')
  const filepath = path.join(OUTPUT_DIR, filename)
  writeFileSync(filepath, buffer)
  return filepath
}

interface TestResult {
  test: string
  filename: string
  description: string | null
  success: boolean
  error?: string
}

const SAFETY = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'OFF' },
]

async function callGemini(parts: any[], aspectRatio: string = '16:9'): Promise<{ imageBase64?: string; text?: string; error?: string }> {
  // Turn 1: Generate the image
  const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        imageConfig: { aspectRatio, imageSize: '1K' }
      },
      safetySettings: SAFETY
    })
  })

  if (!response.ok) {
    const err = await response.text()
    return { error: `API ${response.status}: ${err.slice(0, 200)}` }
  }

  const data = await response.json()
  const candidate = data.candidates?.[0]
  let imageBase64: string | undefined
  let inlineText = ''

  if (candidate?.content?.parts) {
    console.log(`  🔍 Turn 1: ${candidate.content.parts.map((p: any) => p.inlineData ? 'IMAGE' : p.text ? `TEXT(${p.text.length}ch)` : '?').join(', ')}`)
    for (const part of candidate.content.parts) {
      if (part.inlineData?.data && !imageBase64) {
        imageBase64 = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`
      }
      if (part.text) inlineText += part.text
    }
  }

  if (!imageBase64) {
    return { error: `No image. Text: ${inlineText.slice(0, 200) || 'none'}` }
  }

  // If Turn 1 already gave a real description, use it
  if (inlineText.trim().length > 80) {
    return { imageBase64, text: inlineText.trim() }
  }

  // Turn 2: Multi-turn — feed the image back, ask for description (TEXT only)
  console.log(`  🔍 Turn 2: Asking for self-description...`)
  const turn2 = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { role: 'user', parts },
        { role: 'model', parts: candidate.content.parts },
        { role: 'user', parts: [{ text: 'Describe the image you just created in ~100 words. What do you see? Subject matter, composition, lighting, colors, mood, specific details.' }] }
      ],
      generationConfig: { responseModalities: ['TEXT'] },
      safetySettings: SAFETY
    })
  })

  let text: string | undefined
  if (turn2.ok) {
    const t2data = await turn2.json()
    const t2parts = t2data.candidates?.[0]?.content?.parts
    if (t2parts) {
      text = t2parts.filter((p: any) => p.text).map((p: any) => p.text).join('\n').trim()
      console.log(`  🔍 Turn 2: TEXT(${text?.length || 0}ch)`)
    }
  } else {
    console.log(`  ⚠️ Turn 2 failed: ${turn2.status}`)
  }

  return { imageBase64, text }
}

async function main() {
  if (!GEMINI_API_KEY) {
    console.error('❌ GOOGLE_API_KEY not set')
    process.exit(1)
  }

  console.log('🍌 Nano Banana Task 2 Test\n')

  const results: TestResult[] = []

  // ========================================
  // TEST 1: COMPOSE — sultan + qamar + haboob + shams into suits-outside-sauna
  // ========================================
  const sourceFiles = ['suits-outside-sauna.jpeg', 'sultan.jpg', 'qamar.jpg', 'haboob.jpg', 'shams.jpg']
  console.log(`📸 Loading: ${sourceFiles.join(', ')}`)

  const sourceImages = sourceFiles.map(f => ({
    filename: f,
    base64: loadImage(f)
  }))

  for (let run = 1; run <= 2; run++) {
    const testName = `compose-${run}`
    console.log(`\n🔨 Test: ${testName} — Compose all animals into sauna scene`)

    const parts: any[] = []

    // Text first (with filenames + Task 2)
    const instruction = `Source images (in order): ${sourceFiles.join(', ')}.

Task 1 (Generation): Compose a new photorealistic image using suits-outside-sauna.jpeg as the base scene. Place sultan.jpg (the falcon), qamar.jpg (the black cat), haboob.jpg (the white camel), and shams.jpg (the orange cat) naturally into the scene. The animals should look like they belong there — correct scale, matching lighting, natural shadows. Keep the original scene's mood and composition.${TASK_2}`

    parts.push({ text: instruction })

    // Then all images in order
    for (const img of sourceImages) {
      parts.push({
        inline_data: {
          mime_type: img.filename.endsWith('.png') ? 'image/png' : 'image/jpeg',
          data: img.base64
        }
      })
    }

    try {
      const result = await callGemini(parts, '16:9')
      if (result.error) {
        console.log(`  ❌ ${result.error}`)
        results.push({ test: testName, filename: '', description: null, success: false, error: result.error })
      } else {
        const filename = `compose-sauna-animals-${run}.jpg`
        saveImage(result.imageBase64!, filename)
        console.log(`  ✅ Saved: ${filename}`)
        console.log(`  📝 Description: ${result.text?.slice(0, 200) || '(none)'}`)
        results.push({ test: testName, filename, description: result.text || null, success: true })
      }
    } catch (err) {
      console.log(`  ❌ Error: ${err}`)
      results.push({ test: testName, filename: '', description: null, success: false, error: String(err) })
    }

    // Rate limit pause between calls
    if (run < 2) {
      console.log('  ⏳ Waiting 3s (rate limit)...')
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  // ========================================
  // TEST 2: LAYOUT — bento grid with the same animals
  // ========================================
  await new Promise(r => setTimeout(r, 3000))

  for (let run = 1; run <= 2; run++) {
    const testName = `layout-${run}`
    console.log(`\n🔨 Test: ${testName} — Layout/bento grid with animals`)

    const parts: any[] = []

    const instruction = `Source images (in order): sultan.jpg, qamar.jpg, haboob.jpg, shams.jpg.

Task 1 (Generation): Create a clean, modern bento grid layout (16:9) showcasing these four animal portraits. Use a 2x2 grid with thin white gutters. Each cell should feature one animal from the source images, maintaining their original character and personality. sultan.jpg (falcon) top-left, qamar.jpg (black cat) top-right, haboob.jpg (white camel) bottom-left, shams.jpg (orange cat) bottom-right. Clean, minimal design with consistent warm lighting across all cells.${TASK_2}`

    parts.push({ text: instruction })

    // Only the 4 animal images
    const animalFiles = ['sultan.jpg', 'qamar.jpg', 'haboob.jpg', 'shams.jpg']
    for (const f of animalFiles) {
      parts.push({
        inline_data: {
          mime_type: 'image/jpeg',
          data: loadImage(f)
        }
      })
    }

    try {
      const result = await callGemini(parts, '16:9')
      if (result.error) {
        console.log(`  ❌ ${result.error}`)
        results.push({ test: testName, filename: '', description: null, success: false, error: result.error })
      } else {
        const filename = `layout-animals-bento-${run}.jpg`
        saveImage(result.imageBase64!, filename)
        console.log(`  ✅ Saved: ${filename}`)
        console.log(`  📝 Description: ${result.text?.slice(0, 200) || '(none)'}`)
        results.push({ test: testName, filename, description: result.text || null, success: true })
      }
    } catch (err) {
      console.log(`  ❌ Error: ${err}`)
      results.push({ test: testName, filename: '', description: null, success: false, error: String(err) })
    }

    if (run < 2) {
      console.log('  ⏳ Waiting 3s (rate limit)...')
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  // ========================================
  // Write results to generated-picture.md
  // ========================================
  let md = `# Nano Banana Task 2 Test Results\n**Generated:** ${new Date().toISOString()}\n\n`

  for (const r of results) {
    md += `---\n\n### ${r.test}\n`
    md += `**Status:** ${r.success ? '✅ Success' : '❌ Failed'}\n`
    if (r.filename) md += `**File:** ${r.filename}\n`
    if (r.description) md += `**Nano Banana:** ${r.description}\n`
    if (r.error) md += `**Error:** ${r.error}\n`
    md += '\n'
  }

  const mdPath = path.join(OUTPUT_DIR, 'generated-picture.md')
  writeFileSync(mdPath, md)
  console.log(`\n📄 Results written to: ${mdPath}`)

  const passed = results.filter(r => r.success).length
  const withDesc = results.filter(r => r.description).length
  console.log(`\n🏁 Done: ${passed}/${results.length} passed, ${withDesc}/${results.length} have descriptions`)
}

main().catch(console.error)
