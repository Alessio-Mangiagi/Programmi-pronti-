import { useState, type CSSProperties } from 'react'
import {
  notesOf,
  resolveLayout,
  withNote,
  type Field,
  type FieldError,
  type FieldNote,
  type FormData,
  type FormSchema,
  type Geolocation,
  type PhotoField,
} from '@fieldview/form-core'
import type { AttachmentMap, LocalAttachment } from './attachments'
import Icon from '../components/Icon'
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
 * La disposizione (sezioni e colonne) arriva da `schema.layout` tramite
 * resolveLayout; senza layout i campi restano in fila come prima.
 * Non valida da solo: il contenitore chiama validateSubmission e passa `errors`.
 */
export default function DynamicForm({ schema, value, errors = [], attachments, readOnly, onChange, onAttachmentsChange, onError }: Props) {
  const errorOf = (id: string) => errors.find((e) => e.field === id)?.message
  const set = (id: string, v: FormData[string]) => onChange({ ...value, [id]: v })
  const notes = notesOf(value)
  const sections = resolveLayout(schema)

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
      {sections.map((sec) => (
        <section key={sec.id} className="dyn-section">
          {sec.title && <h3 className="dyn-section-title">{sec.title}</h3>}
          <div className="dyn-grid" style={{ '--dyn-cols': sec.columns } as CSSProperties}>
            {sec.items.map(({ field: f, span }) => {
              const err = errorOf(f.id)
              return (
                <div
                  key={f.id}
                  className={`field dyn-field dyn-${f.type}${err ? ' has-error' : ''}`}
                  style={{ '--dyn-span': span } as CSSProperties}
                >
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
                  <FieldNoteBlock
                    field={f}
                    note={notes[f.id]}
                    attachments={attachments}
                    readOnly={readOnly}
                    onChange={(n) => onChange(withNote(value, f.id, n))}
                    onAttachmentsChange={onAttachmentsChange}
                    onError={onError}
                  />
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

type NoteProps = {
  field: Field
  note?: FieldNote
  attachments: AttachmentMap
  readOnly?: boolean
  onChange: (n: FieldNote) => void
  onAttachmentsChange?: (change: AttachmentChange) => void
  onError?: (msg: string) => void
}

/**
 * Nota sotto il campo (commento libero + foto), aggiunta da chi compila e
 * salvata in data_json._notes. Chiusa finché non serve, per non appesantire
 * il modulo; in sola lettura compare solo se c'è qualcosa.
 */
function FieldNoteBlock({ field: f, note, attachments, readOnly, onChange, onAttachmentsChange, onError }: NoteProps) {
  const has = !!(note?.comment || note?.photos?.length)
  const [open, setOpen] = useState(has)
  const photoField: PhotoField = { id: `note_${f.id}`, type: 'photo', label: 'Foto della nota', multiple: true }
  const photos = note?.photos ?? []

  if (readOnly) {
    if (!has) return null
    return (
      <div className="dyn-note dyn-note-view">
        <div className="dyn-note-title">Nota</div>
        {note?.comment && <p className="dyn-note-comment">{note.comment}</p>}
        {photos.length > 0 && <PhotoInput field={photoField} value={photos} attachments={attachments} readOnly onChange={() => {}} />}
      </div>
    )
  }

  if (!open && !has) {
    return (
      <button type="button" className="dyn-note-toggle" onClick={() => setOpen(true)}>
        <Icon name="plus" /> Commento o foto
      </button>
    )
  }

  return (
    <div className="dyn-note">
      <div className="dyn-note-title">
        Nota
        {!has && (
          <button type="button" className="btn small" onClick={() => setOpen(false)} aria-label="Chiudi nota">
            <Icon name="x" />
          </button>
        )}
      </div>
      <textarea
        id={`note-${f.id}`}
        aria-label={`Commento su ${f.label}`}
        rows={2}
        placeholder="Commento…"
        value={note?.comment ?? ''}
        onChange={(e) => onChange({ ...note, comment: e.target.value })}
      />
      <PhotoInput
        field={photoField}
        value={photos}
        attachments={attachments}
        onError={onError}
        onChange={(ids, added, removed) => {
          onChange({ ...note, photos: ids })
          onAttachmentsChange?.({ added, removed })
        }}
      />
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
