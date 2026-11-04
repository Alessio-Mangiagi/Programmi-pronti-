// "><(((º> sabusabu <º)))><"
// Pezzi comuni dei modelli di commessa (ADR-52): elenco delle cose adattate, "Salva come modello" da una commessa,
// "Scarica il modello" (file .cdemodello), "Carica un modello da file" e il segno "Documento di modello" nel
// pannello di un documento. Le pagine li usano: Modelli di commessa, la commessa (barra in alto), il dettaglio
// documento.
import { ChangeEvent, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  List, ListItem, ListItemIcon, ListItemText, Stack, Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { api, apiDownload, ApiError, Project, ProjectModel } from "../api";
import { useAuth } from "../auth";

/** Cose non copiate o adattate (persone assenti, organizzazioni non trovate, workflow da rivedere). */
export function ChangesList({ changes }: { changes: string[] }) {
  if (!changes.length) return <Typography variant="body2">Nessun adattamento: tutto è stato copiato com'era.</Typography>;
  return (
    <List dense disablePadding aria-label="Elenco degli adattamenti" sx={{ maxHeight: 340, overflowY: "auto" }}>
      {changes.map((c, i) => (
        <ListItem key={i} disableGutters alignItems="flex-start">
          <ListItemIcon sx={{ minWidth: 30, mt: 0.5 }}><InfoOutlinedIcon fontSize="small" color="warning" /></ListItemIcon>
          <ListItemText primary={c} primaryTypographyProps={{ variant: "body2" }} />
        </ListItem>
      ))}
    </List>
  );
}

/** "Scarica il modello": file .cdemodello con struttura, workflow e documenti di modello (da un modello o da una commessa). */
export function useModelDownload() {
  return useMutation({
    mutationFn: (p: { id: string; code: string }) => apiDownload(`/projects/${p.id}/model-file`, `Modello-${p.code}.cdemodello`),
  });
}

/** "Salva come modello": crea un modello di commessa separato; la commessa resta com'è. */
export function SaveAsModelDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(`Modello – ${project.name}`);
  const [description, setDescription] = useState("");
  const save = useMutation({
    mutationFn: () => api<ProjectModel>(`/organizations/${me!.organization_id}/project-models`, { method: "POST", json: {
      source_project_id: project.id, name: name.trim(), description: description.trim() || null } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-models"] }),
  });
  const done = save.data;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Salva come modello</DialogTitle>
      <DialogContent>
        {done ? (
          <Stack spacing={2} mt={1}>
            <Alert severity="success">
              Modello «{done.name}» salvato: {done.folders} cartelle, {done.roles} ruoli, {done.workflows} workflow,
              {" "}{done.organizations} organizzazioni, {done.people} persone, {done.documents} documenti di modello.
            </Alert>
            {!!done.changes?.length && <ChangesList changes={done.changes} />}
          </Stack>
        ) : (
          <Stack spacing={2} mt={1}>
            {save.error && <Alert severity="error">{(save.error as ApiError).message}</Alert>}
            <Typography variant="body2">
              Si crea un modello di commessa della tua organizzazione con la struttura di questa commessa: cartelle e aree
              riservate, naming e schemi per cartelle, metadati, filigrana, ruoli, workflow della commessa, organizzazioni,
              persone con i ruoli e i documenti marcati «di modello» (come prima revisione). La commessa resta com'è.
            </Typography>
            <TextField label="Nome del modello" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <TextField label="Descrizione (facoltativa)" value={description} multiline minRows={2}
                       onChange={(e) => setDescription(e.target.value)} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {done ? (
          <>
            <Button onClick={onClose}>Chiudi</Button>
            <Button variant="contained" component={RouterLink} to="/organizzazione/modelli">Vai ai modelli di commessa</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Annulla</Button>
            <Button variant="contained" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}
                    startIcon={save.isPending ? <CircularProgress size={16} /> : undefined}>Salva il modello</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** "Carica un modello da file": ricrea un modello identico nell'organizzazione e mostra gli adattamenti. */
export function ImportModelDialog({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [withLibrary, setWithLibrary] = useState(true);
  const upload = useMutation({
    mutationFn: () => {
      const q = new URLSearchParams({ with_library: String(withLibrary), ...(name.trim() ? { name: name.trim() } : {}) });
      return api<ProjectModel>(`/organizations/${orgId}/project-models/import?${q}`, {
        method: "POST", body: file!, headers: { "Content-Type": "application/zip" } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-models"] }),
  });
  const done = upload.data;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Carica un modello da file</DialogTitle>
      <DialogContent>
        {done ? (
          <Stack spacing={2} mt={1}>
            <Alert severity="success">
              Modello «{done.name}» caricato: {done.folders} cartelle, {done.roles} ruoli, {done.workflows} workflow,
              {" "}{done.people} persone, {done.documents} documenti di modello.
            </Alert>
            <Typography variant="subtitle2">Cose adattate</Typography>
            <ChangesList changes={done.changes ?? []} />
          </Stack>
        ) : (
          <Stack spacing={2} mt={1}>
            {upload.error && <Alert severity="error">{(upload.error as ApiError).message}</Alert>}
            <Typography variant="body2">
              Scegli un file <b>.cdemodello</b> scaricato da SkyTower. Il file viene controllato (impronte, versione,
              contenuto) e diventa un nuovo modello di commessa della tua organizzazione. Persone e organizzazioni che qui
              non ci sono vengono saltate e segnalate.
            </Typography>
            <input ref={input} type="file" accept=".cdemodello,.zip" hidden
                   onChange={(e: ChangeEvent<HTMLInputElement>) => { setFile(e.target.files?.[0] ?? null); upload.reset(); }} />
            <Box>
              <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => input.current?.click()}>Scegli il file</Button>
              <Typography component="span" variant="body2" ml={1.5}>{file ? `${file.name} (${Math.ceil(file.size / 1024)} KB)` : "Nessun file scelto"}</Typography>
            </Box>
            <TextField label="Nome del modello (facoltativo)" value={name} onChange={(e) => setName(e.target.value)}
                       helperText="Vuoto = il nome scritto nel file" />
            <FormControlLabel control={<Checkbox checked={withLibrary} onChange={(e) => setWithLibrary(e.target.checked)} />}
                              label="Aggiungi alla libreria i workflow di libreria del file che qui mancano" />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {done ? (
          <>
            <Button onClick={onClose}>Chiudi</Button>
            <Button variant="contained" component={RouterLink} to={`/progetti/${done.id}`}>Apri il modello</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Annulla</Button>
            <Button variant="contained" disabled={!file || upload.isPending} onClick={() => upload.mutate()}
                    startIcon={upload.isPending ? <CircularProgress size={16} /> : undefined}>Carica</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** Interruttore "Documento di modello" nel pannello di un documento: lo vede e lo usa il Project Admin. */
export function ModelDocumentToggle({ projectId, documentId }: { projectId: string; documentId: string }) {
  const qc = useQueryClient();
  const { data: project } = useQuery({ queryKey: ["project", projectId], queryFn: () => api<Project>(`/projects/${projectId}`) });
  const isAdmin = !!project?.my_permissions?.ADMIN?.PROJECT;
  const { data: marked = [] } = useQuery({
    queryKey: ["model-documents", projectId],
    queryFn: () => api<{ document_id: string }[]>(`/projects/${projectId}/model-documents`),
    enabled: isAdmin,
  });
  const on = marked.some((m) => m.document_id === documentId);
  const toggle = useMutation({
    mutationFn: (value: boolean) => api(`/documents/${documentId}/model`, { method: value ? "PUT" : "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["model-documents", projectId] }),
  });
  if (!isAdmin) return null;
  return (
    <Tooltip describeChild title={project?.is_model
      ? "Si copia, come prima revisione, nelle commesse create da questo modello"
      : "Si copia nei modelli salvati da questa commessa (es. capitolato tipo, moduli) e nelle commesse che ne nascono"}>
      <FormControlLabel label="Documento di modello" sx={{ alignSelf: "flex-start" }}
        control={<Switch checked={on} disabled={toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)} />} />
    </Tooltip>
  );
}
