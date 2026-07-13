// @vitest-environment jsdom
// POSTMASTER PM-4 render smoke — the test I should have had before shipping:
// catches setState-in-render / rules-of-hooks loops that tsc can't see.
// Uses react-dom/client directly (no @testing-library/dom peer dep). A render
// loop throws "Too many re-renders" synchronously inside act().
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EmailMessageList } from './EmailMessageList'
import type { CrmActivity, Prospect } from '@/app/crm/crm-data'

const prospects = [
  { id: 'P001', company: 'Bistrot Olmo', email: 'chiara@bistrot-olmo.ch' },
  { id: 'P002', company: 'Kanzlei Brunner', email: 'meier@brunner-cie.ch' },
] as unknown as Prospect[]

const activities = [
  { id: 'A1', prospect_id: 'P001', timestamp: '2026-07-13T09:41:00Z', type: 'E-mail In', subject: 'Re: proposal', notes: 'possiamo firmare?', email_message_id: '<c-1@x>' },
  { id: 'A2', prospect_id: 'P001', timestamp: '2026-07-13T07:52:00Z', type: 'E-mail Out', subject: 'proposal', notes: 'CHF 3600' },
  { id: 'A3', prospect_id: 'P002', timestamp: '2026-07-12T10:00:00Z', type: 'E-mail In', subject: 'AW: Proposal', notes: 'Rücksprache' },
] as unknown as CrmActivity[]

function mockFetch(url: string) {
  if (url.includes('/suggestions')) {
    return Promise.resolve(new Response(JSON.stringify({
      suggestions: [{ prospect_id: 'P001', channel: 'email', body: 'Ciao Chiara — draft', subject: 'Re: proposal', in_reply_to: '<c-1@x>' }],
    }), { headers: { 'Content-Type': 'application/json' } }))
  }
  if (url.includes('/mail/unmatched')) {
    return Promise.resolve(new Response(JSON.stringify({ unmatched: [] }), { headers: { 'Content-Type': 'application/json' } }))
  }
  return Promise.resolve(new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } }))
}

let container: HTMLDivElement
let root: Root

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<EmailMessageList activities={activities} prospects={prospects} onSelectProspect={() => {}} />)
  })
}
function clickText(re: RegExp) {
  const el = Array.from(container.querySelectorAll('button')).find((b) => re.test(b.textContent || ''))
  if (!el) throw new Error('no button matching ' + re)
  return el
}

describe('EmailMessageList render', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn((u: string) => mockFetch(String(u)))) })
  afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.unstubAllGlobals() })

  it('mounts without a render loop', async () => {
    await expect(mount()).resolves.not.toThrow()
    expect(container.textContent).toContain('Bistrot Olmo')
    expect(container.textContent).toContain('Kanzlei Brunner')
  })

  it('expands a group with a pending suggestion without looping, and prefills the draft', async () => {
    await mount()
    await act(async () => { clickText(/Bistrot Olmo/).click() })
    const ta = container.querySelector('textarea') as HTMLTextAreaElement | null
    expect(ta).not.toBeNull()
    expect(ta?.value).toContain('Ciao Chiara')          // Consular prefill via fallback, no setState-in-render
  })
})
