import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import type { FormSchema } from '@fieldview/form-core'
import { api, errorMessage } from '../api/client'
import type { FormTemplate } from '../api/types'
import { canCreateTemplates, isManager, useAuth } from '../auth/useAuth'
import Icon, { type IconName } from '../components/Icon'
import { useToast } from '../components/useToast'
import { CATEGORY_LABEL } from '../labels'

/**
 * Ingresso della sezione Moduli: le scelte di lavoro in una lista a righe
 * (nuovo modulo, elenco, scelte multiple, struttura PCQ, categorie) con i contatori.
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
        <nav className="hub-list" aria-label="Sezioni dei moduli">
          {canCreateTemplates(user) && (
            <HubRow to="/templates/new" icon="plus" title="Nuovo modulo" text="Costruisci un modulo da zero: campi, obbligatorietà, anteprima." primary />
          )}
          <HubRow
            to="/templates/elenco"
            icon="list"
            title="Elenco moduli"
            text="Tutti i moduli: modifica, duplica, archivia."
            count={templates ? n(active.length, 'attivo', 'attivi') : undefined}
          />
          <HubRow
            to="/templates/scelte"
            icon="list-checks"
            title="Scelte multiple"
            text="Le opzioni dei campi a scelta singola o multipla, senza aprire il builder."
            count={templates ? n(choiceFields, 'campo', 'campi') : undefined}
          />
          {canCreateTemplates(user) && (
            <HubRow to="/templates/pcq" icon="file" title="Struttura PCQ" text="Come preparare il Word del PCQ: esempio scaricabile e modulo che ne esce." />
          )}
          <div className="hub-row hub-row-static">
            <span className="hub-icon">
              <Icon name="tag" />
            </span>
            <span className="hub-row-main">
              <span className="hub-row-title">Categorie</span>
              <span className="hub-chips">
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                  <Link key={k} to={`/templates/elenco?categoria=${k}`} className="hub-chip">
                    {v}
                    {templates && <span className="hub-chip-n">{byCategory(k)}</span>}
                  </Link>
                ))}
              </span>
            </span>
          </div>
        </nav>
      </div>
    </>
  )
}

/** Riga della lista: icona, titolo con descrizione, contatore e freccia; tutta la riga è il link. */
function HubRow({ to, icon, title, text, count, primary }: { to: string; icon: IconName; title: string; text: string; count?: string; primary?: boolean }) {
  return (
    <Link to={to} className={`hub-row hub-row-link${primary ? ' is-primary' : ''}`}>
      <span className="hub-icon">
        <Icon name={icon} />
      </span>
      <span className="hub-row-main">
        <span className="hub-row-title">{title}</span>
        <span className="muted small">{text}</span>
      </span>
      {count && <span className="hub-row-count">{count}</span>}
      <Icon name="chevron-right" className="hub-row-arrow" />
    </Link>
  )
}
