/**
 * MarkdownRenderer — chat-message markdown wrapper.
 *
 * 2026-05-03 (Ralph): swapped internals from react-markdown + remark-gfm
 * + heavy inline styles to the new hand-rolled `renderMarkdown` from
 * `lib/runtime/markdown.tsx` (WP-2.3, FEATURE-X §1.4).
 *
 * Why: the inline styles in the old impl hardcoded h1=20px / h2=18px /
 * h3=16px, ignoring the .md-h* class system in app/globals.css that
 * actually sets the Navy SEAL spec (h1=48 / h2=36 / h3=24 / h4=18). New
 * renderer applies the .md-* classes; CSS now wins.
 *
 * Import surface preserved — `<MarkdownRenderer content={...} />` works
 * exactly as before. Special-case code-block hides (image-analysis,
 * tool_use json) routed through the new renderer's `codeBlockOverride`
 * hook, which keeps the four-channel doctrine intact.
 *
 * react-markdown + remark-gfm deps are now unreachable from this file.
 * Removable from package.json once nothing else imports them — sweep
 * with `grep -rn "react-markdown\|remark-gfm"` before pruning.
 */
import React from 'react'
import { renderMarkdown } from '@/lib/runtime/markdown'

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <>
      {renderMarkdown(content, {
        codeBlockOverride: (lang, body) => {
          // Hide the legacy image-analysis blocks behind a small green chip
          // (mirrors the old special case so chat stays clean during the
          // transition). Once the four-channel doctrine fully takes hold,
          // image analyses route through submit_image_verdict and this
          // override can drop.
          if (lang === 'image-analysis') {
            return (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: 'rgba(34, 197, 94, 0.1)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  color: '#86efac',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  margin: '8px 0',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <span>✓</span>
                <span>Image analysis logged</span>
              </div>
            )
          }

          // Suppress json blocks containing tool_use payloads (vestige of
          // pre-Phase-2 chat surface; tool calls now render as ToolCards).
          if (lang === 'json' && body.includes('tool_use')) {
            return null
          }

          // Fall through to the default <pre><code> render.
          return undefined
        },
      })}
    </>
  )
}
