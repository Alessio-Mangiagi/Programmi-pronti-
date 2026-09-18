import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { FIELD_TYPES, defaults, validateSchema, type Field, type FieldError, type FieldType, type FormData, type FormSchema } from '@fieldview/form-core'
import { api, errorMessage } from '../api/client'
import type { FormTemplate } from '../api/types'
import { isManager, useAuth } from '../auth/AuthContext'
import Loading from '../components/Loading'
import { useToast } from '../components/Toast'
import DynamicForm from '../forms/DynamicForm'
import { CATEGORY_LABEL } from './TemplatesPage'
import Icon from '../components/Icon'

const TYPE_LABEL: Record<FieldType, string> = {
  text: 'Testo breve',
  textarea: 'Testo lungo',
  number: 'Numero',
  checkbox: 'Sì/No',
  select: 'Scelta singola',
  multiselect: 'Scelta multipla',
  date: 'Data',
  photo: 'Foto',
  signature: 'Firma',
  geolocation: 'Posizione GPS',
}

/** id campo dall'etichetta: snake_case ASCII, come richiesto dallo schema. */
export function slugId(label: string, taken: Set<string>): string {
  let base = label
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // toglie gli accenti scomposti da NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
  if (!base) base = 'campo'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  return id
}

function newField(type: FieldType, taken: Set<string>): Field {
  const label = TYPE_LABEL[type]
  const base = { id: slugId(label, taken), label, required: false }
  switch (type) {
    case 'select':
    case 'multiselect':
      return { ...base, type, options: ['Opzione 1', 'Opzione 2'] }
    default:
      return { ...base, type } as Field
  }
}

/**
 * Form builder v1: lista campi (aggiungi/rimuovi/sposta), proprietà per tipo,
 * anteprima live con DynamicForm, validazione con validateSchema prima del salvataggio.
 * Lo schema di un template già usato da submission è bloccato dal server (409):
 * qui si mostra in sola lettura con "Duplica e modifica".
 */
export default function TemplateEditorPage() {
  const { templateId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const isNew = !templateId || templateId === 'new'
  const [loaded, setLoaded] = useState<FormTemplate | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (isNew) return
    api.GET('/form-templates/{template_id}', { params: { path: { template_id: templateId! } } }).then(({ data }) => {
      if (data) setLoaded(data)
      else setNotFound(true)
    })
  }, [isNew, templateId])

  if (!isManager(user)) return <Navigate to="/projects" replace />
  if (notFound) return <div className="content empty">Template non trovato.</div>
  if (!isNew && !loaded) return <Loading className="content" />
  return <Editor key={loaded?.id ?? 'new'} template={loaded} onSaved={(t) => navigate(`/templates/${t.id}`, { replace: true })} />
}

function Editor({ template, onSaved }: { template: FormTemplate | null; onSaved: (t: FormTemplate) => void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [name, setName] = useState(template?.name ?? '')
  const [category, setCategory] = useState(template?.category ?? '')
  const [fields, setFields] = useState<Field[]>(() => (template ? (template.schema_def as FormSchema).fields : []))
  const [selected, setSelected] = useState<number>(fields.length ? 0 : -1)
  const [newType, setNewType] = useState<FieldType>('text')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [preview, setPreview] = useState<FormData>({})
  const locked = !!template && template.submissions_count > 0

  const schema: FormSchema = useMemo(() => ({ fields }), [fields])
  const errors = useMemo<FieldError[]>(() => validateSchema(schema), [schema])
  const schemaValid = errors.length === 0
  const errorsOf = (f: Field, i: number) => errors.filter((e) => e.field === f.id || e.field === `fields[${i}]`)

  // L'anteprima riparte dai default quando cambia lo schema (solo se valido, altrimenti resta l'ultima buona).
  useEffect(() => {
    if (schemaValid) setPreview(defaults(schema))
  }, [schema, schemaValid])

  const taken = () => new Set(fields.map((f) => f.id))
  const update = (i: number, patch: Partial<Field>) => setFields((fs) => fs.map((f, j) => (j === i ? ({ ...f, ...patch } as Field) : f)))
  const move = (i: number, d: -1 | 1) => {
    setFields((fs) => {
      const j = i + d
      if (j < 0 || j >= fs.length) return fs
      const next = [...fs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setSelected(i + d)
  }
  const remove = (i: number) => {
    setFields((fs) => fs.filter((_, j) => j !== i))
    setSelected((s) => (s === i ? Math.min(i, fields.length - 2) : s > i ? s - 1 : s))
  }
  const add = () => {
    setFields((fs) => [...fs, newField(newType, taken())])
    setSelected(fields.length)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!name.trim()) return toast.error('Dai un nome al template')
    if (!locked && !schemaValid) return toast.error('Correggi i campi segnalati prima di salvare')
    setSaving(true)
    const body = { name: name.trim(), category: category || null }
    const { data, error } = template
      ? await api.PATCH('/form-templates/{template_id}', {
          params: { path: { template_id: template.id } },
          body: locked ? body : { ...body, schema_def: schema },
        })
      : await api.POST('/form-templates', { body: { ...body, schema_def: schema } })
    setSaving(false)
    if (error || !data) return toast.error(errorMessage(error))
    toast.success(template ? 'Template salvato' : 'Template creato')
    onSaved(data)
  }

  async function duplicateAndEdit() {
    const { data, error } = await api.POST('/form-templates', {
      body: { name: `${name} (copia)`, category: category || null, schema_def: schema },
    })
    if (error || !data) return toast.error(errorMessage(error))
    toast.success('Copia creata: ora puoi modificarla')
    navigate(`/templates/${data.id}`)
  }

  const sel = selected >= 0 ? fields[selected] : undefined

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/templates">Moduli</Link> · <Link to="/templates/elenco">Elenco moduli</Link>
          </div>
          <h1>{template ? template.name : 'Nuovo template'}</h1>
        </div>
        <div className="topbar-actions">
          {locked && (
            <button type="button" className="btn" onClick={duplicateAndEdit}>
              Duplica e modifica
            </button>
          )}
          <button type="submit" form="template-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </header>
      <form id="template-form" className="content builder" onSubmit={save} noValidate>
        {locked && (
          <div className="callout callout-warn builder-wide">
            Questo template ha {template!.submissions_count} compilazioni: i campi non si possono più cambiare (le risposte esistenti resterebbero
            incoerenti). Puoi rinominarlo o duplicarlo e modificare la copia.
          </div>
        )}
        <section className="card builder-col">
          <h2>Template</h2>
          <div className="field">
            <label htmlFor="tp-name">Nome</label>
            <input id="tp-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus={!template} placeholder="es. Diario giornaliero" />
            {touched && !name.trim() && <div className="error small">Obbligatorio</div>}
          </div>
          <div className="field">
            <label htmlFor="tp-cat">Categoria</label>
            <select id="tp-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">—</option>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <h2>Campi ({fields.length})</h2>
          {fields.length === 0 && <p className="muted small">Nessun campo: aggiungine uno qui sotto.</p>}
          <ol className="field-list">
            {fields.map((f, i) => {
              const errs = errorsOf(f, i)
              return (
                <li key={i} className={`field-row${i === selected ? ' is-selected' : ''}${errs.length ? ' has-error' : ''}`}>
                  <button type="button" className="field-row-main" onClick={() => setSelected(i)}>
                    <span className="field-row-label">
                      {f.label || <em className="muted">senza etichetta</em>}
                      {f.required && <span className="req"> *</span>}
                    </span>
                    <span className="muted small">
                      {TYPE_LABEL[f.type]} · <code>{f.id}</code>
                    </span>
                  </button>
                  {!locked && (
                    <span className="field-row-actions">
                      <button type="button" className="btn small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Sposta su">
                        <Icon name="arrow-up" />
                      </button>
                      <button type="button" className="btn small" onClick={() => move(i, 1)} disabled={i === fields.length - 1} aria-label="Sposta giù">
                        <Icon name="arrow-down" />
                      </button>
                      <button type="button" className="btn small btn-danger" onClick={() => remove(i)} aria-label="Rimuovi campo">
                        <Icon name="x" />
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
          {!locked && (
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <select value={newType} onChange={(e) => setNewType(e.target.value as FieldType)} aria-label="Tipo del nuovo campo" style={{ width: 'auto' }}>
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={add}>
                + Aggiungi campo
              </button>
            </div>
          )}
        </section>

        <section className="card builder-col">
          <h2>Proprietà</h2>
          {sel ? (
            <FieldProps
              key={selected}
              field={sel}
              errors={errorsOf(sel, selected)}
              locked={locked}
              onChange={(patch) => update(selected, patch)}
              onRelabel={(label) => {
                const others = new Set(fields.filter((_, j) => j !== selected).map((f) => f.id))
                // l'id segue l'etichetta finché il template è nuovo (non è mai stato salvato)
                update(selected, template ? { label } : { label, id: slugId(label, others) })
              }}
            />
          ) : (
            <p className="muted small">Seleziona un campo per modificarne le proprietà.</p>
          )}
        </section>

        <section className="card builder-col builder-preview">
          <h2>Anteprima</h2>
          {fields.length === 0 ? (
            <p className="muted small">L'anteprima compare quando aggiungi dei campi.</p>
          ) : schemaValid ? (
            <DynamicForm schema={schema} value={preview} attachments={{}} onChange={setPreview} />
          ) : (
            <div className="callout callout-warn">
              Schema non valido: {errors.length} {errors.length === 1 ? 'errore' : 'errori'} nei campi segnalati.
            </div>
          )}
        </section>
      </form>
    </>
  )
}

type FieldPropsProps = {
  field: Field
  errors: FieldError[]
  locked: boolean
  onChange: (patch: Partial<Field>) => void
  onRelabel: (label: string) => void
}

/** Proprietà comuni + quelle specifiche del tipo (vedi docs/form-schema.md). */
function FieldProps({ field: f, errors, locked, onChange, onRelabel }: FieldPropsProps) {
  const dis = locked
  const num = (v: string) => (v === '' ? undefined : Number(v))
  const withoutUndefined = (patch: Record<string, unknown>) => {
    // le proprietà opzionali vanno tolte, non messe a undefined (lo schema le rifiuterebbe)
    const next: Record<string, unknown> = { ...f }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') delete next[k]
      else next[k] = v
    }
    return next as unknown as Partial<Field>
  }
  const set = (patch: Record<string, unknown>) => onChange(withoutUndefined(patch))

  return (
    <div className="field-props">
      {errors.map((e, i) => (
        <p key={i} className="error small">
          {e.message}
        </p>
      ))}
      <div className="field">
        <label htmlFor="fp-label">Etichetta</label>
        <input id="fp-label" value={f.label} onChange={(e) => onRelabel(e.target.value)} disabled={dis} />
      </div>
      <div className="field">
        <label htmlFor="fp-id">
          Id (chiave nei dati) <span className="muted">— a-z, 0-9, _</span>
        </label>
        <input id="fp-id" value={f.id} onChange={(e) => onChange({ id: e.target.value })} disabled={dis} pattern="^[a-z][a-z0-9_]{0,63}$" />
      </div>
      <div className="field">
        <label>Tipo</label>
        <div>{TYPE_LABEL[f.type]}</div>
      </div>
      <label className="dyn-check">
        <input type="checkbox" checked={!!f.required} onChange={(e) => onChange({ required: e.target.checked })} disabled={dis} />
        <span>Obbligatorio</span>
      </label>
      <div className="field">
        <label htmlFor="fp-help">Testo di aiuto</label>
        <input id="fp-help" value={f.help ?? ''} onChange={(e) => set({ help: e.target.value })} disabled={dis} />
      </div>

      {(f.type === 'text' || f.type === 'textarea') && (
        <div className="form-grid">
          <div className="field">
            <label htmlFor="fp-max">Lunghezza massima</label>
            <input id="fp-max" type="number" min={1} value={f.max_length ?? ''} onChange={(e) => set({ max_length: num(e.target.value) })} disabled={dis} />
          </div>
          <div className="field">
            <label htmlFor="fp-def">Valore iniziale</label>
            <input id="fp-def" value={f.default ?? ''} onChange={(e) => set({ default: e.target.value })} disabled={dis} />
          </div>
        </div>
      )}
      {f.type === 'number' && (
        <>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="fp-min">Minimo</label>
              <input id="fp-min" type="number" step="any" value={f.min ?? ''} onChange={(e) => set({ min: num(e.target.value) })} disabled={dis} />
            </div>
            <div className="field">
              <label htmlFor="fp-maxn">Massimo</label>
              <input id="fp-maxn" type="number" step="any" value={f.max ?? ''} onChange={(e) => set({ max: num(e.target.value) })} disabled={dis} />
            </div>
            <div className="field">
              <label htmlFor="fp-defn">Valore iniziale</label>
              <input id="fp-defn" type="number" step="any" value={f.default ?? ''} onChange={(e) => set({ default: num(e.target.value) })} disabled={dis} />
            </div>
          </div>
          <label className="dyn-check">
            <input type="checkbox" checked={!!f.integer} onChange={(e) => set({ integer: e.target.checked || undefined })} disabled={dis} />
            <span>Solo numeri interi</span>
          </label>
        </>
      )}
      {f.type === 'checkbox' && (
        <label className="dyn-check">
          <input type="checkbox" checked={!!f.default} onChange={(e) => set({ default: e.target.checked || undefined })} disabled={dis} />
          <span>Spuntato di default</span>
        </label>
      )}
      {(f.type === 'select' || f.type === 'multiselect') && (
        <>
          <div className="field">
            <label htmlFor="fp-opts">Opzioni (una per riga)</label>
            <textarea
              id="fp-opts"
              rows={5}
              value={f.options.join('\n')}
              onChange={(e) => onChange({ options: e.target.value.split('\n') } as Partial<Field>)}
              onBlur={(e) => onChange({ options: e.target.value.split('\n').map((o) => o.trim()).filter(Boolean) } as Partial<Field>)}
              disabled={dis}
            />
            <div className="muted small">Un'opzione come "Non conforme" propone automaticamente un task.</div>
          </div>
          {f.type === 'select' && (
            <div className="field">
              <label htmlFor="fp-defs">Valore iniziale</label>
              <select id="fp-defs" value={f.default ?? ''} onChange={(e) => set({ default: e.target.value })} disabled={dis}>
                <option value="">—</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
      {f.type === 'date' && (
        <div className="field">
          <label htmlFor="fp-defd">Valore iniziale</label>
          <select id="fp-defd" value={f.default ?? ''} onChange={(e) => set({ default: e.target.value })} disabled={dis}>
            <option value="">— vuoto —</option>
            <option value="today">Oggi</option>
          </select>
        </div>
      )}
      {f.type === 'photo' && (
        <label className="dyn-check">
          <input type="checkbox" checked={!!f.multiple} onChange={(e) => set({ multiple: e.target.checked || undefined })} disabled={dis} />
          <span>Più foto</span>
        </label>
      )}
    </div>
  )
}
