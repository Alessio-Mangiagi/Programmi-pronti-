import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { Project } from '../api/types'
import { isManager, useAuth } from '../auth/useAuth'
import CommessaForm from '../commesse/CommessaForm'
import { NO_COMMESSA, type Commessa } from '../commesse/CommesseContext'
import { useCommesse } from '../commesse/useCommesse'
import Loading from '../components/Loading'
import Modal from '../components/Modal'
import { useToast } from '../components/useToast'

/**
 * Progetti = cantieri raggruppati per commessa. Filtro per commessa (dalla barra
 * in alto, `?commessa=`) e per valore dei parametri personalizzati (`?p.<id>=<valore>`).
 */
export default function ProjectsPage() {
  const { user } = useAuth()
  const toast = useToast()
  const { commesse, orphans, params, loading, reload, selectedId, select } = useCommesse()
  const [sp, setSp] = useSearchParams()
  const [creatingCommessa, setCreatingCommessa] = useState(false)
  const [editing, setEditing] = useState<Commessa | null>(null)
  const [newProjectIn, setNewProjectIn] = useState<string | null>(null) // commessa id | NO_COMMESSA

  const commessaFilter = sp.get('commessa') ?? ''
  const paramFilters = useMemo(
    () => Object.fromEntries(params.map((p) => [p.id, sp.get(`p.${p.id}`) ?? '']).filter(([, v]) => v)),
    [params, sp],
  )
  const setParamFilter = (pid: string, value: string) => {
    const next = new URLSearchParams(sp)
    if (value) next.set(`p.${pid}`, value)
    else next.delete(`p.${pid}`)
    setSp(next, { replace: true })
  }

  const groups = useMemo(() => {
    const matchParams = (c: Commessa) => Object.entries(paramFilters).every(([pid, v]) => (c.params[pid] ?? []).includes(String(v)))
    const list = commesse
      .filter((c) => (!commessaFilter || commessaFilter === c.id) && matchParams(c))
      .map((c) => ({ key: c.id, commessa: c as Commessa | null, projects: c.projects }))
    const showOrphans = (!commessaFilter || commessaFilter === NO_COMMESSA) && Object.keys(paramFilters).length === 0 && orphans.length > 0
    if (showOrphans) list.push({ key: NO_COMMESSA, commessa: null, projects: orphans })
    return list
  }, [commesse, orphans, commessaFilter, paramFilters])

  const totalProjects = groups.reduce((n, g) => n + g.projects.length, 0)

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">Commesse e cantieri</span>
          <h1>Progetti</h1>
        </div>
        {isManager(user) && (
          <div className="topbar-actions">
            <button className="btn" onClick={() => setNewProjectIn(commessaFilter && commessaFilter !== NO_COMMESSA ? commessaFilter : NO_COMMESSA)}>
              + Nuovo cantiere
            </button>
            <button className="btn btn-primary" onClick={() => setCreatingCommessa(true)}>
              + Nuova commessa
            </button>
          </div>
        )}
      </header>
      {params.length > 0 && (
        <div className="filters">
          {params.map((p) => (
            <div className="filter-group" key={p.id}>
              <label className="filter-label" htmlFor={`pf-${p.id}`}>
                {p.name}
              </label>
              <select id={`pf-${p.id}`} value={paramFilters[p.id] ?? ''} onChange={(e) => setParamFilter(p.id, e.target.value)}>
                <option value="">Tutti</option>
                {p.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="filter-group filter-summary">
            {(commessaFilter || Object.keys(paramFilters).length > 0) && (
              <button
                className="btn small"
                onClick={() => {
                  setSp({}, { replace: true })
                  select(null)
                }}
              >
                Azzera
              </button>
            )}
            <span className="muted small">
              {groups.filter((g) => g.commessa).length} commesse · {totalProjects} cantieri
            </span>
          </div>
        </div>
      )}
      <div className="content">
        {loading ? (
          <Loading />
        ) : groups.length === 0 ? (
          <div className="empty">Nessuna commessa corrisponde ai filtri.</div>
        ) : (
          groups.map((g) => (
            <section key={g.key} className={`commessa-group${selectedId === g.key ? ' is-selected' : ''}`}>
              <header className="commessa-head">
                <div>
                  {g.commessa ? (
                    <>
                      <span className="eyebrow">
                        {g.commessa.code}
                        {g.commessa.client && <span className="muted"> · {g.commessa.client}</span>}
                      </span>
                      <h2>{g.commessa.name}</h2>
                      {Object.entries(g.commessa.params).length > 0 && (
                        <div className="param-badges">
                          {params
                            .filter((p) => g.commessa!.params[p.id]?.length)
                            .map((p) => (
                              <span key={p.id} className="param-badge" title={p.name}>
                                <span className="muted">{p.name}:</span> {g.commessa!.params[p.id].join(', ')}
                              </span>
                            ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="eyebrow">Senza commessa</span>
                      <h2>Cantieri non associati</h2>
                    </>
                  )}
                </div>
                {isManager(user) && (
                  <div className="row-actions">
                    <button className="btn small" onClick={() => setNewProjectIn(g.key)}>
                      + Cantiere
                    </button>
                    {g.commessa && (
                      <button className="btn small" onClick={() => setEditing(g.commessa)}>
                        Modifica
                      </button>
                    )}
                  </div>
                )}
              </header>
              {g.projects.length === 0 ? (
                <div className="empty small">Nessun cantiere{isManager(user) ? ': aggiungine uno con "+ Cantiere"' : ' a cui hai accesso'}.</div>
              ) : (
                <div className="grid">
                  {g.projects.map((p) => (
                    <Link key={p.id} to={`/projects/${p.id}/plans`} className="card card-link" onClick={() => select(g.key)}>
                      <h2>{p.name}</h2>
                      <div className="muted small">{p.address ?? '—'}</div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ))
        )}
      </div>

      {creatingCommessa && (
        <Modal title="Nuova commessa" onClose={() => setCreatingCommessa(false)} width={560}>
          <CommessaForm
            onDone={(saved) => {
              setCreatingCommessa(false)
              if (saved) select(saved.id)
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal title={`Commessa ${editing.code}`} onClose={() => setEditing(null)} width={560}>
          <CommessaForm commessa={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
      {newProjectIn && (
        <Modal title="Nuovo cantiere" onClose={() => setNewProjectIn(null)} width={480}>
          <ProjectForm
            commesse={commesse}
            initialCommessa={newProjectIn === NO_COMMESSA ? '' : newProjectIn}
            onDone={async (created) => {
              setNewProjectIn(null)
              if (created) {
                toast.success(`Cantiere ${created.name} creato`)
                await reload()
              }
            }}
          />
        </Modal>
      )}
    </>
  )
}

function ProjectForm({ commesse, initialCommessa, onDone }: { commesse: Commessa[]; initialCommessa: string; onDone: (created?: Project) => void }) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [commessaId, setCommessaId] = useState(initialCommessa)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { data, error } = await api.POST('/projects', { body: { name, address: address || null, commessa_id: commessaId || null } })
    setBusy(false)
    if (error || !data) return setError(errorMessage(error))
    onDone(data)
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="pname">Nome cantiere</label>
        <input id="pname" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="paddr">Indirizzo</label>
        <input id="paddr" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pcomm">Commessa</label>
        <select id="pcomm" value={commessaId} onChange={(e) => setCommessaId(e.target.value)}>
          <option value="">— nessuna —</option>
          {commesse.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.name}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row form-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creazione…' : 'Crea cantiere'}
        </button>
        <button className="btn" type="button" onClick={() => onDone()}>
          Annulla
        </button>
      </div>
    </form>
  )
}
