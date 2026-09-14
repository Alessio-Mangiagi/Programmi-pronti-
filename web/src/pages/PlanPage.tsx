import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { PinSummary, Plan } from '../api/types'
import PlanViewer from '../components/PlanViewer'
import { PIN_LEVEL_LABEL, pinLevel, type PinLevel } from '../components/PinMarker'
import { useProject } from '../hooks/useProject'

const LEGEND: PinLevel[] = ['open', 'assigned', 'resolved', 'verified', 'submission', 'empty']

export default function PlanPage() {
  const { projectId = '', planId = '' } = useParams()
  const project = useProject(projectId)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [pins, setPins] = useState<PinSummary[]>([])
  const [selected, setSelected] = useState<PinSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadPins = useCallback(async () => {
    const { data, error } = await api.GET('/plans/{plan_id}/pins', { params: { path: { plan_id: planId } } })
    if (error) setError(errorMessage(error))
    else setPins(data ?? [])
  }, [planId])

  useEffect(() => {
    api.GET('/plans/{plan_id}', { params: { path: { plan_id: planId } } }).then(({ data, error }) => {
      if (error) setError(errorMessage(error))
      else setPlan(data ?? null)
    })
    loadPins()
  }, [planId, loadPins])

  const counts = pins.reduce<Record<PinLevel, number>>(
    (acc, p) => {
      acc[pinLevel(p)] += 1
      return acc
    },
    { open: 0, assigned: 0, resolved: 0, verified: 0, submission: 0, empty: 0 },
  )

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/projects">Progetti</Link> / <Link to={`/projects/${projectId}/plans`}>{project?.name ?? '…'}</Link>
          </div>
          <h1>{plan?.name ?? 'Planimetria'}</h1>
        </div>
        <div className="legend">
          {LEGEND.map((level) => (
            <span key={level} className="legend-item" title={PIN_LEVEL_LABEL[level]}>
              <span className={`legend-dot pin-${level}`} />
              {counts[level]}
            </span>
          ))}
          <span className="muted small">{pins.length} pin</span>
        </div>
      </header>
      <div className="plan-page">
        {error && <p className="error">{error}</p>}
        {plan && <PlanViewer plan={plan} pins={pins} selectedId={selected?.id} onSelectPin={setSelected} />}
        {selected && (
          <div className="pin-tooltip card">
            <strong>{selected.label ?? 'Pin'}</strong>
            <div className="muted small">{PIN_LEVEL_LABEL[pinLevel(selected)]}</div>
            <div className="small">
              {selected.submissions_count} moduli · {selected.tasks_open + selected.tasks_assigned} task attivi ·{' '}
              {selected.tasks_resolved + selected.tasks_verified} chiusi
            </div>
            <button className="btn small" onClick={() => setSelected(null)}>
              Chiudi
            </button>
          </div>
        )}
      </div>
    </>
  )
}
