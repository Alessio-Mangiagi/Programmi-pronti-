import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { Project } from '../api/types'
import { isManager, useAuth } from '../auth/AuthContext'
import Loading from '../components/Loading'

export default function ProjectsPage() {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')

  async function load() {
    const { data, error } = await api.GET('/projects')
    if (error) setError(errorMessage(error))
    else setProjects(data ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    const { error } = await api.POST('/projects', { body: { name, address: address || null } })
    if (error) return setError(errorMessage(error))
    setName('')
    setAddress('')
    setCreating(false)
    load()
  }

  return (
    <>
      <header className="topbar">
        <h1>Progetti</h1>
        {isManager(user) && (
          <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Annulla' : '+ Nuovo progetto'}
          </button>
        )}
      </header>
      <div className="content">
        {creating && (
          <form className="card" style={{ marginBottom: '1rem', maxWidth: 520 }} onSubmit={onCreate}>
            <div className="field">
              <label htmlFor="pname">Nome</label>
              <input id="pname" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="field">
              <label htmlFor="paddr">Indirizzo</label>
              <input id="paddr" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <button className="btn btn-primary" type="submit">
              Crea
            </button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
        {projects === null ? (
          <Loading />
        ) : projects.length === 0 ? (
          <div className="empty">Nessun progetto. {isManager(user) ? 'Creane uno.' : 'Chiedi a un responsabile di aggiungerti.'}</div>
        ) : (
          <div className="grid">
            {projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}/plans`} className="card card-link">
                <h2>{p.name}</h2>
                <div className="muted small">{p.address ?? '—'}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
