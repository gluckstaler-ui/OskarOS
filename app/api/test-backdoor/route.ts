import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, appendFile, readFile } from 'fs/promises'
import path from 'path'

// Test backdoor for automated testing
// This uses the REAL APIs - no shortcuts
// Purpose: Let Claude run the full workflow without UI friction

// Session state (persists across requests during a test run)
let sessionMessages: { role: 'user' | 'assistant'; content: string }[] = []
let sessionLogPath: string | null = null
let sessionBusinessName: string | null = null
let lastImageManifests: any[] = []
let lastVibes: any[] = []
let lastVibePaths: string[] = []

const getBaseUrl = () => process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

// Initialize session log (follows MD spec)
async function initSession(businessName: string): Promise<string> {
  const logDir = path.join(process.cwd(), '..', 'outputs', 'logs')
  await mkdir(logDir, { recursive: true })

  const now = new Date()
  const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '-')
  sessionLogPath = path.join(logDir, `session-${timestamp}.md`)
  sessionBusinessName = businessName

  const header = `# Session Log
**Date:** ${now.toISOString().split('T')[0]}
**Business:** ${businessName}
**Goal:** Discovery → Vibes → Selection → Final approval
**Agents:** Creative Director (automated test via backdoor)

---

`
  await writeFile(sessionLogPath, header, 'utf-8')
  sessionMessages = []
  lastImageManifests = []
  lastVibes = []
  lastVibePaths = []

  return sessionLogPath
}

// Log message (follows MD spec)
async function logMessage(role: 'user' | 'assistant', content: string): Promise<void> {
  if (!sessionLogPath) return
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0]
  const sender = role === 'user' ? 'User → CD' : 'CD → User'
  const logEntry = `
---
## ${sender} | ${timestamp}

${content}
`
  await appendFile(sessionLogPath, logEntry, 'utf-8')
}

// Call the REAL chat API
async function callRealChatAPI(messages: any[], sourceImages: any[] = []): Promise<any> {
  const response = await fetch(`${getBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      sourceImages,
      uploadedFiles: []
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Chat API failed: ${response.status} - ${errorText}`)
  }

  return response.json()
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, payload } = body

    switch (action) {
      case 'ping':
        return NextResponse.json({
          success: true,
          message: 'Backdoor active',
          session: {
            active: sessionMessages.length > 0,
            businessName: sessionBusinessName,
            messages: sessionMessages.length,
            vibes: lastVibes.length,
            imageAssets: lastImageManifests.reduce((sum, m) => sum + m.assets.length, 0)
          }
        })

      case 'reset':
        sessionMessages = []
        sessionLogPath = null
        sessionBusinessName = null
        lastImageManifests = []
        lastVibes = []
        lastVibePaths = []
        return NextResponse.json({ success: true, message: 'Session reset' })

      case 'start-session': {
        const { businessName, businessDescription } = payload || {}
        if (!businessName || !businessDescription) {
          return NextResponse.json({ success: false, error: 'businessName and businessDescription required' })
        }

        const logPath = await initSession(businessName)
        sessionMessages.push({ role: 'user', content: businessDescription })
        await logMessage('user', businessDescription)

        const chatResponse = await callRealChatAPI(sessionMessages)
        sessionMessages.push({ role: 'assistant', content: chatResponse.message })
        await logMessage('assistant', chatResponse.message)

        // Store any vibes/manifests
        if (chatResponse.vibes) lastVibes = chatResponse.vibes
        if (chatResponse.vibePaths) lastVibePaths = chatResponse.vibePaths
        if (chatResponse.imageManifests) lastImageManifests = chatResponse.imageManifests

        return NextResponse.json({
          success: true,
          logPath,
          cdResponse: chatResponse.message,
          vibesGenerated: lastVibes.length,
          vibePaths: lastVibePaths,
          imageAssetsCount: lastImageManifests.reduce((sum, m) => sum + m.assets.length, 0)
        })
      }

      case 'send': {
        // Send a message to continue conversation
        const { message } = payload || {}
        if (!message) {
          return NextResponse.json({ success: false, error: 'message required' })
        }
        if (sessionMessages.length === 0) {
          return NextResponse.json({ success: false, error: 'No active session' })
        }

        sessionMessages.push({ role: 'user', content: message })
        await logMessage('user', message)

        const chatResponse = await callRealChatAPI(sessionMessages)
        sessionMessages.push({ role: 'assistant', content: chatResponse.message })
        await logMessage('assistant', chatResponse.message)

        // Store any vibes/manifests
        if (chatResponse.vibes) lastVibes = chatResponse.vibes
        if (chatResponse.vibePaths) lastVibePaths = chatResponse.vibePaths
        if (chatResponse.imageManifests) lastImageManifests = chatResponse.imageManifests

        return NextResponse.json({
          success: true,
          cdResponse: chatResponse.message,
          vibesGenerated: lastVibes.length,
          vibePaths: lastVibePaths,
          imageAssetsCount: lastImageManifests.reduce((sum, m) => sum + m.assets.length, 0)
        })
      }

      case 'get-state': {
        // Get full current state for review
        return NextResponse.json({
          success: true,
          session: {
            businessName: sessionBusinessName,
            logPath: sessionLogPath,
            messageCount: sessionMessages.length
          },
          vibes: lastVibes.map(v => ({
            name: v.name,
            headline: v.headline,
            htmlPath: lastVibePaths[lastVibes.indexOf(v)] || null,
            htmlLength: v.html?.length || 0
          })),
          imageManifests: lastImageManifests.map(m => ({
            vibeName: m.vibeName,
            vibeId: m.vibeId,
            assets: m.assets.map((a: any) => ({
              id: a.id,
              filename: a.filename,
              operation: a.operation,
              instruction: a.instruction,
              status: a.status,
              resultPath: a.resultPath || null
            }))
          }))
        })
      }

      case 'get-image-prompts': {
        // Get all image prompts for review before generation
        const allAssets = lastImageManifests.flatMap(m =>
          m.assets.map((a: any) => ({
            id: a.id,
            vibeName: m.vibeName,
            filename: a.filename,
            operation: a.operation,
            instruction: a.instruction,
            aspectRatio: a.aspectRatio,
            resolution: a.resolution,
            status: a.status
          }))
        )
        return NextResponse.json({
          success: true,
          count: allAssets.length,
          pending: allAssets.filter(a => a.status === 'pending').length,
          assets: allAssets
        })
      }

      case 'update-prompt': {
        // Update an image prompt before generation
        const { assetId, newInstruction } = payload || {}
        if (!assetId || !newInstruction) {
          return NextResponse.json({ success: false, error: 'assetId and newInstruction required' })
        }

        let found = false
        for (const manifest of lastImageManifests) {
          for (const asset of manifest.assets) {
            if (asset.id === assetId) {
              asset.instruction = newInstruction
              found = true
              break
            }
          }
          if (found) break
        }

        return NextResponse.json({ success: found, message: found ? 'Prompt updated' : 'Asset not found' })
      }

      case 'generate-image': {
        // Generate a single image by ID
        const { assetId } = payload || {}
        if (!assetId) {
          return NextResponse.json({ success: false, error: 'assetId required' })
        }

        let asset: any = null
        for (const manifest of lastImageManifests) {
          asset = manifest.assets.find((a: any) => a.id === assetId)
          if (asset) break
        }

        if (!asset) {
          return NextResponse.json({ success: false, error: 'Asset not found' })
        }

        // Update status
        asset.status = 'generating'

        // Call real image API
        const response = await fetch(`${getBaseUrl()}/api/edit-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instruction: asset.instruction,
            filename: asset.filename,
            operation: asset.operation || 'generate',
            aspectRatio: asset.aspectRatio || '16:9',
            imageSize: asset.resolution || '1K',
            sourceImagePaths: asset.sourceImages || []
          })
        })

        if (!response.ok) {
          asset.status = 'error'
          const errorText = await response.text()
          return NextResponse.json({ success: false, error: errorText })
        }

        const result = await response.json()
        asset.status = 'complete'
        asset.resultPath = result.savedPath

        return NextResponse.json({
          success: true,
          filename: asset.filename,
          savedPath: result.savedPath
        })
      }

      case 'generate-all-pending': {
        // Generate all pending images sequentially
        const pending = lastImageManifests.flatMap(m =>
          m.assets.filter((a: any) => a.status === 'pending')
        )

        if (pending.length === 0) {
          return NextResponse.json({ success: true, message: 'No pending images', generated: 0 })
        }

        const results: any[] = []
        for (const asset of pending) {
          console.log(`Generating: ${asset.filename}`)
          asset.status = 'generating'

          try {
            const response = await fetch(`${getBaseUrl()}/api/edit-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                instruction: asset.instruction,
                filename: asset.filename,
                operation: asset.operation || 'generate',
                aspectRatio: asset.aspectRatio || '16:9',
                imageSize: asset.resolution || '1K',
                sourceImagePaths: asset.sourceImages || []
              })
            })

            if (response.ok) {
              const result = await response.json()
              asset.status = 'complete'
              asset.resultPath = result.savedPath
              results.push({ filename: asset.filename, success: true, path: result.savedPath })
            } else {
              asset.status = 'error'
              results.push({ filename: asset.filename, success: false })
            }
          } catch (err) {
            asset.status = 'error'
            results.push({ filename: asset.filename, success: false, error: String(err) })
          }

          // Rate limit
          await new Promise(r => setTimeout(r, 2000))
        }

        return NextResponse.json({
          success: true,
          generated: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          results
        })
      }

      case 'view-html': {
        // View generated HTML content
        const { vibePath } = payload || {}
        if (!vibePath) {
          return NextResponse.json({ success: false, error: 'vibePath required' })
        }

        try {
          const fullPath = path.join(process.cwd(), 'public', vibePath)
          const content = await readFile(fullPath, 'utf-8')
          return NextResponse.json({
            success: true,
            path: vibePath,
            length: content.length,
            content: content.substring(0, 5000) + (content.length > 5000 ? '\n... [truncated]' : '')
          })
        } catch (err) {
          return NextResponse.json({ success: false, error: `File not found: ${vibePath}` })
        }
      }

      case 'list-generated-images': {
        // List all generated images
        const { readdirSync } = await import('fs')
        const imgDir = path.join(process.cwd(), 'public', 'generated-images')
        try {
          const files = readdirSync(imgDir)
            .filter(f => f.endsWith('.jpg') || f.endsWith('.png'))
            .sort((a, b) => b.localeCompare(a)) // newest first
          return NextResponse.json({
            success: true,
            directory: '/generated-images/',
            count: files.length,
            files: files.slice(0, 50).map(f => `/generated-images/${f}`)
          })
        } catch {
          return NextResponse.json({ success: true, count: 0, files: [] })
        }
      }

      case 'list-vibes': {
        // List all generated vibe HTML files
        const { readdirSync } = await import('fs')
        const vibeDir = path.join(process.cwd(), 'public', 'generated-vibes')
        try {
          const files = readdirSync(vibeDir)
            .filter(f => f.endsWith('.html'))
            .sort((a, b) => b.localeCompare(a)) // newest first
          return NextResponse.json({
            success: true,
            directory: '/generated-vibes/',
            count: files.length,
            files: files.slice(0, 30).map(f => `/generated-vibes/${f}`)
          })
        } catch {
          return NextResponse.json({ success: true, count: 0, files: [] })
        }
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` })
    }

  } catch (error) {
    console.error('Backdoor error:', error)
    return NextResponse.json({ error: `Backdoor error: ${error}` }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'active',
    mode: 'Real API - No shortcuts',
    session: {
      active: sessionMessages.length > 0,
      businessName: sessionBusinessName,
      messages: sessionMessages.length,
      vibes: lastVibes.length,
      pendingImages: lastImageManifests.reduce((sum, m) =>
        sum + m.assets.filter((a: any) => a.status === 'pending').length, 0
      )
    },
    actions: {
      session: ['ping', 'reset', 'start-session', 'send', 'get-state'],
      images: ['get-image-prompts', 'update-prompt', 'generate-image', 'generate-all-pending'],
      review: ['view-html', 'list-generated-images', 'list-vibes']
    }
  })
}
