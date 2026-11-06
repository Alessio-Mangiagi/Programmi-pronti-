// "><(((º> sabusabu <º)))><"
// Persone del cantiere (/projects/:projectId/persone): chi ne fa parte e, per admin e manager del cantiere,
// "Iscrivi" un utente che esiste già e "Togli" una persona. Prima mancava dal web: un utente già registrato
// non si poteva aggiungere a un altro cantiere (l'invito rifiuta le email già registrate). API:
// GET/POST /projects/{id}/members, DELETE /projects/{id}/members/{user_id} (il server ricontrolla i permessi
// e scrive "Membro aggiunto/rimosso" nel registro operazioni).
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { User } from '../api/types'
import { isManager, useAuth } from '../auth/useAuth'
import Loading from '../components/Loading'
import { useToast } from '../components/useToast'
import { useLoad } from '../hooks/useLoad'
import { useProject } from '../hooks/useProject'
import { ROLE_LABEL } from '../labels'

export default function ProjectMembersPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const project = useProject(projectId)
  const canManage = isManager(user)
  const [members, setMembers] = useState<User[] | null>(null)
  const [everyone, setEveryone] = useState<User[]>([])
  const [error, setError] = useState<string | null>(null)
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error: err } = await api.GET('/projects/{project_id}/members', { params: { path: { project_id: projectId } } })
    if (err) return setError(errorMessage(err))
    setMembers(data ?? [])
    if (canManage) {
      // utenti attivi: l'elenco completo serve solo a chi può iscriverli
      const { data: users } = await api.GET('/users')
      setEveryone(users ?? [])
    }
  }, [projectId, canManage])
  useLoad(load)

  const memberIds = useMemo(() => new Set((members ?? []).map((m) => m.id)), [members])
  const candidates = everyone.filter((u) => !memberIds.has(u.id))

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!choice) return
    setBusy(true)
    const { data, error: err } = await api.POST('/projects/{project_id}/members', {
      params: { path: { project_id: projectId } },
      body: { user_id: choice },
    })
    setBusy(false)
    if (err || !data) return toast.error(errorMessage(err))
    const who = everyone.find((u) => u.id === choice)
    toast.success(`${who?.name ?? 'Utente'} iscritto al cantiere`)
    setMembers(data)
    setChoice('')
  }

  async function remove(m: User) {
    if (!window.confirm(`Togliere ${m.name} dal cantiere? I suoi pin, moduli e task restano.`)) return
    const { error: err } = await api.DELETE('/projects/{project_id}/members/{user_id}', {
      params: { path: { project_id: projectId, user_id: m.id } },
    })
    if (err) return toast.error(errorMessage(err))
    toast.success(`${m.name} tolto dal cantiere`)
    load()
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/projects">Progetti</Link> / {project?.name ?? '…'}
          </div>
          <h1>Persone</h1>
        </div>
      </header>
      <div className="content">
        {error && <p className="error">{error}</p>}
        {canManage && (
          <form className="row" onSubmit={add} style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            <select id="pm-user" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Utente da iscrivere"
                    style={{ maxWidth: 520 }}>
              <option value="">— scegli un utente già registrato —</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.email} · {ROLE_LABEL[u.role] ?? u.role}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" type="submit" disabled={!choice || busy}>
              {busy ? 'Iscrizione…' : 'Iscrivi al cantiere'}
            </button>
            <span className="muted small">
              Chi non ha ancora un account si invita da <Link to="/inviti">Inviti</Link>.
            </span>
          </form>
        )}
        {members === null ? (
          !error && <Loading />
        ) : members.length === 0 ? (
          <div className="empty">Nessuna persona iscritta.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>Ruolo</th>
                  {canManage && <th aria-label="Azioni" />}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.email}</td>
                    <td>{ROLE_LABEL[m.role] ?? m.role}</td>
                    {canManage && (
                      <td>
                        <button className="btn small" type="button" onClick={() => remove(m)}>
                          Togli
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          Gli amministratori vedono tutti i cantieri anche senza essere iscritti; ufficio e cantiere vedono solo quelli in
          cui compaiono qui.
        </p>
      </div>
    </>
  )
}
