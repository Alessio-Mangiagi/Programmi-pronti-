// "><(((º> sabusabu <º)))><"
// Contenuto di una cartella (container): sottocartelle e documenti, con la barra delle funzioni in alto.
// Senza containerId mostra le cartelle radice della commessa.
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert, Box, Breadcrumbs, Button, Chip, Dialog, DialogActions, DialogContent, Divider, InputAdornment,
  Link, Paper, Radio, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import DownloadIcon from "@mui/icons-material/Download";
import FolderIcon from "@mui/icons-material/Folder";
import GroupIcon from "@mui/icons-material/Group";
import HistoryIcon from "@mui/icons-material/History";
import LockIcon from "@mui/icons-material/Lock";
import SearchIcon from "@mui/icons-material/Search";
import SendIcon from "@mui/icons-material/Send";
import ShareIcon from "@mui/icons-material/Share";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { api, ApiError, Container, Project } from "../../api";
import { folderTree, useContainers } from "../../components/ProjectTree";
import { ContainerDetail, GrantDialog, NewContainerDialog } from "./Containers";
import { DocumentDrawer, DocumentRow, formatBytes, UploadDialog } from "./Documents";
import { STATE_COLOR, STATE_LABEL } from "./Transitions";
import { FileViewer } from "../../components/FileViewer";
import { StartWorkflowDialog } from "../../components/StartWorkflowDialog";
import { NewTransmittalDialog } from "./Transmittals";

// Colore per tipo informativo ISO 19650 (5° campo dell'identificativo): tavole, modelli, relazioni, ...
const TYPE_COLOR: Record<string, string> = {
  DR: "#a15c07", M2: "#5b3fa6", M3: "#5b3fa6", RP: "#2b579a", SP: "#2b579a", CA: "#217346", SH: "#217346",
  SC: "#217346", CM: "#217346", PP: "#b42318", MI: "#1f6f8b", CO: "#1f6f8b",
};

function TypeBadge({ identifier }: { identifier: string }) {
  const type = identifier.split("-")[4] ?? "";
  return (
    <Box component="span" title={`Tipo ${type}`}
         sx={{ width: 30, height: 22, borderRadius: 0.75, bgcolor: TYPE_COLOR[type] ?? "#5a6672", color: "#fff", fontSize: 11,
               fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {type || "—"}
    </Box>
  );
}

export function FolderView({ project }: { project: Project }) {
  const { containerId } = useParams();
  const navigate = useNavigate();
  const { data: containers, isLoading } = useContainers(project.id);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [viewDoc, setViewDoc] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"upload" | "folder" | "grant" | "shares" | "workflow" | "transmit" | null>(null);

  useEffect(() => { const t = setTimeout(() => setSearch(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setSelected(null); setQ(""); }, [containerId]);

  const tree = useMemo(() => folderTree(containers ?? []), [containers]);
  const byId = useMemo(() => new Map((containers ?? []).map((c) => [c.id, c])), [containers]);
  const current = containerId ? byId.get(containerId) ?? null : null;
  const path = useMemo(() => {
    const out: Container[] = [];
    for (let c = current; c; c = c.parent_id ? byId.get(c.parent_id) ?? null : null) out.unshift(c);
    return out;
  }, [current, byId]);

  const { data: docs } = useQuery({
    queryKey: ["documents", project.id, containerId, search],
    queryFn: () => api<{ items: DocumentRow[] }>(
      `/projects/${project.id}/documents?container_id=${containerId}${search ? `&q=${encodeURIComponent(search)}` : ""}`),
    enabled: !!current,
    refetchInterval: (query) => (query.state.data?.items.some((d) => d.current_scan_status === "PENDING") ? 3000 : false),
  });

  const download = useMutation({
    mutationFn: (revisionId: string) => api<{ url: string }>(`/revisions/${revisionId}/download`),
    onSuccess: ({ url }) => { window.location.href = url; },
  });

  if (isLoading) return null;
  if (containerId && !current) return <Alert severity="warning">Cartella non trovata o non visibile.</Alert>;

  const sub = (tree.get(current?.id ?? null) ?? []).filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()));
  const items = docs?.items ?? [];
  const doc = items.find((d) => d.id === selected) ?? null;
  const can = (a: string) => !!current?.my_actions.includes(a as never);
  const canCreateRoot = Object.values(project.my_permissions?.WRITE ?? {}).some(Boolean);

  return (
    <Stack spacing={1.5}>
      <Breadcrumbs aria-label="Percorso">
        <Link component={RouterLink} to={`/progetti/${project.id}/cartelle`} underline="hover" color="inherit">{project.code}</Link>
        {path.map((c, i) => i === path.length - 1
          ? <Typography key={c.id} color="text.primary" fontWeight={600}>{c.name}</Typography>
          : <Link key={c.id} component={RouterLink} to={`/progetti/${project.id}/cartelle/${c.id}`} underline="hover" color="inherit">{c.name}</Link>)}
      </Breadcrumbs>

      {current?.is_private && (
        <Alert severity="info" icon={<LockIcon fontSize="small" />}>
          Area riservata: la vedono solo gli amministratori e chi ha avuto l'accesso su richiesta.
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: 1, display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center" }} role="toolbar" aria-label="Funzioni">
        {current && <Button variant="contained" startIcon={<CloudUploadIcon />} disabled={!can("WRITE")} onClick={() => setDialog("upload")}>Carica</Button>}
        <Button startIcon={<CreateNewFolderIcon />} disabled={current ? !can("WRITE") : !canCreateRoot} onClick={() => setDialog("folder")}>
          Nuova cartella
        </Button>
        {current && (
          <>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            <Button startIcon={<VisibilityIcon />} disabled={!doc} onClick={() => setViewDoc(doc!.id)}>Apri</Button>
            <Button startIcon={<DownloadIcon />} disabled={!doc?.current_revision_id || doc.current_scan_status !== "CLEAN" || download.isPending}
                    onClick={() => download.mutate(doc!.current_revision_id!)}>Scarica</Button>
            <Button startIcon={<TaskAltIcon />} disabled={!doc?.current_revision_id || !!doc.archived_at} onClick={() => setDialog("workflow")}>
              Avvia approvazione
            </Button>
            <Button startIcon={<SendIcon />} onClick={() => setDialog("transmit")}
                    disabled={!doc?.current_revision_id || doc.current_scan_status !== "CLEAN" || !!doc.archived_at
                              || !(doc.current_state === "SHARED" || doc.current_state === "PUBLISHED")}>
              Trasmetti
            </Button>
            <Button startIcon={<HistoryIcon />} disabled={!doc} onClick={() => setOpenDoc(doc!.id)}>Dettagli e cronologia</Button>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
            <Button startIcon={<ShareIcon />} disabled={!can("ADMIN")} onClick={() => setDialog("grant")}>Condividi cartella</Button>
            <Button startIcon={<GroupIcon />} onClick={() => setDialog("shares")}>Accessi</Button>
          </>
        )}
        <Box flexGrow={1} />
        <TextField size="small" placeholder={current ? "Cerca in questa cartella" : "Filtra cartelle"} value={q}
                   onChange={(e) => setQ(e.target.value)} inputProps={{ "aria-label": "Cerca in questa cartella" }}
                   InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
      </Paper>
      {download.error && <Alert severity="error">{(download.error as ApiError).message}</Alert>}

      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        {sub.length === 0 && items.length === 0 ? (
          <Typography color="text.secondary" textAlign="center" py={5}>
            {current ? "Cartella vuota." : "Nessuna cartella visibile in questa commessa."}
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ "& th": { color: "text.secondary", fontWeight: 600, bgcolor: "background.default" } }}>
                <TableCell padding="checkbox" />
                <TableCell>Nome</TableCell><TableCell>Rev.</TableCell><TableCell>Idoneità</TableCell>
                <TableCell>Stato</TableCell><TableCell>Modificato</TableCell><TableCell align="right">Dimensione</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sub.map((c) => (
                <TableRow key={c.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/progetti/${project.id}/cartelle/${c.id}`)}>
                  <TableCell padding="checkbox" />
                  <TableCell>
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      {c.is_private ? <LockIcon sx={{ color: "#7a4fb5" }} /> : <FolderIcon sx={{ color: "#d9a93c" }} />}
                      {/* link vero: la cartella si apre anche da tastiera (Tab + Invio), non solo cliccando la riga */}
                      <Link component={RouterLink} to={`/progetti/${project.id}/cartelle/${c.id}`} variant="body2" fontWeight={500}
                            color="inherit" underline="hover" onClick={(e) => e.stopPropagation()}>{c.name}</Link>
                      <Chip size="small" variant="outlined" label={c.owner_organization_code} />
                    </Stack>
                  </TableCell>
                  <TableCell colSpan={5} sx={{ color: "text.secondary" }}>
                    {(tree.get(c.id)?.length ?? 0) > 0 ? `${tree.get(c.id)!.length} sottocartelle` : "cartella"}
                  </TableCell>
                </TableRow>
              ))}
              {items.map((d) => {
                const state = d.archived_at ? "ARCHIVED" : (d.current_state ?? "WIP");
                return (
                  <TableRow key={d.id} hover selected={d.id === selected} sx={{ cursor: "pointer" }}
                            onClick={() => setSelected(d.id)} onDoubleClick={() => setViewDoc(d.id)}>
                    <TableCell padding="checkbox">
                      <Radio size="small" checked={d.id === selected} onChange={() => setSelected(d.id)} inputProps={{ "aria-label": `Seleziona ${d.title}` }} />
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1.25} alignItems="center">
                        <TypeBadge identifier={d.identifier} />
                        <Box minWidth={0}>
                          <Typography variant="body2" fontWeight={500}>{d.title}</Typography>
                          <Typography variant="caption" fontFamily="monospace" color="text.secondary">{d.identifier}</Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell><b>{d.current_revision}</b></TableCell>
                    <TableCell>{d.current_suitability}</TableCell>
                    <TableCell><Chip size="small" color={STATE_COLOR[state]} label={STATE_LABEL[state]} /></TableCell>
                    <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>
                      {d.current_revision_at ? new Date(d.current_revision_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "—"}
                    </TableCell>
                    <TableCell align="right" sx={{ color: "text.secondary" }}>{formatBytes(d.current_size)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Paper>

      {dialog === "upload" && current && <UploadDialog project={project} container={current} onClose={() => setDialog(null)} />}
      {dialog === "folder" && <NewContainerDialog project={project} parent={current} onClose={() => setDialog(null)} />}
      {dialog === "grant" && current && <GrantDialog project={project} container={current} onClose={() => setDialog(null)} />}
      {dialog === "shares" && current && (
        <Dialog open onClose={() => setDialog(null)} fullWidth maxWidth="sm"
                PaperProps={{ "aria-label": `Accessi e condivisioni di ${current.name}` }}>
          <DialogContent><ContainerDetail container={current} project={project} onNewFolder={() => setDialog("folder")} /></DialogContent>
          <DialogActions><Button onClick={() => setDialog(null)}>Chiudi</Button></DialogActions>
        </Dialog>
      )}
      {dialog === "workflow" && doc?.current_revision_id && (
        <StartWorkflowDialog projectId={project.id} revisionId={doc.current_revision_id}
                             label={`${doc.identifier} ${doc.current_revision}`} onClose={() => setDialog(null)} />
      )}
      {dialog === "transmit" && doc && <NewTransmittalDialog project={project} initial={[doc]} onClose={() => setDialog(null)} />}
      <DocumentDrawer projectId={project.id} documentId={openDoc} onClose={() => setOpenDoc(null)} />
      {viewDoc && <FileViewer documentId={viewDoc} onClose={() => setViewDoc(null)}
                              onDetails={() => { setOpenDoc(viewDoc); setViewDoc(null); }} />}
    </Stack>
  );
}
