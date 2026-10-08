import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import { isManager, useAuth } from '../auth/useAuth'
import { useProject } from '../hooks/useProject'
import CommessaBar from '../commesse/CommessaBar'
import ContactAdmin from './ContactAdmin'
import Icon from './Icon'

const ROLE_LABEL: Record<string, string> = { admin: 'Amministratore', manager: 'Ufficio', field: 'Cantiere' }

export default function Layout() {
  const { user, logout } = useAuth()
  const { projectId } = useParams()
  const location = useLocation()
  const mine = new URLSearchParams(location.search).get('mine') === '1'
  const newTemplate = location.pathname === '/templates/new'
  const project = useProject(projectId)

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">FV</span>
          <span>
            InCampo
            <span className="brand-sub">Cosedil S.p.A.</span>
          </span>
        </div>
        <nav className="nav">
          <NavLink to="/projects" end>
            Progetti
          </NavLink>
          {isManager(user) && (
            <>
              <NavLink to="/templates" className={({ isActive }) => (isActive && !newTemplate ? 'active' : '')}>
                Moduli
              </NavLink>
              <NavLink to="/templates/new" className="nav-new">
                <Icon name="plus" /> Nuovo modulo
              </NavLink>
            </>
          )}
          {isManager(user) && <NavLink to="/inviti">Inviti</NavLink>}
          {user?.role === 'admin' && (
            <>
              <div className="nav-section">Amministrazione</div>
              <NavLink to="/admin/users">Utenti</NavLink>
              <NavLink to="/admin/segnalazioni">Segnalazioni</NavLink>
              <NavLink to="/admin/audit">Registro operazioni</NavLink>
              <NavLink to="/admin/parametri">Parametri commessa</NavLink>
              <NavLink to="/admin/etichette">Etichette invito</NavLink>
            </>
          )}
          {projectId && (
            <>
              <div className="nav-section" title={project?.name}>
                {project?.name ?? 'Progetto'}
              </div>
              <NavLink to={`/projects/${projectId}/dashboard`}>Dashboard</NavLink>
              <NavLink to={`/projects/${projectId}/plans`}>Planimetrie</NavLink>
              <NavLink to={`/projects/${projectId}/wbs`}>WBS</NavLink>
              <NavLink to={`/projects/${projectId}/moduli`}>Moduli compilati</NavLink>
              {isManager(user) && <NavLink to={`/projects/${projectId}/pcq`}>PCQ</NavLink>}
              <NavLink to={`/projects/${projectId}/tasks`} end className={({ isActive }) => (isActive && !mine ? 'active' : '')}>
                Task
              </NavLink>
              <NavLink to={`/projects/${projectId}/tasks?mine=1`} className={({ isActive }) => (isActive && mine ? 'active' : '')}>
                I miei task
              </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <div>{user?.name}</div>
          <div className="muted small">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</div>
          {user?.role !== 'admin' && <ContactAdmin projectId={projectId} projectName={project?.name} />}
          <button className="btn" onClick={logout}>
            Esci
          </button>
        </div>
      </aside>
      <div className="main">
        <CommessaBar />
        <Outlet />
      </div>
    </div>
  )
}
