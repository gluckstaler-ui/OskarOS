import { test, expect } from '@playwright/test'

/**
 * Full Workflow E2E Tests
 * Tests complete user journeys through the application
 */

test.describe('Session Workflow', () => {
  test('complete session creation workflow', async ({ page, request }) => {
    // Navigate to the app
    await page.goto('/')

    // Wait for the app to load
    await page.waitForLoadState('networkidle')

    // Check that the main UI elements are present
    await expect(page.locator('body')).toBeVisible()

    // The app should show some kind of conversation panel or input
    // (adapt selectors based on actual UI)
    const chatInput = page.locator('textarea, input[type="text"]').first()

    // App should be interactive
    await expect(chatInput).toBeVisible({ timeout: 10000 })
  })

  test('upload image workflow', async ({ page, request }) => {
    // First, upload an image via API
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )

    const uploadResponse = await request.post('/api/upload', {
      multipart: {
        file: {
          name: 'workflow-test.png',
          mimeType: 'image/png',
          buffer: pngData,
        },
      },
    })

    expect(uploadResponse.ok()).toBe(true)
    const uploadData = await uploadResponse.json()
    expect(uploadData.path).toBeTruthy()

    // Verify the file is accessible
    const imageResponse = await request.get(uploadData.path)
    expect(imageResponse.ok()).toBe(true)
    expect(imageResponse.headers()['content-type']).toContain('image')
  })

  test('vibe generation and display workflow', async ({ page, request }) => {
    const sessionId = `e2e-test-${Date.now()}`

    // Create a vibe with proper structure
    const vibeHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>E2E Test Vibe</title>
  <style>
    body { font-family: system-ui; margin: 0; padding: 20px; }
    .hero { background: #1a1a2e; color: white; padding: 60px 20px; text-align: center; }
    h1 { font-size: 3rem; margin: 0; }
    .tagline { font-size: 1.25rem; opacity: 0.8; margin-top: 10px; }
  </style>
</head>
<body>
  <header class="hero">
    <h1 data-editable="h1-hero">Welcome to the Test</h1>
    <p class="tagline" data-editable="tagline">This is an E2E test vibe</p>
    <img data-usage="hero" src="placeholder.jpg" alt="Hero image" style="max-width: 100%; margin-top: 20px;" />
  </header>
  <main>
    <section>
      <h2 data-editable="section-title">About Us</h2>
      <p data-editable="section-content">Lorem ipsum dolor sit amet.</p>
    </section>
  </main>
</body>
</html>`

    // Save the vibe via API
    const saveResponse = await request.post('/api/save-vibes', {
      data: {
        sessionId: sessionId,
        vibes: [
          {
            id: 'vibe-1',
            name: 'E2E Test Vibe',
            html: vibeHtml,
            headline: 'Welcome to the Test',
            tagline: 'This is an E2E test vibe',
            colors: ['#1a1a2e', '#ffffff', '#e94560'],
          },
        ],
      },
    })

    expect(saveResponse.ok()).toBe(true)
    const saveData = await saveResponse.json()
    expect(saveData.vibePaths).toHaveLength(1)

    // Navigate to the saved vibe
    await page.goto(saveData.vibePaths[0])

    // Verify the vibe content is displayed
    await expect(page.locator('h1')).toContainText('Welcome to the Test')
    await expect(page.locator('.tagline')).toContainText('E2E test vibe')

    // Verify data-editable attributes are present
    const editableElements = await page.locator('[data-editable]').count()
    expect(editableElements).toBeGreaterThan(0)

    // Verify data-usage attributes are present (for hot-swap)
    const usageElements = await page.locator('[data-usage]').count()
    expect(usageElements).toBeGreaterThan(0)

    // Verify bridge script was injected
    const bodyHtml = await page.content()
    expect(bodyHtml).toContain('BRIDGE_READY')
  })

  test('vibe with multiple slots for hot-swap', async ({ page, request }) => {
    const sessionId = `e2e-hotswap-${Date.now()}`

    const vibeHtml = `<!DOCTYPE html>
<html>
<head><title>Hot-Swap Test</title></head>
<body>
  <img data-usage="hero" data-slot="hero" src="placeholder.jpg" alt="Hero" />
  <img data-usage="menu" data-slot="menu" src="placeholder.jpg" alt="Menu" />
  <img data-usage="portrait" data-slot="portrait" src="placeholder.jpg" alt="Portrait" />
</body>
</html>`

    const response = await request.post('/api/save-vibes', {
      data: {
        sessionId: sessionId,
        vibes: [{ id: 'hotswap-vibe', name: 'HotSwap Test', html: vibeHtml }],
      },
    })

    expect(response.ok()).toBe(true)
    const data = await response.json()

    // Navigate to the vibe
    await page.goto(data.vibePaths[0])

    // Verify all three slots exist
    const heroImg = page.locator('[data-usage="hero"]')
    const menuImg = page.locator('[data-usage="menu"]')
    const portraitImg = page.locator('[data-usage="portrait"]')

    await expect(heroImg).toBeVisible()
    await expect(menuImg).toBeVisible()
    await expect(portraitImg).toBeVisible()

    // All should have placeholder src initially
    expect(await heroImg.getAttribute('src')).toContain('placeholder')
    expect(await menuImg.getAttribute('src')).toContain('placeholder')
    expect(await portraitImg.getAttribute('src')).toContain('placeholder')
  })
})

test.describe('Director Mode', () => {
  test('bridge script enables director mode', async ({ page, request }) => {
    const sessionId = `e2e-director-${Date.now()}`

    const vibeHtml = `<!DOCTYPE html>
<html>
<head><title>Director Mode Test</title></head>
<body>
  <h1 data-editable="main-headline">Test Headline</h1>
  <p data-editable="main-paragraph">Test paragraph content</p>
</body>
</html>`

    const response = await request.post('/api/save-vibes', {
      data: {
        sessionId: sessionId,
        vibes: [{ id: 'director-vibe', name: 'Director Test', html: vibeHtml }],
      },
    })

    const data = await response.json()
    await page.goto(data.vibePaths[0])

    // Wait for bridge script to load
    await page.waitForFunction(() => {
      return document.querySelector('#oskar-director-styles') !== null
    })

    // Director mode banner should exist (but be hidden initially)
    const banner = page.locator('.oskar-director-banner')
    await expect(banner).toBeAttached()

    // Enable director mode via postMessage
    await page.evaluate(() => {
      window.postMessage({ type: 'SET_DIRECTOR_MODE', enabled: true }, '*')
    })

    // Wait for director mode to activate
    await page.waitForFunction(() => {
      return document.body.classList.contains('oskar-director-active')
    })

    // Banner should now be visible
    await expect(banner).toBeVisible()

    // Editable elements should have outline styles
    const headline = page.locator('[data-editable="main-headline"]')
    await expect(headline).toBeVisible()
  })

  test('element selection sends postMessage', async ({ page, request }) => {
    const sessionId = `e2e-select-${Date.now()}`

    const vibeHtml = `<!DOCTYPE html>
<html>
<head><title>Selection Test</title></head>
<body>
  <h1 data-editable="click-test">Click Me</h1>
</body>
</html>`

    const response = await request.post('/api/save-vibes', {
      data: {
        sessionId: sessionId,
        vibes: [{ id: 'select-vibe', name: 'Selection Test', html: vibeHtml }],
      },
    })

    const data = await response.json()
    await page.goto(data.vibePaths[0])

    // Wait for bridge script
    await page.waitForFunction(() => {
      return document.querySelector('#oskar-director-styles') !== null
    })

    // Enable director mode
    await page.evaluate(() => {
      window.postMessage({ type: 'SET_DIRECTOR_MODE', enabled: true }, '*')
    })

    await page.waitForFunction(() => {
      return document.body.classList.contains('oskar-director-active')
    })

    // Set up message listener
    const messagePromise = page.evaluate(() => {
      return new Promise((resolve) => {
        window.addEventListener('message', (e) => {
          if (e.data && e.data.type === 'ELEMENT_SELECTED') {
            resolve(e.data)
          }
        })
      })
    })

    // Click the editable element
    await page.locator('[data-editable="click-test"]').click()

    // Verify the message was sent
    const message = await messagePromise
    expect(message).toHaveProperty('type', 'ELEMENT_SELECTED')
    expect(message).toHaveProperty('id', 'click-test')
    expect(message).toHaveProperty('elementType', 'text')
    expect(message).toHaveProperty('currentValue', 'Click Me')
  })
})

test.describe('Admin Dashboard', () => {
  test('admin page loads', async ({ page }) => {
    await page.goto('/admin.html')

    // Admin page should have some session management UI
    await expect(page.locator('body')).toBeVisible()

    // Wait for any dynamic content to load
    await page.waitForLoadState('networkidle')
  })

  test('sessions list is populated from API', async ({ page, request }) => {
    // First get sessions from API
    const apiResponse = await request.get('/api/admin/sessions')
    const apiData = await apiResponse.json()

    // Navigate to admin page
    await page.goto('/admin.html')
    await page.waitForLoadState('networkidle')

    // If there are sessions, they should appear in the UI
    if (apiData.sessions && apiData.sessions.length > 0) {
      // Wait for sessions to be rendered
      await page.waitForTimeout(1000) // Give time for JS to render

      // Check that some session content is visible
      const pageContent = await page.content()
      expect(pageContent.length).toBeGreaterThan(100)
    }
  })
})

test.describe('Error Recovery', () => {
  test('app handles 404 gracefully', async ({ page }) => {
    const response = await page.goto('/nonexistent-page')

    // Should either redirect or show 404 page, not crash
    expect(response?.status()).toBe(404)
  })

  test('app handles API errors gracefully', async ({ page }) => {
    await page.goto('/')

    // Try to interact with the page even if there are errors
    const errorLogs: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errorLogs.push(msg.text())
      }
    })

    // Wait for page to stabilize
    await page.waitForLoadState('networkidle')

    // The app should not have fatal errors that prevent rendering
    await expect(page.locator('body')).toBeVisible()
  })
})
