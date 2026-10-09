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

describe('giorno 18: stesso task modificato su web e app offline (merge per campo)', () => {
  it('campi diversi convivono, stesso campo LWW con traccia del perdente, nessun duplicato', async () => {
    const db = device()
    await pullProject(db, api, projectId)
    const task = db.select().from(schema.tasks).where(and(isNull(schema.tasks.deleted_at), eq(schema.tasks.status, 'open'))).get()!
    const countBefore = (await api.get<unknown[]>(`/projects/${projectId}/tasks`)).length

    // app offline: cambia il titolo; poi il web (più tardi) lo assegna
    updateTask(db, task.id, { title: 'Titolo dal telefono' })
    expect(db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get()!.dirty_fields).toEqual(['title'])
    await new Promise((r) => setTimeout(r, 20))
    const members = await api.get<{ id: string; email: string }[]>(`/projects/${projectId}/members`)
    const franco = members.find((m) => m.email === 'field@fieldview.local')!
    await api.patch(`/tasks/${task.id}`, { assigned_to: franco.id })

    const res = await syncAll(db, api, [projectId])
    expect(res.errors).toEqual([])
    // campi diversi: passa il titolo dell'app E resta l'assegnazione del web
    expect(res.push.groups?.tasks.updated).toBe(1)
    const local = db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get()!
    expect(local).toMatchObject({ title: 'Titolo dal telefono', status: 'assigned', assigned_to: franco.id, dirty: false, dirty_fields: null })
    expect(db.select().from(schema.syncLog).all()).toHaveLength(0)
    const remote1 = await api.get<{ title: string; assigned_to: string }>(`/tasks/${task.id}`)
    expect(remote1).toMatchObject({ title: 'Titolo dal telefono', assigned_to: franco.id })

    // nessun duplicato, né in locale né sul server
    expect(db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).all()).toHaveLength(1)
    expect((await api.get<unknown[]>(`/projects/${projectId}/tasks`)).length).toBe(countBefore)

    // l'app modifica DOPO il web un altro campo: la descrizione del web non si perde
    await api.patch(`/tasks/${task.id}`, { description: 'dal web' })
    await new Promise((r) => setTimeout(r, 20))
    updateTask(db, task.id, { title: 'Titolo dal telefono 2' })
    const res2 = await syncAll(db, api, [projectId])
    expect(res2.push.groups?.tasks.updated).toBe(1)
    const remote2 = await api.get<{ title: string; description: string | null }>(`/tasks/${task.id}`)
    expect(remote2).toMatchObject({ title: 'Titolo dal telefono 2', description: 'dal web' })

    // stesso campo: app prima, web dopo -> vince il web, la versione dell'app è tracciata
    updateTask(db, task.id, { title: 'Titolo perso' })
    await new Promise((r) => setTimeout(r, 20))
    await api.patch(`/tasks/${task.id}`, { title: 'Titolo dal web' })
    const res3 = await syncAll(db, api, [projectId])
    expect(res3.errors).toEqual([])
    const local3 = db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get()!
    expect(local3).toMatchObject({ title: 'Titolo dal web', description: 'dal web', dirty: false })
    const lost = db.select().from(schema.syncLog).where(eq(schema.syncLog.kind, 'conflict_lost')).all()
    expect(lost.map((l) => l.entity_id)).toContain(task.id)
    const entry = lost.find((l) => l.entity_id === task.id)!
    expect((entry.payload as { title: string }).title).toBe('Titolo perso')
    expect(entry.reason).toContain('title')
  })

  it('pull con riga dirty: i campi non toccati in locale prendono il remoto, quelli toccati restano', async () => {
    const db = device()
    await pullProject(db, api, projectId)
    const pin = alivePins(db)[2]
    updatePin(db, pin.id, { label: 'Solo etichetta in app' })
    await new Promise((r) => setTimeout(r, 20))
    await api.patch(`/pins/${pin.id}`, { x: 0.33 })
    const pull = await pullProject(db, api, projectId)
    expect(pull.conflicts).toBe(0)
    const local = db.select().from(schema.pins).where(eq(schema.pins.id, pin.id)).get()!
    expect(local).toMatchObject({ label: 'Solo etichetta in app', dirty: true, dirty_fields: ['label'] })
    expect(local.x).toBeCloseTo(0.33)
    await pushDirty(db, api)
    const remote = (await serverPins()).find((p) => p.id === pin.id)!
    expect(remote.label).toBe('Solo etichetta in app')
    expect(remote.x).toBeCloseTo(0.33)
  })

  it('push di un device rimasto offline a lungo arriva agli altri device già sincronizzati dopo', async () => {
    const a = device()
    const b = device()
    await pullProject(a, api, projectId)
    await pullProject(b, api, projectId)
    // pin creato offline "ieri" (orologio del device), pushato solo dopo l'ultimo pull di b
    const pin = createPin(a, planId, 0.61, 0.61, 'Offline da ieri', null)
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().replace('Z', '')
    a.update(schema.pins).set({ created_at: yesterday, updated_at: yesterday }).where(eq(schema.pins.id, pin.id)).run()
    await pushDirty(a, api)
    const res = await pullProject(b, api, projectId)
    expect(res.received.pins).toBeGreaterThanOrEqual(1)
    expect(alivePins(b).some((p) => p.id === pin.id)).toBe(true)
  })
})

describe('giorno 19: planimetrie offline', () => {
  it('syncAll scarica l’immagine della planimetria con il token (bytes reali dal server)', async () => {
    const db = device()
    const files = new Map<string, number>()
    const store = {
      planPath: (id: string, ext: string) => `mem://plans/${id}.${ext}`,
      exists: (p: string) => files.has(p),
      download: async (url: string, path: string, headers: Record<string, string>) => {
        const r = await fetch(url, { headers })
        if (!r.ok) throw new Error(String(r.status))
        files.set(path, (await r.arrayBuffer()).byteLength)
      },
      remove: (p: string) => void files.delete(p),
    }
    const token = await (async () => {
      const r = await fetch(`${server.baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'field@fieldview.local', password: 'demo1234' }) })
      return ((await r.json()) as { access_token: string }).access_token
    })()
    const res = await syncAll(db, api, { projectIds: [projectId], files: { baseUrl: server.baseUrl, getToken: () => token, store } })
    expect(res.errors).toEqual([])
    expect(res.files[projectId]).toEqual({ downloaded: 1, failed: 0, skipped: 0 })
    const plan = db.select().from(schema.plans).get()!
    expect(plan.local_file_path).toBe(`mem://plans/${plan.id}.png`)
    expect(files.get(plan.local_file_path!)).toBeGreaterThan(1000) // il PNG del seed
    // senza token il server rifiuta: resta "solo online", nessuna eccezione
    const db2 = device()
    const res2 = await syncAll(db2, api, { projectIds: [projectId], files: { baseUrl: server.baseUrl, getToken: () => null, store } })
    expect(res2.files[projectId].failed).toBe(1)
  })
})

describe('giorno 21: modulo compilato offline con 3 foto e firma', () => {
  it('salvato in locale subito (dirty), bozza cancellata; il JSON passa al push, i file aspettano la coda upload', async () => {
    const { saveSubmissionLocally, saveDraft, loadDraft } = await import('../src/data/submissions')
    const db = device()
    await pullProject(db, api, projectId)
    const tpl = db.select().from(schema.formTemplates).where(eq(schema.formTemplates.name, 'Ispezione sicurezza')).get()!
    const pin = alivePins(db)[0]
    const photos = { f1: { uri: 'file:///att/f1.jpg', kind: 'photo' as const }, f2: { uri: 'file:///att/f2.jpg', kind: 'photo' as const }, f3: { uri: 'file:///att/f3.jpg', kind: 'photo' as const } }
    const sig = { s1: { uri: 'file:///att/s1.png', kind: 'signature' as const } }
    const data = { area: 'Vano scala', esito: 'Non conforme', rischi: ['Elettrico'], foto: ['f1', 'f2', 'f3'], firma_ispettore: 's1', data_ispezione: '2026-09-17' }
    saveDraft(db, pin.id, tpl.id, data, { ...photos, ...sig })
    expect(loadDraft(db, pin.id, tpl.id)?.attachments_json).toHaveProperty('s1')

    // "modalità aereo": nessuna chiamata di rete qui
    const sub = saveSubmissionLocally(db, { pinId: pin.id, templateId: tpl.id, data, attachments: { ...photos, ...sig }, userId: null })
    expect(loadDraft(db, pin.id, tpl.id)).toBeNull()
    const atts = db.select().from(schema.attachments).where(eq(schema.attachments.submission_id, sub.id)).all()
    expect(atts).toHaveLength(4)
    expect(atts.every((a) => a.dirty && a.file_url === null && a.local_file_path)).toBe(true)
    expect(atts.find((a) => a.id === 's1')?.file_type).toBe('signature')

    // torna la rete: push del JSON (attachment record senza byte), pull mantiene local_file_path
    const res = await syncAll(db, api, [projectId])
    expect(res.push.rejected).toBe(0)
    expect(res.push.groups?.submissions.inserted).toBe(1)
    expect(res.push.groups?.attachments.inserted).toBe(4)
    const remote = await api.get<{ submissions: { id: string; attachments: { id: string; file_url: string | null }[] }[] }>(`/pins/${pin.id}`)
    const rs = remote.submissions.find((s) => s.id === sub.id)!
    expect(rs.attachments.map((a) => a.id).sort()).toEqual(['f1', 'f2', 'f3', 's1'])
    expect(rs.attachments.every((a) => a.file_url === null)).toBe(true) // i byte li manda la coda upload (giorno 22)
    const after = db.select().from(schema.attachments).where(eq(schema.attachments.id, 'f1')).get()!
    expect(after.local_file_path).toBe('file:///att/f1.jpg')
    expect(after.dirty).toBe(false)
  })
})

describe('giorno 22: coda upload foto', () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  const nodeUpload = (files: Record<string, Buffer>) => ({
    buildForm: async (uri: string, name: string, mime: string) => {
      const bytes = files[uri]
      if (!bytes) throw new Error(`file mancante ${uri}`)
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name)
      return form
    },
  })

  it('20 foto in coda, torna la rete: tutte caricate senza intervento; file mancante -> backoff, poi riprova', async () => {
    const { saveSubmissionLocally } = await import('../src/data/submissions')
    const { pendingUploads, processUploadQueue, backoffMs } = await import('../src/sync/uploads')
    const db = device()
    await pullProject(db, api, projectId)
    const tpl = db.select().from(schema.formTemplates).where(eq(schema.formTemplates.name, 'Punch list (difetto)')).get()!
    const pin = alivePins(db)[0]
    const files: Record<string, Buffer> = {}
    const atts: Record<string, { uri: string; kind: 'photo' }> = {}
    const ids: string[] = []
    for (let i = 0; i < 20; i++) {
      const id = `up-${i}-${Date.now()}`
      files[`file:///att/${id}.png`] = PNG
      atts[id] = { uri: `file:///att/${id}.png`, kind: 'photo' }
      ids.push(id)
    }
    const data = { descrizione: 'Crepa', categoria: 'Strutture', gravita: 'Alta', foto: ids }
    saveSubmissionLocally(db, { pinId: pin.id, templateId: tpl.id, data, attachments: atts, userId: null })

    // offline: la coda non parte senza record sul server (dirty)
    expect(pendingUploads(db)).toHaveLength(20)
    expect(await processUploadQueue(db, api, nodeUpload(files))).toEqual({ uploaded: 0, failed: 0, pending: 20 })

    // torna la rete: un solo syncAll fa push + upload di tutto
    delete files[`file:///att/${ids[3]}.png`] // uno sparisce dal disco
    const res = await syncAll(db, api, { projectIds: [projectId], uploads: nodeUpload(files) })
    expect(res.push.rejected).toBe(0)
    expect(res.uploads).toEqual({ uploaded: 19, failed: 1, pending: 1 })
    const broken = db.select().from(schema.attachments).where(eq(schema.attachments.id, ids[3])).get()!
    expect(broken.upload_attempts).toBe(1)
    expect(broken.upload_next_at).toBeTruthy()
    expect(backoffMs(1)).toBe(5000)
    expect(backoffMs(20)).toBe(3_600_000)
    // il server ha i byte
    const remote = await api.get<{ submissions: { attachments: { id: string; file_url: string | null; file_type: string }[] }[] }>(`/pins/${pin.id}`)
    const uploaded = remote.submissions.flatMap((s) => s.attachments).filter((a) => ids.includes(a.id))
    expect(uploaded.filter((a) => a.file_url).length).toBe(19)
    expect(uploaded[0].file_url).toMatch(/^\/files\/attachments\//)
    // non ancora scaduto il backoff: non si riprova; scaduto (now finto): riprova e resta pending se il file manca ancora
    expect((await processUploadQueue(db, api, nodeUpload(files))).failed).toBe(0)
    const later = () => new Date(Date.now() + 10_000).toISOString().replace('Z', '')
    expect((await processUploadQueue(db, api, { ...nodeUpload(files), now: later })).failed).toBe(1)
    files[`file:///att/${ids[3]}.png`] = PNG
    const later2 = () => new Date(Date.now() + 60_000).toISOString().replace('Z', '')
    expect(await processUploadQueue(db, api, { ...nodeUpload(files), now: later2 })).toEqual({ uploaded: 1, failed: 0, pending: 0 })
    // il pull successivo non riporta indietro file_url né tocca local_file_path
    await pullProject(db, api, projectId)
    const done = db.select().from(schema.attachments).where(eq(schema.attachments.id, ids[3])).get()!
    expect(done.file_url).toBeTruthy()
    expect(done.local_file_path).toBeTruthy()
    expect(done.dirty).toBe(false)
  })
})

describe('giorno 23: task mobile', () => {
  it('l’operaio chiude un task con foto senza rete; al ritorno della rete il manager lo vede risolto con la foto', async () => {
    const { listTasks, getTask, allowedTransitions, resolveTaskWithPhoto, setTaskStatus } = await import('../src/data/tasks')
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    const fieldApi = await server.login('field@fieldview.local')
    const me = await fieldApi.get<{ id: string; role: string }>('/auth/me')
    const db = device()
    await pullProject(db, fieldApi, projectId)

    const all = listTasks(db, projectId)
    expect(all.length).toBeGreaterThanOrEqual(3)
    expect(all[0]).toHaveProperty('plan_name', 'Piano terra')
    const mine = listTasks(db, projectId, { mine: me.id })
    expect(mine.length).toBeGreaterThanOrEqual(1)
    expect(mine.every((t) => t.assigned_to === me.id)).toBe(true)

    // un task aperto non assegnato: prendo in carico, poi risolvo con foto (offline)
    const open = all.find((t) => t.status === 'open' && !t.assigned_to) ?? all.find((t) => t.status === 'open')!
    expect(allowedTransitions(getTask(db, open.id)!, me)).toEqual(open.assigned_to ? ['assigned'] : [])
    setTaskStatus(db, open.id, 'assigned', { assignTo: me.id })
    expect(allowedTransitions(getTask(db, open.id)!, me)).toEqual(['resolved', 'open']) // field non può verificare
    resolveTaskWithPhoto(db, open.id, 'file:///att/fix.png')
    const local = getTask(db, open.id)!
    expect(local.status).toBe('resolved')
    expect(local.dirty).toBe(true)
    expect(listTasks(db, projectId, { status: ['resolved'] }).find((t) => t.id === open.id)).toMatchObject({ photos: 1, pending_uploads: 1 })

    // torna la rete
    const res = await syncAll(db, fieldApi, {
      projectIds: [projectId],
      uploads: { buildForm: async (_uri, name, mime) => { const f = new FormData(); f.append('file', new Blob([new Uint8Array(PNG)], { type: mime }), name); return f } },
    })
    expect(res.errors).toEqual([])
    expect(res.push.rejected).toBe(0)
    expect(res.uploads).toMatchObject({ uploaded: 1, pending: 0 })

    // il manager (web) vede il task risolto, assegnato all'operaio, con la foto caricata
    const remote = await api.get<{ status: string; assigned_to: string; attachments: { file_url: string | null; file_type: string }[] }>(`/tasks/${open.id}`)
    expect(remote.status).toBe('resolved')
    expect(remote.assigned_to).toBe(me.id)
    expect(remote.attachments).toHaveLength(1)
    expect(remote.attachments[0].file_url).toMatch(/^\/files\/attachments\//)
    // il manager verifica dal web; l'app lo riceve
    await api.patch(`/tasks/${open.id}`, { status: 'verified' })
    await pullProject(db, fieldApi, projectId)
    expect(getTask(db, open.id)!.status).toBe('verified')
    expect(allowedTransitions(getTask(db, open.id)!, me)).toEqual([])
  })
})

describe('giorno 25: scenari da campo automatizzabili', () => {
  it('app uccisa con coda piena: al riavvio (DB su file) le righe dirty e gli upload ripartono', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const file = join(mkdtempSync(join(tmpdir(), 'fv-')), 'app.db')
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    const { saveSubmissionLocally } = await import('../src/data/submissions')
    const { pendingCounts } = await import('../src/sync/status')

    // sessione 1: compila offline, poi "l'app muore"
    let db = openNodeDb(file)
    db.insert(schema.projects).values({ id: projectId, name: 'P', created_at: nowIso(), updated_at: nowIso() }).run()
    await pullProject(db, api, projectId)
    const tpl = db.select().from(schema.formTemplates).where(eq(schema.formTemplates.name, 'Punch list (difetto)')).get()!
    const pin = alivePins(db)[0]
    saveSubmissionLocally(db, { pinId: pin.id, templateId: tpl.id, data: { descrizione: 'x', categoria: 'Altro', gravita: 'Bassa', foto: ['k1', 'k2'] }, attachments: { k1: { uri: 'file:///k1.png', kind: 'photo' }, k2: { uri: 'file:///k2.png', kind: 'photo' } }, userId: null })
    expect(pendingCounts(db)).toMatchObject({ dirty: 3, uploads: 2 })

    // sessione 2: nuovo processo, stesso file
    db = openNodeDb(file)
    expect(pendingCounts(db)).toMatchObject({ dirty: 3, uploads: 2 })
    const res = await syncAll(db, api, {
      projectIds: [projectId],
      uploads: { buildForm: async (_u, name, mime) => { const f = new FormData(); f.append('file', new Blob([new Uint8Array(PNG)], { type: mime }), name); return f } },
    })
    expect(res.push.rejected).toBe(0)
    expect(res.uploads).toMatchObject({ uploaded: 2, pending: 0 })
    expect(pendingCounts(db)).toMatchObject({ dirty: 0, uploads: 0 })
  })

  it('cambio utente: il wipe svuota tutto, il nuovo utente riparte dal suo pull', async () => {
    const { wipeLocalData } = await import('../src/db/wipe')
    const db = device()
    await pullProject(db, api, projectId)
    expect(alivePins(db).length).toBeGreaterThan(0)
    wipeLocalData(db)
    expect(db.select().from(schema.projects).all()).toHaveLength(0)
    expect(db.select().from(schema.pins).all()).toHaveLength(0)
    expect(db.select().from(schema.syncState).all()).toHaveLength(0)
    // il nuovo utente (field) ripete il primo pull completo
    const fieldApi = await server.login('field@fieldview.local')
    db.insert(schema.projects).values({ id: projectId, name: 'P', created_at: nowIso(), updated_at: nowIso() }).run()
    const res = await pullProject(db, fieldApi, projectId)
    expect(res.received.pins).toBeGreaterThan(0)
  })
})
