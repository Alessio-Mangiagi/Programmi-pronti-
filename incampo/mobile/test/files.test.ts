import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { openNodeDb } from '../src/db/node'
import { schema } from '../src/db/types'
import { cachePlanImages, type FileStore } from '../src/sync/files'
import { nowIso } from '../src/sync/time'

function fakeStore(opts: { fail?: Set<string> } = {}) {
  const files = new Map<string, string>() // path -> url scaricato
  const calls: { url: string; headers: Record<string, string> }[] = []
  const store: FileStore = {
    planPath: (id, ext) => `mem://plans/${id}.${ext}`,
    exists: (p) => files.has(p),
    download: async (url, path, headers) => {
      calls.push({ url, headers })
      if (opts.fail?.has(url)) throw new Error('rete')
      files.set(path, url)
    },
    remove: (p) => {
      files.delete(p)
    },
  }
  return { store, files, calls }
}

const t0 = '2026-09-17T10:00:00'

describe('cache immagini planimetrie', () => {
  it('scarica al primo pull, poi salta finché il piano non cambia', async () => {
    const db = openNodeDb()
    db.insert(schema.plans).values({ id: 'pl1', project_id: 'p1', name: 'PT', file_url: '/files/plans/pl1.png', created_at: t0, updated_at: t0 }).run()
    db.insert(schema.plans).values({ id: 'pl2', project_id: 'p1', name: 'P1', file_url: null, created_at: t0, updated_at: t0 }).run()
    const { store, calls, files } = fakeStore()
    const opts = { baseUrl: 'http://api', getToken: () => 'tok', store }

    expect(await cachePlanImages(db, opts, 'p1')).toEqual({ downloaded: 1, failed: 0, skipped: 0 })
    expect(calls[0]).toEqual({ url: 'http://api/files/plans/pl1.png', headers: { Authorization: 'Bearer tok' } })
    const plan = db.select().from(schema.plans).where(eq(schema.plans.id, 'pl1')).get()!
    expect(plan.local_file_path).toBe('mem://plans/pl1.png')
    expect(plan.local_file_for).toBe(t0)

    expect(await cachePlanImages(db, opts, 'p1')).toEqual({ downloaded: 0, failed: 0, skipped: 1 })

    // il file sparisce dal disco (pulizia di sistema): si riscarica
    files.clear()
    expect((await cachePlanImages(db, opts, 'p1')).downloaded).toBe(1)

    // il piano cambia sul server (nuovo upload): updated_at diverso -> riscarica
    db.update(schema.plans).set({ updated_at: '2026-09-18T10:00:00' }).where(eq(schema.plans.id, 'pl1')).run()
    expect((await cachePlanImages(db, opts, 'p1')).downloaded).toBe(1)
    expect(db.select().from(schema.plans).where(eq(schema.plans.id, 'pl1')).get()!.local_file_for).toBe('2026-09-18T10:00:00')
  })

  it('errore di rete: resta solo online e si riprova dopo; file tolto se il piano perde il file', async () => {
    const db = openNodeDb()
    db.insert(schema.plans).values({ id: 'pl1', project_id: 'p1', name: 'PT', file_url: '/files/plans/pl1.jpg', created_at: t0, updated_at: t0 }).run()
    const { store, files } = fakeStore({ fail: new Set(['http://api/files/plans/pl1.jpg']) })
    const opts = { baseUrl: 'http://api', getToken: async () => null, store }
    expect(await cachePlanImages(db, opts, 'p1')).toEqual({ downloaded: 0, failed: 1, skipped: 0 })
    expect(db.select().from(schema.plans).get()!.local_file_path).toBeNull()

    const ok = fakeStore()
    expect((await cachePlanImages(db, { ...opts, store: ok.store }, 'p1')).downloaded).toBe(1)
    expect(ok.calls[0].headers).toEqual({})
    db.update(schema.plans).set({ file_url: null }).where(eq(schema.plans.id, 'pl1')).run()
    await cachePlanImages(db, { ...opts, store: ok.store }, 'p1')
    expect(ok.files.size).toBe(0)
    expect(db.select().from(schema.plans).get()!.local_file_path).toBeNull()
    void files
  })
})
