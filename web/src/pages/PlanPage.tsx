import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { PinSummary, Plan } from '../api/types'
import PlanViewer from '../components/PlanViewer'
import PinPanel from '../components/PinPanel'
import { PIN_LEVEL_LABEL, pinLevel, type PinLevel } from '../components/PinMarker'
import { useLookups } from '../hooks/useLookups'
import { useProject } from '../hooks/useProject'

const LEGEND: PinLevel[] = ['open', 'assigned', 'resolved', 'verified', 'submission', 'empty']

export default function PlanPage() {
  const { projectId = '', planId = '' } = useParams()
  const project = useProject(projectId)
  const lookups = useLookups()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [pins, setPins] = useState<PinSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addMode, setAddMode] = useState(false)
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

  // Esc chiude la modalità aggiungi / il pannello
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (addMode) setAddMode(false)
      else setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addMode])

  async function addPin(x: number, y: number) {
    const { data, error } = await api.POST('/pins', { body: { plan_id: planId, x, y, label: null } })
    if (error) return setError(errorMessage(error))
    setAddMode(false)
    await loadPins()
    if (data) setSelectedId(data.id)
  }

  async function movePin(pin: PinSummary, x: number, y: number) {
    // aggiornamento ottimistico: il marker resta dove è stato lasciato
    setPins((prev) => prev.map((p) => (p.id === pin.id ? { ...p, x, y } : p)))
    const { error } = await api.PATCH('/pins/{pin_id}', { params: { path: { pin_id: pin.id } }, body: { x, y } })
    if (error) {
      setError(errorMessage(error))
      loadPins()
    }
  }

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
        <div className="topbar-actions">
          <div className="legend">
            {LEGEND.map((level) => (
              <span key={level} className="legend-item" title={PIN_LEVEL_LABEL[level]}>
                <span className={`legend-dot pin-${level}`} />
                {counts[level]}
              </span>
            ))}
            <span className="muted small">{pins.length} pin</span>
          </div>
          {plan?.file_url && (
            <button
              className={`btn ${addMode ? '' : 'btn-primary'}`}
              onClick={() => {
                setAddMode((v) => !v)
                setSelectedId(null)
              }}
            >
              {addMode ? 'Annulla' : '+ Aggiungi pin'}
            </button>
          )}
        </div>
      </header>
      <div className="plan-page">
        {error && (
          <p className="error">
            {error}{' '}
            <button className="btn small" onClick={() => setError(null)}>
              ok
            </button>
          </p>
        )}
        <div className="plan-split">
          {plan && (
            <PlanViewer
              plan={plan}
              pins={pins}
              selectedId={selectedId}
              addMode={addMode}
              editable
              onSelectPin={(p) => setSelectedId(p.id)}
              onAddAt={addPin}
              onMovePin={movePin}
            />
          )}
          {selectedId && (
            <PinPanel pinId={selectedId} lookups={lookups} onClose={() => setSelectedId(null)} onChanged={loadPins} />
          )}
        </div>
      </div>
    </>
  )
}
