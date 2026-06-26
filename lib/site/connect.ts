// ============================================================================
// lib/site/connect.ts — build + connect a Transport from a session's SiteConfig.
//
// Shared by the connect/list/compare/sync routes so the FTPS→plain fallback and
// the local-root resolution live in ONE place. `localRoot` is always
// public/<id> (where the session's files live); the session config + sync log +
// backups live under public/<id>/logs (spec §3).
// ============================================================================
import { join } from 'node:path'
import os from 'node:os'
import { existsSync } from 'node:fs'
import { readSessionConfig, type SiteConfig } from '../session-config'
import { FtpTransport } from './ftp'
import { LocalTransport } from './local'
import type { Transport } from './transport'

export interface ConnectedSite {
  transport: Transport
  site: SiteConfig
  /** Absolute path to public/<id> — the session's file root. */
  localRoot: string
  /** Negotiated security after connect: 'ftps' | 'plain' | 'file'. */
  secure: 'ftps' | 'plain' | 'file'
}

export function sessionLocalRoot(sessionId: string): string {
  return join(process.cwd(), 'public', sessionId)
}

/** Read the SiteConfig for a session, or null if none is configured. */
export function readSiteConfig(sessionId: string): SiteConfig | null {
  const cfg = readSessionConfig(sessionId)
  return cfg.site ?? null
}

/**
 * File-mode destination — DERIVED, not browsed or stored: `<home>/<domain>`.
 * OskarOS runs as the hosting account (e.g. `aweseybn`), so `os.homedir()` is the
 * account root; the site folder is simply that plus the domain. The hosting panel
 * creates it when the domain is added — we never browse for it or mkdir it.
 *   home=/home/aweseybn, domain=silke-lengler.ch → /home/aweseybn/silke-lengler.ch
 */
export function fileDestination(domain: string): string {
  return join(os.homedir(), domain)
}

/**
 * Resolve the File-mode destination: the derived `<home>/<domain>` when it
 * actually exists; otherwise the folder the user picked (the picker is the
 * fallback for sites that don't live at `<home>/<domain>`); otherwise fall back
 * to the derived path so connect() throws a clear "does not exist" and the user
 * knows to pick one.
 */
export function resolveFileDest(site: SiteConfig): string {
  const derived = fileDestination(site.domain ?? '')
  if (site.domain && existsSync(derived)) return derived
  const picked = site.docroot?.trim()
  if (picked && existsSync(picked)) return picked
  return derived
}

/** Construct (but do NOT connect) the right transport for a SiteConfig. */
export function buildTransport(site: SiteConfig): Transport {
  if (site.method === 'file') {
    if (!site.domain) throw new Error('file mode requires a domain')
    return new LocalTransport(resolveFileDest(site))
  }
  if (!site.host || !site.user) throw new Error('ftp mode requires host + user')
  return new FtpTransport({
    host: site.host,
    port: Number(site.port) || 21,
    user: site.user,
    password: site.password ?? '',
    docroot: site.docroot ?? '',
    pin: site.secure,
  })
}

/** Build + connect in one shot. Caller MUST `transport.close()` when done. */
export async function connectSite(sessionId: string): Promise<ConnectedSite> {
  const site = readSiteConfig(sessionId)
  if (!site) throw new Error('no site config for this session')
  const transport = buildTransport(site)
  await transport.connect()
  return {
    transport,
    site,
    localRoot: sessionLocalRoot(sessionId),
    secure: transport.secure,
  }
}
