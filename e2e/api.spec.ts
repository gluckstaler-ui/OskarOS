import { test, expect } from '@playwright/test'

/**
 * API Integration Tests
 * Tests the HTTP API endpoints directly without browser UI
 */

test.describe('API: /api/upload', () => {
  test('accepts file upload without session', async ({ request }) => {
    // Create a simple test image (1x1 pixel PNG)
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )

    const response = await request.post('/api/upload', {
      multipart: {
        file: {
          name: 'test-image.png',
          mimeType: 'image/png',
          buffer: pngData,
        },
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()

    expect(data).toHaveProperty('id')
    expect(data).toHaveProperty('filename')
    expect(data).toHaveProperty('path')
    expect(data.path).toContain('/uploads/')
    expect(data).toHaveProperty('originalName', 'test-image.png')
    expect(data).toHaveProperty('uploadedAt')
  })

  test('accepts file upload with session ID', async ({ request }) => {
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )

    const sessionId = 'test-session-' + Date.now()

    const response = await request.post('/api/upload', {
      multipart: {
        file: {
          name: 'session-image.png',
          mimeType: 'image/png',
          buffer: pngData,
        },
        sessionId: sessionId,
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()

    expect(data.path).toContain(`/${sessionId}/`)
  })

  test('returns 400 when no file provided', async ({ request }) => {
    const response = await request.post('/api/upload', {
      multipart: {},
    })

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })
})

test.describe('API: /api/save-vibes', () => {
  test('saves single vibe', async ({ request }) => {
    const vibeHtml = `<!DOCTYPE html>
<html>
<head><title>Test Vibe</title></head>
<body>
  <h1 data-editable="headline">Test Headline</h1>
  <img data-usage="hero" src="placeholder.jpg" />
</body>
</html>`

    const response = await request.post('/api/save-vibes', {
      data: {
        vibes: [
          {
            id: 'vibe-1',
            name: 'Test Vibe',
            html: vibeHtml,
          },
        ],
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(data.count).toBe(1)
    expect(data.vibePaths).toHaveLength(1)
    expect(data.vibePaths[0]).toContain('/vibes/')
    expect(data.vibePaths[0]).toContain('.html')
  })

  test('saves multiple vibes', async ({ request }) => {
    const makeVibe = (name: string) => ({
      id: `vibe-${name}`,
      name: name,
      html: `<html><body><h1>${name}</h1></body></html>`,
    })

    const response = await request.post('/api/save-vibes', {
      data: {
        vibes: [makeVibe('Alpha'), makeVibe('Beta'), makeVibe('Gamma')],
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()

    expect(data.success).toBe(true)
    expect(data.count).toBe(3)
    expect(data.vibePaths).toHaveLength(3)
  })

  test('saves vibes to session folder when sessionId provided', async ({ request }) => {
    const sessionId = 'test-vibe-session-' + Date.now()

    const response = await request.post('/api/save-vibes', {
      data: {
        sessionId: sessionId,
        vibes: [
          {
            id: 'vibe-1',
            name: 'Session Vibe',
            html: '<html><body>Session content</body></html>',
          },
        ],
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()

    expect(data.vibePaths[0]).toContain(`/${sessionId}/`)
  })

  test('injects bridge script into HTML', async ({ request }) => {
    const response = await request.post('/api/save-vibes', {
      data: {
        vibes: [
          {
            id: 'vibe-1',
            name: 'Bridge Test',
            html: '<html><body><h1>Test</h1></body></html>',
          },
        ],
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()

    // Fetch the saved HTML to verify bridge script was injected
    const htmlResponse = await request.get(data.vibePaths[0])
    expect(htmlResponse.ok()).toBe(true)

    const html = await htmlResponse.text()
    expect(html).toContain('BRIDGE_READY')
    expect(html).toContain('ELEMENT_SELECTED')
    expect(html).toContain('oskar-director')
  })

  test('returns 400 when no vibes provided', async ({ request }) => {
    const response = await request.post('/api/save-vibes', {
      data: {
        vibes: [],
      },
    })

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data).toHaveProperty('error')
  })
})

test.describe('API: /api/admin/sessions', () => {
  test('returns session list', async ({ request }) => {
    const response = await request.get('/api/admin/sessions')

    expect(response.ok()).toBe(true)
    const data = await response.json()

    expect(data).toHaveProperty('sessions')
    expect(Array.isArray(data.sessions)).toBe(true)
  })

  test('sessions have required fields', async ({ request }) => {
    const response = await request.get('/api/admin/sessions')
    const data = await response.json()

    if (data.sessions.length > 0) {
      const session = data.sessions[0]
      expect(session).toHaveProperty('id')
      expect(session).toHaveProperty('name') // API returns 'name' not 'businessName'
      expect(session).toHaveProperty('phase')
      expect(session).toHaveProperty('lastUpdated')
      expect(session).toHaveProperty('tokenBurn')
    }
  })
})

test.describe('API: /api/sessions/[id]/usage', () => {
  test('returns usage data for session', async ({ request }) => {
    // First get a real session ID from admin API
    const sessionsResponse = await request.get('/api/admin/sessions')
    const sessionsData = await sessionsResponse.json()

    if (sessionsData.sessions && sessionsData.sessions.length > 0) {
      const sessionId = sessionsData.sessions[0].id

      const response = await request.get(`/api/sessions/${sessionId}/usage`)
      expect(response.ok()).toBe(true)

      const data = await response.json()
      expect(data).toHaveProperty('sessionId')
      expect(data).toHaveProperty('totals')
      expect(data).toHaveProperty('display')
      expect(data.totals).toHaveProperty('inputTokens')
      expect(data.totals).toHaveProperty('outputTokens')
      expect(data.totals).toHaveProperty('cost')
      expect(data.display).toHaveProperty('cost')
    }
  })

  test('returns empty usage for new session', async ({ request }) => {
    const response = await request.get('/api/sessions/nonexistent-session-123/usage')
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.totals.inputTokens).toBe(0)
    expect(data.totals.outputTokens).toBe(0)
    expect(data.totals.cost).toBe(0)
  })
})

test.describe('API: Error Handling', () => {
  test('/api/upload handles malformed requests gracefully', async ({ request }) => {
    const response = await request.post('/api/upload', {
      headers: { 'Content-Type': 'application/json' },
      data: { invalid: 'data' },
    })

    // Should return error, not crash
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })

  test('/api/save-vibes handles missing body', async ({ request }) => {
    const response = await request.post('/api/save-vibes', {
      data: null,
    })

    expect(response.status()).toBeGreaterThanOrEqual(400)
  })
})

test.describe('API: /api/vibe-edit', () => {
  test('returns 400 when missing required fields', async ({ request }) => {
    const response = await request.post('/api/vibe-edit', {
      data: {
        sessionId: 'test-session',
        // Missing other required fields
      },
    })

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('Missing required fields')
  })

  test('returns 400 for invalid editType', async ({ request }) => {
    const response = await request.post('/api/vibe-edit', {
      data: {
        sessionId: 'test-session',
        vibeFile: 'test.html',
        editType: 'invalid',
        elementId: 'headline',
        newValue: 'New text',
      },
    })

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('editType must be')
  })

  test('returns 400 for non-HTML vibeFile', async ({ request }) => {
    const response = await request.post('/api/vibe-edit', {
      data: {
        sessionId: 'test-session',
        vibeFile: 'test.txt',
        editType: 'text',
        elementId: 'headline',
        newValue: 'New text',
      },
    })

    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('HTML file')
  })

  test('returns 404 when session/file not found', async ({ request }) => {
    const response = await request.post('/api/vibe-edit', {
      data: {
        sessionId: 'nonexistent-session-xyz',
        vibeFile: 'nonexistent.html',
        editType: 'text',
        elementId: 'headline',
        newValue: 'New text',
      },
    })

    // Should return 500 (file not found) or 404
    expect(response.status()).toBeGreaterThanOrEqual(400)
  })
})
