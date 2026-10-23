// ==========================================
// Correspondence templates — GET /api/admin/crm/templates
//   → { templates: [{ id, name, channel, lang, subject, use, body }] }
//
// One file = one template, db/templates/*.md with a --- frontmatter --- block.
// Files ARE the API: Filippo/Ralph edit them directly, the Consular reads them
// from disk when drafting, this route only mirrors them into the Composer's
// template picker. No database, no cache — the folder is the truth.
// Consular 2026-08-15 (Filippo: "templates for first correspondence").
// ==========================================

import { NextResponse } from 'next/server'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const TEMPLATES_DIR = resolve(process.cwd(), 'db', 'templates')

interface Template {
  id: string
  name: string
  channel: 'email' | 'whatsapp'
  lang: string
  subject: string
  use: string
  body: string
  file: string
}

function parseTemplate(file: string, raw: string): Template | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return null
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (kv) meta[kv[1]] = kv[2].replace(/^"|"$/g, '').trim()
  }
  if (!meta.id || !meta.name) return null
  return {
    id: meta.id,
    name: meta.name,
    channel: meta.channel === 'whatsapp' ? 'whatsapp' : 'email',
    lang: meta.lang || 'de',
    subject: meta.subject || '',
    use: meta.use || '',
    body: m[2].trim(),
    file,
  }
}

export async function GET() {
  try {
    if (!existsSync(TEMPLATES_DIR)) return NextResponse.json({ templates: [] })
    const templates = readdirSync(TEMPLATES_DIR)
      .filter((f) => f.endsWith('.md') && f !== 'README.md')
      .sort()
      .map((f) => {
        try { return parseTemplate(f, readFileSync(join(TEMPLATES_DIR, f), 'utf-8')) } catch { return null }
      })
      .filter((t): t is Template => t !== null)
    return NextResponse.json({ templates })
  } catch (err) {
    return NextResponse.json({ templates: [], error: String(err) }, { status: 500 })
  }
}
