// Tests for WP-110 — the Consular SQL tool. Seatbelts + read/write routing.
// Hermetic: getDb + crm-store writers are mocked, so no real DB is touched.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const prepareMock = vi.fn()
vi.mock('../crm-boot', () => ({ getDb: () => ({ prepare: prepareMock }) }))

const readSheet = vi.fn(() => [{ id: 'P1', next_action_label: 'old', stage: 'Incoming' }])
const writeSheet = vi.fn(async () => {})
const appendActivity = vi.fn(async () => ({ id: 'A1' }))
const updateActivity = vi.fn(async () => ({ id: 'A1' }))
const removeProspect = vi.fn(async () => ({ prospect: { id: 'P1' } }))
const addContact = vi.fn(async () => ({ id: 'C1' }))
const updateContactField = vi.fn(async () => ({ id: 'C1' }))
vi.mock('../crm-store', () => ({
  readSheet: () => readSheet(),
  writeSheet: (...a: unknown[]) => writeSheet(...a),
  appendActivity: (...a: unknown[]) => appendActivity(...a),
  updateActivity: (...a: unknown[]) => updateActivity(...a),
  removeProspect: (...a: unknown[]) => removeProspect(...a),
  addContact: (...a: unknown[]) => addContact(...a),
  updateContactField: (...a: unknown[]) => updateContactField(...a),
}))

const { consularSql } = await import('./sql-tool')

beforeEach(() => {
  vi.clearAllMocks()
  readSheet.mockReturnValue([{ id: 'P1', next_action_label: 'old', stage: 'Incoming' }])
})

describe('seatbelts (rejected before any DB/write call)', () => {
  it('rejects an empty statement', async () => {
    const r = await consularSql('   ')
    expect(r.kind).toBe('rejected')
  })

  it('rejects multiple statements', async () => {
    const r = await consularSql("SELECT id FROM prospects; DROP TABLE prospects")
    expect(r.kind).toBe('rejected')
    expect(r.statementType).toBe('MULTI')
    expect(writeSheet).not.toHaveBeenCalled()
  })

  it('rejects DDL', async () => {
    for (const sql of ['DROP TABLE prospects', 'ALTER TABLE prospects ADD COLUMN x TEXT', 'CREATE TABLE t (a)', 'PRAGMA table_info(prospects)']) {
      const r = await consularSql(sql)
      expect(r.kind, sql).toBe('rejected')
    }
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('rejects SELECT *', async () => {
    const r = await consularSql('SELECT * FROM prospects')
    expect(r.kind).toBe('rejected')
    expect(prepareMock).not.toHaveBeenCalled()
  })

  it('rejects UPDATE without WHERE', async () => {
    const r = await consularSql("UPDATE prospects SET stage = 'Closing'")
    expect(r.kind).toBe('rejected')
    expect(writeSheet).not.toHaveBeenCalled()
  })

  it('rejects DELETE without WHERE', async () => {
    const r = await consularSql('DELETE FROM prospects')
    expect(r.kind).toBe('rejected')
    expect(removeProspect).not.toHaveBeenCalled()
  })

  it('rejects non-literal values in a write', async () => {
    const r = await consularSql("UPDATE prospects SET next_action_date = date('now') WHERE id = 'P1'")
    expect(r.kind).toBe('rejected')
    expect(writeSheet).not.toHaveBeenCalled()
  })

  it('rejects an unknown/forbidden prospects column', async () => {
    const r = await consularSql("UPDATE prospects SET soft_deleted = 1 WHERE id = 'P1'")
    expect(r.kind).toBe('rejected')
    expect(writeSheet).not.toHaveBeenCalled()
  })

  it('rejects a WHERE that does not target the primary key', async () => {
    const r = await consularSql("UPDATE prospects SET stage = 'Closing' WHERE stage = 'Incoming'")
    expect(r.kind).toBe('rejected')
    expect(writeSheet).not.toHaveBeenCalled()
  })

  it('rejects writes to a non-whitelisted table', async () => {
    const r = await consularSql("UPDATE events SET x = 1 WHERE id = 'e1'")
    expect(r.kind).toBe('rejected')
  })
})

describe('read path', () => {
  it('runs an explicit-column SELECT and returns rows', async () => {
    prepareMock.mockReturnValue({ reader: true, all: () => [{ id: 'P1', company: 'Acme' }] })
    const r = await consularSql('SELECT id, company FROM prospects WHERE id = \'P1\'')
    expect(r.ok).toBe(true)
    expect(r.kind).toBe('read')
    expect(r.rows).toEqual([{ id: 'P1', company: 'Acme' }])
    expect(r.rowCount).toBe(1)
  })

  it('rejects a non-reader statement that slipped past the keyword check', async () => {
    prepareMock.mockReturnValue({ reader: false, all: () => [] })
    const r = await consularSql('WITH x AS (SELECT 1) UPDATE prospects SET stage = 1')
    // multi-ish / non-reader → rejected, never .all()
    expect(r.kind).toBe('rejected')
  })
})

describe('write path → event-logged crm-store writers', () => {
  it('UPDATE prospects routes through writeSheet (never raw exec)', async () => {
    const r = await consularSql("UPDATE prospects SET stage = 'Closing' WHERE id = 'P1'")
    expect(r.ok).toBe(true)
    expect(r.kind).toBe('write')
    expect(r.changes).toBe(1)
    expect(r.affectedIds).toEqual(['P1'])
    expect(writeSheet).toHaveBeenCalledTimes(1)
    // the mutated row carries the new value
    const passedRows = writeSheet.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(passedRows.find((x) => x.id === 'P1')?.stage).toBe('Closing')
  })

  it('UPDATE matching zero rows does not call writeSheet', async () => {
    const r = await consularSql("UPDATE prospects SET stage = 'Closing' WHERE id = 'P999'")
    expect(r.ok).toBe(true)
    expect(r.changes).toBe(0)
    expect(writeSheet).not.toHaveBeenCalled()
  })

  it('INSERT INTO activities routes through appendActivity', async () => {
    const r = await consularSql("INSERT INTO activities (prospect_id, type, notes) VALUES ('P1', 'note', 'lore')")
    expect(r.ok).toBe(true)
    expect(r.kind).toBe('write')
    expect(appendActivity).toHaveBeenCalledTimes(1)
    expect(appendActivity.mock.calls[0][0]).toMatchObject({ prospect_id: 'P1', type: 'note', notes: 'lore' })
  })

  it('UPDATE activities only allows the event-logged fields', async () => {
    const r = await consularSql("UPDATE activities SET notes = 'edited' WHERE id = 'A1'")
    expect(r.ok).toBe(true)
    expect(updateActivity).toHaveBeenCalledWith('A1', { notes: 'edited' })
  })

  it('DELETE prospects routes through removeProspect', async () => {
    const r = await consularSql("DELETE FROM prospects WHERE id = 'P1'")
    expect(r.ok).toBe(true)
    expect(removeProspect).toHaveBeenCalledWith('P1')
  })

  it('does not mistake a "where" inside a string value for the WHERE clause', async () => {
    const r = await consularSql("UPDATE prospects SET notes = 'meet them where they work' WHERE id = 'P1'")
    expect(r.ok).toBe(true)
    expect(r.affectedIds).toEqual(['P1'])
    const passedRows = writeSheet.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(passedRows.find((x) => x.id === 'P1')?.notes).toBe('meet them where they work')
  })

  it('escaped quotes inside a string literal survive', async () => {
    const r = await consularSql("UPDATE prospects SET notes = 'it''s fine' WHERE id = 'P1'")
    expect(r.ok).toBe(true)
    const passedRows = writeSheet.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(passedRows.find((x) => x.id === 'P1')?.notes).toBe("it's fine")
  })
})
