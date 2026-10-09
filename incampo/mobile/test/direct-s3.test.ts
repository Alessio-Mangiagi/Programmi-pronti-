/**
 * S3 diretto: l'upload delle foto va al bucket con il presigned POST (fields prima
 * del file, niente JWT) e poi complete_url sull'API; il download delle planimetrie
 * usa l'URL firmato di /file-links. API e bucket finti.
 */
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Api } from '../src/api/client'
import { createAttachment } from '../src/data/mutations'
import { openNodeDb } from '../src/db/node'
import { schema } from '../src/db/types'
import { cachePlanImages, type FileStore } from '../src/sync/files'
import { processUploadQueue } from '../src/sync/uploads'

const t0 = '2026-09-17T10:00:00'

describe('upload diretto su S3', () => {
  it('presign con content_type, multipart al bucket con i fields prima del file, poi complete', async () => {
    const db = openNodeDb()
    const att = createAttachment(db, { task_id: 't1' }, 'photo', 'file:///foto.png')
    db.update(schema.attachments).set({ dirty: false }).where(eq(schema.attachments.id, att.id)).run() // già pushato

    const apiCalls: { method: string; path: string; body?: unknown }[] = []
    const api = {
      post: async (path: string, body?: unknown) => {
        apiCalls.push({ method: 'POST', path, body })
        if (path === '/attachments/presign')
          return { attachment_id: att.id, method: 'POST', upload_url: 'https://s3.test/fv', max_bytes: 10, fields: { key: `prod/attachments/${att.id}.png`, policy: 'p' }, complete_url: `/attachments/${att.id}/complete` }
        return { file_url: `/files/attachments/${att.id}.png`, updated_at: '2026-09-17T11:00:00' }
      },
      upload: async () => {
        throw new Error('non deve passare dall’API')
      },
    } as unknown as Api
    const bucket: { url: string; keys: string[]; auth: boolean }[] = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      const form = init.body as FormData
      bucket.push({ url, keys: [...form.keys()], auth: !!(init.headers as Record<string, string> | undefined)?.Authorization })
      return new Response(null, { status: 204 })
    }) as unknown as typeof fetch
    const buildForm = async (_uri: string, name: string, mime: string, fields?: Record<string, string>) => {
      const f = new FormData()
      for (const [k, v] of Object.entries(fields ?? {})) f.append(k, v)
      f.append('file', new Blob([new Uint8Array([1])], { type: mime }), name)
      return f
    }

    const res = await processUploadQueue(db, api, { buildForm, fetch: fakeFetch })
    expect(res).toEqual({ uploaded: 1, failed: 0, pending: 0 })
    expect(apiCalls[0]).toEqual({ method: 'POST', path: '/attachments/presign', body: { attachment_id: att.id, content_type: 'image/png' } })
    expect(bucket).toEqual([{ url: 'https://s3.test/fv', keys: ['key', 'policy', 'file'], auth: false }])
    expect(apiCalls[1].path).toBe(`/attachments/${att.id}/complete`)
    expect(db.select().from(schema.attachments).where(eq(schema.attachments.id, att.id)).get()!.file_url).toBe(`/files/attachments/${att.id}.png`)
  })

  it('bucket in errore (es. firma scaduta): backoff e nuovo tentativo, senza arrendersi', async () => {
    const db = openNodeDb()
    const att = createAttachment(db, { task_id: 't1' }, 'photo', 'file:///foto.jpg')
    db.update(schema.attachments).set({ dirty: false }).where(eq(schema.attachments.id, att.id)).run()
    const api = {
      post: async () => ({ attachment_id: att.id, method: 'POST', upload_url: 'https://s3.test/fv', max_bytes: 10, fields: {}, complete_url: '/x' }),
    } as unknown as Api
    const fakeFetch = (async () => new Response('<Error>AccessDenied</Error>', { status: 403 })) as unknown as typeof fetch
    const res = await processUploadQueue(db, api, { buildForm: async () => new FormData(), fetch: fakeFetch })
    expect(res.failed).toBe(1)
    const row = db.select().from(schema.attachments).where(eq(schema.attachments.id, att.id)).get()!
    expect(row.upload_attempts).toBe(1)
    expect(row.upload_next_at).toBeTruthy()
  })
})

describe('download planimetria con link firmato', () => {
  it('usa l’URL di /file-links senza JWT quando direct, /files con JWT altrimenti', async () => {
    const db = openNodeDb()
    db.insert(schema.plans).values({ id: 'pl1', project_id: 'p1', name: 'PT', file_url: '/files/plans/pl1.png', created_at: t0, updated_at: t0 }).run()
    const calls: { url: string; headers: Record<string, string> }[] = []
    const store: FileStore = {
      planPath: (id, ext) => `mem://plans/${id}.${ext}`,
      exists: () => false,
      download: async (url, _path, headers) => {
        calls.push({ url, headers })
      },
      remove: () => {},
    }
    const linkApi = (direct: boolean) =>
      ({ get: async (path: string) => (direct ? { url: `https://s3.test/signed?${path}`, direct: true } : { url: '/files/plans/pl1.png', direct: false }) }) as unknown as Api

    await cachePlanImages(db, { baseUrl: 'http://api', getToken: () => 'tok', store, api: linkApi(true) }, 'p1')
    expect(calls[0]).toEqual({ url: 'https://s3.test/signed?/file-links/plans/pl1.png', headers: {} })
    db.update(schema.plans).set({ updated_at: '2026-09-18T10:00:00' }).run()
    await cachePlanImages(db, { baseUrl: 'http://api', getToken: () => 'tok', store, api: linkApi(false) }, 'p1')
    expect(calls[1]).toEqual({ url: 'http://api/files/plans/pl1.png', headers: { Authorization: 'Bearer tok' } })
  })
})
