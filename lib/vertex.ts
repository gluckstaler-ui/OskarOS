// ============================================================================
// lib/vertex.ts — the Vertex AI (Agent Platform) service account, shared by
// images/text (lib/gemini.ts) and video (lib/omni.ts). 2026-10-22.
//
// The key file ops/vertex/oskar-ai.json (git-ignored, mode 600) belongs to the
// service account oskar-ai@<project>.iam.gserviceaccount.com with only the
// role "Agent Platform User". Its project_id is the project that is billed.
// OSKAR_VERTEX_KEY overrides the path. Setup: docs/ops/vertex-setup.md.
// ============================================================================
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { GoogleAuth } from 'google-auth-library'

export const VERTEX_KEY_FILE = process.env.OSKAR_VERTEX_KEY || join(process.cwd(), 'ops', 'vertex', 'oskar-ai.json')

let account: { auth: GoogleAuth; projectId: string } | null | undefined

/** The service account, or null when the key file doesn't exist. Read once. */
export function vertexAccount(): { auth: GoogleAuth; projectId: string } | null {
  if (account !== undefined) return account
  if (!existsSync(VERTEX_KEY_FILE)) {
    account = null
    return null
  }
  account = {
    auth: new GoogleAuth({ keyFile: VERTEX_KEY_FILE, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }),
    projectId: JSON.parse(readFileSync(VERTEX_KEY_FILE, 'utf8')).project_id,
  }
  return account
}

/** Authorization + JSON headers with a fresh token (google-auth-library caches and refreshes it). */
export async function vertexHeaders(): Promise<Record<string, string>> {
  const a = vertexAccount()
  if (!a) throw new Error(`Vertex key not found at ${VERTEX_KEY_FILE} (setup: docs/ops/vertex-setup.md)`)
  return { Authorization: `Bearer ${await a.auth.getAccessToken()}`, 'Content-Type': 'application/json' }
}
