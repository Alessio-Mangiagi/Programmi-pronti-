import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, errorMessage } from '../../api/client'
import type { components } from '../../api/schema'
import type { User } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import Loading from '../../components/Loading'
import Modal from '../../components/Modal'
import { useToast } from '../../components/useToast'
import { ROLE_LABEL } from '../../labels'
import { useLoad } from '../../hooks/useLoad'

type Activity = components['schemas']['UserActivityOut']
type Role = 'admin' | 'manager' | 'field'

const ROLES: Role[] = ['admin', 'manager', 'field']

const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—'

/**
 * Spazio admin → Utenti: elenco con ruolo, stato, ultimo accesso e operazioni;
 * creazione, modifica (nome/ruolo), reset password, disattivazione/riattivazione.
 * Ogni azione finisce nel registro operazioni (`/admin/audit`).
 */
export default function UsersPage() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState<User[] | null>(null)
  const [activity, setActivity] = useState<Record<string, Activity>>({})
  const [q, setQ] = useState('')
  const [role, setRole] = useState<'' | Role>('')
  const [showInactive, setShowInactive] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)

  const load = useCallback(async () => {
    const [u, a] = await Promise.all([
      api.GET('/users', { params: { query: { include_inactive: true } } }),
      api.GET('/users/activity'),
    ])
    if (u.error) return toast.error(errorMessage(u.error))
    setUsers(u.data ?? [])
    if (a.data) setActivity(Object.fromEntries(a.data.map((x) => [x.user_id, x])))
  }, [toast])

  useLoad(load)

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (users ?? []).filter(
      (u) =>
        (showInactive || u.is_active) &&
        (!role || u.role === role) &&
        (!needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)),
    )
  }, [users, q, role, showInactive])

  if (me?.role !== 'admin') return <Navigate to="/projects" replace />

  async function setActive(u: User, is_active: boolean) {
    if (!is_active && !window.confirm(`Disattivare ${u.name}? Non potrà più accedere; i suoi dati restano.`)) return
    const { error } = await api.PATCH('/users/{user_id}', { params: { path: { user_id: u.id } }, body: { is_active } })
    if (error) return toast.error(errorMessage(error))
    toast.success(is_active ? `${u.name} riattivato` : `${u.name} disattivato`)
    load()
  }

  const counts = { total: users?.length ?? 0, active: users?.filter((u) => u.is_active).length ?? 0 }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">Amministrazione</span>
          <h1>Utenti</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/admin/audit" className="btn">
            Registro operazioni
          </Link>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + Nuovo utente
          </button>
        </div>
      </header>
      <div className="filters">
        <div className="filter-group">
          <label className="filter-label" htmlFor="uq">
            Cerca
          </label>
          <input id="uq" placeholder="Nome o email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="urole">
            Ruolo
          </label>
          <select id="urole" value={role} onChange={(e) => setRole(e.target.value as '' | Role)}>
            <option value="">Tutti</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <label className="dyn-check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          <span className="small">Mostra disattivati</span>
        </label>
        <div className="filter-group filter-summary">
          <span className="muted small">
            {counts.active} attivi su {counts.total}
          </span>
        </div>
      </div>
      <div className="content">
        {users === null ? (
          <Loading />
        ) : visible.length === 0 ? (
          <div className="empty">Nessun utente corrisponde ai filtri.</div>
        ) : (
          <div className="table-wrap">
            <table className="table users-table">
              <thead>
                <tr>
                  <th>Utente</th>
                  <th>Ruolo</th>
                  <th>Stato</th>
                  <th>Ultimo accesso</th>
                  <th className="num">Operazioni (30 gg)</th>
                  <th className="num">Totale</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => {
                  const a = activity[u.id]
                  return (
                    <tr key={u.id} className={u.is_active ? undefined : 'row-muted'}>
                      <td>
                        <strong>{u.name}</strong>
                        {u.id === me.id && <span className="badge">tu</span>}
                        <div className="muted small">{u.email}</div>
                      </td>
                      <td>
                        <span className={`badge role-${u.role}`}>{ROLE_LABEL[u.role] ?? u.role}</span>
                      </td>
                      <td>
                        {u.is_active ? <span className="badge status-resolved">Attivo</span> : <span className="badge status-open">Disattivato</span>}
                      </td>
                      <td className="nowrap">{fmtDateTime(a?.last_login)}</td>
                      <td className="num">{a?.actions_last_30d ?? 0}</td>
                      <td className="num">{a?.actions_total ?? 0}</td>
                      <td className="nowrap row-actions">
                        <Link className="btn small" to={`/admin/audit?actor=${u.id}`} title="Operazioni di questo utente">
                          Attività
                        </Link>
                        <button className="btn small" onClick={() => setEditing(u)}>
                          Modifica
                        </button>
                        <button className="btn small" onClick={() => setResetting(u)}>
                          Password
                        </button>
                        {u.id !== me.id &&
                          (u.is_active ? (
                            <button className="btn small btn-danger" onClick={() => setActive(u, false)}>
                              Disattiva
                            </button>
                          ) : (
                            <button className="btn small" onClick={() => setActive(u, true)}>
                              Riattiva
                            </button>
                          ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <Modal title="Nuovo utente" onClose={() => setCreating(false)} width={480}>
          <UserForm
            onDone={() => {
              setCreating(false)
              load()
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal title={`Modifica ${editing.name}`} onClose={() => setEditing(null)} width={480}>
          <UserForm
            user={editing}
            isSelf={editing.id === me.id}
            onDone={() => {
              setEditing(null)
              load()
            }}
          />
        </Modal>
      )}
      {resetting && (
        <Modal title={`Nuova password per ${resetting.name}`} onClose={() => setResetting(null)} width={420}>
          <PasswordForm
            user={resetting}
            onDone={() => {
              setResetting(null)
              load()
            }}
          />
        </Modal>
      )}
    </>
  )
}

function UserForm({ user, isSelf, onDone }: { user?: User; isSelf?: boolean; onDone: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [role, setRole] = useState<Role>((user?.role as Role) ?? 'field')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = user
      ? await api.PATCH('/users/{user_id}', { params: { path: { user_id: user.id } }, body: { name, role } })
      : await api.POST('/users', { body: { name, email, role, password } })
    setBusy(false)
    if (res.error) return setError(errorMessage(res.error))
    toast.success(user ? 'Utente aggiornato' : `Utente ${name} creato`)
    onDone()
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="uf-name">Nome e cognome</label>
        <input id="uf-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="uf-email">Email (login)</label>
        <input id="uf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!!user} />
        {user && <p className="muted small dyn-help">L'email non si cambia: crea un nuovo utente e disattiva questo.</p>}
      </div>
      <div className="field">
        <label htmlFor="uf-role">Ruolo</label>
        <select id="uf-role" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        {isSelf && <p className="muted small dyn-help">Non puoi cambiare il tuo ruolo.</p>}
      </div>
      {!user && (
        <div className="field">
          <label htmlFor="uf-pass">Password iniziale (min. 8 caratteri)</label>
          <input id="uf-pass" type="text" autoComplete="off" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row form-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Salvataggio…' : user ? 'Salva' : 'Crea utente'}
        </button>
        <button className="btn" type="button" onClick={onDone}>
          Annulla
        </button>
      </div>
    </form>
  )
}

function PasswordForm({ user, onDone }: { user: User; onDone: () => void }) {
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await api.PATCH('/users/{user_id}', { params: { path: { user_id: user.id } }, body: { password } })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    toast.success(`Password di ${user.name} reimpostata`)
    onDone()
  }

  return (
    <form onSubmit={submit}>
      <p className="muted small">Comunica la nuova password all'utente di persona. L'operazione viene registrata.</p>
      <div className="field">
        <label htmlFor="pw-new">Nuova password (min. 8 caratteri)</label>
        <input id="pw-new" type="text" autoComplete="off" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row form-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Salvataggio…' : 'Reimposta'}
        </button>
        <button className="btn" type="button" onClick={onDone}>
          Annulla
        </button>
      </div>
    </form>
  )
}
