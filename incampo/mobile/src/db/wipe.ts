import { schema, type AppDb } from './types'

/** Svuota tutti i dati locali (cambio utente): le tabelle restano, i file in cache no (best effort altrove). */
export function wipeLocalData(db: AppDb) {
  db.transaction((tx) => {
    for (const t of [schema.attachments, schema.tasks, schema.formSubmissions, schema.pins, schema.drafts, schema.formTemplates, schema.plans, schema.projects, schema.users, schema.syncState, schema.syncLog]) {
      tx.delete(t).run()
    }
  })
}
