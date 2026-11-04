// "><(((º> sabusabu <º)))><"
// Elenco dei progetti e creazione di un progetto nuovo: vuoto, da un modello di commessa dell'organizzazione
// (ADR-52: struttura, organizzazioni, persone e documenti di modello) o da un progetto esistente usato come template
// (ADR-38): se ne copiano cartelle, naming, schemi per cartelle, ruoli e workflow, a scelta anche organizzazioni e
// persone; i documenti solo dai modelli.
import { useEffect, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Card, CardActionArea, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Grid, ListSubheader, MenuItem, Stack, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { api, ApiError, Project, ProjectModel } from "../api";
import { useAuth } from "../auth";
import { ChangesList } from "../components/ProjectModels";

export function ProjectsPage() {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: projects, isLoading } = useQuery({ queryKey: ["my-projects"], queryFn: () => api<Project[]>("/me/projects") });

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <div>
          <Typography variant="h4" fontWeight={600}>Progetti</Typography>
          <Typography color="text.secondary">{me?.organization_name}</Typography>
        </div>
        {me?.is_org_admin && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Nuovo progetto</Button>}
      </Stack>
      {!isLoading && projects?.length === 0 && <Alert severity="info">Non partecipi ancora a nessun progetto.</Alert>}
      <Grid container spacing={2}>
        {projects?.map((p) => (
          <Grid item xs={12} sm={6} md={4} key={p.id}>
            <Card variant="outlined">
              <CardActionArea component={RouterLink} to={`/progetti/${p.id}`}>
                <CardContent>
                  <Typography variant="overline" color="primary">{p.code}</Typography>
                  <Typography variant="h6" component="h2" gutterBottom>{p.name}</Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>Committente: {p.owner_name}</Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={p.status} />
                    {p.my_roles?.map((r) => <Chip key={r} size="small" color="primary" variant="outlined" label={r} />)}
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
      <NewProjectDialog open={open} onClose={() => setOpen(false)} />
    </Stack>
  );
}

interface Template { id: string; code: string; name: string; folders: number; naming_profiles: number; workflows: number; organizations: number }

/** Nuovo progetto: vuoto, da un modello di commessa dell'organizzazione (ADR-52) o da un progetto di cui si è
 * Project Admin (ADR-38). ``initialSource`` preseleziona la partenza: ``m:<id>`` modello, ``p:<id>`` progetto. */
export function NewProjectDialog({ open, onClose, initialSource = "" }: { open: boolean; onClose: () => void; initialSource?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState(initialSource);
  const [withOrgs, setWithOrgs] = useState(false);
  const [withMembers, setWithMembers] = useState(false);
  const [withDocs, setWithDocs] = useState(true);
  const [created, setCreated] = useState<{ id: string; changes: string[] } | null>(null);
  useEffect(() => { if (open) setSource(initialSource); }, [open, initialSource]);
  const { data: templates = [] } = useQuery({
    queryKey: ["project-templates"], queryFn: () => api<Template[]>("/projects/templates"), enabled: open,
  });
  // modelli di commessa dell'organizzazione: prima nell'elenco "Parti da" (li vedono gli admin dell'organizzazione)
  const { data: models = [] } = useQuery({
    queryKey: ["project-models", me?.organization_id],
    queryFn: () => api<ProjectModel[]>(`/organizations/${me!.organization_id}/project-models`),
    enabled: open && !!me?.is_org_admin,
  });
  const [kind, sourceId] = source ? [source.slice(0, 1), source.slice(2)] : ["", ""];
  const template = kind === "p" ? templates.find((t) => t.id === sourceId) : undefined;
  const model = kind === "m" ? models.find((m) => m.id === sourceId) : undefined;
  const fromSomething = !!template || !!model;
  const create = useMutation({
    mutationFn: () => {
      const options = { with_organizations: fromSomething && withOrgs, with_members: fromSomething && withOrgs && withMembers };
      return model
        ? api<Project & { changes?: string[] }>(`/project-models/${model.id}/projects`, { method: "POST", json: {
            code, name, ...options, with_documents: withDocs } })
        : api<Project & { changes?: string[] }>("/projects", { method: "POST", json: {
            code, name, template_id: template?.id ?? null, ...options } });
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["my-projects"] });
      // documenti di modello non copiati (cartella assente, file in quarantena): si dice prima di aprire la commessa
      if (p.changes?.length) setCreated({ id: p.id, changes: p.changes });
      else navigate(`/progetti/${p.id}`);
    },
  });
  const counts = model ?? template;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nuovo progetto</DialogTitle>
      <DialogContent>
        {created ? (
          <Stack spacing={2} mt={1}>
            <Alert severity="success">Commessa creata dal modello. Alcune cose non sono state copiate:</Alert>
            <ChangesList changes={created.changes} />
          </Stack>
        ) : (
          <Stack spacing={2} mt={1}>
            {create.error && <Alert severity="error">{(create.error as ApiError).message}</Alert>}
            <TextField label="Codice progetto (ISO 19650)" value={code} helperText="2–6 caratteri A-Z, 0-9"
                       onChange={(e) => setCode(e.target.value.toUpperCase())} inputProps={{ maxLength: 6 }} />
            <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField select label="Parti da" value={source} onChange={(e) => setSource(e.target.value)}
                       SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 420 } } } }}
                       helperText={model
                         ? `Dal modello: ${model.folders} cartelle, naming, ${model.naming_profiles} schemi per cartelle, ${model.roles} ruoli, ${model.workflows} workflow e ${model.documents} documenti di modello.`
                         : template
                           ? `Si copiano ${template.folders} cartelle, naming, ${template.naming_profiles} schemi per cartelle, ruoli e ${template.workflows} workflow. I documenti no.`
                           : "Un modello di commessa dell'organizzazione o un progetto di cui sei Project Admin"}>
              <MenuItem value="">Progetto vuoto</MenuItem>
              {models.length > 0 && <ListSubheader>Modelli di commessa</ListSubheader>}
              {models.map((m) => <MenuItem key={m.id} value={`m:${m.id}`}>{m.name}</MenuItem>)}
              {templates.length > 0 && <ListSubheader>Progetti di cui sei Project Admin</ListSubheader>}
              {templates.map((t) => <MenuItem key={t.id} value={`p:${t.id}`}>{t.code} — {t.name}</MenuItem>)}
            </TextField>
            {fromSomething && (
              <Stack>
                <FormControlLabel control={<Checkbox checked={withOrgs} onChange={(e) => { setWithOrgs(e.target.checked); if (!e.target.checked) setWithMembers(false); }} />}
                                  label={`Anche le organizzazioni partecipanti (${counts?.organizations ?? 0}) e le loro cartelle`} />
                <FormControlLabel control={<Checkbox checked={withMembers} disabled={!withOrgs} onChange={(e) => setWithMembers(e.target.checked)} />}
                                  label={model ? `Anche le persone del modello (${model.people}), con i loro ruoli` : "Anche le persone, con i loro ruoli"} />
                {model && (
                  <FormControlLabel control={<Checkbox checked={withDocs} onChange={(e) => setWithDocs(e.target.checked)} />}
                                    label={`Anche i documenti di modello (${model.documents}), come prima revisione`} />
                )}
              </Stack>
            )}
            {model && (
              <Typography variant="caption" color="text.secondary">
                Il codice commessa della suite si sceglie poi dal registro, nella scheda Suite della nuova commessa.
              </Typography>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {created ? (
          <Button variant="contained" onClick={() => navigate(`/progetti/${created.id}`)}>Apri la commessa</Button>
        ) : (
          <>
            <Button onClick={onClose}>Annulla</Button>
            <Button variant="contained" disabled={!/^[A-Z0-9]{2,6}$/.test(code) || name.length < 2 || create.isPending}
                    onClick={() => create.mutate()}>Crea</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
