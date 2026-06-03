// ==========================================
// CRM bulk import — API e2e
// Covers:
//   POST /api/admin/crm/parse  (text, vCard, XLSX file)
//   POST /api/admin/crm/prospects/bulk  (destructive — snapshot/restore xlsx)
// ==========================================

import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { read, utils, write as writeXlsx } from 'xlsx'

const XLSX_PATH = join(process.cwd(), 'docs', 'crm-feature', 'prospects.xlsx')

// ----------------------------------------------------------------------------
// Snapshot/restore the prospects.xlsx so the bulk test never leaks real rows
// ----------------------------------------------------------------------------

let xlsxSnapshot: Buffer | null = null

test.beforeAll(() => {
  if (existsSync(XLSX_PATH)) {
    xlsxSnapshot = readFileSync(XLSX_PATH)
  }
})

test.afterAll(() => {
  if (xlsxSnapshot) {
    writeFileSync(XLSX_PATH, xlsxSnapshot)
  }
})

// ----------------------------------------------------------------------------
// /api/admin/crm/parse — parser endpoint (non-destructive)
// ----------------------------------------------------------------------------

test.describe('POST /api/admin/crm/parse', () => {
  test('parses CSV with headers', async ({ request }) => {
    const text = 'company,contact,phone,email\nAcme,Marco,+41 79 234 56 78,marco@acme.ch'
    const res = await request.post('/api/admin/crm/parse', { data: { text } })
    expect(res.ok()).toBe(true)
    const body = await res.json()

    expect(body.result.mode).toBe('tabular')
    expect(body.result.delimiter).toBe(',')
    expect(body.result.hasHeaders).toBe(true)
    expect(body.result.rows).toEqual([['Acme', 'Marco', '+41 79 234 56 78', 'marco@acme.ch']])
    expect(body.result.columns.map((c: { suggestedField: string }) => c.suggestedField)).toEqual([
      'company', 'contact_name', 'phone', 'email',
    ])
    // existing identities are returned so the client can do mapping-change-instant dup detection
    expect(Array.isArray(body.existing)).toBe(true)
  })

  test('parses headerless CSV with fallback heuristic (col 1 → company, col 2 → contact_name)', async ({ request }) => {
    const text = 'Hotel Splendid,Anna Bianchi,+41 76 222 11 00,anna@splendid.ch'
    const res = await request.post('/api/admin/crm/parse', { data: { text } })
    expect(res.ok()).toBe(true)
    const body = await res.json()

    expect(body.result.hasHeaders).toBe(false)
    expect(body.result.columns[0].suggestedField).toBe('company')
    expect(body.result.columns[1].suggestedField).toBe('contact_name')
    expect(body.result.columns[2].suggestedField).toBe('phone')
    expect(body.result.columns[3].suggestedField).toBe('email')
  })

  test('parses TSV (LinkedIn paste shape)', async ({ request }) => {
    const text = 'Marco Brunetti\tCEO\tCaffè\nAnna Bianchi\tGM\tSplendid'
    const res = await request.post('/api/admin/crm/parse', { data: { text } })
    const body = await res.json()
    expect(body.result.delimiter).toBe('\t')
    expect(body.result.rows.length).toBe(2)
  })

  test('parses vCard block', async ({ request }) => {
    const text = `BEGIN:VCARD
VERSION:3.0
FN:Marco Brunetti
ORG:Caffè Sant'Ambrogio
TEL:+41 79 234 56 78
EMAIL:marco@caffe.ch
END:VCARD`
    const res = await request.post('/api/admin/crm/parse', { data: { text } })
    expect(res.ok()).toBe(true)
    const body = await res.json()

    expect(body.result.mode).toBe('vcard')
    expect(body.result.candidates).toHaveLength(1)
    expect(body.result.candidates[0].contact_name).toBe('Marco Brunetti')
    expect(body.result.candidates[0].company).toBe('Caffè Sant\'Ambrogio')
    // vcardDuplicates is server-pre-computed for vCard mode
    expect(Array.isArray(body.vcardDuplicates)).toBe(true)
  })

  test('parses XLSX file via base64', async ({ request }) => {
    // Build a small 2-column, 2-row workbook in memory
    const aoa = [
      ['company', 'phone'],
      ['Acme XLSX', '+41 79 100 00 01'],
      ['Beta XLSX', '+41 79 100 00 02'],
    ]
    const ws = utils.aoa_to_sheet(aoa)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = writeXlsx(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const res = await request.post('/api/admin/crm/parse', {
      data: { fileBase64: buf.toString('base64'), fileType: 'xlsx' },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()

    expect(body.result.mode).toBe('tabular')
    expect(body.result.hasHeaders).toBe(true)
    expect(body.result.rows.length).toBe(2)
  })

  test('rejects empty input', async ({ request }) => {
    const res = await request.post('/api/admin/crm/parse', { data: { text: '' } })
    expect(res.status()).toBe(400)
  })
})

// ----------------------------------------------------------------------------
// /api/admin/crm/prospects/bulk — destructive (writes to prospects.xlsx)
// Forced serial because playwright.config has fullyParallel: true; if two
// destructive tests interleave between snapshot and restore, data loss.
// ----------------------------------------------------------------------------

test.describe.configure({ mode: 'serial' })
test.describe('POST /api/admin/crm/prospects/bulk', () => {
  // Unique marker — if cleanup ever fails, these rows are easy to grep+nuke manually
  const MARKER = `e2e-bulk-${Date.now()}`

  test('inserts N candidates in a single Excel write, returns IDs', async ({ request }) => {
    const candidates = [
      { company: `${MARKER} Acme`, contact_name: 'Marco', phone: '+41 79 100 00 01', email: 'marco@e2e-acme.test' },
      { company: `${MARKER} Beta`, contact_name: 'Anna', phone: '+41 79 100 00 02', email: 'anna@e2e-beta.test' },
      { company: `${MARKER} Gamma`, contact_name: 'Sara', phone: '+41 79 100 00 03' },
    ]
    const res = await request.post('/api/admin/crm/prospects/bulk', {
      data: { candidates, defaults: { batchTag: MARKER, confidence_pct: 30 } },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()

    expect(body.created).toBe(3)
    expect(body.ids).toHaveLength(3)
    body.ids.forEach((id: string) => expect(id).toMatch(/^P\d{3}$/))
    expect(body.errors).toEqual([])

    // Verify rows landed in the sheet via the existing GET endpoint
    const list = await request.get('/api/admin/crm/prospects')
    const all = (await list.json()).prospects as { id: string; company: string; tags: string; confidence_pct: number }[]
    const inserted = all.filter(p => p.company.includes(MARKER))
    expect(inserted).toHaveLength(3)
    inserted.forEach(p => {
      expect(p.tags).toContain(MARKER)
      expect(p.confidence_pct).toBe(30)
    })
  })

  test('rejects rows without company but reports them in errors', async ({ request }) => {
    const candidates = [
      { company: `${MARKER}-validation Good`, phone: '+41 79 200 00 01' },
      { phone: '+41 79 200 00 02' }, // no company → rejected
      { company: '   ', email: 'whitespace@test.test' }, // whitespace-only company → rejected
    ]
    const res = await request.post('/api/admin/crm/prospects/bulk', {
      data: { candidates, defaults: { batchTag: MARKER } },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()

    expect(body.created).toBe(1)
    expect(body.errors).toHaveLength(2)
    expect(body.errors[0].error).toContain('Missing company')
  })

  test('rejects all-empty payload with 400', async ({ request }) => {
    const res = await request.post('/api/admin/crm/prospects/bulk', { data: { candidates: [] } })
    expect(res.status()).toBe(400)
  })

  test('rejects when every candidate fails validation', async ({ request }) => {
    const res = await request.post('/api/admin/crm/prospects/bulk', {
      data: { candidates: [{ phone: '+41 79 999 00 00' }] },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('All candidates failed')
  })
})
