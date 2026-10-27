// "><(((º> sabusabu <º)))><"
import { lazy, Suspense } from "react";
import { Link as RouterLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Breadcrumbs, LinearProgress, Link, Stack, Tab, Tabs, Typography } from "@mui/material";
import { api, ApiError, Project } from "../api";
import { FolderView } from "./project/Folder";
import { ReportMenu } from "../components/ReportMenu";

// Le schede diverse da Cartelle si caricano quando si aprono: il bundle iniziale resta leggero.
const AreasTab = lazy(() => import("./project/Areas").then((m) => ({ default: m.AreasTab })));
const PrivateAreasTab = lazy(() => import("./project/PrivateAreas").then((m) => ({ default: m.PrivateAreasTab })));
const AuditTab = lazy(() => import("./project/Audit").then((m) => ({ default: m.AuditTab })));
const DashboardTab = lazy(() => import("./project/Dashboard").then((m) => ({ default: m.DashboardTab })));
const RfisTab = lazy(() => import("./project/Rfis").then((m) => ({ default: m.RfisTab })));
const TransmittalsTab = lazy(() => import("./project/Transmittals").then((m) => ({ default: m.TransmittalsTab })));
const WorkflowsTab = lazy(() => import("./project/Workflows").then((m) => ({ default: m.WorkflowsTab })));
const MembersTab = lazy(() => import("./project/Members").then((m) => ({ default: m.MembersTab })));
const OrganizationsTab = lazy(() => import("./project/Organizations").then((m) => ({ default: m.OrganizationsTab })));
const RolesTab = lazy(() => import("./project/Roles").then((m) => ({ default: m.RolesTab })));
const NamingTab = lazy(() => import("./project/Naming").then((m) => ({ default: m.NamingTab })));

const TABS = [
  { path: "cartelle", label: "Cartelle" },
  { path: "documenti", label: "Aree CDE" },
  { path: "riservate", label: "Aree riservate" },
  { path: "rfi", label: "RFI" },
  { path: "transmittal", label: "Transmittal" },
  { path: "workflow", label: "Workflow" },
  { path: "membri", label: "Membri" },
  { path: "organizzazioni", label: "Organizzazioni" },
  { path: "ruoli", label: "Ruoli e permessi" },
  { path: "naming", label: "Naming" },
  { path: "cruscotto", label: "Cruscotto", adminOnly: true },
  { path: "registro", label: "Registro", adminOnly: true },
];

export function ProjectPage() {
  const { projectId = "" } = useParams();
  const location = useLocation();
  const { data: project, error } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<Project>(`/projects/${projectId}`),
  });

  if (error) return <Alert severity="error">{(error as ApiError).status === 404 ? "Progetto non trovato" : (error as Error).message}</Alert>;
  if (!project) return null;

  const isProjectAdmin = !!project.my_permissions?.ADMIN?.PROJECT;
  const tabs = TABS.filter((t) => !t.adminOnly || isProjectAdmin);
  const current = tabs.findIndex((t) => location.pathname.includes(`/${t.path}`));
  const isAnyAdmin = isProjectAdmin || !!project.my_permissions?.ADMIN?.OWN_ORGANIZATION;

  return (
    <Stack spacing={2}>
      <Breadcrumbs>
        <Link component={RouterLink} to="/" underline="hover" color="inherit">Progetti</Link>
        <Typography color="text.primary">{project.code}</Typography>
      </Breadcrumbs>
      <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap">
        <Typography variant="h4" fontWeight={600} flexGrow={1}>{project.name}</Typography>
        <ReportMenu projectId={project.id} />
      </Stack>
      <Box borderBottom={1} borderColor="divider">
        <Tabs value={current < 0 ? 0 : current} variant="scrollable">
          {tabs.map((t) => <Tab key={t.path} label={t.label} component={RouterLink} to={`/progetti/${projectId}/${t.path}`} />)}
        </Tabs>
      </Box>
      <Suspense fallback={<LinearProgress />}>
      <Routes>
        <Route index element={<Navigate to="cartelle" replace />} />
        <Route path="container" element={<Navigate to="../cartelle" replace />} />
        <Route path="cartelle" element={<FolderView project={project} />} />
        <Route path="cartelle/:containerId" element={<FolderView project={project} />} />
        <Route path="documenti" element={<AreasTab project={project} />} />
        <Route path="riservate" element={<PrivateAreasTab project={project} />} />
        <Route path="rfi" element={<RfisTab project={project} />} />
        <Route path="rfi/:rfiId" element={<RfisTab project={project} />} />
        <Route path="transmittal" element={<TransmittalsTab project={project} />} />
        <Route path="transmittal/:transmittalId" element={<TransmittalsTab project={project} />} />
        <Route path="workflow" element={<WorkflowsTab project={project} canManage={isProjectAdmin} />} />
        <Route path="cruscotto" element={<DashboardTab project={project} />} />
        <Route path="registro" element={<AuditTab project={project} />} />
        <Route path="membri" element={<MembersTab project={project} canManage={isAnyAdmin} />} />
        <Route path="organizzazioni" element={<OrganizationsTab project={project} canManage={isProjectAdmin} />} />
        <Route path="ruoli" element={<RolesTab project={project} canManage={isProjectAdmin} />} />
        <Route path="naming" element={<NamingTab project={project} canManage={isProjectAdmin} />} />
      </Routes>
      </Suspense>
    </Stack>
  );
}
