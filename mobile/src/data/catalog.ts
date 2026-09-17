/**
 * Progetti, planimetrie, template e utenti: dati "di catalogo" che il device
 * scarica e legge sempre dal DB locale (così le schermate funzionano offline).
 * Il refresh completo per progetto arriva con il motore di sync (sync/pull.ts);
 * qui c'è il primo caricamento della lista progetti dopo il login.
 */
import { eq } from 'drizzle-orm'
import type { Api } from '../api/client'
import { schema, type AppDb } from '../db/types'

type ProjectRow = typeof schema.projects.$inferInsert

export async function refreshProjects(db: AppDb, api: Api): Promise<void> {
  const remote = await api.get<ProjectRow[]>('/projects')
  db.transaction((tx) => {
    for (const p of remote) {
      tx.insert(schema.projects)
        .values(p)
        .onConflictDoUpdate({ target: schema.projects.id, set: { name: p.name, address: p.address ?? null, updated_at: p.updated_at } })
        .run()
    }
    // progetti da cui l'utente è stato tolto: spariscono dalla lista locale
    const ids = new Set(remote.map((p) => p.id))
    for (const local of tx.select({ id: schema.projects.id }).from(schema.projects).all()) {
      if (!ids.has(local.id)) tx.delete(schema.projects).where(eq(schema.projects.id, local.id)).run()
    }
  })
}

export function listProjects(db: AppDb) {
  return db.select().from(schema.projects).orderBy(schema.projects.name).all()
}

export function listPlans(db: AppDb, projectId: string) {
  return db.select().from(schema.plans).where(eq(schema.plans.project_id, projectId)).orderBy(schema.plans.name).all()
}
