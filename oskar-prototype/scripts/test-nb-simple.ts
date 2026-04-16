import { readFileSync, writeFileSync } from 'fs'
import path from 'path'

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim()
}

const KEY = process.env.GOOGLE_API_KEY!
const API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent'
const DIR = '/Users/ralphlengler/OskarOS/images'
const SAFETY = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'OFF' },
]

const load = (f: string) => readFileSync(path.join(DIR, f)).toString('base64')

async function genWithDesc(parts: any[], ar: string, label: string, outFile: string, sourceFilenames: string[] = []) {
  console.log(`\n🔨 ${label}`)

  // Turn 1: generate image
  const r = await fetch(`${API}?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: ar, imageSize: '1K' } },
      safetySettings: SAFETY
    })
  })
  if (!r.ok) { console.log(`  ❌ ${r.status}`); return { file: '', desc: '' } }

  const data = await r.json()
  const c = data.candidates?.[0]
  let img = '', txt = ''

  if (c?.content?.parts) {
    console.log(`  Turn 1: ${c.content.parts.map((p: any) => p.inlineData ? 'IMG' : `TXT(${(p.text||'').length})`).join(', ')}`)
    for (const p of c.content.parts) {
      if (p.inlineData?.data && !img) img = p.inlineData.data
      if (p.text) txt += p.text
    }
  }

  if (!img) { console.log('  ❌ No image'); return { file: '', desc: txt } }
  writeFileSync(path.join(DIR, outFile), Buffer.from(img, 'base64'))
  console.log(`  ✅ ${outFile}`)

  // If good inline text, done
  if (txt.trim().length > 80) {
    console.log(`  📝 Inline: ${txt.trim().slice(0, 150)}...`)
    return { file: outFile, desc: txt.trim() }
  }

  // Turn 2: ask for description
  console.log('  🔍 Turn 2...')
  await new Promise(r => setTimeout(r, 2000))
  const r2 = await fetch(`${API}?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        { role: 'user', parts },
        { role: 'model', parts: c.content.parts },
        { role: 'user', parts: [{ text: `Describe the image you just created in ~100 words.${sourceFilenames.length ? ` The source images were: ${sourceFilenames.join(', ')}. Use these filenames when referring to elements, not image_0/image_1.` : ''} Subject, composition, lighting, colors, mood, specific details. Be grounded in what you see.` }] }
      ],
      generationConfig: { responseModalities: ['TEXT'] },
      safetySettings: SAFETY
    })
  })

  if (r2.ok) {
    const d2 = await r2.json()
    txt = d2.candidates?.[0]?.content?.parts?.filter((p: any) => p.text).map((p: any) => p.text).join('\n') || ''
    console.log(`  Turn 2: ${txt.length}ch`)
  } else {
    console.log(`  ⚠️ Turn 2: ${r2.status}`)
  }
  console.log(`  📝 ${txt.slice(0, 150)}...`)
  return { file: outFile, desc: txt.trim() }
}

async function main() {
  const results: { test: string; file: string; desc: string }[] = []

  // COMPOSE
  const files = ['suits-outside-sauna.jpeg', 'sultan.jpg', 'qamar.jpg', 'haboob.jpg', 'shams.jpg']
  const composeParts: any[] = [
    { text: `Task 1 (Generation): Source images (in order): ${files.join(', ')}. Compose a photorealistic image using suits-outside-sauna.jpeg as the base scene. Place sultan.jpg (falcon), qamar.jpg (black cat), haboob.jpg (white camel), and shams.jpg (orange cat) naturally into the scene with correct scale, matching lighting, and natural shadows.\n\nTask 2 (Self-Descriptive Captioning): Additionally, generate a detailed visual analysis (~100 words) that describes the final image you just created in Task 1. Do not repeat the prompt. Describe what you actually produced.` }
  ]
  for (const f of files) composeParts.push({ inline_data: { mime_type: 'image/jpeg', data: load(f) } })

  const r1 = await genWithDesc(composeParts, '16:9', 'COMPOSE: animals into sauna', 'compose-sauna-final.jpg', files)
  results.push({ test: 'compose', ...r1 })

  await new Promise(r => setTimeout(r, 3000))

  // LAYOUT
  const animals = ['sultan.jpg', 'qamar.jpg', 'haboob.jpg', 'shams.jpg']
  const layoutParts: any[] = [
    { text: `Task 1 (Generation): Source images (in order): ${animals.join(', ')}. Create a clean bento grid layout (16:9) showcasing these four animal portraits. 2x2 grid, thin white gutters. sultan.jpg (falcon) top-left, qamar.jpg (black cat) top-right, haboob.jpg (white camel) bottom-left, shams.jpg (orange cat) bottom-right.\n\nTask 2 (Self-Descriptive Captioning): Additionally, generate a detailed visual analysis (~100 words) that describes the final image you just created in Task 1. Do not repeat the prompt. Describe what you actually produced.` }
  ]
  for (const f of animals) layoutParts.push({ inline_data: { mime_type: 'image/jpeg', data: load(f) } })

  const r2 = await genWithDesc(layoutParts, '16:9', 'LAYOUT: bento grid', 'layout-animals-final.jpg', animals)
  results.push({ test: 'layout', ...r2 })

  // Write MD
  let md = `# Nano Banana Task 2 Test Results\n**Generated:** ${new Date().toISOString()}\n\n`
  for (const r of results) {
    md += `---\n\n### ${r.test}\n**File:** ${r.file}\n**Nano Banana:** ${r.desc || '(no description)'}\n\n`
  }
  writeFileSync(path.join(DIR, 'generated-picture.md'), md)
  console.log(`\n📄 generated-picture.md written`)
  console.log(`🏁 ${results.filter(r => r.desc.length > 50).length}/2 have descriptions`)
}

main().catch(console.error)
