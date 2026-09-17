/**
 * Validazione di schema e risposte: porting 1:1 di app/forms.py.
 * Stessi messaggi, stesso ordine degli errori: i casi in fixtures/cases.json
 * girano contro entrambe le implementazioni.
 */
import { FIELD_TYPES, type FieldError, type FieldType, type FormSchema } from './types'

export const FIELD_ID_RE = /^[a-z][a-z0-9_]{0,63}$/

const COMMON_PROPS = new Set(['id', 'type', 'label', 'required', 'help'])
const TYPE_PROPS: Record<FieldType, Set<string>> = {
  text: new Set(['max_length', 'default']),
  textarea: new Set(['max_length', 'default']),
  number: new Set(['min', 'max', 'integer', 'default']),
  checkbox: new Set(['default']),
  select: new Set(['options', 'default']),
  multiselect: new Set(['options', 'default']),
  date: new Set(['default']),
  photo: new Set(['multiple']),
  signature: new Set(),
  geolocation: new Set(),
}

type Dict = Record<string, unknown>
const err = (field: string, message: string): FieldError => ({ field, message })
const isObject = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** `YYYY-MM-DD` con data di calendario valida. */
export function isIsoDate(v: unknown): v is string {
  if (!isString(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Vuoto = null/undefined, stringa vuota, lista vuota (chiave assente inclusa). */
export const isEmpty = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)

/** repr() di Python per i messaggi "unknown type" (stringhe tra apici, None). */
function repr(v: unknown): string {
  if (v === undefined || v === null) return 'None'
  if (isString(v)) return `'${v}'`
  if (isBool(v)) return v ? 'True' : 'False'
  return JSON.stringify(v)
}

// ---------- Schema ----------

export function validateSchema(schema: unknown): FieldError[] {
  const errors: FieldError[] = []
  if (!isObject(schema)) return [err('$', 'schema must be an object')]

  const fields = schema.fields
  if (!Array.isArray(fields) || fields.length === 0) return [err('$', "'fields' must be a non-empty list")]

  const seen = new Set<string>()
  fields.forEach((f, i) => {
    let where = `fields[${i}]`
    if (!isObject(f)) {
      errors.push(err(where, 'field must be an object'))
      return
    }

    const fid = f.id
    if (!isString(fid) || !FIELD_ID_RE.test(fid)) {
      errors.push(err(where, "'id' must match ^[a-z][a-z0-9_]{0,63}$"))
    } else if (seen.has(fid)) {
      errors.push(err(fid, 'duplicate field id'))
    } else {
      seen.add(fid)
    }
    if (isString(fid)) where = fid

    const ftype = f.type
    if (!isString(ftype) || !(FIELD_TYPES as readonly string[]).includes(ftype)) {
      errors.push(err(where, `unknown type ${repr(ftype)}`))
      return
    }
    const t = ftype as FieldType

    if (!isString(f.label) || !f.label.trim()) errors.push(err(where, "'label' is required"))
    if ('required' in f && !isBool(f.required)) errors.push(err(where, "'required' must be a boolean"))
    if ('help' in f && !isString(f.help)) errors.push(err(where, "'help' must be a string"))

    const extra = Object.keys(f)
      .filter((k) => !COMMON_PROPS.has(k) && !TYPE_PROPS[t].has(k))
      .sort()
    if (extra.length) {
      errors.push(err(where, `properties not allowed for type ${t}: [${extra.map((k) => `'${k}'`).join(', ')}]`))
    }

    errors.push(...validateTypeProps(where, t, f))
  })

  return errors
}

function validateTypeProps(where: string, t: FieldType, f: Dict): FieldError[] {
  const errors: FieldError[] = []

  if (t === 'select' || t === 'multiselect') {
    const opts = f.options
    if (!Array.isArray(opts) || opts.length === 0 || !opts.every((o) => isString(o) && o.trim())) {
      errors.push(err(where, "'options' must be a non-empty list of strings"))
    } else if (new Set(opts).size !== opts.length) {
      errors.push(err(where, "'options' contains duplicates"))
    } else if ('default' in f) {
      const d = f.default
      if (t === 'select' && !opts.includes(d)) errors.push(err(where, "'default' must be one of options"))
      if (t === 'multiselect' && (!Array.isArray(d) || !d.every((x) => opts.includes(x)))) {
        errors.push(err(where, "'default' must be a subset of options"))
      }
    }
  }

  if (t === 'text' || t === 'textarea') {
    if ('max_length' in f && (!Number.isInteger(f.max_length) || (f.max_length as number) < 1)) {
      errors.push(err(where, "'max_length' must be a positive integer"))
    }
    if ('default' in f && !isString(f.default)) errors.push(err(where, "'default' must be a string"))
  }

  if (t === 'number') {
    for (const k of ['min', 'max'] as const) {
      if (k in f && !isNumber(f[k])) errors.push(err(where, `'${k}' must be a number`))
    }
    if (isNumber(f.min) && isNumber(f.max) && f.min > f.max) errors.push(err(where, "'min' must be <= 'max'"))
    if ('integer' in f && !isBool(f.integer)) errors.push(err(where, "'integer' must be a boolean"))
    if ('default' in f && !isNumber(f.default)) errors.push(err(where, "'default' must be a number"))
  }

  if (t === 'checkbox' && 'default' in f && !isBool(f.default)) errors.push(err(where, "'default' must be a boolean"))

  if (t === 'date' && 'default' in f && f.default !== 'today' && !isIsoDate(f.default)) {
    errors.push(err(where, "'default' must be 'today' or YYYY-MM-DD"))
  }

  if (t === 'photo' && 'multiple' in f && !isBool(f.multiple)) errors.push(err(where, "'multiple' must be a boolean"))

  return errors
}

// ---------- Submission ----------

/**
 * Assume `schema` già valido. Chiavi sconosciute = errore, così un client con
 * un template vecchio non salva dati silenziosamente persi.
 */
export function validateSubmission(schema: FormSchema, data: unknown): FieldError[] {
  if (!isObject(data)) return [err('$', 'data must be an object')]

  const errors: FieldError[] = []
  const fields = new Map(schema.fields.map((f) => [f.id, f]))

  for (const key of Object.keys(data)) {
    if (!fields.has(key)) errors.push(err(key, 'unknown field'))
  }

  for (const [fid, f] of fields) {
    const value = data[fid]
    if (isEmpty(value)) {
      if (f.required) errors.push(err(fid, 'required'))
      continue
    }
    const msg = checkValue(f as unknown as Dict, value)
    if (msg) errors.push(err(fid, msg))
  }

  return errors
}

/** Messaggio di errore per un valore non vuoto, oppure null se valido. */
export function checkValue(f: Dict, v: unknown): string | null {
  const t = f.type as FieldType

  if (t === 'text' || t === 'textarea') {
    if (!isString(v)) return 'must be a string'
    if ('max_length' in f && v.length > (f.max_length as number)) return `longer than ${f.max_length} characters`
  } else if (t === 'number') {
    if (!isNumber(v)) return 'must be a number'
    if (f.integer && !Number.isInteger(v)) return 'must be an integer'
    if ('min' in f && v < (f.min as number)) return `must be >= ${f.min}`
    if ('max' in f && v > (f.max as number)) return `must be <= ${f.max}`
  } else if (t === 'checkbox') {
    if (!isBool(v)) return 'must be a boolean'
  } else if (t === 'select') {
    if (!(f.options as string[]).includes(v as string)) return 'not one of options'
  } else if (t === 'multiselect') {
    if (!Array.isArray(v) || !v.every(isString)) return 'must be a list of strings'
    const opts = new Set(f.options as string[])
    if (!v.every((x) => opts.has(x))) return 'contains values not in options'
    if (new Set(v).size !== v.length) return 'contains duplicates'
  } else if (t === 'date') {
    if (!isIsoDate(v)) return 'must be a date YYYY-MM-DD'
  } else if (t === 'photo') {
    // Lista di attachment id (UUID generati dal client); l'esistenza è verificata dal sync.
    if (!Array.isArray(v) || !v.every((x) => isString(x) && x)) return 'must be a list of attachment ids'
    if (!f.multiple && v.length > 1) return 'only one photo allowed'
  } else if (t === 'signature') {
    if (!isString(v) || !v) return 'must be an attachment id'
  } else if (t === 'geolocation') {
    if (!isObject(v) || !isNumber(v.lat) || !isNumber(v.lng)) return 'must be an object with numeric lat and lng'
    if (!(v.lat >= -90 && v.lat <= 90 && v.lng >= -180 && v.lng <= 180)) return 'lat/lng out of range'
    if ('accuracy' in v && !isNumber(v.accuracy)) return "'accuracy' must be a number"
    if (Object.keys(v).some((k) => !['lat', 'lng', 'accuracy'].includes(k))) return 'only lat, lng, accuracy allowed'
  }

  return null
}
