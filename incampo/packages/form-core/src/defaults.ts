import type { Field, FormData, FormSchema } from './types'

/** Data locale del device in formato YYYY-MM-DD (quella che l'utente vede sul calendario). */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Valore iniziale di un campo: il `default` dello schema, altrimenti il "vuoto" del tipo. */
export function fieldDefault(f: Field, now?: Date): FormData[string] {
  switch (f.type) {
    case 'text':
    case 'textarea':
      return f.default ?? ''
    case 'number':
      return f.default ?? null
    case 'checkbox':
      return f.default ?? false
    case 'select':
      return f.default ?? null
    case 'multiselect':
      return f.default ? [...f.default] : []
    case 'date':
      return f.default === 'today' ? todayIso(now) : (f.default ?? null)
    case 'photo':
      return []
    case 'signature':
    case 'geolocation':
      return null
  }
}

/**
 * Stato iniziale di una submission: una chiave per ogni campo dello schema.
 * I campi senza default hanno il valore "vuoto" del tipo, che il validatore
 * ignora se il campo non è required (vedi isEmpty).
 */
export function defaults(schema: FormSchema, now?: Date): FormData {
  return Object.fromEntries(schema.fields.map((f) => [f.id, fieldDefault(f, now)]))
}
