import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/useAuth'
import Layout from './components/Layout'
import Loading from './components/Loading'
import LoginPage from './pages/LoginPage'
import ProjectsPage from './pages/ProjectsPage'
import PlansPage from './pages/PlansPage'
import PlanPage from './pages/PlanPage'
import WbsPage from './pages/WbsPage'
import PcqPage from './pages/PcqPage'
import PcqStructurePage from './pages/PcqStructurePage'
import ProjectFormsPage from './pages/ProjectFormsPage'
import TasksPage from './pages/TasksPage'
import DashboardPage from './pages/DashboardPage'
import TemplatesPage from './pages/TemplatesPage'
import TemplatesHubPage from './pages/TemplatesHubPage'
import TemplateChoicesPage from './pages/TemplateChoicesPage'
import TemplateEditorPage from './pages/TemplateEditorPage'
import InvitesPage from './pages/InvitesPage'
import InviteAcceptPage from './pages/InviteAcceptPage'
import UsersPage from './pages/admin/UsersPage'
import InviteLabelsPage from './pages/admin/InviteLabelsPage'
import AuditPage from './pages/admin/AuditPage'
import ParamsPage from './pages/admin/ParamsPage'
import SupportPage from './pages/admin/SupportPage'
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
      {/* pubblica: chi accetta un invito non ha ancora un account */}
      <Route path="/invito/:token" element={<InviteAcceptPage />} />
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
        <Route path="/projects/:projectId/pcq" element={<PcqPage />} />
        <Route path="/projects/:projectId/moduli" element={<ProjectFormsPage />} />
        <Route path="/projects/:projectId/tasks" element={<TasksPage />} />
        <Route path="/projects/:projectId/dashboard" element={<DashboardPage />} />
        <Route path="/templates" element={<TemplatesHubPage />} />
        <Route path="/templates/elenco" element={<TemplatesPage />} />
        <Route path="/templates/scelte" element={<TemplateChoicesPage />} />
        <Route path="/templates/pcq" element={<PcqStructurePage />} />
        <Route path="/templates/:templateId" element={<TemplateEditorPage />} />
        <Route path="/inviti" element={<InvitesPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/etichette" element={<InviteLabelsPage />} />
        <Route path="/admin/audit" element={<AuditPage />} />
        <Route path="/admin/parametri" element={<ParamsPage />} />
        <Route path="/admin/segnalazioni" element={<SupportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
