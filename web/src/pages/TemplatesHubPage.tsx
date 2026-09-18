import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import type { FormSchema } from '@fieldview/form-core'
import { api, errorMessage } from '../api/client'
import type { FormTemplate } from '../api/types'
import { isManager, useAuth } from '../auth/AuthContext'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'
import { CATEGORY_LABEL } from './TemplatesPage'

/**
 * Ingresso della sezione Moduli: invece della lista, le scelte di lavoro
 * (nuovo modulo, scelte multiple, categorie, elenco) con i contatori.
 */
export default function TemplatesHubPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [templates, setTemplates] = useState<FormTemplate[] | null>(null)

  useEffect(() => {
    api.GET('/form-templates', { params: { query: { include_archived: false } } }).then(({ data, error }) => {
      if (error) return toast.error(errorMessage(error))
      setTemplates(data ?? [])
    })
  }, [toast])

  if (!isManager(user)) return <Navigate to="/projects" replace />

  const active = templates ?? []
  const choiceFields = active.reduce(
    (n, t) => n + (t.schema_def as FormSchema).fields.filter((f) => f.type === 'select' || f.type === 'multiselect').length,
    0,
  )
  const byCategory = (cat: string) => active.filter((t) => (t.category ?? 'other') === cat).length
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">Moduli</div>
          <h1>Cosa vuoi fare?</h1>
        </div>
      </header>
      <div className="content">
        <div className="hub-grid">
          <Link to="/templates/new" className="card card-link hub-card hub-card-primary">
            <span className="hub-icon">
              <Icon name="plus" />
            </span>
            <h2>Nuovo modulo</h2>
            <p className="muted">Costruisci un modulo da zero: campi, obbligatorietà, anteprima.</p>
          </Link>
          <Link to="/templates/scelte" className="card card-link hub-card">
            <span className="hub-icon">
              <Icon name="list-checks" />
            </span>
            <h2>Scelte multiple</h2>
            <p className="muted">Modifica le opzioni dei campi a scelta singola o multipla dei moduli esistenti.</p>
            {templates && <span className="hub-count">{n(choiceFields, 'campo a scelta', 'campi a scelta')}</span>}
          </Link>
          <div className="card hub-card">
            <span className="hub-icon">
              <Icon name="tag" />
            </span>
            <h2>Categorie</h2>
            <p className="muted">Apri i moduli per tipo di lavoro.</p>
            <ul className="hub-links">
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <li key={k}>
                  <Link to={`/templates/elenco?categoria=${k}`}>{v}</Link>
                  {templates && <span className="muted small"> · {byCategory(k)}</span>}
                </li>
              ))}
            </ul>
          </div>
          <Link to="/templates/elenco" className="card card-link hub-card">
            <span className="hub-icon">
              <Icon name="list" />
            </span>
            <h2>Elenco moduli</h2>
            <p className="muted">Tutti i moduli: modifica, duplica, archivia.</p>
            {templates && <span className="hub-count">{n(active.length, 'modulo attivo', 'moduli attivi')}</span>}
          </Link>
        </div>
      </div>
    </>
  )
}
