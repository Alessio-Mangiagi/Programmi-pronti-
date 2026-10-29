// "><(((º> sabusabu <º)))><"
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  FormGroup, IconButton, List, ListItem, ListItemText, MenuItem, Paper, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import { SimpleTreeView, TreeItem } from "@mui/x-tree-view";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import DeleteIcon from "@mui/icons-material/Delete";
import ShareIcon from "@mui/icons-material/Share";
import { Action, api, ApiError, Container, Grant, Member, Project, ProjectOrganization } from "../../api";
import { DocumentsPanel } from "./Documents";

const GRANT_ACTIONS: Action[] = ["READ", "DOWNLOAD", "WRITE", "APPROVE"];
const ACTION_LABEL: Record<Action, string> = {
  READ: "Lettura", WRITE: "Scrittura", DOWNLOAD: "Download", APPROVE: "Approvazione", ADMIN: "Amministrazione",
};

export function ContainersTab({ project }: { project: Project }) {
  const { data: containers = [] } = useQuery({
    queryKey: ["containers", project.id],
    queryFn: () => api<Container[]>(`/projects/${project.id}/containers`),
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<{ parent: Container | null } | null>(null);

  // Un container visibile il cui padre non lo è (es. grant su una sottocartella) diventa radice
  const byParent = useMemo(() => {
    const ids = new Set(containers.map((c) => c.id));
    const map = new Map<string | null, Container[]>();
    for (const c of containers) {
      const key = c.parent_id && ids.has(c.parent_id) ? c.parent_id : null;
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return map;
  }, [containers]);

  const renderTree = (parent: string | null) =>
    (byParent.get(parent) ?? []).map((c) => (
      <TreeItem key={c.id} itemId={c.id} label={
        <Stack direction="row" alignItems="center" spacing={1} py={0.5}>
          <Typography variant="body2" flexGrow={1}>{c.name}</Typography>
          <Chip size="small" variant="outlined" label={c.owner_organization_code} />
        </Stack>
      }>
        {renderTree(c.id)}
      </TreeItem>
    ));

  const current = containers.find((c) => c.id === selected) ?? null;
  const canCreateRoot = Object.values(project.my_permissions?.WRITE ?? {}).some(Boolean);

  return (
    <>
    <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
      <Paper variant="outlined" sx={{ p: 2, flex: 1, width: "100%" }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="subtitle1" fontWeight={600}>Container informativi</Typography>
          {canCreateRoot && (
            <Button size="small" startIcon={<CreateNewFolderIcon />} onClick={() => setNewFolder({ parent: null })}>Nuovo</Button>
          )}
        </Stack>
        {containers.length === 0 ? (
          <Alert severity="info">Nessun container visibile. Vedi solo i container della tua organizzazione o condivisi con te.</Alert>
        ) : (
          <SimpleTreeView selectedItems={selected} onSelectedItemsChange={(_, id) => setSelected(id)}>
            {renderTree(null)}
          </SimpleTreeView>
        )}
      </Paper>
      <Box flex={1} width="100%">
        {current ? (
          <ContainerDetail container={current} project={project} onNewFolder={() => setNewFolder({ parent: current })} />
        ) : (
          <Paper variant="outlined" sx={{ p: 3 }}><Typography color="text.secondary">Seleziona un container.</Typography></Paper>
        )}
      </Box>
      {newFolder && <NewContainerDialog project={project} parent={newFolder.parent} onClose={() => setNewFolder(null)} />}
    </Stack>
    {current && <Box mt={2}><DocumentsPanel project={project} container={current} /></Box>}
    </>
  );
}

export function ContainerDetail({ container, project, onNewFolder }: { container: Container; project: Project; onNewFolder: () => void }) {
  const qc = useQueryClient();
  const isAdmin = container.my_actions.includes("ADMIN");
  const [sharing, setSharing] = useState(false);
  const { data: grants = [] } = useQuery({
    queryKey: ["grants", container.id],
    queryFn: () => api<Grant[]>(`/containers/${container.id}/grants`),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/containers/${container.id}/grants/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grants", container.id] }),
  });

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="h6" flexGrow={1}>{container.name}</Typography>
        {container.my_actions.includes("WRITE") && (
          <Tooltip title="Nuova sottocartella"><IconButton onClick={onNewFolder}><CreateNewFolderIcon /></IconButton></Tooltip>
        )}
        {isAdmin && <Tooltip title="Condividi"><IconButton color="primary" onClick={() => setSharing(true)}><ShareIcon /></IconButton></Tooltip>}
      </Stack>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Proprietario: {container.owner_organization_code} · {container.inherit_permissions ? "eredita i grant del padre" : "non eredita i grant"}
      </Typography>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap my={1}>
        {container.my_actions.map((a) => <Chip key={a} size="small" color="primary" label={ACTION_LABEL[a]} />)}
      </Stack>
      <Typography variant="subtitle2" mt={2}>Condivisioni attive</Typography>
      {grants.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Nessuna condivisione.</Typography>
      ) : (
        <List dense>
          {grants.map((g) => (
            <ListItem key={g.id} divider secondaryAction={isAdmin && (
              <IconButton edge="end" aria-label="revoca" onClick={() => revoke.mutate(g.id)}><DeleteIcon /></IconButton>
            )}>
              <ListItemText
                primary={`${g.grantee_type === "USER" ? g.grantee_user_name : g.grantee_organization_code} — ${g.actions.map((a) => ACTION_LABEL[a]).join(", ")}`}
                secondary={`${g.reason}${g.valid_until ? ` · fino al ${new Date(g.valid_until).toLocaleDateString("it-IT")}` : ""}`} />
            </ListItem>
          ))}
        </List>
      )}
      {sharing && <GrantDialog container={container} project={project} onClose={() => setSharing(false)} />}
    </Paper>
  );
}

export function NewContainerDialog({ project, parent, onClose }: { project: Project; parent: Container | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [inherit, setInherit] = useState(true);
  const create = useMutation({
    mutationFn: () => api(`/projects/${project.id}/containers`, {
      method: "POST", json: { name, parent_id: parent?.id ?? null, inherit_permissions: inherit },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["containers", project.id] });
      qc.invalidateQueries({ queryKey: ["naming-profiles", project.id] });   // può aver ereditato uno schema
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{parent ? `Nuova cartella in "${parent.name}"` : "Nuovo container"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {create.error && <Alert severity="error">{(create.error as ApiError).message}</Alert>}
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {parent && <FormControlLabel control={<Checkbox checked={inherit} onChange={(e) => setInherit(e.target.checked)} />}
                                       label="Eredita le condivisioni della cartella padre" />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Crea</Button>
      </DialogActions>
    </Dialog>
  );
}

export function GrantDialog({ container, project, onClose }: { container: Container; project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<"ORGANIZATION" | "USER">("ORGANIZATION");
  const [grantee, setGrantee] = useState("");
  const [actions, setActions] = useState<Action[]>(["READ"]);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const { data: orgs = [] } = useQuery({
    queryKey: ["project-orgs", project.id],
    queryFn: () => api<ProjectOrganization[]>(`/projects/${project.id}/organizations`),
  });
  const { data: members = [] } = useQuery({
    queryKey: ["members", project.id],
    queryFn: () => api<Member[]>(`/projects/${project.id}/members`),
  });
  const users = [...new Map(members.map((m) => [m.user_id, m])).values()];

  const save = useMutation({
    mutationFn: () => api(`/containers/${container.id}/grants`, {
      method: "POST",
      json: {
        grantee_type: type,
        ...(type === "USER" ? { grantee_user_id: grantee } : { grantee_organization_id: grantee }),
        actions, reason, valid_until: until ? new Date(until).toISOString() : null,
      },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["grants", container.id] }); onClose(); },
  });

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Condividi "{container.name}"</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Alert severity="info" variant="outlined">
            La condivisione estende la visibilità, non i privilegi: il destinatario potrà usare solo le azioni consentite anche dal suo ruolo.
          </Alert>
          {save.error && <Alert severity="error">{(save.error as ApiError).message}</Alert>}
          <ToggleButtonGroup exclusive size="small" value={type} onChange={(_, v) => { if (v) { setType(v); setGrantee(""); } }}>
            <ToggleButton value="ORGANIZATION">Organizzazione</ToggleButton>
            <ToggleButton value="USER">Utente</ToggleButton>
          </ToggleButtonGroup>
          <TextField select label="Destinatario" value={grantee} onChange={(e) => setGrantee(e.target.value)}>
            {type === "ORGANIZATION"
              ? orgs.filter((o) => o.organization_id !== container.owner_organization_id && o.is_active)
                  .map((o) => <MenuItem key={o.organization_id} value={o.organization_id}>{o.code} — {o.legal_name}</MenuItem>)
              : users.map((u) => <MenuItem key={u.user_id} value={u.user_id}>{u.first_name} {u.last_name} ({u.organization_code})</MenuItem>)}
          </TextField>
          <FormGroup row>
            {GRANT_ACTIONS.map((a) => (
              <FormControlLabel key={a} label={ACTION_LABEL[a]} control={
                <Checkbox checked={actions.includes(a)}
                          onChange={(e) => setActions(e.target.checked ? [...actions, a] : actions.filter((x) => x !== a))} />
              } />
            ))}
          </FormGroup>
          <TextField label="Motivazione (obbligatoria)" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} />
          <TextField label="Valida fino al" type="date" value={until} onChange={(e) => setUntil(e.target.value)} InputLabelProps={{ shrink: true }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!grantee || actions.length === 0 || reason.trim().length < 3 || save.isPending}
                onClick={() => save.mutate()}>Condividi</Button>
      </DialogActions>
    </Dialog>
  );
}
