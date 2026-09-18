import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import Layout from './components/Layout'
import Loading from './components/Loading'
import LoginPage from './pages/LoginPage'
import ProjectsPage from './pages/ProjectsPage'
import PlansPage from './pages/PlansPage'
import PlanPage from './pages/PlanPage'
import WbsPage from './pages/WbsPage'
import TasksPage from './pages/TasksPage'
import DashboardPage from './pages/DashboardPage'
import TemplatesPage from './pages/TemplatesPage'
import TemplatesHubPage from './pages/TemplatesHubPage'
import TemplateChoicesPage from './pages/TemplateChoicesPage'
import TemplateEditorPage from './pages/TemplateEditorPage'
import UsersPage from './pages/admin/UsersPage'
import AuditPage from './pages/admin/AuditPage'
import ParamsPage from './pages/admin/ParamsPage'
import { CommesseProvider } from './commesse/CommesseContext'

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth()
  if (loading) return <Loading className="content" />
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
            <CommesseProvider>
              <Layout />
            </CommesseProvider>
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId/plans" element={<PlansPage />} />
        <Route path="/projects/:projectId/plans/:planId" element={<PlanPage />} />
        <Route path="/projects/:projectId/wbs" element={<WbsPage />} />
        <Route path="/projects/:projectId/tasks" element={<TasksPage />} />
        <Route path="/projects/:projectId/dashboard" element={<DashboardPage />} />
        <Route path="/templates" element={<TemplatesHubPage />} />
        <Route path="/templates/elenco" element={<TemplatesPage />} />
        <Route path="/templates/scelte" element={<TemplateChoicesPage />} />
        <Route path="/templates/:templateId" element={<TemplateEditorPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/audit" element={<AuditPage />} />
        <Route path="/admin/parametri" element={<ParamsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
