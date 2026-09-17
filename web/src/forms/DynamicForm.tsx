import type { Field, FieldError, FormData, FormSchema, Geolocation } from '@fieldview/form-core'
import type { AttachmentMap, LocalAttachment } from './attachments'
import GeolocationInput from './fields/GeolocationInput'
import PhotoInput from './fields/PhotoInput'
import SignatureInput from './fields/SignatureInput'

export type AttachmentChange = { added: LocalAttachment[]; removed: string[] }

type Props = {
  schema: FormSchema
  value: FormData
  errors?: FieldError[]
  attachments: AttachmentMap
  readOnly?: boolean
  onChange: (next: FormData) => void
  /** Foto/firme aggiunte o tolte: il contenitore aggiorna la mappa allegati. */
  onAttachmentsChange?: (change: AttachmentChange) => void
  onError?: (msg: string) => void
}

/**
 * Renderer di un modulo dinamico: un controllo per ogni campo dello schema,
 * errori inline dal validatore di form-core, campi required evidenziati.
 * Non valida da solo: il contenitore chiama validateSubmission e passa `errors`.
 */
export default function DynamicForm({ schema, value, errors = [], attachments, readOnly, onChange, onAttachmentsChange, onError }: Props) {
  const errorOf = (id: string) => errors.find((e) => e.field === id)?.message
  const set = (id: string, v: FormData[string]) => onChange({ ...value, [id]: v })

  return (
    <div className="dyn-form">
      {errors
        .filter((e) => e.field === '$' || !schema.fields.some((f) => f.id === e.field))
        .map((e) => (
          <p key={e.field} className="error">
            {e.field === '$' ? '' : `${e.field}: `}
            {e.message}
          </p>
        ))}
      {schema.fields.map((f) => {
        const err = errorOf(f.id)
        return (
          <div key={f.id} className={`field dyn-field dyn-${f.type}${err ? ' has-error' : ''}`}>
            <label htmlFor={`df-${f.id}`} className="dyn-label">
              {f.label}
              {f.required && (
                <span className="req" aria-hidden="true">
                  {' '}
                  *
                </span>
              )}
            </label>
            <FieldControl
              field={f}
              value={value[f.id]}
              attachments={attachments}
              readOnly={readOnly}
              invalid={!!err}
              onChange={(v) => set(f.id, v)}
              onAttachmentsChange={onAttachmentsChange}
              onError={onError}
            />
            {f.help && !err && <div className="muted small dyn-help">{f.help}</div>}
            {err && (
              <div className="error small dyn-error" role="alert">
                {translateMessage(err)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

type ControlProps = {
  field: Field
  value: FormData[string]
  attachments: AttachmentMap
  readOnly?: boolean
  invalid: boolean
  onChange: (v: FormData[string]) => void
  onAttachmentsChange?: (change: AttachmentChange) => void
  onError?: (msg: string) => void
}

function FieldControl({ field: f, value, attachments, readOnly, invalid, onChange, onAttachmentsChange, onError }: ControlProps) {
  const id = `df-${f.id}`
  const common = { id, disabled: readOnly, 'aria-invalid': invalid || undefined, 'aria-required': f.required || undefined }

  switch (f.type) {
    case 'text':
      return <input {...common} type="text" value={(value as string) ?? ''} maxLength={f.max_length} onChange={(e) => onChange(e.target.value)} />
    case 'textarea':
      return <textarea {...common} rows={3} value={(value as string) ?? ''} maxLength={f.max_length} onChange={(e) => onChange(e.target.value)} />
    case 'number':
      return (
        <input
          {...common}
          type="number"
          inputMode={f.integer ? 'numeric' : 'decimal'}
          step={f.integer ? 1 : 'any'}
          min={f.min}
          max={f.max}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : e.target.value)}
        />
      )
    case 'checkbox':
      return (
        <label className="dyn-check">
          <input {...common} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span className="muted small">{value ? 'Sì' : 'No'}</span>
        </label>
      )
    case 'select':
      return (
        <select {...common} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">— Seleziona —</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="dyn-multi" role="group" aria-labelledby={id}>
          {f.options.map((o) => (
            <label key={o} className={`chip${selected.includes(o) ? ' chip-on chip-primary' : ''}`}>
              <input
                type="checkbox"
                hidden
                disabled={readOnly}
                checked={selected.includes(o)}
                onChange={(e) => onChange(e.target.checked ? [...selected, o] : selected.filter((s) => s !== o))}
              />
              {o}
            </label>
          ))}
        </div>
      )
    }
    case 'date':
      return <input {...common} type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} />
    case 'photo':
      return (
        <PhotoInput
          field={f}
          value={Array.isArray(value) ? (value as string[]) : []}
          attachments={attachments}
          readOnly={readOnly}
          invalid={invalid}
          onError={onError}
          onChange={(ids, added, removed) => {
            onChange(ids)
            onAttachmentsChange?.({ added, removed })
          }}
        />
      )
    case 'signature':
      return (
        <SignatureInput
          value={(value as string) ?? null}
          attachments={attachments}
          readOnly={readOnly}
          invalid={invalid}
          onChange={(sigId, added, removed) => {
            onChange(sigId)
            onAttachmentsChange?.({ added: added ? [added] : [], removed: removed ? [removed] : [] })
          }}
        />
      )
    case 'geolocation':
      return <GeolocationInput value={(value as Geolocation) ?? null} readOnly={readOnly} invalid={invalid} onChange={onChange} />
  }
}

/** Messaggi del validatore (in inglese, identici al server) tradotti per l'utente. */
const MESSAGES: Record<string, string> = {
  required: 'Campo obbligatorio',
  'must be a string': 'Deve essere un testo',
  'must be a number': 'Deve essere un numero',
  'must be an integer': 'Deve essere un numero intero',
  'must be a boolean': 'Valore non valido',
  'not one of options': 'Scegli una delle opzioni',
  'must be a list of strings': 'Scegli tra le opzioni',
  'contains values not in options': 'Contiene opzioni non previste',
  'contains duplicates': 'Contiene duplicati',
  'must be a date YYYY-MM-DD': 'Data non valida',
  'must be a list of attachment ids': 'Foto non valide',
  'only one photo allowed': 'È ammessa una sola foto',
  'must be an attachment id': 'Firma mancante',
  'must be an object with numeric lat and lng': 'Inserisci latitudine e longitudine',
  'lat/lng out of range': 'Coordinate fuori intervallo',
  "'accuracy' must be a number": 'Precisione non valida',
  'only lat, lng, accuracy allowed': 'Posizione non valida',
  'unknown field': 'Campo non previsto dal modulo',
}

export function translateMessage(msg: string): string {
  if (MESSAGES[msg]) return MESSAGES[msg]
  const longer = msg.match(/^longer than (\d+) characters$/)
  if (longer) return `Massimo ${longer[1]} caratteri`
  const ge = msg.match(/^must be >= (.+)$/)
  if (ge) return `Minimo ${ge[1]}`
  const le = msg.match(/^must be <= (.+)$/)
  if (le) return `Massimo ${le[1]}`
  return msg
}
