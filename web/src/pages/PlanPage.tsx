import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { PinSummary, Plan, User } from '../api/types'
import { isManager, useAuth } from '../auth/AuthContext'
import PlanViewer from '../components/PlanViewer'
import PinPanel from '../components/PinPanel'
import PinFilters, {
  EMPTY_FILTERS,
  filtersFromSearch,
  filtersToQuery,
  filtersToSearch,
  isFiltering,
  type PinFilterState,
} from '../components/PinFilters'
import PlanUploadForm from '../components/PlanUploadForm'
import { PIN_LEVEL_LABEL, pinLevel, type PinLevel } from '../components/PinMarker'
import { useLookups } from '../hooks/useLookups'
import { useProject } from '../hooks/useProject'

const LEGEND: PinLevel[] = ['open', 'assigned', 'resolved', 'verified', 'submission', 'empty']

/** Il `key` sul planId azzera tutto lo stato (pin, selezione, modalità) quando si cambia planimetria. */
export default function PlanPage() {
  const { projectId = '', planId = '' } = useParams()
  return <PlanView key={planId} projectId={projectId} planId={planId} />
}

function PlanView({ projectId, planId }: { projectId: string; planId: string }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const project = useProject(projectId)
  const lookups = useLookups()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearch(searchParams), [searchParams])
  const filtering = isFiltering(filters)

  const [plans, setPlans] = useState<Plan[]>([])
  const [members, setMembers] = useState<User[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [allPins, setAllPins] = useState<PinSummary[] | null>(null)
  const [filteredPins, setFilteredPins] = useState<PinSummary[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addMode, setAddMode] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dati di progetto: lista planimetrie (per il selettore) e membri (per il filtro assegnatario).
  useEffect(() => {
    api.GET('/projects/{project_id}/plans', { params: { path: { project_id: projectId } } }).then(({ data }) => {
      if (data) setPlans(data)
    })
    api.GET('/projects/{project_id}/members', { params: { path: { project_id: projectId } } }).then(({ data }) => {
      if (data) setMembers(data)
    })
  }, [projectId])

  // Tutti i pin (totale e legenda) + i pin filtrati, se c'è un filtro attivo.
  const loadPins = useCallback(async () => {
    const [all, filtered] = await Promise.all([
      api.GET('/plans/{plan_id}/pins', { params: { path: { plan_id: planId } } }),
      filtering
        ? api.GET('/plans/{plan_id}/pins', { params: { path: { plan_id: planId }, query: filtersToQuery(filters) } })
        : Promise.resolve(null),
    ])
    if (all.error) return setError(errorMessage(all.error))
    setAllPins(all.data ?? [])
    if (filtered?.error) return setError(errorMessage(filtered.error))
    setFilteredPins(filtered ? (filtered.data ?? []) : null)
  }, [planId, filters, filtering])

  useEffect(() => {
    api.GET('/plans/{plan_id}', { params: { path: { plan_id: planId } } }).then(({ data, error }) => {
      if (error) setError(errorMessage(error))
      else setPlan(data ?? null)
    })
  }, [planId])

  useEffect(() => {
    loadPins()
  }, [loadPins])

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

  function setFilters(next: PinFilterState) {
    setSearchParams(filtersToSearch(next), { replace: true })
  }

  function switchPlan(id: string) {
    // i filtri restano nella query string: utile per confrontare più piani con lo stesso filtro
    navigate({ pathname: `/projects/${projectId}/plans/${id}`, search: searchParams.toString() })
  }

  async function addPin(x: number, y: number) {
    const { data, error } = await api.POST('/pins', { body: { plan_id: planId, x, y, label: null } })
    if (error) return setError(errorMessage(error))
    setAddMode(false)
    // un pin appena creato è vuoto e non passerebbe i filtri: li azzeriamo per mostrarlo
    if (filtering) setFilters(EMPTY_FILTERS)
    else await loadPins()
    if (data) setSelectedId(data.id)
  }

  async function movePin(pin: PinSummary, x: number, y: number) {
    // aggiornamento ottimistico: il marker resta dove è stato lasciato
    const move = (list: PinSummary[] | null) => list && list.map((p) => (p.id === pin.id ? { ...p, x, y } : p))
    setAllPins(move)
    setFilteredPins(move)
    const { error } = await api.PATCH('/pins/{pin_id}', { params: { path: { pin_id: pin.id } }, body: { x, y } })
    if (error) {
      setError(errorMessage(error))
      loadPins()
    }
  }

  function onUploaded(updated: Plan) {
    setPlan(updated)
    setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  const pins = (filtering ? filteredPins : allPins) ?? []
  const counts = pins.reduce<Record<PinLevel, number>>(
    (acc, p) => {
      acc[pinLevel(p)] += 1
      return acc
    },
    { open: 0, assigned: 0, resolved: 0, verified: 0, submission: 0, empty: 0 },
  )
  const templates = useMemo(
    () => Object.values(lookups.templates).sort((a, b) => a.name.localeCompare(b.name)),
    [lookups.templates],
  )
  const canUpload = isManager(user)

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/projects">Progetti</Link> / <Link to={`/projects/${projectId}/plans`}>{project?.name ?? '…'}</Link>
          </div>
          {plans.length > 1 ? (
            <select className="plan-switch" value={planId} onChange={(e) => switchPlan(e.target.value)} aria-label="Planimetria">
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.file_url ? '' : ' (senza file)'}
                </option>
              ))}
            </select>
          ) : (
            <h1>{plan?.name ?? 'Planimetria'}</h1>
          )}
        </div>
        <div className="topbar-actions">
          <div className="legend">
            {LEGEND.map((level) => (
              <span key={level} className="legend-item" title={PIN_LEVEL_LABEL[level]}>
                <span className={`legend-dot pin-${level}`} />
                {counts[level]}
              </span>
            ))}
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
      {plan?.file_url && (
        <PinFilters
          value={filters}
          onChange={setFilters}
          templates={templates}
          members={members}
          shown={pins.length}
          total={allPins ? allPins.length : null}
        />
      )}
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
          {plan && !plan.file_url && canUpload ? (
            <div className="content">
              <PlanUploadForm projectId={projectId} plan={plan} onDone={onUploaded} />
            </div>
          ) : plan ? (
            <PlanViewer
              key={plan.id}
              plan={plan}
              pins={pins}
              selectedId={selectedId}
              addMode={addMode}
              editable
              onSelectPin={(p) => setSelectedId(p.id)}
              onAddAt={addPin}
              onMovePin={movePin}
            />
          ) : (
            !error && <div className="plan-viewer-empty">Caricamento…</div>
          )}
          {selectedId && (
            <PinPanel pinId={selectedId} lookups={lookups} onClose={() => setSelectedId(null)} onChanged={loadPins} />
          )}
        </div>
      </div>
    </>
  )
}
