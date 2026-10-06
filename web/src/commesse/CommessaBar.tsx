import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { isManager, useAuth } from '../auth/useAuth'
import { NO_COMMESSA } from './CommesseContext'
import { useCommesse } from './useCommesse'

/**
 * Barra in alto: due menù affiancati, la commessa e i suoi cantieri.
 * Aprendo un cantiere da un link diretto la commessa selezionata si
 * allinea a quella del cantiere.
 */
export default function CommessaBar() {
  const { user } = useAuth()
  const { commesse, orphans, loading, selectedId, select } = useCommesse()
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Riallinea la selezione al cantiere aperto: solo quando cambia il cantiere (non
  // quando l'utente sceglie un'altra commessa dalla barra restando sulla pagina).
  const aligned = useRef<string | null>(null)
  useEffect(() => {
    if (!projectId || loading || aligned.current === projectId) return
    const owner = commesse.find((c) => c.projects.some((p) => p.id === projectId))
    const next = owner ? owner.id : orphans.some((p) => p.id === projectId) ? NO_COMMESSA : null
    if (!next) return
    aligned.current = projectId
    if (next !== selectedId) select(next)
  }, [projectId, loading, commesse, orphans, selectedId, select])

  const selected = selectedId === NO_COMMESSA ? null : commesse.find((c) => c.id === selectedId) ?? null
  const cantieri = selectedId === NO_COMMESSA ? orphans : (selected?.projects ?? [])
  const section = projectId ? (pathname.split(`/projects/${projectId}/`)[1]?.split('/')[0] ?? 'plans') : 'plans'

  // Sezione da mantenere cambiando cantiere: dashboard/task/wbs restano, il resto va alle planimetrie
  const target = (id: string) => `/projects/${id}/${['dashboard', 'tasks', 'wbs'].includes(section) ? section : 'plans'}`
  const current = cantieri.some((p) => p.id === projectId) ? projectId : ''

  function onSelect(id: string) {
    select(id || null)
    if (!id) return navigate('/projects')
    const list = id === NO_COMMESSA ? orphans : commesse.find((c) => c.id === id)?.projects ?? []
    // con un solo cantiere ci si va diretti, altrimenti alla lista filtrata
    if (list.length === 1) navigate(target(list[0].id))
    else navigate(`/projects?commessa=${id}`)
  }

  return (
    <div className="commessa-bar" data-testid="commessa-bar">
      <div className="commessa-select">
        <label className="filter-label" htmlFor="commessa-sel">
          Commessa
        </label>
        <select id="commessa-sel" value={selectedId ?? ''} onChange={(e) => onSelect(e.target.value)} disabled={loading}>
          <option value="">Tutte le commesse</option>
          {commesse.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.name}
            </option>
          ))}
          {orphans.length > 0 && <option value={NO_COMMESSA}>Cantieri senza commessa ({orphans.length})</option>}
        </select>
        {selected?.client && <span className="muted small commessa-client">{selected.client}</span>}
      </div>
      <div className="commessa-select commessa-cantiere">
        <label className="filter-label" htmlFor="cantiere-sel">
          Cantiere
        </label>
        <select
          id="cantiere-sel"
          value={current ?? ''}
          onChange={(e) => e.target.value && navigate(target(e.target.value))}
          disabled={loading || !selectedId || cantieri.length === 0}
          aria-label="Cantieri della commessa"
        >
          <option value="">
            {!selectedId
              ? 'Scegli prima una commessa'
              : cantieri.length === 0
                ? `Nessun cantiere${isManager(user) ? ' — aggiungilo dalla pagina Progetti' : ''}`
                : `Scegli un cantiere (${cantieri.length})`}
          </option>
          {cantieri.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
