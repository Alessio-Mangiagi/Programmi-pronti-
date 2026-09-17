import { useEffect, useRef } from 'react'
import { NavLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import { isManager, useAuth } from '../auth/AuthContext'
import Icon from '../components/Icon'
import { NO_COMMESSA, useCommesse } from './CommesseContext'

/**
 * Barra in alto: selezione della commessa e, come sottomenù, i cantieri
 * associati (tab). Aprendo un cantiere da un link diretto la commessa
 * selezionata si allinea a quella del cantiere.
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
  // Sezione corrente del cantiere aperto (plans/tasks/dashboard) da conservare cambiando cantiere
  const section = projectId ? (pathname.split(`/projects/${projectId}/`)[1]?.split('/')[0] ?? 'plans') : 'plans'

  function onSelect(id: string) {
    select(id || null)
    if (!id) return navigate('/projects')
    const list = id === NO_COMMESSA ? orphans : commesse.find((c) => c.id === id)?.projects ?? []
    // con un solo cantiere ci si va diretti, altrimenti alla lista filtrata
    if (list.length === 1) navigate(`/projects/${list[0].id}/${section === 'dashboard' || section === 'tasks' ? section : 'plans'}`)
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
      <nav className="commessa-sub" aria-label="Cantieri della commessa">
        {selectedId ? (
          cantieri.length === 0 ? (
            <span className="muted small">Nessun cantiere {isManager(user) ? '— aggiungilo dalla pagina Progetti' : 'a cui hai accesso'}</span>
          ) : (
            cantieri.map((p) => (
              <NavLink key={p.id} to={`/projects/${p.id}/${section === 'dashboard' || section === 'tasks' ? section : 'plans'}`} className={({ isActive }) => `commessa-tab${isActive || p.id === projectId ? ' active' : ''}`}>
                <Icon name="map-pin" /> {p.name}
              </NavLink>
            ))
          )
        ) : (
          <span className="muted small">Scegli una commessa per vedere i suoi cantieri</span>
        )}
      </nav>
    </div>
  )
}
