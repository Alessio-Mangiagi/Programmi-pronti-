import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { Plan } from '../api/types'
import { isManager, useAuth } from '../auth/useAuth'
import AuthImage from '../components/AuthImage'
import Loading from '../components/Loading'
import PlanUploadForm from '../components/PlanUploadForm'
import { useToast } from '../components/useToast'
import { useProject } from '../hooks/useProject'

export default function PlansPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const toast = useToast()
  const project = useProject(projectId)
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

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
        {isManager(user) && (
          <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Annulla' : '+ Nuova planimetria'}
          </button>
        )}
      </header>
      <div className="content">
        {creating && (
          <PlanUploadForm
            projectId={projectId}
            onCancel={() => setCreating(false)}
            onDone={(plan) => {
              toast.success(`Planimetria "${plan.name}" caricata`)
              navigate(`/projects/${projectId}/plans/${plan.id}`)
            }}
          />
        )}
        {error && <p className="error">{error}</p>}
        {plans === null ? (
          <Loading />
        ) : plans.length === 0 ? (
          <div className="empty">
            Nessuna planimetria.{' '}
            {isManager(user) ? 'Caricane una con "+ Nuova planimetria".' : 'Chiedi a un responsabile di caricarne una.'}
          </div>
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
