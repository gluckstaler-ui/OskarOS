import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// ============================================================================
// MARKDOWN RENDERER - USING INLINE STYLES (NO TAILWIND)
// ============================================================================

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Style Code Blocks
        code({ node, inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '')
          const language = match ? match[1] : ''
          const codeString = String(children).replace(/\n$/, '')

          // Hide the "image-analysis" blocks
          if (language === 'image-analysis') {
            return (
              <div style={{
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
                fontFamily: 'var(--font-mono)'
              }}>
                <span>✓</span>
                <span>Image analysis logged</span>
              </div>
            )
          }

          // Hide json tool outputs
          if (language === 'json' && codeString.includes('tool_use')) {
            return null
          }

          // Render code blocks
          return !inline && match ? (
            <div style={{
              borderRadius: '6px',
              overflow: 'hidden',
              margin: '12px 0',
              border: '1px solid var(--border-card)'
            }}>
              <div style={{
                backgroundColor: 'var(--bg-app)',
                padding: '4px 12px',
                fontSize: '10px',
                color: 'var(--text-muted)',
                borderBottom: '1px solid var(--border-card)',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-mono)'
              }}>
                {language}
              </div>
              <pre style={{
                margin: 0,
                padding: '12px',
                backgroundColor: 'var(--bg-app)',
                overflow: 'auto',
                fontSize: '13px',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-main)'
              }}>
                <code>{codeString}</code>
              </pre>
            </div>
          ) : (
            <code style={{
              backgroundColor: 'var(--bg-app)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '13px',
              color: 'var(--text-main)',
              fontFamily: 'var(--font-mono)'
            }} {...props}>
              {children}
            </code>
          )
        },

        // Style Tables
        table({ children }) {
          return (
            <div style={{
              overflowX: 'auto',
              margin: '16px 0',
              border: '1px solid var(--border-card)',
              borderRadius: '8px'
            }}>
              <table style={{
                minWidth: '100%',
                borderCollapse: 'collapse',
                fontSize: '13px'
              }}>
                {children}
              </table>
            </div>
          )
        },
        thead({ children }) {
          return <thead style={{ backgroundColor: 'var(--bg-app)', fontSize: '12px' }}>{children}</thead>
        },
        th({ children }) {
          return <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, fontSize: '12px', whiteSpace: 'nowrap' }}>{children}</th>
        },
        td({ children }) {
          return <td style={{ padding: '10px 12px', borderTop: '1px solid var(--border-card)', fontSize: '13px' }}>{children}</td>
        },

        // Style Links
        a({ children, href }) {
          return (
            <a href={href} style={{ color: 'var(--accent, #3B82F6)', textDecoration: 'none' }} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          )
        },

        // Style Headings - H3 in emerald to stand out
        h1: ({ children }) => <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px', marginTop: '24px', color: '#06b6d4' }}>{children}</h1>,
        h2: ({ children }) => <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '12px', marginTop: '20px', color: '#a855f7' }}>{children}</h2>,
        h3: ({ children }) => <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px', marginTop: '16px', color: '#10b981' }}>{children}</h3>,

        // Style Lists - NO color override, inherit from parent
        ul: ({ children }) => <ul style={{ listStyleType: 'disc', paddingLeft: '24px', marginBottom: '16px', fontSize: '14px' }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ listStyleType: 'decimal', paddingLeft: '24px', marginBottom: '16px', fontSize: '14px' }}>{children}</ol>,
        li: ({ children }) => <li style={{ marginBottom: '6px', lineHeight: 1.6, fontSize: '14px' }}>{children}</li>,

        // Paragraphs - NO color override, inherit from parent
        p: ({ children }) => <p style={{ marginBottom: '14px', lineHeight: 1.7, fontSize: '14px' }}>{children}</p>,

        // Blockquotes
        blockquote: ({ children }) => (
          <blockquote style={{
            borderLeft: '4px solid var(--accent, #3B82F6)',
            paddingLeft: '16px',
            fontStyle: 'italic',
            margin: '16px 0',
            color: 'var(--text-muted)',
            backgroundColor: 'var(--bg-app)',
            padding: '8px 16px',
            borderRadius: '0 8px 8px 0'
          }}>
            {children}
          </blockquote>
        ),

        // Strong/Bold - NO color override, inherit from parent
        strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,

        // Emphasis/Italic
        em: ({ children }) => <em style={{ fontStyle: 'italic' }}>{children}</em>,

        // Horizontal Rule - hide it entirely to avoid ugly lines in bubbles
        hr: () => null
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
