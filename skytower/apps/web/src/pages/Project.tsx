// "><(((º> sabusabu <º)))><"
// Un MODELLO di commessa (ADR-52) si apre con le stesse schede, senza quelle operative (RFI, transmittal, processi,
// suite, cruscotto): una barra in alto lo dice e offre "Nuova commessa da questo modello" e "Scarica il modello".
// Nella scheda Membri ci sono le persone salvate nel modello. Su una commessa il Project Admin trova nel menu
// "Modello" le voci "Salva come modello" (se è anche admin dell'organizzazione) e "Scarica il modello".
import { lazy, Suspense, useState } from "react";
import { Link as RouterLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Alert, Box, Breadcrumbs, Button, LinearProgress, Link, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Tab, Tabs, Typography,
} from "@mui/material";
import DashboardCustomizeIcon from "@mui/icons-material/DashboardCustomize";
import DownloadIcon from "@mui/icons-material/Download";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import { api, ApiError, Project } from "../api";
import { useAuth } from "../auth";
import { FolderView } from "./project/Folder";
import { ReportMenu } from "../components/ReportMenu";
import { SaveAsModelDialog, useModelDownload } from "../components/ProjectModels";
import { NewProjectDialog } from "./Projects";

// Le schede diverse da Cartelle si caricano quando si aprono: il bundle iniziale resta leggero.
const AreasTab = lazy(() => import("./project/Areas").then((m) => ({ default: m.AreasTab })));
const PrivateAreasTab = lazy(() => import("./project/PrivateAreas").then((m) => ({ default: m.PrivateAreasTab })));
const AuditTab = lazy(() => import("./project/Audit").then((m) => ({ default: m.AuditTab })));
const DashboardTab = lazy(() => import("./project/Dashboard").then((m) => ({ default: m.DashboardTab })));
const RfisTab = lazy(() => import("./project/Rfis").then((m) => ({ default: m.RfisTab })));
const TransmittalsTab = lazy(() => import("./project/Transmittals").then((m) => ({ default: m.TransmittalsTab })));
const WorkflowsTab = lazy(() => import("./project/Workflows").then((m) => ({ default: m.WorkflowsTab })));
// Processi: workflow a grafo che partono senza documento (docs/workflow-grafo.md §2)
const ProcessiTab = lazy(() => import("./project/Processi").then((m) => ({ default: m.ProcessiTab })));
const MembersTab = lazy(() => import("./project/Members").then((m) => ({ default: m.MembersTab })));
const OrganizationsTab = lazy(() => import("./project/Organizations").then((m) => ({ default: m.OrganizationsTab })));
const RolesTab = lazy(() => import("./project/Roles").then((m) => ({ default: m.RolesTab })));
const NamingTab = lazy(() => import("./project/Naming").then((m) => ({ default: m.NamingTab })));
const SuiteTab = lazy(() => import("./project/Suite").then((m) => ({ default: m.SuiteTab })));
// Timbri da mettere sui PDF dal visualizzatore (ADR-56)
const TimbriTab = lazy(() => import("./project/Timbri").then((m) => ({ default: m.TimbriTab })));
const ModelPeopleTab = lazy(() => import("./project/ModelPeople").then((m) => ({ default: m.ModelPeopleTab })));

const TABS = [
  { path: "cartelle", label: "Cartelle" },
  { path: "documenti", label: "Aree CDE" },
  { path: "riservate", label: "Aree riservate" },
  { path: "rfi", label: "RFI", operative: true },
  { path: "transmittal", label: "Transmittal", operative: true },
  { path: "workflow", label: "Workflow" },
  { path: "processi", label: "Processi", operative: true },
  { path: "membri", label: "Membri" },
  { path: "organizzazioni", label: "Organizzazioni" },
  { path: "ruoli", label: "Ruoli e permessi" },
  { path: "naming", label: "Naming" },
  { path: "timbri", label: "Timbri", operative: true },
  { path: "suite", label: "Suite Cosedil", operative: true },
  { path: "cruscotto", label: "Cruscotto", adminOnly: true, operative: true },
  { path: "registro", label: "Registro", adminOnly: true },
];

export function ProjectPage() {
  const { projectId = "" } = useParams();
  const location = useLocation();
  const { me } = useAuth();
  const [saving, setSaving] = useState(false);
  const [using, setUsing] = useState(false);
  const [modelMenu, setModelMenu] = useState<HTMLElement | null>(null);
  const download = useModelDownload();
  const { data: project, error } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<Project>(`/projects/${projectId}`),
  });

  if (error) return <Alert severity="error">{(error as ApiError).status === 404 ? "Progetto non trovato" : (error as Error).message}</Alert>;
  if (!project) return null;

  const isProjectAdmin = !!project.my_permissions?.ADMIN?.PROJECT;
  const isModel = !!project.is_model;
  const tabs = TABS.filter((t) => (!t.adminOnly || isProjectAdmin) && !(isModel && t.operative))
    .map((t) => (isModel && t.path === "membri" ? { ...t, label: "Persone del modello" } : t));
  const current = tabs.findIndex((t) => location.pathname.includes(`/${t.path}`));
  const isAnyAdmin = isProjectAdmin || !!project.my_permissions?.ADMIN?.OWN_ORGANIZATION;

  return (
    <Stack spacing={2}>
      <Breadcrumbs>
        {isModel
          ? <Link component={RouterLink} to="/organizzazione/modelli" underline="hover" color="inherit">Modelli di commessa</Link>
          : <Link component={RouterLink} to="/" underline="hover" color="inherit">Progetti</Link>}
        <Typography color="text.primary">{project.code}</Typography>
      </Breadcrumbs>
      <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap">
        <Typography variant="h4" fontWeight={600} flexGrow={1}>{project.name}</Typography>
        {/* menu "Modello" e non pulsanti: "Scarica…" conterrebbe "Carica", che i test e2e cercano per nome */}
        {!isModel && isProjectAdmin && (
          <>
            <Button variant="outlined" startIcon={<DashboardCustomizeIcon />} aria-haspopup="menu" disabled={download.isPending}
                    onClick={(e) => setModelMenu(e.currentTarget)}>Modello</Button>
            <Menu anchorEl={modelMenu} open={!!modelMenu} onClose={() => setModelMenu(null)}>
              {me?.is_org_admin && (
                <MenuItem onClick={() => { setModelMenu(null); setSaving(true); }}>
                  <ListItemIcon><SaveAltIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Salva come modello" secondary="Nuovo modello di commessa con questa struttura" />
                </MenuItem>
              )}
              <MenuItem onClick={() => { setModelMenu(null); download.mutate(project); }}>
                <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Scarica il modello" secondary="File .cdemodello da conservare o caricare altrove" />
              </MenuItem>
            </Menu>
          </>
        )}
        {!isModel && <ReportMenu projectId={project.id} />}
      </Stack>
      {isModel && (
        <Alert severity="info" variant="outlined" role="region" aria-label="Modello di commessa"
               action={(
                 <Stack direction="row" gap={1} flexWrap="wrap" justifyContent="flex-end">
                   {me?.is_org_admin && <Button size="small" variant="contained" onClick={() => setUsing(true)}>Nuova commessa da questo modello</Button>}
                   <Button size="small" startIcon={<DownloadIcon />} disabled={download.isPending}
                           onClick={() => download.mutate(project)}>Scarica il modello</Button>
                 </Stack>
               )}>
          <b>Modello di commessa.</b> Qui si prepara la struttura delle commesse nuove: cartelle, naming, ruoli, workflow,
          organizzazioni, persone e documenti di modello. Non è una commessa: niente RFI, transmittal o processi, e non
          compare negli elenchi.
        </Alert>
      )}
      {download.error && <Alert severity="error">{(download.error as ApiError).message}</Alert>}
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
        <Route path="processi" element={<ProcessiTab project={project} />} />
        <Route path="cruscotto" element={<DashboardTab project={project} />} />
        <Route path="registro" element={<AuditTab project={project} />} />
        <Route path="membri" element={isModel ? <ModelPeopleTab project={project} /> : <MembersTab project={project} canManage={isAnyAdmin} />} />
        <Route path="organizzazioni" element={<OrganizationsTab project={project} canManage={isProjectAdmin} />} />
        <Route path="ruoli" element={<RolesTab project={project} canManage={isProjectAdmin} />} />
        <Route path="naming" element={<NamingTab project={project} canManage={isProjectAdmin} />} />
        <Route path="suite" element={<SuiteTab project={project} canManage={isProjectAdmin} />} />
        <Route path="timbri" element={<TimbriTab project={project} />} />
      </Routes>
      </Suspense>
      {saving && <SaveAsModelDialog project={project} onClose={() => setSaving(false)} />}
      <NewProjectDialog open={using} onClose={() => setUsing(false)} initialSource={`m:${project.id}`} />
    </Stack>
  );
}
