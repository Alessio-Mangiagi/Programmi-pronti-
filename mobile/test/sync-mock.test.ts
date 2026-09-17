/**
 * Motore di sync contro un server finto in memoria che implementa le stesse
 * regole del backend (upsert per id, LWW su updated_at, rifiuti). Serve per
 * girare senza Python e per costruire scenari precisi (es. pull incrementale
 * con since, righe cancellate).
 */
import { eq, isNull } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Api } from '../src/api/client'
import { createPin, createTask, deletePin, updatePin } from '../src/data/mutations'
import { openNodeDb } from '../src/db/node'
import { schema } from '../src/db/types'
import { pullProject, pushDirty, syncAll } from '../src/sync'
import { isNewer, nowIso } from '../src/sync/time'

type Row = Record<string, unknown> & { id: string; updated_at: string; deleted_at?: string | null }

/** Server finto: tabelle per gruppo, log delle chiamate. */
function fakeServer(opts: { reject?: (group: string, row: Row) => string | null } = {}) {
  const tables: Record<string, Map<string, Row>> = { pins: new Map(), submissions: new Map(), tasks: new Map(), attachments: new Map() }
  const calls: string[] = []
  const api = {
    get: async (path: string) => {
      calls.push(`GET ${path}`)
      const since = new URL(path, 'http://x').searchParams.get('since')
      const changed = (g: string) => [...tables[g].values()].filter((r) => !since || isNewer(r.updated_at, since))
      return { plans: [], form_templates: [], pins: changed('pins'), submissions: changed('submissions'), tasks: changed('tasks'), attachments: changed('attachments'), server_time: nowIso() }
    },
    post: async (path: string, body: Record<string, Row[]>) => {
      calls.push(`POST ${path}`)
      const out: Record<string, unknown> = { status: 'ok', server_time: nowIso() }
      for (const g of Object.keys(tables)) {
        const res = { inserted: 0, updated: 0, skipped: 0, skipped_ids: [] as string[], rejected: [] as { id: string; reason: string }[] }
        for (const row of body[g] ?? []) {
          const reason = opts.reject?.(g, row)
          if (reason) {
            res.rejected.push({ id: row.id, reason })
            continue
          }
          const existing = tables[g].get(row.id)
          if (!existing) {
            tables[g].set(row.id, { ...row, created_by: 'srv' })
            res.inserted++
          } else if (isNewer(row.updated_at, existing.updated_at)) {
            tables[g].set(row.id, { ...existing, ...row })
            res.updated++
          } else {
            res.skipped++
            res.skipped_ids.push(row.id)
          }
        }
        out[g] = res
      }
      return out
    },
  }
  return { api: api as unknown as Api, tables, calls }
}

function device() {
  const db = openNodeDb()
  db.insert(schema.projects).values({ id: 'p1', name: 'P', created_at: nowIso(), updated_at: nowIso() }).run()
  return db
}

describe('sync con server mock', () => {
  it('push: inserted/updated/skipped e rifiuti con motivo', async () => {
    const srv = fakeServer({ reject: (g, r) => (g === 'tasks' && r.title === 'KO' ? 'pin_id not found' : null) })
    const db = device()
    const pin = createPin(db, 'pl', 0.1, 0.2, 'A', null)
    createTask(db, { pin_id: pin.id, title: 'KO', description: null, assigned_to: null, due_date: null, created_by: null })
    const res = await pushDirty(db, srv.api)
    expect(res).toMatchObject({ sent: 2, rejected: 1, conflicts: 0 })
    expect(srv.tables.pins.get(pin.id)?.label).toBe('A')
    expect(db.select().from(schema.syncLog).all()).toMatchObject([{ entity: 'tasks', kind: 'rejected', reason: 'pin_id not found' }])
    expect(db.select().from(schema.tasks).get()?.dirty).toBe(false)

    await new Promise((r) => setTimeout(r, 2))
    updatePin(db, pin.id, { label: 'B' })
    expect((await pushDirty(db, srv.api)).groups?.pins.updated).toBe(1)
    expect((await pushDirty(db, srv.api)).sent).toBe(0)
  })

  it('pull incrementale: since dal sync_state, righe cancellate applicate', async () => {
    const srv = fakeServer()
    const db = device()
    const t0 = nowIso()
    srv.tables.pins.set('r1', { id: 'r1', plan_id: 'pl', x: 0.5, y: 0.5, label: 'remoto', created_at: t0, updated_at: t0, deleted_at: null })
    const first = await pullProject(db, srv.api, 'p1')
    expect(first.received.pins).toBe(1)
    expect(srv.calls.at(-1)).toMatch(/GET \/sync\/pull\?project_id=p1$/)

    await new Promise((r) => setTimeout(r, 2))
    const second = await pullProject(db, srv.api, 'p1')
    expect(second.received.pins).toBe(0)
    expect(srv.calls.at(-1)).toMatch(/since=/)

    await new Promise((r) => setTimeout(r, 2))
    const t1 = nowIso()
    srv.tables.pins.set('r1', { ...srv.tables.pins.get('r1')!, updated_at: t1, deleted_at: t1 })
    await pullProject(db, srv.api, 'p1')
    expect(db.select().from(schema.pins).where(isNull(schema.pins.deleted_at)).all()).toHaveLength(0)
    expect(db.select().from(schema.pins).where(eq(schema.pins.id, 'r1')).get()?.deleted_at).toBe(t1)
  })

  it('conflitto perso al push (skipped) finisce in sync_log e il pull porta il vincitore', async () => {
    const srv = fakeServer()
    const db = device()
    const t0 = nowIso()
    srv.tables.pins.set('r1', { id: 'r1', plan_id: 'pl', x: 0.5, y: 0.5, label: 'v1', created_at: t0, updated_at: t0, deleted_at: null })
    await pullProject(db, srv.api, 'p1')
    await new Promise((r) => setTimeout(r, 2))
    updatePin(db, 'r1', { label: 'locale' })
    await new Promise((r) => setTimeout(r, 2))
    srv.tables.pins.set('r1', { ...srv.tables.pins.get('r1')!, label: 'web', updated_at: nowIso() })
    const res = await syncAll(db, srv.api, ['p1'])
    expect(res.push.conflicts).toBe(1)
    expect(db.select().from(schema.pins).where(eq(schema.pins.id, 'r1')).get()?.label).toBe('web')
    expect(db.select().from(schema.syncLog).get()).toMatchObject({ kind: 'conflict_lost', entity_id: 'r1' })
    expect(srv.calls).toEqual(['GET /sync/pull?project_id=p1', 'POST /sync/push', expect.stringMatching(/^GET \/sync\/pull\?project_id=p1&since=/)])
  })

  it('cancellazione locale pushata come deleted_at', async () => {
    const srv = fakeServer()
    const db = device()
    const pin = createPin(db, 'pl', 0.1, 0.1, null, null)
    await pushDirty(db, srv.api)
    await new Promise((r) => setTimeout(r, 2))
    deletePin(db, pin.id)
    const res = await pushDirty(db, srv.api)
    expect(res.groups?.pins.updated).toBe(1)
    expect(srv.tables.pins.get(pin.id)?.deleted_at).toBeTruthy()
  })
})
