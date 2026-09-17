import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate } from '../src/db/migrations'
import { openNodeDb } from '../src/db/node'
import { schema } from '../src/db/types'

const now = '2026-09-17T10:00:00'

describe('db locale', () => {
  it('applica le migrazioni una volta sola (user_version)', () => {
    const calls: string[] = []
    let version = 0
    const runner = { exec: (s: string) => calls.push(s), getVersion: () => version, setVersion: (v: number) => (version = v) }
    expect(migrate(runner)).toBe(MIGRATIONS.length)
    expect(version).toBe(MIGRATIONS.length)
    const n = calls.length
    migrate(runner)
    expect(calls.length).toBe(n) // già a head: nessuna istruzione
  })

  it('schema drizzle e migrazioni SQL coincidono: insert/select su tutte le tabelle', () => {
    const db = openNodeDb()
    db.insert(schema.projects).values({ id: 'p1', name: 'Cantiere', created_at: now, updated_at: now }).run()
    db.insert(schema.plans).values({ id: 'pl1', project_id: 'p1', name: 'PT', file_url: '/files/x.png', width_px: 100, height_px: 50, created_at: now, updated_at: now }).run()
    db.insert(schema.formTemplates).values({ id: 't1', name: 'Isp', schema_def: { fields: [{ id: 'a', type: 'text', label: 'A' }] }, created_at: now, updated_at: now }).run()
    db.insert(schema.pins).values({ id: 'pin1', plan_id: 'pl1', x: 0.5, y: 0.25, created_at: now, updated_at: now, dirty: true }).run()
    db.insert(schema.formSubmissions).values({ id: 's1', template_id: 't1', pin_id: 'pin1', data_json: { a: 'x' }, created_at: now, updated_at: now }).run()
    db.insert(schema.tasks).values({ id: 'tk1', pin_id: 'pin1', title: 'Fix', created_at: now, updated_at: now }).run()
    db.insert(schema.attachments).values({ id: 'at1', submission_id: 's1', file_type: 'photo', local_file_path: 'file:///a.jpg', created_at: now, updated_at: now, dirty: true }).run()
    db.insert(schema.users).values({ id: 'u1', email: 'a@b', name: 'A', role: 'field' }).run()
    db.insert(schema.syncState).values({ project_id: 'p1', last_server_time: now }).run()
    db.insert(schema.syncLog).values({ entity: 'tasks', entity_id: 'tk1', kind: 'rejected', reason: 'x', payload: { a: 1 }, created_at: now }).run()

    const pin = db.select().from(schema.pins).where(eq(schema.pins.id, 'pin1')).get()!
    expect(pin.dirty).toBe(true)
    expect(pin.deleted_at).toBeNull()
    const tpl = db.select().from(schema.formTemplates).get()!
    expect(tpl.schema_def).toEqual({ fields: [{ id: 'a', type: 'text', label: 'A' }] }) // JSON round-trip
    expect(db.select().from(schema.tasks).get()!.status).toBe('open') // default
    expect(db.select().from(schema.attachments).get()!.upload_attempts).toBe(0)
    expect(db.select().from(schema.syncLog).get()!.id).toBe(1) // autoincrement
    // indici usati dalla sync: filtro per dirty
    expect(db.select().from(schema.pins).where(eq(schema.pins.dirty, true)).all()).toHaveLength(1)
    expect(db.select().from(schema.formSubmissions).where(eq(schema.formSubmissions.dirty, true)).all()).toHaveLength(0)
  })
})

describe('catalogo', () => {
  it('refreshProjects fa upsert e rimuove i progetti spariti', async () => {
    const { refreshProjects, listProjects } = await import('../src/data/catalog')
    const db = openNodeDb()
    db.insert(schema.projects).values({ id: 'old', name: 'Vecchio', created_at: now, updated_at: now }).run()
    const api = { get: async () => [{ id: 'p1', name: 'Nuovo', address: 'Via X', created_at: now, updated_at: now }] }
    await refreshProjects(db, api as never)
    expect(listProjects(db).map((p) => p.id)).toEqual(['p1'])
    const api2 = { get: async () => [{ id: 'p1', name: 'Rinominato', address: null, created_at: now, updated_at: '2026-09-18T00:00:00' }] }
    await refreshProjects(db, api2 as never)
    expect(listProjects(db)[0]).toMatchObject({ name: 'Rinominato', address: null })
  })
})
