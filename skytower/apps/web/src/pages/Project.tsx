// "><(((º> sabusabu <º)))><"
import { Link as RouterLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Breadcrumbs, Link, Stack, Tab, Tabs, Typography } from "@mui/material";
import { api, ApiError, Project } from "../api";
import { AreasTab } from "./project/Areas";
import { FolderView } from "./project/Folder";
import { PrivateAreasTab } from "./project/PrivateAreas";
import { AuditTab } from "./project/Audit";
import { RfisTab } from "./project/Rfis";
import { WorkflowsTab } from "./project/Workflows";
import { MembersTab } from "./project/Members";
import { OrganizationsTab } from "./project/Organizations";
import { RolesTab } from "./project/Roles";

const TABS = [
  { path: "cartelle", label: "Cartelle" },
  { path: "documenti", label: "Aree CDE" },
  { path: "riservate", label: "Aree riservate" },
  { path: "rfi", label: "RFI" },
  { path: "workflow", label: "Workflow" },
  { path: "membri", label: "Membri" },
  { path: "organizzazioni", label: "Organizzazioni" },
  { path: "ruoli", label: "Ruoli e permessi" },
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
      <Typography variant="h4" fontWeight={600}>{project.name}</Typography>
      <Box borderBottom={1} borderColor="divider">
        <Tabs value={current < 0 ? 0 : current} variant="scrollable">
          {tabs.map((t) => <Tab key={t.path} label={t.label} component={RouterLink} to={`/progetti/${projectId}/${t.path}`} />)}
        </Tabs>
      </Box>
      <Routes>
        <Route index element={<Navigate to="cartelle" replace />} />
        <Route path="container" element={<Navigate to="../cartelle" replace />} />
        <Route path="cartelle" element={<FolderView project={project} />} />
        <Route path="cartelle/:containerId" element={<FolderView project={project} />} />
        <Route path="documenti" element={<AreasTab project={project} />} />
        <Route path="riservate" element={<PrivateAreasTab project={project} />} />
        <Route path="rfi" element={<RfisTab project={project} />} />
        <Route path="rfi/:rfiId" element={<RfisTab project={project} />} />
        <Route path="workflow" element={<WorkflowsTab project={project} canManage={isProjectAdmin} />} />
        <Route path="registro" element={<AuditTab project={project} />} />
        <Route path="membri" element={<MembersTab project={project} canManage={isAnyAdmin} />} />
        <Route path="organizzazioni" element={<OrganizationsTab project={project} canManage={isProjectAdmin} />} />
        <Route path="ruoli" element={<RolesTab project={project} canManage={isProjectAdmin} />} />
      </Routes>
    </Stack>
  );
}
