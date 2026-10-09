import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  FIELD_TYPES,
  LAYOUT_COLUMNS,
  defaults,
  isFieldItem,
  validateSchema,
  type Field,
  type FieldError,
  type FieldType,
  type FormData,
  type FormSchema,
  type LayoutColumns,
  type LayoutItem,
  type LayoutSection,
} from '@fieldview/form-core'
import { api, errorMessage } from '../api/client'
import type { FormTemplate, PcqPreview } from '../api/types'
import { canCreateTemplates, isManager, useAuth } from '../auth/useAuth'
import Loading from '../components/Loading'
import PcqImportModal from '../components/PcqImportModal'
import { useToast } from '../components/useToast'
import DynamicForm from '../forms/DynamicForm'
import { CATEGORY_LABEL } from '../labels'
import Icon from '../components/Icon'
import { slugId } from '../forms/slug'
import { pcqToSchema, type PcqConversion } from '../forms/pcqToSchema'

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
 * Form builder v2, in due fasi:
 * 1. Struttura — sezioni a 1-3 colonne con blocchi, anche vuoti: si progetta
 *    l'impaginato prima di sapere quali campi ci andranno;
 * 2. Campi — ogni blocco vuoto si riempie scegliendo un tipo di campo e se ne
 *    modificano le proprietà.
 * Le due fasi restano aperte entrambe: la struttura si può cambiare anche dopo
 * aver messo i campi, e i blocchi già pieni si spostano da una sezione all'altra.
 * Anteprima live con DynamicForm, validazione con validateSchema prima del salvataggio.
 * Lo schema di un template già usato da submission è bloccato dal server (409):
 * qui si mostra in sola lettura con "Duplica e modifica".
 */
export default function TemplateEditorPage() {
  const { templateId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isNew = !templateId || templateId === 'new'
  // "Crea modulo" dalla pagina PCQ del cantiere: il PCQ letto arriva nello state della navigazione
  const pcq = isNew ? (location.state as { pcq?: PcqPreview } | null)?.pcq : undefined
  const draft = useMemo<PcqConversion | null>(() => (pcq ? pcqToSchema(pcq) : null), [pcq])
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
  // i moduli nuovi li crea solo l'amministratore; i responsabili modificano quelli esistenti
  if (isNew && !canCreateTemplates(user)) return <Navigate to="/templates/elenco" replace />
  if (notFound) return <div className="content empty">Template non trovato.</div>
  if (!isNew && !loaded) return <Loading className="content" />
  // nuovo modulo: ogni navigazione (anche dal menu mentre si è già qui) riparte da un editor vuoto
  return <Editor key={loaded?.id ?? `new-${location.key}`} template={loaded} draft={draft} onSaved={(t) => navigate(`/templates/${t.id}`, { replace: true })} />
}

type Tab = 'struttura' | 'campi'

const slotOf = (it: LayoutItem): string | null => (isFieldItem(it) ? null : it.slot)

/**
 * Sezioni di partenza: quelle salvate se ci sono, altrimenti una sezione unica
 * con i campi nell'ordine attuale (così un modulo fatto prima del layout si
 * apre già impaginato e la struttura diventa modificabile).
 */
function initialSections(schema: FormSchema | null): LayoutSection[] {
  const fields = schema?.fields ?? []
  const saved = schema?.layout?.sections
  if (!saved?.length) return [{ id: 'sezione_1', columns: 1, items: fields.map((f) => ({ field: f.id })) }]

  const sections = saved.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i })) }))
  const placed = new Set(sections.flatMap((s) => s.items.filter(isFieldItem).map((i) => i.field)))
  const missing = fields.filter((f) => !placed.has(f.id)).map((f) => ({ field: f.id }))
  if (missing.length) sections[sections.length - 1].items.push(...missing)
  return sections
}

type EditorProps = { template: FormTemplate | null; draft?: PcqConversion | null; onSaved: (t: FormTemplate) => void }

function Editor({ template, draft, onSaved }: EditorProps) {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const saved = (template?.schema_def ?? draft?.schema ?? null) as FormSchema | null
  const [name, setName] = useState(template?.name ?? draft?.name ?? '')
  const [category, setCategory] = useState(template?.category ?? (draft ? 'quality' : ''))
  const [importing, setImporting] = useState(false)
  const [fields, setFields] = useState<Field[]>(() => saved?.fields ?? [])
  const [sections, setSections] = useState<LayoutSection[]>(() => initialSections(saved))
  const [tab, setTab] = useState<Tab>(() => (saved?.fields.length ? 'campi' : 'struttura'))
  const [selected, setSelected] = useState<string | null>(() => saved?.fields[0]?.id ?? null)
  const [newType, setNewType] = useState<FieldType>('text')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [preview, setPreview] = useState<FormData>({})
  const locked = !!template && template.submissions_count > 0

  const schema: FormSchema = useMemo(() => ({ fields, layout: { sections } }), [fields, sections])
  const errors = useMemo<FieldError[]>(() => validateSchema(schema), [schema])
  const schemaValid = errors.length === 0
  const fieldErrors = (f: Field) => errors.filter((e) => e.field === f.id || e.field === `fields[${fields.indexOf(f)}]`)
  const layoutErrors = errors.filter((e) => e.field === '$' || e.field.startsWith('layout.'))

  // L'anteprima riparte dai default quando cambia lo schema (solo se valido, altrimenti resta l'ultima buona):
  // aggiornata durante il render, non in un effetto, così non c'è un render intermedio con i dati vecchi.
  const [previewOf, setPreviewOf] = useState<FormSchema | null>(null)
  if (schemaValid && previewOf !== schema) {
    setPreviewOf(schema)
    setPreview(defaults(schema))
  }

  const fieldIds = () => new Set(fields.map((f) => f.id))
  const slotIds = () => new Set(sections.flatMap((s) => s.items.map(slotOf).filter((x): x is string => !!x)))

  // ---------- struttura ----------

  const patchSection = (i: number, patch: Partial<LayoutSection>) =>
    setSections((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  const patchItems = (i: number, fn: (items: LayoutItem[]) => LayoutItem[]) =>
    setSections((ss) => ss.map((s, j) => (j === i ? { ...s, items: fn(s.items) } : s)))

  const setTitle = (i: number, title: string) =>
    setSections((ss) =>
      ss.map((s, j) => {
        if (j !== i) return s
        const { title: _title, ...rest } = s
        return title ? { ...rest, title } : rest
      }),
    )

  const addSection = () =>
    setSections((ss) => [
      ...ss,
      { id: slugId('sezione', new Set(ss.map((s) => s.id))), title: `Sezione ${ss.length + 1}`, columns: 1, items: [] },
    ])

  const setColumns = (i: number, columns: LayoutColumns) =>
    // uno span più largo delle nuove colonne non è valido: si stringe
    patchSection(i, { columns, items: sections[i].items.map((it) => (it.span && it.span > columns ? { ...it, span: columns } : it)) })

  const moveSection = (i: number, d: -1 | 1) =>
    setSections((ss) => {
      const j = i + d
      if (j < 0 || j >= ss.length) return ss
      const next = [...ss]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  /** I blocchi della sezione eliminata passano alla sezione vicina: niente campi persi per sbaglio. */
  const removeSection = (i: number) => {
    if (sections.length === 1) return toast.error('Serve almeno una sezione')
    const into = i === 0 ? 1 : i - 1
    setSections((ss) =>
      ss.map((s, j) => (j === into ? { ...s, items: [...s.items, ...ss[i].items] } : s)).filter((_, j) => j !== i),
    )
  }

  const addBlock = (i: number) => patchItems(i, (items) => [...items, { slot: slugId('blocco', slotIds()) }])

  /** Toglie il blocco; se conteneva un campo, sparisce anche quello dallo schema. */
  const removeBlock = (i: number, j: number) => {
    const it = sections[i].items[j]
    if (isFieldItem(it)) {
      setFields((fs) => fs.filter((f) => f.id !== it.field))
      setSelected((s) => (s === it.field ? null : s))
    }
    patchItems(i, (items) => items.filter((_, k) => k !== j))
  }

  /** Sposta il blocco dentro la sezione; oltre i bordi passa alla sezione vicina. */
  const moveBlock = (i: number, j: number, d: -1 | 1) => {
    const k = j + d
    if (k >= 0 && k < sections[i].items.length) {
      return patchItems(i, (items) => {
        const next = [...items]
        ;[next[j], next[k]] = [next[k], next[j]]
        return next
      })
    }
    const to = i + d
    if (to < 0 || to >= sections.length) return
    const it = sections[i].items[j]
    const columns = sections[to].columns ?? 1
    const moved = it.span && it.span > columns ? { ...it, span: columns } : it
    setSections((ss) =>
      ss.map((s, x) => {
        if (x === i) return { ...s, items: s.items.filter((_, y) => y !== j) }
        if (x === to) return { ...s, items: d === 1 ? [moved, ...s.items] : [...s.items, moved] }
        return s
      }),
    )
  }

  const setSpan = (i: number, j: number, span: number) =>
    patchItems(i, (items) => items.map((it, k) => (k !== j ? it : span <= 1 ? omitSpan(it) : { ...it, span })))

  // ---------- campi ----------

  /** Riempie un blocco vuoto con un campo nuovo del tipo scelto. */
  const fillBlock = (i: number, j: number, type: FieldType) => {
    const f = newField(type, fieldIds())
    const span = sections[i].items[j].span
    setFields((fs) => [...fs, f])
    patchItems(i, (items) => items.map((it, k) => (k === j ? (span ? { field: f.id, span } : { field: f.id }) : it)))
    setSelected(f.id)
    setTab('campi')
  }

  /** Svuota il blocco: il campo se ne va, il posto nella struttura resta. */
  const clearBlock = (i: number, j: number) => {
    const it = sections[i].items[j]
    if (!isFieldItem(it)) return
    setFields((fs) => fs.filter((f) => f.id !== it.field))
    setSelected((s) => (s === it.field ? null : s))
    patchItems(i, (items) =>
      items.map((x, k) => (k === j ? (it.span ? { slot: slugId('blocco', slotIds()), span: it.span } : { slot: slugId('blocco', slotIds()) }) : x)),
    )
  }

  /** Campo aggiunto senza passare dalla struttura: nuovo blocco in fondo all'ultima sezione. */
  const addField = () => {
    const i = sections.length - 1
    const f = newField(newType, fieldIds())
    setFields((fs) => [...fs, f])
    patchItems(i, (items) => [...items, { field: f.id }])
    setSelected(f.id)
  }

  const updateField = (id: string, patch: Partial<Field>) => {
    setFields((fs) => fs.map((f) => (f.id === id ? ({ ...f, ...patch } as Field) : f)))
    const nextId = patch.id
    if (nextId && nextId !== id) {
      // l'id è la chiave del campo nel layout: rinominarlo significa rinominare anche il riferimento
      setSections((ss) => ss.map((s) => ({ ...s, items: s.items.map((it) => (isFieldItem(it) && it.field === id ? { ...it, field: nextId } : it)) })))
      setSelected(nextId)
    }
  }

  /** PCQ letto e convertito: sostituisce nome (se vuoto), struttura e campi; si rivede e si salva. */
  const applyPcq = (conv: PcqConversion) => {
    if (!name.trim()) setName(conv.name)
    setCategory('quality')
    setFields(conv.schema.fields)
    setSections(initialSections(conv.schema))
    setSelected(conv.schema.fields[0]?.id ?? null)
    setTab('campi')
    setImporting(false)
    toast.success(`PCQ importato: ${conv.controls} controlli. Rivedi e salva.`)
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

  const fieldOf = (id: string) => fields.find((f) => f.id === id)
  const sel = selected ? fieldOf(selected) : undefined
  const emptyBlocks = sections.reduce((n, s) => n + s.items.filter((it) => !isFieldItem(it)).length, 0)

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/templates">Moduli</Link> · <Link to="/templates/elenco">Elenco moduli</Link>
          </div>
          <h1>{template ? template.name : 'Nuovo modulo'}</h1>
        </div>
        <div className="topbar-actions">
          {!locked && canCreateTemplates(user) && (
            <button type="button" className="btn" onClick={() => setImporting(true)}>
              <Icon name="upload" /> Importa da PCQ
            </button>
          )}
          {locked && canCreateTemplates(user) && (
            <button type="button" className="btn" onClick={duplicateAndEdit}>
              Duplica e modifica
            </button>
          )}
          <button type="submit" form="template-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </header>
      {importing && <PcqImportModal replacing={fields.length > 0} onApply={applyPcq} onClose={() => setImporting(false)} />}
      <form id="template-form" className="content builder" onSubmit={save} noValidate>
        {locked && (
          <div className="callout callout-warn builder-wide">
            Questo template ha {template!.submissions_count} compilazioni: struttura e campi non si possono più cambiare (le risposte esistenti
            resterebbero incoerenti). Puoi rinominarlo o duplicarlo e modificare la copia.
          </div>
        )}

        <div className="builder-wide builder-steps" role="tablist" aria-label="Fasi di costruzione">
          <button type="button" role="tab" aria-selected={tab === 'struttura'} className={`step${tab === 'struttura' ? ' is-on' : ''}`} onClick={() => setTab('struttura')}>
            <span className="step-n">1</span>
            <span>
              Struttura
              <span className="muted small"> · {sections.length === 1 ? '1 sezione' : `${sections.length} sezioni`}</span>
            </span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'campi'} className={`step${tab === 'campi' ? ' is-on' : ''}`} onClick={() => setTab('campi')}>
            <span className="step-n">2</span>
            <span>
              Campi
              <span className="muted small">
                {' '}
                · {fields.length === 1 ? '1 campo' : `${fields.length} campi`}
                {emptyBlocks > 0 && `, ${emptyBlocks} da riempire`}
              </span>
            </span>
          </button>
        </div>

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

          <h2>{tab === 'struttura' ? 'Struttura' : 'Campi'}</h2>
          <p className="muted small">
            {tab === 'struttura'
              ? 'Sezioni e blocchi: decidi prima come è fatto il modulo, i campi li metti dopo. Le frecce spostano un blocco anche nella sezione vicina.'
              : 'Clicca un blocco per modificarne il campo; i blocchi vuoti si riempiono scegliendo un tipo.'}
          </p>
          {layoutErrors.map((e, i) => (
            <p key={i} className="error small">
              {e.field === '$' ? '' : `${e.field}: `}
              {e.message}
            </p>
          ))}

          <div className="bsections">
            {sections.map((sec, i) => {
              const columns = sec.columns ?? 1
              return (
                <div key={sec.id} className="bsec">
                  <div className="bsec-head">
                    {tab === 'struttura' && !locked ? (
                      <>
                        <input
                          className="bsec-title"
                          value={sec.title ?? ''}
                          placeholder="Titolo sezione (facoltativo)"
                          aria-label={`Titolo della sezione ${i + 1}`}
                          onChange={(e) => setTitle(i, e.target.value)}
                        />
                        <select
                          value={columns}
                          aria-label={`Colonne della sezione ${i + 1}`}
                          style={{ width: 'auto' }}
                          onChange={(e) => setColumns(i, Number(e.target.value) as LayoutColumns)}
                        >
                          {LAYOUT_COLUMNS.map((c) => (
                            <option key={c} value={c}>
                              {c} {c === 1 ? 'colonna' : 'colonne'}
                            </option>
                          ))}
                        </select>
                        <span className="bsec-actions">
                          <button type="button" className="btn small" onClick={() => moveSection(i, -1)} disabled={i === 0} aria-label="Sposta sezione su">
                            <Icon name="arrow-up" />
                          </button>
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => moveSection(i, 1)}
                            disabled={i === sections.length - 1}
                            aria-label="Sposta sezione giù"
                          >
                            <Icon name="arrow-down" />
                          </button>
                          <button type="button" className="btn small btn-danger" onClick={() => removeSection(i)} aria-label="Elimina sezione">
                            <Icon name="x" />
                          </button>
                        </span>
                      </>
                    ) : (
                      <>
                        <strong className="bsec-title-static">{sec.title || <span className="muted">Sezione {i + 1}</span>}</strong>
                        <span className="muted small">
                          {columns} {columns === 1 ? 'colonna' : 'colonne'}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="bsec-grid" style={{ '--bcols': columns } as CSSProperties}>
                    {sec.items.map((it, j) => {
                      const f = isFieldItem(it) ? fieldOf(it.field) : undefined
                      const span = Math.min(it.span ?? 1, columns)
                      const errs = f ? fieldErrors(f) : []
                      return (
                        <div
                          key={isFieldItem(it) ? `f:${it.field}` : `s:${it.slot}`}
                          className={`bblock${f ? '' : ' is-empty'}${selected && f?.id === selected ? ' is-selected' : ''}${errs.length ? ' has-error' : ''}`}
                          style={{ '--bspan': span } as CSSProperties}
                        >
                          {f ? (
                            <button type="button" className="bblock-main" onClick={() => (setSelected(f.id), setTab('campi'))}>
                              <span className="bblock-label">
                                {f.label || <em className="muted">senza etichetta</em>}
                                {f.required && <span className="req"> *</span>}
                              </span>
                              <span className="muted small">
                                {TYPE_LABEL[f.type]} · <code>{f.id}</code>
                              </span>
                            </button>
                          ) : tab === 'campi' && !locked ? (
                            <div className="bblock-fill">
                              <span className="muted small">Blocco vuoto</span>
                              <select
                                defaultValue=""
                                aria-label="Riempi il blocco con un campo"
                                onChange={(e) => e.target.value && fillBlock(i, j, e.target.value as FieldType)}
                              >
                                <option value="">+ Metti un campo…</option>
                                {FIELD_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {TYPE_LABEL[t]}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div className="bblock-main">
                              <span className="muted small">Blocco vuoto</span>
                            </div>
                          )}

                          {!locked && (
                            <span className="bblock-actions">
                              {tab === 'struttura' ? (
                                <>
                                  <button type="button" className="btn small" onClick={() => moveBlock(i, j, -1)} aria-label="Sposta blocco indietro">
                                    <Icon name="arrow-up" />
                                  </button>
                                  <button type="button" className="btn small" onClick={() => moveBlock(i, j, 1)} aria-label="Sposta blocco avanti">
                                    <Icon name="arrow-down" />
                                  </button>
                                  {columns > 1 && (
                                    <select
                                      value={span}
                                      aria-label="Colonne occupate dal blocco"
                                      style={{ width: 'auto' }}
                                      onChange={(e) => setSpan(i, j, Number(e.target.value))}
                                    >
                                      {Array.from({ length: columns }, (_, k) => k + 1).map((c) => (
                                        <option key={c} value={c}>
                                          {c}/{columns}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                  <button type="button" className="btn small btn-danger" onClick={() => removeBlock(i, j)} aria-label="Elimina blocco">
                                    <Icon name="x" />
                                  </button>
                                </>
                              ) : (
                                f && (
                                  <button type="button" className="btn small btn-danger" onClick={() => clearBlock(i, j)} aria-label="Svuota blocco">
                                    <Icon name="x" />
                                  </button>
                                )
                              )}
                            </span>
                          )}
                        </div>
                      )
                    })}

                    {tab === 'struttura' && !locked && (
                      <button type="button" className="bblock bblock-add" onClick={() => addBlock(i)}>
                        <Icon name="plus" /> Blocco
                      </button>
                    )}
                    {sec.items.length === 0 && tab === 'campi' && <p className="muted small">Sezione senza blocchi: aggiungili nella fase Struttura.</p>}
                  </div>
                </div>
              )
            })}
          </div>

          {!locked && tab === 'struttura' && (
            <button type="button" className="btn" onClick={addSection}>
              + Aggiungi sezione
            </button>
          )}
          {!locked && tab === 'campi' && (
            <div className="row" style={{ justifyContent: 'flex-start' }}>
              <select value={newType} onChange={(e) => setNewType(e.target.value as FieldType)} aria-label="Tipo del nuovo campo" style={{ width: 'auto' }}>
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <button type="button" className="btn" onClick={addField}>
                + Aggiungi campo in fondo
              </button>
            </div>
          )}
        </section>

        <section className="card builder-col">
          <h2>Proprietà</h2>
          {tab === 'struttura' ? (
            <p className="muted small">
              Stai progettando la struttura. Le proprietà dei campi (etichetta, obbligatorietà, opzioni) si modificano nella fase <strong>Campi</strong>.
            </p>
          ) : sel ? (
            <FieldProps
              key={sel.id}
              field={sel}
              errors={fieldErrors(sel)}
              locked={locked}
              onChange={(patch) => updateField(sel.id, patch)}
              onRelabel={(label) => {
                const others = new Set(fields.filter((f) => f.id !== sel.id).map((f) => f.id))
                // l'id segue l'etichetta finché il template è nuovo (non è mai stato salvato)
                updateField(sel.id, template ? { label } : { label, id: slugId(label, others) })
              }}
            />
          ) : (
            <p className="muted small">Seleziona un campo per modificarne le proprietà.</p>
          )}
        </section>

        <section className="card builder-col builder-preview">
          <h2>Anteprima</h2>
          {fields.length === 0 ? (
            <p className="muted small">L'anteprima compare quando riempi i blocchi con dei campi.</p>
          ) : schemaValid ? (
            <DynamicForm schema={schema} value={preview} attachments={{}} onChange={setPreview} />
          ) : (
            <div className="callout callout-warn">
              Schema non valido: {errors.length} {errors.length === 1 ? 'errore' : 'errori'} nei punti segnalati.
            </div>
          )}
        </section>
      </form>
    </>
  )
}

/** `span` assente invece che 1: lo schema tiene solo le proprietà che servono. */
function omitSpan(it: LayoutItem): LayoutItem {
  const { span: _span, ...rest } = it
  return rest as LayoutItem
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
