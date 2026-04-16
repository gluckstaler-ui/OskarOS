import { NextRequest } from 'next/server'
import { existsSync } from 'fs'
import { readFile, readdir, writeFile } from 'fs/promises'
import path from 'path'
import { buildCDPrompt } from '@/lib/cd-agent-prompt'
import { parseVibesFromFiles } from '@/lib/creative-brief-parser'
import { type VibeBuildResult } from '@/lib/webdev'
import { runWebDev, type ExecutionMode, type Model } from '@/lib/run-webdev'
import { trackUsageFromCLIOutput, appendUsage } from '@/lib/usage-tracker'
import { bridgeManager, type BridgeEvent } from '@/lib/bridge-process-manager'
// Consolidator removed — Lumberjack runs on 10-minute timer instead

export const maxDuration = 300 // 5 minutes

interface Message {
  role: 'user' | 'assistant'
  content: string
  images?: string[]
}

interface SourceImageInfo {
  path: string
  analysis?: { elements: string[]; description: string }
}

interface ImagePrompt {
  vibe: string
  purpose: string
  prompt: string
  aspectRatio?: string
}

// Parse image generation requests from CD output into ImageManifest format
function parseImagePromptsToManifests(text: string, sessionId: string): { manifests: any[], prompts: ImagePrompt[] } {
  const prompts: ImagePrompt[] = []
  const manifestMap: Map<string, any> = new Map()

  // Format 0: Look for "## IMAGES NEEDED" or "IMAGES NEEDED" section with "**For VibeName:**" subsections
  const imagesNeededSection = text.match(/(?:##\s*)?IMAGES NEEDED\s*\n([\s\S]*?)(?=\n## VIBE|\n---\n## |$)/i)
  if (imagesNeededSection) {
    const section = imagesNeededSection[1]
    const forVibePattern = /\*\*For\s+(?:All Vibes|([^:(]+?)(?:\s*\([^)]+\))?):\*\*/gi
    const forVibeMatches = [...section.matchAll(forVibePattern)]

    for (let i = 0; i < forVibeMatches.length; i++) {
      const match = forVibeMatches[i]
      const rawVibeName = match[1]?.trim() || 'all'
      const vibeName = rawVibeName.toLowerCase().replace(/\s+/g, '-')
      const vibeId = vibeName === 'all' ? 'vibe-all' : `vibe-${vibeName}`

      const startPos = match.index!
      const endPos = forVibeMatches[i + 1]?.index || section.length
      const subsection = section.slice(startPos, endPos)

      const assets: any[] = []
      const bullets = subsection.matchAll(/[-•*]\s*([^\n]+)/gi)
      let assetIndex = 1

      for (const bullet of bullets) {
        const description = bullet[1].trim()
        if (description.length > 15) {
          let usage = 'hero'
          let aspectRatio = '16:9'
          let operation = 'generate'
          let sourceImages: string[] = []
          let instruction = description

          const useAsIsMatch = description.match(/^USE\s+AS-IS\s+([^:]+):\s*(.+)$/i)
          if (useAsIsMatch) { operation = 'use-as-is'; sourceImages = [useAsIsMatch[1].trim()]; instruction = useAsIsMatch[2].trim() }

          const editMatchNoBrackets = description.match(/^EDIT\s+([^:\[\]]+\.(?:jpg|jpeg|png)):\s*(.+)$/i)
          if (editMatchNoBrackets) { operation = 'edit'; sourceImages = [editMatchNoBrackets[1].trim()]; instruction = editMatchNoBrackets[2].trim() }

          const editMatchBrackets = description.match(/^EDIT\s*\[([^\]]+)\]\s*:\s*(.+)$/i)
          if (editMatchBrackets) { operation = 'edit'; sourceImages = [editMatchBrackets[1].trim()]; instruction = editMatchBrackets[2].trim() }

          const composeMatch = description.match(/^COMPOSE\s*\[([^\]]+)\]\s*:\s*(.+)$/i)
          if (composeMatch) { operation = 'compose'; sourceImages = composeMatch[1].split('+').map((s: string) => s.trim()).filter(Boolean); instruction = composeMatch[2].trim() }

          const generateMatch = description.match(/^GENERATE\s*:\s*(.+)$/i)
          if (generateMatch) { operation = 'generate'; instruction = generateMatch[1].trim() }

          const lowerDesc = instruction.toLowerCase()
          if (lowerDesc.includes('portrait') || lowerDesc.includes('close-up') || lowerDesc.includes('closeup')) { usage = 'portrait'; aspectRatio = '3:4' }
          else if (lowerDesc.includes('icon') || lowerDesc.includes('avatar')) { usage = 'icon'; aspectRatio = '1:1' }
          else if (lowerDesc.includes('interior') || lowerDesc.includes('lounge') || lowerDesc.includes('majlis')) { usage = 'gallery'; aspectRatio = '4:3' }
          else if (lowerDesc.includes('coffee') || lowerDesc.includes('flight') || lowerDesc.includes('food') || lowerDesc.includes('plated')) { usage = 'product'; aspectRatio = '4:3' }
          else if (lowerDesc.includes('hands') || lowerDesc.includes('pouring') || lowerDesc.includes('group')) { usage = 'lifestyle'; aspectRatio = '4:3' }

          const assetId = `${vibeId}-asset-${assetIndex}`
          const cleanVibeName = vibeName === 'all' ? 'shared' : vibeName
          const filename = `${cleanVibeName}-${usage}-${assetIndex}.jpg`

          assets.push({
            id: assetId, filename, operation, sourceImages, instruction, usage, aspectRatio,
            resolution: '2K', status: 'pending', vibeId,
            vibeName: rawVibeName === 'all' ? 'All Vibes' : rawVibeName.charAt(0).toUpperCase() + rawVibeName.slice(1)
          })
          prompts.push({ vibe: cleanVibeName, purpose: `${usage}-${assetIndex}`, prompt: description, aspectRatio })
          assetIndex++
        }
      }

      if (assets.length > 0) {
        const displayName = rawVibeName === 'all' ? 'All Vibes (Shared)' : rawVibeName.charAt(0).toUpperCase() + rawVibeName.slice(1)
        manifestMap.set(vibeId, { vibeId, vibeName: displayName, assets })
      }
    }
  }

  // Format 1: "IMAGES NEEDED (VIBE NAME)" sections
  const imagesNeededPattern = /IMAGES NEEDED\s*\(([^)]+)\s*(?:VIBE)?\)/gi
  for (const match of text.matchAll(imagesNeededPattern)) {
    const vibeName = match[1].toLowerCase().replace(/\s*vibe\s*/gi, '').trim()
    const vibeId = `vibe-${vibeName}`
    if (manifestMap.has(vibeId)) continue

    const startPos = match.index!
    const afterMatch = text.slice(startPos + match[0].length)
    const endMatch = afterMatch.match(/\n(?:VIBE \d+:|IMAGES NEEDED|IMAGE USAGE|MY RECOMMENDATION|##)/i)
    const sectionEnd = endMatch ? startPos + match[0].length + endMatch.index! : text.length
    const section = text.slice(startPos, sectionEnd)

    const assets: any[] = []
    let assetIndex = 1
    for (const bullet of section.matchAll(/[-•*]\s*([^\n]+)/gi)) {
      const description = bullet[1].trim()
      if (description.length > 15 && !description.toLowerCase().startsWith('image')) {
        let usage = 'hero'; let aspectRatio = '16:9'; let operation = 'generate'; let sourceImages: string[] = []; let instruction = description
        const useAsIsMatch = description.match(/^USE\s+AS-IS\s+([^:]+):\s*(.+)$/i)
        if (useAsIsMatch) { operation = 'use-as-is'; sourceImages = [useAsIsMatch[1].trim()]; instruction = useAsIsMatch[2].trim() }
        const editMatch = description.match(/^EDIT\s+([^:\[\]]+\.(?:jpg|jpeg|png)):\s*(.+)$/i)
        if (editMatch) { operation = 'edit'; sourceImages = [editMatch[1].trim()]; instruction = editMatch[2].trim() }
        const editBrackets = description.match(/^EDIT\s*\[([^\]]+)\]\s*:\s*(.+)$/i)
        if (editBrackets) { operation = 'edit'; sourceImages = [editBrackets[1].trim()]; instruction = editBrackets[2].trim() }
        const composeMatch = description.match(/^COMPOSE\s*\[([^\]]+)\]\s*:\s*(.+)$/i)
        if (composeMatch) { operation = 'compose'; sourceImages = composeMatch[1].split('+').map((s: string) => s.trim()).filter(Boolean); instruction = composeMatch[2].trim() }
        const generateMatch = description.match(/^GENERATE\s*:\s*(.+)$/i)
        if (generateMatch) { operation = 'generate'; instruction = generateMatch[1].trim() }
        const lowerDesc = instruction.toLowerCase()
        if (lowerDesc.includes('portrait') || lowerDesc.includes('person') || lowerDesc.includes('shot')) { usage = 'portrait'; aspectRatio = '3:4' }
        else if (lowerDesc.includes('icon') || lowerDesc.includes('avatar')) { usage = 'icon'; aspectRatio = '1:1' }
        else if (lowerDesc.includes('background') || lowerDesc.includes('texture')) { usage = 'background' }
        else if (lowerDesc.includes('interior') || lowerDesc.includes('lounge') || lowerDesc.includes('space')) { usage = 'gallery'; aspectRatio = '4:3' }
        else if (lowerDesc.includes('sunset') || lowerDesc.includes('silhouette') || lowerDesc.includes('ride')) { usage = 'hero'; aspectRatio = '16:9' }
        else if (lowerDesc.includes('table') || lowerDesc.includes('spread') || lowerDesc.includes('food')) { usage = 'gallery'; aspectRatio = '4:3' }

        const assetId = `${vibeId}-asset-${assetIndex}`
        const filename = `${vibeName}-${usage}-${assetIndex}.jpg`
        assets.push({ id: assetId, filename, operation, sourceImages, instruction, usage, aspectRatio, resolution: '2K', status: 'pending', vibeId, vibeName: vibeName.charAt(0).toUpperCase() + vibeName.slice(1) })
        prompts.push({ vibe: vibeName, purpose: `${usage}-${assetIndex}`, prompt: description, aspectRatio })
        assetIndex++
      }
    }
    if (assets.length > 0) {
      if (manifestMap.has(vibeId)) { manifestMap.get(vibeId).assets.push(...assets) }
      else { manifestMap.set(vibeId, { vibeId, vibeName: vibeName.charAt(0).toUpperCase() + vibeName.slice(1), assets }) }
    }
  }

  // Format 2: "IMAGES NEEDED" within VIBE sections
  for (const vibeMatch of text.matchAll(/VIBE \d+:\s*(\w+)/gi)) {
    const vibeName = vibeMatch[1].toLowerCase()
    const vibeId = `vibe-${vibeName}`
    if (manifestMap.has(vibeId)) continue
    const startPos = vibeMatch.index!
    const vibeSection = text.slice(startPos)
    const imagesMatch = vibeSection.match(/IMAGES NEEDED[^]*?(?=\n\n[A-Z]|\n##|$)/i)
    if (imagesMatch) {
      const assets: any[] = []
      let assetIndex = 1
      for (const bullet of imagesMatch[0].matchAll(/[-•*]\s*([^\n]+)/gi)) {
        const desc = bullet[1].trim()
        if (desc.length > 15) {
          let usage = 'hero'; let aspectRatio = '16:9'
          const ld = desc.toLowerCase()
          if (ld.includes('portrait') || ld.includes('person')) { usage = 'portrait'; aspectRatio = '3:4' }
          else if (ld.includes('interior') || ld.includes('space')) { usage = 'gallery'; aspectRatio = '4:3' }
          assets.push({ id: `${vibeId}-asset-${assetIndex}`, filename: `${vibeName}-${usage}-${assetIndex}.jpg`, operation: 'generate', sourceImages: [], instruction: desc, usage, aspectRatio, resolution: '2K', status: 'pending', vibeId, vibeName: vibeName.charAt(0).toUpperCase() + vibeName.slice(1) })
          prompts.push({ vibe: vibeName, purpose: `${usage}-${assetIndex}`, prompt: desc, aspectRatio })
          assetIndex++
        }
      }
      if (assets.length > 0) { manifestMap.set(vibeId, { vibeId, vibeName: vibeName.charAt(0).toUpperCase() + vibeName.slice(1), assets }) }
    }
  }

  // Format 3: ```image-prompt blocks
  for (const match of text.matchAll(/```image-prompt\s*\n([\s\S]*?)\n```/gi)) {
    try {
      const parsed = JSON.parse(match[1])
      if (parsed.vibe && parsed.purpose && parsed.prompt) {
        const vibeId = `vibe-${parsed.vibe}`
        if (!manifestMap.has(vibeId)) { manifestMap.set(vibeId, { vibeId, vibeName: parsed.vibe.charAt(0).toUpperCase() + parsed.vibe.slice(1), assets: [] }) }
        manifestMap.get(vibeId).assets.push({ id: `${vibeId}-${parsed.purpose}`, filename: `${parsed.vibe}-${parsed.purpose}.jpg`, operation: 'generate', sourceImages: [], instruction: parsed.prompt, usage: parsed.purpose.includes('hero') ? 'hero' : 'gallery', aspectRatio: parsed.aspectRatio || '16:9', resolution: '2K', status: 'pending', vibeId, vibeName: parsed.vibe.charAt(0).toUpperCase() + parsed.vibe.slice(1) })
        prompts.push(parsed)
      }
    } catch {}
  }

  // Format 4: img-N (VIBE_NAME purpose, ratio) blocks — what the CD agent actually outputs
  // Example: "img-1 (NIEDERDORF OUTPOST hero, 16:9)\nGENERATE: Interior of a dim..."
  for (const match of text.matchAll(/img-(\d+)\s*\(([^)]+)\)\s*\n\s*(GENERATE|EDIT|COMPOSE)[:\s]+([^\n](?:[\s\S]*?)?)(?=\nimg-\d+\s*\(|$)/gi)) {
    const imgNum = match[1]
    const meta = match[2].trim() // e.g. "NIEDERDORF OUTPOST hero, 16:9"
    const operation = match[3].toLowerCase()
    const instruction = match[4].trim()

    // Parse meta: last part after comma is ratio, middle word(s) before comma are purpose, first words are vibe name
    const metaParts = meta.split(',').map(s => s.trim())
    const ratioRaw = metaParts.length > 1 ? metaParts[metaParts.length - 1] : '16:9'
    const aspectRatio = /^\d+:\d+$/.test(ratioRaw) ? ratioRaw : '16:9'
    const nameAndPurpose = metaParts[0] // e.g. "NIEDERDORF OUTPOST hero"
    const words = nameAndPurpose.split(/\s+/)

    // Last word is usage/purpose, rest is vibe name
    const usageWord = words.length > 1 ? words[words.length - 1].toLowerCase() : 'hero'
    const rawVibeName = words.length > 1 ? words.slice(0, -1).join(' ') : nameAndPurpose
    const vibeName = rawVibeName.toLowerCase().replace(/\s+/g, '-')
    const vibeId = `vibe-${vibeName}`

    const usage = ['hero', 'portrait', 'gallery', 'product', 'lifestyle', 'icon', 'background'].includes(usageWord) ? usageWord : 'hero'

    // Parse source images for EDIT/COMPOSE
    let sourceImages: string[] = []
    if (operation === 'edit') {
      const editMatch = instruction.match(/^\[([^\]]+)\]\s*:\s*(.+)$/s)
      if (editMatch) { sourceImages = [editMatch[1].trim()]; }
    } else if (operation === 'compose') {
      const composeMatch = instruction.match(/^\[([^\]]+)\]\s*:\s*(.+)$/s)
      if (composeMatch) { sourceImages = composeMatch[1].split('+').map((s: string) => s.trim()).filter(Boolean) }
    }

    const assetId = `${vibeId}-asset-${imgNum}`
    const cleanVibeName = vibeName
    const filename = `${cleanVibeName}-${usage}-${imgNum}.jpg`

    if (!manifestMap.has(vibeId)) {
      manifestMap.set(vibeId, { vibeId, vibeName: rawVibeName, assets: [] })
    }
    manifestMap.get(vibeId).assets.push({
      id: assetId, filename, operation, sourceImages, instruction, usage, aspectRatio,
      resolution: '2K', status: 'pending', vibeId, vibeName: rawVibeName
    })
    prompts.push({ vibe: cleanVibeName, purpose: `${usage}-${imgNum}`, prompt: instruction, aspectRatio })
  }

  console.log(`Parsed ${prompts.length} image prompts across ${manifestMap.size} vibes`)
  return { manifests: Array.from(manifestMap.values()), prompts }
}

// ==========================================
// IMAGES.md Parser
// ==========================================
// Reads the structured ### img-N blocks from IMAGES.md.
// This is the canonical format the CD agent writes to.

function parseImagePromptsFromImagesMd(imagesMd: string, sessionId: string): { manifests: any[], prompts: ImagePrompt[] } {
  const prompts: ImagePrompt[] = []
  const manifestMap: Map<string, any> = new Map()

  // Match ### img-N blocks with structured fields
  const imgBlocks = imagesMd.matchAll(/### img-(\d+)\s*\n([\s\S]*?)(?=\n### img-|\n---|\n## |$)/gi)

  let blockCount = 0
  for (const block of imgBlocks) {
    blockCount++
    const imgNum = block[1]
    const content = block[2]

    console.log(`[IMAGES.md parser] Block img-${imgNum}, content length: ${content.length}`)

    const vibeMatch = content.match(/Vibe:\s*(.+)/i)
    const purposeMatch = content.match(/Purpose:\s*(.+)/i)
    const ratioMatch = content.match(/Aspect Ratio:\s*(.+)/i)
    const statusMatch = content.match(/Status:\s*(.+)/i)
    const promptMatch = content.match(/Prompt:\s*([\s\S]+?)$/i)

    console.log(`[IMAGES.md parser] img-${imgNum}: vibe=${vibeMatch?.[1]}, purpose=${purposeMatch?.[1]}, prompt=${!!promptMatch}`)

    if (!promptMatch) { console.log(`[IMAGES.md parser] SKIP img-${imgNum}: no prompt match`); continue }

    const rawVibeName = vibeMatch?.[1]?.trim() || 'shared'
    const purpose = purposeMatch?.[1]?.trim() || 'hero'
    const aspectRatio = ratioMatch?.[1]?.trim() || '16:9'
    const status = statusMatch?.[1]?.trim() || 'PENDING'
    const instruction = promptMatch[1].trim()

    // Detect operation from prompt prefix
    let operation = 'generate'
    if (/^EDIT[\s:]/i.test(instruction)) operation = 'edit'
    else if (/^COMPOSE[\s:]/i.test(instruction)) operation = 'compose'

    const usage = purpose.toLowerCase()

    // Normalize vibe name: "shared (all vibes)" / "all" / "shared" → shared
    // Multi-vibe: "SAYF, THE HUNT" → split and assign to each
    const isShared = /^(?:shared|all)\b/i.test(rawVibeName)
    const vibeNames = isShared
      ? ['shared']
      : rawVibeName.split(/,\s*/).map(v => v.trim()).filter(Boolean)

    for (const singleVibe of vibeNames) {
      const vibeName = singleVibe.toLowerCase().replace(/\s+/g, '-')
      const vibeId = vibeName === 'shared' ? 'vibe-shared' : `vibe-${vibeName}`
      const displayName = vibeName === 'shared' ? 'All Vibes (Shared)' : singleVibe

      const assetId = `${vibeId}-asset-${imgNum}`
      const filename = `${vibeName}-${usage}-${imgNum}.jpg`

      if (!manifestMap.has(vibeId)) {
        manifestMap.set(vibeId, { vibeId, vibeName: displayName, assets: [] })
      }

      manifestMap.get(vibeId).assets.push({
        id: assetId, filename, operation, sourceImages: [], instruction, usage, aspectRatio,
        resolution: '2K', status: status.toLowerCase(), vibeId, vibeName: displayName
      })
      prompts.push({ vibe: vibeName, purpose: `${usage}-${imgNum}`, prompt: instruction, aspectRatio })
    }
  }

  console.log(`[IMAGES.md parser] DONE: ${blockCount} blocks found, ${prompts.length} prompts, ${manifestMap.size} vibes`)
  return { manifests: Array.from(manifestMap.values()), prompts }
}

// ==========================================
// Magic Word Processing
// ==========================================
// Checks CD agent output for trigger words and executes corresponding actions.
// Extracted from the old child.on('close') handler — same logic, now called per-response.

async function processResponseMagicWords(
  fullOutput: string,
  effectiveSessionId: string,
  sendEvent: (event: object) => void,
  activeMode: ExecutionMode,
  activeModel: Model,
  requestId: number
): Promise<{ manifests: any[] }> {

  // Parse image prompts from IMAGES NEEDED trigger
  let manifests: any[] = []
  let prompts: ImagePrompt[] = []

  if (/(?:##\s*)?IMAGES NEEDED/i.test(fullOutput)) {
    // IMAGES.md is always the authoritative source — prefer it over inline text parsing.
    // The inline parser produces garbled results when the CD agent's text partially
    // contains prompt fragments alongside the magic word.
    console.log(`[${requestId}] IMAGES NEEDED detected — reading IMAGES.md`)
    try {
      const imagesPath = path.join(process.cwd(), 'public', effectiveSessionId, 'IMAGES.md')
      const imagesMd = await readFile(imagesPath, 'utf-8')
      const parsed = parseImagePromptsFromImagesMd(imagesMd, effectiveSessionId)
      manifests = parsed.manifests
      prompts = parsed.prompts
      console.log(`[${requestId}] Parsed ${prompts.length} prompts from IMAGES.md across ${manifests.length} vibes`)
    } catch (err) {
      console.error(`[${requestId}] Failed to read IMAGES.md:`, err)
    }

    // Fallback to inline parsing only if IMAGES.md had nothing
    if (manifests.length === 0) {
      console.log(`[${requestId}] IMAGES.md had no prompts — trying inline parse`)
      const inline = parseImagePromptsToManifests(fullOutput, effectiveSessionId)
      manifests = inline.manifests
      prompts = inline.prompts
    }
  }

  if (manifests.length > 0) {
    sendEvent({
      type: 'image_manifests',
      manifests,
      message: `Found ${prompts.length} images across ${manifests.length} vibes`
    })
  }

  // ## VIBES READY — build all vibe pages
  if (fullOutput.includes('## VIBES READY') || fullOutput.includes('VIBES READY')) {
    console.log(`[${requestId}] VIBES READY detected - building vibe pages`)
    sendEvent({ type: 'vibes_ready', sessionId: effectiveSessionId })

    try {
      const sessionPath = path.join(process.cwd(), 'public', effectiveSessionId)
      const vibes = await parseVibesFromFiles(sessionPath)
      console.log(`[${requestId}] Found ${vibes.length} vibes to build`)

      if (vibes.length === 0) {
        sendEvent({ type: 'error', message: 'No vibes found (no VIBE-*.md files or CREATIVE-BRIEF.md)' })
      } else {
        let sessionImages: string[] = []
        try { const files = await readdir(sessionPath); sessionImages = files.filter(f => /\.(jpg|jpeg|png|webp)$/.test(f)) } catch {}

        const buildMdPath = path.join(sessionPath, 'BUILD.md')
        let successCount = 0
        for (const vibe of vibes) {
          console.log(`[${requestId}] Building vibe ${vibe.index}: ${vibe.name}`)
          try {
            const existing = await readFile(buildMdPath, 'utf-8').catch(() => '# Build Log\n')
            await writeFile(buildMdPath, existing + `\n## [${new Date().toISOString()}] BUILD: Vibe ${vibe.index} "${vibe.name}"\n**Status:** BUILDING\n**Mode:** ${activeMode}\n**Model:** ${activeModel}\n`)
          } catch {}

          const result: VibeBuildResult = await runWebDev({ mode: activeMode, model: activeModel, sessionId: effectiveSessionId, sessionPath, vibe, sessionImages })

          if (result.status === 'complete') {
            successCount++
            try { const cur = await readFile(buildMdPath, 'utf-8'); await writeFile(buildMdPath, cur + `**Result:** COMPLETE -> ${result.filename}\n`) } catch {}
            sendEvent({
              type: 'vibe_complete',
              vibe: { index: result.vibeIndex, name: result.vibeName, slug: vibe.slug, filename: result.filename, oneLiner: vibe.oneLiner, voice: vibe.voice, whoFor: vibe.whoFor, colors: vibe.colors, fonts: vibe.fonts, htmlPath: `/${effectiveSessionId}/${result.filename}` }
            })
            sendEvent({ type: 'text', content: `\n\nVibe ${result.vibeIndex} "${result.vibeName}" is ready for preview.\n` })
            console.log(`[${requestId}] Vibe ${result.vibeIndex} complete: ${result.filename}`)
          } else {
            try { const cur = await readFile(buildMdPath, 'utf-8'); await writeFile(buildMdPath, cur + `**Result:** FAILED -- ${result.error}\n`) } catch {}
            console.error(`[${requestId}] Vibe ${vibe.index} failed: ${result.error}`)
            sendEvent({ type: 'vibe_error', vibeIndex: vibe.index, vibeName: vibe.name, error: result.error })
          }
        }
        sendEvent({ type: 'all_vibes_complete', vibeCount: successCount })
        console.log(`[${requestId}] All vibes complete (${successCount}/${vibes.length} succeeded)`)
      }
    } catch (err) {
      console.error(`[${requestId}] Vibe build failed:`, err)
      sendEvent({ type: 'error', message: `Failed to build vibes: ${err}` })
    }
  }

  // ## BUILD READY — final WebDev build
  if (fullOutput.includes('## BUILD READY') || fullOutput.includes('BUILD READY')) {
    console.log(`[${requestId}] BUILD READY detected`)
    sendEvent({ type: 'build_ready', sessionId: effectiveSessionId })
    try {
      const resp = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/webdev`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: effectiveSessionId, mode: 'final', executionMode: activeMode, webDevModel: activeModel })
      })
      const result = await resp.json()
      if (result.success) { sendEvent({ type: 'webdev_complete', paths: result.paths }) }
      else { sendEvent({ type: 'webdev_error', error: result.error }) }
    } catch (err) { console.error(`[${requestId}] WebDev call failed:`, err) }
  }

  // ## BUILD: [vibe-name] — build one vibe
  const buildMatch = fullOutput.match(/## BUILD:\s*([a-zA-Z0-9_ -]+)/i)
  if (buildMatch) {
    const vibeName = buildMatch[1].trim()
    console.log(`[${requestId}] BUILD detected for vibe: ${vibeName}`)
    sendEvent({ type: 'rebuild_started', vibeName })

    try {
      const sessionPath = path.join(process.cwd(), 'public', effectiveSessionId)
      const vibes = await parseVibesFromFiles(sessionPath)
      const searchName = vibeName.toLowerCase().trim()
      const targetVibe = vibes.find(v => {
        const slug = v.slug.toLowerCase(); const name = v.name.toLowerCase()
        return name === searchName || slug === searchName || slug === searchName.replace(/\s+/g, '-') || `vibe-${v.index}-${slug}` === searchName || searchName === `vibe-${v.index}` || searchName === String(v.index)
      })

      if (!targetVibe) {
        sendEvent({ type: 'rebuild_error', vibeName, error: `Vibe "${vibeName}" not found` })
      } else {
        let sessionImages: string[] = []
        try { const files = await readdir(sessionPath); sessionImages = files.filter(f => /\.(jpg|jpeg|png|webp)$/.test(f)) } catch {}

        const buildMdPath = path.join(sessionPath, 'BUILD.md')
        try {
          const existing = await readFile(buildMdPath, 'utf-8').catch(() => '# Build Log\n')
          await writeFile(buildMdPath, existing + `\n## [${new Date().toISOString()}] BUILD: Vibe ${targetVibe.index} "${targetVibe.name}"\n**Status:** BUILDING\n**Mode:** ${activeMode}\n**Model:** ${activeModel}\n`)
        } catch {}

        const result: VibeBuildResult = await runWebDev({ mode: activeMode, model: activeModel, sessionId: effectiveSessionId, sessionPath, vibe: targetVibe, sessionImages })

        if (result.status === 'complete') {
          try { const cur = await readFile(buildMdPath, 'utf-8'); await writeFile(buildMdPath, cur + `**Result:** COMPLETE -> ${result.filename}\n`) } catch {}
          sendEvent({
            type: 'vibe_complete',
            vibe: { index: result.vibeIndex, name: result.vibeName, slug: targetVibe.slug, filename: result.filename, oneLiner: targetVibe.oneLiner, voice: targetVibe.voice, whoFor: targetVibe.whoFor, colors: targetVibe.colors, fonts: targetVibe.fonts, htmlPath: `/${effectiveSessionId}/${result.filename}` }
          })
          sendEvent({ type: 'text', content: `\n\nVibe "${result.vibeName}" built successfully.\n` })
        } else {
          try { const cur = await readFile(buildMdPath, 'utf-8'); await writeFile(buildMdPath, cur + `**Result:** FAILED -- ${result.error}\n`) } catch {}
          sendEvent({ type: 'rebuild_error', vibeName, error: result.error })
        }
      }
    } catch (err) {
      sendEvent({ type: 'rebuild_error', vibeName, error: String(err) })
    }
  }

  // ## HOTSWAP: [vibe-name] [slot]
  const hotswapMatch = fullOutput.match(/## HOTSWAP:\s*(\S+)\s+(\S+)/i)
  if (hotswapMatch) {
    const vibeName = hotswapMatch[1].trim(); const slot = hotswapMatch[2].trim()
    console.log(`[${requestId}] HOTSWAP detected: ${vibeName} / ${slot}`)
    sendEvent({ type: 'hotswap_started', vibeName, slot })

    try {
      const sessionPath = path.join(process.cwd(), 'public', effectiveSessionId)
      const imagesContent = await readFile(path.join(sessionPath, 'IMAGES.md'), 'utf-8')
      const assignmentPattern = new RegExp(`\\|\\s*${slot}\\s*\\|\\s*([^|]+)\\s*\\|[^|]*\\|\\s*✓\\s*ready`, 'i')
      const assignmentMatch = imagesContent.match(assignmentPattern)

      if (!assignmentMatch) {
        sendEvent({ type: 'hotswap_error', vibeName, slot, error: `No approved image found for slot "${slot}"` })
      } else {
        const sourceImage = assignmentMatch[1].trim()
        const vibeSlug = vibeName.toLowerCase().replace(/\s+/g, '-')
        const files = await readdir(sessionPath)
        const vibeFile = files.find(f => f.includes(vibeSlug) && f.endsWith('.html'))

        if (!vibeFile) {
          sendEvent({ type: 'hotswap_error', vibeName, slot, error: `HTML file not found for vibe "${vibeName}"` })
        } else {
          const htmlPath = path.join(sessionPath, vibeFile)
          const html = await readFile(htmlPath, 'utf-8')
          const newHtml = html.replace(new RegExp(`(<img[^>]*data-usage="${slot}"[^>]*src=")[^"]*(")`,'gi'), `$1${sourceImage}$2`)
          if (newHtml === html) {
            sendEvent({ type: 'hotswap_error', vibeName, slot, error: `No image with data-usage="${slot}" found in HTML` })
          } else {
            await writeFile(htmlPath, newHtml, 'utf-8')
            sendEvent({ type: 'hotswap_complete', vibeName, slot, sourceImage, htmlPath: `/${effectiveSessionId}/${vibeFile}` })
            sendEvent({ type: 'text', content: `\n\nImage swapped: ${sourceImage} -> ${vibeName} (${slot})\n` })
          }
        }
      }
    } catch (err) {
      sendEvent({ type: 'hotswap_error', vibeName, slot, error: String(err) })
    }
  }

  // ## UPDATE ASSETS
  if (fullOutput.includes('## UPDATE ASSETS') || fullOutput.includes('UPDATE ASSETS')) {
    console.log(`[${requestId}] UPDATE ASSETS detected`)
    sendEvent({ type: 'update_assets', sessionId: effectiveSessionId })
  }

  return { manifests }
}

// ==========================================
// POST Handler — Bridge Mode
// ==========================================

export async function POST(req: NextRequest) {
  const requestId = Date.now()
  console.log(`=== Streaming Chat API (Bridge Mode) called [${requestId}] ===`)

  try {
    const body = await req.json()
    const { messages, sourceImages, sessionId, cliSessionId, isResume, executionMode, webDevModel } = body as {
      messages: Message[]
      sourceImages?: SourceImageInfo[]
      sessionId?: string
      cliSessionId?: string
      isResume?: boolean
      executionMode?: ExecutionMode
      webDevModel?: Model
    }

    const activeMode: ExecutionMode = executionMode || 'cli'
    const activeModel: Model = webDevModel || 'claude-sonnet-4-6'
    const effectiveSessionId = sessionId || `session-${Date.now()}`

    console.log(`[${requestId}] OskarOS Session: ${effectiveSessionId}, Bridge: ${bridgeManager.hasProcess(effectiveSessionId) ? 'EXISTING' : 'NEW'}`)

    // Load memory system files for prompt context
    const memorySessionFiles = await (async () => {
      try {
        const { getSessionMdPath, getUserMemoryPath, getDreamLogPath } = await import('@/lib/memory/paths')
        const { readFile } = await import('fs/promises')

        const consolidatedSessionMd = await readFile(getSessionMdPath(effectiveSessionId), 'utf-8').catch(() => undefined)
        const userMd = await readFile(getUserMemoryPath(effectiveSessionId), 'utf-8').catch(() => undefined)

        // Build clock block
        const dreamLog = await readFile(getDreamLogPath(effectiveSessionId), 'utf-8').catch(() => '')
        const dreamTimestamp = dreamLog.match(/^# Dream Cycle — (.+)$/m)?.[1] || 'never'
        const clockBlock = (consolidatedSessionMd || userMd) ? `
## MEMORY CLOCK
- Dreamer last ran: ${dreamTimestamp}
` : ''

        return { consolidatedSessionMd, userMd, clockBlock }
      } catch {
        return {}
      }
    })()

    // Detect if bridge will resume (has saved CLI session on disk or in memory)
    const willBridgeResume = bridgeManager.hasProcess(effectiveSessionId) || bridgeManager.wasResumed(effectiveSessionId)
    // Check disk mapping if no live process (server restart scenario)
    const hasDiskMapping = !bridgeManager.hasProcess(effectiveSessionId) &&
      (() => { try { return require('fs').existsSync(require('path').join(process.cwd(), 'public', effectiveSessionId, 'logs', 'BRIDGE.json')) } catch { return false } })()
    const bridgeResumed = willBridgeResume || hasDiskMapping

    // Build system prompt (only used on first spawn — bridge remembers after that)
    const systemPrompt = buildCDPrompt(sourceImages || [], effectiveSessionId, isResume || false, memorySessionFiles, bridgeResumed)

    // Include conversation history in system prompt for first spawn only
    // Skip if bridge is resuming — it already has full history
    let fullSystemPrompt = systemPrompt
    if (!bridgeResumed && !bridgeManager.hasProcess(effectiveSessionId) && messages.length > 1) {
      const MAX_HISTORY_MESSAGES = 8
      const previousMessages = messages.slice(0, -1).slice(-MAX_HISTORY_MESSAGES)
      if (previousMessages.length > 0) {
        let historyText = `\n\n=== RECENT CONVERSATION (last ${previousMessages.length} messages) ===\n`
        historyText += `(Full history available in SESSION.md if needed)\n\n`
        for (const msg of previousMessages) {
          if (msg.role === 'user') {
            historyText += `User: ${msg.content}\n\n`
          } else {
            const textOnly = msg.content.replace(/```[\s\S]*?```/g, '[code block]').trim()
            historyText += `You (CD): ${textOnly.substring(0, 1000)}${textOnly.length > 1000 ? '...' : ''}\n\n`
          }
        }
        historyText += '=== END RECENT HISTORY ===\n\nContinue the conversation. The user just said:\n'
        fullSystemPrompt = systemPrompt + historyText
      }
    }

    // Get the last user message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    const currentMessage = lastUserMessage?.content || 'Hello! I want to create a booking page for my business.'

    console.log(`[${requestId}] System prompt: ${fullSystemPrompt.length} chars, User prompt: ${currentMessage.length} chars`)

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        let streamClosed = false

        const closeStream = () => {
          if (streamClosed) return
          streamClosed = true
          try { controller.close() } catch {}
        }

        const sendEvent = (event: object) => {
          if (streamClosed) return
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)) }
          catch { streamClosed = true }
        }

        try {
          const bridgeCliSessionId = bridgeManager.hasProcess(effectiveSessionId)
            ? effectiveSessionId  // reuse
            : effectiveSessionId  // new spawn

          sendEvent({ type: 'start', message: bridgeManager.hasProcess(effectiveSessionId) ? 'Resuming bridge session...' : 'Starting Claude Code bridge...', cliSessionId: bridgeCliSessionId })

          let fullOutput = ''
          let vibeCount = 0

          // Stream response from bridge
          for await (const event of bridgeManager.sendMessage(effectiveSessionId, currentMessage, {
            model: 'claude-opus-4-6[1m]',
            systemPrompt: fullSystemPrompt,
            cwd: process.cwd()
          })) {
            // Forward events to frontend
            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text') {
                  fullOutput += block.text
                  sendEvent({ type: 'text', content: block.text })
                }
                if (block.type === 'tool_use') {
                  sendEvent({ type: 'tool_use', tool: block.name, input: block.input })
                  // Include tool input content in fullOutput so magic words
                  // written via file tools (e.g. "## IMAGES NEEDED" in a write_file)
                  // are detected by processResponseMagicWords
                  if (block.input?.content && typeof block.input.content === 'string') {
                    fullOutput += '\n' + block.input.content
                  }
                }
              }
            }

            if (event.type === 'tool_result') {
              sendEvent({
                type: 'tool_result',
                tool: event.tool,
                result: typeof event.result === 'string' ? event.result.substring(0, 200) : '[result]'
              })
            }

            // Detect vibe generation progress
            const vibeMatches = fullOutput.match(/## VIBE \d+:/gi)
            if (vibeMatches && vibeMatches.length > vibeCount) {
              vibeCount = vibeMatches.length
              sendEvent({ type: 'progress', phase: 'vibe', current: vibeCount, message: `Generating vibe ${vibeCount}...` })
            }

            // Result event = response complete
            if (event.type === 'result') {
              console.log(`[${requestId}] Bridge response complete: turns=${event.num_turns}, cost=$${event.total_cost_usd?.toFixed(4)}, stop=${event.stop_reason}`)
              console.log(`[${requestId}] RAW usage:`, JSON.stringify(event.usage))

              // Extract ACTUAL context window fill (not cumulative billing tokens).
              // cache_read_input_tokens is counted once PER TURN — a 14-turn interaction
              // re-reads the full cache 14 times. Divide by num_turns to get actual fill.
              // cache_creation_input_tokens = NEW tokens added this interaction (counted once).
              // Formula: estimated_context = (cache_read / turns) + cache_creation + input
              let contextPct = 0
              let cachedInputTokens = 0
              let realInputTokens = 0
              let estimatedContextSize = 0
              let contextWindow = 200000
              // Get contextWindow from modelUsage (only place it exists)
              if (event.modelUsage) {
                const modelKey = Object.keys(event.modelUsage)[0]
                if (modelKey) contextWindow = event.modelUsage[modelKey].contextWindow || 200000
              }
              // Estimate actual context fill
              if (event.usage) {
                const numTurns = event.num_turns || 1
                const cacheRead = event.usage.cache_read_input_tokens || 0
                const cacheCreation = event.usage.cache_creation_input_tokens || 0
                realInputTokens = event.usage.input_tokens || 0
                // Actual cached content in window = what existed (cache_read / turns) + what's new (cache_creation)
                cachedInputTokens = Math.round(cacheRead / numTurns) + cacheCreation
                estimatedContextSize = cachedInputTokens + realInputTokens
                contextPct = Math.round((estimatedContextSize / contextWindow) * 100)
                console.log(`[${requestId}] Context: ${contextPct}% (${estimatedContextSize}/${contextWindow} — turns:${numTurns} cached:${cachedInputTokens} new:${realInputTokens} raw_billing:${cacheRead + cacheCreation + realInputTokens})`)
              }

              // Process magic words
              const { manifests } = await processResponseMagicWords(fullOutput, effectiveSessionId, sendEvent, activeMode, activeModel, requestId)

              // Track usage from structured event (NOT from CLI text output — bridge doesn't put usage in fullOutput)
              try {
                if (event.usage) {
                  const inputTokens = (event.usage.input_tokens || 0) + (event.usage.cache_creation_input_tokens || 0) + (event.usage.cache_read_input_tokens || 0)
                  const outputTokens = event.usage.output_tokens || 0
                  const cost = event.total_cost_usd || 0
                  await appendUsage(effectiveSessionId, 'CD', { inputTokens, outputTokens, cost }, 'Chat interaction (bridge)', { contextPct, contextWindow })
                }
              } catch (err) { console.error(`[${requestId}] Failed to track usage:`, err) }

              // Lumberjack handles session cleanup on 10-minute timer — no per-turn consolidation

              sendEvent({ type: 'done', vibeCount: 0, cliSessionId: bridgeCliSessionId, manifestCount: manifests.length, contextPct, cachedInputTokens, realInputTokens, contextWindow })
              break
            }
          }

          closeStream()

        } catch (error) {
          console.error(`[${requestId}] Bridge error:`, error)
          sendEvent({ type: 'error', message: String(error) })
          closeStream()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })

  } catch (error) {
    console.error(`[${requestId}] Streaming error:`, error)
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
