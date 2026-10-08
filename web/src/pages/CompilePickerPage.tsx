import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { Project } from '../api/types'
import Loading from '../components/Loading'
import { compileUrl } from '../routes'

/**
 * "Compila modulo" dal menu senza un cantiere aperto: si sceglie prima il cantiere
 * (con uno solo si va dritti), poi la compilazione si apre nei Moduli compilati.
 */
export default function CompilePickerPage() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.GET('/projects').then(({ data, error }) => {
      if (error) return setError(errorMessage(error))
      setProjects((data ?? []).sort((a, b) => a.name.localeCompare(b.name)))
    })
  }, [])

  if (projects?.length === 1) return <Navigate to={compileUrl(projects[0].id)} replace />

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">Compila modulo</div>
          <h1>In quale cantiere?</h1>
        </div>
      </header>
      <div className="content">
        {error && <p className="error">{error}</p>}
        {projects === null ? (
          <Loading />
        ) : projects.length === 0 ? (
          <div className="empty">Non fai parte di nessun cantiere: chiedi a un responsabile di aggiungerti.</div>
        ) : (
          <div className="grid">
            {projects.map((p) => (
              <Link key={p.id} to={compileUrl(p.id)} className="card card-link">
                <h2>{p.name}</h2>
                <div className="muted small">{p.address || 'Senza indirizzo'}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
