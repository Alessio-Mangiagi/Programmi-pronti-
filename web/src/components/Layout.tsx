import { NavLink, Outlet, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useProject } from '../hooks/useProject'

const ROLE_LABEL: Record<string, string> = { admin: 'Amministratore', manager: 'Ufficio', field: 'Cantiere' }

export default function Layout() {
  const { user, logout } = useAuth()
  const { projectId } = useParams()
  const project = useProject(projectId)

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">FV</span> Field View
        </div>
        <nav className="nav">
          <NavLink to="/projects" end>
            Progetti
          </NavLink>
          {projectId && (
            <>
              <div className="nav-section" title={project?.name}>
                {project?.name ?? 'Progetto'}
              </div>
              <NavLink to={`/projects/${projectId}/plans`}>Planimetrie</NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <div>{user?.name}</div>
          <div className="muted small">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</div>
          <button className="btn" onClick={logout}>
            Esci
          </button>
        </div>
      </aside>
      <div className="main">
        <Outlet />
      </div>
    </div>
  )
}
