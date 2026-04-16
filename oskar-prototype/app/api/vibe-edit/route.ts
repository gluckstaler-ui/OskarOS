/**
 * POST /api/vibe-edit
 *
 * Director Mode persistence endpoint.
 * Applies text or image edits to vibe HTML files and logs to BUILD.md.
 */

import { NextRequest, NextResponse } from 'next/server'
import { applyTextEdit, applyImageEdit } from '@/lib/vibe-editor'

interface EditRequest {
  sessionId: string
  vibeFile: string
  editType: 'text' | 'image'
  elementId: string  // data-editable ID for text, data-usage for images
  newValue: string   // new text content or new src URL
}

export async function POST(request: NextRequest) {
  try {
    const body: EditRequest = await request.json()

    // Validate required fields
    if (!body.sessionId || !body.vibeFile || !body.editType || !body.elementId || !body.newValue) {
      return NextResponse.json(
        { error: 'Missing required fields: sessionId, vibeFile, editType, elementId, newValue' },
        { status: 400 }
      )
    }

    // Validate editType
    if (body.editType !== 'text' && body.editType !== 'image') {
      return NextResponse.json(
        { error: 'editType must be "text" or "image"' },
        { status: 400 }
      )
    }

    // Validate vibeFile ends with .html
    if (!body.vibeFile.endsWith('.html')) {
      return NextResponse.json(
        { error: 'vibeFile must be an HTML file' },
        { status: 400 }
      )
    }

    // Apply the edit
    if (body.editType === 'text') {
      const result = await applyTextEdit(
        body.sessionId,
        body.vibeFile,
        body.elementId,
        body.newValue
      )

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 404 }
        )
      }

      return NextResponse.json({
        success: true,
        editType: 'text',
        elementId: body.elementId,
        oldValue: result.oldValue,
        newValue: result.newValue
      })
    } else {
      // Image edit
      const result = await applyImageEdit(
        body.sessionId,
        body.vibeFile,
        body.elementId,  // This is the data-usage value for images
        body.newValue
      )

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 404 }
        )
      }

      return NextResponse.json({
        success: true,
        editType: 'image',
        usage: body.elementId,
        oldSrc: result.oldSrc,
        newSrc: result.newSrc
      })
    }
  } catch (error) {
    console.error('Vibe edit error:', error)
    return NextResponse.json(
      { error: `Failed to apply edit: ${error}` },
      { status: 500 }
    )
  }
}
