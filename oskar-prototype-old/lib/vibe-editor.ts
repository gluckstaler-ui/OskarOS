/**
 * Vibe Editor - HTML manipulation for Director Mode
 *
 * Handles text and image edits to vibe HTML files.
 * Used by /api/vibe-edit for immediate persistence.
 */

import { readFile, writeFile } from 'fs/promises'
import path from 'path'

// ==========================================
// Types
// ==========================================

export interface TextEditResult {
  success: boolean
  error?: string
  oldValue?: string
  newValue?: string
}

export interface ImageEditResult {
  success: boolean
  error?: string
  oldSrc?: string
  newSrc?: string
}

// ==========================================
// HTML Escaping
// ==========================================

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Unescape HTML entities back to characters
 */
export function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
}

// ==========================================
// Text Editing
// ==========================================

/**
 * Edit text content of element with data-editable attribute
 *
 * Matches: <tagname ...data-editable="id"...>CONTENT</tagname>
 * Replaces CONTENT with newText (HTML-escaped)
 *
 * Only replaces FIRST match (handles duplicate IDs gracefully)
 */
export function editTextInHtml(
  html: string,
  elementId: string,
  newText: string
): { html: string; oldValue: string | null } {
  // Escape the element ID for use in regex
  const escapedId = elementId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Pattern matches element with data-editable="id" and captures:
  // $1 = opening tag (including data-editable)
  // $2 = inner content (what we replace)
  // $3 = closing tag
  const pattern = new RegExp(
    `(<[a-z][a-z0-9]*[^>]*\\bdata-editable=["']${escapedId}["'][^>]*>)([\\s\\S]*?)(</[a-z][a-z0-9]*>)`,
    'i' // Case insensitive, NOT global (first match only)
  )

  let oldValue: string | null = null

  const newHtml = html.replace(pattern, (match, openTag, content, closeTag) => {
    oldValue = content.trim()
    // Escape new text to prevent XSS
    const escapedText = escapeHtml(newText)
    return `${openTag}${escapedText}${closeTag}`
  })

  return { html: newHtml, oldValue }
}

// ==========================================
// Image Editing
// ==========================================

/**
 * Edit src attribute of img with data-usage attribute
 *
 * Handles both attribute orders:
 * - <img data-usage="hero" src="old.jpg">
 * - <img src="old.jpg" data-usage="hero">
 *
 * Only replaces FIRST match
 */
export function editImageInHtml(
  html: string,
  usage: string,
  newSrc: string
): { html: string; oldSrc: string | null } {
  const escapedUsage = usage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  let oldSrc: string | null = null
  let replaced = false

  // Pattern 1: data-usage comes before src
  const pattern1 = new RegExp(
    `(<img[^>]*\\bdata-usage=["']${escapedUsage}["'][^>]*\\bsrc=["'])([^"']+)(["'][^>]*>)`,
    'i'
  )

  // Pattern 2: src comes before data-usage
  const pattern2 = new RegExp(
    `(<img[^>]*\\bsrc=["'])([^"']+)(["'][^>]*\\bdata-usage=["']${escapedUsage}["'][^>]*>)`,
    'i'
  )

  // Try pattern 1 first
  let newHtml = html.replace(pattern1, (match, prefix, currentSrc, suffix) => {
    if (replaced) return match // Only first match
    oldSrc = currentSrc
    replaced = true
    return `${prefix}${newSrc}${suffix}`
  })

  // If pattern 1 didn't match, try pattern 2
  if (!replaced) {
    newHtml = html.replace(pattern2, (match, prefix, currentSrc, suffix) => {
      if (replaced) return match
      oldSrc = currentSrc
      replaced = true
      return `${prefix}${newSrc}${suffix}`
    })
  }

  return { html: newHtml, oldSrc }
}

// ==========================================
// File Operations
// ==========================================

/**
 * Get path to vibe HTML file in session folder
 */
function getVibeFilePath(sessionId: string, vibeFile: string): string {
  return path.join(process.cwd(), 'public', sessionId, vibeFile)
}

/**
 * Get path to BUILD.md in session folder
 */
function getBuildMdPath(sessionId: string): string {
  return path.join(process.cwd(), 'public', sessionId, 'BUILD.md')
}

/**
 * Apply a text edit to a vibe HTML file
 */
export async function applyTextEdit(
  sessionId: string,
  vibeFile: string,
  elementId: string,
  newText: string
): Promise<TextEditResult> {
  const filePath = getVibeFilePath(sessionId, vibeFile)

  try {
    // Read current HTML
    const html = await readFile(filePath, 'utf-8')

    // Apply edit
    const { html: newHtml, oldValue } = editTextInHtml(html, elementId, newText)

    // Check if edit was applied
    if (oldValue === null) {
      return {
        success: false,
        error: `Element with data-editable="${elementId}" not found`
      }
    }

    // Write updated HTML
    await writeFile(filePath, newHtml, 'utf-8')

    // Log to BUILD.md
    await logEditToBuildMd(sessionId, 'text', vibeFile, elementId, oldValue, newText)

    return {
      success: true,
      oldValue,
      newValue: newText
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to apply text edit: ${error}`
    }
  }
}

/**
 * Apply an image edit to a vibe HTML file
 */
export async function applyImageEdit(
  sessionId: string,
  vibeFile: string,
  usage: string,
  newSrc: string
): Promise<ImageEditResult> {
  const filePath = getVibeFilePath(sessionId, vibeFile)

  try {
    // Read current HTML
    const html = await readFile(filePath, 'utf-8')

    // Apply edit
    const { html: newHtml, oldSrc } = editImageInHtml(html, usage, newSrc)

    // Check if edit was applied
    if (oldSrc === null) {
      return {
        success: false,
        error: `Image with data-usage="${usage}" not found`
      }
    }

    // Write updated HTML
    await writeFile(filePath, newHtml, 'utf-8')

    // Log to BUILD.md
    await logEditToBuildMd(sessionId, 'image', vibeFile, usage, oldSrc, newSrc)

    return {
      success: true,
      oldSrc,
      newSrc
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to apply image edit: ${error}`
    }
  }
}

// ==========================================
// BUILD.md Logging
// ==========================================

/**
 * Log an edit to BUILD.md
 * Appends to the Director Mode Edit Log section
 */
async function logEditToBuildMd(
  sessionId: string,
  editType: 'text' | 'image',
  vibeFile: string,
  elementId: string,
  oldValue: string,
  newValue: string
): Promise<void> {
  const buildMdPath = getBuildMdPath(sessionId)

  try {
    let content = await readFile(buildMdPath, 'utf-8')

    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })

    // Truncate values for logging (keep it readable)
    const truncate = (s: string, max: number) =>
      s.length > max ? s.substring(0, max) + '...' : s

    const oldDisplay = truncate(oldValue.replace(/\n/g, ' '), 30)
    const newDisplay = truncate(newValue.replace(/\n/g, ' '), 30)
    const vibeName = vibeFile.replace('.html', '').replace(/^\d+-/, '')

    // Check if Director Mode Edit Log section exists
    if (!content.includes('## Director Mode Edit Log')) {
      // Add section before the end or after Hot-Swap Log
      const insertPoint = content.includes('## Hot-Swap Log')
        ? content.indexOf('## Hot-Swap Log')
        : content.length

      const editLogSection = `
## Director Mode Edit Log

| Time | Vibe | Type | Element | Old | New |
|------|------|------|---------|-----|-----|
`
      content = content.slice(0, insertPoint) + editLogSection + content.slice(insertPoint)
    }

    // Find the edit log table and append row
    const tableHeaderPattern = /(\| Time \| Vibe \| Type \| Element \| Old \| New \|\n\|[-|]+\|)/
    const match = content.match(tableHeaderPattern)

    if (match) {
      const newRow = `\n| ${timestamp} | ${vibeName} | ${editType} | ${elementId} | ${oldDisplay} | ${newDisplay} |`
      content = content.replace(tableHeaderPattern, `$1${newRow}`)
    }

    await writeFile(buildMdPath, content, 'utf-8')
  } catch (error) {
    // Log error but don't fail the edit
    console.error('Failed to log edit to BUILD.md:', error)
  }
}
