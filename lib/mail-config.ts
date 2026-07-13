// ==========================================
// POSTMASTER mail config (PM-7, spec §04/§10)
// One reader for the OSKAR_MAIL_* env block. Consumed by the Settings
// mail route (GET/POST), the connection test route, and — PM-1 — the
// Eyes sweep. .env.local is read directly (not process.env first)
// because Settings edits it at runtime while process.env stays frozen.
// ==========================================

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export const ENV_FILE = join(process.cwd(), '.env.local')

// The managed vars — exactly the spec §04 config block. Order = UI order.
export const MAIL_ENV_VARS = [
  'OSKAR_MAIL_USER',
  'OSKAR_MAIL_PASS',
  'OSKAR_MAIL_IMAP_HOST',
  'OSKAR_MAIL_IMAP_PORT',
  'OSKAR_MAIL_SMTP_HOST',
  'OSKAR_MAIL_SMTP_PORT',
  'OSKAR_MAIL_SWEEP_SEC',
] as const

// Defaults per spec §10: Namecheap Private Email hosts; hourly sweep.
export const MAIL_DEFAULTS: Record<string, string> = {
  OSKAR_MAIL_IMAP_HOST: 'mail.privateemail.com',
  OSKAR_MAIL_IMAP_PORT: '993',
  OSKAR_MAIL_SMTP_HOST: 'mail.privateemail.com',
  OSKAR_MAIL_SMTP_PORT: '465',
  OSKAR_MAIL_SWEEP_SEC: '3600',
}

export function readEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

export interface MailConfig {
  user: string
  pass: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  sweepSec: number
  configured: boolean
}

export function readMailConfig(): MailConfig {
  const env = readEnvFile(ENV_FILE)
  const get = (k: string) => env[k] || process.env[k] || MAIL_DEFAULTS[k] || ''
  const user = get('OSKAR_MAIL_USER')
  const pass = get('OSKAR_MAIL_PASS')
  return {
    user,
    pass,
    imapHost: get('OSKAR_MAIL_IMAP_HOST'),
    imapPort: Number(get('OSKAR_MAIL_IMAP_PORT')) || 993,
    smtpHost: get('OSKAR_MAIL_SMTP_HOST'),
    smtpPort: Number(get('OSKAR_MAIL_SMTP_PORT')) || 465,
    sweepSec: Number(get('OSKAR_MAIL_SWEEP_SEC')) || 3600,
    configured: Boolean(user && pass),
  }
}
