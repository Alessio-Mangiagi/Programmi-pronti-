import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { Plan } from '../api/types'
import AuthImage from '../components/AuthImage'
import { useProject } from '../hooks/useProject'

export default function PlansPage() {
  const { projectId = '' } = useParams()
  const project = useProject(projectId)
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.GET('/projects/{project_id}/plans', { params: { path: { project_id: projectId } } }).then(({ data, error }) => {
      if (error) setError(errorMessage(error))
      else setPlans(data ?? [])
    })
  }, [projectId])

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/projects">Progetti</Link> / {project?.name ?? '…'}
          </div>
          <h1>Planimetrie</h1>
        </div>
      </header>
      <div className="content">
        {error && <p className="error">{error}</p>}
        {plans === null ? (
          <p className="muted">Caricamento…</p>
        ) : plans.length === 0 ? (
          <div className="empty">Nessuna planimetria. Il caricamento arriva al giorno 9.</div>
        ) : (
          <div className="grid">
            {plans.map((plan) => (
              <Link key={plan.id} to={`/projects/${projectId}/plans/${plan.id}`} className="card card-link">
                <AuthImage fileUrl={plan.file_url} className="thumb" alt={plan.name} />
                <h2>{plan.name}</h2>
                <div className="muted small">
                  {plan.width_px && plan.height_px ? `${plan.width_px} × ${plan.height_px} px` : 'File non caricato'}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
