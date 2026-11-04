// "><(((º> sabusabu <º)))><"
// Modelli di commessa dell'organizzazione (ADR-52), rotta /organizzazione/modelli. Un modello è la struttura pronta
// per una commessa nuova della stessa azienda: cartelle e aree riservate, naming, metadati, filigrana, ruoli,
// workflow, organizzazioni, persone e documenti di modello. Si salva da una commessa ("Salva come modello", anche
// dalla commessa stessa), si apre e si ritocca con le pagine di una commessa, si usa da "Nuovo progetto" → "Parti da"
// o da qui. "Scarica il modello" produce un file .cdemodello da conservare; "Carica un modello da file" lo ricrea.
// Solo per gli amministratori dell'organizzazione: le altre organizzazioni non vedono i modelli.
import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Card, CardActions, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid,
  MenuItem, Stack, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DownloadIcon from "@mui/icons-material/Download";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import { api, ApiError, Project, ProjectModel } from "../api";
import { useAuth } from "../auth";
import { ImportModelDialog, SaveAsModelDialog, useModelDownload } from "../components/ProjectModels";
import { NewProjectDialog } from "./Projects";

export function ModelliCommessaPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const orgId = me?.organization_id ?? "";
  const { data: models = [], error, isLoading } = useQuery({
    queryKey: ["project-models", orgId], enabled: !!orgId && !!me?.is_org_admin,
    queryFn: () => api<ProjectModel[]>(`/organizations/${orgId}/project-models`),
  });
  const [using, setUsing] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [blank, setBlank] = useState(false);
  const [archiving, setArchiving] = useState<ProjectModel | null>(null);
  const download = useModelDownload();
  const archive = useMutation({
    mutationFn: (m: ProjectModel) => api(`/projects/${m.id}`, { method: "PATCH", json: { status: "ARCHIVED" } }),
    onSuccess: () => { setArchiving(null); qc.invalidateQueries({ queryKey: ["project-models"] }); },
  });

  if (!me) return null;
  if (!me.is_org_admin)
    return <Alert severity="info">I modelli di commessa li gestiscono gli amministratori dell'organizzazione.</Alert>;
  const failure = [download.error, archive.error].find(Boolean) as ApiError | undefined;

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
        <div style={{ flexGrow: 1 }}>
          <Typography variant="h4" fontWeight={600}>Modelli di commessa</Typography>
          <Typography color="text.secondary">
            {me.organization_name}: la struttura pronta per aprire una commessa nuova, senza ripartire da zero.
          </Typography>
        </div>
        <Button variant="contained" startIcon={<SaveAltIcon />} onClick={() => setChoosing(true)}>Salva una commessa come modello</Button>
        <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setBlank(true)}>Modello vuoto</Button>
        <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => setImporting(true)}>Carica un modello da file</Button>
      </Stack>
      {error && <Alert severity="error">{(error as ApiError).message}</Alert>}
      {failure && <Alert severity="error">{failure.message}</Alert>}
      {!isLoading && models.length === 0 && (
        <Alert severity="info">
          Nessun modello ancora. Apri una commessa ben impostata e usa «Salva come modello», oppure salvala da qui.
        </Alert>
      )}
      <Grid container spacing={2}>
        {models.map((m) => (
          <Grid item xs={12} md={6} key={m.id}>
            <Card variant="outlined" component="article" aria-label={`Modello ${m.name}`}>
              <CardContent>
                <Typography variant="overline" color="secondary">Modello di commessa · {m.code}</Typography>
                <Typography variant="h6" component="h2">{m.name}</Typography>
                {m.description && <Typography variant="body2" color="text.secondary">{m.description}</Typography>}
                <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                  {m.source_name ? `Salvato da ${m.source_code} — ${m.source_name}` : "Creato vuoto o da file"}
                  {m.created_by_name ? ` · ${m.created_by_name}` : ""} · aggiornato il {new Date(m.updated_at).toLocaleDateString("it-IT")}
                </Typography>
                <Stack direction="row" gap={0.5} flexWrap="wrap" mt={1.5}>
                  <Chip size="small" label={`${m.folders} cartelle`} />
                  <Chip size="small" label={`${m.naming_profiles} schemi di naming`} />
                  <Chip size="small" label={`${m.roles} ruoli`} />
                  <Chip size="small" label={`${m.workflows} workflow`} />
                  <Chip size="small" label={`${m.organizations} organizzazioni`} />
                  <Chip size="small" label={`${m.people} persone`} />
                  <Chip size="small" color={m.documents ? "primary" : "default"} variant="outlined" label={`${m.documents} documenti di modello`} />
                </Stack>
              </CardContent>
              <CardActions sx={{ flexWrap: "wrap", gap: 0.5 }}>
                <Button size="small" variant="contained" onClick={() => setUsing(m.id)}>Nuova commessa da questo modello</Button>
                <Button size="small" component={RouterLink} to={`/progetti/${m.id}`}>Apri e modifica</Button>
                <Button size="small" startIcon={<DownloadIcon />} disabled={download.isPending}
                        onClick={() => download.mutate(m)}>Scarica il modello</Button>
                <Button size="small" color="error" onClick={() => setArchiving(m)}>Archivia</Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
      <NewProjectDialog open={!!using} onClose={() => setUsing(null)} initialSource={using ? `m:${using}` : ""} />
      {choosing && <ChooseProjectDialog onClose={() => setChoosing(false)} />}
      {importing && <ImportModelDialog orgId={orgId} onClose={() => setImporting(false)} />}
      {blank && <BlankModelDialog orgId={orgId} defaultCode={me.organization_code} onClose={() => setBlank(false)} />}
      {archiving && (
        <Dialog open onClose={() => setArchiving(null)} maxWidth="xs">
          <DialogTitle>Archiviare «{archiving.name}»?</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              Il modello sparisce dall'elenco e da «Parti da». Le commesse già create dal modello non cambiano.
              Prima puoi scaricarlo come file, per sicurezza.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setArchiving(null)}>Annulla</Button>
            <Button color="error" variant="contained" disabled={archive.isPending} onClick={() => archive.mutate(archiving)}>Archivia</Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}

interface Template { id: string; code: string; name: string }

/** Sceglie la commessa da salvare come modello (quelle di cui si è Project Admin). */
function ChooseProjectDialog({ onClose }: { onClose: () => void }) {
  const [projectId, setProjectId] = useState("");
  const { data: projects = [] } = useQuery({ queryKey: ["project-templates"], queryFn: () => api<Template[]>("/projects/templates") });
  const { data: project } = useQuery({
    queryKey: ["project", projectId], queryFn: () => api<Project>(`/projects/${projectId}`), enabled: !!projectId,
  });
  if (project) return <SaveAsModelDialog project={project} onClose={onClose} />;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Salva una commessa come modello</DialogTitle>
      <DialogContent>
        <TextField select fullWidth sx={{ mt: 1 }} label="Commessa" value={projectId} onChange={(e) => setProjectId(e.target.value)}
                   helperText="Le commesse di cui sei Project Admin">
          {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.code} — {p.name}</MenuItem>)}
        </TextField>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Annulla</Button></DialogActions>
    </Dialog>
  );
}

/** Modello vuoto: struttura da costruire da zero dentro il modello. */
function BlankModelDialog({ orgId, defaultCode, onClose }: { orgId: string; defaultCode: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState(defaultCode.slice(0, 6));
  const create = useMutation({
    mutationFn: () => api<ProjectModel>(`/organizations/${orgId}/project-models`, { method: "POST", json: { name: name.trim(), code } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project-models"] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Modello vuoto</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {create.error && <Alert severity="error">{(create.error as ApiError).message}</Alert>}
          <TextField label="Nome del modello" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <TextField label="Codice segnaposto" value={code} inputProps={{ maxLength: 6 }}
                     helperText="Compare nel naming del modello; la commessa nuova prende il suo codice"
                     onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={name.trim().length < 2 || !/^[A-Z0-9]{2,6}$/.test(code) || create.isPending}
                onClick={() => create.mutate()}>Crea</Button>
      </DialogActions>
    </Dialog>
  );
}
