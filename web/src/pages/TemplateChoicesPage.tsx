import { useCallback, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { validateSchema, type Field, type FormSchema } from '@fieldview/form-core'
import { api, errorMessage } from '../api/client'
import type { FormTemplate } from '../api/types'
import { canCreateTemplates, isManager, useAuth } from '../auth/useAuth'
import Loading from '../components/Loading'
import { useToast } from '../components/useToast'
import { CATEGORY_LABEL } from '../labels'
import { useLoad } from '../hooks/useLoad'

type ChoiceField = Extract<Field, { type: 'select' | 'multiselect' }>
const isChoice = (f: Field): f is ChoiceField => f.type === 'select' || f.type === 'multiselect'

const parseOptions = (text: string) =>
  text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * Tutte le scelte singole/multiple dei moduli attivi in un'unica pagina:
 * si cambiano le opzioni senza aprire il builder. I moduli già compilati
 * sono bloccati dal server (lo schema non cambia): qui si mostrano in sola
 * lettura con "Duplica e modifica".
 */
export default function TemplateChoicesPage() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<FormTemplate[] | null>(null)
  // bozze: template id -> field id -> testo delle opzioni (una per riga)
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await api.GET('/form-templates', { params: { query: { include_archived: false } } })
    if (error) return toast.error(errorMessage(error))
    setTemplates(data ?? [])
    setDrafts({})
  }, [toast])

  useLoad(load)

  if (!isManager(user)) return <Navigate to="/projects" replace />

  const draftOf = (t: FormTemplate, f: ChoiceField) => drafts[t.id]?.[f.id] ?? f.options.join('\n')
  const dirty = (t: FormTemplate) => Object.keys(drafts[t.id] ?? {}).length > 0

  function setDraft(t: FormTemplate, f: ChoiceField, text: string) {
    setDrafts((d) => ({ ...d, [t.id]: { ...(d[t.id] ?? {}), [f.id]: text } }))
  }

  /** Schema con le opzioni modificate; un default non più fra le opzioni viene tolto. */
  function patched(t: FormTemplate): FormSchema {
    const schema = t.schema_def as FormSchema
    const fields = schema.fields.map((f) => {
      const text = isChoice(f) ? drafts[t.id]?.[f.id] : undefined
      if (!isChoice(f) || text === undefined) return f
      const options = parseOptions(text)
      // la chiave 'default' non deve restare con undefined: la validazione la considera presente
      if (f.type === 'select') {
        const { default: def, ...rest } = f
        return def !== undefined && options.includes(def) ? { ...rest, options, default: def } : { ...rest, options }
      }
      const { default: def, ...rest } = f
      const kept = (def ?? []).filter((v) => options.includes(v))
      return kept.length ? { ...rest, options, default: kept } : { ...rest, options }
    })
    // qui si toccano solo le opzioni: la struttura del modulo resta quella salvata
    return schema.layout ? { fields, layout: schema.layout } : { fields }
  }

  async function save(t: FormTemplate) {
    const schema = patched(t)
    const errors = validateSchema(schema)
    if (errors.length) return toast.error(errors.map((e) => e.message).join('; '))
    setSaving(t.id)
    const { error } = await api.PATCH('/form-templates/{template_id}', { params: { path: { template_id: t.id } }, body: { schema_def: schema } })
    setSaving(null)
    if (error) return toast.error(errorMessage(error))
    toast.success(`Scelte salvate: ${t.name}`)
    load()
  }

  async function duplicate(t: FormTemplate) {
    const { data, error } = await api.POST('/form-templates', {
      body: { name: `${t.name} (copia)`, category: t.category ?? null, schema_def: t.schema_def },
    })
    if (error || !data) return toast.error(errorMessage(error))
    toast.success('Copia creata: ora puoi modificarla')
    navigate(`/templates/${data.id}`)
  }

  const withChoices = (templates ?? [])
    .map((t) => ({ t, fields: (t.schema_def as FormSchema).fields.filter(isChoice) }))
    .filter((x) => x.fields.length > 0)

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/templates">Moduli</Link>
          </div>
          <h1>Scelte multiple</h1>
        </div>
      </header>
      <div className="content">
        {templates === null ? (
          <Loading />
        ) : withChoices.length === 0 ? (
          <div className="empty">Nessun modulo con campi a scelta. Aggiungi un campo "Scelta singola" o "Scelta multipla" dal builder.</div>
        ) : (
          <div className="choices-list">
            {withChoices.map(({ t, fields }) => {
              const locked = t.submissions_count > 0
              return (
                <section key={t.id} className="card choices-card" data-testid="choices-card">
                  <div className="choices-head">
                    <div>
                      <h2>
                        <Link to={`/templates/${t.id}`}>{t.name}</Link>
                      </h2>
                      <span className="muted small">
                        {t.category ? (CATEGORY_LABEL[t.category] ?? t.category) : 'Senza categoria'} · {fields.length} {fields.length === 1 ? 'campo' : 'campi'}
                      </span>
                    </div>
                    {locked ? (
                      <div className="row">
                        <span className="badge status-verified" title="Ha compilazioni: le opzioni non si possono più cambiare">
                          In uso
                        </span>
                        {canCreateTemplates(user) && (
                          <button type="button" className="btn small" onClick={() => duplicate(t)}>
                            Duplica e modifica
                          </button>
                        )}
                      </div>
                    ) : (
                      <button type="button" className="btn btn-primary small" onClick={() => save(t)} disabled={!dirty(t) || saving === t.id}>
                        {saving === t.id ? 'Salvataggio…' : 'Salva'}
                      </button>
                    )}
                  </div>
                  <div className="choices-fields">
                    {fields.map((f) => (
                      <div key={f.id} className="field">
                        <label htmlFor={`ch-${t.id}-${f.id}`}>
                          {f.label} <span className="muted small">· {f.type === 'select' ? 'scelta singola' : 'scelta multipla'}</span>
                        </label>
                        <textarea
                          id={`ch-${t.id}-${f.id}`}
                          rows={Math.min(8, Math.max(3, f.options.length + 1))}
                          value={draftOf(t, f)}
                          onChange={(e) => setDraft(t, f, e.target.value)}
                          disabled={locked}
                          spellCheck={false}
                        />
                        <span className="muted small">Una opzione per riga</span>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
