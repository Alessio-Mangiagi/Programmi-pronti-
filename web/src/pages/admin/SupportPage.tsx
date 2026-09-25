import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, errorMessage } from '../../api/client'
import type { SupportMessage } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import Loading from '../../components/Loading'
import { useToast } from '../../components/Toast'

type Filter = 'open' | 'closed' | 'all'
const FILTER_LABEL: Record<Filter, string> = { open: 'Da gestire', closed: 'Chiuse', all: 'Tutte' }

function fmtDate(iso: string) {
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Spazio admin → Segnalazioni: i messaggi inviati con "Contatta l'amministratore".
 * Ogni admin riceve anche una notifica (email/push); qui si leggono e si chiudono.
 */
export default function SupportPage() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('open')
  const [messages, setMessages] = useState<SupportMessage[] | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await api.GET('/support/messages', {
      params: { query: filter === 'all' ? {} : { status: filter } },
    })
    if (error) return toast.error(errorMessage(error))
    setMessages(data ?? [])
  }, [filter, toast])

  useEffect(() => {
    load()
  }, [load])

  if (me?.role !== 'admin') return <Navigate to="/projects" replace />

  async function setStatus(m: SupportMessage, status: 'open' | 'closed') {
    const { error } = await api.PATCH('/support/messages/{message_id}', {
      params: { path: { message_id: m.id } },
      body: { status },
    })
    if (error) return toast.error(errorMessage(error))
    toast.success(status === 'closed' ? 'Segnalazione chiusa' : 'Segnalazione riaperta')
    load()
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">Amministrazione</span>
          <h1>Segnalazioni</h1>
        </div>
        <div className="topbar-actions">
          <select aria-label="Mostra" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <option key={f} value={f}>
                {FILTER_LABEL[f]}
              </option>
            ))}
          </select>
        </div>
      </header>
      <div className="content">
        <p className="muted">
          Messaggi inviati dagli utenti con "Contatta l'amministratore". Chiudi una segnalazione quando è gestita: resta
          consultabile tra le chiuse.
        </p>
        {messages === null ? (
          <Loading />
        ) : messages.length === 0 ? (
          <div className="empty">{filter === 'open' ? 'Nessuna segnalazione da gestire.' : 'Nessuna segnalazione.'}</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Da</th>
                  <th>Messaggio</th>
                  <th>Cantiere</th>
                  <th>Stato</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id} className={m.status === 'closed' ? 'row-muted' : undefined}>
                    <td className="nowrap">{fmtDate(m.created_at)}</td>
                    <td>
                      <strong>{m.user_name}</strong>
                      {m.user_email && (
                        <div className="small">
                          <a href={`mailto:${m.user_email}`}>{m.user_email}</a>
                        </div>
                      )}
                    </td>
                    <td className="support-text">
                      {m.message}
                      {m.page && <div className="muted small">Pagina: {m.page}</div>}
                    </td>
                    <td>
                      {m.project_id ? <Link to={`/projects/${m.project_id}/dashboard`}>{m.project_name}</Link> : '—'}
                    </td>
                    <td className="nowrap">
                      {m.status === 'closed' ? (
                        <>
                          <span className="badge">chiusa</span>
                          {m.closed_at && (
                            <div className="muted small">
                              {m.closed_by_name} · {fmtDate(m.closed_at)}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="badge badge-accent">da gestire</span>
                      )}
                    </td>
                    <td className="nowrap row-actions">
                      <button className="btn small" onClick={() => setStatus(m, m.status === 'closed' ? 'open' : 'closed')}>
                        {m.status === 'closed' ? 'Riapri' : 'Chiudi'}
                      </button>
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
