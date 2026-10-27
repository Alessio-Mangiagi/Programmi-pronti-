// "><(((º> sabusabu <º)))><"
// Colonna sinistra: le commesse in ordine alfabetico, ognuna con l'albero delle cartelle (container)
// caricato alla prima apertura, e in fondo le aree riservate (lucchetto se chiuse). Lo stato segue l'URL.
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Box, CircularProgress, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import { SimpleTreeView, TreeItem } from "@mui/x-tree-view";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import FolderSpecialIcon from "@mui/icons-material/FolderSpecial";
import LockIcon from "@mui/icons-material/Lock";
import SearchIcon from "@mui/icons-material/Search";
import { api, Container, PrivateArea, Project } from "../api";

const ROUTE = /^\/progetti\/([^/]+)(?:\/cartelle\/([^/?#]+))?/;

/** Container visibili raggruppati per padre; un container il cui padre non è visibile diventa radice. */
export function folderTree(containers: Container[]) {
  const ids = new Set(containers.map((c) => c.id));
  const byParent = new Map<string | null, Container[]>();
  for (const c of containers) {
    const key = c.parent_id && ids.has(c.parent_id) ? c.parent_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), c]);
  }
  // cartelle normali prima, aree riservate in fondo; poi per nome con i numeri in ordine naturale
  for (const list of byParent.values()) {
    list.sort((a, b) => Number(a.is_private) - Number(b.is_private) || a.name.localeCompare(b.name, "it", { numeric: true }));
  }
  return byParent;
}

export function useContainers(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["containers", projectId],
    queryFn: () => api<Container[]>(`/projects/${projectId}/containers`),
    enabled: !!projectId && enabled,
  });
}

export function usePrivateAreas(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["private-areas", projectId],
    queryFn: () => api<PrivateArea[]>(`/projects/${projectId}/private-areas`),
    enabled: !!projectId && enabled,
  });
}

export function ProjectTree({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const { data: projects = [], isLoading } = useQuery({ queryKey: ["my-projects"], queryFn: () => api<Project[]>("/me/projects") });

  const [, routeProject, routeFolder] = location.pathname.match(ROUTE) ?? [];
  const selected = routeFolder ? `c:${routeProject}:${routeFolder}` : routeProject ? `p:${routeProject}` : null;
  const expand = (ids: string[]) => setExpanded((cur) => [...new Set([...cur, ...ids])]);
  useEffect(() => { if (routeProject) expand([`p:${routeProject}`]); }, [routeProject]);

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return [...projects]
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "it", { numeric: true }));
  }, [projects, filter]);

  // id dei nodi: "p:<commessa>", "c:<commessa>:<cartella>", "r:<commessa>:<area chiusa>"
  const go = (itemId: string) => {
    const [kind, projectId, folderId] = itemId.split(":");
    if (kind === "p" && !folderId) navigate(`/progetti/${projectId}`);
    else if (kind === "c") navigate(`/progetti/${projectId}/cartelle/${folderId}`);
    else if (kind === "r") navigate(`/progetti/${projectId}/riservate`);
    else return;
    onNavigate?.();
  };

  return (
    <Stack height="100%" component="nav" aria-label="Commesse e cartelle">
      <Box px={1.75} pt={1.75} pb={1}>
        <Typography variant="overline" color="text.secondary" lineHeight={1.5}>Commesse</Typography>
        <TextField size="small" fullWidth placeholder="Cerca commessa" value={filter} onChange={(e) => setFilter(e.target.value)}
                   sx={{ mt: 0.5 }} inputProps={{ "aria-label": "Cerca commessa" }}
                   InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
      </Box>
      <Box flexGrow={1} overflow="auto" px={0.75} pb={2}>
        {isLoading && <CircularProgress size={20} sx={{ m: 2 }} />}
        {!isLoading && sorted.length === 0 && (
          <Typography variant="body2" color="text.secondary" px={1.5}>
            {filter ? "Nessuna commessa trovata." : "Non partecipi ancora a nessuna commessa."}
          </Typography>
        )}
        <SimpleTreeView expandedItems={expanded} onExpandedItemsChange={(_, ids) => setExpanded(ids)}
                        selectedItems={selected} onItemClick={(_, id) => go(id)} expansionTrigger="iconContainer">
          {sorted.map((p) => (
            <ProjectNode key={p.id} project={p} open={expanded.includes(`p:${p.id}`)}
                         currentFolder={routeProject === p.id ? routeFolder : undefined} onExpand={expand} />
          ))}
        </SimpleTreeView>
      </Box>
    </Stack>
  );
}

function ProjectNode({ project, open, currentFolder, onExpand }: {
  project: Project; open: boolean; currentFolder?: string; onExpand: (ids: string[]) => void;
}) {
  const { data: containers } = useContainers(project.id, open);
  const { data: areas = [] } = usePrivateAreas(project.id, open);
  const tree = useMemo(() => folderTree(containers ?? []), [containers]);
  const locked = areas.filter((a) => !a.has_access);

  // apre la catena di cartelle fino a quella nell'URL
  useEffect(() => {
    if (!containers || !currentFolder) return;
    const byId = new Map(containers.map((c) => [c.id, c]));
    const chain: string[] = [];
    for (let c = byId.get(currentFolder); c?.parent_id && byId.has(c.parent_id); c = byId.get(c.parent_id)) {
      chain.push(`c:${project.id}:${c.parent_id}`);
    }
    if (chain.length) onExpand(chain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containers, currentFolder]);

  const icon = (c: Container) =>
    c.is_private && !c.parent_id ? <FolderSpecialIcon fontSize="small" sx={{ color: "#7a4fb5" }} />
      : c.id === currentFolder ? <FolderOpenIcon fontSize="small" sx={{ color: "#c08a1e" }} />
      : <FolderIcon fontSize="small" sx={{ color: c.is_private ? "#9b7ccc" : "#d9a93c" }} />;

  const renderFolders = (parent: string | null) =>
    (tree.get(parent) ?? []).map((c) => (
      <TreeItem key={c.id} itemId={`c:${project.id}:${c.id}`}
                label={<Stack direction="row" alignItems="center" spacing={1} py={0.25}>
                  {icon(c)}
                  <Typography variant="body2" noWrap>{c.name}</Typography>
                </Stack>}>
        {renderFolders(c.id)}
      </TreeItem>
    ));

  return (
    <TreeItem itemId={`p:${project.id}`}
              label={<Stack direction="row" alignItems="baseline" spacing={1} py={0.5}>
                <Typography variant="caption" fontFamily="monospace" color="primary.main" fontWeight={600}>{project.code}</Typography>
                <Typography variant="body2" fontWeight={500} noWrap>{project.name}</Typography>
              </Stack>}>
      {containers === undefined
        ? <TreeItem itemId={`p:${project.id}:loading`} label={<Typography variant="caption" color="text.secondary">caricamento…</Typography>} />
        : containers.length === 0 && locked.length === 0
          ? <TreeItem itemId={`p:${project.id}:loading`} disabled label={<Typography variant="caption" color="text.secondary">nessuna cartella visibile</Typography>} />
          : renderFolders(null)}
      {locked.map((a) => (
        <TreeItem key={a.id} itemId={`r:${project.id}:${a.id}`}
                  label={<Stack direction="row" alignItems="center" spacing={1} py={0.25} color="text.secondary">
                    <LockIcon fontSize="small" />
                    <Typography variant="body2" noWrap>{a.name}</Typography>
                    {a.request_status === "PENDING" && <Typography variant="caption">· richiesta inviata</Typography>}
                  </Stack>} />
      ))}
    </TreeItem>
  );
}
