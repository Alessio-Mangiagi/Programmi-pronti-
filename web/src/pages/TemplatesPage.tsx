import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import type { FormSchema } from '@fieldview/form-core'
import { api, errorMessage } from '../api/client'
import type { FormTemplate } from '../api/types'
import { isManager, useAuth } from '../auth/AuthContext'
import Loading from '../components/Loading'
import { useToast } from '../components/Toast'

export const CATEGORY_LABEL: Record<string, string> = { safety: 'Sicurezza', quality: 'Qualità', diary: 'Diario', other: 'Altro' }

/** Lista dei template (solo manager/admin): modifica, duplica, archivia/ripristina. */
export default function TemplatesPage() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<FormTemplate[] | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await api.GET('/form-templates', { params: { query: { include_archived: true } } })
    if (error) return toast.error(errorMessage(error))
    setTemplates(data ?? [])
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  if (!isManager(user)) return <Navigate to="/projects" replace />

  async function duplicate(t: FormTemplate) {
    const { data, error } = await api.POST('/form-templates', {
      body: { name: `${t.name} (copia)`, category: t.category ?? null, schema_def: t.schema_def },
    })
    if (error || !data) return toast.error(errorMessage(error))
    toast.success('Template duplicato: modifica la copia')
    navigate(`/templates/${data.id}`)
  }

  async function setArchived(t: FormTemplate, archived: boolean) {
    const { error } = await api.PATCH('/form-templates/{template_id}', { params: { path: { template_id: t.id } }, body: { archived } })
    if (error) return toast.error(errorMessage(error))
    toast.success(archived ? 'Template archiviato' : 'Template ripristinato')
    load()
  }

  const visible = (templates ?? []).filter((t) => showArchived || !t.archived_at)

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">Moduli</div>
          <h1>Template dei moduli</h1>
        </div>
        <div className="topbar-actions">
          <label className="dyn-check">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            <span className="small">Mostra archiviati</span>
          </label>
          <Link to="/templates/new" className="btn btn-primary">
            + Nuovo template
          </Link>
        </div>
      </header>
      <div className="content">
        {templates === null ? (
          <Loading />
        ) : visible.length === 0 ? (
          <div className="empty">Nessun template. Creane uno con "+ Nuovo template".</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Categoria</th>
                  <th>Campi</th>
                  <th>Compilazioni</th>
                  <th>Stato</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.id} className={t.archived_at ? 'row-muted' : undefined}>
                    <td>
                      <Link to={`/templates/${t.id}`}>
                        <strong>{t.name}</strong>
                      </Link>
                    </td>
                    <td>{t.category ? (CATEGORY_LABEL[t.category] ?? t.category) : '—'}</td>
                    <td>{(t.schema_def as FormSchema).fields.length}</td>
                    <td>{t.submissions_count}</td>
                    <td>
                      {t.archived_at ? (
                        <span className="badge">Archiviato</span>
                      ) : t.submissions_count ? (
                        <span className="badge status-verified" title="Lo schema non è più modificabile: duplica per cambiarlo">
                          In uso
                        </span>
                      ) : (
                        <span className="badge status-resolved">Bozza</span>
                      )}
                    </td>
                    <td className="nowrap row-actions">
                      <Link className="btn small" to={`/templates/${t.id}`}>
                        {t.submissions_count ? 'Apri' : 'Modifica'}
                      </Link>
                      <button type="button" className="btn small" onClick={() => duplicate(t)}>
                        Duplica
                      </button>
                      {t.archived_at ? (
                        <button type="button" className="btn small" onClick={() => setArchived(t, false)}>
                          Ripristina
                        </button>
                      ) : (
                        <button type="button" className="btn small" onClick={() => setArchived(t, true)}>
                          Archivia
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
