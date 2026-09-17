import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, errorMessage } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { useCommesse, type CommessaParam } from '../../commesse/CommesseContext'
import Icon from '../../components/Icon'
import Loading from '../../components/Loading'
import Modal from '../../components/Modal'
import { useToast } from '../../components/Toast'

/**
 * Spazio admin → Parametri commessa: campi a scelta multipla personalizzati
 * (nome + opzioni + singola/multipla) che ogni commessa può valorizzare.
 */
export default function ParamsPage() {
  const { user: me } = useAuth()
  const toast = useToast()
  const { params, loading, reload } = useCommesse()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<CommessaParam | null>(null)

  if (me?.role !== 'admin') return <Navigate to="/projects" replace />

  async function remove(p: CommessaParam) {
    const warn = p.used_by ? ` È valorizzato in ${p.used_by} commesse: i valori verranno tolti.` : ''
    if (!window.confirm(`Eliminare il parametro "${p.name}"?${warn}`)) return
    const { error } = await api.DELETE('/commessa-params/{param_id}', { params: { path: { param_id: p.id } } })
    if (error) return toast.error(errorMessage(error))
    toast.success(`Parametro "${p.name}" eliminato`)
    reload()
  }

  async function move(p: CommessaParam, dir: -1 | 1) {
    const i = params.findIndex((x) => x.id === p.id)
    const other = params[i + dir]
    if (!other) return
    await Promise.all([
      api.PATCH('/commessa-params/{param_id}', { params: { path: { param_id: p.id } }, body: { position: other.position } }),
      api.PATCH('/commessa-params/{param_id}', { params: { path: { param_id: other.id } }, body: { position: p.position } }),
    ])
    reload()
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">Amministrazione</span>
          <h1>Parametri commessa</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/projects" className="btn">
            Commesse
          </Link>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + Nuovo parametro
          </button>
        </div>
      </header>
      <div className="content">
        <p className="muted">
          Un parametro è un campo a scelta multipla (o singola) che si compila su ogni commessa, ad esempio "Tipologia lavori" o
          "Procedura". I valori compaiono nella pagina Progetti e servono come filtro.
        </p>
        {loading ? (
          <Loading />
        ) : params.length === 0 ? (
          <div className="empty">Nessun parametro definito. Creane uno con "+ Nuovo parametro".</div>
        ) : (
          <div className="table-wrap">
            <table className="table params-table">
              <thead>
                <tr>
                  <th>Parametro</th>
                  <th>Opzioni</th>
                  <th>Scelta</th>
                  <th className="num">Commesse</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {params.map((p, i) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>
                      <div className="dyn-multi">
                        {p.options.map((o) => (
                          <span key={o} className="chip">
                            {o}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{p.multi ? 'Multipla' : 'Singola'}</td>
                    <td className="num">{p.used_by}</td>
                    <td className="nowrap row-actions">
                      <button className="btn small" onClick={() => move(p, -1)} disabled={i === 0} aria-label="Sposta su">
                        <Icon name="arrow-up" />
                      </button>
                      <button className="btn small" onClick={() => move(p, 1)} disabled={i === params.length - 1} aria-label="Sposta giù">
                        <Icon name="arrow-down" />
                      </button>
                      <button className="btn small" onClick={() => setEditing(p)}>
                        Modifica
                      </button>
                      <button className="btn small btn-danger" onClick={() => remove(p)}>
                        Elimina
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && (
        <Modal title="Nuovo parametro" onClose={() => setCreating(false)} width={520}>
          <ParamForm
            onDone={() => {
              setCreating(false)
              reload()
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal title={`Parametro "${editing.name}"`} onClose={() => setEditing(null)} width={520}>
          <ParamForm
            param={editing}
            onDone={() => {
              setEditing(null)
              reload()
            }}
          />
        </Modal>
      )}
    </>
  )
}

function ParamForm({ param, onDone }: { param?: CommessaParam; onDone: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(param?.name ?? '')
  const [options, setOptions] = useState<string[]>(param?.options ?? [])
  const [draft, setDraft] = useState('')
  const [multi, setMulti] = useState(param?.multi ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function addOption() {
    const v = draft.trim()
    if (!v) return
    if (options.includes(v)) return setError(`"${v}" c'è già`)
    setOptions([...options, v])
    setDraft('')
    setError(null)
  }
  function onDraftKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addOption()
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (options.length === 0) return setError('Aggiungi almeno un\'opzione')
    setBusy(true)
    setError(null)
    const body = { name, options, multi }
    const res = param
      ? await api.PATCH('/commessa-params/{param_id}', { params: { path: { param_id: param.id } }, body })
      : await api.POST('/commessa-params', { body })
    setBusy(false)
    if (res.error) return setError(errorMessage(res.error))
    toast.success(param ? 'Parametro aggiornato' : `Parametro "${name}" creato`)
    onDone()
  }

  const removedInUse = param && param.used_by > 0 && param.options.some((o) => !options.includes(o))

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="prm-name">Nome</label>
        <input id="prm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tipologia lavori" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="prm-opt">Opzioni</label>
        {options.length > 0 && (
          <ul className="option-list">
            {options.map((o) => (
              <li key={o}>
                <span>{o}</span>
                <button type="button" className="btn small" aria-label={`Rimuovi ${o}`} onClick={() => setOptions(options.filter((x) => x !== o))}>
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row option-add">
          <input id="prm-opt" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onDraftKey} placeholder="Nuova opzione, poi Invio" />
          <button type="button" className="btn small" onClick={addOption}>
            Aggiungi
          </button>
        </div>
        {removedInUse && <p className="dyn-help small" style={{ color: 'var(--warn)' }}>Hai tolto opzioni già usate: le commesse che le avevano le perderanno.</p>}
      </div>
      <label className="dyn-check">
        <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
        <span>Consenti più opzioni insieme (scelta multipla)</span>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row form-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Salvataggio…' : param ? 'Salva' : 'Crea parametro'}
        </button>
        <button className="btn" type="button" onClick={onDone}>
          Annulla
        </button>
      </div>
    </form>
  )
}
