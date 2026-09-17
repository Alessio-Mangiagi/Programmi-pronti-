/**
 * Motore di sync contro il backend REALE (scripts/e2e_server.py con il seed demo).
 * Scenari della DoD del giorno 17: modifico dal web -> l'app lo riceve; creo in
 * app -> il web lo vede. Più LWW nei due versi, rifiuti e cancellazioni (giorno 18).
 */
import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Api } from '../src/api/client'
import { createPin, createSubmission, createTask, deletePin, discardRejected, retryRejected, updatePin, updateTask } from '../src/data/mutations'
import { openNodeDb } from '../src/db/node'
import { schema, type AppDb } from '../src/db/types'
import { pullProject, pushDirty, syncAll } from '../src/sync'
import { nowIso } from '../src/sync/time'
import { startServer, type TestServer } from './server'

let server: TestServer
let api: Api // "il web" (manager)
let projectId: string
let planId: string

type Project = { id: string; name: string }
type PinSummary = { id: string; label: string | null; x: number; y: number }

beforeAll(async () => {
  server = await startServer()
  api = await server.login('manager@fieldview.local')
  const projects = await api.get<Project[]>('/projects')
  projectId = projects[0].id
  const plans = await api.get<{ id: string }[]>(`/projects/${projectId}/plans`)
  planId = plans[0].id
}, 90_000)

afterAll(() => server?.stop())

/** Un "device": DB locale vuoto + progetto noto. */
function device(): AppDb {
  const db = openNodeDb()
  db.insert(schema.projects).values({ id: projectId, name: 'Cantiere demo', created_at: nowIso(), updated_at: nowIso() }).run()
  return db
}
const alivePins = (db: AppDb) => db.select().from(schema.pins).where(isNull(schema.pins.deleted_at)).all()
const serverPins = () => api.get<PinSummary[]>(`/plans/${planId}/pins`)

describe('pull', () => {
  it('primo avvio scarica tutto, poi solo le modifiche', async () => {
    const db = device()
    const first = await pullProject(db, api, projectId)
    expect(first.received.plans).toBe(1)
    expect(first.received.form_templates).toBe(3)
    expect(first.received.pins).toBe(3)
    expect(first.received.submissions).toBe(3)
    expect(first.received.tasks).toBe(3)
    expect(db.select().from(schema.syncState).get()?.last_server_time).toBe(first.server_time)
    expect(db.select().from(schema.formTemplates).get()?.schema_def).toHaveProperty('fields')

    const second = await pullProject(db, api, projectId)
    expect(Object.values(second.received).every((n) => n === 0)).toBe(true)
  })

  it('DoD: modifico un pin dal web, l’app lo riceve al pull successivo', async () => {
    const db = device()
    await pullProject(db, api, projectId)
    const pin = alivePins(db)[0]
    await api.patch(`/pins/${pin.id}`, { label: 'Rinominato dal web', x: 0.11 })
    const res = await pullProject(db, api, projectId)
    expect(res.received.pins).toBe(1)
    const local = db.select().from(schema.pins).where(eq(schema.pins.id, pin.id)).get()!
    expect(local.label).toBe('Rinominato dal web')
    expect(local.x).toBeCloseTo(0.11)
    expect(local.dirty).toBe(false)
  })
})

describe('push', () => {
  it('DoD: creo un pin in app, il web lo vede; dirty azzerato', async () => {
    const db = device()
    await pullProject(db, api, projectId)
    const pin = createPin(db, planId, 0.42, 0.24, 'Dal telefono', null)
    const res = await pushDirty(db, api)
    expect(res.sent).toBe(1)
    expect(res.groups?.pins.inserted).toBe(1)
    const remote = (await serverPins()).find((p) => p.id === pin.id)
    expect(remote).toMatchObject({ label: 'Dal telefono', x: 0.42, y: 0.24 })
    expect(db.select().from(schema.pins).where(eq(schema.pins.id, pin.id)).get()!.dirty).toBe(false)
    // al pull arriva created_by valorizzato dal server (dal token)
    await pullProject(db, api, projectId)
    expect(db.select().from(schema.pins).where(eq(schema.pins.id, pin.id)).get()!.created_by).toBeTruthy()
  })

  it('submission + task creati offline sullo stesso pin nuovo passano in un solo batch', async () => {
    const db = device()
    await pullProject(db, api, projectId)
    const tpl = db.select().from(schema.formTemplates).where(eq(schema.formTemplates.name, 'Punch list (difetto)')).get()!
    const pin = createPin(db, planId, 0.5, 0.5, 'Difetto', null)
    const sub = createSubmission(db, tpl.id, pin.id, { descrizione: 'Crepa', categoria: 'Strutture', gravita: 'Alta', foto: ['x'] }, null)
    const task = createTask(db, { pin_id: pin.id, title: 'Sistemare crepa', description: null, assigned_to: null, due_date: null, created_by: null })
    const res = await pushDirty(db, api)
    expect(res.sent).toBe(3)
    expect(res.rejected).toBe(0)
    const detail = await api.get<{ submissions: { id: string }[]; tasks: { id: string }[] }>(`/pins/${pin.id}`)
    expect(detail.submissions.map((s) => s.id)).toEqual([sub.id])
    expect(detail.tasks.map((t) => t.id)).toEqual([task.id])
  })

  it('riga rifiutata: dirty azzerato, motivo in sync_log; riprova o scarta', async () => {
    const db = device()
    await pullProject(db, api, projectId)
    const tpl = db.select().from(schema.formTemplates).where(eq(schema.formTemplates.name, 'Ispezione sicurezza')).get()!
    const pin = alivePins(db)[0]
    const bad = createSubmission(db, tpl.id, pin.id, { esito: 'Boh' }, null)
    const res = await pushDirty(db, api)
    expect(res.rejected).toBe(1)
    const log = db.select().from(schema.syncLog).get()!
    expect(log).toMatchObject({ entity: 'submissions', entity_id: bad.id, kind: 'rejected' })
    expect(log.reason).toContain('esito')
    expect(db.select().from(schema.formSubmissions).where(eq(schema.formSubmissions.id, bad.id)).get()!.dirty).toBe(false)
    expect((await pushDirty(db, api)).sent).toBe(0) // non viene rispedita da sola

    // riprova dopo la correzione
    db.update(schema.formSubmissions).set({ data_json: { area: 'x', esito: 'Conforme', firma_ispettore: 'f', data_ispezione: '2026-09-17' } }).where(eq(schema.formSubmissions.id, bad.id)).run()
    retryRejected(db, log.id)
    expect(db.select().from(schema.syncLog).all()).toHaveLength(0)
    const res2 = await pushDirty(db, api)
    expect(res2.sent).toBe(1)
    expect(res2.rejected).toBe(0)

    // scarta: cancellata solo in locale
    const bad2 = createSubmission(db, tpl.id, pin.id, { esito: 'Boh' }, null)
    await pushDirty(db, api)
    const log2 = db.select().from(schema.syncLog).get()!
    discardRejected(db, log2.id)
    const row = db.select().from(schema.formSubmissions).where(eq(schema.formSubmissions.id, bad2.id)).get()!
    expect(row.deleted_at).toBeTruthy()
    expect(row.dirty).toBe(false)
  })

  it('dirty resta se la riga cambia durante il push', async () => {
    const db = device()
    await pullProject(db, api, projectId)
    const pin = createPin(db, planId, 0.3, 0.3, 'A', null)
    // simula una modifica arrivata mentre la richiesta è in volo
    const slowApi = {
      post: async (path: string, body: unknown) => {
        await new Promise((r) => setTimeout(r, 5)) // un altro millisecondo: updated_at cambia
        updatePin(db, pin.id, { label: 'B' })
        return api.post(path, body)
      },
    }
    await pushDirty(db, slowApi as never)
    expect(db.select().from(schema.pins).where(eq(schema.pins.id, pin.id)).get()!.dirty).toBe(true)
    const res = await pushDirty(db, api)
    expect(res.groups?.pins.updated).toBe(1)
    expect((await serverPins()).find((p) => p.id === pin.id)?.label).toBe('B')
  })
})

describe('conflitti e cancellazioni', () => {
  it('LWW: la modifica remota più recente vince e finisce in sync_log', async () => {
    const db = device()
    await pullProject(db, api, projectId)
    const pin = alivePins(db)[0]
    updatePin(db, pin.id, { label: 'Locale vecchia' })
    await new Promise((r) => setTimeout(r, 20))
    await api.patch(`/pins/${pin.id}`, { label: 'Remota nuova' })
    const res = await pullProject(db, api, projectId)
    expect(res.conflicts).toBe(1)
    const local = db.select().from(schema.pins).where(eq(schema.pins.id, pin.id)).get()!
    expect(local.label).toBe('Remota nuova')
    expect(local.dirty).toBe(false)
    const log = db.select().from(schema.syncLog).where(eq(schema.syncLog.kind, 'conflict_lost')).get()!
    expect(log.payload).toMatchObject({ label: 'Locale vecchia' })
    expect(log.payload).not.toHaveProperty('dirty')
  })

  it('LWW: la modifica locale più recente resta e vince al push', async () => {
    const db = device()
    await pullProject(db, api, projectId)
    const pin = alivePins(db)[1]
    await api.patch(`/pins/${pin.id}`, { label: 'Remota vecchia' })
    await new Promise((r) => setTimeout(r, 20))
    updatePin(db, pin.id, { label: 'Locale nuova' })
    const pull = await pullProject(db, api, projectId)
    expect(pull.conflicts).toBe(0)
    expect(db.select().from(schema.pins).where(eq(schema.pins.id, pin.id)).get()!.label).toBe('Locale nuova')
    const res = await syncAll(db, api, [projectId])
    expect(res.push.groups?.pins.updated).toBe(1)
    expect(res.errors).toEqual([])
    expect((await serverPins()).find((p) => p.id === pin.id)?.label).toBe('Locale nuova')
  })

  it('cancellazione in app arriva al web e agli altri device', async () => {
    const a = device()
    const b = device()
    await pullProject(a, api, projectId)
    await pullProject(b, api, projectId)
    const pin = createPin(a, planId, 0.7, 0.7, 'Da cancellare', null)
    await syncAll(a, api, [projectId])
    await pullProject(b, api, projectId)
    expect(alivePins(b).some((p) => p.id === pin.id)).toBe(true)

    deletePin(a, pin.id)
    await syncAll(a, api, [projectId])
    expect((await serverPins()).some((p) => p.id === pin.id)).toBe(false)
    await pullProject(b, api, projectId)
    expect(alivePins(b).some((p) => p.id === pin.id)).toBe(false)
    expect(b.select().from(schema.pins).where(and(eq(schema.pins.id, pin.id))).get()!.deleted_at).toBeTruthy()
  })

  it('syncAll: mutex, push poi pull, errori raccolti senza eccezioni', async () => {
    const db = device()
    const p1 = syncAll(db, api, [projectId])
    const p2 = syncAll(db, api, [projectId])
    expect(p2).toBe(p1) // seconda chiamata riusa la sync in corso
    const res = await p1
    expect(res.errors).toEqual([])
    expect(res.pulls[projectId].received.pins).toBeGreaterThan(0)

    const offline = { get: async () => { throw new Error('Rete non disponibile') }, post: async () => { throw new Error('Rete non disponibile') } }
    createPin(db, planId, 0.1, 0.1, null, null)
    const failed = await syncAll(db, offline as never, [projectId])
    expect(failed.errors).toHaveLength(2)
    expect(db.select().from(schema.pins).where(eq(schema.pins.dirty, true)).all()).toHaveLength(1) // resta da pushare
  })
})

describe('giorno 18: stesso task modificato su web e app offline', () => {
  it('termina senza duplicati né crash, con LWW e traccia del perdente', async () => {
    const db = device()
    await pullProject(db, api, projectId)
    const task = db.select().from(schema.tasks).where(and(isNull(schema.tasks.deleted_at), eq(schema.tasks.status, 'open'))).get()!
    const countBefore = (await api.get<unknown[]>(`/projects/${projectId}/tasks`)).length

    // app offline: cambia il titolo; poi il web (più tardi) lo assegna
    updateTask(db, task.id, { title: 'Titolo dal telefono' })
    await new Promise((r) => setTimeout(r, 20))
    const members = await api.get<{ id: string; email: string }[]>(`/projects/${projectId}/members`)
    const franco = members.find((m) => m.email === 'field@fieldview.local')!
    await api.patch(`/tasks/${task.id}`, { assigned_to: franco.id })

    const res = await syncAll(db, api, [projectId])
    expect(res.errors).toEqual([])
    // il push locale è più vecchio: il server lo salta (skipped), il pull porta la versione web
    expect(res.push.groups?.tasks.skipped).toBe(1)
    const local = db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get()!
    expect(local.status).toBe('assigned')
    expect(local.assigned_to).toBe(franco.id)
    expect(local.title).toBe(task.title) // la modifica locale è persa...
    expect(local.dirty).toBe(false)
    const lost = db.select().from(schema.syncLog).where(eq(schema.syncLog.kind, 'conflict_lost')).all()
    expect(lost.map((l) => l.entity_id)).toContain(task.id) // ...ma tracciata
    expect((lost.find((l) => l.entity_id === task.id)!.payload as { title: string }).title).toBe('Titolo dal telefono')

    // nessun duplicato, né in locale né sul server
    expect(db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).all()).toHaveLength(1)
    expect((await api.get<unknown[]>(`/projects/${projectId}/tasks`)).length).toBe(countBefore)

    // caso opposto: l'app modifica DOPO il web -> al sync vince l'app
    await api.patch(`/tasks/${task.id}`, { description: 'dal web' })
    await new Promise((r) => setTimeout(r, 20))
    updateTask(db, task.id, { title: 'Titolo dal telefono 2' })
    const res2 = await syncAll(db, api, [projectId])
    expect(res2.push.groups?.tasks.updated).toBe(1)
    const remote = await api.get<{ title: string; description: string | null }>(`/tasks/${task.id}`)
    expect(remote.title).toBe('Titolo dal telefono 2')
    // LWW è a livello di riga: la riga dell'app (più recente) non conosceva la
    // descrizione messa dal web e la sovrascrive. Merge per campo = backlog.
    expect(remote.description).toBeNull()
  })
})
