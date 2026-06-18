/**
 * POST /api/sessions/[id]/brain   body: { model: 'fable' | 'opus' | 'gemini' }
 *
 * THE model-switch endpoint — one flip, one request, one writer. The body is
 * a switch POSITION (see lib/models MODEL_SWITCH_PRESETS), not a bare brain:
 * each position is a preset over (cdModel, webDevModel) written atomically to
 * session config.
 *   - cdModel: the big agent's model (CD in Studio, Consular in CRM). The
 *     bridge is group-SIGKILL'd ONLY when this actually changes — the next
 *     turn spawns fresh on the new model and the 1M re-roll verifies the wire.
 *     An opus ↔ gemini flip keeps the Opus brain, so no kill, no respawn.
 *   - webDevModel: the padawan model. No kill needed ever — the MCP build
 *     routes read it from config on every build via resolveWebDevExecution.
 *
 * One source of truth: positions + their wire ids come from lib/models.
 */
import { NextRequest, NextResponse } from 'next/server'
import { readSessionConfig, writeSessionConfig } from '@/lib/session-config'
import { bridgeManager } from '@/lib/bridge-process-manager'
import { brainSpec, isModelSwitch, bareModelId, MODEL_SWITCH_PRESETS } from '@/lib/models'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  let model: unknown
  try { model = (await req.json())?.model } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }) }
  if (typeof model !== 'string' || !isModelSwitch(model)) {
    return NextResponse.json({ error: `model must be one of: ${Object.keys(MODEL_SWITCH_PRESETS).join(', ')}` }, { status: 400 })
  }

  const preset = MODEL_SWITCH_PRESETS[model]
  const cdModel = brainSpec(preset.brain).id            // bare id (no [1m])
  const prevCdModel = bareModelId(readSessionConfig(sessionId).cdModel)
  writeSessionConfig(sessionId, { cdModel, webDevModel: preset.webDevModel })

  const killed = prevCdModel !== cdModel
  if (killed) bridgeManager.kill(sessionId)             // group-SIGKILL → fresh spawn next turn
  console.log(`[brain] ${sessionId} → ${model} (cd=${cdModel}, webdev=${preset.webDevModel}); bridge ${killed ? "SIGKILL'd" : 'kept (brain unchanged)'}`)

  return NextResponse.json({ ok: true, model, cdModel, webDevModel: preset.webDevModel, killed })
}
