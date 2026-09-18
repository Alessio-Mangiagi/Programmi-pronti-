/**
 * Tipi dello schema dei moduli dinamici. Specchio di docs/form-schema.md e di
 * app/forms.py: se cambia uno, cambiano tutti e tre.
 */

export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'checkbox',
  'select',
  'multiselect',
  'date',
  'photo',
  'signature',
  'geolocation',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

type Common = {
  /** ^[a-z][a-z0-9_]{0,63}$, univoco nel modulo, chiave in data_json */
  id: string
  label: string
  required?: boolean
  help?: string
}

export type TextField = Common & { type: 'text' | 'textarea'; max_length?: number; default?: string }
export type NumberField = Common & { type: 'number'; min?: number; max?: number; integer?: boolean; default?: number }
export type CheckboxField = Common & { type: 'checkbox'; default?: boolean }
export type SelectField = Common & { type: 'select'; options: string[]; default?: string }
export type MultiselectField = Common & { type: 'multiselect'; options: string[]; default?: string[] }
export type DateField = Common & { type: 'date'; default?: 'today' | string }
export type PhotoField = Common & { type: 'photo'; multiple?: boolean }
export type SignatureField = Common & { type: 'signature' }
export type GeolocationField = Common & { type: 'geolocation' }

export type Field =
  | TextField
  | NumberField
  | CheckboxField
  | SelectField
  | MultiselectField
  | DateField
  | PhotoField
  | SignatureField
  | GeolocationField

export type FormSchema = { fields: Field[] }

export type Geolocation = { lat: number; lng: number; accuracy?: number }

/** Valore ammesso in data_json per ciascun tipo. */
export type FieldValue = string | number | boolean | string[] | Geolocation | null | undefined

/** Risposte di una submission: chiave = id del campo. */
export type FormData = Record<string, FieldValue>

/**
 * Chiave riservata in data_json: note aggiunte in compilazione sotto ogni campo
 * (commento libero e foto), fuori dallo schema del template.
 */
export const NOTES_KEY = '_notes'
export type FieldNote = { comment?: string; photos?: string[] }
export type FieldNotes = Record<string, FieldNote>

export function notesOf(data: FormData): FieldNotes {
  const n = (data as Record<string, unknown>)[NOTES_KEY]
  return n && typeof n === 'object' && !Array.isArray(n) ? (n as FieldNotes) : {}
}

/** Copia di `data` con la nota del campo aggiornata; nota vuota = rimossa, nessuna nota = chiave tolta. */
export function withNote(data: FormData, fieldId: string, note: FieldNote): FormData {
  const notes: FieldNotes = { ...notesOf(data) }
  const clean: FieldNote = {}
  if (note.comment?.trim()) clean.comment = note.comment
  if (note.photos?.length) clean.photos = note.photos
  if (Object.keys(clean).length) notes[fieldId] = clean
  else delete notes[fieldId]
  const next: Record<string, unknown> = { ...data }
  if (Object.keys(notes).length) next[NOTES_KEY] = notes
  else delete next[NOTES_KEY]
  return next as FormData
}

export type FieldError = {
  /** id del campo, `$` per l'intero documento, `fields[i]` se il campo non ha un id valido */
  field: string
  message: string
}
