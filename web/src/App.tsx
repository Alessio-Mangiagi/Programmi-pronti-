import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import ProjectsPage from './pages/ProjectsPage'
import PlansPage from './pages/PlansPage'

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="content muted">Caricamento…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId/plans" element={<PlansPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
